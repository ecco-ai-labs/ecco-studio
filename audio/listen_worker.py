"""Listen-back: transcribe a finished episode with Whisper large-v3-turbo on the GPU.

Runs in the IndicF5 environment, which already has transformers, torch and the Whisper
weights cached by prepare_reference_voices.py. The request is self-contained: the
recording's sha256 and a signed link. On a pod the coordinator also copies the file
next to the job as input.wav, so no download is needed. Writes output.json {text}.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import tempfile
import urllib.request

# Whisper language names for the studio languages it knows; others are auto-detected.
WHISPER = {'English', 'Hindi', 'Bengali', 'Tamil', 'Telugu', 'Kannada', 'Malayalam', 'Marathi', 'Gujarati', 'Punjabi',
           'Urdu', 'Assamese', 'Nepali', 'Sanskrit', 'Sindhi', 'Arabic', 'Chinese', 'Danish', 'Dutch', 'Finnish', 'French',
           'German', 'Greek', 'Hebrew', 'Indonesian', 'Italian', 'Japanese', 'Khmer', 'Korean', 'Lao', 'Malay', 'Norwegian',
           'Polish', 'Portuguese', 'Russian', 'Spanish', 'Swahili', 'Swedish', 'Tagalog', 'Thai', 'Turkish', 'Vietnamese', 'Burmese'}


def source(request, directory):
    expected = request['input']['sha256']
    local = directory / 'input.wav'
    if local.is_file() and hashlib.sha256(local.read_bytes()).hexdigest() == expected:
        return local
    url = request['input'].get('url') or ''
    base = os.environ.get('ECCO_STORAGE_PUBLIC_URL', '').rstrip('/')
    if not url and base and request['input'].get('path', '').startswith('/api/audio/auto/listen-input/'):
        url = base + request['input']['path']
    if not url.startswith('https://'):
        raise RuntimeError('The recording for listen-back is not available to this worker.')
    with urllib.request.urlopen(url, timeout=120) as response:
        data = response.read(512 * 1024 * 1024)
    if hashlib.sha256(data).hexdigest() != expected:
        raise RuntimeError('The recording for listen-back failed its checksum.')
    target = Path(tempfile.mkdtemp()) / 'input.wav'
    target.write_bytes(data)
    return target


# Sound check (Model Sounds, 21 Nov 2026): CLAP scores a sound against text labels ("dog barking", "rain").
# Weights download into this worker's HF cache on first use.
CLAP = 'laion/clap-htsat-unfused'


def classify(request, path, output):
    labels = [str(x)[:120] for x in request.get('labels') or [] if str(x).strip()][:64]
    if len(labels) < 2:
        raise SystemExit('Sound check needs at least two labels.')
    os.environ['HF_HUB_OFFLINE'] = '0'
    os.environ['TRANSFORMERS_OFFLINE'] = '0'
    import soundfile as sf
    import numpy as np
    from transformers import pipeline
    audio, rate = sf.read(str(path), dtype='float32')
    if audio.ndim > 1:
        audio = audio.mean(axis=1)
    if rate != 48000:  # CLAP expects 48 kHz
        idx = np.linspace(0, len(audio) - 1, int(len(audio) * 48000 / rate))
        audio = np.interp(idx, np.arange(len(audio)), audio).astype('float32')
    scorer = pipeline('zero-shot-audio-classification', model=CLAP, device=0)
    scores = scorer(audio, candidate_labels=labels)
    temporary = output.with_suffix('.tmp')
    temporary.write_text(json.dumps({'scores': [{'label': s['label'], 'score': round(float(s['score']), 4)} for s in scores],
                                     'model': CLAP}, ensure_ascii=False))
    temporary.replace(output)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--request', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    request = json.loads(args.request.read_text())
    if request.get('task') != 'listen' or request.get('model') not in ('whisper-large-v3-turbo', CLAP):
        raise SystemExit('Unsupported listen-back request.')
    path = source(request, args.request.parent)
    if request['model'] == CLAP:
        return classify(request, path, args.output)
    import soundfile as sf
    import torch
    from transformers import pipeline
    transcribe = pipeline('automatic-speech-recognition', model='openai/whisper-large-v3-turbo',
                          torch_dtype=torch.float16, device='cuda', chunk_length_s=30, batch_size=8)
    audio, rate = sf.read(str(path), dtype='float32')
    if audio.ndim > 1:
        audio = audio.mean(axis=1)
    language = request.get('language')
    kwargs = {'task': 'transcribe', **({'language': language.lower()} if language in WHISPER else {})}
    result = transcribe({'raw': audio, 'sampling_rate': rate}, generate_kwargs=kwargs)
    text = result['text'].strip()
    temporary = args.output.with_suffix('.tmp')
    temporary.write_text(json.dumps({'text': text, 'model': request['model'], 'language': language}, ensure_ascii=False))
    temporary.replace(args.output)


if __name__ == '__main__':
    try:
        main()
    except SystemExit:
        raise
    except Exception as error:
        # Write the reason next to the job, so the coordinator can show why listen-back failed (the worker log stays on the GPU).
        import traceback
        parser = argparse.ArgumentParser()
        parser.add_argument('--request', type=Path)
        parser.add_argument('--output', type=Path)
        known, _ = parser.parse_known_args()
        if known.output:
            known.output.write_text(json.dumps({'error': f'{type(error).__name__}: {error}'[:500], 'trace': traceback.format_exc()[-1500:]}))
        raise
