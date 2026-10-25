"""Apply reviewed cancellation hunks to existing services; preserve unrelated edits.

Stage on the shared volume, activate on the storage pod, then restart the idle
audio worker on the other CPU pod. No GPU starts or media/model changes.
"""
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
ROOT=Path('/workspace/ecco-generation-stop-update')
DATA=Path('/workspace/ecco-studio-data')
TERMINAL={'done','complete','completed','error','failed','cancelled','canceled','interrupted','stopped'}
MANIFEST_HASH='deed0254a9341a70a39b0590e994430b75f153e503ae57267767b378fcd78fe4'

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest() if path.is_file() else None

def destinations(name):
    targets=[APP/name]
    if name.startswith('audio/'): targets.append(Path('/workspace/ecco-audio')/Path(name).name)
    if name=='audio/generation_cancel.py':
        targets.extend([Path('/workspace/ecco-studio/generation_cancel.py'),Path('/workspace/ecco-video/longcat/generation_cancel.py')])
    if name.startswith('migration/legacy/'): targets.append(Path('/workspace/ecco-studio')/Path(name).name)
    if name=='video/longcat_jobs.py': targets.append(Path('/workspace/ecco-video/longcat/longcat_jobs.py'))
    return targets

def idle():
    with sqlite3.connect('file:'+str(DATA/'studio.sqlite')+'?mode=ro',uri=True) as db:
        rows=db.execute("SELECT kind,json_extract(body,'$.status') FROM records WHERE kind LIKE '%job%' OR kind='audio_workflow_run'").fetchall()
    active=[(k,s) for k,s in rows if s not in TERMINAL]
    for root in (Path('/workspace/ecco-audio/queue'),Path('/workspace/ecco-video/longcat/queue')):
        for path in root.glob('*/status.json'):
            status=json.loads(path.read_text()).get('status')
            if status not in TERMINAL: active.append((path.parent.name,status))
    if active: raise RuntimeError('Active jobs; update deferred: '+repr(active))

def stage(commit):
    if len(commit)!=40 or any(c not in '0123456789abcdef' for c in commit): raise ValueError('Invalid revision')
    content=urlopen('https://raw.githubusercontent.com/ecco-ai-labs/ecco-studio/'+commit+'/scripts/generation-stop-patch.json',timeout=30).read()
    if hashlib.sha256(content).hexdigest()!=MANIFEST_HASH: raise RuntimeError('Manifest checksum mismatch')
    manifest=json.loads(content);ROOT.mkdir(mode=0o700,exist_ok=True)
    files=[]
    for name,change in manifest.items():
        for target in destinations(name):
            if target.is_symlink() or not target.parent.is_dir(): raise RuntimeError('Unexpected target: '+str(target))
            old=(APP/name).read_text() if str(target)=='/workspace/ecco-video/longcat/longcat_jobs.py' else (target.read_text() if target.exists() else None)
            if old is None:
                if change['base'] is not None: raise RuntimeError('Missing installed source: '+str(target))
                updated=change['content']
            elif digest(target)==change['sha256']:
                updated=old
            elif change['base'] is None:
                raise RuntimeError('New module already exists with different content: '+str(target))
            else:
                updated=old
                for before,after in change['hunks']:
                    # The GPU copy has additional image models and an older edit signature.
                    # Keep those paths; persisted job IDs still identify their Stop target.
                    if str(target)=='/workspace/ecco-studio/studio.py' and "metadata={'media':'image','story_id':sid}" in after: continue
                    if not before.strip() and updated.endswith(before) and after.startswith(before): updated=updated[:-len(before)]+after; continue
                    if updated.count(before)!=1: raise RuntimeError('Runtime differs at reviewed cancellation hunk: '+str(target))
                    updated=updated.replace(before,after,1)
            compile(updated,str(target),'exec')
            staged=ROOT/'new'/str(len(files));staged.parent.mkdir(exist_ok=True);staged.write_text(updated)
            files.append(dict(target=str(target),old=digest(target),new=digest(staged),staged=str(staged)))
    (ROOT/'plan.json').write_text(json.dumps(dict(commit=commit,files=files)))
    print('STAGED',len(files),'files; unrelated runtime changes preserved',flush=True)

def processes():
    found=[]
    for path in Path('/proc').glob('[0-9]*'):
        try:
            args=[x.decode() for x in (path/'cmdline').read_bytes().split(b'\0') if x]
            role=next((Path(x).name for x in args[1:] if Path(x).name in ('storage_api.py','queue_worker.py')),None)
            if not role: continue
            stat=(path/'stat').read_text().rsplit(')',1)[1].split()
            found.append(dict(pid=int(path.name),start=stat[19],parent=int(stat[1]),role=role,args=args,cwd=str((path/'cwd').resolve())))
        except (OSError,ValueError): pass
    return found

def end(process):
    pid=process['pid'];path=Path('/proc')/str(pid)
    if not path.exists(): return
    if (path/'stat').read_text().rsplit(')',1)[1].split()[19]!=process['start']: raise RuntimeError('PID changed')
    os.kill(pid,signal.SIGTERM);os.kill(pid,signal.SIGCONT)
    for _ in range(100):
        if not path.exists() or (path/'stat').read_text().rsplit(')',1)[1].split()[0]=='Z': return
        time.sleep(.05)
    raise RuntimeError('Service did not exit cleanly')

def restart(api=False):
    idle();selected=[p for p in processes() if api or p['role']=='queue_worker.py']
    if not selected: raise RuntimeError('No expected local services found')
    environments={p['pid']:dict(x.decode().split('=',1) for x in (Path('/proc')/str(p['pid'])/'environ').read_bytes().split(b'\0') if b'=' in x) for p in selected}
    log=(ROOT/'restart.log').open('ab')
    for p in selected:
        if p['role']=='queue_worker.py':
            parent=Path('/proc')/str(p['parent'])/'cmdline'
            if b'start_cpu_worker.sh' not in parent.read_bytes(): raise RuntimeError('Unexpected worker supervisor')
        end(p)
        if p['role']=='storage_api.py':
            subprocess.Popen(p['args'],cwd=p['cwd'],env=environments[p['pid']],stdin=subprocess.DEVNULL,stdout=log,stderr=log,start_new_session=True)
    pod=os.environ.get('RUNPOD_POD_ID','')
    for _ in range(80):
        try:
            worker=json.loads((Path('/workspace/ecco-audio/queue')/('worker-'+pod+'.json')).read_text())
            worker_ok=worker.get('cancellation_version')==1 and time.time()-worker['updated']<10
            api_ok=not api or json.load(urlopen('http://127.0.0.1:8888/healthz',timeout=2)).get('ok')
            if worker_ok and api_ok:
                print('HEALTHY',pod,'cancellation_version=1','API updated' if api else 'worker updated',flush=True);return
        except (OSError,ValueError): pass
        time.sleep(.25)
    raise RuntimeError('Updated services did not pass health checks; inspect restart.log privately')

def activate():
    idle();plan=json.loads((ROOT/'plan.json').read_text());backup=ROOT/('backup-'+str(time.time_ns()));backup.mkdir(mode=0o700)
    for item in plan['files']:
        if digest(Path(item['target']))!=item['old'] or digest(Path(item['staged']))!=item['new']: raise RuntimeError('File lease changed')
    for index,item in enumerate(plan['files']):
        target=Path(item['target'])
        if target.exists(): shutil.copy2(target,backup/str(index))
        temporary=target.with_name(target.name+'.stop-update.tmp');temporary.write_bytes(Path(item['staged']).read_bytes());temporary.chmod(target.stat().st_mode & 0o777 if target.exists() else 0o644);temporary.replace(target)
    print('INSTALLED; source backup:',backup,flush=True)
    restart(api=True)

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('action',choices=['stage','activate','restart']);parser.add_argument('--commit');args=parser.parse_args()
    if args.action=='stage': stage(args.commit)
    elif args.action=='activate': activate()
    else: restart()
