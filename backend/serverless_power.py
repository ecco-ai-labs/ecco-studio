"""Serverless On/Off for Studio: warm workers only while someone is using Studio.

On  = the image, video and audio endpoints each keep one worker running (RunPod workersMin 1), and each
      gets one tiny wake-up job so its model is loaded before the first real generation:
      images a 256 px one-step Qwen-Image render, video a 9-frame one-step Wan 2.2 5B clip. They go through
      the Serverless bridge's ComfyUI stand-in on this pod, which holds the RunPod key allowed to run jobs.
      Audio gets its warm worker only (no wake-up job), so its first job still unpacks its voice files.
Off = workersMin back to 0 everywhere, so RunPod shuts the idle workers down and billing stops.

Studio turns it On when someone signs in and Off when they sign out; the GPU icon's button turns it
On or Off by hand. Signing out leaves it On while another browser used Studio in the last few minutes
or while a generation is running; in the second case it turns Off once that work is done.
The button's Off always turns it off.

Auto-off (one setting for the whole workspace, chosen in the GPU popup): after 30 minutes (default)
with no Studio use and no serverless job running, the storage server turns it Off by itself, so a
closed laptop or a forgotten tab never keeps workers running. "Never" keeps it On until someone turns
it Off or signs out.

Runs inside the storage API with the account RunPod key runpod_pods already uses; the browser never
sees the key. State is kept in a small JSON file so a restart keeps On/Off, the setting and the timer.
"""
import json
import os
import re
import shutil
import sqlite3
import threading
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path

import runpod_pods

REST = os.getenv('ECCO_RUNPOD_REST', 'https://rest.runpod.io/v1').rstrip('/')
API = os.getenv('RUNPOD_API_BASE', 'https://api.runpod.ai/v2').rstrip('/')
DEFAULT_ENDPOINTS = {'images': 'yoxpbbmy8ecy0h', 'video': 'q7fsjr4f8xt60f', 'audio': 'pifk74h48p9mwl'}
STATE_FILE = Path(os.getenv('ECCO_SERVERLESS_POWER_FILE', '/workspace/ecco-storage-private/serverless-power.json'))
STUDIO_DB = Path(os.getenv('ECCO_STUDIO_DB', '/workspace/ecco-studio-data/studio.sqlite'))
# Wake-up jobs go through the Serverless bridge on this pod, which holds the job-running RunPod key:
# its ComfyUI stand-in (Qwen -> image endpoint, Wan -> video endpoint) and the audio queue it watches.
COMFY_PROXY = os.getenv('ECCO_COMFY_PROXY', 'http://127.0.0.1:8188').rstrip('/')
AUDIO_QUEUE = Path(os.getenv('ECCO_AUDIO_QUEUE', '/workspace/ecco-audio/queue'))
WAKE_AUDIO_WORKER = os.getenv('ECCO_SERVERLESS_AUDIO_POD', 'serverless')
DEFAULT_AUTO_OFF = 30
AUTO_OFF_CHOICES = (30, None)  # minutes; None = never
SHARED_SECONDS = 5 * 60
HEALTH_SECONDS = 15
MAX_CLIENTS = 50
CLIENT = re.compile(r'^[A-Za-z0-9_-]{8,64}$')
PowerError = runpod_pods.PodError

_lock = threading.RLock()
_health = {'at': 0.0, 'value': None}


def endpoints():
    """{group: endpoint id} for the endpoints On warms. ECCO_WARM_ENDPOINTS=images,video,audio picks groups."""
    groups = [g.strip() for g in os.getenv('ECCO_WARM_ENDPOINTS', 'images,video,audio').split(',') if g.strip()]
    found = {}
    for group in groups:
        value = os.getenv('ECCO_ENDPOINT_' + group.upper(), '').strip() or DEFAULT_ENDPOINTS.get(group, '')
        if value:
            found[group] = value
    return found


def workers():
    return max(1, int(os.getenv('ECCO_WARM_WORKERS', '1')))


def _auto_off(value):
    return value if value in AUTO_OFF_CHOICES else DEFAULT_AUTO_OFF


def _load():
    try:
        data = json.loads(STATE_FILE.read_text())
    except (OSError, ValueError):
        data = {}
    clients = data.get('clients') if isinstance(data.get('clients'), dict) else {}
    return {'on': bool(data.get('on')), 'since': float(data.get('since') or 0), 'reason': data.get('reason') or '',
            'clients': {k: float(v) for k, v in clients.items() if CLIENT.match(str(k))},
            'auto_off_minutes': _auto_off(data.get('auto_off_minutes', DEFAULT_AUTO_OFF)),
            'off_when_done': bool(data.get('off_when_done')), 'warm': data.get('warm') if isinstance(data.get('warm'), dict) else {}}


def _save(state):
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    temp = STATE_FILE.with_suffix('.tmp')
    temp.write_text(json.dumps(state))
    os.replace(temp, STATE_FILE)


# --- RunPod -----------------------------------------------------------------

def _key():
    key = runpod_pods._key()
    if not key:
        raise PowerError('Serverless On/Off is not set up yet: add a RunPod API key to the storage server.', 503)
    return key


def _http(method, url, body=None, opener=urllib.request.urlopen, timeout=30):
    request = urllib.request.Request(url, method=method, data=None if body is None else json.dumps(body).encode(),
                                     headers={'Authorization': 'Bearer ' + _key(), 'Content-Type': 'application/json'})
    try:
        with opener(request, timeout=timeout) as response:
            raw = response.read()
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as exc:
        detail = exc.read()[:400].decode('utf-8', 'replace')
        raise PowerError(f'RunPod returned HTTP {exc.code}: {detail}', exc.code) from None
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise PowerError(f'Could not reach RunPod: {exc}', 502) from None


ENDPOINT_FIELDS = 'id name gpuIds idleTimeout locations networkVolumeId scalerType scalerValue templateId workersMax workersMin'


def _set_min_graphql(endpoint, count, opener):
    """Fallback when the REST API refuses the key: resend the endpoint's own settings with a new workersMin."""
    data = runpod_pods._graphql('query { myself { endpoints { %s } } }' % ENDPOINT_FIELDS, opener=opener)
    current = next((e for e in (data.get('myself') or {}).get('endpoints') or [] if e.get('id') == endpoint), None)
    if current is None:
        raise PowerError(f'RunPod does not list serverless endpoint {endpoint} for this account.', 404)
    settings = {k: v for k, v in current.items() if v is not None}
    settings['workersMin'] = count
    runpod_pods._graphql('mutation Save($input: EndpointInput!) { saveEndpoint(input: $input) { id workersMin } }',
                         {'input': settings}, opener=opener)


def _set_one(endpoint, count, opener):
    try:
        _http('PATCH', f'{REST}/endpoints/{endpoint}', {'workersMin': count}, opener=opener)
    except PowerError as exc:
        if exc.code not in (401, 403, 404, 405):
            raise
        _set_min_graphql(endpoint, count, opener)


def set_min(count, opener=urllib.request.urlopen):
    """Set workersMin on every warm endpoint; returns {group: error} for the ones RunPod refused."""
    failed = {}
    for group, endpoint in endpoints().items():
        try:
            _set_one(endpoint, count, opener)
        except PowerError as exc:
            failed[group] = exc.message
    _health['at'] = 0.0
    return failed


def health(opener=urllib.request.urlopen, now=time.time):
    """Worker counts per group from RunPod (idle = loaded and waiting). Cached briefly; None when unknown."""
    if _health['value'] is not None and now() - _health['at'] < HEALTH_SECONDS:
        return _health['value']
    if not runpod_pods._key():
        return None
    result = {}
    for group, endpoint in endpoints().items():
        try:
            found = (_http('GET', f'{API}/{endpoint}/health', opener=opener, timeout=10) or {}).get('workers') or {}
        except Exception:
            continue
        result[group] = {name: int(found.get(name) or 0) for name in ('idle', 'running', 'initializing')}
    if not result:
        return _health['value']
    _health.update(at=now(), value=result)
    return result


# --- Wake-up jobs ---------------------------------------------------------------

def _node(cls, **inputs):
    return {'class_type': cls, 'inputs': inputs}


def image_wakeup():
    """The Studio Qwen-Image 2512 graph at 256 px and one step: loads the same three model files."""
    return {'mode': 'comfy', 'key': 'wakeup-images', 'return_inline': True, 'workflow': {
        '1': _node('UNETLoader', unet_name='qwen_image_2512_fp8_e4m3fn.safetensors', weight_dtype='default'),
        '2': _node('ModelSamplingAuraFlow', model=['1', 0], shift=3.1),
        '3': _node('CLIPLoader', clip_name='qwen_2.5_vl_7b_fp8_scaled.safetensors', type='qwen_image', device='default'),
        '4': _node('VAELoader', vae_name='qwen_image_vae.safetensors'),
        '5': _node('CLIPTextEncode', text='a plain grey square', clip=['3', 0]),
        '6': _node('CLIPTextEncode', text='', clip=['3', 0]),
        '7': _node('EmptySD3LatentImage', width=256, height=256, batch_size=1),
        '8': _node('KSampler', model=['2', 0], positive=['5', 0], negative=['6', 0], latent_image=['7', 0], seed=1,
                   steps=1, cfg=1, sampler_name='euler', scheduler='simple', denoise=1),
        '9': _node('VAEDecode', samples=['8', 0], vae=['4', 0]),
        '10': _node('SaveImage', images=['9', 0], filename_prefix='ecco-wakeup/image')}}


def video_wakeup():
    """The Studio Wan 2.2 5B graph (default video model) with no start image, 256x256, 9 frames, one step."""
    return {'mode': 'comfy', 'key': 'wakeup-video', 'return_inline': True, 'workflow': {
        '1': _node('UNETLoader', unet_name='wan2.2_ti2v_5B_fp16.safetensors', weight_dtype='default'),
        '2': _node('ModelSamplingSD3', model=['1', 0], shift=8.0),
        '3': _node('CLIPLoader', clip_name='umt5_xxl_fp8_e4m3fn_scaled.safetensors', type='wan', device='default'),
        '4': _node('VAELoader', vae_name='wan2.2_vae.safetensors'),
        '5': _node('CLIPTextEncode', clip=['3', 0], text='a plain grey square'),
        '6': _node('CLIPTextEncode', clip=['3', 0], text=''),
        '8': _node('Wan22ImageToVideoLatent', vae=['4', 0], width=256, height=256, length=9, batch_size=1),
        '9': _node('KSampler', model=['2', 0], positive=['5', 0], negative=['6', 0], latent_image=['8', 0], seed=1,
                   steps=1, cfg=1, sampler_name='uni_pc', scheduler='simple', denoise=1),
        '10': _node('VAEDecode', samples=['9', 0], vae=['4', 0]),
        '11': _node('SaveImage', images=['10', 0], filename_prefix='ecco-wakeup/video')}}


def audio_wakeup():
    """One short Chatterbox line for the Serverless audio worker: unpacks the speech runtime and the
    Chatterbox voice environment."""
    return {'model': 'chatterbox', 'compute': 'a100', 'worker_id': WAKE_AUDIO_WORKER, 'genre': 'News',
            'title': 'Serverless wake-up', 'wakeup': True,
            'lines': [{'text': 'Ready.', 'language': 'English', 'emotion': 'neutral', 'voice': 'default'}]}


def _comfy(graph, opener):
    request = urllib.request.Request(COMFY_PROXY + '/prompt', method='POST', headers={'Content-Type': 'application/json'},
                                     data=json.dumps({'prompt': graph, 'client_id': 'ecco-serverless-wakeup'}).encode())
    try:
        with opener(request, timeout=30) as response:
            reply = json.loads(response.read() or b'{}')
    except (urllib.error.URLError, TimeoutError, OSError, ValueError) as exc:
        raise PowerError(f'The Serverless bridge did not take the wake-up job: {exc}', 502) from None
    if not reply.get('prompt_id'):
        raise PowerError('The Serverless bridge rejected the wake-up job: ' + json.dumps(reply)[:300], 502)
    return reply['prompt_id']


def _queue_audio(now=time.time):
    directory = AUDIO_QUEUE / uuid.uuid4().hex
    directory.mkdir(parents=True, mode=0o700)
    for name, value in (('request.json', audio_wakeup()), ('status.json', {'status': 'queued', 'created': now()})):
        temp = directory / (name + '.tmp')
        temp.write_text(json.dumps(value))
        os.replace(temp, directory / name)
    return directory.name


def wake(opener=urllib.request.urlopen, now=time.time):
    """Send one wake-up job to each warm endpoint; returns {group: job id or 'error: ...'}."""
    sent, groups = {}, endpoints()
    for group in ('images', 'video'):
        if group in groups:
            try:
                sent[group] = _comfy((image_wakeup if group == 'images' else video_wakeup)()['workflow'], opener)
            except PowerError as exc:
                sent[group] = 'error: ' + exc.message[:200]
    # Audio gets its warm worker (workersMin 1) but no wake-up job: a wake-up folder in the audio queue
    # was removed before the dispatcher claimed it, which stopped the bridge's audio thread (15 Nov 2026).
    return sent


def cleanup_wakeups(now=time.time):
    """Remove finished (or abandoned, > 1 h) audio wake-up folders; they are not Studio jobs."""
    removed = 0
    for directory in AUDIO_QUEUE.glob('[a-f0-9]' * 32):
        try:
            request = json.loads((directory / 'request.json').read_text())
            if not request.get('wakeup'):
                continue
            status = json.loads((directory / 'status.json').read_text()).get('status')
            if status in ('done', 'complete', 'completed', 'error', 'failed', 'cancelled') or now() - directory.stat().st_mtime > 3600:
                shutil.rmtree(directory, ignore_errors=True)
                removed += 1
        except (OSError, ValueError):
            continue
    return removed


def _wake_later(at):
    def run():
        result = wake()
        with _lock:
            state = _load()
            if state['on'] and state['since'] == at:
                state['warm'] = {'at': time.time(), 'jobs': result}
                _save(state)
        print('Serverless wake-up jobs:', json.dumps(result), flush=True)
    threading.Thread(target=run, name='serverless-wakeup', daemon=True).start()


# --- Work in progress -----------------------------------------------------------

def _wakeups_running():
    count = 0
    for directory in AUDIO_QUEUE.glob('[a-f0-9]' * 32):
        try:
            if json.loads((directory / 'request.json').read_text()).get('wakeup') and \
                    json.loads((directory / 'status.json').read_text()).get('status') == 'running':
                count += 1
        except (OSError, ValueError):
            continue
    return count


def running_jobs(now=time.time):
    """Serverless work in progress: relayed GPU jobs, audio queue entries and unfinished Studio jobs (< 6 h old)."""
    count = max(0, runpod_pods.active_jobs('serverless') - _wakeups_running())
    try:
        with sqlite3.connect('file:' + str(STUDIO_DB) + '?mode=ro', uri=True, timeout=5) as db:
            rows = db.execute("SELECT json_extract(body, '$.status'), json_extract(body, '$.created') FROM records "
                              "WHERE kind='job'").fetchall()
        count += sum(1 for status, created in rows
                     if status in ('queued', 'running') and now() - float(created or 0) < 6 * 3600)
    except (sqlite3.Error, OSError, ValueError, TypeError):
        pass
    return count


# --- Studio actions ----------------------------------------------------------

def _client(body):
    client = str((body or {}).get('client') or '')
    return client if CLIENT.match(client) else ''


def _last_use(state):
    return max([state['since'], *state['clients'].values()])


def _view(state, extra=None):
    reply = {'on': state['on'], 'since': state['since'] or None, 'reason': state['reason'],
             'auto_off_minutes': state['auto_off_minutes'], 'idle_minutes': state['auto_off_minutes'],
             'endpoints': sorted(endpoints()), 'off_when_done': state['off_when_done'] if state['on'] else False}
    if state['on'] and state['auto_off_minutes']:
        reply['auto_off_at'] = _last_use(state) + state['auto_off_minutes'] * 60
    if state['on'] and state['warm']:
        reply['warm'] = state['warm']
    reply.update(extra or {})
    return reply


def _with_workers(reply, opener=urllib.request.urlopen):
    """Add RunPod's worker counts outside the lock, so a slow RunPod never holds up other browsers."""
    reply['workers'] = health(opener=opener) if reply['on'] else None
    return reply


def status(now=time.time):
    with _lock:
        reply = _view(_load())
    return _with_workers(reply)


def _turn_off(state, at, reason, opener):
    failed = set_min(0, opener=opener)
    if failed:
        # Keep it marked On so the idle watcher tries again; say which endpoints still have a warm worker.
        _save(state)
        raise PowerError('Serverless could not switch off everywhere: '
                         + '; '.join(f'{g}: {m}' for g, m in sorted(failed.items())), 502)
    state.update(on=False, since=at, reason=reason, clients={}, off_when_done=False, warm={})
    _save(state)


def power(body, opener=urllib.request.urlopen, now=time.time, jobs=None, wake_jobs=True):
    """{on: true|false, client, reason: 'button' | 'sign-in' | 'sign-out'}."""
    if not isinstance(body, dict) or not isinstance(body.get('on'), bool):
        raise PowerError('Say whether to turn Serverless on or off.', 400)
    reason = body.get('reason') if body.get('reason') in ('button', 'sign-in', 'sign-out') else 'button'
    client, at = _client(body), now()
    with _lock:
        state = _load()
        if body['on']:
            if client:
                state['clients'][client] = at
            extra = None
            state['off_when_done'] = False
            if not state['on']:
                failed = set_min(workers(), opener=opener)
                if len(failed) == len(endpoints()):
                    raise PowerError('Serverless could not switch on: '
                                     + '; '.join(f'{g}: {m}' for g, m in sorted(failed.items())), 502)
                state.update(on=True, since=at, reason=reason, warm={})
                if failed:
                    extra = {'not_warmed': failed}
                if wake_jobs:
                    _wake_later(at)
            _trim(state, at)
            _save(state)
            return _view(state, extra)
        if reason == 'sign-out':
            state['clients'].pop(client, None)
            others = [c for c, seen in state['clients'].items() if at - seen < SHARED_SECONDS]
            if state['on'] and others:
                _save(state)
                return _view(state, {'kept_on_for_others': len(others)})
            busy = (jobs or running_jobs)() if state['on'] else 0
            if busy:
                state['off_when_done'] = True
                _save(state)
                return _view(state, {'kept_on_for_jobs': busy})
        if state['on']:
            _turn_off(state, at, reason, opener)
        else:
            state.update(on=False, since=at, reason=reason, clients={}, off_when_done=False)
            _save(state)
        return _view(state)


def settings(body, now=time.time):
    """{auto_off_minutes: 30 | null}: one choice for the whole workspace."""
    if not isinstance(body, dict) or 'auto_off_minutes' not in body or body['auto_off_minutes'] not in AUTO_OFF_CHOICES:
        raise PowerError('Choose Auto-off after 30 minutes or Never.', 400)
    with _lock:
        state = _load()
        state['auto_off_minutes'] = body['auto_off_minutes']
        if state['on']:
            client = _client(body)
            if client:
                state['clients'][client] = now()
        _save(state)
        return _view(state)


def heartbeat(body, now=time.time):
    """An open Studio checks in; {active: true} when someone used it recently, which keeps warm workers on."""
    client, at = _client(body), now()
    with _lock:
        state = _load()
        if client and isinstance(body, dict) and body.get('active') is True:
            state['clients'][client] = at
            _trim(state, at)
            _save(state)
        return _view(state)


def _trim(state, at):
    clients = {c: t for c, t in state['clients'].items() if at - t < 24 * 3600}
    state['clients'] = dict(sorted(clients.items(), key=lambda item: item[1])[-MAX_CLIENTS:])


def tick(opener=urllib.request.urlopen, now=time.time, jobs=None):
    """Turn Off when (a) a sign-out was waiting for work to finish, or (b) Auto-off is set and nobody has
    used Studio for that long. Never while serverless work is running."""
    at = now()
    with _lock:
        state = _load()
        if not state['on']:
            return False
        recent = any(at - seen < SHARED_SECONDS for seen in state['clients'].values())
        waiting = state['off_when_done'] and not recent
        idle = bool(state['auto_off_minutes']) and at - _last_use(state) >= state['auto_off_minutes'] * 60
        if not (waiting or idle) or (jobs or running_jobs)():
            return False
        _turn_off(state, at, 'sign-out' if waiting else 'idle', opener)
        print('Serverless turned off:', 'work finished after sign-out' if waiting
              else f'{state["auto_off_minutes"]} idle minutes', flush=True)
        return True


def start(interval=60):
    def loop():
        while True:
            time.sleep(interval)
            try:
                cleanup_wakeups()
                tick()
            except Exception as exc:  # keep watching; RunPod may be briefly unreachable
                print('Serverless idle check failed:', exc, flush=True)
    threading.Thread(target=loop, name='serverless-power', daemon=True).start()


ROUTES = frozenset({'/api/gpu/serverless/power', '/api/gpu/serverless/heartbeat', '/api/gpu/serverless/settings'})


def handle(path, body):
    if path == '/api/gpu/serverless/power':
        return _with_workers(power(body))
    if path == '/api/gpu/serverless/heartbeat':
        return _with_workers(heartbeat(body))
    if path == '/api/gpu/serverless/settings':
        return _with_workers(settings(body))
    raise PowerError('Unknown serverless action.', 404)
