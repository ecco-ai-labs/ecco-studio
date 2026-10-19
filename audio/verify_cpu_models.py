"""Validate CPU-only inference before advertising a model as available."""
import argparse
import array
import hashlib
import json
import os
from pathlib import Path
import subprocess
import time
import wave

BASE = Path('/workspace/ecco-audio')
CASES = {
    'indic-mio': [{'text': 'नमस्ते। आपका स्वागत है।', 'language': 'Hindi', 'voice': 'en_female'},
                  {'text': 'آپ کیسے ہیں؟', 'language': 'Urdu', 'voice': 'en_male'}],
    'chatterbox': [{'text': 'Welcome to Ecco AI Labs.', 'language': 'English', 'voice': 'default'},
                   {'text': 'नमस्ते।', 'language': 'Hindi', 'voice': 'mar_m'}],
    'indicf5': [{'text': 'नमस्ते। आपका स्वागत है।', 'language': 'Hindi', 'voice': 'mar_f'},
                {'text': 'வணக்கம். நலமா?', 'language': 'Tamil', 'voice': 'tam_f'}],
}

def verify(model):
    directory = BASE / 'cpu-verification' / model
    directory.mkdir(parents=True, exist_ok=True)
    request = {'compute': 'cpu', 'model': model, 'lines': CASES[model]}
    (directory / 'request.json').write_text(json.dumps(request))
    env = dict(os.environ, CUDA_VISIBLE_DEVICES='', ECCO_AUDIO_CPU_THREADS='1',
               OMP_NUM_THREADS='1', MKL_NUM_THREADS='1', OPENBLAS_NUM_THREADS='1',
               MALLOC_ARENA_MAX='2', HF_HOME=str(BASE/'hf-cache'), HF_HUB_OFFLINE='1',
               HF_HUB_ENABLE_HF_TRANSFER='0', TORCH_HOME=str(BASE/'torch-cache'))
    env.pop('PYTHONPATH', None)
    python = str(Path('/opt/ecco-audio-cpu') / ('cpu-' + model + '-venv/bin/python'))
    subprocess.run([python, '-c', 'import torch; assert torch.version.cuda is None; print(torch.__version__)'], env=env, check=True, timeout=120)
    script = Path(__file__).with_name('audio_worker.py' if model == 'indic-mio' else 'extra_worker.py')
    started = time.monotonic()
    with (directory / 'inference.log').open('wb') as log:
        subprocess.run([python, str(script), '--request', str(directory/'request.json'), '--runtime',
                        str(BASE/'models'), '--output', str(directory/'output.wav')],
                       env=env, stdout=log, stderr=subprocess.STDOUT, check=True, timeout=900)
    elapsed = round(time.monotonic()-started, 2)
    raw = (directory/'output.wav').read_bytes()
    with wave.open(str(directory/'output.wav')) as audio:
        assert audio.getnchannels() == 1 and audio.getsampwidth() == 2
        duration = audio.getnframes()/audio.getframerate()
        samples = array.array('h', audio.readframes(audio.getnframes()))
        assert duration > .1 and max(abs(x) for x in samples) > 2
        report = dict(model=model, compute='cpu', seconds=round(duration, 2), wall_seconds=elapsed,
                      sample_rate=audio.getframerate(), sha256=hashlib.sha256(raw).hexdigest())
    (directory/'report.json').write_text(json.dumps(report, indent=2))
    ready = BASE/'cpu-ready-models.json'
    current = json.loads(ready.read_text()) if ready.exists() else []
    temporary = ready.with_suffix('.tmp')
    temporary.write_text(json.dumps(sorted(set(current + [model]))))
    temporary.replace(ready)
    print('PASS', json.dumps(report), flush=True)

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--model', choices=CASES)
    args = parser.parse_args()
    for model in [args.model] if args.model else CASES:
        verify(model)
