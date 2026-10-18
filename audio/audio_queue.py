"""Durable file queue shared by the CPU coordinator and disposable GPU workers."""
import json
import os
from pathlib import Path
import time
import uuid

ROOT = Path(os.getenv('ECCO_AUDIO_QUEUE', '/workspace/ecco-audio/queue'))

def write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temporary = path.with_name(path.name + '.' + uuid.uuid4().hex + '.tmp')
    with temporary.open('x') as f:
        os.chmod(temporary, 0o600)
        json.dump(data, f)
        f.flush()
        os.fsync(f.fileno())
    temporary.replace(path)

def read(path, default=None):
    try:
        return json.loads(path.read_text())
    except (FileNotFoundError, ValueError):
        return default

def ready():
    return any(time.time() - read(p, {}).get('updated', 0) < 30
               for p in ROOT.glob('worker-*.json'))
