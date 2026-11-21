#!/usr/bin/env python3
"""Model Sounds (owner-approved 21 Nov 2026): make, check and file pre-made voice and sound samples.

Runs on the storage pod next to the storage service (http://127.0.0.1:8888):
    python3 scripts/model_sounds.py run        # make what is missing, check, file under Model Sounds
    python3 scripts/model_sounds.py plan       # list what would be made
    python3 scripts/model_sounds.py report     # summary of the last run

Every sample is an ordinary Audio Library recording with a `model_sound` record: the model, voice, language,
settings, the words spoken, where it is filed and the results of the automatic checks. Labels are nested by name:
"Model Sounds / Human / Male / Boy (about 6) / English".

Checks: length; not silent and not clipped; listen-back (Whisper, auto language) must hear the expected words;
voice pitch must fit the voice type; sound effects must match their label (CLAP) and contain no speech. A sample
that fails is remade once; if it still fails it is filed with checks.status = "needs_listen".
State is kept in /workspace/ecco-model-sounds/state.json, so the script can be stopped and run again.
"""
import argparse
import concurrent.futures
import threading
import difflib
import hashlib
import json
import os
import re
import shutil
import sqlite3
import subprocess
import sys
import time
import unicodedata
import urllib.error
import urllib.request
import uuid
from pathlib import Path

BASE = os.getenv('ECCO_STORAGE_LOCAL', 'http://127.0.0.1:8888')
TOKEN = Path(os.getenv('ECCO_STORAGE_TOKEN_FILE', '/workspace/ecco-storage-private/access.key'))
DATA = Path(os.getenv('ECCO_DATA', '/workspace/ecco-studio-data'))
QUEUE = Path(os.getenv('ECCO_AUDIO_QUEUE', '/workspace/ecco-audio/queue'))
HOME = Path(os.getenv('ECCO_MODEL_SOUNDS_HOME', '/workspace/ecco-model-sounds'))
ROOT = 'Model Sounds'
COMPUTE = 'a100'
WHISPER = 'whisper-large-v3-turbo'
CLAP = 'laion/clap-htsat-unfused'
IN_FLIGHT = 3          # the storage service allows four audio jobs at once; one stays free for people
CHECKERS = 4           # checks (listen-back) run beside generation
LOCK = threading.RLock()

# ---------------------------------------------------------------- human voices
QWEN_LANGS = ['English', 'Spanish', 'French', 'German', 'Italian', 'Portuguese', 'Japanese', 'Chinese', 'Korean', 'Russian']
INDIC = ['Tamil', 'Telugu', 'Bengali', 'Marathi', 'Gujarati', 'Kannada', 'Malayalam', 'Punjabi']
LANGS = QWEN_LANGS[:1] + ['Hindi'] + QWEN_LANGS[1:] + INDIC

TEMPLATE = {
    'English': 'Hello, I am {}. How do you like my voice?',
    'Spanish': 'Hola, soy {}. ¿Te gusta mi voz?',
    'French': 'Bonjour, je suis {}. Comment trouvez-vous ma voix ?',
    'German': 'Hallo, ich bin {}. Wie gefällt dir meine Stimme?',
    'Italian': 'Ciao, sono {}. Ti piace la mia voce?',
    'Portuguese': 'Olá, eu sou {}. Você gosta da minha voz?',
    'Japanese': 'こんにちは、私は{}です。私の声はいかがですか？',
    'Chinese': '你好，我是{}。你喜欢我的声音吗？',
    'Korean': '안녕하세요, 저는 {}입니다. 제 목소리 어떠세요?',
    'Russian': 'Здравствуйте, я {}. Как вам мой голос?',
    'Hindi': 'नमस्ते, मैं {} हूँ। आपको मेरी आवाज़ कैसी लगी?',
    'Tamil': 'வணக்கம், நான் {}. என் குரல் உங்களுக்குப் பிடித்திருக்கிறதா?',
    'Telugu': 'నమస్కారం, నేను {}. నా గొంతు మీకు ఎలా ఉంది?',
    'Bengali': 'নমস্কার, আমি {}। আমার কণ্ঠস্বর আপনার কেমন লাগছে?',
    'Marathi': 'नमस्कार, मी {} आहे. तुम्हाला माझा आवाज कसा वाटतो?',
    'Gujarati': 'નમસ્તે, હું {} છું. તમને મારો અવાજ કેવો લાગે છે?',
    'Kannada': 'ನಮಸ್ಕಾರ, ನಾನು {}. ನನ್ನ ಧ್ವನಿ ನಿಮಗೆ ಹೇಗಿದೆ?',
    'Malayalam': 'നമസ്കാരം, ഞാൻ {}. എന്റെ ശബ്ദം നിങ്ങൾക്ക് എങ്ങനെയുണ്ട്?',
    'Punjabi': 'ਸਤ ਸ੍ਰੀ ਅਕਾਲ, ਮੈਂ {} ਹਾਂ। ਤੁਹਾਨੂੰ ਮੇਰੀ ਆਵਾਜ਼ ਕਿਵੇਂ ਲੱਗੀ?',
}
# Who each voice says it is, per language (index order of WHO_KEYS).
WHO_KEYS = ['toddler_girl', 'toddler_boy', 'girl', 'boy', 'teen_girl', 'teen_boy', 'young_woman', 'young_man', 'woman', 'man',
            'grandmother', 'grandfather', 'wise_elder', 'news_f', 'news_m', 'doc_f', 'doc_m', 'teacher', 'coach', 'podcast_f', 'podcast_m']
WHO = {
    'English': ['a little toddler girl', 'a little toddler boy', 'a girl', 'a boy', 'a teenage girl', 'a teenage boy', 'a young woman', 'a young man',
                'a woman', 'a man', 'a grandmother', 'a grandfather', 'a wise old man', 'a news anchor', 'a news anchor', 'a documentary narrator',
                'a documentary narrator', 'a teacher', 'a coach', 'a podcast host', 'a podcast host'],
    'Spanish': ['una niña pequeñita', 'un niño pequeñito', 'una niña', 'un niño', 'una adolescente', 'un adolescente', 'una mujer joven', 'un hombre joven',
                'una mujer', 'un hombre', 'una abuela', 'un abuelo', 'un anciano sabio', 'una presentadora de noticias', 'un presentador de noticias',
                'una narradora de documentales', 'un narrador de documentales', 'una profesora', 'un entrenador', 'una presentadora de pódcast', 'un presentador de pódcast'],
    'French': ['une toute petite fille', 'un tout petit garçon', 'une fille', 'un garçon', 'une adolescente', 'un adolescent', 'une jeune femme', 'un jeune homme',
               'une femme', 'un homme', 'une grand-mère', 'un grand-père', 'un vieux sage', 'une présentatrice du journal', 'un présentateur du journal',
               'une narratrice de documentaires', 'un narrateur de documentaires', 'une enseignante', 'un entraîneur', 'une animatrice de podcast', 'un animateur de podcast'],
    'German': ['ein kleines Mädchen', 'ein kleiner Junge', 'ein Mädchen', 'ein Junge', 'eine Jugendliche', 'ein Jugendlicher', 'eine junge Frau', 'ein junger Mann',
               'eine Frau', 'ein Mann', 'eine Oma', 'ein Opa', 'ein weiser alter Mann', 'eine Nachrichtensprecherin', 'ein Nachrichtensprecher',
               'eine Dokumentarsprecherin', 'ein Dokumentarsprecher', 'eine Lehrerin', 'ein Trainer', 'eine Podcast-Moderatorin', 'ein Podcast-Moderator'],
    'Italian': ['una bimba piccola', 'un bimbo piccolo', 'una bambina', 'un bambino', 'una ragazza', 'un ragazzo', 'una giovane donna', 'un giovane uomo',
                'una donna', 'un uomo', 'una nonna', 'un nonno', 'un vecchio saggio', 'una conduttrice del telegiornale', 'un conduttore del telegiornale',
                'una narratrice di documentari', 'un narratore di documentari', "un'insegnante", 'un allenatore', 'una conduttrice di podcast', 'un conduttore di podcast'],
    'Portuguese': ['uma menininha', 'um menininho', 'uma menina', 'um menino', 'uma adolescente', 'um adolescente', 'uma jovem', 'um jovem',
                   'uma mulher', 'um homem', 'uma avó', 'um avô', 'um velho sábio', 'uma apresentadora de telejornal', 'um apresentador de telejornal',
                   'uma narradora de documentários', 'um narrador de documentários', 'uma professora', 'um treinador', 'uma apresentadora de podcast', 'um apresentador de podcast'],
    'Japanese': ['小さな女の子', '小さな男の子', '女の子', '男の子', '女子高校生', '男子高校生', '若い女性', '若い男性', '女性', '男性', 'おばあちゃん', 'おじいちゃん',
                 '物知りのおじいさん', 'ニュースキャスター', 'ニュースキャスター', 'ドキュメンタリーのナレーター', 'ドキュメンタリーのナレーター', '先生', 'コーチ',
                 'ポッドキャストのホスト', 'ポッドキャストのホスト'],
    'Chinese': ['一个小小女孩', '一个小小男孩', '一个小女孩', '一个小男孩', '一个少女', '一个少年', '一位年轻女士', '一位年轻男士', '一位女士', '一位男士', '一位奶奶',
                '一位爷爷', '一位睿智的老人', '一位新闻主播', '一位新闻主播', '一位纪录片解说员', '一位纪录片解说员', '一位老师', '一位教练', '一位播客主持人', '一位播客主持人'],
    'Korean': ['아기 여자아이', '아기 남자아이', '여자아이', '남자아이', '십대 소녀', '십대 소년', '젊은 여성', '젊은 남성', '여성', '남성', '할머니', '할아버지', '지혜로운 노인',
               '뉴스 앵커', '뉴스 앵커', '다큐멘터리 내레이터', '다큐멘터리 내레이터', '선생님', '코치', '팟캐스트 진행자', '팟캐스트 진행자'],
    'Russian': ['малышка', 'малыш', 'девочка', 'мальчик', 'девушка-подросток', 'подросток', 'молодая женщина', 'молодой человек', 'женщина', 'мужчина', 'бабушка',
                'дедушка', 'мудрый старик', 'ведущая новостей', 'ведущий новостей', 'диктор документальных фильмов', 'диктор документальных фильмов',
                'учительница', 'тренер', 'ведущая подкаста', 'ведущий подкаста'],
}
# Hindi and the Indian languages: adults only (young woman, young man, woman, man).
WHO_ADULT = {
    'Hindi': ['एक युवती', 'एक युवक', 'एक महिला', 'एक आदमी'],
    'Tamil': ['ஒரு இளம் பெண்', 'ஒரு இளைஞன்', 'ஒரு பெண்', 'ஒரு ஆண்'],
    'Telugu': ['ఒక యువతిని', 'ఒక యువకుడిని', 'ఒక మహిళను', 'ఒక పురుషుడిని'],
    'Bengali': ['একজন তরুণী', 'একজন তরুণ', 'একজন মহিলা', 'একজন পুরুষ'],
    'Marathi': ['एक तरुणी', 'एक तरुण', 'एक स्त्री', 'एक पुरुष'],
    'Gujarati': ['એક યુવતી', 'એક યુવાન', 'એક સ્ત્રી', 'એક પુરુષ'],
    'Kannada': ['ಒಬ್ಬ ಯುವತಿ', 'ಒಬ್ಬ ಯುವಕ', 'ಒಬ್ಬ ಮಹಿಳೆ', 'ಒಬ್ಬ ಪುರುಷ'],
    'Malayalam': ['ഒരു യുവതിയാണ്', 'ഒരു യുവാവാണ്', 'ഒരു സ്ത്രീയാണ്', 'ഒരു പുരുഷനാണ്'],
    'Punjabi': ['ਇੱਕ ਮੁਟਿਆਰ', 'ਇੱਕ ਨੌਜਵਾਨ', 'ਇੱਕ ਔਰਤ', 'ਇੱਕ ਆਦਮੀ'],
}
ADULT_KEYS = ['young_woman', 'young_man', 'woman', 'man']
KOKORO = {  # (woman, man, young woman, young man)
    'English': ('af_heart', 'am_adam', 'af_bella', 'am_michael'), 'Hindi': ('hf_alpha', 'hm_omega', 'hf_beta', 'hm_psi'),
    'Spanish': ('ef_dora', 'em_alex', None, None), 'French': ('ff_siwis', None, None, None), 'Italian': ('if_sara', 'im_nicola', None, None),
    'Portuguese': ('pf_dora', 'pm_alex', None, None), 'Japanese': ('jf_alpha', 'jm_kumo', None, None), 'Chinese': ('zf_xiaobei', 'zm_yunjian', None, None)}
# (row label, voice type folder, sex, who key, qwen voice, pitch range Hz, experimental, direction)
ROWS = [
    ('Toddler girl (about 3)', 'Female', 'toddler_girl', 'girl-5', (260, 520), True, 'A tiny toddler about 3 years old: very high, soft, babyish voice, short words, slow and sweet.'),
    ('Toddler boy (about 3)', 'Male', 'toddler_boy', 'boy-6', (250, 520), True, 'A tiny toddler about 3 years old: very high, soft, babyish voice, short words, slow and sweet.'),
    ('Girl (about 5)', 'Female', 'girl', 'girl-5', (220, 450), False, ''),
    ('Boy (about 6)', 'Male', 'boy', 'boy-6', (210, 440), False, ''),
    ('Girl (about 9)', 'Female', 'girl', 'girl-9', (200, 420), False, ''),
    ('Boy (about 10)', 'Male', 'boy', 'boy-10', (190, 400), False, ''),
    ('Teen girl', 'Female', 'teen_girl', 'teen-f', (165, 330), False, ''),
    ('Teen boy', 'Male', 'teen_boy', 'teen-m', (90, 280), False, ''),
    ('Young woman (20s)', 'Female', 'young_woman', 'young-adult-f', (150, 320), False, ''),
    ('Young man (20s)', 'Male', 'young_man', 'young-adult-m', (75, 190), False, ''),
    ('Woman (30s–40s)', 'Female', 'woman', 'expert-f', (140, 310), False, ''),
    ('Man (30s–40s)', 'Male', 'man', 'expert-m', (70, 185), False, ''),
    ('Grandmother', 'Female', 'grandmother', 'storyteller-f', (130, 300), False, ''),
    ('Grandfather', 'Male', 'grandfather', 'storyteller-m', (65, 190), False, ''),
    ('Wise elder', 'Male', 'wise_elder', 'wise-elder-m', (65, 190), False, ''),
    ('Styles / News anchor', 'Female', 'news_f', 'news-anchor-f', (140, 310), False, ''),
    ('Styles / News anchor', 'Male', 'news_m', 'news-anchor-m', (70, 185), False, ''),
    ('Styles / Documentary narrator', 'Female', 'doc_f', 'documentary-f', (140, 310), False, ''),
    ('Styles / Documentary narrator', 'Male', 'doc_m', 'documentary-m', (65, 185), False, ''),
    ('Styles / Teacher', 'Female', 'teacher', 'teacher-f', (140, 310), False, ''),
    ('Styles / Coach', 'Male', 'coach', 'coach-m', (70, 190), False, ''),
    ('Styles / Podcast host', 'Female', 'podcast_f', 'warm-host-f', (140, 310), False, ''),
    ('Styles / Podcast host', 'Male', 'podcast_m', 'curious-host-m', (70, 185), False, ''),
]


def human_voice(row, lang):
    """(model, voice) for one row and language, or None when no model in the Model Garden can make it."""
    label, sex, who, qwen = row[0], row[1], row[2], row[3]
    if who in ADULT_KEYS:
        if lang in INDIC:
            return 'svara-tts', lang.lower() + ('-female' if sex == 'Female' else '-male')
        kok = KOKORO.get(lang)
        pick = None
        if kok:
            pick = {'woman': kok[0], 'man': kok[1], 'young_woman': kok[2], 'young_man': kok[3]}[who]
        if pick:
            return 'kokoro', pick
        return ('qwen3-tts', qwen) if lang in QWEN_LANGS else None
    return ('qwen3-tts', qwen) if lang in QWEN_LANGS else None


def human_text(who, lang):
    words = WHO_ADULT[lang][ADULT_KEYS.index(who)] if lang in WHO_ADULT else WHO[lang][WHO_KEYS.index(who)]
    return TEMPLATE[lang].format(words)


# ---------------------------------------------------------------- animals and other sounds
ANIMALS = {
    'Pets': {'Cat': ['Meow', 'Purr', 'Hiss', 'Kitten mew'], 'Dog': ['Bark', 'Growl', 'Whine', 'Puppy yip'], 'Parrot': ['Squawk', 'Whistle', 'Chatter'],
             'Hamster': ['Squeak', 'Wheel running'], 'Rabbit': ['Thump', 'Nibble']},
    'Farm': {'Cow': ['Moo', 'Calf'], 'Horse': ['Neigh', 'Gallop', 'Snort'], 'Sheep': ['Baa', 'Lamb'], 'Goat': ['Bleat'], 'Pig': ['Oink', 'Squeal'],
             'Rooster': ['Crow at dawn'], 'Chicken': ['Cluck', 'Chicks peep'], 'Duck': ['Quack', 'Ducklings'], 'Donkey': ['Bray']},
    'Wild': {'Monkey': ['Chatter', 'Howler call', 'Screech'], 'Lion': ['Roar', 'Growl'], 'Tiger': ['Roar', 'Chuff'], 'Elephant': ['Trumpet', 'Rumble'],
             'Wolf': ['Howl', 'Pack howl'], 'Bear': ['Growl', 'Roar'], 'Hyena': ['Laugh'], 'Deer': ['Bark', 'Rustle in leaves']},
    'Birds': {'Songbird': ['Morning song', 'Chirps'], 'Crow': ['Caw'], 'Owl': ['Hoot', 'Screech owl'], 'Eagle': ['Cry'], 'Peacock': ['Call'],
              'Seagull': ['Cry over sea'], 'Pigeon': ['Coo', 'Wings flap'], 'Woodpecker': ['Pecking']},
    'Reptiles, frogs and insects': {'Frog': ['Croak', 'Pond chorus'], 'Snake': ['Hiss', 'Rattle'], 'Crocodile': ['Growl', 'Splash'], 'Bees': ['Buzz', 'Hive'],
                                    'Crickets': ['Night chirp'], 'Mosquito': ['Whine'], 'Fly': ['Buzz']},
    'Water': {'Dolphin': ['Clicks', 'Whistle'], 'Whale': ['Song'], 'Seal': ['Bark']},
}
TALKING = {'Cheerful animal friend': 'cheerful-animal', 'Grumpy animal friend': 'grumpy-animal', 'Shy animal friend': 'shy-animal'}
TALKING_LANGS = ['English', 'Spanish', 'French', 'Japanese']
TALKING_LINE = {'English': 'Hello, I am {}. How do you like my voice?', 'Spanish': 'Hola, soy {}. ¿Te gusta mi voz?',
                'French': 'Bonjour, je suis {}. Comment trouvez-vous ma voix ?', 'Japanese': 'こんにちは、私は{}です。私の声はいかがですか？'}
TALKING_WHO = {'Cheerful animal friend': {'English': 'a cheerful animal friend', 'Spanish': 'un amigo animal alegre', 'French': 'un joyeux ami animal', 'Japanese': '陽気な動物の友だち'},
               'Grumpy animal friend': {'English': 'a grumpy animal friend', 'Spanish': 'un amigo animal gruñón', 'French': 'un ami animal grincheux', 'Japanese': '不機嫌な動物の友だち'},
               'Shy animal friend': {'English': 'a shy animal friend', 'Spanish': 'un amigo animal tímido', 'French': 'un ami animal timide', 'Japanese': '恥ずかしがり屋の動物の友だち'}}
OTHERS = {
    'Road': {'Motorbike': ['Start', 'Pass by', 'Rev'], 'Bicycle': ['Bell', 'Chain', 'Brakes'], 'Car': ['Engine start', 'Horn', 'Pass by', 'Door close'],
             'Truck': ['Engine', 'Air brakes', 'Reverse beep'], 'Bus': ['Pull away', 'Doors'], 'Auto-rickshaw': ['Engine', 'Horn'], 'Traffic': ['City traffic', 'Traffic jam horns']},
    'Air, rail and sea': {'Plane': ['Take-off', 'Fly over', 'Cabin hum'], 'Helicopter': ['Hover', 'Fly by'], 'Train': ['Passing', 'Horn', 'Station arrival', 'On the tracks'],
                          'Metro': ['Doors', 'Arrival'], 'Ship': ['Horn', 'Engine'], 'Boat': ['Motor', 'Oars']},
    'Weather and nature': {'Thunder': ['Distant', 'Close crack', 'Rolling'], 'Rain': ['Light', 'Heavy', 'On a roof', 'On a window'], 'Wind': ['Breeze', 'Gusts', 'Storm'],
                           'Storm': ['Thunderstorm'], 'Ocean': ['Waves', 'Beach'], 'River': ['Stream', 'Waterfall'], 'Fire': ['Campfire', 'Crackling'], 'Forest': ['Day', 'Night']},
    'Home': {'Door': ['Knock', 'Creak', 'Slam'], 'Doorbell': ['Ding-dong', 'Buzzer'], 'Clock': ['Tick', 'Alarm', 'Chime'], 'Phone': ['Ring', 'Notification'],
             'Kitchen': ['Kettle whistle', 'Sizzling pan', 'Dishes'], 'Footsteps': ['Wood floor', 'Gravel', 'Running'], 'Water': ['Tap running', 'Splash']},
    'City and crowd': {'Crowd': ['Chatter', 'Cheering', 'Applause'], 'Market': ['Busy bazaar'], 'Construction': ['Drill', 'Hammer'], 'School': ['Bell', 'Playground'],
                       'Siren': ['Ambulance', 'Police', 'Fire engine'], 'Temple and church': ['Bell', 'Conch']},
    'Action and fantasy': {'Hits': ['Punch', 'Thud'], 'Magic': ['Sparkle', 'Spell'], 'Whoosh': ['Fast', 'Slow'], 'Explosion': ['Distant', 'Big'], 'Space': ['Rocket launch', 'Laser']},
}
MUSIC = {'Mood': ['Happy', 'Sad', 'Suspense', 'Adventure', 'Lullaby', 'Funny'], 'Moments': ['Intro', 'Outro', 'Transition', 'Victory']}


def describe(thing, variant):
    return f'{variant} — {thing}. One clear, realistic sound effect, close up, no music, no voices.'


def clap_label(thing, variant):
    return f'{thing.lower()} {variant.lower()}'


# ---------------------------------------------------------------- plan
def plan():
    items = []
    for row in ROWS:
        label, sex, who, qwen, pitch, exp, direction = row
        for lang in LANGS:
            choice = human_voice(row, lang)
            if not choice:
                continue
            model, voice = choice
            text = human_text(who, lang)
            line = {'text': text, 'voice': voice, 'language': lang, 'model': model}
            if direction:
                line['direction'] = direction
            items.append({'key': f'human:{sex}:{label}:{lang}', 'kind': 'speech', 'path': [ROOT, 'Human', sex, *label.split(' / '), lang],
                          'title': f"{label.split(' / ')[-1]} · {lang}", 'expect': text, 'language': lang, 'pitch': pitch, 'experimental': exp,
                          'body': {'model': model, 'compute': COMPUTE, 'genre': 'Podcast', 'pause': 0, 'title': f"Model Sounds · {label.split(' / ')[-1]} · {lang}", 'lines': [line]},
                          'meta': {'grid': 'Human', 'voice_type': label.split(' / ')[-1], 'sex': sex, 'language': lang, 'model': model, 'voice': voice,
                                   'direction': direction, 'text': text, 'experimental': exp}})
    for group, animals in ANIMALS.items():
        labels = [clap_label(a, v) for a, vs in animals.items() for v in vs]
        for animal, variants in animals.items():
            for variant in variants:
                items.append(sound_item(['Animals', group, animal], animal, variant, labels))
    for name, voice in TALKING.items():
        for lang in TALKING_LANGS:
            text = TALKING_LINE[lang].format(TALKING_WHO[name][lang])
            items.append({'key': f'talking:{name}:{lang}', 'kind': 'speech', 'path': [ROOT, 'Animals', 'Talking animals', name.replace(' animal friend', ''), lang],
                          'title': f'{name} · {lang}', 'expect': text, 'language': lang, 'pitch': None, 'experimental': False,
                          'body': {'model': 'qwen3-tts', 'compute': COMPUTE, 'genre': 'Story Book Reading', 'pause': 0, 'title': f'Model Sounds · {name} · {lang}',
                                   'lines': [{'text': text, 'voice': voice, 'language': lang, 'model': 'qwen3-tts'}]},
                          'meta': {'grid': 'Animals', 'voice_type': name, 'language': lang, 'model': 'qwen3-tts', 'voice': voice, 'text': text}})
    for group, things in OTHERS.items():
        labels = [clap_label(t, v) for t, vs in things.items() for v in vs]
        for thing, variants in things.items():
            for variant in variants:
                items.append(sound_item(['Others', group, thing], thing, variant, labels))
    for group, moods in MUSIC.items():
        for mood in moods:
            description = f'{mood} short music sting for a children’s story or podcast, instrumental, clear melody'
            items.append({'key': f'music:{group}:{mood}', 'kind': 'music', 'path': [ROOT, 'Others', 'Music stings', group, mood], 'title': f'Music sting · {mood}',
                          'seconds': 3.0, 'body': {'kind': 'music', 'model': 'ace-step-1.5', 'description': description, 'duration': 10, 'compute': COMPUTE,
                                                   'title': f'Model Sounds · Music sting · {mood}'},
                          'meta': {'grid': 'Others', 'group': 'Music stings', 'name': group, 'variant': mood, 'model': 'ace-step-1.5', 'description': description}})
    return items


def sound_item(path, thing, variant, labels):
    description = describe(thing, variant)
    return {'key': 'sound:' + ':'.join(path + [variant]), 'kind': 'sound', 'path': [ROOT, *path, variant], 'title': f'{thing} · {variant}', 'seconds': 2.0,
            'clap': clap_label(thing, variant), 'clap_labels': labels,
            'body': {'kind': 'effect', 'model': 'moss-soundeffect-v2', 'description': description, 'duration': 2, 'compute': COMPUTE,
                     'title': f'Model Sounds · {thing} · {variant}'},
            'meta': {'grid': path[0], 'group': path[1], 'name': thing, 'variant': variant, 'model': 'moss-soundeffect-v2', 'description': description}}


# ---------------------------------------------------------------- storage service
def api(path, body=None, method=None):
    request = urllib.request.Request(BASE + '/api/' + path, data=None if body is None else json.dumps(body).encode(), method=method,
                                     headers={'Authorization': 'Bearer ' + TOKEN.read_text().strip(), 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return json.load(response)
    except urllib.error.HTTPError as exc:
        try:
            message = json.load(exc).get('error') or str(exc)
        except Exception:
            message = str(exc)
        raise RuntimeError(f'{exc.code}: {message}') from None


FOLDERS = {}


def folder(path):
    name = ' / '.join(path)
    if name not in FOLDERS:
        FOLDERS[name] = api('audio/folders', {'name': name[:80]})['id']
    return FOLDERS[name]


def db():
    return sqlite3.connect(DATA / 'studio.sqlite', timeout=30)


def record(rid):
    with db() as con:
        row = con.execute('SELECT body FROM records WHERE id=?', (rid,)).fetchone()
    return json.loads(row[0]) if row else None


def save(rec):
    with db() as con:
        con.execute('INSERT OR REPLACE INTO records VALUES (?,?,?)', (rec['id'], rec['kind'], json.dumps(rec)))


# ---------------------------------------------------------------- audio checks (ffmpeg + plain Python)
def pcm(path, rate=8000):
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', str(path), '-ac', '1', '-ar', str(rate), '-f', 's16le', '-'], capture_output=True, check=True).stdout
    return [int.from_bytes(raw[i:i + 2], 'little', signed=True) for i in range(0, len(raw) - 1, 2)]


def levels(path):
    out = subprocess.run(['ffmpeg', '-v', 'info', '-i', str(path), '-af', 'volumedetect', '-f', 'null', '-'], capture_output=True, text=True).stderr
    mean = re.search(r'mean_volume:\s*(-?[\d.]+|-inf)', out)
    peak = re.search(r'max_volume:\s*(-?[\d.]+|-inf)', out)
    num = lambda m: -120.0 if not m or m[1] == '-inf' else float(m[1])
    return num(mean), num(peak)


def pitch(samples, rate=8000):
    """Median pitch (Hz) of the voiced frames, by autocorrelation."""
    frame, found = int(rate * 0.04), []
    lo, hi = int(rate / 550), int(rate / 60)
    for start in range(0, len(samples) - frame - hi, frame):
        seg = samples[start:start + frame + hi]
        energy = sum(x * x for x in seg[:frame])
        if energy < frame * 400 ** 2:
            continue
        cs = [sum(seg[i] * seg[i + k] for i in range(0, frame, 2)) for k in range(lo, hi)]
        best = max(cs)
        if best <= 0.35 * energy / 2:
            continue
        # The first strong peak is the period; later peaks are its multiples (octave errors).
        for j in range(1, len(cs) - 1):
            if cs[j] >= 0.85 * best and cs[j] >= cs[j - 1] and cs[j] >= cs[j + 1]:
                found.append(rate / (lo + j))
                break
    found.sort()
    return round(found[len(found) // 2]) if found else None


def norm(text):
    text = unicodedata.normalize('NFKC', text).casefold()
    return ''.join(ch for ch in text if unicodedata.category(ch)[0] in 'LNM')


def similar(a, b):
    return round(difflib.SequenceMatcher(None, norm(a), norm(b)).ratio(), 2)


def trim(path, seconds):
    temp = path.with_suffix('.trim.wav')
    fade = 0.15 if seconds <= 2 else 0.4
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', str(path), '-t', str(seconds), '-af', f'afade=t=out:st={seconds - fade}:d={fade}', str(temp)], check=True)
    temp.replace(path)


def listen(asset_path, sha, labels=None):
    """Queue a listen-back job (Whisper, or CLAP when labels are given) and wait for its output.json."""
    jid = uuid.uuid4().hex
    d = QUEUE / jid
    d.mkdir(parents=True, mode=0o700)
    shutil.copyfile(asset_path, d / 'input.wav')
    sha = hashlib.sha256((d / 'input.wav').read_bytes()).hexdigest()  # the file as it is now (after any trim)
    request = {'task': 'listen', 'listen_version': 1, 'model': CLAP if labels else WHISPER, 'compute': COMPUTE,
               'title': 'Model Sounds check', 'input': {'sha256': sha}}
    if labels:
        request['labels'] = labels
    (d / 'status.json').write_text(json.dumps({'status': 'queued'}))
    (d / 'request.json').write_text(json.dumps(request, ensure_ascii=False))
    deadline = time.time() + 900
    while time.time() < deadline:
        status = json.loads((d / 'status.json').read_text() or '{}')
        if status.get('status') == 'complete' and (d / 'output.json').is_file():
            out = json.loads((d / 'output.json').read_text())
            shutil.rmtree(d, ignore_errors=True)
            if out.get('error'):
                raise RuntimeError('listen-back: ' + out['error'])
            return out
        if status.get('status') in ('error', 'cancelled'):
            shutil.rmtree(d, ignore_errors=True)
            raise RuntimeError('listen-back: ' + str(status.get('error', status.get('status')))[:200])
        time.sleep(3)
    shutil.rmtree(d, ignore_errors=True)
    raise RuntimeError('listen-back timed out')


def check(item, asset):
    path = DATA / asset['path']
    if item.get('seconds'):
        trim(path, item['seconds'])
        asset['sha256'] = hashlib.sha256(path.read_bytes()).hexdigest()
    samples = pcm(path)
    seconds = round(len(samples) / 8000, 2)
    asset['duration'] = asset['seconds'] = seconds
    mean, peak = levels(path)
    results, problems = {'seconds': seconds, 'mean_db': mean, 'peak_db': peak}, []
    if mean < -45:
        problems.append('silent')
    if peak >= -0.05:
        problems.append('clipped')
    if item['kind'] == 'speech':
        if not 1.0 <= seconds <= 5.5:
            problems.append(f'length {seconds}s')
        heard = listen(path, asset['sha256']).get('text', '')
        score = similar(heard, item['expect'])
        results.update(heard=heard[:300], words_match=score)
        if score < 0.55:
            problems.append(f'words do not match ({score})')
        if item.get('pitch'):
            hz = pitch(samples)
            results['pitch_hz'] = hz
            lo, hi = item['pitch']
            if hz and not lo <= hz <= hi:
                problems.append(f'pitch {hz} Hz outside {lo}–{hi}')
    else:
        if item['kind'] == 'sound':
            scores = listen(path, asset['sha256'], item['clap_labels']).get('scores', [])
            top = [s['label'] for s in scores[:3]]
            results.update(clap_top=top, clap_score=next((s['score'] for s in scores if s['label'] == item['clap']), 0))
            if item['clap'] not in top:
                problems.append('sounds like ' + (top[0] if top else 'something else'))
            heard = listen(path, asset['sha256']).get('text', '').strip()
            if len(heard.split()) >= 4:
                problems.append('contains speech')
                results['heard'] = heard[:200]
    results['problems'] = problems
    return results


# ---------------------------------------------------------------- run
def load_state():
    try:
        return json.loads((HOME / 'state.json').read_text())
    except (OSError, ValueError):
        return {}


def write_state(state):
    HOME.mkdir(parents=True, exist_ok=True)
    temp = HOME / 'state.json.tmp'
    with LOCK:
        text = json.dumps(state, ensure_ascii=False, indent=1)
    temp.write_text(text)
    temp.replace(HOME / 'state.json')


def submit(item, attempt):
    body = dict(item['body'])
    if item['kind'] in ('sound', 'music'):
        body['seed'] = (int(hashlib.sha256((item['key'] + str(attempt)).encode()).hexdigest(), 16) % 2_000_000_000)
        return api('audio/sounds/generate', body)
    return api('audio/generate', body)


def finish(item, job, attempt, state, digests):
    asset = record(job['asset_id'])
    results = check(item, asset)
    with LOCK:
        dup = digests.get(asset['sha256'])
        if dup and dup != item['key']:
            results['problems'].append('same audio as ' + dup)
        entry = state.setdefault(item['key'], {})
        entry.update(asset_id=asset['id'], attempt=attempt, results=results)
        if results['problems'] and attempt == 1:
            entry['status'] = 'remake'
            asset['deleted'] = True
            asset['deleted_reason'] = 'Model Sounds remake: ' + '; '.join(results['problems'])
            save(asset)
            return False
        status = 'needs_listen' if results['problems'] else 'passed'
        entry['status'] = status
        digests[asset['sha256']] = item['key']
        settings = asset.get('settings') or {}
        asset['title'] = item['title']
        asset['model_sound'] = {**item['meta'], 'path': item['path'], 'settings': {k: settings.get(k) for k in
                                ('model', 'seed', 'duration', 'kind', 'sample_rate', 'channels', 'genre', 'worker_compute') if k in settings},
                                'lines': settings.get('lines'), 'checks': {'status': status, **results}, 'made': time.time()}
        save(asset)
        api('audio/labels', {'asset_id': asset['id'], 'title': item['title'], 'folder_ids': [folder(item['path'])]})
        return True


def run(limit=None, only=None):
    items = [i for i in plan() if not only or only in i['key']]
    state = load_state()
    digests = {}
    todo = [i for i in items if state.get(i['key'], {}).get('status') not in ('passed', 'needs_listen')][:limit]
    print(f'{len(items)} samples planned; {len(todo)} to make', flush=True)
    flight = {}  # job id -> (item, attempt)
    pool, checking = concurrent.futures.ThreadPoolExecutor(CHECKERS), {}

    def finish_safe(item, job, attempt):
        try:
            ok = finish(item, job, attempt, state, digests)
        except Exception as exc:
            ok = True
            with LOCK:
                state.setdefault(item['key'], {}).update(status='needs_listen', error='check failed: ' + str(exc)[:200], asset_id=job['asset_id'])
        with LOCK:
            if not ok:
                queue_.append((item, 2))
            print(item['key'], state[item['key']].get('status'), flush=True)
            write_state(state)
    queue_ = [(i, 2 if state.get(i['key'], {}).get('status') == 'remake' else 1) for i in todo]
    while queue_ or flight or checking:
        for f in [f for f in checking if f.done()]:
            checking.pop(f)
        while queue_ and len(flight) < IN_FLIGHT:
            item, attempt = queue_.pop(0)
            try:
                job = submit(item, attempt)
                flight[job['id']] = (item, attempt, time.time())
            except RuntimeError as exc:
                if exc.args and str(exc.args[0]).startswith('429'):
                    queue_.insert(0, (item, attempt))
                    break
                state.setdefault(item['key'], {}).update(status='failed', error=str(exc)[:300])
                print('FAILED to submit', item['key'], exc, flush=True)
        time.sleep(4)
        for jid, (item, attempt, began) in list(flight.items()):
            try:
                job = api('audio/jobs/' + jid)
            except RuntimeError as exc:
                print('status error', item['key'], exc, flush=True)
                continue
            if job['status'] == 'done' and job.get('asset_id'):
                del flight[jid]
                checking[pool.submit(finish_safe, item, job, attempt)] = item['key']
            elif job['status'] in ('error', 'cancelled') or time.time() - began > 1800:
                del flight[jid]
                entry = state.setdefault(item['key'], {})
                if attempt == 1:
                    queue_.append((item, 2))
                    entry['status'] = 'remake'
                else:
                    entry.update(status='failed', error=(job.get('error') or 'timed out')[:300])
                print(item['key'], 'job', job['status'], (job.get('error') or '')[:120], flush=True)
                write_state(state)
    pool.shutdown(wait=True)
    write_state(state)
    report()


def report():
    state, items = load_state(), plan()
    counts = {}
    for i in items:
        s = state.get(i['key'], {}).get('status', 'not made')
        counts[s] = counts.get(s, 0) + 1
    needs = [{'key': k, 'problems': v.get('results', {}).get('problems') or [v.get('error')], 'asset_id': v.get('asset_id')}
             for k, v in state.items() if v.get('status') in ('needs_listen', 'failed')]
    out = {'total': len(items), 'counts': counts, 'needs_a_listen': needs, 'at': time.strftime('%Y-%m-%d %H:%M:%S')}
    HOME.mkdir(parents=True, exist_ok=True)
    (HOME / 'report.json').write_text(json.dumps(out, ensure_ascii=False, indent=1))
    print(json.dumps({'total': out['total'], 'counts': counts, 'needs_a_listen': len(needs)}, ensure_ascii=False))
    return out


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('command', choices=('plan', 'run', 'report'))
    parser.add_argument('--limit', type=int)
    parser.add_argument('--only', help='only keys containing this text (for a small test)')
    args = parser.parse_args()
    if args.command == 'plan':
        items = plan()
        kinds = {}
        for i in items:
            kinds[i['kind']] = kinds.get(i['kind'], 0) + 1
        print(json.dumps({'total': len(items), 'kinds': kinds}))
        for i in items[:5]:
            print(i['key'], '|', i.get('expect') or i['body'].get('description'))
    elif args.command == 'run':
        run(args.limit, args.only)
    else:
        report()
