"""Explicit CPU-only installer; installation never advertises inference readiness."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys

REPOS = {'kokoro': 'hexgrad/Kokoro-82M', 'voxcpm2': 'openbmb/VoxCPM2', 'indic-parler': 'ai4bharat/indic-parler-tts'}
SOURCES = {'voxcpm2': 'git+https://github.com/OpenBMB/VoxCPM@cce58a5b59303c9bd63d12f23afe6a49a4a80c59',
           'indic-parler': 'git+https://github.com/huggingface/parler-tts@d108732cd57788ec86bc857d99a6cabd66663d68'}

def install(model):
    root = Path(__file__).resolve().parent
    base = Path('/opt/ecco-audio-cpu')
    shared = base/'cpu-base-venv/lib/python3.12/site-packages'
    if not shared.is_dir():
        raise RuntimeError('Install the existing CPU base runtime first.')
    pod = os.environ.get('RUNPOD_POD_ID', 'local')
    if not pod.isalnum():
        raise RuntimeError('Invalid worker identity.')
    envdir = root/'cpu-model-runtimes'/pod/model
    envdir.parent.mkdir(parents=True, exist_ok=True)
    if not (envdir/'bin/python').is_file():
        subprocess.run(['python3.12', '-m', 'venv', str(envdir)], check=True)
    (envdir/'lib/python3.12/site-packages/ecco_cpu_shared.pth').write_text(str(shared)+'\n')
    link = base/('cpu-'+model+'-venv')
    if link.exists() and link.resolve() != envdir:
        raise RuntimeError('An existing model runtime needs an explicit upgrade; it was not replaced.')
    if not link.exists():
        link.symlink_to(envdir, target_is_directory=True)
    python = str(envdir/'bin/python')
    env = dict(os.environ, CUDA_VISIBLE_DEVICES='', PIP_NO_CACHE_DIR='1', PIP_PROGRESS_BAR='off',
               HF_HUB_ENABLE_HF_TRANSFER='0', HF_HUB_OFFLINE='0', TRANSFORMERS_OFFLINE='0')
    env.pop('PYTHONPATH', None)
    def pip(*packages, constraints=True):
        subprocess.run([python, '-m', 'pip', 'install', *(['-c', str(base/'cpu-model-constraints.txt')] if constraints else []), *packages], check=True, env=env)
    if model == 'kokoro':
        pip('kokoro==0.9.4', 'misaki[en,ja,zh]==0.9.4', 'spacy==3.8.7', 'soundfile', 'huggingface_hub<1', 'transformers==4.51.3')
        subprocess.run(['apt-get', 'update', '-qq'], check=True)
        subprocess.run(['apt-get', 'install', '-y', '-qq', 'espeak-ng'], check=True)
        subprocess.run([python, '-m', 'spacy', 'download', 'en_core_web_sm'], check=True, env=env)
    elif model == 'voxcpm2':
        pip('transformers==4.51.3', 'huggingface_hub<1', 'librosa==0.11.0', 'soundfile', 'einops', 'pydantic>=2', 'safetensors', 'sentencepiece', 'tqdm', 'addict')
        pip('--no-deps', SOURCES[model])
    else:
        pip('transformers==4.46.1', 'huggingface_hub<1', 'accelerate', 'sentencepiece', 'protobuf', 'soundfile', 'descript-audio-codec')
        pip('--no-deps', SOURCES[model])
    # Resolve once, then download the immutable revision and record it. No auth bypass.
    subprocess.run([python, str(Path(__file__)), '--download', model], check=True, env=env)
    print('INSTALLED; CPU inference verification still required:', model, flush=True)

def download(model):
    from huggingface_hub import HfApi, snapshot_download
    root = Path(__file__).resolve().parent/'models'/model
    revision = HfApi().model_info(REPOS[model]).sha
    patterns = ['*.json', '*.safetensors', '*.model', '*.txt', '*.tiktoken', '*.pth', 'voices/*.pt', 'LICENSE*', '*.md']
    snapshot_download(REPOS[model], revision=revision, local_dir=root, allow_patterns=patterns)
    extra = None
    if model == 'indic-parler':
        import parler_tts
        from transformers import AutoConfig, AutoTokenizer
        config = AutoConfig.from_pretrained(root, local_files_only=True)
        repo = config.text_encoder._name_or_path
        sha = HfApi().model_info(repo).sha
        AutoTokenizer.from_pretrained(repo, revision=sha).save_pretrained(root/'description-tokenizer')
        extra = {'repo': repo, 'revision': sha}
    (root/'ecco-install.json').write_text(json.dumps({'repo': REPOS[model], 'revision': revision, 'source': SOURCES.get(model, 'kokoro==0.9.4'), 'description_tokenizer': extra}, indent=2))

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('model', choices=REPOS)
    parser.add_argument('--download', action='store_true')
    args = parser.parse_args()
    (download if args.download else install)(args.model)
