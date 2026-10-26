"""Durable file queue shared by the CPU coordinator and disposable GPU workers."""
import json
import os
from pathlib import Path
import time
import uuid
from sound_schema import MODELS as SOUND_MODELS
from audio_schema import MODELS, required_models

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
        if (isinstance(worker, dict) and worker.get('compute') in ('cpu', 'a100', 'b200')
                and isinstance(worker.get('updated'), (int, float))
                and 0 <= time.time() - worker['updated'] < 30):
            result.append(worker)
    return result

def supported(worker):
    models = worker.get('models', [] if worker['compute'] == 'cpu' else ('indic-mio', 'chatterbox', 'indicf5'))
    return [model for model in MODELS if isinstance(models, (list, tuple)) and model in models]

def ready(compute=None, model=None, worker_id=''):
    return any((compute is None or w['compute'] == compute) and supported(w)
               and (not worker_id or w.get('pod') == worker_id)
               and (not worker_id or w.get('instance_routing_version') == 1)
               and (model is None or model in supported(w)) for w in workers())

def request_ready(request):
    needed = required_models(request)
    return any(w['compute'] == request['compute']
               and (not request.get('worker_id') or (w.get('pod') == request['worker_id'] and w.get('instance_routing_version') == 1))
               and needed.issubset(supported(w))
               and (not request.get('mixed_models_version') or w.get('mixed_models_version') == 1)
               for w in workers())

def sound_models(worker):
    installed = worker.get('sound_models', [])
    return [m for m in SOUND_MODELS if worker.get('sound_generation_version') == 1 and m in installed]

def sound_ready(compute, model, worker_id=''):
    return model in target(availability(), compute, worker_id).get('sound_models', [])

def target(status, compute, worker_id=''):
    if worker_id:
        return next((w for w in status.get('instances', []) if w['compute'] == compute and w['id'] == worker_id),
                    {'ready': False, 'models': [], 'sound_models': [], 'reason': 'The selected audio worker is unavailable.'})
    return status['compute'][compute]

def availability():
    live, compute = workers(), {}
    for target in ('cpu', 'a100', 'b200'):
        models = sorted({model for w in live if w['compute'] == target for model in supported(w)})
        compatible = [w for w in live if w['compute'] == target]
        sounds = sorted(set.intersection(*(set(sound_models(w)) for w in compatible))) if compatible else []
        compute[target] = {'ready': bool(models), 'models': models, 'sound_models': sounds,
                           'mixed_models_version': 1 if models and all(w.get('mixed_models_version') == 1 for w in compatible) else 0,
                           'sound_generation_version': 1 if sounds else 0,
                           'character_controls_version': 1 if models and all(w.get('character_controls_version') == 1 for w in live if w['compute'] == target) else 0,
                           'sound_design_version': 1 if models and all(w.get('sound_design_version') == 1 for w in live if w['compute'] == target) else 0,
                           'reason': '' if models else target.upper() + ' audio worker is not connected.'}
    # Keep registered/offline CPU instances visible instead of silently switching a selection.
    known = {}
    for path in (ROOT.parent / 'worker-configs').glob('*.json'):
        config = read(path, {})
        if isinstance(config, dict) and config.get('compute') == 'cpu':
            known[path.stem] = config
    for w in live:
        if w.get('pod') and w['compute'] == 'cpu':
            known.setdefault(w['pod'], {})
    instances = []
    for pod, config in sorted(known.items(), key=lambda item: (item[1].get('priority', 100), item[0])):
        w = next((w for w in live if w.get('pod') == pod and w['compute'] == 'cpu'), {})
        routable = w.get('instance_routing_version') == 1
        models = supported(w) if w else []
        sounds = sound_models(w) if w else []
        available = bool(routable and models)
        instances.append({'id': pod, 'name': config.get('name') or w.get('name') or pod, 'compute': 'cpu',
                          'ready': available, 'models': models if routable else [], 'sound_models': sounds if routable else [],
                          'cpu_count': w.get('cpu_count', config.get('cpu_count')),
                          'memory_gb': w.get('memory_gb', config.get('memory_gb')),
                          'resources': w.get('resources'), 'updated': w.get('updated'),
                          'character_controls_version': w.get('character_controls_version', 0) if routable else 0,
                          'mixed_models_version': w.get('mixed_models_version', 0) if routable else 0,
                          'sound_design_version': w.get('sound_design_version', 0) if routable else 0,
                          'sound_generation_version': w.get('sound_generation_version', 0) if routable else 0,
                          'reason': '' if available else 'Audio worker update required.' if w and not routable else 'Audio worker is unavailable or still starting.'})
    return {'routing_version': 1, 'instance_routing_version': 1, 'ready': any(v['ready'] for v in compute.values()), 'compute': compute, 'instances': instances}


