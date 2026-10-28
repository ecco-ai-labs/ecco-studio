"""Authenticated CPU coordinator for explicit, review-before-apply VACE repairs.

The queue lives on the existing shared volume. It never starts/provisions GPUs.
A candidate contains only the requested source IDs; exporting is a separate action.
"""
import base64
import hashlib
import json
import os
import re
import threading
import time
from pathlib import Path
import frame_editor as fe

ROOT = Path(os.environ.get('ECCO_FRAME_REPAIR_ROOT', '/workspace/ecco-video/frame-repair'))
MODEL = 'Wan-AI/Wan2.1-VACE-1.3B-diffusers'
_lock = threading.RLock()


def atomic(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(path.name + '.' + str(threading.get_ident()) + '.tmp')
    temp.write_text(json.dumps(value)); temp.chmod(0o600); temp.replace(path)


def read(path):
    return json.loads(path.read_text())


def status():
    workers = []
    for path in (ROOT/'workers').glob('*.json'):
        try:
            record = read(path)
            fresh = 0 <= time.time()-record.get('updated', 0) < 45
            workers.append({'id':path.stem,'available':bool(fresh and record.get('ready') and not record.get('busy')),
                            'reason':record.get('reason','') if fresh else 'Worker offline'})
        except (OSError, ValueError, TypeError):
            continue
    return {'available':any(w['available'] for w in workers), 'workers':workers, 'model':MODEL,
            'resolution':'480p', 'max_span':100, 'context_frames':10,
            'reason':'Start the configured VACE repair worker on your selected GPU. No GPU is started automatically.'}


def directory(request_id, env):
    if not isinstance(request_id,str) or not re.fullmatch('[a-f0-9]{32}',request_id):
        raise env['Problem']('Invalid repair request ID.')
    return ROOT/'jobs'/request_id


def job(request_id, env):
    root = directory(request_id,env)
    try:
        record = read(root/'job.json')
    except FileNotFoundError:
        raise env['Problem']('Repair request not found.',404)
    asset = env['get'](record['asset_id'],'asset')
    if asset.get('deleted') or asset.get('story_id',env['LEGACY_STORY']) != record['story_id']:
        raise env['Problem']('Repair source is no longer available.',409)
    result = root/'result.json'
    progress = root/'progress.json'
    if progress.exists(): record.update(read(progress))
    if result.exists():
        record.update(read(result))
    elif record['status'] in ('queued','running') and time.time()-record['created'] > 7200:
        record.update(status='failed',error='Repair expired without a result. Submit a new request.')
        atomic(result,{'status':'failed','error':record['error']})
    return record


def submit(body, env):
    root = directory(body.get('request_id'),env)
    prompt = body.get('instructions')
    if not isinstance(prompt,str) or not 1 <= len(prompt.strip()) <= 2000:
        raise env['Problem']('Describe the correction in up to 2000 characters.')
    digest = hashlib.sha256(json.dumps(body,sort_keys=True).encode()).hexdigest()
    with _lock:
        if (root/'job.json').exists():
            existing=job(body['request_id'],env)
            if existing['digest'] != digest: raise env['Problem']('Repair request ID already used.',409)
            return existing
        worker = next((w for w in status()['workers'] if w['id']==body.get('worker_id') and w['available']),None)
        if not worker: raise env['Problem']('The selected repair worker is not ready. Check compute and try again.',503)
        for path in (ROOT/'jobs').glob('*/job.json'):
            old=read(path)
            if old.get('worker_id')==worker['id'] and not (path.parent/'result.json').exists() and time.time()-old['created']<7200:
                raise env['Problem']('This repair worker already has a job. Wait for it to finish.',429)
        asset,source,info,edit=fe.validate({**body,'removed':[]},env)
        try: targets=fe.frame_ids(body.get('original_frame_ids'),edit['total'])
        except ValueError as error: raise env['Problem'](str(error))
        if not targets or targets[-1]-targets[0]>=100:
            raise env['Problem']('Select frames within a span of 100 frames (4 seconds).')
        record={'id':body['request_id'],'asset_id':asset['id'],'story_id':body['story_id'],'worker_id':worker['id'],
                'digest':digest,'created':time.time(),'status':'queued','progress':'Preparing source and context',
                'fps':25,'total':edit['total'],'original_frame_ids':targets,'model':MODEL,
                'from':max(1,targets[0]-10),'to':min(edit['total'],targets[-1]+10)}
        root.mkdir(parents=True,exist_ok=True);atomic(root/'job.json',record)
        threading.Thread(target=prepare,args=(root,record,source,edit,prompt.strip()),daemon=True).start()
        return record


def prepare(root, record, source, edit, prompt):
    try:
        inputs=root/'input';inputs.mkdir(exist_ok=True)
        start,end=record['from'],record['to']
        fe.run(['ffmpeg','-v','error','-threads','2','-i',str(source),'-an','-vf',
                'fps=25,select=between(n\\,%d\\,%d)'%(start-1,end-1),'-vsync','0',
                '-start_number',str(start),'-frames:v',str(end-start+1),'-q:v','2','-threads','2',str(inputs/'%06d.jpg')])
        if len(list(inputs.glob('*.jpg')))!=end-start+1: raise ValueError('Source context frame count changed.')
        for key,data in edit['replacements'].items():
            if start<=int(key)<=end:
                raw=root/('replacement-'+key);raw.write_bytes(base64.b64decode(data.split(',',1)[1],validate=True))
                fe.run(['ffmpeg','-v','error','-y','-i',str(raw),'-frames:v','1','-q:v','2','-threads','1',str(inputs/('%06d.jpg'%int(key)))])
                raw.unlink()
        atomic(root/'request.json',{**record,'instructions':prompt})
    except Exception as error:
        atomic(root/'result.json',{'status':'failed','error':str(error),'progress':'Repair preparation failed'})


def candidate(request_id, env):
    record=job(request_id,env)
    if record['status']!='done': raise env['Problem']('Repair candidate is not ready.',409)
    root=directory(request_id,env);frames={}
    for n in record['original_frame_ids']:
        raw=(root/'output'/('%06d.jpg'%n)).read_bytes()
        if not raw.startswith(b'\xff\xd8\xff') or len(raw)>89980: raise env['Problem']('Invalid candidate output.',500)
        frames[str(n)]='data:image/jpeg;base64,'+base64.b64encode(raw).decode()
    return {'id':record['id'],'asset_id':record['asset_id'],'fps':25,'total':record['total'],'frames':frames,
            'model':MODEL,'resolution':'480p'}


def handle_get(path, env):
    if path=='/api/frame-editor/repair-status':return status()
    if path.startswith('/api/frame-editor/repairs/'):return job(path.rsplit('/',1)[-1],env)
    if path.startswith('/api/frame-editor/repair-candidate/'):return candidate(path.rsplit('/',1)[-1],env)
    raise env['Problem']('Unknown repair action.',404)
