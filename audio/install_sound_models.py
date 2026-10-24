"""Explicit installation/verification; never starts or provisions compute."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import urllib.request
import zipfile

from audio_queue import read, write
from sound_schema import MODELS

SOURCES = {
    'moss-soundeffect-v2': ('OpenMOSS/MOSS-TTS', '934d6826b084c46a0d033402174d5f8ac4ed2519', 'OpenMOSS-Team/MOSS-SoundEffect-v2.0'),
    'ace-step-1.5': ('ace-step/ACE-Step-1.5', 'ca1e85fe9430179831e6bc6be790c332190a3866', 'ACE-Step/Ace-Step1.5'),
}

def run(command, **kwargs):
    subprocess.run([str(v) for v in command], check=True, **kwargs)

def install(model, compute, root):
    import tomllib
    repo, revision, weights = SOURCES[model]
    base = root / 'sounds' / model
    base.mkdir(parents=True, exist_ok=True)
    source = base / 'source'
    if not source.exists():
        with tempfile.TemporaryDirectory(dir=base) as temp:
            archive = Path(temp) / 'source.zip'
            urllib.request.urlretrieve('https://codeload.github.com/' + repo + '/zip/' + revision, archive)
            with zipfile.ZipFile(archive) as package:
                for item in package.infolist():
                    if Path(item.filename).is_absolute() or '..' in Path(item.filename).parts:
                        raise ValueError('Invalid upstream source archive.')
                package.extractall(temp)
            candidates = [p for p in Path(temp).iterdir() if p.is_dir()]
            if len(candidates) != 1:
                raise ValueError('Unexpected upstream source layout.')
            candidates[0].replace(source)
    runtime = base / (compute + '-venv')
    run([sys.executable, '-m', 'venv', runtime])
    python = runtime / 'bin/python'
    torch_version = '2.9.0' if model == 'moss-soundeffect-v2' else '2.10.0'
    vision_version = '0.24.0' if model == 'moss-soundeffect-v2' else '0.25.0'
    run([python, '-m', 'pip', 'install', '--upgrade', 'pip'])
    run([python, '-m', 'pip', 'install', '--index-url', 'https://download.pytorch.org/whl/' + ('cpu' if compute == 'cpu' else 'cu128'),
         'torch==' + torch_version, 'torchaudio==' + torch_version, 'torchvision==' + vision_version])
    project = source / 'moss_soundeffect_v2' if model == 'moss-soundeffect-v2' else source
    dependencies = tomllib.loads((project / 'pyproject.toml').read_text())['project']['dependencies']
    # Optional GPU/LM/training stacks are not used for caption-only instrumental inference.
    excluded = ('torch', 'torchvision', 'torchaudio', 'torchao', 'torchcodec', 'nano-vllm', 'mlx', 'peft', 'lycoris', 'lightning', 'tensorboard', 'modelscope')
    runtime_dependencies = [d for d in dependencies if not d.lower().startswith(excluded)]
    run([python, '-m', 'pip', 'install', *runtime_dependencies, 'huggingface_hub', 'soundfile'])
    run([python, '-m', 'pip', 'install', '--no-deps', '-e', project])
    # Resolve once, download that immutable revision and retain provenance.
    manifest = base / 'manifest.json'
    previous = read(manifest, {})
    download = """import json,sys
from huggingface_hub import HfApi,snapshot_download
repo,dest,previous=sys.argv[1:]
revision=previous or HfApi().model_info(repo).sha
patterns=None if repo.startswith('OpenMOSS') else ['acestep-v15-turbo/*','vae/*','Qwen3-Embedding-0.6B/*','README.md','LICENSE*']
snapshot_download(repo,revision=revision,local_dir=dest,allow_patterns=patterns)
print('ECCO_REVISION='+revision)
"""
    result = subprocess.run([str(python), '-c', download, weights, str(base / 'weights'), previous.get('model_revision', '')], check=True, capture_output=True, text=True)
    pin = next(line.split('=', 1)[1] for line in result.stdout.splitlines() if line.startswith('ECCO_REVISION='))
    write(manifest, dict(source_revision=revision, model_revision=pin, model_repository=weights))
    with (base / ('dependencies-' + compute + '.txt')).open('w') as output:
        run([python, '-m', 'pip', 'freeze'], stdout=output)
    print(json.dumps({'installed': model, 'compute': compute, 'verified': False, 'model_revision': pin}))

def verify(model, compute, root):
    # Protect the persistent coordinator from memory pressure during CPU qualification.
    limit = Path('/sys/fs/cgroup/memory.max')
    if compute == 'cpu' and limit.exists() and limit.read_text().strip().isdigit() and int(limit.read_text()) < 16 * 1024**3:
        raise RuntimeError('This sound runtime needs qualification on a CPU worker with at least 16 GB RAM, or on a connected A100/B200. No model was loaded.')
    directory = root / 'sounds' / model / ('verification-' + compute + '-' + str(time.time_ns()))
    directory.mkdir(parents=True)
    music = model == 'ace-step-1.5'
    request = dict(kind='music' if music else 'effect', model=model, compute=compute, duration=10 if music else 3,
                   seed=41, description='Gentle instrumental acoustic oud and soft hand percussion, calm desert atmosphere, no vocals.' if music else 'A gentle magical whoosh followed by a soft shimmering chime, clean isolated sound, no speech.')
    write(directory / 'request.json', request)
    env = dict(os.environ, ECCO_AUDIO_CPU_THREADS='1', OMP_NUM_THREADS='1', MALLOC_ARENA_MAX='2')
    if compute == 'cpu':
        env['CUDA_VISIBLE_DEVICES'] = ''
    run([root / 'sounds' / model / (compute + '-venv/bin/python'), root / 'sound_worker.py',
         '--request', directory / 'request.json', '--runtime', root / 'sounds', '--output', directory / 'output.wav'], env=env, timeout=1800)
    import wave
    with wave.open(str(directory / 'output.wav')) as f:
        seconds = f.getnframes() / f.getframerate()
        if seconds < request['duration'] * .9:
            raise RuntimeError('Sound qualification returned an incomplete recording.')
    ready = root / ('sound-ready-' + compute + '.json')
    write(ready, sorted(set(read(ready, []) + [model])))
    print(json.dumps({'verified': model, 'compute': compute, 'seconds': seconds, 'sample': str(directory / 'output.wav'), 'listening_review': 'pending'}))

if __name__ == '__main__':
    p = argparse.ArgumentParser()
    p.add_argument('action', choices=('install', 'verify'))
    p.add_argument('--model', choices=MODELS, required=True)
    p.add_argument('--compute', choices=('cpu', 'a100', 'b200'), required=True)
    p.add_argument('--root', type=Path, default=Path('/workspace/ecco-audio'))
    a = p.parse_args()
    (install if a.action == 'install' else verify)(a.model, a.compute, a.root)
