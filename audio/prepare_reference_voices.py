"""Install official example voices and generate their one-time reference transcripts."""
import json
import os
from pathlib import Path
from urllib.request import urlopen

ROOT = Path('/workspace/ecco-audio/models/reference-voices')
ROOT.mkdir(parents=True, exist_ok=True)
os.environ['HF_HOME'] = '/workspace/ecco-audio/hf-cache'
os.environ['HF_HUB_ENABLE_HF_TRANSFER'] = '0'
from audio_schema import MODELS

base = 'https://raw.githubusercontent.com/AI4Bharat/IndicF5/13f7c4d627cc10111aea8fe9c0039462cacacdc7/prompts/'
for voice in MODELS['indicf5']['voices']:
    target = ROOT / voice['file']
    if not target.is_file():
        with urlopen(base + voice['file'], timeout=120) as response:
            target.write_bytes(response.read())

from transformers import pipeline
import soundfile as sf
import torch
transcribe = pipeline('automatic-speech-recognition', model='openai/whisper-large-v3-turbo',
                      torch_dtype=torch.float16, device='cuda')
languages = {'kan_f': 'kannada', 'mar_f': 'marathi', 'mar_f2': 'marathi', 'mar_m': 'marathi',
             'pan_f': 'punjabi', 'pan_f2': 'punjabi', 'tam_f': 'tamil'}
transcripts = {}
for voice in MODELS['indicf5']['voices']:
    audio, rate = sf.read(ROOT / voice['file'], dtype='float32')
    if audio.ndim > 1:
        audio = audio.mean(axis=1)
    result = transcribe({'raw': audio, 'sampling_rate': rate}, generate_kwargs={'language': languages[voice['id']], 'task': 'transcribe'})
    text = result['text'].strip()
    if not text:
        raise RuntimeError('Empty transcript for ' + voice['id'])
    transcripts[voice['id']] = text
    print(voice['id'], ':', text, flush=True)
temporary = ROOT / 'transcripts.tmp'
temporary.write_text(json.dumps(transcripts, ensure_ascii=False, indent=2))
temporary.replace(ROOT / 'transcripts.json')
print('REFERENCE VOICES READY:', len(transcripts), flush=True)
