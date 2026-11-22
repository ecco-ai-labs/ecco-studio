"""Voice bank: role voices (teacher, news anchor, grandmother ...) from real IndicVoices-R speakers.

Runs on the storage pod beside model_sounds.py.

  python3 scripts/voice_bank.py build hindi   # reads voice-bank-hindi.json (the worker's rebuild:voice-bank-hindi result),
                                              # saves one reference clip per role and sex, writes voice_bank.json
  python3 scripts/model_sounds.py run --only Hindi   # then makes and checks the samples in Model Sounds

Source: AI4Bharat IndicVoices-R, CC-BY-4.0 (attribution kept on every clip and sample). Reference clips are kept
out of the library lists; the generated samples are filed under Model Sounds › Human › <sex> › <role> › <language>.
"""
import base64
import json
import sys
import time
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import model_sounds as ms  # noqa: E402

BANK = ms.HOME / 'voice_bank.json'
ATTRIBUTION = 'AI4Bharat IndicVoices-R (CC-BY-4.0)'
# (role in the worker result, sex) -> label in Model Sounds
LABELS = {('Teacher', 'Female'): 'Teacher', ('Teacher', 'Male'): 'Teacher',
          ('News anchor', 'Female'): 'News anchor', ('News anchor', 'Male'): 'News anchor',
          ('Storyteller', 'Female'): 'Storyteller', ('Storyteller', 'Male'): 'Storyteller',
          ('Young parent', 'Female'): 'Young mother', ('Young parent', 'Male'): 'Young father',
          ('Shopkeeper', 'Female'): 'Shopkeeper', ('Shopkeeper', 'Male'): 'Shopkeeper',
          ('Grandparent', 'Female'): 'Grandmother', ('Grandparent', 'Male'): 'Grandfather'}


def load_bank():
    try:
        return json.loads(BANK.read_text())
    except (OSError, ValueError):
        return {}


def build(config):
    result = json.loads((ms.HOME / f'voice-bank-{config}.json').read_text())
    step = next(s for s in result.get('steps', []) if 'roles' in s)
    language = config.capitalize()
    bank = load_bank()
    for key, picks in step['roles'].items():
        role, sex = key.split('|')
        label = LABELS[(role, sex)]
        bank_key = f'{sex}:{label}:{language}'
        if bank_key in bank or not isinstance(picks, list) or not picks:
            print(bank_key, 'kept' if bank_key in bank else 'no speaker found', flush=True)
            continue
        pick = picks[0]
        with urllib.request.urlopen(pick['audio'], timeout=120) as response:
            raw = response.read()
        upload = ms.api('audio/upload', {'data': base64.b64encode(raw).decode(), 'name': f'Voice bank source · {label} · {language}'})
        ref = ms.api('audio/voices/create', {'asset_id': upload['id'], 'character': f'{label} ({sex.lower()}, {language})', 'language': language,
                                            'transcript': (pick.get('text') or '')[:600], 'source': 'upload', 'consent': True, 'clean': True})
        source = {'dataset': ATTRIBUTION, 'speaker_id': pick.get('speaker_id'), 'row': pick.get('row'), 'age_group': pick.get('age_group'),
                  'occupation': pick.get('occupation'), 'district': pick.get('district'), 'state': pick.get('state'), 'snr': pick.get('snr')}
        with ms.LOCK:
            for rid, hide in ((upload['id'], True), (ref['id'], False)):
                asset = ms.record(rid)
                if not asset:
                    continue
                asset['model_sound'] = {'voice_bank_source': True, 'source': source}   # keeps it out of "All audio clips"
                if hide:
                    asset['deleted'], asset['deleted_reason'] = True, 'Voice bank: source clip (the trimmed reference is kept)'
                ms.save(asset)
        bank[bank_key] = {'ref': ref['id'], 'sex': sex, 'label': label, 'language': language, 'source': source, 'made': time.time()}
        BANK.write_text(json.dumps(bank, ensure_ascii=False, indent=1))
        print(bank_key, 'ref', ref['id'], pick.get('speaker_id'), pick.get('age_group'), pick.get('occupation'), flush=True)
    print('voice bank:', len(bank), 'voices')


if __name__ == '__main__':
    if len(sys.argv) == 3 and sys.argv[1] == 'build':
        build(sys.argv[2].lower())
    else:
        print(__doc__)
