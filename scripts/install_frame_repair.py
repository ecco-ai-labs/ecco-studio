"""Install reviewed repair files and narrow API/startup hooks; preserve other work.

Usage: python install_frame_repair.py /path/to/release /workspace/ecco-storage-app/backend
No inference, model installation, service restart or GPU provisioning occurs here.
"""
import ast
import shutil
import sys
import time
from pathlib import Path


def replace_once(text, old, new):
    if new in text:return text
    if text.count(old)!=1:raise ValueError('Deployment hook differs from the reviewed service; no changes applied.')
    return text.replace(old,new,1)


def install(release, backend):
    service=(backend/'storage_api.py').read_text()
    service=replace_once(service,"    '/api/frame-editor/export',","    '/api/frame-editor/export', '/api/frame-editor/repair',")
    service=replace_once(service,"if path == '/api/frame-editor/export': maximum", "if path in ('/api/frame-editor/export', '/api/frame-editor/repair'): maximum")
    service=replace_once(service,"            if path == '/api/frame-editor/export': return", "            if path == '/api/frame-editor/repair': return self.send(__import__('frame_repair').submit(body, vars(legacy)))\n            if path == '/api/frame-editor/export': return")
    ast.parse(service)
    updates={backend/'storage_api.py':service}
    for name in ('frame_editor.py','frame_repair.py'):
        code=(release/'backend'/name).read_text();ast.parse(code);updates[backend/name]=code
    runtime=Path('/workspace/ecco-video/frame-repair')
    for name in ('worker.py','start_worker.sh','install_runtime.sh'):
        code=(release/'video/frame-repair'/name).read_text()
        if name.endswith('.py'):ast.parse(code)
        updates[runtime/name]=code
    startup=Path('/workspace/ecco-runtime/start-gpu-services.sh')
    hook='if [[ -f /workspace/ecco-video/frame-repair/start_worker.sh ]]; then\n  nohup bash /workspace/ecco-video/frame-repair/start_worker.sh >> "$logs/frame-repair.log" 2>&1 &\nfi\n'
    if startup.exists():
        original=startup.read_text();updates[startup]=replace_once(original,'nohup bash /workspace/ecco-video/longcat/start_longcat.sh',hook+'nohup bash /workspace/ecco-video/longcat/start_longcat.sh')
    backup=backend.parent/('frame-repair-backup-'+str(time.time_ns()));backup.mkdir(mode=0o700)
    for i,(target,code) in enumerate(updates.items()):
        if target.exists():shutil.copy2(target,backup/(str(i)+'-'+target.name))
        target.parent.mkdir(parents=True,exist_ok=True)
        temporary=target.with_name(target.name+'.repair-new');temporary.write_text(code);temporary.replace(target)
    print('Repair API and worker files installed. Backup:',backup)
    print('Restart the existing CPU API. Install the repair runtime explicitly before starting a GPU worker.')

if __name__=='__main__':install(Path(sys.argv[1]),Path(sys.argv[2]))
