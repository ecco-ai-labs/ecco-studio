"""GPU voice-model installer for svara-TTS, MOSS-TTSD and Qwen3-TTS, in separate steps.

  packages <model>  create <ECCO_AUDIO_VENVS>/<model>-venv and install pinned packages (no weights)
  weights <model>   download pinned weights to <ECCO_AUDIO_MODELS>/<model>
  smoke <model>     one short GPU generation; on success add the model to the GPU readiness
                    file so the GPU worker advertises it (needs a GPU)

Defaults follow the existing GPU pod layout (/workspace/ecco-audio): venvs beside
queue_worker.py, weights in models/, readiness in gpu-ready-models.json. Override with
ECCO_AUDIO_VENVS, ECCO_AUDIO_MODELS (the queue worker reads both) and ECCO_AUDIO_READY_FILE.
ECCO_AUDIO_BASE_PYTHON (default /opt/ecco-runtime-venv/bin/python when present) supplies the
pod's CUDA torch via --system-site-packages and is pinned as a constraint, as in
install_extra_models.sh. SVARA_REVISION / SNAC_REVISION / MOSS_TTSD_REVISION /
MOSS_CODEC_REVISION pin exact Hugging Face commits; when unset the current commit is
resolved once and recorded in ecco-install.json. Existing installers are unchanged.
There is no CPU path for these models.

Qwen3-TTS: weights go to models/qwen3-tts/voice-design (VoiceDesign: a voice from a description) and
models/qwen3-tts/base (Base: every line cloned from the designed voice so a character keeps one voice).
QWEN3_DESIGN_REVISION / QWEN3_BASE_REVISION pin the commits. After downloading, any repository the model
loads at start-up (its speech tokenizer) is fetched once into hf-cache so offline workers can load it.
"""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys

AUDIO = Path(__file__).resolve().parent

MODELS = {
    'svara-tts': {
        'repo': 'kenpath/svara-tts-v1', 'revision_env': 'SVARA_REVISION',
        # Llama-architecture causal LM + SNAC decoder. torch comes from the base image.
        'packages': ['numpy==1.26.4', 'transformers==4.51.3', 'accelerate', 'safetensors', 'sentencepiece',
                     'soundfile', 'huggingface_hub<1', 'snac'],
        'extras': [('snac', 'hubertsiuzdak/snac_24khz', 'SNAC_REVISION', ['config.json', 'pytorch_model.bin'])],
        'patterns': ['*.json', '*.safetensors', 'tokenizer*', '*.model', '*.txt', 'LICENSE*', '*.md'],
    },
    'moss-ttsd': {
        'repo': 'OpenMOSS-Team/MOSS-TTSD-v1.0', 'revision_env': 'MOSS_TTSD_REVISION',
        # Upstream recommends Python 3.12, transformers 5.0.0 and torch 2.9.1 (CUDA 12.8).
        'packages': ['transformers==5.0.0', 'accelerate', 'safetensors', 'soundfile', 'huggingface_hub', 'torchcodec'],
        'source': 'git+https://github.com/OpenMOSS/MOSS-TTS.git',
        'extras': [('codec', 'OpenMOSS-Team/MOSS-Audio-Tokenizer', 'MOSS_CODEC_REVISION', None)],
        'patterns': None,
    },
    'qwen3-tts': {
        'repo': 'Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign', 'revision_env': 'QWEN3_DESIGN_REVISION', 'subdir': 'voice-design',
        # qwen-tts brings its own transformers pin; torch/torchaudio come from the base image (constraints).
        'packages': ['qwen-tts', 'soundfile', 'huggingface_hub', 'accelerate'],
        'extras': [('base', 'Qwen/Qwen3-TTS-12Hz-1.7B-Base', 'QWEN3_BASE_REVISION', None)],
        'patterns': None,
        'prefetch': ['voice-design', 'base'],
    },
}


def venvs():
    return Path(os.environ.get('ECCO_AUDIO_VENVS') or AUDIO)


def models_dir():
    return Path(os.environ.get('ECCO_AUDIO_MODELS') or AUDIO / 'models')


def ready_file():
    return Path(os.environ.get('ECCO_AUDIO_READY_FILE') or AUDIO / 'gpu-ready-models.json')


def venv_python(model):
    return venvs() / (model + '-venv') / 'bin' / 'python'


def base_constraints(base_python):
    """Pin the base image's torch/torchaudio so pip never replaces the CUDA build."""
    code = ("import importlib.metadata as m\n"
            "for n in ('torch','torchaudio'):\n"
            "    try: print(n+'=='+m.version(n))\n"
            "    except m.PackageNotFoundError: pass\n")
    return subprocess.run([base_python, '-c', code], capture_output=True, text=True, check=True).stdout.split()


def packages(model, run=subprocess.run):
    spec = MODELS[model]
    default = Path('/opt/ecco-runtime-venv/bin/python')
    base_python = os.environ.get('ECCO_AUDIO_BASE_PYTHON') or (str(default) if default.is_file() else sys.executable)
    env_dir = venvs() / (model + '-venv')
    env_dir.parent.mkdir(parents=True, exist_ok=True)
    if not venv_python(model).is_file():
        run([base_python, '-m', 'venv', '--system-site-packages', str(env_dir)], check=True)
    env_dir.mkdir(parents=True, exist_ok=True)
    pins = base_constraints(base_python)
    constraints = env_dir / 'ecco-constraints.txt'
    constraints.write_text(''.join(p + '\n' for p in pins))
    env = dict(os.environ, PIP_NO_CACHE_DIR='1', PIP_PROGRESS_BAR='off')
    env.pop('PYTHONPATH', None)
    run([str(venv_python(model)), '-m', 'pip', 'install', '-c', str(constraints), *spec['packages']], check=True, env=env)
    if spec.get('source'):
        run([str(venv_python(model)), '-m', 'pip', 'install', '-c', str(constraints), spec['source']], check=True, env=env)
    print('PACKAGES INSTALLED', model, env_dir, flush=True)


def resolve(repo, pinned):
    if pinned:
        return pinned
    from huggingface_hub import HfApi
    return HfApi().model_info(repo).sha


def weights(model):
    from huggingface_hub import snapshot_download
    spec = MODELS[model]
    root = models_dir() / model
    root.mkdir(parents=True, exist_ok=True)
    record = {'repo': spec['repo'], 'revision': resolve(spec['repo'], os.environ.get(spec['revision_env']))}
    snapshot_download(spec['repo'], revision=record['revision'], local_dir=root / spec.get('subdir', ''),
                      **({'allow_patterns': spec['patterns']} if spec['patterns'] else {}))
    record['extras'] = {}
    for name, repo, revision_env, patterns in spec['extras']:
        revision = resolve(repo, os.environ.get(revision_env))
        snapshot_download(repo, revision=revision, local_dir=root / name, **({'allow_patterns': patterns} if patterns else {}))
        record['extras'][name] = {'repo': repo, 'revision': revision}
    (root / 'ecco-install.json').write_text(json.dumps(record, indent=2))
    for folder in spec.get('prefetch', []):
        # Load once with the hub online so anything the model pulls at start-up lands in the workers' hf-cache.
        env = dict(os.environ, HF_HOME=str(AUDIO / 'hf-cache'), HF_HUB_OFFLINE='0')
        env.pop('PYTHONPATH', None)
        code = ('import sys, torch\nfrom qwen_tts import Qwen3TTSModel\n'
                'Qwen3TTSModel.from_pretrained(sys.argv[1], device_map="cpu", dtype=torch.bfloat16)\nprint("cached", sys.argv[1])')
        subprocess.run([str(venv_python(model)), '-c', code, str(root / folder)], check=True, env=env)
    print('WEIGHTS DOWNLOADED', model, root, json.dumps(record), flush=True)


SMOKE = {
    'qwen3-tts': [{'text': 'Welcome to the show. Today we have a wonderful story for you.', 'language': 'English', 'voice': 'warm-host-f'},
                  {'text': 'Look, look! A butterfly landed on my nose!', 'language': 'English', 'voice': 'girl-5'},
                  {'text': 'And that, my friends, is how the river found the sea.', 'language': 'English', 'voice': 'warm-host-f'}],
    'svara-tts': [{'text': 'హలో! మా కథకు స్వాగతం.', 'language': 'Telugu', 'voice': 'telugu-female', 'emotion': 'happy'},
                  {'text': 'नमस्ते। आज की कहानी शुरू करते हैं।', 'language': 'Hindi', 'voice': 'hindi-male'}],
}


def smoke(model, run=subprocess.run):
    if model not in SMOKE:
        raise SystemExit(model + ' has no worker adapter yet, so it cannot be advertised. See audio/README.md.')
    directory = AUDIO / 'gpu-verification' / model
    directory.mkdir(parents=True, exist_ok=True)
    (directory / 'request.json').write_text(json.dumps({'compute': os.environ.get('ECCO_AUDIO_COMPUTE', 'b200'), 'model': model, 'lines': SMOKE[model]}))
    env = dict(os.environ, HF_HUB_OFFLINE='1', HF_HOME=str(AUDIO / 'hf-cache'))
    env.pop('PYTHONPATH', None)
    run([str(venv_python(model)), str(AUDIO / 'modern_worker.py'), '--request', str(directory / 'request.json'),
         '--runtime', str(models_dir()), '--output', str(directory / 'output.wav')], check=True, env=env, timeout=1800, cwd=str(AUDIO))
    output = directory / 'output.wav'
    if not output.is_file() or output.stat().st_size <= 44:
        raise SystemExit('Smoke test produced no audio.')
    path = ready_file()
    current = json.loads(path.read_text()) if path.exists() else []
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(sorted(set(current + [model]))))
    temporary.replace(path)
    print('PASS', model, output, flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('step', choices=['packages', 'weights', 'smoke'])
    parser.add_argument('model', choices=MODELS)
    args = parser.parse_args()
    {'packages': packages, 'weights': weights, 'smoke': smoke}[args.step](args.model)
