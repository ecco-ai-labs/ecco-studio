import json,time,os,threading
from pathlib import Path
BASE=Path('/workspace/ecco-b200-benchmark'); HEART=BASE/'heartbeat.json'
def ready():
 try:
  h=json.loads(HEART.read_text());return time.time()-h['time']<20 and h.get('ready',False)
 except Exception:return False
def alive(j):
 return ready() and j.get('gpu_type')=='b200'

def local_gpu():
 hardware=__import__('accelerator_status').status()
 devices=hardware.get('devices',[])
 if hardware.get('status')!='detected' or not devices:return None
 name=' + '.join(d['name'] for d in devices)
 lower=name.lower()
 kind='b200' if 'b200' in lower else 'a100' if 'a100' in lower else 'local'
 rate={'b200':7.99,'a100':1.794}.get(kind)
 return {'id':kind,'name':name,'hourly_rate':rate,'ready':True,'local':True}
def options():
 current=local_gpu()
 if not current:return [{'id':'local','name':'Accelerator unverified','hourly_rate':None,'ready':False}]
 return [current]
def submit(body,e):
 current=local_gpu()
 if not current:raise e['Problem']('Accelerator could not be verified. Refresh and try again.',503)
 selected=body.get('gpu_type') or current['id']
 if selected!=current['id']:raise e['Problem']('GPU selection changed. Refresh and select the connected accelerator.',409)
 j=e['render_video'](body)
 e['job_update'](j['id'],gpu_type=current['id'],gpu_name=current['name'],gpu_hourly_rate=current['hourly_rate'])
 return e['get'](j['id'],'job')
def cancel(body,e):
 j=e['get'](body.get('job_id',''),'job')
 if not j.get('remote_worker'):return __import__('video_progress').cancel(body,e)
 if j['status'] in ('queued','running'):e['job_update'](j['id'],cancel_requested=True,stage='Cancelling on B200')
 return e['get'](j['id'],'job')
def worker():
 import studio
 BASE.mkdir(exist_ok=True)
 # Separate filesystem and localhost GPU service; source weights are shared read-only.
 studio.COMFY_ROOT=Path('/opt/ecco-b200-comfy');studio.COMFY='http://127.0.0.1:8188';studio.RATE=7.99
 def beat():
  while True:
   try:
    studio.request(studio.COMFY+'/system_stats',timeout=3)
    p=HEART.with_suffix('.tmp');p.write_text(json.dumps({'time':time.time(),'ready':True,'pid':os.getpid()}));p.replace(HEART)
   except Exception:pass
   time.sleep(5)
 threading.Thread(target=beat,daemon=True).start()
 while True:
  jobs=sorted([j for j in studio.records('job') if j.get('gpu_type')=='b200' and j['status']=='queued'],key=lambda j:j['created'])
  if not jobs:time.sleep(2);continue
  job=jobs[0];jid=job['id'];start=time.monotonic()
  if job.get('cancel_requested'):studio.job_update(jid,status='cancelled');continue
  studio.job_update(jid,status='running',started=time.time(),owner_pid=os.getpid(),stage='Starting on B200')
  def launch(label,fn,metadata=None):
   studio.job_update(jid,**(metadata or {}));result=fn(jid)
   a=studio.get(result,'asset');a.update(gpu_type='b200',gpu_hourly_rate=7.99,title=a.get('title','Video')+' · B200');studio.save(a)
   studio.job_update(jid,status='done',result=result,stage='Video ready',overall_percent=100);return studio.get(jid,'job')
  studio.launch=launch
  try:studio.render_video(job['request_body'])
  except Exception as exc:
   import traceback;traceback.print_exc()
   studio.job_update(jid,status='cancelled' if studio.get(jid,'job').get('cancel_requested') else 'failed',error=str(exc))
  finally:
   elapsed=time.monotonic()-start;studio.job_update(jid,seconds=round(elapsed,2),estimated_compute_usd=round(elapsed*7.99/3600,4))
if __name__=='__main__':worker()
