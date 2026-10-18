"""Authenticated CPU-side audio job coordination and durable media commit."""
import hashlib
import os
from pathlib import Path
import shutil
import sys
import threading
import time
import uuid
import wave

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'audio'))
import audio_queue as queue
from audio_schema import validate

LOCK = threading.RLock()

def generate(body, env):
    try:
        request = validate(body)
    except ValueError as error:
        raise env['Problem'](str(error))
    sid = env['story_id'](body)
    with LOCK:
        if not queue.ready():
            raise env['Problem']('The audio worker is not connected. Connect an accelerator with the audio worker running.', 503)
        active = [j for j in env['records']('audio_job') if j.get('status') in ('queued', 'running')]
        if len(active) >= 4:
            raise env['Problem']('Four audio recordings are already queued. Wait for one to finish.', 429)
        job = dict(id=uuid.uuid4().hex, kind='audio_job', media='audio', status='queued',
                   story_id=sid, created=time.time(), title=request['title'], request=request)
        env['save'](job)
        directory = queue.ROOT / job['id']
        queue.write(directory / 'status.json', {'status': 'queued'})
        queue.write(directory / 'request.json', request)
        return public(job)

def public(job):
    return {k: v for k, v in job.items() if k != 'request'}

def job_status(jid, env):
    with LOCK:
        job = env['get'](jid, 'audio_job')
        if job['status'] in ('done', 'error'):
            return public(job)
        directory = queue.ROOT / jid
        status = queue.read(directory / 'status.json', {})
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
                prompt='\n'.join(line['text'] for line in request['lines']), source='generated',
                job_id=jid, seconds=duration, duration=round(duration, 2), sha256=digest,
                settings={**request, 'sample_rate': rate, 'channels': channels}, sync='pending')
            # Job and asset IDs must be distinct in the legacy records table.
            asset['id'] = hashlib.sha256(('audio-asset:' + jid).encode()).hexdigest()[:32]
            env['save'](asset)
            job.update(status='done', asset_id=asset['id'], asset_ids=[asset['id']], progress='Audio saved')
        elif status.get('status') in ('running', 'error'):
            job.update(status=status['status'], progress=status.get('progress', ''), error=status.get('error', ''))
        if job['status'] in ('queued', 'running') and not queue.ready() and time.time() - job['created'] > 60:
            job['progress'] = 'Waiting for the audio worker to reconnect'
        env['save'](job)
        return public(job)

def start(env):
    def loop():
        while True:
            try:
                for job in env['records']('audio_job'):
                    if job.get('status') in ('queued', 'running'):
                        job_status(job['id'], env)
            except Exception:
                import traceback
                traceback.print_exc()
            time.sleep(3)
    threading.Thread(target=loop, daemon=True, name='audio-finalizer').start()
