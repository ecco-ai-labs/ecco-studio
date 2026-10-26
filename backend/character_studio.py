"""Resumable character workflow owned by the authenticated storage service.

Image jobs reuse the existing GPU relay. Geometry/rig/render jobs use a private
shared-volume worker. Approval is separate from generation; failed later stages
never erase an approved asset. No AI-authored code is executed.
"""
import base64
import copy
import hashlib
import json
import logging
from pathlib import Path
import sys
import threading
import time
import uuid

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from characters import transport
from characters.glb import inspect as inspect_glb
import gpu_relay

VIEWS = {
    'front': 'full body, straight front view, neutral expression, relaxed symmetrical A pose, hands separated from torso',
    'back': 'full body, straight back view, same relaxed symmetrical A pose',
    'left': 'full body, exact left profile, neutral expression',
    'right': 'full body, exact right profile, neutral expression',
    'neutral': 'close-up face, straight front view, neutral relaxed expression',
    'smile': 'close-up face, smiling naturally',
    'angry': 'close-up face, angry expression',
    'fear': 'close-up face, frightened expression, eyes wide and eyebrows raised',
}
ACTIONS = ('stand', 'sit', 'run', 'jump', 'kick')
EXPRESSIONS = ('neutral', 'smile', 'angry', 'fear')
QUALITY = {'preview': {'resolution': 512, 'faces': 100000, 'texture_size': 2048},
           'high': {'resolution': 1024, 'faces': 500000, 'texture_size': 4096}}
STARTED = False
TICK_LOCK = threading.RLock()


def status():
    return {'available': STARTED, 'version': 1, 'views': list(VIEWS),
            'actions': list(ACTIONS), 'expressions': list(EXPRESSIONS),
            'workers': transport.health(gpu_relay.GPUS)}


def character(body, env):
    c = env['get'](body.get('character_id', ''), 'character')
    if c.get('deleted') or c.get('pipeline_version') != 1:
        raise env['Problem']('Choose a saved Studio character.')
    if body.get('revision') != c.get('revision'):
        raise env['Problem']('This character changed. Refresh before continuing.', 409)
    return c


def idle(c, env):
    if any(j.get('character_id') == c['id'] and j.get('status') in transport.ACTIVE
           for j in env['records']('character_job')):
        raise env['Problem']('Wait for this character’s current job or stop it first.', 409)


def protect_purge(body, env):
    aid = body.get('asset_id')
    if any(aid in c.get('asset_ids', []) for c in env['records']('character') if c.get('pipeline_version') == 1):
        raise env['Problem']('This asset belongs to a saved character and cannot be permanently deleted.', 409)
    if any(j.get('status') in transport.ACTIVE for j in env['records']('character_job')):
        raise env['Problem']('Wait for active character jobs before permanently deleting assets.', 409)


def image(aid, c, env):
    a = env['get'](aid, 'asset')
    if a.get('deleted') or a.get('media') != 'image' or a.get('story_id', env['LEGACY_STORY']) != c['source_story_id']:
        raise env['Problem']('Choose an available image from this story.')
    env['asset_path'](a)
    return a


def save(body, env):
    with env['LOCK']:
        if body.get('character_id'):
            c = character(body, env)
            idle(c, env)
            # Updating directions never rewrites the identity of existing models.
            if body.get('description', c['description']) != c['description'] and c.get('approved_image_id'):
                raise env['Problem']('Create a new character version to change an approved appearance.', 409)
        else:
            sid = env['story_id'](body)
            request_id = transport.identifier(body.get('request_id'))
            existing = next((r for r in env['records']() if r['id'] == request_id), None)
            if existing:
                if existing.get('kind') != 'character' or existing.get('source_story_id') != sid or existing.get('name') != body.get('name') or existing.get('description') != body.get('description'):
                    raise env['Problem']('This creation request was already used.', 409)
                return existing
            c = env['new']('character', pipeline_version=1, revision=0, source_story_id=sid,
                           image_ids=[], sheet_ids=[], views={}, performances=[], training_status='reference_only')
            c['id'] = request_id
        c.update(name=env['text'](body.get('name'), 100), description=env['text'](body.get('description'), 4000))
        c['revision'] += 1
        return env['save'](c)


def approve(body, env):
    with env['LOCK']:
        c = character(body, env)
        idle(c, env)
        stage = body.get('stage')
        if stage == 'appearance':
            aid = body.get('asset_id', '')
            image(aid, c, env)
            if c.get('approved_image_id') and c['approved_image_id'] != aid:
                raise env['Problem']('Create a new character version to replace an approved appearance.', 409)
            c['approved_image_id'] = aid
            c['image_ids'] = list(dict.fromkeys(c['image_ids'] + [aid]))
            c['asset_ids'] = list(dict.fromkeys(c.get('asset_ids', []) + [aid]))
        elif stage == 'sheet':
            if not c.get('approved_image_id') or set(c['views']) != set(VIEWS):
                raise env['Problem']('Generate and review all eight character views first.')
            for aid in c['views'].values(): image(aid, c, env)
            c['approved_views'] = dict(c['views'])
        elif stage in ('model', 'rig'):
            candidate = c.get(stage + '_asset_id')
            if not candidate or body.get('asset_id') != candidate:
                raise env['Problem']('Review the latest generated ' + stage + ' first.')
            asset = env['get'](candidate, 'asset')
            if asset.get('deleted'): raise env['Problem']('This asset is in Trash.')
            env['asset_path'](asset)
            c['approved_' + stage + '_id'] = candidate
        else:
            raise env['Problem']('Unknown character approval stage.')
        c['revision'] += 1
        return env['save'](c)


def _worker(gpu, stage, env):
    item = next((w for w in status()['workers'] if w['id'] == gpu), {})
    if not item.get('ready') or not item.get('capabilities', {}).get(stage):
        raise env['Problem']('The selected compute does not have a ready ' + stage + ' worker. ' + item.get('detail', ''), 503)


def upload(body, env):
    """Import a user-reviewed body/facial rig without accepting executable .blend files."""
    if not STARTED: raise env['Problem']('Character service is not running.', 503)
    rid = transport.identifier(body.get('request_id'))
    encoded = body.get('data', '')
    if not isinstance(encoded, str) or len(encoded) > 70 * 1024 * 1024:
        raise env['Problem']('Choose a self-contained GLB up to 50 MB.', 413)
    try: data = base64.b64decode(encoded, validate=True)
    except ValueError: raise env['Problem']('Invalid GLB upload.')
    if len(data) > 50 * 1024 * 1024: raise env['Problem']('GLB upload exceeds 50 MB.', 413)
    fingerprint = hashlib.sha256(json.dumps(body, sort_keys=True).encode()).hexdigest()
    with env['LOCK']:
        if any(r['id'] == rid and r['kind'] != 'character_job' for r in env['records']()):
            raise env['Problem']('Request ID is already in use.', 409)
        previous = next((j for j in env['records']('character_job') if j['id'] == rid), None)
        if previous:
            if previous['request_hash'] != fingerprint: raise env['Problem']('Request ID already used.', 409)
            return previous
        c = character(body, env)
        idle(c, env)
        if sum(j.get('status') in transport.ACTIVE for j in env['records']('character_job')) >= 8:
            raise env['Problem']('Character queue is full.', 429)
        gpu = body.get('gpu')
        if gpu not in gpu_relay.GPUS: raise env['Problem']('Select a connected compute instance.')
        _worker(gpu, 'import', env)
        if not c.get('approved_model_id'): raise env['Problem']('Approve the character model before importing its reviewed rig.')
        path = env['DATA'] / 'character-imports' / (rid + '.glb')
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        try:
            if not inspect_glb(path)['skinned']: raise ValueError('Import a GLB with body skin weights and an armature.')
        except Exception:
            path.unlink(missing_ok=True)
            raise
        job = dict(id=rid, kind='character_job', created=time.time(), status='queued', stage='rig',
                   label='Character · ' + c['name'] + ' · import reviewed rig', story_id=c['source_story_id'],
                   character_id=c['id'], character_revision=c['revision'], gpu=gpu, description=c['description'],
                   params={'quality': 'preview', 'input_path': str(path.resolve()), 'imported': True},
                   request_hash=fingerprint, completed=0, total=1, progress='Queued', result=[])
        return env['save'](job)


def generate(body, env):
    if not STARTED: raise env['Problem']('Character service is not running.', 503)
    rid = transport.identifier(body.get('request_id'))
    fingerprint = hashlib.sha256(json.dumps(body, sort_keys=True).encode()).hexdigest()
    with env['LOCK']:
        if any(r['id'] == rid and r['kind'] != 'character_job' for r in env['records']()):
            raise env['Problem']('Request ID is already in use.', 409)
        existing = next((j for j in env['records']('character_job') if j['id'] == rid), None)
        if existing:
            if existing['request_hash'] != fingerprint: raise env['Problem']('Request ID already used with different settings.', 409)
            return existing
        c = character(body, env)
        idle(c, env)
        if sum(j.get('status') in transport.ACTIVE for j in env['records']('character_job')) >= 8:
            raise env['Problem']('Character queue is full.', 429)
        gpu, stage = body.get('gpu'), body.get('stage')
        if gpu not in gpu_relay.GPUS: raise env['Problem']('Select a connected compute instance.')
        if stage not in ('appearance', 'sheet', 'model', 'rig', 'performance'):
            raise env['Problem']('Unknown character generation stage.')
        params = {'quality': body.get('quality', 'high')}
        if params['quality'] not in QUALITY: raise env['Problem']('Choose Preview or High quality.')
        if stage in ('appearance', 'sheet'):
            if stage == 'appearance' and len(c['description']) > 3800:
                raise env['Problem']('Shorten the appearance description to 3,800 characters to leave room for framing instructions.')
            health = next((g for g in gpu_relay.status()['gpus'] if g['id'] == gpu), {})
            settings = body.get('image_settings', {})
            model = settings.get('model', 'sdxl') if stage == 'appearance' else 'qwen-image-edit-2511'
            if model not in ('sdxl', 'qwen-image-2512', 'flux-klein-4b', 'z-image', 'qwen-image-edit-2511'):
                raise env['Problem']('Select a supported image model.')
            if not health.get('ready') or not health.get('config', {}).get('models_ready', {}).get(model):
                raise env['Problem']('The selected image model is not ready on this compute.', 503)
            params['image_settings'] = {k: settings[k] for k in ('model', 'resolution', 'sampler', 'scheduler', 'steps', 'cfg', 'seed', 'negative') if k in settings}
            if stage == 'sheet':
                if not c.get('approved_image_id'): raise env['Problem']('Approve an appearance first.')
                image(c['approved_image_id'], c, env)
                if c.get('approved_model_id'): raise env['Problem']('Create a new version before changing a model’s approved views.', 409)
                view = body.get('view')
                if view and view not in VIEWS: raise env['Problem']('Unknown character view.')
                params['views'] = [view] if view else [v for v in VIEWS if v not in c['views']]
                if not params['views']: raise env['Problem']('All views exist. Choose a single view to regenerate.')
            elif c.get('approved_image_id'):
                raise env['Problem']('Create a new version before changing an approved appearance.', 409)
        else:
            _worker(gpu, stage, env)
            if stage == 'model':
                if c.get('approved_views') != c.get('views') or set(c.get('views', {})) != set(VIEWS):
                    raise env['Problem']('Approve the complete character set first.')
                if c.get('approved_rig_id'): raise env['Problem']('Create a new version before replacing a rigged model.', 409)
                params['input_asset_id'] = c['approved_views']['front']
            elif stage == 'rig':
                if not c.get('approved_model_id'): raise env['Problem']('Approve the 3D model first.')
                params['input_asset_id'] = c['approved_model_id']
            else:
                if not c.get('approved_rig_id'): raise env['Problem']('Approve the rig first.')
                params.update(input_asset_id=c['approved_rig_id'], action=body.get('action', 'stand'),
                              expression=body.get('expression', 'neutral'), seconds=body.get('seconds', 3),
                              camera=body.get('camera', 'front'), output=body.get('output', 'clip'))
                if params['action'] not in ACTIONS or params['expression'] not in EXPRESSIONS:
                    raise env['Problem']('Unknown action or expression.')
                if type(params['seconds']) not in (int, float) or not 1 <= params['seconds'] <= 10:
                    raise env['Problem']('Choose a duration from 1 to 10 seconds.')
                if params['camera'] not in ('front', 'three-quarter', 'side') or params['output'] not in ('still', 'clip'):
                    raise env['Problem']('Choose a supported camera and output.')
                report = c.get('rig_report', {})
                if params['action'] not in report.get('actions', []):
                    raise env['Problem']('This rig needs its body controls mapped in Blender before that action can run.', 409)
                if params['expression'] not in report.get('expressions', ['neutral']):
                    raise env['Problem']('This rig does not contain the requested facial expression. Add facial shape keys in Blender and import the reviewed GLB.', 409)
            asset = env['get'](params['input_asset_id'], 'asset')
            if asset.get('deleted'): raise env['Problem']('The source asset is in Trash.')
            params['input_path'] = str(env['asset_path'](asset))
        job = {'id': rid, 'kind': 'character_job', 'created': time.time(), 'status': 'queued',
               'label': 'Character · ' + c['name'] + ' · ' + stage, 'story_id': c['source_story_id'],
               'character_id': c['id'], 'character_revision': c['revision'], 'stage': stage, 'gpu': gpu,
               'description': c['description'], 'source_image_id': c.get('approved_image_id'),
               'params': params, 'request_hash': fingerprint, 'completed': 0,
               'total': len(params.get('views', [stage])), 'progress': 'Queued', 'result': []}
        env['save'](job)
        return job


def cancel(jid, env):
    with env['LOCK']:
        job = env['get'](jid, 'character_job')
        if job['status'] not in transport.ACTIVE: return job
        job.update(status='cancelling', cancel_requested=True, progress='Stopping…')
        env['save'](job)
        transport.write(transport.directory(job['gpu'], jid) / 'cancel.json', {'at': time.time()})
        return job


def _dispatch_id(job):
    return uuid.uuid5(uuid.NAMESPACE_URL, job['id'] + ':' + str(job['completed'])).hex


def _images(job, env):
    rid = _dispatch_id(job)
    if not job.get('dispatch_id'):
        if job.get('cancel_requested'): return _finish(job, env, 'cancelled')
        if job['stage'] == 'appearance':
            path = 'images'
            body = {**job['params']['image_settings'], 'story_id': job['story_id'],
                    'prompt': job['description'] + '\nSingle character, full body visible including hands and feet, neutral studio background. No collage or text.'}
        else:
            view = job['params']['views'][job['completed']]
            path = 'image-edits'
            body = {'asset_id': job['source_image_id'], 'story_id': job['story_id'], 'seed': 42 + list(VIEWS).index(view),
                    'prompt': 'Show this exact character: ' + VIEWS[view] + '. Preserve identity, proportions, skin tone, hair and clothing. Plain neutral studio background, even lighting. One view, no collage, no labels. ' + job['description'][:2000]}
        # Store intent BEFORE sending; replay uses the identical relay ID.
        job.update(dispatch_id=rid, dispatch_path=path, dispatch_body=body)
        env['save'](job)
    if not job.get('upstream_job_id'):
        gpu_relay.submit({'gpu': job['gpu'], 'path': job['dispatch_path'], 'body': job['dispatch_body'], 'request_id': job['dispatch_id']})
        response = gpu_relay.result(job['gpu'], job['dispatch_id'])
        if response['status'] == 'pending': return
        if response['status'] != 'done': raise env['Problem'](response.get('error', 'Image submission failed.'))
        upstream = response.get('result', {})
        transport.identifier(upstream.get('id'))
        job['upstream_job_id'] = upstream['id']
        env['save'](job)
    upstream = env['get'](job['upstream_job_id'], 'job')
    if job.get('cancel_requested') and upstream.get('status') in ('queued', 'running'):
        import generation_controls
        generation_controls.stop({'job_id': upstream['id']}, env)
    if upstream.get('status') in ('failed', 'cancelled', 'interrupted'):
        return _finish(job, env, 'cancelled' if job.get('cancel_requested') else 'failed', upstream.get('error', 'Image generation stopped.'))
    if upstream.get('status') != 'done':
        job['status'] = 'cancelling' if job.get('cancel_requested') else 'running'
        job['progress'] = upstream.get('progress') or 'Waiting for image generation'
        env['save'](job)
        return
    aid = upstream.get('result')
    c = env['get'](job['character_id'], 'character')
    image(aid, c, env)
    if aid not in job['result']:
        c['asset_ids'] = list(dict.fromkeys(c.get('asset_ids', []) + [aid]))
        if job['stage'] == 'appearance':
            c['image_ids'] = list(dict.fromkeys(c['image_ids'] + [aid]))
        else:
            c['views'][job['params']['views'][job['completed']]] = aid
            c['sheet_ids'] = list(dict.fromkeys(c['sheet_ids'] + [aid]))
            c.pop('approved_views', None)
        env['save'](c)
        job['result'].append(aid)
    job['completed'] += 1
    for key in ('dispatch_id', 'dispatch_path', 'dispatch_body', 'upstream_job_id'): job.pop(key, None)
    env['save'](job)
    if job.get('cancel_requested'): return _finish(job, env, 'cancelled')
    if job['completed'] == job['total']: _finish(job, env, 'done')


def _finish(job, env, state, error=''):
    job.update(status=state, error=error[:1000], finished=time.time(),
               progress='Ready for review' if state == 'done' else 'Stopped' if state == 'cancelled' else error[:1000])
    env['save'](job)


def _outputs(job, response, env):
    c = env['get'](job['character_id'], 'character')
    base = (env['DATA'] / 'character-dev' / job['id']).resolve()
    files = response.get('files', [])
    if not files or len(files) > 12: raise env['Problem']('Character worker returned no valid output.')
    roles, assets = {}, []
    extensions = {'.glb': 'model', '.blend': 'model', '.png': 'image', '.mp4': 'video'}
    for item in files:
        file = (base / item['name']).resolve()
        if not file.is_relative_to(base) or file.suffix not in extensions or not file.is_file() or not file.stat().st_size:
            raise env['Problem']('Character worker output is invalid.')
        role = item['role']
        aid = uuid.uuid5(uuid.NAMESPACE_URL, job['id'] + ':' + role).hex
        record = dict(id=aid, kind='asset', created=job['created'], media=extensions[file.suffix], stage='dev',
                      path=str(file.relative_to(env['DATA'].resolve())), story_id=job['story_id'],
                      character_id=c['id'], character_stage=job['stage'], character_role=role,
                      title=c['name'] + ' · ' + role, job_id=job['id'], model=response.get('model', 'Blender'),
                      prompt=job['description'], size_bytes=file.stat().st_size, settings=job['params'])
        assets.append(record)
        roles[role] = aid
    required = 'model' if job['stage'] == 'model' else 'rig' if job['stage'] == 'rig' else 'still'
    if required not in roles or 'blend' not in roles: raise env['Problem']('Character worker output is incomplete.')
    if job['stage'] == 'performance' and job['params']['output'] == 'clip' and 'clip' not in roles:
        raise env['Problem']('Animation render did not produce a clip.')
    if job['stage'] == 'rig' and not response.get('rig_report', {}).get('skinned'):
        raise env['Problem']('Rig validation failed: no deforming skeleton and skin weights.')
    for record in assets: env['save'](record)
    c['asset_ids'] = list(dict.fromkeys(c.get('asset_ids', []) + [a['id'] for a in assets]))
    if job['stage'] in ('model', 'rig'):
        c[job['stage'] + '_asset_id'] = roles[required]
        c[job['stage'] + '_outputs'] = roles
        c.pop('approved_' + job['stage'] + '_id', None)
        if job['stage'] == 'model':
            c.pop('approved_rig_id', None)
            c.pop('rig_asset_id', None)
            c.pop('rig_outputs', None)
            c.pop('rig_report', None)
        else:
            c['rig_report'] = response['rig_report']
    else:
        if not any(p['job_id'] == job['id'] for p in c['performances']):
            c['performances'].append({'job_id': job['id'], 'outputs': roles, 'settings': job['params']})
    c['revision'] += 1
    env['save'](c)
    job.update(result=[a['id'] for a in assets], completed=1)
    _finish(job, env, 'done')


def tick(env):
    with TICK_LOCK, env['LOCK']:
        for saved in env['records']('character_job'):
            if saved.get('status') not in transport.ACTIVE: continue
            job = copy.deepcopy(saved)
            try:
                if job['stage'] in ('appearance', 'sheet'):
                    _images(job, env)
                    continue
                base = transport.directory(job['gpu'], job['id'])
                if job.get('cancel_requested') and (base / 'request.json').exists():
                    try:
                        (base / 'request.json').rename(base / 'cancelled-request.json')
                        _finish(job, env, 'cancelled')
                        continue
                    except FileNotFoundError:
                        pass  # Worker won the claim; it must acknowledge Stop.
                if job.get('cancel_requested') and not any((base / n).exists() for n in ('request.json', 'working.json', 'result.json')):
                    _finish(job, env, 'cancelled')
                    continue
                task = {**job, 'data_root': str(env['DATA'].resolve()),
                        'output_dir': str((env['DATA'] / 'character-dev' / job['id']).resolve())}
                transport.submit(task)
                response = transport.read(base / 'result.json')
                if response:
                    if job.get('cancel_requested') or response.get('status') == 'cancelled': _finish(job, env, 'cancelled')
                    elif response.get('status') != 'done': _finish(job, env, 'failed', response.get('error', 'Character generation failed.'))
                    else: _outputs(job, response, env)
                else:
                    progress = transport.read(base / 'progress.json')
                    job['progress'] = progress.get('message', 'Waiting for character worker')
                    job['status'] = 'cancelling' if job.get('cancel_requested') else 'running' if progress else 'queued'
                    if progress and time.time() - progress.get('at', 0) > 120:
                        job['progress'] = 'Worker connection lost; waiting to reconcile. No duplicate submitted.'
                    env['save'](job)
            except (env['Problem'], ValueError) as exc:
                _finish(job, env, 'failed', getattr(exc, 'message', str(exc)))
            except Exception:
                # Unknown dispatch state must not lead to blind retry/new inference.
                logging.exception('Character job reconciliation failed: %s', job['id'])
                job['progress'] = 'Waiting to reconcile character job; check service logs.'
                env['save'](job)


def start(env):
    global STARTED
    if STARTED: return
    STARTED = True
    def run():
        while True:
            try: tick(env)
            except Exception: logging.exception('Character coordinator poll failed')
            time.sleep(2)
    threading.Thread(target=run, name='character-coordinator', daemon=True).start()


def job_view(record):
    if record.get('kind') != 'character_job': return record
    return {**record, 'kind': 'job', 'source_kind': 'character_job',
            'media': 'image' if record['stage'] in ('appearance', 'sheet', 'model', 'rig') else 'video'}


def handle(path, body, env):
    return {'save': save, 'approve': approve, 'generate': generate, 'upload': upload}[path.rsplit('/', 1)[-1]](body, env)
