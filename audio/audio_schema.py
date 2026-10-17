"""Portable audio request validation. No storage, API or GPU ownership."""
import math

LANGUAGES = ['Hindi', 'Urdu', 'English', 'Tamil', 'Punjabi', 'Assamese', 'Bengali', 'Bodo', 'Dogri', 'Gujarati', 'Kannada', 'Kashmiri', 'Konkani', 'Maithili', 'Malayalam', 'Manipuri', 'Marathi', 'Nepali', 'Odia', 'Sanskrit', 'Santali', 'Sindhi', 'Telugu']
INDIC_EMOTIONS = ['neutral', 'happy', 'sad', 'angry', 'disgust', 'fear', 'surprise']
ENGLISH_EMOTIONS = ['neutral', 'happy', 'sad', 'angry', 'enunciated', 'confused', 'whisper']
MODEL = 'SPRINGLab/Indic-Mio'
def validate(body):
    if body.get('model', 'indic-mio') != 'indic-mio':
        raise ValueError('Choose Indic-Mio for audio generation.')
    lines = body.get('lines')
    if not isinstance(lines, list) or not 1 <= len(lines) <= 20:
        raise ValueError('Add between 1 and 20 dialogue lines.')
    clean = []
    for line in lines:
        if not isinstance(line, dict):
            raise ValueError('Invalid dialogue line.')
        text = line.get('text', '')
        language = line.get('language', 'Hindi')
        emotion = line.get('emotion', 'neutral')
        voice = line.get('voice', 'en_female')
        if not isinstance(text, str) or not 1 <= len(text.strip()) <= 500:
            raise ValueError('Each line needs 1–500 characters.')
        if language not in LANGUAGES:
            raise ValueError('Choose a supported language.')
        if emotion not in (ENGLISH_EMOTIONS if language == 'English' else INDIC_EMOTIONS):
            raise ValueError('This emotion is not supported for the selected language.')
        if voice not in ('en_female', 'en_male'):
            raise ValueError('Choose one of the available voices.')
        clean.append(dict(text=text.strip(), language=language, emotion=emotion, voice=voice))
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
    return dict(model='indic-mio', title=title.strip()[:160] or 'Audio recording', lines=clean,
                speed=bounded('speed', 1, 0.75, 1.5), pitch=bounded('pitch', 0, -4, 4),
                pause=bounded('pause', 0.35, 0, 2))
