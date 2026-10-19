"""Install the extra image adapter without replacing unrelated Studio changes."""
import hashlib
import shutil
from pathlib import Path

root = Path('/workspace/ecco-studio')
path = root / 'studio.py'
source = path.read_text()
original = source
hook = "    if body.get('model') in ('z-image', 'trellis-2'): return __import__('extra_image_models').create(body, globals())\n"
if hook not in source:
    anchor = 'def create_image(body):\n'
    assert source.count(anchor) == 1
    source = source.replace(anchor, anchor + hook)
status = "'z-image':__import__('extra_image_models').ready(),'trellis-2':False,"
if status not in source:
    anchor = "'models_ready':{"
    assert source.count(anchor) == 1
    source = source.replace(anchor, anchor + status)
compile(source, str(path), 'exec')
adapter = Path('/workspace/ecco-image-runtime/extra_image_models.py')
compile(adapter.read_text(), str(adapter), 'exec')
shutil.copyfile(adapter, root / 'extra_image_models.py')
if source != original:
    backup = path.with_name('studio.py.before-extra-models-' + hashlib.sha256(original.encode()).hexdigest()[:12])
    if not backup.exists(): backup.write_text(original)
    temporary = path.with_suffix('.extra-models.tmp')
    temporary.write_text(source)
    temporary.replace(path)
print('BACKEND_PATCH_OK')
