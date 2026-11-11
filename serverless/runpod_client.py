"""Minimal RunPod Serverless client (standard library only).

Used on the CPU storage pod, which has no extra packages installed.
Endpoint IDs and the API key come from the environment:
  RUNPOD_API_KEY, ECCO_ENDPOINT_IMAGES, ECCO_ENDPOINT_VIDEO, ECCO_ENDPOINT_LONGCAT
"""
import json
import os
import time
import urllib.error
import urllib.request

API = os.getenv('RUNPOD_API_BASE', 'https://api.runpod.ai/v2').rstrip('/')
DONE = frozenset(('COMPLETED',))
FAILED = frozenset(('FAILED', 'CANCELLED', 'TIMED_OUT'))
# RunPod rejects request bodies above ~10 MB; keep a margin for JSON overhead.
MAX_INLINE_BYTES = int(os.getenv('ECCO_MAX_INLINE_BYTES', str(7 * 1024 * 1024)))


class ServerlessError(Exception):
    pass


class TransientError(ServerlessError):
    """RunPod's API was briefly unreachable or returned 429/5xx; worth retrying."""


def endpoint(name):
    """Endpoint ID for 'images', 'video' or 'longcat', or None when not configured."""
    value = os.getenv('ECCO_ENDPOINT_' + name.upper(), '').strip()
    return value or None


def configured(name):
    return bool(endpoint(name) and os.getenv('RUNPOD_API_KEY'))


def _call(path, payload=None, timeout=30, opener=urllib.request.urlopen):
    key = os.getenv('RUNPOD_API_KEY')
    if not key:
        raise ServerlessError('RUNPOD_API_KEY is not set on this machine.')
    data = None if payload is None else json.dumps(payload).encode()
    request = urllib.request.Request(API + path, data=data, method='POST' if data is not None else 'GET',
                                     headers={'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json'})
    try:
        with opener(request, timeout=timeout) as response:
            return json.load(response)
    except urllib.error.HTTPError as exc:
        detail = exc.read()[:500].decode('utf-8', 'replace')
        kind = TransientError if exc.code == 429 or exc.code >= 500 else ServerlessError
        raise kind(f'RunPod returned HTTP {exc.code}: {detail}') from None
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise TransientError(f'Could not reach RunPod: {exc}') from None


def submit(name, job_input, opener=urllib.request.urlopen):
    eid = endpoint(name)
    if not eid:
        raise ServerlessError(f'No serverless endpoint configured for {name}.')
    body = {'input': job_input}
    if len(json.dumps(body)) > MAX_INLINE_BYTES:
        raise ServerlessError('Inputs are too large to send to the serverless endpoint.')
    reply = _call(f'/{eid}/run', body, opener=opener)
    if not reply.get('id'):
        raise ServerlessError('RunPod did not return a job ID.')
    return reply['id']


def status(name, job_id, opener=urllib.request.urlopen):
    return _call(f'/{endpoint(name)}/status/{job_id}', opener=opener)


def cancel(name, job_id, opener=urllib.request.urlopen):
    try:
        return _call(f'/{endpoint(name)}/cancel/{job_id}', {}, opener=opener)
    except ServerlessError:
        return {}


def wait(name, job_id, should_cancel=lambda: False, on_status=lambda s: None,
         timeout=3600, poll=2.0, opener=urllib.request.urlopen, sleep=time.sleep,
         queue_timeout=None, on_progress=lambda text: None, clock=time.monotonic, status_outage=600):
    """Poll until the job finishes. Returns the job output or raises ServerlessError.

    `timeout` limits running time only, counted from when a worker picks the job up;
    waiting for a free GPU is limited separately by `queue_timeout` (default 6 hours).
    `on_progress` receives the worker's progress_update() text while it runs.
    """
    queue_timeout = float(os.getenv('ECCO_SERVERLESS_QUEUE_TIMEOUT', 6 * 3600)) if queue_timeout is None else queue_timeout
    submitted, started, last_progress, outage = clock(), None, None, None
    while True:
        if should_cancel():
            cancel(name, job_id, opener=opener)
            raise ServerlessError('Stopped by user')
        try:
            reply = status(name, job_id, opener=opener)
            outage = None
        except TransientError:
            # A brief RunPod API outage must not abandon a job that is still running on a GPU.
            outage = outage or clock()
            if clock() - outage > status_outage:
                raise
            sleep(max(poll, 5))
            continue
        state = reply.get('status', '')
        on_status(state)
        if state in DONE:
            output = reply.get('output') or {}
            if isinstance(output, dict) and output.get('error'):
                raise ServerlessError(str(output['error']))
            return output
        if state in FAILED:
            raise ServerlessError(f'Serverless job {state.lower()}: {reply.get("error") or "no details"}')
        if state == 'IN_PROGRESS':
            started = started or clock()
            text = reply.get('output')
            if isinstance(text, str) and text != last_progress:
                last_progress = text
                on_progress(text)
        now = clock()
        if started is not None and now - started > timeout:
            cancel(name, job_id, opener=opener)
            raise ServerlessError(f'Serverless job ran longer than {round(timeout / 60)} minutes and was cancelled.')
        if started is None and now - submitted > queue_timeout:
            cancel(name, job_id, opener=opener)
            raise ServerlessError(f'No serverless GPU became free within {round(queue_timeout / 60)} minutes. The job was cancelled before it started; nothing was charged for generation.')
        sleep(poll)


VOLUME = os.getenv('ECCO_WORKSPACE', '/workspace')


def read_volume_result(key, volume=None, wait_seconds=60, sleep=time.sleep):
    """Read (then delete) a result the worker uploaded onto the shared network volume."""
    from pathlib import Path
    root = Path(volume or VOLUME).resolve()
    path = (root / key).resolve()
    if not path.is_relative_to(root / 'ecco-serverless' / 'results'):
        raise ServerlessError('The worker returned an unsafe result location.')
    deadline = time.monotonic() + wait_seconds
    while not path.is_file():  # the volume API write can take a moment to appear on the mount
        if time.monotonic() > deadline:
            raise ServerlessError('The result did not appear on the volume.')
        sleep(1)
    data = path.read_bytes()
    try:
        path.unlink()
    except OSError:
        pass
    return data


def unpack(archive_ref, destination, opener=urllib.request.urlopen, volume=None):
    """Extract a worker's result archive ({'volume_key'}, {'url'} or {'inline'}) into destination.

    Returns the extracted file paths. Rejects absolute paths, '..' and links.
    """
    import base64
    import io
    import tarfile
    from pathlib import Path
    if archive_ref.get('volume_key'):
        data = read_volume_result(archive_ref['volume_key'], volume)
    elif archive_ref.get('url'):
        data = fetch(archive_ref['url'], opener=opener)
    elif archive_ref.get('inline'):
        data = base64.b64decode(archive_ref['inline'])
    else:
        raise ServerlessError('The worker returned no result files.')
    destination = Path(destination).resolve()
    paths = []
    with tarfile.open(fileobj=io.BytesIO(data), mode='r') as archive:
        for member in archive.getmembers():
            target = (destination / member.name).resolve()
            if not member.isfile() or not target.is_relative_to(destination):
                raise ServerlessError('The worker returned an unsafe result file.')
            target.parent.mkdir(parents=True, exist_ok=True)
            with archive.extractfile(member) as source:
                target.write_bytes(source.read())
            paths.append(target)
    return paths


def fetch(url, timeout=600, opener=urllib.request.urlopen):
    """Download a result file from the presigned URL the worker returned."""
    try:
        with opener(urllib.request.Request(url), timeout=timeout) as response:
            return response.read()
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise ServerlessError(f'Could not download the result: {exc}') from None
