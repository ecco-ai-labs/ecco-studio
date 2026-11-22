#!/usr/bin/env python3
"""Story type samples (owner request 21 Nov 2026): every voice in the Model Sounds library reads one line for each
of the 12 Basic story types, in each of its languages.

Runs on the storage pod beside model_sounds.py and reuses its generation, listen-back checks and filing:
    python3 scripts/type_samples.py plan      # count what would be made
    python3 scripts/type_samples.py run       # make what is missing (resumable)
    python3 scripts/type_samples.py report    # summary

Filed in Audio Library under "Type Samples / <Story type> / <voice path> / <language>", each with a model_sound
record (grid "Type Samples", story_type) and its check results. State: /workspace/ecco-type-samples/state.json.
"""
import argparse
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import model_sounds as ms  # noqa: E402

LINES = json.loads((Path(__file__).resolve().parent / 'type_sample_lines.json').read_text())
GENRE = {'Storybook': 'Story Book Reading', 'Audio drama': 'Theatre', 'Podcast': 'Podcast', 'Interview': 'Interview',
         'News': 'News', 'Documentary': 'Documentary', 'Teaching': 'Educational', 'Training': 'Educational',
         'Presentation': 'Educational', 'Marketing': 'Casual Conversation', 'Ambient': 'Story Book Reading',
         'Custom': 'Casual Conversation'}
ROOT = 'Type Samples'
ms.HOME = Path(os.getenv('ECCO_TYPE_SAMPLES_HOME', '/workspace/ecco-type-samples'))
_library_plan = ms.plan


def voices():
    """The library's speaking voices, exactly as model_sounds makes them (humans and talking animals)."""
    return [i for i in _library_plan() if i['kind'] == 'speech']


def plan():
    items = []
    for voice in voices():
        lang = voice['language']
        line = voice['body']['lines'][0]
        for story_type, texts in LINES.items():
            text = texts.get(lang)
            if not text:
                continue
            spoken = {**line, 'text': text}
            name = voice['title'].rsplit(' · ', 1)[0]
            items.append({
                'key': f"type:{story_type}:{voice['key']}", 'kind': 'speech',
                'path': [ROOT, story_type, *voice['path'][1:]],
                'title': f'{story_type} · {name} · {lang}', 'expect': text, 'language': lang,
                'pitch': voice.get('pitch'), 'experimental': voice.get('experimental', False),
                'body': {**voice['body'], 'genre': GENRE[story_type], 'title': f'Type Samples · {story_type} · {name} · {lang}', 'lines': [spoken]},
                'meta': {**voice['meta'], 'grid': ROOT, 'story_type': story_type, 'text': text, 'library_key': voice['key']}})
    return items


_judge = ms.judge


def judge(item, r):
    """Model Sounds' checks, but story lines are longer than the 'Hello, I am…' samples (about 4–14 s)."""
    problems = [p for p in _judge(item, r) if not p.startswith('length')]
    if item['kind'] == 'speech' and not 1.5 <= r.get('seconds', 0) <= 22:
        problems.append(f"length {r.get('seconds')}s")
    return problems


_finish = ms.finish


def finish(item, job, attempt, state, digests):
    """A remake can't fix "same audio as …": two library voices that render identically (Toddler girl and Girl 5
    both use Qwen3 girl-5, and the toddler direction doesn't change it) give the same audio every time. File it
    for a listen straight away instead of spending a second job (found 21 Nov 2026)."""
    asset = ms.record(job['asset_id'])
    dup = digests.get(asset['sha256'])
    if dup and dup != item['key'] and attempt == 1:
        attempt = 2
    return _finish(item, job, attempt, state, digests)


ms.plan = plan
ms.finish = finish
ms.judge = judge
ms.ROOT = ROOT


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('command', choices=['plan', 'run', 'report'])
    parser.add_argument('--limit', type=int)
    parser.add_argument('--only')
    args = parser.parse_args()
    if args.command == 'plan':
        items = plan()
        by_type = {}
        for i in items:
            by_type[i['meta']['story_type']] = by_type.get(i['meta']['story_type'], 0) + 1
        print(len(voices()), 'library voices;', len(items), 'samples', json.dumps(by_type))
    elif args.command == 'run':
        ms.run(limit=args.limit, only=args.only)
    else:
        ms.report()


if __name__ == '__main__':
    main()
