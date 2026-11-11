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


def prepare():
    """Link the shared audio folder and unpack the pods' Python runtime (verified by sha256)."""
    if not AUDIO.exists():
        AUDIO.parent.mkdir(parents=True, exist_ok=True)
        AUDIO.symlink_to(VOLUME / 'ecco-audio')
    if not (RUNTIME / 'bin' / 'python').exists():
        archive = VOLUME / 'ecco-runtime' / 'runtime.tar'
        expected = (VOLUME / 'ecco-runtime' / 'runtime.sha256').read_text().split()[0]
        digest = hashlib.sha256()
        with archive.open('rb') as source:
            for chunk in iter(lambda: source.read(1 << 24), b''):
                digest.update(chunk)
        if digest.hexdigest() != expected:
            raise RuntimeError('The audio runtime archive failed its checksum.')
        subprocess.run(['tar', '-xf', str(archive), '-C', '/opt'], check=True)
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


def run(job, data, directory):
    import queue_worker as qw  # from the shared audio folder, same version the pods run
    worker_common.unpack_inputs(worker_common.fetch(data['archive']), directory)
    request = json.loads((directory / 'request.json').read_text())
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
            'output': name, 'sha256': hashlib.sha256(output.read_bytes()).hexdigest()}


def handler(job):
    data = job.get('input') or {}
    with tempfile.TemporaryDirectory(prefix='ecco-audio-') as temp:
        directory = Path(temp)
        try:
            runpod.serverless.progress_update(job, 'Loading speech models')
            prepare()
            return run(job, data, directory)
        except Exception as exc:
            log = directory / 'worker.log'
            return {'error': f'Audio generation failed: {exc}'[:1500],
                    'log': log.read_text(errors='replace')[-4000:] if log.is_file() else ''}


if __name__ == '__main__':
    runpod.serverless.start({'handler': handler})
