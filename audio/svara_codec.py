"""Prompt and audio-token helpers for svara-TTS (Orpheus-style tokens decoded by SNAC 24 kHz).

Token layout follows the published svara-TTS ONNX/OpenVINO model cards
(https://huggingface.co/shreyask/svara-tts-v1-ONNX,
https://huggingface.co/kenpath/svara-tts-v1-openvino-int4). Pure functions so they
can be unit-tested without torch or model weights.
"""

START_OF_HUMAN = 128259
BOS = 128000
END_OF_TEXT = 128009
END_OF_HUMAN = 128260
START_OF_SPEECH = 128257
END_OF_SPEECH = 128258
AUDIO_TOKENS_START = 128266
CODEBOOK = 4096
SAMPLE_RATE = 24000

# Our line emotions → svara style tags (appended at the end of the sentence).
EMOTION_TAGS = {'happy': '<happy>', 'sad': '<sad>', 'angry': '<anger>', 'fear': '<fear>', 'enunciated': '<clear>'}


def tagged_text(text, emotion='neutral'):
    tag = EMOTION_TAGS.get(emotion or 'neutral')
    return text.strip() + (' ' + tag if tag else '')


def prompt_ids(encode, speaker, text):
    """encode: callable(str) -> list[int] without special tokens (tokenizer.encode(..., add_special_tokens=False))."""
    return [START_OF_HUMAN, BOS, *encode(speaker + ': ' + text), END_OF_TEXT, END_OF_HUMAN]


def snac_codes(generated):
    """Split generated token ids into the three SNAC code levels.

    Tokens before START_OF_SPEECH are ignored; decoding stops at END_OF_SPEECH.
    Each frame is 7 tokens: level 0 ← position 0; level 1 ← 1, 4; level 2 ← 2, 3, 5, 6.
    """
    tokens = list(generated)
    if START_OF_SPEECH in tokens:
        tokens = tokens[tokens.index(START_OF_SPEECH) + 1:]
    if END_OF_SPEECH in tokens:
        tokens = tokens[:tokens.index(END_OF_SPEECH)]
    audio = [t for t in tokens if t >= AUDIO_TOKENS_START]
    audio = audio[:len(audio) // 7 * 7]
    codes = [[], [], []]
    for start in range(0, len(audio), 7):
        frame = [audio[start + i] - AUDIO_TOKENS_START - i * CODEBOOK for i in range(7)]
        if any(not 0 <= c < CODEBOOK for c in frame):
            raise ValueError('svara-TTS returned an out-of-range audio token.')
        codes[0].append(frame[0])
        codes[1] += [frame[1], frame[4]]
        codes[2] += [frame[2], frame[3], frame[5], frame[6]]
    if not codes[0]:
        raise ValueError('svara-TTS returned no audio frames.')
    return codes
