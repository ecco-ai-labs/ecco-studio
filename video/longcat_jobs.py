"""Private CPU job coordination and GPU-only LongCat worker."""
import fcntl
import hashlib
import json
import math
import os
import re
from pathlib import Path
import shutil
import subprocess
import sys
import threading
import time
import uuid

ROOT = Path(os.getenv('ECCO_LONGCAT_ROOT', '/workspace/ecco-video/longcat'))
QUEUE = ROOT / 'queue'
MODEL = 'longcat-avatar-1.5'
LOCK = threading.RLock()

def read(path, default=None):
    try: return json.loads(path.read_text())
    except (OSError, ValueError): return default

def write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temp = path.with_name(path.name + '.' + uuid.uuid4().hex + '.tmp')
    temp.write_text(json.dumps(data)); temp.chmod(0o600); temp.replace(path)

def status():
    workers = [read(p, {}) for p in QUEUE.glob('worker-*.json')]
    workers = [w for w in workers if time.time()-w.get('updated', 0)<45 and w.get('ready')]
    return {'ready': bool(workers), 'workers': workers, 'model': MODEL,
            'downloaded': read(ROOT/'download-status.json', {}).get('state')=='downloaded'}

def probe(path):
    return json.loads(subprocess.check_output(['ffprobe','-v','error','-show_streams','-show_format','-of','json',str(path)],timeout=30))

def public(job):
    return {k:v for k,v in job.items() if k!='request'}

def generate(body, env):
    with LOCK:
        supplied_id = body.get('request_id')
        signature = hashlib.sha256(json.dumps(body,sort_keys=True).encode()).hexdigest()
        if supplied_id:
            if not isinstance(supplied_id,str) or not re.fullmatch('[a-f0-9]{32}',supplied_id): raise env['Problem']('Invalid request ID.')
            existing = next((j for j in env['records']('longcat_job') if j['id']==supplied_id),None)
            if existing:
                if existing.get('submission_hash')!=signature: raise env['Problem']('Request ID conflict.',409)
                return public(existing)
        sid = env['story_id'](body)
        pod = str(body.get('gpu',''))
        if not any(w['pod']==pod for w in status()['workers']):
            raise env['Problem']('LongCat is not ready on the selected accelerator.',503)
        prompt = str(body.get('prompt','')).strip()
        if not 1<=len(prompt)<=4000: raise env['Problem']('Add a motion prompt of up to 4,000 characters.')
        image = env['get'](body.get('image_id',''),'asset')
        audio = env['get'](body.get('audio_id',''),'asset')
        for asset,kind in [(image,'image'),(audio,'audio')]:
            if asset.get('deleted') or asset.get('media')!=kind:
                raise env['Problem']('Select an available '+kind+' from your library.')
        audio_path = env['asset_path'](audio)
        duration = float(probe(audio_path)['format']['duration'])
        audio_start=float(body.get('audio_start',0));audio_end=float(body.get('audio_end',duration))
        if not math.isfinite(audio_start) or not math.isfinite(audio_end) or audio_start<0 or audio_end>duration+.01 or audio_end<=audio_start: raise env['Problem']('Invalid audio boundaries.')
        duration=audio_end-audio_start
        if not 0.2<=duration<=10.01: raise env['Problem']('Choose dialogue between 0.2 and 10 seconds for this shot.')
        resolution = body.get('resolution','832x480')
        if resolution not in ('832x480','1280x720'): raise env['Problem']('Unsupported LongCat resolution.')
        seed = int(body.get('seed',42))
        if not 0<=seed<=2147483647: raise env['Problem']('Seed must be between 0 and 2147483647.')
        if any(j.get('status') in ('queued','running') for j in env['records']('longcat_job')):
            raise env['Problem']('A LongCat shot is already running. Wait for it to finish.',429)
        jid = supplied_id or uuid.uuid4().hex; directory = QUEUE/jid
        directory.mkdir(parents=True,mode=0o700)
        # The browser provides asset IDs only; private filesystem paths never leave this service.
        shutil.copyfile(env['asset_path'](image),directory/'image.png')
        if audio_start or 'audio_end' in body:
            subprocess.run(['ffmpeg','-y','-v','error','-ss',str(audio_start),'-i',str(audio_path),'-t',str(duration),'-ac','1','-ar','16000','-f','wav',str(directory/'audio-source')],check=True,timeout=30)
        else:
            shutil.copyfile(audio_path,directory/'audio-source')
        request = dict(prompt=prompt,pod=pod,resolution=resolution,seed=seed,duration=duration)
        job = dict(id=jid,kind='longcat_job',media='video',model=MODEL,story_id=sid,
                   title='LongCat dialogue shot',label='Video · LongCat',created=time.time(),
                   status='queued',progress='Queued',request=request,submission_hash=signature)
        env['save'](job)
        write(directory/'status.json',{'status':'queued'})
        write(directory/'request.json',request)
        return public(job)

def finalize(job, env):
    with LOCK:
        job=env['get'](job['id'],'longcat_job')
        if job['status'] not in ('queued','running'): return
        d=QUEUE/job['id']; result=read(d/'status.json',{})
        s=result.get('status')
        if s=='complete':
            source=d/'output.mp4'; digest=hashlib.sha256(source.read_bytes()).hexdigest()
            if digest!=result['sha256']: raise ValueError('Video integrity verification failed')
            target=env['DATA']/'video-dev'/(job['id']+'.mp4'); target.parent.mkdir(parents=True,exist_ok=True)
            temp=target.with_suffix('.tmp'); shutil.copyfile(source,temp); temp.replace(target)
            aid=hashlib.sha256(('longcat-asset:'+job['id']).encode()).hexdigest()[:32]
            env['save'](dict(id=aid,kind='asset',media='video',stage='dev',story_id=job['story_id'],
                created=time.time(),title=job['title'],prompt=job['request']['prompt'],
                path='video-dev/'+target.name,job_id=job['id'],mode='longcat',has_audio=True,
                seconds=result['duration'],sha256=digest,settings={'model':MODEL,**job['request']},sync='pending'))
            job.update(status='done',result=[aid],progress='Video ready',finished=time.time())
        elif s in ('running','error'):
            job.update(status='failed' if s=='error' else s,progress=result.get('progress',''),error=result.get('error',''))
        env['save'](job)

def start(env):
    def loop():
        while True:
            for job in env['records']('longcat_job'):
                if job.get('status') not in ('queued','running'): continue
                try: finalize(job,env)
                except Exception:
                    import traceback; traceback.print_exc()
            time.sleep(2)
    threading.Thread(target=loop,daemon=True,name='longcat-finalizer').start()

def run_shot(d, request):
    subprocess.run(['ffmpeg','-y','-v','error','-i',str(d/'audio-source'),'-ac','1','-ar','16000',str(d/'audio.wav')],check=True,timeout=30)
    write(d/'input.json',dict(prompt=request['prompt'],cond_image=str(d/'image.png'),cond_audio={'person1':str(d/'audio.wav')}))
    segments=max(1,math.ceil((request['duration']*25-93)/80)+1)
    command=[str(ROOT/'venv/bin/python'),'-m','torch.distributed.run','--standalone','--nproc_per_node=1',
        str(ROOT/'runner.py'),'--input_json',str(d/'input.json'),'--output_dir',str(d/'render'),
        '--checkpoint_dir',str(ROOT/'weights/LongCat-Video-Avatar-1.5'),'--context_parallel_size','1',
        '--model_type','avatar-v1.5','--use_distill','--resolution','480p' if request['resolution']=='832x480' else '720p',
        '--num_segments',str(segments),'--stage_1','ai2v']
    env={**os.environ,'PYTHONPATH':str(ROOT/'source'),'ECCO_LONGCAT_SEED':str(request['seed']),
         'HF_HUB_OFFLINE':'1','TRANSFORMERS_OFFLINE':'1','OMP_NUM_THREADS':'4'}
    with (d/'worker.log').open('w') as log:
        subprocess.run(command,cwd=d,env=env,stdout=log,stderr=subprocess.STDOUT,check=True,timeout=2400)
    name='ai2v_demo_1.mp4' if segments==1 else 'video_continue_'+str(segments)+'.mp4'
    subprocess.run(['ffmpeg','-y','-v','error','-i',str(d/'render'/name),'-t',str(request['duration']),
                    '-c:v','copy','-c:a','aac','-movflags','+faststart',str(d/'output.mp4')],check=True,timeout=60)
    info=probe(d/'output.mp4')
    if not all(any(s['codec_type']==kind for s in info['streams']) for kind in ('audio','video')):
        raise ValueError('Output must include video and audio streams')
    write(d/'status.json',dict(status='complete',duration=float(info['format']['duration']),
          sha256=hashlib.sha256((d/'output.mp4').read_bytes()).hexdigest()))

def worker():
    import torch
    QUEUE.mkdir(parents=True,exist_ok=True)
    lock=(QUEUE/'worker.lock').open('a'); fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    pod=os.environ.get('RUNPOD_POD_ID','local'); heart=QUEUE/('worker-'+pod+'.json')
    # Full-precision runtime is enabled only on the tested B200 configuration.
    ready=bool(read(ROOT/'validated.json',{}).get('passed')) and 'B200' in torch.cuda.get_device_name(0)
    stop=threading.Event()
    def beat():
        while not stop.is_set():
            write(heart,dict(updated=time.time(),pod=pod,ready=ready,model=MODEL)); stop.wait(3)
    threading.Thread(target=beat,daemon=True).start()
    for d in QUEUE.glob('[a-f0-9]'*32):
        if read(d/'status.json',{}).get('status')=='running': write(d/'status.json',dict(status='error',error='Worker restarted. Generate this shot again.'))
    while True:
        for d in sorted(QUEUE.glob('[a-f0-9]'*32)):
            r=read(d/'request.json',{}); s=read(d/'status.json',{})
            if not ready or r.get('pod')!=pod or s.get('status')!='queued': continue
            write(d/'status.json',dict(status='running',progress='Running Generation'))
            try: run_shot(d,r)
            except Exception:
                write(d/'status.json',dict(status='error',error='LongCat generation failed. See the job worker log; no fallback model was used.'))
        time.sleep(2)

if __name__=='__main__': worker()

