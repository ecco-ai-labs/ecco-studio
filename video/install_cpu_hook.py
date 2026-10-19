"""Narrow, idempotent patch preserving concurrent storage-service changes."""
from pathlib import Path
import shutil
import time
root=Path('/opt/ecco-storage')
target=root/'backend/storage_api.py'
text=target.read_text()
replacements=[
 ('import audio_jobs\n','import audio_jobs\nimport longcat_jobs\n'),
 ("    '/api/audio/generate', '/api/gpu/request',","    '/api/longcat/generate', '/api/audio/generate', '/api/gpu/request',"),
 ("'gpu_relay': gpu_relay.status(),","'longcat': longcat_jobs.status(), 'gpu_relay': gpu_relay.status(),"),
 ("            if path == '/api/audio/generate':", "            if path == '/api/longcat/generate':\n                return self.send(longcat_jobs.generate(body, vars(legacy)))\n            if path == '/api/audio/generate':"),
 ('    audio_jobs.start(vars(legacy))','    longcat_jobs.start(vars(legacy))\n    audio_jobs.start(vars(legacy))')]
for old,new in replacements:
 if new in text: continue
 if text.count(old)!=1: raise SystemExit('Integration anchor changed: '+old)
 text=text.replace(old,new)
compile(text,str(target),'exec')
backup=Path('/workspace/ecco-storage-code-backups')/('storage-api-before-longcat-'+str(int(time.time()))+'.py')
backup.parent.mkdir(parents=True,exist_ok=True); shutil.copyfile(target,backup)
shutil.copyfile('/workspace/ecco-video/longcat/longcat_jobs.py',root/'backend/longcat_jobs.py')
temp=target.with_suffix('.longcat.tmp');temp.write_text(text);temp.replace(target)
print('LongCat CPU hooks installed; original backed up')
