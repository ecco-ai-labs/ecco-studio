"""Patch legacy GPU dispatch to use the connected server's detected hardware."""
from pathlib import Path
import shutil, time

HELPER='''
def local_gpu():
 hardware=__import__('accelerator_status').status()
 devices=hardware.get('devices',[])
 if hardware.get('status')!='detected' or not devices:return None
 name=' + '.join(d['name'] for d in devices)
 lower=name.lower()
 kind='b200' if 'b200' in lower else 'a100' if 'a100' in lower else 'local'
 rate={'b200':7.99,'a100':1.794}.get(kind)
 return {'id':kind,'name':name,'hourly_rate':rate,'ready':True,'local':True}
'''
OPTIONS='''def options():
 current=local_gpu()
 if not current:return [{'id':'local','name':'Accelerator unverified','hourly_rate':None,'ready':False}]
 return [current]
'''
PREFIX='''def submit(body,e):
 current=local_gpu()
 if not current:raise e['Problem']('Accelerator could not be verified. Refresh and try again.',503)
 selected=body.get('gpu_type') or current['id']
 if selected!=current['id']:raise e['Problem']('GPU selection changed. Refresh and select the connected accelerator.',409)
 j=e['render_video'](body)
 e['job_update'](j['id'],gpu_type=current['id'],gpu_name=current['name'],gpu_hourly_rate=current['hourly_rate'])
 return e['get'](j['id'],'job')
'''
SELECTOR="""(()=>{let choices=[],loading=false;async function update(){if(loading)return;loading=true;try{const r=await fetch('api/state',{credentials:'same-origin',cache:'no-store'});if(!r.ok)throw Error('Connection unavailable');const s=await r.json();choices=s.config.video_gpus||[]}catch(e){choices=[]}finally{loading=false;paint()}}function paint(){const f=document.querySelector('#video-form');if(!f)return;let box=f.querySelector('#video-gpu-control');if(!box){box=document.createElement('label');box.id='video-gpu-control';box.append('Rendering GPU');const select=document.createElement('select');select.name='gpu_type';select.id='video-gpu-type';select.setAttribute('aria-label','Rendering GPU');box.append(select);const help=document.createElement('small');help.textContent='Detected accelerator on this connected Studio. Other machines are not assumed online or offline.';box.append(help);f.insertBefore(box,f.querySelector('#generate-video'))}const sel=box.querySelector('select');const signature=JSON.stringify(choices);if(sel.dataset.signature!==signature){const list=choices.length?choices:[{id:'',name:'Accelerator unverified',ready:false}];sel.replaceChildren(...list.map(g=>{const o=document.createElement('option');o.value=g.id;o.textContent=g.name+(typeof g.hourly_rate==='number'?' · $'+g.hourly_rate.toFixed(2)+'/hour':'')+(g.ready?' · connected':' · unavailable');o.disabled=!g.ready;return o}));const ready=choices.find(g=>g.ready);if(ready)sel.value=ready.id;sel.dataset.signature=signature}}new MutationObserver(paint).observe(document.querySelector('#page'),{childList:true});update();setInterval(update,10000)})();"""
def install(target):
 target=Path(target);p=target/'gpu_dispatch.py';s=p.read_text()
 if 'def local_gpu():' not in s:
  start=s.index('def options():');end=s.index('def cancel(',start)
  s=s[:start]+HELPER+OPTIONS+PREFIX+s[end:]
  s=s.replace("if j.get('gpu_type')!='b200':", "if not j.get('remote_worker'):")
 compile(s,str(p),'exec')
 backup=target/('backup-routing-'+str(time.time_ns()));backup.mkdir()
 for name in ['gpu_dispatch.py','gpu-selector.js','studio.html']:shutil.copy2(target/name,backup/name)
 p.write_text(s);(target/'gpu-selector.js').write_text(SELECTOR)
 h=target/'studio.html';page=h.read_text();import re
 page=re.sub(r'gpu-selector.js(?:\?[^"\s]*)?', 'gpu-selector.js?v=20261016-hardware',page);h.write_text(page)
 print('GPU routing updated. Backup:',backup)
if __name__=='__main__':
 import sys
 install(sys.argv[1] if len(sys.argv)>1 else '/workspace/ecco-studio')
