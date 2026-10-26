"""Authenticated CPU-side audio job coordination and durable media commit."""
import hashlib
import os
import re
from pathlib import Path
import shutil
import subprocess
import sys
import threading
import time
import uuid
import wave

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'audio'))
import audio_queue as queue
from audio_schema import validate
from sound_schema import validate as validate_sound
from audio_soundtrack import snapshot_assets

LOCK = threading.RLock()

def generate(body, env, *, job_id=None, sound=False):
    try:
        request = validate_sound(body) if sound else validate(body)
    except ValueError as error:
        raise env['Problem'](str(error))
    sid = env['story_id'](body)
    with LOCK:
        # Only trusted server callers supply this ID; the HTTP body cannot set it.
        if job_id is not None:
            if not isinstance(job_id, str) or len(job_id) != 32 or any(c not in '0123456789abcdef' for c in job_id):
                raise env['Problem']('Invalid internal audio job identity.')
            existing = next((j for j in env['records']('audio_job') if j['id'] == job_id), None)
            if existing:
                if existing['request'] != request or existing['story_id'] != sid:
                    raise env['Problem']('This audio run already has a different request.', 409)
                directory = queue.ROOT / job_id
                if existing['status'] == 'queued' and not (directory / 'request.json').is_file():
                    queue.write(directory / 'status.json', {'status': 'queued'})
                    queue.write(directory / 'request.json', request)
                return public(existing)
        target = queue.target(queue.availability(), request['compute'], request.get('worker_id', ''))
        if sound and request['model'] not in target.get('sound_models', []):
            raise env['Problem']('This sound model is not installed and verified on ' + request['compute'].upper() + '. Connect a worker with this sound model enabled.', 503)
        if not sound and not target['ready']:
            raise env['Problem'](target['reason'], 503)
        if request.get('character_controls_version') and target.get('character_controls_version') != 1:
            raise env['Problem']('Update the selected audio worker before using per-character pitch, speed or expressiveness.', 503)
        if request.get('sound_design_version') and target.get('sound_design_version') != 1:
            raise env['Problem']('Update the audio service before generating music and effects.', 503)
        if not sound and (not queue.required_models(request).issubset(target['models']) or (request.get('mixed_models_version') and not queue.request_ready(request))):
            raise env['Problem']('The selected worker must support every character model and mixed-model generation. Choose an available CPU instance or install and verify its missing models.', 503)
        active = [j for j in env['records']('audio_job') if j.get('status') in ('queued', 'running', 'cancelling')]
        if len(active) >= 4:
            raise env['Problem']('Four audio recordings are already queued. Wait for one to finish.', 429)
        job = dict(id=job_id or uuid.uuid4().hex, kind='audio_job', media='audio', status='queued',
                   story_id=sid, task=request.get('task', 'speech'), created=time.time(), title=request['title'], compute=request['compute'], worker_id=request.get('worker_id', ''), request=request)
        directory = queue.ROOT / job['id']
        try:
            snapshot_assets(request, directory, env)
        except ValueError as error:
            raise env['Problem'](str(error))
        env['save'](job)
        queue.write(directory / 'status.json', {'status': 'queued'})
        queue.write(directory / 'request.json', request)
        return public(job)

def public(job):
    return {k: v for k, v in job.items() if k != 'request'}

def sound_step_progress(directory, request):
    """Read bounded sampler telemetry; never infer progress from elapsed time."""
    if request.get('task') != 'sound' or request.get('model') != 'moss-soundeffect-v2':
        return None
    try:
        path = directory / 'worker.log'
        with path.open('rb') as stream:
            stream.seek(max(0, path.stat().st_size - 16384))
            tail = stream.read(16384).decode('utf-8', errors='replace')
        matches = re.findall(r'(?:^|[\r\n])\s*\d+%\|[^\r\n]*?\|\s*(\d+)/100\s*\[', tail)
        if matches:
            completed = int(matches[-1])
            if 0 <= completed <= 100:
                return dict(completed=completed, total=100, updated_at=path.stat().st_mtime)
    except OSError:
        pass
    return None

def job_status(jid, env):
    with LOCK:
        job = env['get'](jid, 'audio_job')
        if job['status'] in ('done', 'error', 'cancelled'):
            return public(job)
        directory = queue.ROOT / jid
        status = queue.read(directory / 'status.json', {})
        if status.get('worker_pod'):
            job['worker_pod'] = status['worker_pod']
        if (directory / 'cancel.json').exists():
            stopped = status.get('status') in ('queued', 'complete', 'error', 'cancelled')
            job.update(status='cancelled' if stopped else 'cancelling', progress='Stopped by user' if stopped else 'Stopping…', error='')
            env['save'](job)
            return public(job)
        if status.get('status') == 'complete':
            source = directory / 'output.wav'
            digest = hashlib.sha256(source.read_bytes()).hexdigest()
            if digest != status.get('sha256'):
                raise env['Problem']('Audio integrity check failed.', 500)
            with wave.open(str(source)) as audio:
                duration = audio.getnframes() / audio.getframerate()
                if duration <= 0:
                    raise env['Problem']('Generated recording is empty.', 500)
                rate, channels = audio.getframerate(), audio.getnchannels()
            target = env['DATA'] / 'audio-dev' / (jid + '.wav')
            target.parent.mkdir(parents=True, exist_ok=True)
            temporary = target.with_suffix('.tmp')
            shutil.copyfile(source, temporary)
            with temporary.open('rb') as f:
                os.fsync(f.fileno())
            if hashlib.sha256(temporary.read_bytes()).hexdigest() != digest:
                raise env['Problem']('Audio storage verification failed.', 500)
            temporary.replace(target)
            request = job['request']
            # Stable asset ID makes finalization safe if interrupted between asset and job writes.
            asset = dict(id=jid, kind='asset', created=job['created'], media='audio', stage='dev',
                story_id=job['story_id'], path='audio-dev/' + target.name, title=job['title'],
                prompt=request['description'] if request.get('task') == 'sound' else '\n'.join(line['text'] for line in request['lines']), source='generated',
                job_id=jid, seconds=duration, duration=round(duration, 2), sha256=digest,
                settings={**request, 'provenance': status.get('provenance', {}), 'sample_rate': rate, 'channels': channels,
                          'worker_pod': status.get('worker_pod', ''), 'worker_compute': status.get('compute', request.get('compute', 'b200'))}, sync='pending')
            # Job and asset IDs must be distinct in the legacy records table.
            asset['id'] = hashlib.sha256(('audio-asset:' + jid).encode()).hexdigest()[:32]
            env['save'](asset)
            job.update(status='done', asset_id=asset['id'], asset_ids=[asset['id']], progress='Audio saved', asset=asset if request.get('task') == 'sound' else None)
        elif status.get('status') in ('running', 'error', 'cancelled'):
            job.update(status=status['status'], progress=status.get('progress', ''), error=status.get('error', ''))
        job.pop('sound_progress', None)
        if job['status'] == 'running':
            steps = sound_step_progress(directory, job['request'])
            if steps:
                job['sound_progress'] = steps
                job['progress'] = ('Finishing sound file' if steps['completed'] == steps['total'] else 'Generating sound effect') + f" · Step {steps['completed']} of {steps['total']}"
        if job['status'] in ('queued', 'running', 'cancelling') and not (queue.sound_ready(job['request']['compute'], job['request']['model'], job['request'].get('worker_id', '')) if job['request'].get('task') == 'sound' else queue.request_ready(job['request'])) and time.time() - job['created'] > 60:
            job['progress'] = 'Waiting for the audio worker to reconnect'
        env['save'](job)
        return public(job)

def start(env):
    root = queue.ROOT.parent
    launcher = root / 'start_cpu_worker.sh'
    if launcher.is_file() and (root / 'cpu-ready-models.json').is_file():
        with (root / 'cpu-worker.log').open('ab') as log:
            subprocess.Popen(['/bin/bash', str(launcher)], stdout=log, stderr=log, start_new_session=True)
    def loop():
        while True:
            try:
                for job in env['records']('audio_job'):
                    if job.get('status') in ('queued', 'running', 'cancelling'):
                        job_status(job['id'], env)
            except Exception:
                import traceback
                traceback.print_exc()
            time.sleep(3)
    threading.Thread(target=loop, daemon=True, name='audio-finalizer').start()





def cancel(jid, env):
    with LOCK:
        job = env['get'](jid, 'audio_job')
        if job['status'] in ('done', 'error', 'failed', 'cancelled'):
            return public(job)
        directory = queue.ROOT / jid
        queue.write(directory / 'cancel.json', {'reason': 'Stopped by user', 'requested': time.time()})
        return job_status(jid, env)

