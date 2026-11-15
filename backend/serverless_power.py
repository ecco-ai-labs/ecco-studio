"""Serverless On/Off for Studio: keep one warm worker only while someone is using Studio.

On  = the image endpoint keeps WORKERS (default 1) worker loaded and ready (RunPod workersMin).
Off = workersMin back to 0, so RunPod shuts the idle worker down and billing stops.

Studio turns it On when someone signs in and Off when they sign out; the GPU icon's
button turns it On or Off by hand. Signing out leaves it On while another browser
used Studio in the last few minutes; the button's Off always turns it off.

Safety net: when no open Studio has been used for IDLE minutes and no serverless job
is running, the storage server turns it Off by itself, so a closed laptop or a
forgotten tab never keeps a worker running.

Runs inside the storage API with the same account RunPod key as runpod_pods; the
browser never sees the key. State is kept in a small JSON file so a restart of the
storage server keeps the On/Off state and the idle timer.
"""
import json
import os
import re
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

import runpod_pods

REST = os.getenv('ECCO_RUNPOD_REST', 'https://rest.runpod.io/v1').rstrip('/')
HEALTH = os.getenv('RUNPOD_API_BASE', 'https://api.runpod.ai/v2').rstrip('/')
DEFAULT_ENDPOINT = 'yoxpbbmy8ecy0h'  # images (Qwen-Image)
STATE_FILE = Path(os.getenv('ECCO_SERVERLESS_POWER_FILE', '/workspace/ecco-storage-private/serverless-power.json'))
SHARED_SECONDS = 5 * 60
HEALTH_SECONDS = 15
MAX_CLIENTS = 50
CLIENT = re.compile(r'^[A-Za-z0-9_-]{8,64}$')
PowerError = runpod_pods.PodError

_lock = threading.RLock()
_health = {'at': 0.0, 'value': None}


def endpoints():
    raw = os.getenv('ECCO_WARM_ENDPOINTS') or os.getenv('ECCO_ENDPOINT_IMAGES') or DEFAULT_ENDPOINT
    return [e.strip() for e in raw.split(',') if e.strip()]


def workers():
    return max(1, int(os.getenv('ECCO_WARM_WORKERS', '1')))


def idle_seconds():
    return max(5, int(os.getenv('ECCO_SERVERLESS_IDLE_MINUTES', '20'))) * 60


def _load():
    try:
        data = json.loads(STATE_FILE.read_text())
    except (OSError, ValueError):
        data = {}
    clients = data.get('clients') if isinstance(data.get('clients'), dict) else {}
    return {'on': bool(data.get('on')), 'since': float(data.get('since') or 0), 'reason': data.get('reason') or '',
            'clients': {k: float(v) for k, v in clients.items() if CLIENT.match(str(k))}}


def _save(state):
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    temp = STATE_FILE.with_suffix('.tmp')
    temp.write_text(json.dumps(state))
    os.replace(temp, STATE_FILE)


# --- RunPod -----------------------------------------------------------------

def _rest(method, path, body=None, opener=urllib.request.urlopen):
    key = runpod_pods._key()
    if not key:
        raise PowerError('Serverless On/Off is not set up yet: add a RunPod API key to the storage server.', 503)
    request = urllib.request.Request(REST + path, method=method, data=None if body is None else json.dumps(body).encode(),
                                     headers={'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json'})
    try:
        with opener(request, timeout=30) as response:
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


def set_min(count, opener=urllib.request.urlopen):
    """Set workersMin on every warm endpoint. RunPod's refusal comes back word for word."""
    for endpoint in endpoints():
        try:
            _rest('PATCH', '/endpoints/' + endpoint, {'workersMin': count}, opener=opener)
        except PowerError as exc:
            if exc.code not in (401, 403, 404, 405):
                raise
            _set_min_graphql(endpoint, count, opener)
    _health['at'] = 0.0


def health(opener=urllib.request.urlopen, now=time.time):
    """Worker counts from RunPod (idle = loaded and waiting). Cached briefly; None when unknown."""
    if _health['value'] is not None and now() - _health['at'] < HEALTH_SECONDS:
        return _health['value']
    key = runpod_pods._key()
    if not key:
        return None
    total = {'idle': 0, 'running': 0, 'initializing': 0}
    try:
        for endpoint in endpoints():
            request = urllib.request.Request(f'{HEALTH}/{endpoint}/health', headers={'Authorization': 'Bearer ' + key})
            with opener(request, timeout=10) as response:
                found = (json.load(response) or {}).get('workers') or {}
            for name in total:
                total[name] += int(found.get(name) or 0)
    except Exception:
        return _health['value']
    _health.update(at=now(), value=total)
    return total


# --- Studio actions ----------------------------------------------------------

def _client(body):
    client = str((body or {}).get('client') or '')
    return client if CLIENT.match(client) else ''


def _view(state, now, extra=None):
    reply = {'on': state['on'], 'since': state['since'] or None, 'reason': state['reason'],
             'idle_minutes': idle_seconds() // 60}
    if state['on']:
        last = max([state['since'], *state['clients'].values()])
        reply['auto_off_at'] = last + idle_seconds()
    reply.update(extra or {})
    return reply


def _with_workers(reply, opener=urllib.request.urlopen):
    """Add RunPod's worker counts outside the lock, so a slow RunPod never holds up other browsers."""
    reply['workers'] = health(opener=opener) if reply['on'] else None
    return reply


def status(now=time.time):
    with _lock:
        reply = _view(_load(), now())
    return _with_workers(reply)


def power(body, opener=urllib.request.urlopen, now=time.time):
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
            if not state['on']:
                set_min(workers(), opener=opener)
                state.update(on=True, since=at, reason=reason)
            _trim(state, at)
            _save(state)
            return _view(state, at)
        if reason == 'sign-out':
            state['clients'].pop(client, None)
            others = [c for c, seen in state['clients'].items() if at - seen < SHARED_SECONDS]
            if state['on'] and others:
                _save(state)
                return _view(state, at, {'kept_on_for_others': len(others)})
        if state['on']:
            set_min(0, opener=opener)
        state.update(on=False, since=at, reason=reason, clients={})
        _save(state)
        return _view(state, at)


def heartbeat(body, now=time.time):
    """An open Studio checks in; {active: true} when someone used it recently, which keeps a warm worker on."""
    client, at = _client(body), now()
    with _lock:
        state = _load()
        if client and isinstance(body, dict) and body.get('active') is True:
            state['clients'][client] = at
            _trim(state, at)
            _save(state)
        return _view(state, at)


def _trim(state, at):
    clients = {c: t for c, t in state['clients'].items() if at - t < 24 * 3600}
    state['clients'] = dict(sorted(clients.items(), key=lambda item: item[1])[-MAX_CLIENTS:])


def tick(opener=urllib.request.urlopen, now=time.time, jobs=lambda: runpod_pods.active_jobs('serverless')):
    """Turn Off when nobody has used Studio for IDLE minutes and no serverless job is running."""
    at = now()
    with _lock:
        state = _load()
        if not state['on']:
            return False
        last = max([state['since'], *state['clients'].values()])
        if at - last < idle_seconds() or jobs():
            return False
        set_min(0, opener=opener)
        state.update(on=False, since=at, reason='idle', clients={})
        _save(state)
        print(f'Serverless turned off after {idle_seconds() // 60} idle minutes', flush=True)
        return True


def start(interval=60):
    def loop():
        while True:
            time.sleep(interval)
            try:
                tick()
            except Exception as exc:  # keep watching; RunPod may be briefly unreachable
                print('Serverless idle check failed:', exc, flush=True)
    threading.Thread(target=loop, name='serverless-power', daemon=True).start()


ROUTES = frozenset({'/api/gpu/serverless/power', '/api/gpu/serverless/heartbeat'})


def handle(path, body):
    if path == '/api/gpu/serverless/power':
        return _with_workers(power(body))
    if path == '/api/gpu/serverless/heartbeat':
        return _with_workers(heartbeat(body))
    raise PowerError('Unknown serverless action.', 404)
