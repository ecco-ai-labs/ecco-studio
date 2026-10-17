"""Create a private, verified migration bundle; never modifies the source workspace.

Run on a consistent filesystem view with generation and library writes paused.
Credentials are intentionally excluded. Never commit the output to a repository.
"""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import sqlite3


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def export(source, destination):
    source = Path(source).resolve(strict=True)
    destination = Path(destination).resolve()
    if destination == source or destination.is_relative_to(source):
        raise ValueError('Destination must be outside the source workspace')
    database = source / 'studio.sqlite'
    if not database.is_file():
        raise ValueError('Source studio.sqlite is missing')
    destination.mkdir(mode=0o700, parents=True, exist_ok=False)
    # SQLite backup handles WAL correctly; copying studio.sqlite alone does not.
    with sqlite3.connect(database.as_uri() + '?mode=ro', uri=True) as original:
        with sqlite3.connect(destination / 'studio.sqlite') as backup:
            original.backup(backup)
            if backup.execute('PRAGMA integrity_check').fetchone() != ('ok',):
                raise ValueError('Database integrity check failed')
            rows = backup.execute('SELECT id,kind,body FROM records ORDER BY id').fetchall()
    counts = {}
    paths = set()
    for record_id, kind, body in rows:
        counts[kind] = counts.get(kind, 0) + 1
        record = json.loads(body)
        if kind == 'asset' and record.get('path'):
            relative = Path(record['path'])
            if relative.is_absolute() or '..' in relative.parts:
                raise ValueError(f'Unsafe media path for record {record_id}')
            if relative.parts[0] not in {'image-dev', 'image-prod', 'video-dev', 'video-prod'}:
                raise ValueError(f'Unexpected media directory for record {record_id}')
            paths.add(relative)
    # Include files not referenced by records too, without exporting private keys,
    # OAuth tokens, temporary work, model weights or billing caches.
    for folder in ('image-dev', 'image-prod', 'video-dev', 'video-prod', 'storyboards'):
        root = source / folder
        if root.exists():
            paths.update(p.relative_to(source) for p in root.rglob('*') if p.is_file())
    manifest = []
    for relative in sorted(paths):
        original = source / relative
        if not original.resolve().is_relative_to(source) or original.is_symlink():
            raise ValueError(f'External or symbolic media path: {relative}')
        if not original.is_file():
            raise ValueError(f'Missing media: {relative}; export is incomplete')
        before = digest(original)
        target = destination / relative
        target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        shutil.copyfile(original, target)
        target.chmod(0o600)
        if digest(target) != before or digest(original) != before:
            raise ValueError(f'Media changed during export: {relative}; retry with writes paused')
        manifest.append({'path': relative.as_posix(), 'bytes': target.stat().st_size, 'sha256': before})
    (destination / 'studio.sqlite').chmod(0o600)
    result = {'schema': 1, 'records': counts, 'database_sha256': digest(destination / 'studio.sqlite'), 'files': manifest}
    (destination / 'manifest.json').write_text(json.dumps(result, indent=2) + '\n')
    (destination / 'manifest.json').chmod(0o600)
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', required=True, type=Path)
    parser.add_argument('--destination', required=True, type=Path)
    args = parser.parse_args()
    manifest = export(args.source, args.destination)
    print(json.dumps({'records': manifest['records'], 'files': len(manifest['files']), 'verified': True}))
