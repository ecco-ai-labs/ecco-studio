"""RunPod Serverless worker for Ecco speech on A100 (Indic-Mio, Chatterbox, IndicF5).

Runs the exact runtime and worker scripts the A100 pods run, read from the global volume:
  /runpod-volume/ecco-audio                 -> /workspace/ecco-audio (scripts, venvs, weights)
  /runpod-volume/ecco-runtime/runtime.tar   -> unpacked once per worker to /opt/ecco-runtime-venv
The base image matches the pods (runpod/pytorch 2.8.0, CUDA 12.8, Ubuntu 24.04, Python 3.12),
so the voice environments built on the pods load unchanged.

Job input   {"key": "<job id>", "archive": {"volume_key": "ecco-serverless/inputs/<id>.tar"} | {"inline": b64}}
            The archive is the queued job folder: request.json plus snapshotted sounds and voice clips.
Job output  {"archive": <result tar ref>, "output": "output.wav"|"output.json", "sha256": hex}
            or {"error": "...", "log": "<worker log tail>"}
Progress    runpod progress_update() carries the same text the pod worker writes to status.json.
"""
import hashlib
import json
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import runpod

sys.path.insert(0, str(Path(__file__).resolve().parent))
import worker_common  # noqa: E402

VOLUME = Path(os.getenv('ECCO_VOLUME', '/runpod-volume'))
AUDIO = Path(os.getenv('ECCO_AUDIO_ROOT', '/workspace/ecco-audio'))
RUNTIME = Path('/opt/ecco-runtime-venv')
SPEECH_STAGES = ('Mixing music and effects', 'Loading sound model', 'Generating sound effect', 'Generating instrumental music')


LOCAL_VENVS = Path('/opt/ecco-audio-venvs')
TIMINGS = {}


def _extract_packed(entry, temporary):
    """Unpack <name>-venv.tar (made once by pack_audio_venvs.sh) - one sequential read instead of
    copying tens of thousands of small files from the network volume. Returns False when not packed."""
    archive = entry.parent / (entry.name + '.tar')
    if not archive.is_file():
        return False
    checksum = entry.parent / (entry.name + '.tar.sha256')
    temporary.mkdir(parents=True)
    # One sequential read: the bytes go to tar and the hash together.
    digest = hashlib.sha256()
    process = subprocess.Popen(['tar', '-xf', '-', '-C', str(temporary), '--strip-components=1'], stdin=subprocess.PIPE)
    try:
        with archive.open('rb') as source:
            for chunk in iter(lambda: source.read(1 << 24), b''):
                digest.update(chunk)
                process.stdin.write(chunk)
    finally:
        process.stdin.close()
    if process.wait():
        raise RuntimeError(f'Unpacking the voice environment {entry.name} failed.')
    if checksum.is_file() and digest.hexdigest() != checksum.read_text().split()[0]:
        subprocess.run(['rm', '-rf', str(temporary)], check=True)
        raise RuntimeError(f'The packed voice environment {entry.name} failed its checksum.')
    return True


def _local_venv(entry, venvs):
    local = venvs / entry.name
    if (local / 'pyvenv.cfg').is_file():
        return local
    local.parent.mkdir(parents=True, exist_ok=True)
    temporary = venvs / (entry.name + '.partial')
    subprocess.run(['rm', '-rf', str(temporary)], check=True)
    if not _extract_packed(entry, temporary):
        subprocess.run(['cp', '-r', '--no-dereference', '--no-preserve=mode,ownership,timestamps',
                        str(entry), str(temporary)], check=True)
        # Recreate the launchers locally; console scripts are not used by the workers.
        subprocess.run(['rm', '-rf', str(temporary / 'bin')], check=True)
        (temporary / 'bin').mkdir()
        for link in (entry / 'bin').iterdir():
            if link.is_symlink():
                (temporary / 'bin' / link.name).symlink_to(os.readlink(link))
    temporary.rename(local)
    return local


def build_audio_folder(source=None, audio=None, venvs=None, needed=None, report=None):
    """A local /workspace/ecco-audio whose entries point at the volume.

    The serverless mount will not execute anything stored on it, not even a symlink to
    /usr/bin/python3.12, so each voice environment (*-venv) a job needs is made local:
    unpacked from <name>-venv.tar when it has been packed, otherwise copied with its bin/
    launcher symlinks recreated. Only the environments in `needed` are prepared (all when
    None); the rest stay linked to the volume and are made local the first time a job needs
    them. Everything else (scripts, weights, caches) is read in place through symlinks.
    """
    source, audio, venvs = Path(source or VOLUME / 'ecco-audio'), Path(audio or AUDIO), Path(venvs or LOCAL_VENVS)
    report = report or (lambda text: None)
    if audio.is_symlink():
        audio.unlink()
    audio.mkdir(parents=True, exist_ok=True)
    entries = sorted(source.iterdir())
    wanted = [e for e in entries if e.name.endswith('-venv') and (e / 'pyvenv.cfg').is_file() and (needed is None or e.name in needed)]
    for entry in entries:
        target = audio / entry.name
        if entry.name == 'sounds' and entry.is_dir():
            build_sounds_folder(entry, audio / 'sounds', venvs, needed, report)
            continue
        is_venv = entry in wanted
        if is_venv:
            if target.is_symlink() and Path(os.readlink(target)) == (venvs / entry.name):
                continue
            began = time.time()
            report(f'Preparing {entry.name[:-5]} voice environment ({wanted.index(entry) + 1} of {len(wanted)})')
            local = _local_venv(entry, venvs)
            if target.is_symlink() or target.exists():
                target.unlink()
            target.symlink_to(local)
            TIMINGS[entry.name] = round(time.time() - began, 1)
        elif not (target.exists() or target.is_symlink()):
            target.symlink_to(entry)


def build_sounds_folder(source, target, venvs, needed, report):
    """sounds/<model>/ as local folders: source and weights read in place from the volume; the
    a100-venv a job needs is unpacked from sounds/<model>/a100-venv.tar (built by install_on_volume.py)."""
    if target.is_symlink():
        target.unlink()
    target.mkdir(parents=True, exist_ok=True)
    for model_dir in sorted(p for p in source.iterdir() if p.is_dir()):
        local = target / model_dir.name
        local.mkdir(exist_ok=True)
        for item in model_dir.iterdir():
            if item.name == 'a100-venv' or item.name.endswith(('.tar', '.sha256', '.partial')):
                continue
            path = local / item.name
            if not (path.exists() or path.is_symlink()):
                path.symlink_to(item)
        key = 'sounds/' + model_dir.name + '/a100-venv'
        archive = model_dir / 'a100-venv.tar'
        venv = local / 'a100-venv'
        if needed is None or key not in needed or venv.exists() or not archive.is_file():
            continue
        began = time.time()
        report(f'Preparing {model_dir.name} sound environment')
        destination = venvs / 'sounds' / model_dir.name / 'a100-venv'
        if not (destination / 'pyvenv.cfg').is_file():
            temporary = destination.with_name('a100-venv.partial')
            subprocess.run(['rm', '-rf', str(temporary)], check=True)
            temporary.parent.mkdir(parents=True, exist_ok=True)
            # _extract_packed looks for <entry>.tar beside <entry>.
            _extract_packed(model_dir / 'a100-venv', temporary)
            temporary.rename(destination)
        venv.symlink_to(destination)
        TIMINGS[key] = round(time.time() - began, 1)


def needed_venvs(request):
    """Environments a request uses (Indic-Mio runs on the shared runtime and needs none).
    Sound jobs use sounds/<model>/a100-venv; listen-back runs Whisper in the IndicF5 environment."""
    if request.get('task') == 'sound':
        return {'sounds/' + str(request.get('model')) + '/a100-venv'}
    if request.get('task') == 'listen':
        return {'indicf5-venv'}
    models = {request.get('model')} | {line.get('model') for line in request.get('lines', []) if isinstance(line, dict)}
    return {m + '-venv' for m in models if m and m != 'indic-mio'}


def prepare(needed=None, report=None):
    """Build the local audio folder for the needed voices and unpack the pods' Python runtime (verified by sha256)."""
    report = report or (lambda text: None)
    build_audio_folder(needed=needed, report=report)
    if not (RUNTIME / 'bin' / 'python').exists():
        began = time.time()
        report('Unpacking the speech runtime')
        archive = VOLUME / 'ecco-runtime' / 'runtime.tar'
        expected = (VOLUME / 'ecco-runtime' / 'runtime.sha256').read_text().split()[0]
        digest = hashlib.sha256()
        with archive.open('rb') as source:
            for chunk in iter(lambda: source.read(1 << 24), b''):
                digest.update(chunk)
        if digest.hexdigest() != expected:
            raise RuntimeError('The audio runtime archive failed its checksum.')
        subprocess.run(['tar', '-xf', str(archive), '-C', '/opt'], check=True)
        TIMINGS['runtime'] = round(time.time() - began, 1)
    # Same environment as audio/start_worker.sh on the pods.
    os.environ['PYTHONPATH'] = str(AUDIO / 'deps')
    os.environ['TORCH_HOME'] = str(AUDIO / 'torch-cache')
    if str(AUDIO) not in sys.path:
        sys.path.insert(0, str(AUDIO))


def progress_text(details, request):
    """Mirror of queue_worker.run_job's progress messages."""
    if details.get('phase') == 'speech':
        completed, total = details.get('completed'), details.get('total')
        if type(completed) is int and type(total) is int and total == len(request.get('lines', [])) and 0 <= completed <= total:
            return f'Generating speech · {completed} of {total} passages complete'
    progress = details.get('progress')
    return progress if progress in SPEECH_STAGES else None


def run(job, data, directory, request):
    import queue_worker as qw  # from the shared audio folder, same version the pods run
    listen = request.get('task') == 'listen'
    command, env = qw.worker_command(request, directory)
    if command[0] == sys.executable:  # the pods run these scripts with the runtime's python
        command[0] = str(RUNTIME / 'bin' / 'python')
    with (directory / 'worker.log').open('wb') as log:
        process = subprocess.Popen(command, env=env, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
        last = None
        while process.poll() is None:
            text = progress_text(qw.read(directory / 'progress.json', {}), request)
            if text and text != last:
                runpod.serverless.progress_update(job, text)
                last = text
            time.sleep(2)
    sound = request.get('task') == 'sound'
    if process.returncode:
        raise RuntimeError('Listen-back failed.' if listen else 'Sound generation failed.' if sound else 'Speech inference failed.')
    name = 'output.json' if listen else 'output.wav'
    output = directory / name
    if not output.is_file() or output.stat().st_size <= (2 if listen else 44):
        raise RuntimeError('Listen-back returned no transcript.' if listen else 'The sound model returned an empty recording.' if sound
                           else 'The audio model returned an empty recording.')
    files = [p for p in (output, directory / 'provenance.json', directory / 'progress.json') if p.is_file()]
    archive = worker_common.pack(files, directory)
    key = worker_common.safe_name(str(data.get('key', 'audio'))) + '.tar'
    return {'archive': worker_common.deliver(archive, key, inline=bool(data.get('return_inline'))),
            'output': name, 'sha256': hashlib.sha256(output.read_bytes()).hexdigest(), 'prepare_seconds': dict(TIMINGS)}


INSTALL_STEPS = ('inventory', 'sync-scripts', 'pack:', 'rebuild:', 'voxcpm2', 'kokoro', 'qwen3-tts', 'chatterbox-hi', 'whisper', 'sound:')
INSTALL_REPO = 'ecco-ai-labs/ecco-studio'
READY_KEY = 'ecco-serverless/audio-ready.json'


def valid_step(step):
    name, colon, argument = step.partition(':')
    if not colon:
        return step in INSTALL_STEPS
    return name + ':' in INSTALL_STEPS and bool(argument) and all(c.isalnum() or c in '.-_' for c in argument)


def readiness(volume=None):
    """What this endpoint can run, from the volume's readiness files (written by install_on_volume.py)."""
    audio = Path(volume or VOLUME) / 'ecco-audio'

    def listed(name):
        try:
            value = json.loads((audio / name).read_text())
        except (OSError, ValueError):
            return []
        return sorted(v for v in value if isinstance(v, str)) if isinstance(value, list) else []
    speech = [m for m in listed('gpu-ready-models.json') if (audio / (m + '-venv.tar')).is_file()]
    sound = [m for m in listed('sound-ready-a100.json') if (audio / 'sounds' / m / 'a100-venv.tar').is_file()]
    listen = (audio / 'hf-cache' / 'hub' / 'models--openai--whisper-large-v3-turbo').is_dir()
    return {'speech': speech, 'sound': sound, 'listen': listen, 'updated': time.time()}


def publish_readiness(ready):
    """Copy readiness to the network volume the dispatcher reads (through the volume's S3 API)."""
    if not worker_common.volume_configured():
        return False
    import io
    worker_common._s3_client().upload_fileobj(io.BytesIO(json.dumps(ready).encode()), os.environ['ECCO_S3_BUCKET'], READY_KEY)
    return True


def install(job, spec, source_dir=None):
    """Admin job: run serverless/audio-worker/install_on_volume.py from the repository at a pinned commit."""
    commit = str(spec.get('commit', ''))
    steps = [str(s) for s in spec.get('steps', [])]
    if len(commit) != 40 or any(c not in '0123456789abcdef' for c in commit):
        return {'error': 'Install jobs need the full 40-character commit to install from.'}
    if not steps or not all(valid_step(s) for s in steps):
        return {'error': 'Unknown install step. Allowed: ' + ', '.join(INSTALL_STEPS)}
    report = lambda text: runpod.serverless.progress_update(job, text[:300])
    needed = set()
    if 'chatterbox-hi' in steps:
        needed.add('chatterbox-venv')
    if 'whisper' in steps:
        needed.add('indicf5-venv')
    prepare(needed, report)
    with tempfile.TemporaryDirectory(prefix='ecco-src-') as temp:
        root = Path(source_dir) if source_dir else Path(temp) / 'src'
        if not source_dir:
            import urllib.request
            import zipfile
            report('Downloading installer at ' + commit[:7])
            archive = Path(temp) / 'src.zip'
            urllib.request.urlretrieve('https://codeload.github.com/' + INSTALL_REPO + '/zip/' + commit, archive)
            with zipfile.ZipFile(archive) as package:
                for item in package.infolist():
                    if Path(item.filename).is_absolute() or '..' in Path(item.filename).parts:
                        return {'error': 'Invalid source archive.'}
                package.extractall(temp)
            top = [p for p in Path(temp).iterdir() if p.is_dir()]
            top[0].rename(root)
        env = dict(os.environ, HF_HUB_OFFLINE='0', TRANSFORMERS_OFFLINE='0')
        env.pop('PYTHONPATH', None)
        lines, results = [], []
        with subprocess.Popen([str(RUNTIME / 'bin' / 'python'), '-u', str(root / 'serverless/audio-worker/install_on_volume.py'), *steps],
                              env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1) as process:
            for line in process.stdout:
                line = line.rstrip()
                lines.append(line)
                del lines[:-400]
                if line.startswith('ECCO_STEP '):
                    results.append(json.loads(line[10:]))
                elif line.startswith(('=== ', '$ ')):
                    report(line)
    ready = readiness()
    try:
        published = publish_readiness(ready)
    except Exception as exc:  # readiness can be republished by the next install job
        published = 'failed: ' + str(exc)[:200]
    return {'ok': process.returncode == 0, 'steps': results, 'ready': ready, 'published': published,
            'log': '\n'.join(lines)[-6000:]}


def handler(job):
    data = job.get('input') or {}
    if isinstance(data.get('install'), dict):
        try:
            return install(job, data['install'])
        except Exception as exc:
            return {'error': f'Install failed: {exc}'[:1500], 'prepare_seconds': dict(TIMINGS)}
    with tempfile.TemporaryDirectory(prefix='ecco-audio-') as temp:
        directory = Path(temp)
        try:
            report = lambda text: runpod.serverless.progress_update(job, text)
            report('Reading the job')
            worker_common.unpack_inputs(worker_common.fetch(data['archive']), directory)
            request = json.loads((directory / 'request.json').read_text())
            began = time.time()
            prepare(needed_venvs(request), report)
            TIMINGS['prepare_total'] = round(time.time() - began, 1)
            report('Loading speech models')
            return run(job, data, directory, request)
        except Exception as exc:
            log = directory / 'worker.log'
            return {'error': f'Audio generation failed: {exc}'[:1500], 'prepare_seconds': dict(TIMINGS),
                    'log': log.read_text(errors='replace')[-4000:] if log.is_file() else ''}


if __name__ == '__main__':
    runpod.serverless.start({'handler': handler})
