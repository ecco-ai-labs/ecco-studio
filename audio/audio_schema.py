"""Portable audio request validation. No storage, API or GPU ownership."""
import math
import json
import re
from audio_routing import worker_id
from pathlib import Path

MODELS = {m['id']: m for m in json.loads(Path(__file__).with_name('model_catalog.json').read_text())}

LANGUAGES = ['Hindi', 'Urdu', 'English', 'Tamil', 'Punjabi', 'Assamese', 'Bengali', 'Bodo', 'Dogri', 'Gujarati', 'Kannada', 'Kashmiri', 'Konkani', 'Maithili', 'Malayalam', 'Manipuri', 'Marathi', 'Nepali', 'Odia', 'Sanskrit', 'Santali', 'Sindhi', 'Telugu']
INDIC_EMOTIONS = ['neutral', 'happy', 'sad', 'angry', 'disgust', 'fear', 'surprise']
ENGLISH_EMOTIONS = ['neutral', 'happy', 'sad', 'angry', 'enunciated', 'confused', 'whisper']
GENRES = ["Story Book Reading","Podcast","Movie","Theatre","Casual Conversation","Documentary","News","Interview","Educational"]
MODEL = 'SPRINGLab/Indic-Mio'
def required_models(request):
    return {line.get('model', request.get('model', 'indic-mio')) for line in request.get('lines', [])} or {request.get('model', 'indic-mio')}

# Character voice references (2026-11-09): copying models can speak with a saved clip.
REF_MODELS = ('chatterbox', 'indicf5', 'voxcpm2', 'qwen3-tts')
DESIGN_MODELS = ('voxcpm2', 'indic-parler', 'qwen3-tts')
SLUG = re.compile(r'^[a-z][a-z0-9-]{0,31}$')
HEX32 = re.compile(r'^[0-9a-f]{32}$')
# A line's delivery picks the palette clip; these are the nearest palette names for each delivery.
DELIVERY_ALIASES = {'neutral': ['default', 'calm'], 'happy': ['warm', 'happy', 'laughing', 'excited'],
                    'whisper': ['whispering', 'whisper', 'hushed', 'suspenseful'], 'fear': ['scared', 'fear', 'suspenseful'],
                    'sad': ['sad', 'tender'], 'angry': ['angry', 'sulky'], 'surprise': ['excited', 'surprised'],
                    'disgust': ['angry'], 'confused': ['confused'], 'enunciated': ['default', 'calm']}


def pick_from_palette(palette, delivery):
    for key in [delivery, *DELIVERY_ALIASES.get(delivery, []), 'default']:
        if key in palette:
            return palette[key]
    return next(iter(palette.values()))


def clean_palette(value):
    if not isinstance(value, dict) or not 1 <= len(value) <= 12:
        raise ValueError('A character voice palette needs 1–12 clips.')
    for key, aid in value.items():
        if not isinstance(key, str) or not SLUG.match(key) or not isinstance(aid, str) or not HEX32.match(aid):
            raise ValueError('Invalid character voice palette.')
    return dict(value)


def clean_voice_refs(value):
    if not isinstance(value, dict) or len(value) > 200:
        raise ValueError('Invalid character voice references.')
    out = {}
    for rid, item in value.items():
        if not isinstance(rid, str) or not HEX32.match(rid) or not isinstance(item, dict):
            raise ValueError('Invalid character voice reference.')
        sha = item.get('sha256')
        if not isinstance(sha, str) or not re.fullmatch(r'[0-9a-f]{64}', sha):
            raise ValueError('Invalid character voice checksum.')
        clean = {'sha256': sha}
        for key, limit in (('transcript', 600), ('language', 40), ('emotion', 32), ('character', 80), ('path', 300), ('url', 1200)):
            if key in item:
                if not isinstance(item[key], str) or len(item[key]) > limit:
                    raise ValueError('Invalid character voice reference field: ' + key)
                clean[key] = item[key]
        if 'path' in clean and not clean['path'].startswith('/api/voice-refs/' + rid):
            raise ValueError('Invalid character voice reference path.')
        if 'url' in clean and not clean['url'].startswith('https://'):
            raise ValueError('Character voice clips must be fetched over HTTPS.')
        if 'expires' in item:
            if isinstance(item['expires'], bool) or not isinstance(item['expires'], int):
                raise ValueError('Invalid character voice link expiry.')
            clean['expires'] = item['expires']
        out[rid] = clean
    return out


BRIEF_FIELDS = ('audience', 'genre', 'tone', 'narration_style', 'language_style', 'language_style_instructions', 'purpose')

def performance_direction(request, line):
    brief = request.get('performance_brief', {})
    labels = {'audience': 'Audience', 'genre': 'Genre', 'tone': 'Tone', 'narration_style': 'Narration style', 'language_style': 'Language style', 'language_style_instructions': 'Language guidance', 'purpose': 'Listening goal'}
    return '. '.join([labels[k] + ': ' + brief[k] for k in BRIEF_FIELDS if brief.get(k)] + [line.get('direction', '')]).strip('. ')

def validate(body):
    if not isinstance(body, dict):
        raise ValueError('Invalid audio request.')
    model_id = body.get('model', 'indic-mio')
    if not isinstance(model_id, str) or model_id not in MODELS:
        raise ValueError('Choose a supported audio model.')
    model = MODELS[model_id]
    compute = body.get('compute', 'cpu')
    if not isinstance(compute, str) or compute not in ('a100', 'cpu', 'b200'):
        raise ValueError('Choose a supported audio compute target.')
    genre = body.get('genre', GENRES[0])
    if genre not in GENRES:
        raise ValueError('Choose a supported audio genre.')
    lines = body.get('lines')
    if not isinstance(lines, list) or not lines:
        raise ValueError('Add at least one dialogue line.')
    clean = []
    for line in lines:
        if not isinstance(line, dict):
            raise ValueError('Invalid dialogue line.')
        line_model = line.get('model', model_id)
        if not isinstance(line_model, str) or line_model not in MODELS:
            raise ValueError('Choose a supported character audio model.')
        model = MODELS[line_model]
        text = line.get('text', '')
        language = line.get('language', 'Hindi')
        emotion = line.get('emotion', 'neutral')
        voices = [v for v in model['voices'] if not v.get('language') or v['language'] == language]
        voice = line.get('voice', voices[0]['id'] if voices else '')
        if 'palette' in line:
            delivery = line.get('delivery', 'neutral')
            if not isinstance(delivery, str) or not SLUG.match(delivery):
                raise ValueError('Invalid line delivery.')
            voice = 'ref:' + pick_from_palette(clean_palette(line['palette']), delivery)
        custom = isinstance(voice, str) and bool(re.fullmatch(r'ref:[0-9a-f]{32}', voice))
        if custom and line_model not in REF_MODELS:
            raise ValueError(model['name'] + ' cannot speak with a saved character voice. Choose Chatterbox, IndicF5 or VoxCPM2.')
        if not isinstance(text, str) or not 1 <= len(text.strip()) <= 500:
            raise ValueError('Each line needs 1–500 characters.')
        # [Directions] are instructions, never words: a line that still contains one is refused so it can't be read aloud.
        if '[' in text or ']' in text:
            raise ValueError('A line still contains a [direction] in its spoken words. Directions must be sent separately, never spoken.')
        if language not in model['languages']:
            raise ValueError('Choose a language supported by ' + model['name'] + '.')
        allowed_emotions = (ENGLISH_EMOTIONS if language == 'English' else INDIC_EMOTIONS) if model['emotions'] else ['neutral']
        if emotion not in allowed_emotions:
            raise ValueError('This emotion is not supported for the selected language.')
        if not custom and voice not in [v['id'] for v in voices]:
            raise ValueError('Choose an available voice for this model and language.')
        clean.append(dict(text=text.strip(), language=language, emotion=emotion, voice=voice))
        if line.get('design') is True:
            if line_model not in DESIGN_MODELS or not isinstance(body.get('voice_design'), dict):
                raise ValueError('Only a voice design request can describe a new voice.')
            clean[-1]['design'] = True
        if 'model' in line:
            clean[-1]['model'] = line_model
        if (model.get('voice_direction') or clean[-1].get('design')) and 'direction' in line:
            direction = line['direction']
            if not isinstance(direction, str) or len(direction) > 1200:
                raise ValueError('Keep character speaking direction within 1,200 characters.')
            clean[-1]['direction'] = direction.strip()
        controls = {'speed': (.75, 1.5), 'pitch': (-4, 4)}
        if line_model == 'chatterbox':
            controls.update(exaggeration=(0, 2), cfg_weight=(0, 1))
        for key, (low, high) in controls.items():
            if key in line:
                value = line[key]
                if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not low <= value <= high:
                    raise ValueError(f'Character {key} must be between {low} and {high}.')
                clean[-1][key] = value
        if 'pause_before' in line:
            pause = line['pause_before']
            if isinstance(pause, bool) or not isinstance(pause, (int, float)) or not math.isfinite(pause) or not 0 <= pause <= 10:
                raise ValueError('pause_before must be between 0 and 10 seconds.')
            clean[-1]['pause_before'] = pause
    def bounded(key, default, low, high):
        value = body.get(key, default)
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not low <= value <= high:
            raise ValueError(f'{key} must be between {low} and {high}.')
        return value
    title = body.get('title', 'Audio recording')
    if not isinstance(title, str):
        raise ValueError('Invalid audio title.')
    result = dict(model=model_id, compute=compute, genre=genre, title=title.strip()[:160] or 'Audio recording', lines=clean,
                speed=bounded('speed', 1, 0.75, 1.5), pitch=bounded('pitch', 0, -4, 4),
                pause=bounded('pause', 0.35, 0, 2))
    if 'performance_brief' in body:
        brief = body['performance_brief']
        if not isinstance(brief, dict):
            raise ValueError('Invalid narration directions.')
        result['performance_brief'] = {}
        for key in BRIEF_FIELDS:
            value = brief.get(key, '')
            if not isinstance(value, str) or len(value) > (1000 if key in ('language_style_instructions', 'purpose') else 200):
                raise ValueError('Invalid narration direction: ' + key)
            if value.strip():
                result['performance_brief'][key] = value.strip()
    if worker_id(body.get('worker_id')):
        result['worker_id'] = worker_id(body['worker_id'])
    if model_id == 'chatterbox':
        result['exaggeration'] = bounded('exaggeration', .5, 0, 2)
    if any(any(key in line for key in ('speed', 'pitch', 'exaggeration', 'cfg_weight')) for line in clean):
        result['character_controls_version'] = 1
    if len(clean) > 80 or sum(len(line['text']) for line in clean) > 4000:
        result['long_form_version'] = 1
    if required_models(result) != {model_id}:
        result['mixed_models_version'] = 1
    refs = sorted({line['voice'][4:] for line in clean if line['voice'].startswith('ref:')})
    if refs:
        result['voice_refs_version'] = 1
        if 'voice_refs' in body:
            result['voice_refs'] = clean_voice_refs(body['voice_refs'])
            if any(r not in result['voice_refs'] for r in refs):
                raise ValueError('A character voice is missing from the request.')
    if 'voice_design' in body:
        design = body['voice_design']
        if not isinstance(design, dict) or len(clean) != 1 or not clean[0].get('design'):
            raise ValueError('A voice design request has exactly one described line.')
        result['voice_design'] = {}
        for key, limit in (('character', 80), ('character_id', 64), ('emotion', 32), ('description', 1200), ('transcript', 600), ('language', 40)):
            value = design.get(key, '')
            if not isinstance(value, str) or len(value) > limit:
                raise ValueError('Invalid voice design field: ' + key)
            result['voice_design'][key] = value.strip()
        if not result['voice_design']['character'] or not result['voice_design']['description']:
            raise ValueError('Name the character and describe the voice.')
        if not SLUG.match(result['voice_design']['emotion'] or 'default'):
            raise ValueError('Invalid voice palette name.')
        result['voice_design']['emotion'] = result['voice_design']['emotion'] or 'default'
    if body.get('soundtrack') or body.get('sound_design_version'):
        from audio_soundtrack import validate_tracks
        if body.get('sound_design_version') != 1:
            raise ValueError('Unsupported sound design version.')
        result['soundtrack'] = validate_tracks(body.get('soundtrack'), len(clean))
        result['sound_design_version'] = 1
    return result




