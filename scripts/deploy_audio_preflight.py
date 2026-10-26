"""Deploy only reviewed verification modules on idle existing CPUs. No credentials or model downloads."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import signal
import sqlite3
import subprocess
import time
from urllib.request import urlopen

APP=Path('/workspace/ecco-storage-app')
AUDIO=Path('/workspace/ecco-audio')
DATA=Path('/workspace/ecco-studio-data')
ROOT=Path('/workspace/ecco-audio-preflight-update')
TERMINAL={'done','complete','completed','error','failed','cancelled','canceled','interrupted','stopped'}
MANIFEST_HASH='3c89c21f7b5e4e252af14fb2a6957b9d1259d1670ff915dd020a6e225c03dc8c'

def digest(path):return hashlib.sha256(path.read_bytes()).hexdigest() if path.is_file() else None

def idle():
    with sqlite3.connect('file:'+str(DATA/'studio.sqlite')+'?mode=ro',uri=True) as db:
        rows=db.execute("SELECT kind,json_extract(body,'$.status') FROM records WHERE kind LIKE '%job%' OR kind='audio_workflow_run'").fetchall()
    if any(status not in TERMINAL for _,status in rows):raise RuntimeError('Active workspace jobs; deployment deferred.')
    for path in (AUDIO/'queue').glob('*/status.json'):
        if json.loads(path.read_text()).get('status') not in TERMINAL:raise RuntimeError('Active audio job; deployment deferred.')

def process(pid):
    p=Path('/proc')/str(pid);stat=p.joinpath('stat').read_text().rsplit(')',1)[1].split()
    return dict(pid=int(pid),parent=int(stat[1]),start=stat[19],cwd=str(p.joinpath('cwd').resolve()),args=[x.decode() for x in p.joinpath('cmdline').read_bytes().split(b'\0') if x])

def services():
    found={}
    for p in Path('/proc').glob('[0-9]*'):
        try:item=process(p.name)
        except (OSError,ValueError):continue
        for name in ('storage_api.py','queue_worker.py'):
            if any(Path(x).name==name for x in item['args'][1:]):
                if name in found:raise RuntimeError('Multiple matching services; refusing an ambiguous restart.')
                found[name]=item
    return found

def pause(item):
    if process(item['pid'])!=item:raise RuntimeError('Process identity changed.')
    os.kill(item['pid'],signal.SIGSTOP)

def resume(item):
    try:os.kill(item['pid'],signal.SIGCONT)
    except ProcessLookupError:pass

def end(item):
    if process(item['pid'])!=item:raise RuntimeError('Process identity changed.')
    os.kill(item['pid'],signal.SIGTERM);resume(item)
    for _ in range(100):
        p=Path('/proc')/str(item['pid'])
        if not p.exists() or p.joinpath('stat').read_text().rsplit(')',1)[1].split()[0]=='Z':return
        time.sleep(.05)
    raise RuntimeError('Service did not exit cleanly.')

def stage(commit):
    if len(commit)!=40 or any(c not in '0123456789abcdef' for c in commit):raise ValueError('Invalid source revision.')
    data=urlopen('https://raw.githubusercontent.com/ecco-ai-labs/ecco-studio/'+commit+'/scripts/audio-preflight-patch.json',timeout=30).read()
    if hashlib.sha256(data).hexdigest()!=MANIFEST_HASH:raise RuntimeError('Reviewed manifest hash mismatch.')
    manifest=json.loads(data);ROOT.mkdir(mode=0o700,exist_ok=True);files=[]
    for name,change in manifest.items():
        targets=[APP/name]+([AUDIO/Path(name).name] if name.startswith('audio/') else [])
        for target in targets:
            if target.is_symlink() or not target.parent.is_dir():raise RuntimeError('Unexpected deployment target.')
            old=target.read_text() if target.exists() else None
            if old is None:
                if 'content' not in change:raise RuntimeError('Installed source is missing: '+name)
                updated=change['content']
            elif digest(target)==change['sha256']:updated=old
            elif 'content' in change:raise RuntimeError('New module already exists with different content: '+name)
            else:
                updated=old
                for before,after in change['hunks']:
                    if updated.count(before)!=1:raise RuntimeError('Runtime differs at reviewed patch: '+name)
                    updated=updated.replace(before,after,1)
            compile(updated,str(target),'exec');staged=ROOT/('source-'+str(len(files)));staged.write_text(updated)
            files.append(dict(target=str(target),old=digest(target),new=digest(staged),staged=str(staged)))
    (ROOT/'plan.json').write_text(json.dumps(dict(commit=commit,files=files)))
    print('STAGED',len(files),'reviewed source files; unrelated runtime changes retained',flush=True)

def await_health(api=False):
    pod=os.environ.get('RUNPOD_POD_ID','')
    for _ in range(100):
        try:
            w=json.loads((AUDIO/'queue'/('worker-'+pod+'.json')).read_text())
            ok=w.get('resources',{}).get('version')==1 and 0<=time.time()-w['updated']<10
            if api:ok=ok and json.load(urlopen('http://127.0.0.1:8888/healthz',timeout=2)).get('ok')
            if ok:return
        except (OSError,ValueError):pass
        time.sleep(.25)
    raise RuntimeError('Updated resource heartbeat/API did not become healthy.')

def restart_worker():
    idle();worker=services()['queue_worker.py'];launcher=process(worker['parent'])
    if not any(Path(x).name=='start_cpu_worker.sh' for x in launcher['args']):raise RuntimeError('Unexpected worker supervisor.')
    pause(launcher)
    try:pause(worker);idle();end(worker)
    finally:resume(worker);resume(launcher)
    await_health();print('WORKER VERIFIED',os.environ.get('RUNPOD_POD_ID'),flush=True)

def activate():
    if os.environ.get('RUNPOD_POD_ID')!='vowmjru85f2gzo':raise RuntimeError('Activate only on the existing storage CPU.')
    plan=json.loads((ROOT/'plan.json').read_text());idle();svc=services();api=svc['storage_api.py'];worker=svc['queue_worker.py'];launcher=process(worker['parent'])
    if not any(Path(x).name=='start_cpu_worker.sh' for x in launcher['args']):raise RuntimeError('Unexpected worker supervisor.')
    for item in plan['files']:
        if digest(Path(item['target']))!=item['old'] or digest(Path(item['staged']))!=item['new']:raise RuntimeError('Prepared source changed.')
    backup=ROOT/('backup-'+str(time.time_ns()));backup.mkdir(mode=0o700)
    # Preserve the existing service environment privately in memory only, never output or export it.
    environment=dict(x.decode().split('=',1) for x in (Path('/proc')/str(api['pid'])/'environ').read_bytes().split(b'\0') if b'=' in x)
    log=(ROOT/'restart.log').open('ab');paused=[];written=[];api_ended=False;child=None
    def start_api():return subprocess.Popen(api['args'],cwd=api['cwd'],env=environment,stdin=subprocess.DEVNULL,stdout=log,stderr=log,start_new_session=True)
    try:
        for item in (api,launcher,worker):pause(item);paused.append(item)
        idle()
        for i,item in enumerate(plan['files']):
            target=Path(item['target'])
            if digest(target)!=item['old']:raise RuntimeError('Source lease changed.')
            if target.exists():shutil.copy2(target,backup/str(i))
            staged=Path(item['staged']);tmp=target.with_name(target.name+'.verify-update.tmp');tmp.write_bytes(staged.read_bytes());tmp.chmod(target.stat().st_mode&0o777 if target.exists() else 0o644);tmp.replace(target);written.append((i,item))
        end(worker);end(api);api_ended=True;resume(launcher);child=start_api();await_health(api=True)
        report=dict(commit=plan['commit'],completed_at=time.time(),resource_version=1,source_backup=str(backup),authenticated_ui_verified=False)
        (ROOT/'result.json').write_text(json.dumps(report));print('ACTIVATED',json.dumps(report),flush=True)
    except Exception:
        if child and child.poll() is None:child.terminate();child.wait(timeout=10)
        for i,item in reversed(written):
            target=Path(item['target'])
            if item['old'] is None:target.unlink(missing_ok=True)
            else:shutil.copy2(backup/str(i),target)
        if api_ended:start_api()
        raise
    finally:
        for item in reversed(paused):resume(item)

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('action',choices=['stage','activate','restart-worker']);parser.add_argument('--commit');args=parser.parse_args()
    if args.action=='stage':stage(args.commit)
    elif args.action=='activate':activate()
    else:restart_worker()
