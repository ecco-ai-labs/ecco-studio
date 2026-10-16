"""Apply navigation assets and recoverable folder route to an installed Studio."""
from pathlib import Path
import datetime,json,os,shutil,signal,sqlite3
p=Path('/workspace/ecco-studio');source=Path(__file__).parent
with sqlite3.connect('/workspace/ecco-studio-data/studio.sqlite') as db:
    rows=[json.loads(r[0]) for r in db.execute('select body from records')]
assert not any(r.get('kind')=='job' and r.get('status') in ('queued','running') for r in rows),'Active generation; deploy after it finishes'
server=(p/'studio.py').read_text()
anchor="elif path=='/api/trash/board': result=__import__('trash_manager').board(body,globals())"
if "path=='/api/trash/folder'" not in server:
    assert anchor in server
    server=server.replace(anchor,anchor+"\n            elif path=='/api/trash/folder': result=__import__('trash_manager').folder(body,globals())")
compile(server,'studio.py','exec')
library=(p/'library-ui.js').read_text().replace("r.kind==='image_folder')","r.kind==='image_folder'&&!r.deleted)")
updates={'studio.py':server,'library-ui.js':library,'trash_manager.py':(source/'trash_manager.py').read_text(),'workspace-ui.js':(source/'workspace-ui.js').read_text()+'\n'+(source/'trash-ui.js').read_text(),'workspace-ui.css':(source/'workspace-ui.css').read_text()}
backup=p/('backup-navigation-'+datetime.datetime.now().strftime('%Y%m%d-%H%M%S'));backup.mkdir()
for name in updates:
    shutil.copy2(p/name,backup/name)
for name,content in updates.items():
    tmp=p/(name+'.navigation-tmp');tmp.write_text(content);tmp.replace(p/name)
pid=json.loads(Path('/workspace/ecco-runtime/health.json').read_text())['services']['studio']['pid']
assert b'studio.py' in Path('/proc/'+str(pid)+'/cmdline').read_bytes()
os.kill(pid,signal.SIGTERM)
print('Navigation installed; Studio supervisor restarting service. Backup:',backup)
