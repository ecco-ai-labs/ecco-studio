"""Audio auto-rater (owner request 12 Nov 2026): a reverse pass that checks a recording says its script.

Audio is generated from text, then turned back into text with Whisper (listen-back). The two are compared word
by word. At 90% or more the recording passes. Below that, the lines that were not heard are rewritten in plain
spoken form (numbers, symbols and notation a voice model stumbles on) and the recording is made again, then
listened to again: at most three passes, after which the episode is held with the lines that still fail.

Comparison ignores case and punctuation and reads numbers the same whether written as digits or words, so
"four million" in the script and "4 million" from Whisper match.
"""
import difflib
import re

PASS = 0.9          # share of script words heard for a recording to pass
LINE_PASS = 0.8     # a line below this is repaired before the next pass
MAX_PASSES = 3

UNITS = {w: i for i, w in enumerate('zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen '
                                     'fifteen sixteen seventeen eighteen nineteen'.split())}
TENS = {w: 10 * i for i, w in enumerate('_ _ twenty thirty forty fifty sixty seventy eighty ninety'.split()) if w != '_'}
SCALES = {'hundred': 100, 'thousand': 1000, 'million': 10 ** 6, 'billion': 10 ** 9, 'trillion': 10 ** 12}
SUPERSCRIPT = str.maketrans('⁰¹²³⁴⁵⁶⁷⁸⁹⁻', '0123456789-')


def _superscripts(text):
    """10⁴⁶ -> 10^46 (an exponent, not the number 1046); any other superscript digits become plain digits."""
    text = re.sub(r'(\d)([⁰¹²³⁴⁵⁶⁷⁸⁹⁻]+)', lambda m: m.group(1) + '^' + m.group(2).translate(SUPERSCRIPT), str(text or ''))
    return text.translate(SUPERSCRIPT)
ORDINAL = {1: 'first', 2: 'second', 3: 'third', 5: 'fifth', 8: 'eighth', 9: 'ninth', 12: 'twelfth'}


def _number_word(token):
    return token in UNITS or token in TENS or token in SCALES or re.fullmatch(r'\d+(?:\.\d+)?', token or '')


def _fold_numbers(tokens):
    """Collapse runs like ['four', 'million'] or ['4', 'million'] or ['twenty', 'one'] into one digit string."""
    out, i = [], 0
    while i < len(tokens):
        if not _number_word(tokens[i]) or tokens[i] in SCALES:
            out.append(tokens[i])
            i += 1
            continue
        total, current, j = 0.0, 0.0, i
        while j < len(tokens) and _number_word(tokens[j]):
            t = tokens[j]
            if t in UNITS:
                current += UNITS[t]
            elif t in TENS:
                current += TENS[t]
            elif t == 'hundred':
                current = (current or 1) * 100
            elif t in SCALES:
                total += (current or 1) * SCALES[t]
                current = 0
            else:
                if current and not (j > i and tokens[j - 1] in SCALES):
                    break  # two separate numbers side by side
                current += float(t)
            j += 1
            if j < len(tokens) and tokens[j] == 'and' and j + 1 < len(tokens) and _number_word(tokens[j + 1]) and tokens[j + 1] not in SCALES:
                j += 1  # "one hundred and five"
        value = total + current
        out.append(str(int(value)) if value == int(value) else str(value))
        i = j
    return out


def words(text):
    """Comparable words: lower case, no punctuation, numbers as digits."""
    text = _superscripts(text).replace('^', ' ').lower().replace('%', ' percent ').replace('&', ' and ').replace('×', ' times ')
    text = re.sub(r'(?<=\d),(?=\d{3}\b)', '', text)            # 4,000 -> 4000
    text = re.sub(r'(?<=\d)-(?=\d)', ' ', text)                 # ranges 3-4 -> 3 4
    tokens = re.findall(r"\d+(?:\.\d+)?|[a-z]+(?:'[a-z]+)?", text)
    return _fold_numbers(tokens)


def score(lines, transcript):
    """(overall share heard, per-line share heard, missing phrases) for the script lines against a transcript."""
    expected, owner = [], []
    for index, line in enumerate(lines):
        for w in words(line):
            expected.append(w)
            owner.append(index)
    heard = words(transcript)
    if not expected:
        return 1.0, [1.0] * len(lines), []
    matcher = difflib.SequenceMatcher(a=expected, b=heard, autojunk=False)
    hit = [0] * len(lines)
    for block in matcher.get_matching_blocks():
        for k in range(block.a, block.a + block.size):
            hit[owner[k]] += 1
    totals = [0] * len(lines)
    for o in owner:
        totals[o] += 1
    per_line = [(hit[i] / totals[i]) if totals[i] else 1.0 for i in range(len(lines))]
    missing = [' '.join(expected[a1:a2]) for tag, a1, a2, _, _ in matcher.get_opcodes() if tag in ('delete', 'replace')]
    return sum(hit) / len(expected), per_line, missing[:8]


def _say_number(n):
    """0-999 as words (for exponents and small counts)."""
    n = int(n)
    if n < 20:
        return list(UNITS)[n]
    if n < 100:
        tens = [w for w, v in TENS.items() if v == n // 10 * 10][0]
        return tens + ('-' + list(UNITS)[n % 10] if n % 10 else '')
    return list(UNITS)[n // 100] + ' hundred' + (' ' + _say_number(n % 100) if n % 100 else '')


def _ordinal(n):
    n = int(n)
    if n in ORDINAL:
        return ORDINAL[n]
    word = _say_number(n)
    if word.endswith('y'):
        return word[:-1] + 'ieth'
    for small, ord_ in ORDINAL.items():
        base = list(UNITS)[small] if small < 20 else None
        if base and word.endswith(base):
            return word[: -len(base)] + ord_
    return word + 'th'


def spoken_form(text):
    """Rewrite notation a voice model mis-reads into plain spoken words. Meaning is unchanged."""
    t = _superscripts(text)
    t = re.sub(r'(\d+(?:\.\d+)?)\s*[x×]\s*10\s*\^\s*(-?\d+)', lambda m: f"{m.group(1)} times ten to the {'minus ' if m.group(2).startswith('-') else ''}{_ordinal(m.group(2).lstrip('-'))}", t)
    t = re.sub(r'\b10\s*\^\s*(-?\d+)', lambda m: f"ten to the {'minus ' if m.group(1).startswith('-') else ''}{_ordinal(m.group(1).lstrip('-'))}", t)
    t = re.sub(r'(\d(?:[\d.]*))\s*[–—-]\s*(\d)', r'\1 to \2', t)         # 0.1–0.3 -> 0.1 to 0.3
    t = re.sub(r'~\s*', 'about ', t)
    t = re.sub(r'≲\s*', 'up to about ', t)
    t = re.sub(r'≳\s*', 'at least about ', t)
    t = re.sub(r'[≈≃]\s*', 'roughly ', t)
    t = t.replace('%', ' percent').replace('&', ' and ').replace('×', ' times ').replace('→', ' to ')
    t = re.sub(r'\be\.g\.', 'for example', t, flags=re.I)
    t = re.sub(r'\bi\.e\.', 'that is', t, flags=re.I)
    t = re.sub(r'\betc\.', 'and so on', t, flags=re.I)
    t = re.sub(r'\bvs\.?\b', 'versus', t, flags=re.I)
    t = re.sub(r'[*_#`]+', '', t)
    return re.sub(r'\s+', ' ', t).strip()


def repair(lines, per_line, threshold=LINE_PASS):
    """Indexes of lines that were not heard well, and replacement text where a spoken-form rewrite helps.

    Returns (failing_indexes, fixes) where fixes maps index -> new text (only lines whose text changed). Failing
    lines without a text fix are still regenerated on the next pass (voice models vary between takes).
    """
    failing = [i for i, share in enumerate(per_line) if share < threshold]
    fixes = {}
    for i in failing:
        new = spoken_form(lines[i])
        if new and new != lines[i]:
            fixes[i] = new
    return failing, fixes
