#!/usr/bin/env python3
"""Apply guarded, backed-up edits to an existing GPU Studio installation."""
import argparse, datetime, pathlib, shutil, os

START='<!-- ECCO WORKSPACE UPDATE START -->'
END='<!-- ECCO WORKSPACE UPDATE END -->'
def patch_once(text, old, new):
    if new in text: return text
    if text.count(old)!=1: raise RuntimeError('Unsupported Studio version; expected exactly one match: '+old[:80])
    return text.replace(old,new,1)

def install(target):
    target=pathlib.Path(target)
    source=pathlib.Path(__file__).resolve().parent
    server=(target/'studio.py').read_text()
    server=patch_once(server,"if not 0<length<=1024*1024:","if not 0<length<=(17*1024*1024 if urllib.parse.urlsplit(self.path).path=='/api/images/upload' else 1024*1024):")
    server=patch_once(server,"if path=='/api/images': result=create_image(body)","if path=='/api/images': result=create_image(body)\n            elif path=='/api/images/upload': result=__import__('image_upload').upload(body,globals())")
    server=patch_once(server,"'runtime':runtime_status(),","'runtime':runtime_status(),'accelerator':__import__('accelerator_status').status(),")
    server=patch_once(server,"elif path=='/api/trash': result=trash_asset(body)","elif path=='/api/trash': result=trash_asset(body)\n            elif path=='/api/trash/board': result=__import__('trash_manager').board(body,globals())\n            elif path=='/api/trash/draft': result=__import__('trash_manager').draft(body,globals())\n            elif path=='/api/trash/restore-draft': result=__import__('trash_manager').restore_draft(body,globals())\n            elif path=='/api/trash/empty': result=__import__('trash_manager').empty(body,globals())")
    server=patch_once(server,"files={","files={'/workspace-ui.js':('workspace-ui.js','text/javascript'),'/workspace-ui.css':('workspace-ui.css','text/css'),")
    compile(server,str(target/'studio.py'),'exec')
    library=(target/'library-ui.js').read_text()
    library=patch_once(library,'function folderDialog(asset=null){',"function folderDialog(asset=null){if(window.EccoWorkspaceUI){return asset?window.EccoWorkspaceUI.labelDialog(asset.id):window.EccoWorkspaceUI.createFolder();}")
    library=library.replace('>Save to library</button>','>Add label</button>').replace('Use Save to library on an image and choose or create a folder.','Use Add label on an image to save it in one or more folders.')
    page=(target/'studio.html').read_text()
    if START in page:
        if page.count(START)!=1 or page.count(END)!=1: raise RuntimeError('Invalid existing update markers')
        before,rest=page.split(START);_,after=rest.split(END);page=before+after
    if page.count('</body>')!=1: raise RuntimeError('Missing unique closing body tag')
    block=START+'\n<link rel="stylesheet" href="workspace-ui.css?v=20261016-final"><script src="workspace-ui.js?v=20261016-final"></script>\n'+END
    page=page.replace('</body>',block+'</body>')
    # Change the library URL so previously cached handlers are refreshed.
    import re
    page=re.sub(r'studio\.js\?v=[^"\s]+','studio.js?v=20261016-trash',page)
    page=re.sub(r'library-ui\.js\?v=[^"\s]+','library-ui.js?v=20261016-workspace',page)
    library=library.replace("r.kind==='image_folder')","r.kind==='image_folder'&&!r.deleted)")
    updates={'studio.py':server,'studio.html':page,'library-ui.js':library,'image_upload.py':(source/'image_upload.py').read_text()}
    updates['workspace-ui.js']=(source/'workspace-ui.js').read_text()+'\n'+(source/'trash-ui.js').read_text()
    updates['workspace-ui.css']=(source/'workspace-ui.css').read_text()
    server=patch_once(server,"elif path=='/api/trash/board': result=__import__('trash_manager').board(body,globals())","elif path=='/api/trash/board': result=__import__('trash_manager').board(body,globals())\n            elif path=='/api/trash/folder': result=__import__('trash_manager').folder(body,globals())")
    updates['studio.py']=server
    updates['trash_manager.py']=(source/'trash_manager.py').read_text()
    frontend=(target/'studio.js').read_text()
    frontend=patch_once(frontend,"r.kind==='board'&&(r.story_id","r.kind==='board'&&!r.deleted&&(r.story_id")
    updates['studio.js']=frontend
    updates['accelerator_status.py']=(source/'accelerator_status.py').read_text()
    compile(updates['accelerator_status.py'],'accelerator_status.py','exec')
    compile(updates['image_upload.py'],'image_upload.py','exec')
    backup=target/('backup-workspace-'+datetime.datetime.now().strftime('%Y%m%d-%H%M%S-%f'))
    backup.mkdir()
    for name in updates:
        if (target/name).exists(): shutil.copy2(target/name,backup/name)
    try:
        for name,content in updates.items():
            temp=target/(name+'.workspace-tmp');temp.write_text(content);os.replace(temp,target/name)
    except Exception:
        for name in updates:
            if (backup/name).exists(): shutil.copy2(backup/name,target/name)
            elif (target/name).exists(): (target/name).unlink()
        raise
    return backup

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--target',default='/workspace/ecco-studio');args=p.parse_args()
    backup=install(args.target)
    print(f'Installed. Backup: {backup}\nRestart only the Studio service after active work finishes, then reload Studio. GPU restart is not needed.')
