"""Rename existing library records without changing IDs or memberships."""
import json
import sqlite3


def rename(body, env):
    name = body.get('name')
    if not isinstance(name, str) or not name.strip():
        raise env['Problem']('Enter a name.')
    name = name.strip()
    with env['LOCK'], sqlite3.connect(env['DATA'] / 'studio.sqlite') as db:
        db.execute('BEGIN IMMEDIATE')
        rows = [json.loads(row[0]) for row in db.execute('SELECT body FROM records')]
        item = next((r for r in rows if r['id'] == body.get('id')), None)
        if not item or item.get('deleted'):
            raise env['Problem']('This library item is no longer available.', 404)
        kind = item['kind']
        if kind not in ('image_folder', 'audio_folder', 'story', 'workflow', 'asset'):
            raise env['Problem']('This item cannot be renamed.')
        folder = kind in ('image_folder', 'audio_folder')
        field = 'name' if folder or kind == 'workflow' else 'title'
        if len(name) > (80 if folder else 160) or (folder and '/' in name):
            raise env['Problem']('Use a label name of at most 80 characters without slashes.' if folder else 'Use at most 160 characters.')
        old = item.get(field, '')
        if body.get('expected_name') != old:
            raise env['Problem']('This name changed elsewhere. Refresh and try again.', 409)
        prefix = old.rsplit(' / ', 1)[0] + ' / ' if folder and ' / ' in old else ''
        replacement = prefix + name
        changed = []
        for row in rows:
            if row['id'] == item['id']:
                changed.append({**row, field: replacement})
            elif folder and row['kind'] == kind and row.get('name', '').startswith(old + ' / '):
                changed.append({**row, 'name': replacement + row['name'][len(old):]})
        changed_ids = {r['id'] for r in changed}
        if folder:
            occupied = {r.get('name', '').casefold() for r in rows if r['kind'] == kind and r['id'] not in changed_ids}
            if any(len(r['name']) > 80 for r in changed):
                raise env['Problem']('A nested label path would exceed 80 characters.')
            if any(r['name'].casefold() in occupied for r in changed):
                raise env['Problem']('A label with that name already exists, possibly in Trash.', 409)
        for row in changed:
            db.execute('UPDATE records SET body=? WHERE id=?', (json.dumps(row), row['id']))
        return {'id': item['id'], 'name': replacement, 'updated': len(changed)}
