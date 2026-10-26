"""Authenticated CPU-to-GPU transport over the existing private shared volume."""
import json, os, time, uuid, re, threading, fcntl
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import HTTPError
ROOT = Path(os.getenv('ECCO_GPU_RELAY_ROOT', '/workspace/ecco-gpu-relay'))
GPUS = ('p7lc6fqjuosti3', 'io8sphjo10kbuy', '1muqctw9bxvguu', 'sup07jsgh2evnf')
ROUTES = frozenset(('images','videos','image-edits','character-sheets','director/create','director/regenerate','video-jobs/cancel'))
def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temp = path.with_name(path.name+'.'+uuid.uuid4().hex+'.tmp')
    fd = os.open(temp, os.O_WRONLY|os.O_CREAT|os.O_EXCL, 0o600)
    with os.fdopen(fd,'w') as out: json.dump(value,out)
    os.replace(temp,path)
def read(path):
    try: return json.loads(path.read_text())
    except (OSError, ValueError): return {}
def status():
    result=[]
    for pod in GPUS:
        item=read(ROOT/pod/'health.json')
        age=time.time()-item.get('at',0)
        result.append({'id':pod,'ready':bool(item.get('ready') and 0<=age<45),
                       'last_seen':item.get('at',0),'config':item.get('config',{}) if 0<=age<45 else {}})
    return {'gpus':result}
def submit(body):
    pod,path=body.get('gpu'),body.get('path')
    if pod not in GPUS or path not in ROUTES or not isinstance(body.get('body'),dict):
        raise ValueError('Invalid GPU request')
    rid=body.get('request_id','')
    if not isinstance(rid,str) or not re.fullmatch(r'[a-f0-9]{32}',rid): raise ValueError('Invalid request ID')
    base=ROOT/pod
    # Same ID can be retried after network loss without resubmitting inference.
    with (ROOT/'submit.lock').open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX)
        if not any((base/(rid+suffix)).exists() for suffix in ('.request','.working','.result')):
            if not next(g for g in status()['gpus'] if g['id']==pod)['ready']:
                raise ValueError('Accelerator is unavailable. Studio will reconnect when it returns.')
            write(base/(rid+'.request'),{'path':path,'body':body['body'],'created':time.time()})
    return {'id':rid,'gpu':pod}
def result(pod,rid):
    if pod not in GPUS or not re.fullmatch(r'[a-f0-9]{32}',rid): raise ValueError('Invalid request ID')
    base=ROOT/pod
    data=read(base/(rid+'.result'))
    if data:return data
    work=base/(rid+'.working')
    if work.exists() and time.time()-work.stat().st_mtime>180:
        return {'status':'error','error':'GPU response was interrupted. Check Activity before retrying; this request will not be replayed.'}
    return {'status':'pending'}
def worker():
    pod=os.environ.get('RUNPOD_POD_ID','')
    if pod not in GPUS: raise SystemExit('Unknown GPU')
    base=ROOT/pod;base.mkdir(parents=True,exist_ok=True,mode=0o700)
    lock=(base/'worker.lock').open('a')
    try: fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    except BlockingIOError:return
    origin=os.getenv('STUDIO_ORIGIN', 'https://'+pod+'-8888.proxy.runpod.net')
    def local(path,body=None):
        headers={'Origin':origin}
        if body is not None:
            state=local('state');headers['X-Ecco-CSRF']=state['csrf'];headers['Content-Type']='application/json'
        request=Request('http://127.0.0.1:8765/api/'+path,data=None if body is None else json.dumps(body).encode(),headers=headers)
        with urlopen(request,timeout=120 if body is not None else 15) as response:return json.load(response)
    def health():
        while True:
            try:
                data=local('state')
                write(base/'health.json',{'at':time.time(),'ready':True,'config':data.get('config',{})})
            except Exception: write(base/'health.json',{'at':time.time(),'ready':False})
            time.sleep(5)
    threading.Thread(target=health,daemon=True).start()
    while True:
        for path in base.glob('*.request'):
            claimed=path.with_suffix('.working')
            try:os.rename(path,claimed)
            except FileNotFoundError:continue
            data=read(claimed)
            try:
                if data.get('path') not in ROUTES or time.time()-data.get('created',0)>120:
                    raise ValueError('Request expired before dispatch; no generation was submitted.')
                answer=local(data['path'],data['body'])
                output={'status':'done','result':answer}
            except HTTPError as exc:
                try: message=json.load(exc).get('error','GPU rejected the request.')
                except Exception:message='GPU rejected the request.'
                output={'status':'error','error':message}
            except Exception as exc:
                output={'status':'error','error':str(exc)+'. Check Activity before retrying.'}
            write(claimed.with_suffix('.result'),output)
            # Retain a claim marker for idempotency, but remove request contents.
            write(claimed,{'completed':time.time()})
        time.sleep(.25)
if __name__=='__main__':worker()
