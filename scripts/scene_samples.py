#!/usr/bin/env python3
"""Model Generated Content (owner request, 22 Nov 2026): one ~10 s English recording per Basic story type,
every character in a different Voice Library (Model Sounds) voice.

Runs on the storage pod next to the storage service, reusing model_sounds.py for Serverless jobs and checks:
    python3 scripts/scene_samples.py run      # make what is missing, check, file under "Model Generated Content"
    python3 scripts/scene_samples.py plan     # show the cast and words
    python3 scripts/scene_samples.py report

Each scene is one audio job with one line per turn (mixed models when the cast spans models). Checks: 8.5–12.5 s,
not silent or clipped, Whisper listen-back must hear the words (>= 0.75). A failed take is made once more; nothing is
deleted or trashed by this script; a failed first take is left unlabelled and listed in the report.
"""
import argparse
import json
import os
import sys
import time
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT_DIR))
import model_sounds as ms  # noqa: E402

HOME = Path(os.getenv('ECCO_SCENE_SAMPLES_HOME', '/workspace/ecco-scene-samples'))
LABEL = 'Model Generated Content'

# (story type, genre, [(voice type in the Voice Library, sex, words), ...])
SCENES = [
    ('Podcast', 'Podcast', [
        ('Podcast host', 'Female', "Welcome back to Small Wonders! Today: why do cats knead blankets?"),
        ('Podcast host', 'Male', "Wait, they're not just making biscuits?"),
        ('Podcast host', 'Female', "Kind of! It starts when they're kittens.")]),
    ('Interview', 'Podcast', [
        ('Woman (30s–40s)', 'Female', "Mr. Patel, what was this town like fifty years ago?"),
        ('Grandfather', 'Male', "Quiet. One bus a day, and everyone waved."),
        ('Young woman (20s)', 'Female', "Now there are three coffee shops on his street!")]),
    ('Teaching', 'Podcast', [
        ('Teacher', 'Female', "Good morning, class. Today we'll learn why the sky looks blue. Sunlight holds every colour of the rainbow, and tiny bits of air scatter blue light the most.")]),
    ('News', 'Podcast', [
        ('News anchor', 'Male', "Good evening. The city council has approved a new riverside park, with walking trails and a playground. Work begins next spring, and it should open in two years.")]),
    ('Narrated Story', 'Story Book Reading', [
        ('Grandmother', 'Female', "Deep in the forest, Mia found an owl sitting on her bicycle."),
        ('Girl (about 9)', 'Female', "Excuse me, that's my seat!"),
        ('Grumpy', 'Animal', "Finders keepers, little one.")]),
    ('Documentary', 'Podcast', [
        ('Documentary narrator', 'Male', "Every spring, millions of monarch butterflies fly thousands of miles north. No single butterfly finishes the trip. It takes four generations.")]),
    ('Audio Drama', 'Story Book Reading', [
        ('Man (30s–40s)', 'Male', "The lights went out at nine. Who was in the hallway?"),
        ('Young woman (20s)', 'Female', "Not me. I was upstairs."),
        ('Teen boy', 'Male', "I saw someone with a torch, near the stairs.")]),
    ('Training', 'Podcast', [
        ('Young man (20s)', 'Male', "Before you lift a heavy box, plant your feet shoulder-width apart, bend your knees and keep your back straight. Hold it close, and lift with your legs, not your back.")]),
    ('Presentation', 'Podcast', [
        ('Woman (30s–40s)', 'Female', "Good morning, and thank you all for coming. This quarter, our team cut delivery times by twenty percent. Let me walk you through exactly how we did it.")]),
    ('Marketing', 'Podcast', [
        ('Boy (about 10)', 'Male', "Mum, these pancakes are amazing!"),
        ('News anchor', 'Female', "Sunny Morning pancake mix. Fluffy pancakes in five minutes. Find it at your local store today.")]),
    ('Ambient', 'Story Book Reading', [
        ('Wise elder', 'Male', "Breathe in slowly. Feel the cool air. Now breathe out, and let your shoulders soften. Listen to the quiet around you.")]),
    ('Custom', 'Podcast', [
        ('Teen girl', 'Female', "Grandpa, will you teach me how to make your famous mango pickle this weekend?"),
        ('Grandfather', 'Male', "Only if you promise to keep the secret recipe in the family forever!")]),
]


def library_voices():
    """English Voice Library voices from the live records: (voice type, sex) -> line settings."""
    found = {}
    with ms.db() as con:
        for (body,) in con.execute("SELECT body FROM records WHERE kind='asset'"):
            rec = json.loads(body)
            m = rec.get('model_sound')
            if rec.get('deleted') or not m or m.get('language') != 'English' or not m.get('voice'):
                continue
            sex = 'Animal' if m.get('grid') == 'Animals' else m.get('sex')
            line = (m.get('lines') or [{}])[0]
            found[(m.get('voice_type'), sex)] = {'model': m.get('model'), 'voice': m.get('voice'), 'direction': line.get('direction') or m.get('direction'),
                                                 'status': (m.get('checks') or {}).get('status')}
    return found


def plan():
    voices, items = library_voices(), []
    for story, genre, turns in SCENES:
        lines, cast = [], {}
        for who, sex, text in turns:
            v = voices.get((who, sex)) or next((x for (vt, s), x in voices.items() if s == sex and str(vt).startswith(who)), None)
            if not v:
                raise SystemExit(f'No English Voice Library voice for {who} ({sex})')
            line = {'text': text, 'voice': v['voice'], 'language': 'English', 'model': v['model'], 'emotion': 'neutral'}
            if v.get('direction'):
                line['direction'] = v['direction']
            lines.append(line)
            cast[f'{who} ({sex})' if sex != 'Animal' else f'{who} talking animal'] = f"{v['model']} · {v['voice']}"
        models = [l['model'] for l in lines]
        main = max(set(models), key=models.count)
        body = {'model': main, 'compute': ms.COMPUTE, 'genre': genre, 'pause': 0.35, 'title': f'{LABEL} · {story}', 'lines': lines}
        if len(set(models)) > 1:
            body['mixed_models_version'] = 1
        n = len(cast)
        items.append({'key': 'scene:' + story, 'kind': 'scene', 'title': f"{story} · {n} voice{'s' if n > 1 else ''}", 'story': story, 'cast': cast,
                      'expect': ' '.join(t for _, _, t in turns), 'body': body})
    return items


def check(item, asset):
    path = ms.DATA / asset['path']
    samples = ms.pcm(path)
    seconds = round(len(samples) / 8000, 2)
    asset['duration'] = asset['seconds'] = seconds
    mean, peak = ms.levels(path)
    heard = ms.listen(path, asset['sha256']).get('text', '')
    r = {'seconds': seconds, 'mean_db': mean, 'peak_db': peak, 'heard': heard[:400], 'words_match': ms.similar(heard, item['expect'])}
    problems = []
    if mean < -55:
        problems.append('silent')
    if peak >= -0.01:
        problems.append('clipped')
    if not 8.5 <= seconds <= 12.5:
        problems.append(f'length {seconds}s')
    if r['words_match'] < 0.75:
        problems.append(f"words do not match ({r['words_match']})")
    r['problems'] = problems
    return r


def load_state():
    try:
        return json.loads((HOME / 'state.json').read_text())
    except (OSError, ValueError):
        return {}


def write_state(state):
    HOME.mkdir(parents=True, exist_ok=True)
    (HOME / 'state.json.tmp').write_text(json.dumps(state, ensure_ascii=False, indent=1))
    (HOME / 'state.json.tmp').replace(HOME / 'state.json')


def file(item, asset, results, status):
    asset['title'] = item['title']
    asset['scene_sample'] = {'story_type': item['story'], 'cast': item['cast'], 'text': item['expect'], 'lines': item['body']['lines'],
                             'checks': {'status': status, **results}, 'made': time.time()}
    ms.save(asset)
    ms.api('audio/labels', {'asset_id': asset['id'], 'title': item['title'], 'folder_ids': [ms.folder([LABEL])]})


def run(only=None, redo=()):
    state = load_state()
    for story in redo:
        old = state.pop('scene:' + story, {})
        for take in old.get('takes', []):
            try:
                ms.api('library/labels/remove', {'library': 'audio', 'item_id': take['asset_id'], 'folder_id': ms.folder([LABEL])})
            except RuntimeError as exc:
                print('could not unlabel', take['asset_id'], exc, flush=True)
        state.setdefault('replaced', []).extend(t['asset_id'] for t in old.get('takes', []))
    write_state(state)
    todo = [(i, 1) for i in plan() if (not only or only.lower() in i['key'].lower()) and state.get(i['key'], {}).get('status') not in ('passed', 'needs_listen')]
    print(f'{len(todo)} scenes to make', flush=True)
    flight = {}
    while todo or flight:
        while todo and len(flight) < ms.IN_FLIGHT:
            item, attempt = todo.pop(0)
            try:
                job = ms.api('audio/generate', item['body'])
                flight[job['id']] = (item, attempt, time.time())
            except RuntimeError as exc:
                if str(exc).startswith('429'):
                    todo.insert(0, (item, attempt))
                    break
                state.setdefault(item['key'], {}).update(status='failed', error=str(exc)[:300])
                print('FAILED to submit', item['key'], exc, flush=True)
        time.sleep(5)
        for jid, (item, attempt, began) in list(flight.items()):
            try:
                job = ms.api('audio/jobs/' + jid)
            except RuntimeError as exc:
                print('status error', item['key'], exc, flush=True)
                continue
            entry = state.setdefault(item['key'], {})
            if job['status'] == 'done' and job.get('asset_id'):
                del flight[jid]
                asset = ms.record(job['asset_id'])
                try:
                    results = check(item, asset)
                except Exception as exc:
                    results = {'problems': ['check failed: ' + str(exc)[:200]]}
                entry.setdefault('takes', []).append({'asset_id': asset['id'], 'results': results})
                if results['problems'] and attempt == 1:
                    ms.save(asset)                       # kept, unlabelled; listed in the report
                    todo.append((item, 2))
                    entry['status'] = 'remake'
                else:
                    takes = entry['takes']
                    best = min(takes, key=lambda t: (len(t['results'].get('problems', [])), -t['results'].get('words_match', 0)))
                    status = 'needs_listen' if best['results'].get('problems') else 'passed'
                    file(item, ms.record(best['asset_id']), best['results'], status)
                    entry.update(status=status, asset_id=best['asset_id'])
                print(item['key'], attempt, entry['status'], results.get('seconds'), results.get('words_match'), results.get('problems'), flush=True)
            elif job['status'] in ('error', 'cancelled') or time.time() - began > 1800:
                del flight[jid]
                if attempt == 1:
                    todo.append((item, 2))
                    entry['status'] = 'remake'
                else:
                    entry.update(status='failed', error=(job.get('error') or 'timed out')[:300])
                print(item['key'], 'job', job['status'], (job.get('error') or '')[:160], flush=True)
            write_state(state)
    write_state(state)
    report()


def report():
    state = load_state()
    for item in plan():
        e = state.get(item['key'], {})
        best = next((t for t in e.get('takes', []) if t['asset_id'] == e.get('asset_id')), {})
        r = best.get('results', {})
        extra = [t['asset_id'] for t in e.get('takes', []) if t['asset_id'] != e.get('asset_id')]
        print(f"{item['title']:<24} {e.get('status', 'todo'):<12} {r.get('seconds', '')}s match {r.get('words_match', '')} {r.get('problems', '')}"
              f"{' unlabelled take: ' + ','.join(extra) if extra else ''} {e.get('error', '')}")


def main():
    p = argparse.ArgumentParser()
    p.add_argument('cmd', choices=['run', 'plan', 'report'])
    p.add_argument('--only')
    p.add_argument('--redo', default='', help='comma-separated story types to make again')
    a = p.parse_args()
    if a.cmd == 'plan':
        for i in plan():
            print(i['title'], json.dumps(i['cast'], ensure_ascii=False), '|', i['expect'], '| words', len(i['expect'].split()))
    elif a.cmd == 'run':
        run(a.only, [x.strip() for x in a.redo.split(',') if x.strip()])
    else:
        report()


if __name__ == '__main__':
    main()
