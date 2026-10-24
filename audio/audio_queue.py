"""Durable file queue shared by the CPU coordinator and disposable GPU workers."""
import json
import os
from pathlib import Path
import time
import uuid
from sound_schema import MODELS as SOUND_MODELS

ROOT = Path(os.getenv('ECCO_AUDIO_QUEUE', '/workspace/ecco-audio/queue'))
MODELS = ('indic-mio', 'chatterbox', 'indicf5')

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
        if (isinstance(worker, dict) and worker.get('compute') in ('cpu', 'a100', 'b200')
                and isinstance(worker.get('updated'), (int, float))
                and 0 <= time.time() - worker['updated'] < 30):
            result.append(worker)
    return result

def supported(worker):
    models = worker.get('models', [] if worker['compute'] == 'cpu' else MODELS)
    return [model for model in MODELS if isinstance(models, (list, tuple)) and model in models]

def ready(compute=None, model=None):
    return any((compute is None or w['compute'] == compute) and supported(w)
               and (model is None or model in supported(w)) for w in workers())

def sound_models(worker):
    installed = worker.get('sound_models', [])
    return [m for m in SOUND_MODELS if worker.get('sound_generation_version') == 1 and m in installed]

def sound_ready(compute, model):
    return model in availability()['compute'][compute]['sound_models']

def availability():
    live, compute = workers(), {}
    for target in ('cpu', 'a100', 'b200'):
        models = sorted({model for w in live if w['compute'] == target for model in supported(w)})
        compatible = [w for w in live if w['compute'] == target]
        sounds = sorted(set.intersection(*(set(sound_models(w)) for w in compatible))) if compatible else []
        compute[target] = {'ready': bool(models), 'models': models, 'sound_models': sounds,
                           'sound_generation_version': 1 if sounds else 0,
                           'character_controls_version': 1 if models and all(w.get('character_controls_version') == 1 for w in live if w['compute'] == target) else 0,
                           'sound_design_version': 1 if models and all(w.get('sound_design_version') == 1 for w in live if w['compute'] == target) else 0,
                           'reason': '' if models else target.upper() + ' audio worker is not connected.'}
    return {'routing_version': 1, 'ready': any(v['ready'] for v in compute.values()), 'compute': compute}


