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


def needed_venvs(request):
    """Voice environments a request uses (Indic-Mio runs on the shared runtime and needs none)."""
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
    if process.returncode:
        raise RuntimeError('Listen-back failed.' if listen else 'Speech inference failed.')
    name = 'output.json' if listen else 'output.wav'
    output = directory / name
    if not output.is_file() or output.stat().st_size <= (2 if listen else 44):
        raise RuntimeError('Listen-back returned no transcript.' if listen else 'The audio model returned an empty recording.')
    files = [p for p in (output, directory / 'provenance.json', directory / 'progress.json') if p.is_file()]
    archive = worker_common.pack(files, directory)
    key = worker_common.safe_name(str(data.get('key', 'audio'))) + '.tar'
    return {'archive': worker_common.deliver(archive, key, inline=bool(data.get('return_inline'))),
            'output': name, 'sha256': hashlib.sha256(output.read_bytes()).hexdigest(), 'prepare_seconds': dict(TIMINGS)}


def handler(job):
    data = job.get('input') or {}
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
