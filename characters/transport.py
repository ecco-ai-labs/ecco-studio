"""Private shared-volume transport; no HTTP listener or credentials in tasks."""
import json
import os
from pathlib import Path
import re
import time
import uuid

ROOT = Path(os.getenv('ECCO_CHARACTER_QUEUE', '/workspace/ecco-character-queue'))
ACTIVE = ('queued', 'running', 'cancelling')


def identifier(value):
    if not isinstance(value, str) or not re.fullmatch(r'[a-f0-9]{32}', value):
        raise ValueError('Invalid request ID')
    return value


def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temp = path.with_name(path.name + '.' + uuid.uuid4().hex + '.tmp')
    fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w') as stream:
        json.dump(value, stream)
    os.replace(temp, path)


def read(path):
    try:
        return json.loads(path.read_text())
    except (ValueError, OSError):
        return {}


def directory(pod, jid):
    if not isinstance(pod, str) or not re.fullmatch(r'[a-z0-9]{8,40}', pod):
        raise ValueError('Invalid compute ID')
    return ROOT / pod / identifier(jid)


def health(pods):
    result = []
    for pod in pods:
        item = read(ROOT / pod / 'health.json')
        fresh = 0 <= time.time() - item.get('at', 0) < 45
        result.append({'id': pod, 'ready': fresh and item.get('ready') is True,
                       'capabilities': item.get('capabilities', {}) if fresh else {},
                       'detail': item.get('detail', '') if fresh else 'Character worker is not connected.'})
    return result


def submit(task):
    base = directory(task['gpu'], task['id'])
    # Coordinator persists before dispatch; restarting cannot create a new task.
    if not any((base / name).exists() for name in ('request.json', 'working.json', 'result.json')):
        write(base / 'request.json', task)
    return base
