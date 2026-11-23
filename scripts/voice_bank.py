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
import subprocess
import tempfile
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
        if key.startswith('_'):
            continue
        role, sex = key.split('|')
        label = LABELS[(role, sex)]
        bank_key = f'{sex}:{label}:{language}'
        if bank_key in bank or not isinstance(picks, list) or not picks:
            print(bank_key, 'kept' if bank_key in bank else 'no speaker found', flush=True)
            continue
        used = {e.get('source', {}).get('speaker_id') for e in bank.values() if isinstance(e, dict)} | set(bank.get('_rejected_speakers', []))
        pick = next((p for p in picks if p.get('speaker_id') not in used), None)
        if not pick:
            print(bank_key, 'no new speaker (all candidates used or rejected)', flush=True)
            continue
        with urllib.request.urlopen(pick['audio'], timeout=120) as response:
            raw = response.read()
        if label in ('Grandmother', 'Grandfather'):
            raw = aged(raw)   # owner: grandparents did not sound old; a light tremble and slower pace on the reference
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


AGE_LABEL = {'18-30': 'Age 18–30', '30-45': 'Age 30–45', '45-60': 'Age 45–60', '60+': 'Age 60+'}
FROM_LINE = {'Hindi': 'नमस्ते, मैं {} से हूँ। आपको मेरी आवाज़ कैसी लगी?',
             # IndicF5 has no Urdu; spoken Urdu and Hindi share sounds, so the Urdu line is written in Devanagari for the model
             'Urdu': 'आदाब, मैं {} से हूँ। आपको मेरी आवाज़ कैसी लगी?'}
FROM_LINE_NO_PLACE = {'Hindi': 'नमस्ते, आपको मेरी आवाज़ कैसी लगी?', 'Urdu': 'आदाब, आपको मेरी आवाज़ कैसी लगी?'}
TTS_LANGUAGE = {'Urdu': 'Hindi'}
HINDI_PLACE = {'Balaghat': 'बालाघाट', 'Bhadohi': 'भदोही', 'Bhopal': 'भोपाल', 'Darbhanga': 'दरभंगा', 'Gwalior': 'ग्वालियर', 'Jaipur': 'जयपुर',
               'Jodhpur': 'जोधपुर', 'Karauli': 'करौली', 'Katni': 'कटनी', 'Mirzapur': 'मिर्ज़ापुर', 'Sonbhadra': 'सोनभद्र', 'Varanasi': 'वाराणसी',
               'Patna': 'पटना', 'Lucknow': 'लखनऊ', 'Indore': 'इंदौर', 'Muzaffarpur': 'मुज़फ़्फ़रपुर', 'Gaya': 'गया', 'Ajmer': 'अजमेर',
               'Hyderabad': 'हैदराबाद', 'Aurangabad': 'औरंगाबाद', 'Rampur': 'रामपुर', 'Aligarh': 'अलीगढ़', 'Moradabad': 'मुरादाबाद',
               'Srinagar': 'श्रीनगर', 'Malegaon': 'मालेगांव', 'Gulbarga': 'गुलबर्गा', 'Kalaburagi': 'कलबुर्गी', 'Bidar': 'बीदर',
               'Kurnool': 'कुर्नूल', 'Nanded': 'नांदेड़', 'Kolkata': 'कोलकाता', 'Mumbai': 'मुंबई', 'Delhi': 'दिल्ली', 'Bijapur': 'बीजापुर',
               'Vijayapura': 'विजयपुरा', 'Hubli': 'हुबली', 'Dharwad': 'धारवाड़', 'Mysore': 'मैसूर', 'Bangalore': 'बैंगलोर', 'Bengaluru': 'बेंगलुरु',
               'Saharanpur': 'सहारनपुर', 'Meerut': 'मेरठ', 'Bareilly': 'बरेली', 'Azamgarh': 'आज़मगढ़', 'Kishanganj': 'किशनगंज',
               'Purnia': 'पूर्णिया', 'Murshidabad': 'मुर्शिदाबाद', 'Nagpur': 'नागपुर', 'Pune': 'पुणे', 'Thane': 'ठाणे', 'Raichur': 'रायचूर',
               'Anantnag': 'अनंतनाग', 'Baramulla': 'बारामूला', 'Jammu': 'जम्मू', 'Poonch': 'पुंछ', 'Rajouri': 'राजौरी', 'Kupwara': 'कुपवाड़ा'}


def merge_wide(config):
    """Join the per-group hub results (voice-bank-hub-<config>-*.json) into voice-bank-wide-<config>.json."""
    groups = {}
    for part in sorted(ms.HOME.glob(f'voice-bank-hub-{config}-*.json')):
        result = json.loads(part.read_text())
        for step in result.get('steps', []):
            if isinstance(step.get('groups'), dict):
                groups.update(step['groups'])
            elif step.get('error'):
                print(part.name, step['error'][:200], flush=True)
    (ms.HOME / f'voice-bank-wide-{config}.json').write_text(json.dumps({'steps': [{'groups': groups}]}, ensure_ascii=False))
    print({k: len(v) for k, v in groups.items()})


def build_wide(config):
    """Many speakers: Model Sounds › Human › <sex> › Hindi voices › <age> › <language>, one sample each saying where they are from."""
    result = json.loads((ms.HOME / f'voice-bank-wide-{config}.json').read_text())
    step = next(s for s in result.get('steps', []) if 'groups' in s)
    language = config.capitalize()
    bank = load_bank()
    used = {e.get('source', {}).get('speaker_id') for e in bank.values() if isinstance(e, dict)} | set(bank.get('_rejected_speakers', []))
    for key, picks in step['groups'].items():
        if not isinstance(picks, list):
            print(key, picks, flush=True)
            continue
        sex, age = key.split('|')
        for n, pick in enumerate((p for p in picks if p.get('speaker_id') not in used), 1):
            district = (pick.get('district') or 'India').strip()
            bank_key = f'{sex}:{language} voices:{AGE_LABEL[age]}:{n:02d}:{language}'
            if bank_key in bank:
                continue
            try:
                if pick.get('audio_b64'):
                    raw = base64.b64decode(pick['audio_b64'])
                else:
                    with urllib.request.urlopen(pick['audio'], timeout=120) as response:
                        raw = response.read()
                title = f'{language} {sex.lower()} {n:02d} · {age} · {district}'
                upload = ms.api('audio/upload', {'data': base64.b64encode(raw).decode(), 'name': 'Voice bank source · ' + title})
                ref = ms.api('audio/voices/create', {'asset_id': upload['id'], 'character': title[:80], 'language': language,
                                                    'transcript': (pick.get('text') or '')[:600], 'source': 'upload', 'consent': True, 'clean': True})
            except Exception as exc:
                print(bank_key, 'failed', str(exc)[:120], flush=True)
                continue
            source = {'dataset': ATTRIBUTION, 'speaker_id': pick.get('speaker_id'), 'row': pick.get('row'), 'age_group': age,
                      'occupation': pick.get('occupation'), 'district': district, 'state': pick.get('state'), 'snr': pick.get('snr'),
                      'speaking_rate': pick.get('speaking_rate'), 'pitch': pick.get('utterance_pitch_mean')}
            with ms.LOCK:
                for rid, hide in ((upload['id'], True), (ref['id'], False)):
                    asset = ms.record(rid)
                    if asset:
                        asset['model_sound'] = {'voice_bank_source': True, 'source': source}
                        if hide:
                            asset['deleted'], asset['deleted_reason'] = True, 'Voice bank: source clip (the trimmed reference is kept)'
                        ms.save(asset)
            used.add(pick.get('speaker_id'))
            bank[bank_key] = {'ref': ref['id'], 'sex': sex, 'label': f'{language} voices', 'language': language, 'source': source, 'made': time.time(),
                              'path': [ms.ROOT, 'Human', sex, f'{language} voices', AGE_LABEL[age], f'{n:02d} · {district}'],
                              'title': f'{sex} {n:02d} · {age} · {district}', 'tts_language': TTS_LANGUAGE.get(language, language),
                              'text': FROM_LINE[language].format(HINDI_PLACE[district]) if district in HINDI_PLACE else FROM_LINE_NO_PLACE[language]}
            BANK.write_text(json.dumps(bank, ensure_ascii=False, indent=1))
            print(bank_key, district, pick.get('occupation'), flush=True)
    print('voice bank:', sum(1 for v in bank.values() if isinstance(v, dict)), 'voices')


def aged(raw):
    with tempfile.TemporaryDirectory() as d:
        src, out = Path(d) / 'in.wav', Path(d) / 'out.wav'
        src.write_bytes(raw)
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', str(src), '-af', 'vibrato=f=5.5:d=0.12,atempo=0.94', str(out)], check=True)
        return out.read_bytes()


def reject(keys):
    """Remove rejected role voices: sample and reference leave the library; the speaker is not picked again."""
    bank, state = load_bank(), ms.load_state()
    rejected = set(bank.get('_rejected_speakers', []))
    for key in keys:                     # e.g. Female:Grandmother:Hindi
        entry = bank.pop(key, None)
        sample = state.pop('human:' + key, None)
        with ms.LOCK:
            for rid in [x for x in ((sample or {}).get('asset_id'), (entry or {}).get('ref')) if x]:
                asset = ms.record(rid)
                if asset:
                    asset['deleted'], asset['deleted_reason'] = True, 'Model Sounds: rejected by owner (voice bank)'
                    ms.save(asset)
        if entry:
            rejected.add(entry.get('source', {}).get('speaker_id'))
        print(key, 'removed' if entry or sample else 'not found', flush=True)
    bank['_rejected_speakers'] = sorted(x for x in rejected if x)
    BANK.write_text(json.dumps(bank, ensure_ascii=False, indent=1))
    ms.write_state(state)


if __name__ == '__main__':
    if len(sys.argv) == 3 and sys.argv[1] == 'build':
        build(sys.argv[2].lower())
    elif len(sys.argv) == 3 and sys.argv[1] == 'merge-wide':
        merge_wide(sys.argv[2].lower())
    elif len(sys.argv) == 3 and sys.argv[1] == 'build-wide':
        build_wide(sys.argv[2].lower())
    elif len(sys.argv) > 2 and sys.argv[1] == 'reject':
        reject(sys.argv[2:])
    else:
        print(__doc__)
