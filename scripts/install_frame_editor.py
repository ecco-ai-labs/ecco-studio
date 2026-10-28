"""Narrow, reversible CPU-service update. Does not restart or provision compute.

Usage: python install_frame_editor.py /path/to/backend /path/to/frame_editor.py
The supplied module must come from the same reviewed release as this installer.
"""
import ast
import shutil
import sys
import time
from pathlib import Path


def patch(source):
    pairs = [
        ('import character_studio\n', 'import character_studio\nimport frame_editor\n'),
        ('WRITE_ROUTES = frozenset({\n', "WRITE_ROUTES = frozenset({\n    '/api/frame-editor/export',\n"),
        ("[character_studio.job_view(", "[frame_editor.public_record(character_studio.job_view("),
        ("else r) for r in longcat_progress.enrich", "else r)) for r in longcat_progress.enrich"),
        ("        'character_studio': character_studio.status(),\n", "        'character_studio': character_studio.status(),\n        'frame_editor': frame_editor.status(),\n"),
        ("            if path == '/api/character-studio/status': return self.send(character_studio.status())\n", "            if path == '/api/character-studio/status': return self.send(character_studio.status())\n            if path.startswith('/api/frame-editor/'): return self.send(frame_editor.handle_get(path, vars(legacy)))\n"),
        ("            if path == '/api/character-studio/upload': maximum = 71*1024*1024\n", "            if path == '/api/character-studio/upload': maximum = 71*1024*1024\n            if path == '/api/frame-editor/export': maximum = 12*1024*1024\n"),
        ("            if not isinstance(body, dict): raise legacy.Problem('Expected an object')\n", "            if not isinstance(body, dict): raise legacy.Problem('Expected an object')\n            if path == '/api/frame-editor/export': return self.send(frame_editor.export(body, vars(legacy)))\n"),
    ]
    for old, new in pairs:
        if new in source:
            continue
        if source.count(old) != 1:
            raise ValueError('Storage service differs from the reviewed hooks. No files changed.')
        source = source.replace(old, new, 1)
    ast.parse(source, feature_version=(3, 8))
    return source


def install(backend, module):
    api = backend/'storage_api.py'
    updated = patch(api.read_text())
    code = module.read_text()
    ast.parse(code, feature_version=(3, 8))
    backup = backend.parent/('frame-editor-backup-'+str(time.time_ns()))
    backup.mkdir(mode=0o700)
    for name in ('storage_api.py', 'frame_editor.py'):
        if (backend/name).exists(): shutil.copy2(backend/name, backup/name)
    for name, content in [('frame_editor.py', code), ('storage_api.py', updated)]:
        temp = backend/(name+'.frame-new')
        temp.write_text(content)
        temp.replace(backend/name)
    print('Frame export installed. Backup:', backup)
    print('Restart the existing storage service and verify /api/frame-editor/status with workspace authorization.')


if __name__ == '__main__':
    install(Path(sys.argv[1]), Path(sys.argv[2]))
