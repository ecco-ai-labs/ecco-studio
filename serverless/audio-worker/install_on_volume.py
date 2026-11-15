"""Install speech, sound and listen-back models onto the global volume from a Serverless audio worker.

Runs inside an install job (handler.py, input {"install": {"commit": <sha>, "steps": [...]}}) from a
copy of the repository at that commit, so no pod is needed. The worker has a GPU, the pods' runtime
(/opt/ecco-runtime-venv) and the volume at /runpod-volume. The volume cannot execute files or keep
executable bits, so every Python environment is built on the worker's local disk, at the exact path
jobs later use, smoke-tested on the GPU, then stored on the volume as one archive (<name>.tar +
.sha256) that handler.py unpacks on new workers.

Steps (run in the order given; each prints one JSON line starting with ECCO_STEP):
  inventory              what is on the volume (models, environments, readiness files, free disk)
  sync-scripts           copy the worker scripts (audio/*.py, model_catalog.json) at this commit to the
                         volume; the previous copies are kept in backup-scripts-<time>/
  pack:<name>            archive an existing environment on the volume (e.g. pack:chatterbox)
  voxcpm2                build voxcpm2-venv, download openbmb/VoxCPM2 if missing, GPU smoke test,
                         then mark ready in gpu-ready-models.json
  chatterbox-hi          download the Hindi Chatterbox finetune to models/chatterbox/hi
  whisper                cache openai/whisper-large-v3-turbo in hf-cache for listen-back
  sound:<model>          ace-step-1.5 or moss-soundeffect-v2: source + weights on the volume, a100-venv
                         built locally, verified with one generation, marked in sound-ready-a100.json
"""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request
import zipfile

SRC = Path(__file__).resolve().parents[2]  # repository root at the requested commit
VOL = Path(os.getenv('ECCO_VOLUME', '/runpod-volume')) / 'ecco-audio'
AUDIO = Path(os.getenv('ECCO_AUDIO_ROOT', '/workspace/ecco-audio'))
LOCAL = Path(os.getenv('ECCO_LOCAL_VENVS', '/opt/ecco-audio-venvs'))
RUNTIME_PY = Path('/opt/ecco-runtime-venv/bin/python')
sys.path.insert(0, str(SRC / 'audio'))

VOXCPM_SOURCE = 'git+https://github.com/OpenBMB/VoxCPM@cce58a5b59303c9bd63d12f23afe6a49a4a80c59'
VOXCPM_PACKAGES = ['transformers==4.51.3', 'huggingface_hub<1', 'librosa==0.11.0', 'soundfile', 'einops',
                   'pydantic>=2', 'safetensors', 'sentencepiece', 'tqdm', 'addict']
WEIGHT_PATTERNS = ['*.json', '*.safetensors', '*.model', '*.txt', '*.tiktoken', '*.pth', 'LICENSE*', '*.md']
SOUND_MODELS = ('ace-step-1.5', 'moss-soundeffect-v2')


def log(*parts):
    print(*parts, flush=True)


def step_result(name, **fields):
    print('ECCO_STEP ' + json.dumps(dict(step=name, **fields)), flush=True)


def run(command, **kwargs):
    log('$', ' '.join(str(c) for c in command))
    subprocess.run([str(c) for c in command], check=True, **kwargs)


def clean_env(**extra):
    env = dict(os.environ, PIP_NO_CACHE_DIR='1', PIP_PROGRESS_BAR='off', HF_HUB_OFFLINE='0', TRANSFORMERS_OFFLINE='0',
               HF_HUB_ENABLE_HF_TRANSFER='0')
    env.pop('PYTHONPATH', None)
    env.update(extra)
    return env


def read_json(path, default):
    try:
        return json.loads(Path(path).read_text())
    except (OSError, ValueError):
        return default


def write_json(path, value):
    path = Path(path)
    temporary = path.with_name(path.name + '.tmp')
    temporary.write_text(json.dumps(value, indent=2))
    temporary.replace(path)


def mark_ready(name, model):
    path = VOL / name
    write_json(path, sorted(set(read_json(path, []) + [model])))


def sha256_file(path):
    digest = hashlib.sha256()
    with open(path, 'rb') as source:
        for chunk in iter(lambda: source.read(1 << 24), b''):
            digest.update(chunk)
    return digest.hexdigest()


def pack_dir(parent, name, archive):
    """<archive> holds <name>/... (handler.py unpacks with --strip-components=1); checksum beside it."""
    archive = Path(archive)
    archive.parent.mkdir(parents=True, exist_ok=True)
    temporary = archive.with_name(archive.name + '.partial')
    run(['tar', '-cf', temporary, '-C', parent, name])
    checksum = sha256_file(temporary)
    temporary.replace(archive)
    archive.with_name(archive.name + '.sha256').write_text(checksum + '  ' + archive.name + '\n')
    return checksum


def base_constraints():
    code = ("import importlib.metadata as m\n"
            "for n in ('torch','torchaudio'):\n"
            "    try: print(n+'=='+m.version(n))\n"
            "    except m.PackageNotFoundError: pass\n")
    return subprocess.run([str(RUNTIME_PY), '-c', code], capture_output=True, text=True, check=True).stdout.split()


def link(target, path):
    path = Path(path)
    if path.is_symlink() or path.is_file():
        path.unlink()
    elif path.is_dir():
        shutil.rmtree(path)
    path.symlink_to(target)


def free_gb(path):
    try:
        return round(shutil.disk_usage(path).free / 1e9, 1)
    except OSError:
        return None


def gpu_name():
    try:
        return subprocess.run(['nvidia-smi', '--query-gpu=name,memory.total', '--format=csv,noheader'],
                              capture_output=True, text=True, timeout=30).stdout.strip()
    except (OSError, subprocess.SubprocessError):
        return None


# ---------------------------------------------------------------- steps

def inventory():
    def entries(folder, depth=1):
        folder = Path(folder)
        if not folder.is_dir():
            return None
        out = {}
        for item in sorted(folder.iterdir()):
            if item.is_dir():
                out[item.name + '/'] = entries(item, depth - 1) if depth > 1 else len(list(item.iterdir()))
            else:
                out[item.name] = item.stat().st_size
        return out
    hub = VOL / 'hf-cache' / 'hub'
    result = {
        'top': entries(VOL),
        'models': entries(VOL / 'models', 2),
        'sounds': entries(VOL / 'sounds', 2),
        'hf_cache': sorted(p.name for p in hub.iterdir()) if hub.is_dir() else None,
        'gpu_ready': read_json(VOL / 'gpu-ready-models.json', None),
        'sound_ready': read_json(VOL / 'sound-ready-a100.json', None),
        'packed': sorted(p.name for p in VOL.glob('*-venv.tar')),
        'free_gb': {'local': free_gb('/opt'), 'tmp': free_gb('/tmp')},
        'gpu': gpu_name(),
    }
    step_result('inventory', **result)


def sync_scripts():
    backup = VOL / ('backup-scripts-' + time.strftime('%Y%m%d-%H%M%S'))
    backup.mkdir()
    copied = []
    for source in sorted((SRC / 'audio').glob('*.py')) + [SRC / 'audio' / 'model_catalog.json']:
        if source.name.startswith('test_'):
            continue
        target = VOL / source.name
        if target.is_file():
            shutil.copyfile(target, backup / source.name)
        shutil.copyfile(source, target)
        copied.append(source.name)
    step_result('sync-scripts', copied=len(copied), backup=backup.name)


def pack(name):
    name = name if name.endswith('-venv') else name + '-venv'
    venv = VOL / name
    if not (venv / 'pyvenv.cfg').is_file():
        raise SystemExit(name + ' is not on the volume.')
    began = time.time()
    checksum = pack_dir(VOL, name, VOL / (name + '.tar'))
    step_result('pack', venv=name, sha256=checksum, seconds=round(time.time() - began))


def publish_speech_venv(name):
    """Archive a locally built speech environment onto the volume and leave the marker handler.py needs."""
    local = LOCAL / name
    pack_dir(LOCAL, name, VOL / (name + '.tar'))
    marker = VOL / name
    if marker.is_symlink() or marker.is_file():
        marker.unlink()
    marker.mkdir(exist_ok=True)
    shutil.copyfile(local / 'pyvenv.cfg', marker / 'pyvenv.cfg')
    (marker / 'PACKED-SEE-TAR.txt').write_text('This environment is stored in ' + name + '.tar; workers unpack it locally.\n')


def build_venv(name, packages, extra=None):
    """Create LOCAL/<name> on top of the runtime's CUDA torch and link it into the audio folder."""
    env_dir = LOCAL / name
    if env_dir.exists() and not (env_dir / 'pyvenv.cfg').is_file():
        shutil.rmtree(env_dir)
    LOCAL.mkdir(parents=True, exist_ok=True)
    if not (env_dir / 'bin' / 'python').exists():
        run([RUNTIME_PY, '-m', 'venv', '--system-site-packages', env_dir])
    constraints = env_dir / 'ecco-constraints.txt'
    constraints.write_text(''.join(p + '\n' for p in base_constraints()))
    python = env_dir / 'bin' / 'python'
    run([python, '-m', 'pip', 'install', '-c', constraints, *packages], env=clean_env())
    for args in extra or []:
        run([python, '-m', 'pip', 'install', '-c', constraints, *args], env=clean_env())
    link(env_dir, AUDIO / name)
    return python


def download(python, repo, dest, patterns=None, revision=None):
    code = ('import json,sys\nfrom huggingface_hub import HfApi,snapshot_download\n'
            'repo,dest,patterns,revision=sys.argv[1],sys.argv[2],json.loads(sys.argv[3]),sys.argv[4] or None\n'
            'revision=revision or HfApi().model_info(repo).sha\n'
            'snapshot_download(repo,revision=revision,local_dir=dest,**({"allow_patterns":patterns} if patterns else {}))\n'
            'print("ECCO_REVISION="+revision)\n')
    out = subprocess.run([str(python), '-c', code, repo, str(dest), json.dumps(patterns), revision or ''],
                         check=True, capture_output=True, text=True, env=clean_env())
    return next(line.split('=', 1)[1] for line in out.stdout.splitlines() if line.startswith('ECCO_REVISION='))


def smoke_speech(model, python, lines):
    directory = Path(tempfile.mkdtemp(prefix='smoke-' + model + '-'))
    (directory / 'request.json').write_text(json.dumps({'compute': 'a100', 'model': model, 'lines': lines}))
    env = clean_env(HF_HUB_OFFLINE='1', HF_HOME=str(AUDIO / 'hf-cache'))
    began = time.time()
    run([python, AUDIO / 'modern_worker.py', '--request', directory / 'request.json', '--runtime', AUDIO / 'models',
         '--output', directory / 'output.wav'], env=env, cwd=str(AUDIO), timeout=1800)
    output = directory / 'output.wav'
    if not output.is_file() or output.stat().st_size <= 44:
        raise SystemExit(model + ' smoke test produced no audio.')
    import wave
    with wave.open(str(output)) as f:
        seconds = round(f.getnframes() / f.getframerate(), 2)
    return seconds, round(time.time() - began)


def voxcpm2():
    python = build_venv('voxcpm2-venv', VOXCPM_PACKAGES, extra=[['--no-deps', VOXCPM_SOURCE]])
    weights = VOL / 'models' / 'voxcpm2'
    record = read_json(weights / 'ecco-install.json', {})
    if not (weights / 'config.json').is_file():
        weights.mkdir(parents=True, exist_ok=True)
        revision = download(python, 'openbmb/VoxCPM2', weights, WEIGHT_PATTERNS)
        record = {'repo': 'openbmb/VoxCPM2', 'revision': revision, 'source': VOXCPM_SOURCE}
        write_json(weights / 'ecco-install.json', record)
    seconds, took = smoke_speech('voxcpm2', python, [
        {'text': 'Welcome to our story. The merchant smiled as he stepped through the door.', 'language': 'English', 'voice': 'mar_m'},
        {'text': 'हमारी कहानी में आपका स्वागत है। आराम से बैठिए और सुनिए।', 'language': 'Hindi', 'voice': 'kan_f'}])
    publish_speech_venv('voxcpm2-venv')
    mark_ready('gpu-ready-models.json', 'voxcpm2')
    step_result('voxcpm2', ready=True, audio_seconds=seconds, smoke_seconds=took, revision=record.get('revision'))


def chatterbox_hi():
    python = AUDIO / 'chatterbox-venv' / 'bin' / 'python'
    if not python.exists():
        raise SystemExit('The Chatterbox environment is not prepared on this worker.')
    dest = VOL / 'models' / 'chatterbox' / 'hi'
    dest.mkdir(parents=True, exist_ok=True)
    revision = download(python, 'ResembleAI/Chatterbox-Multilingual-hi', dest)
    write_json(dest / 'ecco-install.json', {'repo': 'ResembleAI/Chatterbox-Multilingual-hi', 'revision': revision})
    files = {p.relative_to(dest).as_posix(): p.stat().st_size for p in dest.rglob('*') if p.is_file() and '.cache' not in p.parts}
    configs = {name: (dest / name).read_text()[:2000] for name in files if name.endswith(('.json', '.md', '.yaml')) and files[name] < 20000}
    step_result('chatterbox-hi', revision=revision, files=files, configs=configs)


def whisper():
    hub = VOL / 'hf-cache' / 'hub'
    present = (hub / 'models--openai--whisper-large-v3-turbo').is_dir()
    if not present:
        python = AUDIO / 'indicf5-venv' / 'bin' / 'python'
        if not python.exists():
            raise SystemExit('The IndicF5 environment is not prepared on this worker.')
        hub.mkdir(parents=True, exist_ok=True)
        code = ('import sys\nfrom huggingface_hub import snapshot_download\n'
                'print(snapshot_download("openai/whisper-large-v3-turbo", cache_dir=sys.argv[1]))\n')
        run([python, '-c', code, hub], env=clean_env())
    step_result('whisper', ready=True, already_present=present)


def fetch_source(model, dest):
    from install_sound_models import SOURCES
    repo, revision, _ = SOURCES[model]
    if (dest / 'pyproject.toml').is_file() or any(dest.glob('*/pyproject.toml')):
        return
    with tempfile.TemporaryDirectory() as temp:
        archive = Path(temp) / 'source.zip'
        urllib.request.urlretrieve('https://codeload.github.com/' + repo + '/zip/' + revision, archive)
        with zipfile.ZipFile(archive) as package:
            for item in package.infolist():
                if Path(item.filename).is_absolute() or '..' in Path(item.filename).parts:
                    raise ValueError('Invalid upstream source archive.')
            package.extractall(temp)
        top = [p for p in Path(temp).iterdir() if p.is_dir()]
        if len(top) != 1:
            raise ValueError('Unexpected upstream source layout.')
        if dest.exists():
            shutil.rmtree(dest)
        shutil.copytree(top[0], dest, symlinks=True)


def sound(model):
    if model not in SOUND_MODELS:
        raise SystemExit('Unknown sound model ' + model)
    volume_base = VOL / 'sounds' / model
    weights = volume_base / 'weights'
    if weights.is_symlink() or (weights.exists() and not weights.is_dir()):
        # The volume cannot store links: a CPU pod's weights link arrives as an empty file.
        weights.unlink()
    weights.mkdir(parents=True, exist_ok=True)
    fetch_source(model, volume_base / 'source')
    # Local working folder at the path jobs use: source and weights live on the volume, the
    # environment is built here and archived to the volume afterwards.
    sounds = AUDIO / 'sounds'
    if sounds.is_symlink():
        sounds.unlink()
    base = sounds / model
    base.mkdir(parents=True, exist_ok=True)
    # A warm worker may already hold links into the volume for this model (handler.py); the install
    # works on local files, so drop every link and relink only source and weights.
    for item in list(base.iterdir()):
        if item.is_symlink():
            item.unlink()
    link(volume_base / 'weights', base / 'weights')
    # Build against a local copy of the source: setuptools writes and renames temporary egg-info files
    # in the source tree, which the volume refuses. Jobs later read the same files from the volume.
    if (base / 'source').is_dir() and not (base / 'source').is_symlink():
        shutil.rmtree(base / 'source')  # left by an earlier attempt on this worker
    shutil.copytree(volume_base / 'source', base / 'source', symlinks=True)
    if (volume_base / 'manifest.json').is_file():
        shutil.copyfile(volume_base / 'manifest.json', base / 'manifest.json')
    env = clean_env()
    began = time.time()
    run([RUNTIME_PY, SRC / 'audio' / 'install_sound_models.py', 'install', '--model', model, '--compute', 'a100',
         '--root', AUDIO], env=env, cwd=str(SRC / 'audio'))
    for name in ('manifest.json', 'dependencies-a100.txt'):
        if (base / name).is_file():
            shutil.copyfile(base / name, volume_base / name)
    if model == 'ace-step-1.5':
        # ACE-Step checks for its whole main model at start-up and otherwise downloads it, then copies
        # its model code into the checkpoint with shutil.copy2 - which the volume refuses (it cannot set
        # file times). Do both here, online, with plain copies, so workers find everything in place.
        code = ('import shutil, sys\nfrom pathlib import Path\n'
                'shutil.copy2 = lambda src, dst, *a, **k: shutil.copyfile(src, dst if not Path(dst).is_dir() else Path(dst) / Path(src).name)\n'
                'from acestep.model_downloader import download_main_model\n'
                'print("ACE-Step main model:", download_main_model(Path(sys.argv[1]), force=False))\n'
                'import acestep.model_downloader as m\n'
                'for c in m.MAIN_MODEL_COMPONENTS:\n'
                '    if c in m._CHECKPOINT_TO_VARIANT: print("synced", c, m._sync_model_code_files(c, Path(sys.argv[1])))\n')
        run([base / 'a100-venv' / 'bin' / 'python', '-c', code, base / 'weights'], env=env, cwd=str(base / 'source'))
    shutil.rmtree(base / 'source')
    link(volume_base / 'source', base / 'source')
    install_seconds = round(time.time() - began)
    began = time.time()
    run([RUNTIME_PY, SRC / 'audio' / 'install_sound_models.py', 'verify', '--model', model, '--compute', 'a100',
         '--root', AUDIO], env=dict(env, HF_HUB_OFFLINE='1', TRANSFORMERS_OFFLINE='1'), cwd=str(SRC / 'audio'))
    pack_dir(base, 'a100-venv', volume_base / 'a100-venv.tar')
    mark_ready('sound-ready-a100.json', model)
    step_result('sound', model=model, ready=True, install_seconds=install_seconds, verify_seconds=round(time.time() - began),
                revision=read_json(volume_base / 'manifest.json', {}).get('model_revision'))


def main(steps):
    failures = 0
    for item in steps:
        name, _, argument = item.partition(':')
        log('=== ' + item)
        try:
            if name == 'inventory':
                inventory()
            elif name == 'sync-scripts':
                sync_scripts()
            elif name == 'pack':
                pack(argument)
            elif name == 'voxcpm2':
                voxcpm2()
            elif name == 'chatterbox-hi':
                chatterbox_hi()
            elif name == 'whisper':
                whisper()
            elif name == 'sound':
                sound(argument)
            else:
                raise SystemExit('Unknown step ' + item)
        except (Exception, SystemExit) as exc:
            failures += 1
            step_result(item, error=str(exc)[:1500])
    return 1 if failures else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
