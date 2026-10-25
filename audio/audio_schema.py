"""Portable audio request validation. No storage, API or GPU ownership."""
import math
import json
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
    if not isinstance(lines, list) or not 1 <= len(lines) <= 80:
        raise ValueError('Add between 1 and 80 dialogue lines.')
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
        if not isinstance(text, str) or not 1 <= len(text.strip()) <= 500:
            raise ValueError('Each line needs 1–500 characters.')
        if language not in model['languages']:
            raise ValueError('Choose a language supported by ' + model['name'] + '.')
        allowed_emotions = (ENGLISH_EMOTIONS if language == 'English' else INDIC_EMOTIONS) if model['emotions'] else ['neutral']
        if emotion not in allowed_emotions:
            raise ValueError('This emotion is not supported for the selected language.')
        if voice not in [v['id'] for v in voices]:
            raise ValueError('Choose an available voice for this model and language.')
        clean.append(dict(text=text.strip(), language=language, emotion=emotion, voice=voice))
        if 'model' in line:
            clean[-1]['model'] = line_model
        if model.get('voice_direction') and 'direction' in line:
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
    if sum(len(line['text']) for line in clean) > 4000:
        raise ValueError('Keep the complete script within 4,000 characters.')
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
    if required_models(result) != {model_id}:
        result['mixed_models_version'] = 1
    if body.get('soundtrack') or body.get('sound_design_version'):
        from audio_soundtrack import validate_tracks
        if body.get('sound_design_version') != 1:
            raise ValueError('Unsupported sound design version.')
        result['soundtrack'] = validate_tracks(body.get('soundtrack'), len(clean))
        result['sound_design_version'] = 1
    return result




