"""Start, stop and report Ecco's RunPod GPU pods for Studio's GPU connection box.

Runs inside the storage API. The RunPod key stays on the server; the browser never
sees it. The key RunPod puts inside each pod (RUNPOD_API_KEY) can run serverless jobs
but cannot read or manage pods, so this uses an account API key with pod access from
ECCO_RUNPOD_MANAGE_KEY or the private file /workspace/ecco-storage-private/runpod-api.key. Only the pods listed
in gpu_relay.GPUS can be touched. RunPod's own error text (for example "There are
not enough free GPUs on the host machine to start this pod.") is returned
word for word so Studio can show exactly what RunPod said.
"""
import json
import os
import threading
import time
import urllib.error
import urllib.request

import gpu_relay

API = 'https://api.runpod.io/graphql'
CACHE_SECONDS = 10
_cache = {'at': 0.0, 'pods': None}
_lock = threading.Lock()


class PodError(Exception):
    """A refusal or failure to show the user, carrying RunPod's message unchanged."""

    def __init__(self, message, code=409):
        super().__init__(message)
        self.message, self.code = message, code


def managed():
    """Pod IDs Studio may start and stop: every relay GPU except the serverless bridge."""
    return [pod for pod in gpu_relay.GPUS if pod != 'serverless']


KEY_FILE = os.getenv('ECCO_RUNPOD_KEY_FILE', '/workspace/ecco-storage-private/runpod-api.key')


def _key():
    key = os.getenv('ECCO_RUNPOD_MANAGE_KEY', '').strip()
    if not key:
        try:
            key = open(KEY_FILE, encoding='utf-8').read().strip()
        except OSError:
            key = ''
    return key


def _graphql(query, variables=None, opener=urllib.request.urlopen):
    key = _key()
    if not key:
        raise PodError('Starting pods from Studio is not set up yet: add a RunPod API key with pod access to the storage server.', 503)
    request = urllib.request.Request(API, data=json.dumps({'query': query, 'variables': variables or {}}).encode(),
                                     headers={'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json'})
    try:
        with opener(request, timeout=30) as response:
            reply = json.load(response)
    except urllib.error.HTTPError as exc:
        try:
            reply = json.load(exc)
        except Exception:
            raise PodError(f'RunPod returned HTTP {exc.code}.', 502) from None
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise PodError(f'Could not reach RunPod: {exc}', 502) from None
    errors = reply.get('errors') or []
    if errors:
        message = '; '.join(str(e.get('message') or e) for e in errors)[:600]
        if message == 'Unauthorized':
            raise PodError('RunPod did not accept the storage server\'s API key for pods (Unauthorized). It needs a RunPod API key with pod access.', 502)
        raise PodError(message)
    return reply.get('data') or {}


POD_FIELDS = 'id name desiredStatus costPerHr gpuCount lastStatusChange runtime { uptimeInSeconds } machine { gpuDisplayName }'


def _state(pod):
    """Studio's view of a RunPod pod: stopped, starting or running."""
    status = (pod.get('desiredStatus') or '').upper()
    if status == 'RUNNING':
        return 'running' if pod.get('runtime') else 'starting'
    return 'stopped' if status in ('EXITED', 'STOPPED', 'TERMINATED', '') else status.lower()


def _summary(pod):
    runtime = pod.get('runtime') or {}
    return {'id': pod['id'], 'name': pod.get('name') or pod['id'], 'state': _state(pod),
            'rate_per_hour': pod.get('costPerHr'), 'gpu_count': pod.get('gpuCount') or 1,
            'gpu': (pod.get('machine') or {}).get('gpuDisplayName'),
            'uptime_seconds': runtime.get('uptimeInSeconds'), 'active_jobs': active_jobs(pod['id'])}


def pods(opener=urllib.request.urlopen, now=time.time, fresh=False):
    """Status of every managed pod, cached briefly so many open Studios do not flood RunPod."""
    with _lock:
        if not fresh and _cache['pods'] is not None and now() - _cache['at'] < CACHE_SECONDS:
            return {'pods': _cache['pods']}
    data = _graphql('query { myself { pods { %s } } }' % POD_FIELDS, opener=opener)
    allowed = set(managed())
    found = [_summary(p) for p in (data.get('myself') or {}).get('pods') or [] if p.get('id') in allowed]
    with _lock:
        _cache.update(at=now(), pods=found)
    return {'pods': found}


def _require(body):
    pod = body.get('gpu') if isinstance(body, dict) else None
    if pod not in managed():
        raise PodError('Studio can only start or stop the Ecco GPU pods.', 400)
    return pod


def start(body, opener=urllib.request.urlopen):
    """Resume a stopped pod. RunPod's refusal (no free GPU, etc.) comes back verbatim."""
    pod = _require(body)
    current = next((p for p in pods(opener=opener, fresh=True)['pods'] if p['id'] == pod), None)
    if current is None:
        raise PodError('RunPod does not list this pod for the account.', 404)
    if current['state'] in ('running', 'starting'):
        return {'pod': current, 'already': True}
    data = _graphql('mutation Start($input: PodResumeInput!) { podResume(input: $input) { %s } }' % POD_FIELDS,
                    {'input': {'podId': pod, 'gpuCount': current['gpu_count']}}, opener=opener)
    _cache['pods'] = None
    return {'pod': _summary(data.get('podResume') or {'id': pod, 'desiredStatus': 'RUNNING'})}


def stop(body, opener=urllib.request.urlopen):
    """Stop a pod. Its volume and files are kept; nothing is deleted."""
    pod = _require(body)
    data = _graphql('mutation Stop($input: PodStopInput!) { podStop(input: $input) { id desiredStatus } }',
                    {'input': {'podId': pod}}, opener=opener)
    _cache['pods'] = None
    return {'pod': {'id': pod, 'state': _state(data.get('podStop') or {'desiredStatus': 'EXITED'})}}


def active_jobs(pod, relay_root=None, audio_root=None, now=time.time):
    """Jobs currently running on that pod, for the Stop warning: relayed generations and audio."""
    count = 0
    relay = (relay_root or gpu_relay.ROOT) / pod
    try:
        for work in relay.glob('*.working'):
            if work.with_suffix('.result').exists() or now() - work.stat().st_mtime > 6 * 3600:
                continue
            count += 'completed' not in gpu_relay.read(work)
    except OSError:
        pass
    try:
        from pathlib import Path
        queue = Path(audio_root or os.getenv('ECCO_AUDIO_QUEUE', '/workspace/ecco-audio/queue'))
        for status in queue.glob('*/status.json'):
            data = gpu_relay.read(status)
            count += data.get('status') == 'running' and data.get('worker_pod') == pod
    except OSError:
        pass
    return count


ROUTES = frozenset({'/api/gpu/pods/start', '/api/gpu/pods/stop'})


def handle(path, body):
    if path == '/api/gpu/pods/start':
        return start(body)
    if path == '/api/gpu/pods/stop':
        return stop(body)
    raise PodError('Unknown pod action.', 404)
