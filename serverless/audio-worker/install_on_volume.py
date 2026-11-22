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
  pack:<name>            archive an existing environment on the volume (e.g. pack:chatterbox); slow for
                         large environments because it reads every small file from the volume
  rebuild:<name>         chatterbox or indicf5: rebuild the environment on local disk with the exact package
                         versions found in the volume copy, GPU smoke test, archive (fast replacement for pack)
  voxcpm2                build voxcpm2-venv, download openbmb/VoxCPM2 if missing, GPU smoke test,
                         then mark ready in gpu-ready-models.json
  kokoro                 build kokoro-venv (misaki G2P with bundled espeak-ng, spaCy English), download
                         hexgrad/Kokoro-82M with its voices, GPU smoke test (English + Hindi), mark ready.
                         Images built before this step existed accept it as rebuild:kokoro.
  qwen3-tts              build qwen3-tts-venv, download Qwen3-TTS-12Hz-1.7B VoiceDesign (a voice from a
                         description) and Base (every line cloned from that voice) to models/qwen3-tts/voice-design
                         and models/qwen3-tts/base, cache the speech tokenizer in hf-cache, GPU smoke test, mark
                         ready. Images built before this step existed accept it as rebuild:qwen3-tts.
  indic-parler           build indic-parler-venv, download ai4bharat/indic-parler-tts and its description
                         tokenizer to models/indic-parler, GPU smoke test, mark ready (or rebuild:indic-parler)
  svara-tts              build svara-tts-venv, download kenpath/svara-tts-v1 and the SNAC 24 kHz decoder to
                         models/svara-tts, GPU smoke test, mark ready (or rebuild:svara-tts)
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
KOKORO_PACKAGES = ['kokoro==0.9.4', 'misaki[en,ja,zh]==0.9.4', 'spacy==3.8.7', 'preshed==3.0.10', 'soundfile',
                   'huggingface_hub<1', 'transformers==4.51.3', 'click>=8.1']
# spaCy's English model as a pinned wheel, so the first job never tries to download it.
SPACY_EN = 'https://github.com/explosion/spacy-models/releases/download/en_core_web_sm-3.8.0/en_core_web_sm-3.8.0-py3-none-any.whl'
KOKORO_PATTERNS = ['config.json', 'kokoro-v1_0.pth', 'voices/*.pt', 'LICENSE*', '*.md']
# Same packages as the pod installer (audio/install_gpu_voice_models.py); qwen-tts brings its own transformers pin
# and torch/torchaudio come from the runtime (constraints).
QWEN3_PACKAGES = ['qwen-tts', 'soundfile', 'huggingface_hub', 'accelerate']
QWEN3_REPOS = (('voice-design', 'Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign'), ('base', 'Qwen/Qwen3-TTS-12Hz-1.7B-Base'))
# Indic Parler-TTS: same packages as the CPU pod installer (audio/install_voice_models.py), on the runtime's CUDA torch.
PARLER_SOURCE = 'git+https://github.com/huggingface/parler-tts@d108732cd57788ec86bc857d99a6cabd66663d68'
PARLER_PACKAGES = ['transformers==4.46.1', 'huggingface_hub<1', 'accelerate', 'sentencepiece', 'protobuf', 'soundfile',
                   'descript-audio-codec']
PARLER_SMOKE = [{'text': 'Welcome to our story. Settle down and listen.', 'language': 'English', 'voice': 'english-mary'},
                {'text': 'नमस्ते। आज की कहानी शुरू करते हैं।', 'language': 'Hindi', 'voice': 'hindi-rohit'}]
# svara-TTS: same packages and weights as the GPU pod installer (audio/install_gpu_voice_models.py).
SVARA_PACKAGES = ['numpy==1.26.4', 'transformers==4.51.3', 'accelerate', 'safetensors', 'sentencepiece', 'soundfile',
                  'huggingface_hub<1', 'snac']
SVARA_PATTERNS = ['*.json', '*.safetensors', 'tokenizer*', '*.model', '*.txt', 'LICENSE*', '*.md']
SVARA_SMOKE = [{'text': 'హలో! మా కథకు స్వాగతం.', 'language': 'Telugu', 'voice': 'telugu-female', 'emotion': 'happy'},
               {'text': 'नमस्ते। आज की कहानी शुरू करते हैं।', 'language': 'Hindi', 'voice': 'hindi-male'}]
QWEN3_SMOKE = [{'text': 'Welcome to the show. Today we have a wonderful story for you.', 'language': 'English', 'voice': 'warm-host-f'},
               {'text': 'Look, look! A butterfly landed on my nose!', 'language': 'English', 'voice': 'girl-5'},
               {'text': 'And that, my friends, is how the river found the sea.', 'language': 'English', 'voice': 'warm-host-f'}]


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


REBUILD_SMOKE = {
    'chatterbox': [{'text': 'Welcome to the show. Today we have a wonderful story for you.', 'language': 'English', 'voice': 'default'},
                   {'text': 'नमस्ते। आज की कहानी शुरू करते हैं।', 'language': 'Hindi', 'voice': 'default'}],
    'indicf5': [{'text': 'नमस्ते, आज की कहानी शुरू करते हैं।', 'language': 'Hindi', 'voice': 'kan_f'}],
}


def installed_packages(venv):
    """name==version pins (and git sources) of a venv on the volume, read from its dist-info folders."""
    sites = list((venv / 'lib').glob('python3*/site-packages'))
    if not sites:
        raise SystemExit('No site-packages in ' + str(venv))
    pins, skipped = [], []
    for info in sorted(sites[0].glob('*.dist-info')):
        try:
            meta = (info / 'METADATA').read_text(errors='replace')
        except OSError:
            continue
        fields = dict(line.split(': ', 1) for line in meta.splitlines()[:20] if ': ' in line)
        name, version = fields.get('Name'), fields.get('Version')
        if not name or not version or name.lower() in ('pip', 'setuptools', 'wheel', 'torch', 'torchaudio'):
            continue
        direct = read_json(info / 'direct_url.json', None)
        if direct and direct.get('vcs_info'):
            pins.append('git+' + direct['url'] + '@' + direct['vcs_info']['commit_id'])
        elif direct and direct.get('dir_info'):
            skipped.append(name)
        else:
            pins.append(name + '==' + version)
    return pins, skipped


def rebuild(name):
    if name not in REBUILD_SMOKE:
        raise SystemExit('rebuild supports ' + ', '.join(REBUILD_SMOKE))
    venv_name = name + '-venv'
    pins, skipped = installed_packages(VOL / venv_name)
    env_dir = LOCAL / venv_name
    if (AUDIO / venv_name).is_symlink() and (AUDIO / venv_name).resolve() == env_dir.resolve() and env_dir.exists():
        shutil.rmtree(env_dir)  # rebuild from scratch even on a warm worker
    if env_dir.exists():
        shutil.rmtree(env_dir)
    LOCAL.mkdir(parents=True, exist_ok=True)
    run([RUNTIME_PY, '-m', 'venv', '--system-site-packages', env_dir])
    constraints = env_dir / 'ecco-constraints.txt'
    constraints.write_text(''.join(p + '\n' for p in base_constraints()))
    python = env_dir / 'bin' / 'python'
    began = time.time()
    run([python, '-m', 'pip', 'install', '--no-deps', '-c', constraints, *pins], env=clean_env())
    link(env_dir, AUDIO / venv_name)
    directory = Path(tempfile.mkdtemp(prefix='smoke-' + name + '-'))
    (directory / 'request.json').write_text(json.dumps({'compute': 'a100', 'model': name, 'lines': REBUILD_SMOKE[name]}))
    run([python, AUDIO / 'extra_worker.py', '--request', directory / 'request.json', '--runtime', AUDIO / 'models',
         '--output', directory / 'output.wav'], env=clean_env(HF_HUB_OFFLINE='1', HF_HOME=str(AUDIO / 'hf-cache')),
        cwd=str(AUDIO), timeout=1800)
    output = directory / 'output.wav'
    if not output.is_file() or output.stat().st_size <= 44:
        raise SystemExit(name + ' smoke test produced no audio.')
    import wave
    with wave.open(str(output)) as f:
        seconds = round(f.getnframes() / f.getframerate(), 2)
    publish_speech_venv(venv_name)
    step_result('rebuild', venv=venv_name, packages=len(pins), skipped=skipped, audio_seconds=seconds,
                seconds=round(time.time() - began))


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


def kokoro():
    python = build_venv('kokoro-venv', KOKORO_PACKAGES, extra=[[SPACY_EN]])
    weights = VOL / 'models' / 'kokoro'
    record = read_json(weights / 'ecco-install.json', {})
    if not (weights / 'kokoro-v1_0.pth').is_file() or not (weights / 'voices' / 'af_heart.pt').is_file():
        weights.mkdir(parents=True, exist_ok=True)
        revision = download(python, 'hexgrad/Kokoro-82M', weights, KOKORO_PATTERNS)
        record = {'repo': 'hexgrad/Kokoro-82M', 'revision': revision, 'source': 'kokoro==0.9.4'}
        write_json(weights / 'ecco-install.json', record)
    seconds, took = smoke_speech('kokoro', python, [
        {'text': 'Welcome to our story. Settle down and imagine a quiet forest.', 'language': 'English', 'voice': 'af_heart'},
        {'text': 'हमारी कहानी में आपका स्वागत है।', 'language': 'Hindi', 'voice': 'hf_alpha'}])
    publish_speech_venv('kokoro-venv')
    mark_ready('gpu-ready-models.json', 'kokoro')
    step_result('kokoro', ready=True, audio_seconds=seconds, smoke_seconds=took, revision=record.get('revision'))


def qwen3_tts():
    python = build_venv('qwen3-tts-venv', QWEN3_PACKAGES)
    root = VOL / 'models' / 'qwen3-tts'
    record = read_json(root / 'ecco-install.json', {})
    for folder, repo in QWEN3_REPOS:
        if not (root / folder / 'config.json').is_file():
            (root / folder).mkdir(parents=True, exist_ok=True)
            record[folder] = {'repo': repo, 'revision': download(python, repo, root / folder)}
            write_json(root / 'ecco-install.json', record)
    # Load each model once with the hub online, so what it fetches at start-up (its speech tokenizer) is in the
    # volume's hf-cache and offline workers can load it.
    code = ('import sys, torch\nfrom qwen_tts import Qwen3TTSModel\n'
            'Qwen3TTSModel.from_pretrained(sys.argv[1], device_map="cpu", dtype=torch.bfloat16)\nprint("cached", sys.argv[1])')
    for folder, _ in QWEN3_REPOS:
        run([python, '-c', code, root / folder], env=clean_env(HF_HOME=str(AUDIO / 'hf-cache')), cwd=str(AUDIO))
    seconds, took = smoke_speech('qwen3-tts', python, QWEN3_SMOKE)
    publish_speech_venv('qwen3-tts-venv')
    mark_ready('gpu-ready-models.json', 'qwen3-tts')
    version = subprocess.run([str(python), '-c', 'import importlib.metadata as m; print(m.version("qwen-tts"))'],
                             capture_output=True, text=True).stdout.strip()
    step_result('qwen3-tts', ready=True, audio_seconds=seconds, smoke_seconds=took, qwen_tts=version,
                revisions={k: v.get('revision') for k, v in record.items() if isinstance(v, dict)})


def indic_parler():
    python = build_venv('indic-parler-venv', PARLER_PACKAGES, extra=[['--no-deps', PARLER_SOURCE]])
    weights = VOL / 'models' / 'indic-parler'
    record = read_json(weights / 'ecco-install.json', {})
    if not (weights / 'config.json').is_file() or not (weights / 'description-tokenizer').is_dir():
        weights.mkdir(parents=True, exist_ok=True)
        revision = download(python, 'ai4bharat/indic-parler-tts', weights, WEIGHT_PATTERNS)
        # The description tokenizer belongs to the text encoder named in the model's config (as the CPU installer does).
        code = ('import json,sys\nfrom pathlib import Path\nimport parler_tts\n'
                'from huggingface_hub import HfApi\nfrom transformers import AutoConfig, AutoTokenizer\n'
                'root=Path(sys.argv[1]);repo=AutoConfig.from_pretrained(root,local_files_only=True).text_encoder._name_or_path\n'
                'sha=HfApi().model_info(repo).sha\n'
                'AutoTokenizer.from_pretrained(repo,revision=sha).save_pretrained(root/"description-tokenizer")\n'
                'print("ECCO_TOKENIZER="+json.dumps({"repo":repo,"revision":sha}))\n')
        out = subprocess.run([str(python), '-c', code, str(weights)], check=True, capture_output=True, text=True, env=clean_env())
        tokenizer = json.loads(next(l.split('=', 1)[1] for l in out.stdout.splitlines() if l.startswith('ECCO_TOKENIZER=')))
        record = {'repo': 'ai4bharat/indic-parler-tts', 'revision': revision, 'source': PARLER_SOURCE,
                  'description_tokenizer': tokenizer}
        write_json(weights / 'ecco-install.json', record)
    seconds, took = smoke_speech('indic-parler', python, PARLER_SMOKE)
    publish_speech_venv('indic-parler-venv')
    mark_ready('gpu-ready-models.json', 'indic-parler')
    step_result('indic-parler', ready=True, audio_seconds=seconds, smoke_seconds=took, revision=record.get('revision'))


def svara_tts():
    python = build_venv('svara-tts-venv', SVARA_PACKAGES)
    weights = VOL / 'models' / 'svara-tts'
    record = read_json(weights / 'ecco-install.json', {})
    if not (weights / 'config.json').is_file():
        weights.mkdir(parents=True, exist_ok=True)
        record = {'repo': 'kenpath/svara-tts-v1', 'revision': download(python, 'kenpath/svara-tts-v1', weights, SVARA_PATTERNS)}
        write_json(weights / 'ecco-install.json', record)
    if not (weights / 'snac' / 'pytorch_model.bin').is_file():
        (weights / 'snac').mkdir(parents=True, exist_ok=True)
        record['extras'] = {'snac': {'repo': 'hubertsiuzdak/snac_24khz', 'revision': download(
            python, 'hubertsiuzdak/snac_24khz', weights / 'snac', ['config.json', 'pytorch_model.bin'])}}
        write_json(weights / 'ecco-install.json', record)
    seconds, took = smoke_speech('svara-tts', python, SVARA_SMOKE)
    publish_speech_venv('svara-tts-venv')
    mark_ready('gpu-ready-models.json', 'svara-tts')
    step_result('svara-tts', ready=True, audio_seconds=seconds, smoke_seconds=took, revision=record.get('revision'))


def chatterbox_hi():
    """Download the Hindi finetune if missing, then prove the worker at this commit uses it (GPU smoke test)."""
    python = AUDIO / 'chatterbox-venv' / 'bin' / 'python'
    if not python.exists():
        raise SystemExit('The Chatterbox environment is not prepared on this worker.')
    dest = VOL / 'models' / 'chatterbox' / 'hi'
    dest.mkdir(parents=True, exist_ok=True)
    record = read_json(dest / 'ecco-install.json', {})
    if not (dest / 't3_hi.safetensors').is_file():
        revision = download(python, 'ResembleAI/Chatterbox-Multilingual-hi', dest)
        record = {'repo': 'ResembleAI/Chatterbox-Multilingual-hi', 'revision': revision}
        write_json(dest / 'ecco-install.json', record)
    directory = Path(tempfile.mkdtemp(prefix='smoke-chatterbox-hi-'))
    lines = [{'text': 'नमस्ते! आज की कहानी बहुत खास है, ध्यान से सुनिए।', 'language': 'Hindi', 'voice': 'default'},
             {'text': 'Welcome back. That was our Hindi line.', 'language': 'English', 'voice': 'default'}]
    (directory / 'request.json').write_text(json.dumps({'compute': 'a100', 'model': 'chatterbox', 'lines': lines}))
    began = time.time()
    run([python, SRC / 'audio' / 'extra_worker.py', '--request', directory / 'request.json', '--runtime', AUDIO / 'models',
         '--output', directory / 'output.wav'], env=clean_env(HF_HUB_OFFLINE='1', HF_HOME=str(AUDIO / 'hf-cache')),
        cwd=str(SRC / 'audio'), timeout=1800)
    output = directory / 'output.wav'
    if not output.is_file() or output.stat().st_size <= 44:
        raise SystemExit('The Hindi Chatterbox smoke test produced no audio.')
    if not (directory / 'chatterbox-hi-checkpoint').is_dir():
        raise SystemExit('The worker did not load the Hindi finetune.')
    import wave
    with wave.open(str(output)) as f:
        seconds = round(f.getnframes() / f.getframerate(), 2)
    step_result('chatterbox-hi', revision=record.get('revision'), audio_seconds=seconds, smoke_seconds=round(time.time() - began))


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


# ---------------------------------------------------------------- voice bank (22 Nov 2026)
# Finds real speakers in AI4Bharat IndicVoices-R (CC-BY-4.0, gated: needs HF_TOKEN on the endpoint) for role voices
# such as a Hindi teacher or grandmother. Returns metadata and short-lived audio links only; nothing is stored here.
# Owner feedback 22 Nov: first picks were too slow / read-out, grandparents did not sound old, one had echo.
# So: clear rooms only (c50), natural pace for adults, slower and more varied pitch for grandparents.
VOICE_BANK_ROLES = {
    'Teacher': ("(\"occupation\" LIKE '%eacher%' OR \"occupation\" LIKE '%EACHER%') AND \"speaking_rate\" > 13", None),
    'News anchor': ("(\"age_group\" = '18-30' OR \"age_group\" = '30-45')", '"c50" DESC'),
    'Storyteller': ("(\"age_group\" = '30-45' OR \"age_group\" = '45-60') AND \"utterance_pitch_std\" > 30 AND \"speaking_rate\" > 13", None),
    'Young parent': ("\"age_group\" = '18-30' AND \"speaking_rate\" > 14", None),
    'Shopkeeper': ("(\"occupation\" LIKE '%hop%' OR \"occupation\" LIKE '%usiness%' OR \"occupation\" LIKE '%endor%') AND \"speaking_rate\" > 13", None),
    'Grandparent': ("\"age_group\" <> '18-30' AND \"age_group\" <> '30-45' AND \"age_group\" <> '45-60' AND \"utterance_pitch_std\" > 35", None),
}


def voice_bank(config):
    import urllib.error
    import urllib.parse
    import urllib.request
    token = os.environ.get('HF_TOKEN', '').strip()
    if not token or token.startswith('{{'):
        raise SystemExit('HF_TOKEN is not set on this endpoint.')

    def get(path, **params):
        base = dict(dataset='ai4bharat/indicvoices_r') if path == '/splits' else dict(dataset='ai4bharat/indicvoices_r', config=config, split='train')
        url = 'https://datasets-server.huggingface.co' + path + '?' + urllib.parse.urlencode(dict(base, **params))
        request = urllib.request.Request(url, headers={'Authorization': 'Bearer ' + token})
        for attempt in range(8):            # the viewer answers 500 "index is loading" until its index is warm
            try:
                with urllib.request.urlopen(request, timeout=120) as response:
                    return json.loads(response.read())
            except urllib.error.HTTPError as exc:
                body = exc.read().decode(errors='replace')[:400]
                if exc.code >= 500 and 'loading' in body and attempt < 7:
                    time.sleep(20)
                    continue
                raise RuntimeError(f'{exc.code}: ' + body) from None

    summary = {}
    try:
        splits = get('/splits').get('splits', [])
        names = sorted({x.get('config') for x in splits})
        config = next((n for n in names if n.lower() == config.lower()), config)
        summary['configs'] = names
    except Exception as exc:
        summary['splits_error'] = str(exc)[:300]
    try:
        for column in get('/statistics').get('statistics', []):
            if column.get('column_name') in ('age_group', 'scenario', 'occupation', 'gender', 'district'):
                freq = (column.get('column_statistics') or {}).get('frequencies') or {}
                summary[column['column_name']] = dict(sorted(freq.items(), key=lambda kv: -kv[1])[:40])
    except Exception as exc:
        summary['error'] = str(exc)[:300]
    roles = {}
    for role, (where, order) in VOICE_BANK_ROLES.items():
        for gender in ('Female', 'Male'):
            clause = f'"gender" = \'{gender}\' AND "duration" >= 6 AND "duration" <= 14 AND "snr" > 45 AND "c50" > 50 AND ' + where
            try:
                rows = get('/filter', where=clause, orderby=order or '"snr" DESC', length=100).get('rows', [])
            except Exception as exc:
                roles[f'{role}|{gender}'] = {'error': str(exc)[:300]}
                continue
            seen, picks = set(), []
            for item in rows:
                row = item.get('row', {})
                if row.get('speaker_id') in seen:
                    continue
                audio = row.get('audio') or []
                src = audio[0].get('src') if isinstance(audio, list) and audio and isinstance(audio[0], dict) else None
                if not src:
                    continue
                seen.add(row.get('speaker_id'))
                picks.append({k: row.get(k) for k in ('speaker_id', 'gender', 'age_group', 'occupation', 'district', 'state', 'scenario', 'task_name',
                                                      'snr', 'c50', 'speaking_rate', 'utterance_pitch_mean', 'duration', 'text')} | {'audio': src, 'row': item.get('row_idx')})
                if len(picks) >= 8:
                    break
            roles[f'{role}|{gender}'] = picks
    step_result('voice-bank', config=config, summary=summary, roles=roles)


def voice_bank_wide(config, per_group=12):
    """Distinct clear, natural-paced speakers for every sex and age group, spread across districts (owner: diversity first)."""
    import urllib.error
    import urllib.parse
    import urllib.request
    token = os.environ.get('HF_TOKEN', '').strip()
    if not token or token.startswith('{{'):
        raise SystemExit('HF_TOKEN is not set on this endpoint.')

    def get(path, **params):
        url = 'https://datasets-server.huggingface.co' + path + '?' + urllib.parse.urlencode(dict(dataset='ai4bharat/indicvoices_r', config=config, split='train', **params))
        request = urllib.request.Request(url, headers={'Authorization': 'Bearer ' + token})
        for attempt in range(8):
            try:
                with urllib.request.urlopen(request, timeout=150) as response:
                    return json.loads(response.read())
            except urllib.error.HTTPError as exc:
                body = exc.read().decode(errors='replace')[:300]
                if exc.code >= 500 and attempt < 7:
                    time.sleep(20)
                    continue
                raise RuntimeError(f'{exc.code}: ' + body) from None

    groups = {}
    for gender in ('Female', 'Male'):
        for age in ('18-30', '30-45', '45-60', '60+'):
            age_clause = '"age_group" = \'%s\'' % age if age != '60+' else '"age_group" <> \'18-30\' AND "age_group" <> \'30-45\' AND "age_group" <> \'45-60\''
            clause = f'"gender" = \'{gender}\' AND {age_clause} AND "duration" >= 6 AND "duration" <= 14 AND "snr" > 45 AND "c50" > 48 AND "speaking_rate" > 10'
            picks, seen, districts = [], set(), {}
            try:
                for offset in (0, 100):
                    rows = get('/filter', where=clause, orderby='"snr" DESC', length=100, offset=offset).get('rows', [])
                    for item in rows:
                        row = item.get('row', {})
                        sid, district = row.get('speaker_id'), row.get('district')
                        audio = row.get('audio') or []
                        src = audio[0].get('src') if isinstance(audio, list) and audio and isinstance(audio[0], dict) else None
                        if not src or sid in seen or districts.get(district, 0) >= 3:
                            continue
                        seen.add(sid)
                        districts[district] = districts.get(district, 0) + 1
                        picks.append({k: row.get(k) for k in ('speaker_id', 'gender', 'age_group', 'occupation', 'district', 'state', 'snr', 'c50',
                                                              'speaking_rate', 'utterance_pitch_mean', 'duration', 'text')} | {'audio': src, 'row': item.get('row_idx')})
                    if len(picks) >= per_group or len(rows) < 100:
                        break
            except Exception as exc:
                groups[f'{gender}|{age}'] = {'error': str(exc)[:300]}
                continue
            groups[f'{gender}|{age}'] = picks[:per_group]
    step_result('voice-bank-wide', config=config, groups=groups)


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
            elif name == 'pack' and argument.startswith('rebuild-'):
                rebuild(argument[len('rebuild-'):])  # alias accepted by workers built before rebuild: existed
            elif name == 'pack':
                pack(argument)
            elif name == 'kokoro' or (name == 'rebuild' and argument == 'kokoro'):
                kokoro()  # rebuild:kokoro lets images whose handler predates the kokoro step run it
            elif name == 'qwen3-tts' or (name == 'rebuild' and argument == 'qwen3-tts'):
                qwen3_tts()  # rebuild:qwen3-tts lets images whose handler predates the qwen3-tts step run it
            elif name == 'indic-parler' or (name == 'rebuild' and argument == 'indic-parler'):
                indic_parler()  # rebuild:indic-parler lets the deployed handler (which predates this step) run it
            elif name == 'svara-tts' or (name == 'rebuild' and argument == 'svara-tts'):
                svara_tts()  # likewise rebuild:svara-tts
            elif name == 'rebuild' and argument.startswith('voice-bank-wide-'):
                voice_bank_wide(argument[len('voice-bank-wide-'):])   # many distinct speakers per sex and age group
            elif name == 'rebuild' and argument.startswith('voice-bank-'):
                voice_bank(argument[len('voice-bank-'):])   # e.g. rebuild:voice-bank-hindi (finds speakers; installs nothing)
            elif name == 'rebuild':
                rebuild(argument)
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
            break  # later steps (e.g. sync-scripts) must not run after a failed check
    return 1 if failures else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
