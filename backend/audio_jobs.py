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
import voice_references

LOCK = threading.RLock()

def generate(body, env, *, job_id=None, sound=False):
    try:
        request = validate_sound(body) if sound else validate(body)
    except ValueError as error:
        raise env['Problem'](str(error))
    sid = env['story_id'](body)
    if not sound:
        request = voice_references.attach(request, env)
    with LOCK:
        # Only trusted server callers supply this ID; the HTTP body cannot set it.
        if job_id is not None:
            if not isinstance(job_id, str) or len(job_id) != 32 or any(c not in '0123456789abcdef' for c in job_id):
                raise env['Problem']('Invalid internal audio job identity.')
            existing = next((j for j in env['records']('audio_job') if j['id'] == job_id), None)
            if existing:
                if voice_references.stable(existing['request']) != voice_references.stable(request) or existing['story_id'] != sid:
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
        if request.get('long_form_version') and target.get('long_form_version') != 1:
            raise env['Problem']('This audio worker needs the full-recording update. Your complete script is saved.', 503)
        if request.get('character_controls_version') and target.get('character_controls_version') != 1:
            raise env['Problem']('Update the selected audio worker before using per-character pitch, speed or expressiveness.', 503)
        if request.get('voice_refs_version') and target.get('voice_refs_version') != 1:
            raise env['Problem']('Update the selected audio worker before using saved character voices.', 503)
        if request.get('sound_design_version') and target.get('sound_design_version') != 1:
            raise env['Problem']('Update the audio service before generating music and effects.', 503)
        if not sound and (not queue.required_models(request).issubset(target['models']) or (request.get('mixed_models_version') and not queue.request_ready(request))):
            raise env['Problem']('The selected worker must support every character model and mixed-model generation. Choose an available CPU instance or install and verify its missing models.', 503)
        active = [j for j in env['records']('audio_job') if j.get('status') in ('queued', 'running', 'cancelling')]
        if len(active) >= 4:
            raise env['Problem']('Four audio recordings are already queued. Wait for one to finish.', 429)
        job = dict(id=job_id or uuid.uuid4().hex, kind='audio_job', media='audio', status='queued',
                   story_id=sid, task=request.get('task', 'speech'), created=time.time(), title=request['title'], compute=request['compute'], worker_id=request.get('worker_id', ''), request=request)
        ends = bookends(body, env) if not sound else None
        if ends:
            job['bookends'] = ends
        directory = queue.ROOT / job['id']
        try:
            snapshot_assets(request, directory, env)
            voice_references.copy_into(request, directory, env)
        except ValueError as error:
            raise env['Problem'](str(error))
        env['save'](job)
        queue.write(directory / 'status.json', {'status': 'queued'})
        queue.write(directory / 'request.json', request)
        return public(job)

def bookends(body, env):
    """Opening and Closing Text (owner final mocks, 21 Nov 2026): saved Audio Library recordings played, in order,
    before the first line and after the last one. They are joined here on the storage server after the worker has
    made the speech, so the audio worker needs no update."""
    raw = body.get('bookends')
    if raw is None:
        return None
    if not isinstance(raw, dict):
        raise env['Problem']('Invalid Opening or Closing.')
    clean = {}
    for side in ('before', 'after'):
        ids = raw.get(side, [])
        if not isinstance(ids, list) or len(ids) > 10 or any(not isinstance(i, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,64}', i) for i in ids):
            raise env['Problem']('Choose up to ten Audio Library recordings for the Opening and the Closing.')
        for i in ids:
            asset = env['get'](i, 'asset')
            if asset.get('media') != 'audio':
                raise env['Problem']('Opening and Closing items must be recordings from Audio Library.')
        if ids:
            clean[side] = ids
    return clean or None


def join_bookends(job, target, env, gap=0.4):
    """Writes Opening + speech + Closing into target (same sample rate and channels as the speech)."""
    ends = job.get('bookends') or {}
    parts = [env['asset_path'](env['get'](i, 'asset')) for i in ends.get('before', [])] + [target] + \
            [env['asset_path'](env['get'](i, 'asset')) for i in ends.get('after', [])]
    if len(parts) == 1:
        return
    with wave.open(str(target)) as audio:
        rate, channels = audio.getframerate(), audio.getnchannels()
    layout = 'mono' if channels == 1 else 'stereo'
    inputs, chains, labels = [], [], []
    for n, part in enumerate(parts):
        inputs += ['-i', str(part)]
        chains.append(f'[{n}:a]aresample={rate},aformat=sample_fmts=s16:channel_layouts={layout},apad=pad_dur={gap if n < len(parts) - 1 else 0}[a{n}]')
        labels.append(f'[a{n}]')
    graph = ';'.join(chains) + ';' + ''.join(labels) + f'concat=n={len(parts)}:v=0:a=1[out]'
    joined = target.with_name(target.stem + '.joined.wav')
    subprocess.run(['ffmpeg', '-nostdin', '-y', '-v', 'error', *inputs, '-filter_complex', graph, '-map', '[out]', '-c:a', 'pcm_s16le', str(joined)], check=True, timeout=300)
    joined.replace(target)


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
            if job.get('bookends'):
                try:
                    join_bookends(job, target, env)
                except (OSError, subprocess.SubprocessError) as error:
                    raise env['Problem']('The Opening or Closing could not be added to the recording: ' + str(error), 500)
                digest = hashlib.sha256(target.read_bytes()).hexdigest()
                with wave.open(str(target)) as audio:
                    duration = audio.getnframes() / audio.getframerate()
                    rate, channels = audio.getframerate(), audio.getnchannels()
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
            job.update(status='done', asset_id=asset['id'], asset_ids=[asset['id']], progress='Audio saved', asset=asset if request.get('task') == 'sound' else None, finished=time.time())
            if request.get('voice_design'):
                # A designed voice becomes the character's saved clip as soon as it exists.
                try:
                    ref = voice_references.from_design(job, asset, env)
                    if ref:
                        job.update(voice_reference_id=ref['id'], progress='Voice saved')
                except Exception as error:
                    job.update(progress='Audio saved; the voice could not be saved: ' + getattr(error, 'message', str(error)))
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



def queue_page(model='', search='', offset=0, limit=50, env=None):
    """Audio Queue (owner final mocks, 21 Nov 2026), the same shape as the picture queue (/api/queue): waiting audio
    recordings in the order they were sent, each with its place and estimated wait. Audio jobs go to RunPod as soon as
    they are sent, so they cannot be reordered; Cancel stops one through /api/generation/stop."""
    jobs = sorted(env['records']('audio_job'), key=lambda j: j.get('created', 0))
    recent = [j for j in jobs if j.get('created', 0) > time.time() - 24 * 3600]
    waiting = [j for j in jobs if j.get('status') == 'queued' and j.get('task', 'speech') == 'speech']
    running = [j for j in jobs if j.get('status') in ('running', 'cancelling')]
    took = [j['finished'] - j['created'] for j in jobs if j.get('status') == 'done' and j.get('finished') and j.get('created')][-10:]
    each = sum(took) / len(took) if took else 120.0
    parallel = 2  # the audio endpoint's max workers (serverless-status, 17 Nov 2026)
    place = {j['id']: n + 1 for n, j in enumerate(waiting)}
    shown = [j for j in waiting if (not model or j['request'].get('model') == model) and (not search or search.lower() in j.get('title', '').lower())]
    offset, limit = max(0, int(offset or 0)), max(1, min(50, int(limit or 50)))
    wait = lambda j: round(each * (1 + (place[j['id']] - 1) // parallel))
    items = [{'id': j['id'], 'model': j['request'].get('model', ''), 'model_name': j['request'].get('model', ''), 'name': (j.get('title') or 'Audio recording')[:160],
              'place': place[j['id']], 'wait_seconds': wait(j)} for j in shown[offset:offset + limit]]
    per_model = {}
    for j in waiting:
        per_model[j['request'].get('model', '')] = per_model.get(j['request'].get('model', ''), 0) + 1
    return {'items': items, 'total': len(shown), 'parallel': parallel, 'offset': offset, 'limit': limit, 'per_model': per_model,
            'models': sorted(per_model), 'reorder': False,
            'mine': {'waiting': len(waiting), 'running': len(running), 'done': len([j for j in recent if j.get('status') == 'done'])},
            'last_wait_seconds': max([wait(j) for j in waiting] or [0])}
