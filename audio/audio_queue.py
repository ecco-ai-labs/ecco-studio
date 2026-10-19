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

def workers():
    result = []
    for path in ROOT.glob('worker-*.json'):
        worker = read(path, {})
        if (isinstance(worker, dict) and worker.get('compute') in ('a100', 'b200')
                and isinstance(worker.get('updated'), (int, float))
                and 0 <= time.time() - worker['updated'] < 30):
            result.append(worker)
    return result

def ready(compute=None):
    return any(compute is None or w['compute'] == compute for w in workers())

def availability():
    live = {w['compute'] for w in workers()}
    compute = {target: {'ready': target in live,
                       'reason': '' if target in live else target.upper() + ' audio worker is not connected.'}
               for target in ('a100', 'b200')}
    compute['cpu'] = {'ready': False, 'reason': 'CPU audio generation is not enabled yet. Select A100.'}
    return {'routing_version': 1, 'ready': bool(live), 'compute': compute}

