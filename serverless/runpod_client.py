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
        raise ServerlessError(f'RunPod returned HTTP {exc.code}: {detail}') from None
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise ServerlessError(f'Could not reach RunPod: {exc}') from None


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
         timeout=3600, poll=2.0, opener=urllib.request.urlopen, sleep=time.sleep):
    """Poll until the job finishes. Returns the job output or raises ServerlessError."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if should_cancel():
            cancel(name, job_id, opener=opener)
            raise ServerlessError('Stopped by user')
        reply = status(name, job_id, opener=opener)
        state = reply.get('status', '')
        on_status(state)
        if state in DONE:
            output = reply.get('output') or {}
            if isinstance(output, dict) and output.get('error'):
                raise ServerlessError(str(output['error']))
            return output
        if state in FAILED:
            raise ServerlessError(f'Serverless job {state.lower()}: {reply.get("error") or "no details"}')
        sleep(poll)
    cancel(name, job_id, opener=opener)
    raise ServerlessError('Serverless job timed out and was cancelled.')


def unpack(archive_ref, destination, opener=urllib.request.urlopen):
    """Extract a worker's result archive ({'url'} or {'inline'}) into destination.

    Returns the extracted file paths. Rejects absolute paths, '..' and links.
    """
    import base64
    import io
    import tarfile
    from pathlib import Path
    if archive_ref.get('url'):
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
