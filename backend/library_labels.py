"""Labels for every library on the GPU-independent storage service.

Images and audio already store labels as ``image_folder`` / ``audio_folder``
records joined to assets by ``library_item`` records. This module keeps those
record shapes and adds the same model for videos, stories and workflows, plus
removing a label from an item. Nested labels use the existing ``Parent / Child``
naming convention.
"""
import hashlib
import time
import uuid

FOLDERS = {
    'image': 'image_folder',
    'audio': 'audio_folder',
    'video': 'video_folder',
    'story': 'story_folder',
    'workflow': 'workflow_folder',
}
ASSET_LIBRARIES = ('image', 'audio', 'video')


def _library(body, env):
    library = body.get('library')
    if library not in FOLDERS:
        raise env['Problem']('Choose a library.')
    return library, FOLDERS[library]


def _item(library, item_id, env):
    if not isinstance(item_id, str) or not item_id:
        raise env['Problem']('Choose an item.')
    if library in ASSET_LIBRARIES:
        item = env['get'](item_id, 'asset')
        if item.get('media') != library:
            raise env['Problem']('Choose an item from this library.')
    else:
        item = env['get'](item_id, library)
    if item.get('deleted'):
        raise env['Problem']('Choose an item outside Trash.')
    return item


def _link_id(item_id, folder_id):
    return hashlib.sha256(('library-item:' + item_id + ':' + folder_id).encode()).hexdigest()[:32]


def create_folder(body, env):
    library, kind = _library(body, env)
    name = body.get('name', '')
    if not isinstance(name, str) or not 1 <= len(name.strip()) <= 80:
        raise env['Problem']('Label name must contain 1–80 characters.')
    name = name.strip()
    with env['LOCK']:
        existing = env['records'](kind)
        match = next((f for f in existing if f['name'].casefold() == name.casefold()), None)
        if match:
            if match.get('deleted'):
                raise env['Problem']('A label with this name is in Trash. Restore it or choose another name.', 409)
            return match
        folder_id = hashlib.sha256((library + '-folder:' + name.casefold()).encode()).hexdigest()[:32]
        if any(f['id'] == folder_id for f in existing):
            folder_id = uuid.uuid4().hex
        return env['save'](dict(id=folder_id, kind=kind, created=time.time(), name=name))


def assign(body, env):
    library, kind = _library(body, env)
    ids = body.get('folder_ids')
    if not isinstance(ids, list) or not 1 <= len(ids) <= 100 or any(not isinstance(i, str) for i in ids):
        raise env['Problem']('Choose at least one label.')
    with env['LOCK']:
        item = _item(library, body.get('item_id'), env)
        folders = [env['get'](folder_id, kind) for folder_id in sorted(set(ids))]
        if any(folder.get('deleted') for folder in folders):
            raise env['Problem']('Choose labels outside Trash.')
        for folder in folders:
            env['save'](dict(id=_link_id(item['id'], folder['id']), kind='library_item', created=time.time(),
                             asset_id=item['id'], folder_id=folder['id']))
        return {'item_id': item['id'], 'folder_ids': [f['id'] for f in folders]}


def remove(body, env):
    library, kind = _library(body, env)
    with env['LOCK']:
        item = _item(library, body.get('item_id'), env)
        folder = env['get'](body.get('folder_id', ''), kind)
        link_id = _link_id(item['id'], folder['id'])
        links = [r for r in env['records']('library_item')
                 if r['id'] == link_id or (r.get('asset_id') == item['id'] and r.get('folder_id') == folder['id'])]
        for link in links:
            # Same convention the Trash manager uses when it retires a membership.
            env['save']({'id': link['id'], 'kind': 'purged', 'purged_at': time.time()})
        return {'item_id': item['id'], 'folder_id': folder['id'], 'removed': len(links)}
