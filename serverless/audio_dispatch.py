"""CPU-side audio worker that runs queued A100 speech jobs on the serverless audio endpoint.

It registers in the audio queue exactly like audio/queue_worker.py on an A100 pod
(heartbeat worker-<pod>.json, compute 'a100'), claims jobs with the same claim_job(),
and writes the same status.json / output.wav / provenance.json, so Studio's audio
coordinator, progress, cancellation and commit steps are unchanged. Inference runs
on the endpoint; this process only moves files.

  ECCO_ENDPOINT_AUDIO          serverless audio endpoint ID
  ECCO_SERVERLESS_AUDIO_POD    worker ID shown in Studio (default 'serverless')
"""
import hashlib
import io
import os
import tarfile
import tempfile
import threading
import time
from pathlib import Path

import runpod_client as rp

COMPUTE = 'a100'
# Files the coordinator or this dispatcher writes; everything else in the folder is a job input.
LOCAL_ONLY = frozenset(('status.json', 'claim.lock', 'cancel.json', 'worker.log', 'output.wav', 'output.json',
                        'provenance.json', 'progress.json'))
INPUT_LIMIT = 256 * 1024 * 1024
RESULT_FILES = frozenset(('output.wav', 'output.json', 'provenance.json', 'progress.json'))


def pack_job(directory):
    """Tar the job inputs (request.json, snapshotted sounds, voice clips); plain files only."""
    buffer, total = io.BytesIO(), 0
    with tarfile.open(fileobj=buffer, mode='w') as archive:
        for path in sorted(directory.rglob('*')):
            relative = path.relative_to(directory)
            if path.is_symlink() or not path.is_file() or relative.parts[0] in LOCAL_ONLY or path.name.endswith('.tmp'):
                continue
            total += path.stat().st_size
            if total > INPUT_LIMIT:
                raise rp.ServerlessError('Job inputs are larger than 256 MB.')
            archive.add(str(path), arcname=str(relative))
    return buffer.getvalue()


def stage_inputs(data, name, volume=None):
    """Write the input tar where the worker can read it through the volume's S3 API."""
    if len(data) <= rp.MAX_INLINE_BYTES // 2:
        import base64
        return {'inline': base64.b64encode(data).decode()}, None
    path = Path(volume or rp.VOLUME) / 'ecco-serverless' / 'inputs' / name
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + '.tmp')
    temporary.write_bytes(data)
    temporary.replace(path)
    return {'volume_key': 'ecco-serverless/inputs/' + name}, path


def run_job(qw, request, d, pod, client=rp, volume=None):
    """Run one claimed job on the endpoint; always leaves a final status.json."""
    staged = None
    try:
        qw.cancellation.check(d)
        archive, staged = stage_inputs(pack_job(d), d.name + '.tar', volume)
        job_id = client.submit('audio', {'key': d.name, 'archive': archive})
        qw.write(d / 'status.json', {'status': 'running', 'progress': 'Waiting for a Serverless GPU', 'compute': COMPUTE,
                                     'worker_pod': pod, 'serverless_job': job_id})

        def progress(text):
            qw.write(d / 'status.json', {'status': 'running', 'progress': text, 'compute': COMPUTE, 'worker_pod': pod, 'serverless_job': job_id})

        def on_status(state):
            if state == 'IN_PROGRESS':
                progress('Serverless GPU started; preparing voices')
        result = client.wait('audio', job_id, should_cancel=lambda: (d / 'cancel.json').exists(),
                             on_status=on_status, on_progress=progress, timeout=1800)
        qw.cancellation.check(d)
        with tempfile.TemporaryDirectory() as temp:
            files = {f.name: f for f in client.unpack(result['archive'], temp, volume=volume) if f.name in RESULT_FILES}
            name = result.get('output', 'output.wav')
            if name not in ('output.wav', 'output.json') or name not in files:
                raise rp.ServerlessError('The audio worker returned no recording.')
            digest = hashlib.sha256(files[name].read_bytes()).hexdigest()
            if digest != result.get('sha256'):
                raise rp.ServerlessError('Recording integrity check failed after download.')
            for path in files.values():
                temporary = d / (path.name + '.tmp')
                temporary.write_bytes(path.read_bytes())
                temporary.replace(d / path.name)
        qw.write(d / 'status.json', {'status': 'complete', 'compute': COMPUTE, 'worker_pod': pod,
                                     'provenance': qw.read(d / 'provenance.json', {}), 'sha256': digest})
    except qw.cancellation.Cancelled:
        qw.write(d / 'status.json', {'status': 'cancelled', 'progress': 'Stopped by user'})
    except Exception as error:
        if (d / 'cancel.json').exists():
            qw.write(d / 'status.json', {'status': 'cancelled', 'progress': 'Stopped by user'})
        else:
            qw.write(d / 'status.json', {'status': 'error', 'error': str(error)[:1500] or 'Serverless audio generation failed.'})
    finally:
        if staged is not None:
            try:
                staged.unlink()
            except OSError:
                pass


def heartbeat(qw, pod, client=rp):
    """The fields audio/queue_worker.py advertises, describing the serverless A100 worker."""
    resources = qw.preflight_resources(qw.ROOT)
    memory = int(float(os.getenv('ECCO_SERVERLESS_AUDIO_MEMORY_GB', '64')) * 1e9)
    resources.update(memory_total_bytes=memory, memory_available_bytes=memory, ffmpeg=True, ffprobe=True)
    ready = client.configured('audio')
    return {'resources': resources, 'updated': time.time(), 'pod': pod, 'name': 'Serverless A100', 'compute': COMPUTE,
            'gpu': 'NVIDIA A100 (serverless)', 'serverless': True, 'models': enabled_models(qw) if ready else [],
            'instance_routing_version': 1, 'cpu_count': 8, 'memory_gb': round(memory / 1e9), 'mixed_models_version': 1,
            'long_form_version': 1, 'character_controls_version': 1, 'sound_design_version': 1, 'sound_generation_version': 1,
            'cancellation_version': 1, 'voice_refs_version': 1, 'listen_version': 1 if ready and listen_ready(qw) else 0,
            'sound_models': []}


def listen_ready(qw):
    """Listen-back support, when the live audio worker code on the volume has it."""
    check = getattr(qw, 'listen_ready', None)
    return bool(check and check(COMPUTE))


def claim(qw, d, pod, models):
    """queue_worker.claim_job, with or without the newer listen-back argument."""
    import inspect
    if 'listen' in inspect.signature(qw.claim_job).parameters:
        return qw.claim_job(d, COMPUTE, pod, models, [], listen_ready(qw))
    return qw.claim_job(d, COMPUTE, pod, models, [])


def enabled_models(qw):
    """Speech models with GPU environments on the shared volume (same rule as the A100 pod worker)."""
    base = Path(qw.__file__).parent
    verified = ['indic-mio', 'chatterbox', 'indicf5'] + qw.read(base / 'gpu-ready-models.json', [])
    return [m for m in qw.MODELS if m in verified and (m == 'indic-mio' or (base / (m + '-venv') / 'bin' / 'python').exists())]


def dispatcher(qw, pod=None, stop=None, client=rp, volume=None):
    """Mirror of queue_worker.main() for the serverless A100 audio worker."""
    pod = qw.worker_id(pod or os.getenv('ECCO_SERVERLESS_AUDIO_POD', 'serverless'))
    stop = stop or threading.Event()
    qw.ROOT.mkdir(parents=True, exist_ok=True, mode=0o700)
    import fcntl
    lock = (qw.ROOT / ('worker-' + COMPUTE + '-' + pod + '.lock')).open('a')
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        lock.close()
        return False
    beat_path = qw.ROOT / ('worker-' + pod + '.json')

    def beat():
        while not stop.is_set():
            try:
                qw.write(beat_path, heartbeat(qw, pod, client))
            except Exception:
                pass
            stop.wait(5)
    threading.Thread(target=beat, daemon=True, name='audio-serverless-heartbeat').start()
    qw.recover_jobs(COMPUTE, pod)
    while not stop.is_set():
        models = enabled_models(qw) if client.configured('audio') else []
        for d in sorted(qw.ROOT.glob('[a-f0-9]' * 32)):
            if stop.is_set():
                break
            with claim(qw, d, pod, models) as request:
                if request is None:
                    continue
                # Each job runs in its own thread so a long recording does not hold up the queue.
                threading.Thread(target=run_job, args=(qw, request, d, pod, client, volume), daemon=True,
                                 name='audio-serverless-' + d.name[:8]).start()
        stop.wait(2)
    lock.close()
    return True
