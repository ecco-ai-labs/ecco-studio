"""Find character voice reference clips for copying models, with no long-lived worker state.

A request that uses custom character voices carries `voice_refs`: for each reference
asset its sha256, transcript and how to fetch it (a signed storage URL, or a relative
path that ECCO_STORAGE_PUBLIC_URL completes). Lines name a clip as `ref:<asset id>`.
On a pod the coordinator also copies each clip into the job folder; serverless workers
download it into a per-process cache keyed by content hash. Every source is verified
against the sha256 before use.
"""
import hashlib
import os
from pathlib import Path
import re
import tempfile
import urllib.request

REF = re.compile(r'^ref:([0-9a-f]{32})$')
MAX_BYTES = 8 * 1024 * 1024


def ref_id(voice):
    match = REF.match(voice or '') if isinstance(voice, str) else None
    return match.group(1) if match else None


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def cache_dir():
    directory = Path(os.environ.get('ECCO_VOICE_CACHE') or Path(tempfile.gettempdir()) / 'ecco-voice-refs')
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    return directory


def source_url(item):
    url = item.get('url') or ''
    base = os.environ.get('ECCO_STORAGE_PUBLIC_URL', '').rstrip('/')
    if not url and base and str(item.get('path', '')).startswith('/api/voice-refs/'):
        url = base + item['path']
    if url and not (url.startswith('https://') or url.startswith('http://127.0.0.1') or url.startswith('http://localhost')):
        raise RuntimeError('Character voice clips must be fetched over HTTPS.')
    return url


def fetch(request, voice, output, opener=urllib.request.urlopen):
    """Return (path, reference) for a `ref:<id>` voice, verified by sha256."""
    rid = ref_id(voice)
    item = (request.get('voice_refs') or {}).get(rid) if rid else None
    if not item:
        raise RuntimeError('This character voice is missing from the request.')
    expected = item['sha256']
    output = Path(output)
    name = 'voice-ref-' + rid + '.wav'
    # Pod path: the coordinator copied the clip next to the job (or the parent job for mixed children).
    for directory in (output.parent, output.parent.parent):
        candidate = directory / name
        if candidate.is_file() and digest(candidate) == expected:
            return candidate, item
    cached = cache_dir() / (expected + '.wav')
    if cached.is_file() and digest(cached) == expected:
        return cached, item
    url = source_url(item)
    if not url:
        raise RuntimeError('This character voice clip is not available to the worker. Set ECCO_STORAGE_PUBLIC_URL or send a signed URL.')
    with opener(url, timeout=30) as response:
        data = response.read(MAX_BYTES + 1)
    if not data or len(data) > MAX_BYTES or hashlib.sha256(data).hexdigest() != expected:
        raise RuntimeError('The character voice clip failed its integrity check.')
    temporary = cached.with_name(cached.name + '.' + str(os.getpid()) + '.tmp')
    temporary.write_bytes(data)
    temporary.chmod(0o600)
    temporary.replace(cached)
    return cached, item
