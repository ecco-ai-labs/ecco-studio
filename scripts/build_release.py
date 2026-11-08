"""Build only public browser assets; never package backend, fixtures or credentials."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import shutil

ROOT = Path(__file__).resolve().parents[1]
EXTENSIONS = {'.html', '.js', '.mjs', '.css', '.json', '.png', '.jpg', '.jpeg', '.svg', '.ico', '.woff', '.woff2', '.webp', '.txt', '.wasm'}


def build(destination, sha, run_id):
    if not re.fullmatch('[0-9a-f]{40}', sha):
        raise ValueError('A full source SHA is required.')
    destination = Path(destination)
    if destination.exists() and any(destination.iterdir()):
        raise ValueError('Build destination must be empty.')
    destination.mkdir(parents=True, exist_ok=True)
    files = [p for p in ROOT.iterdir() if p.is_file() and p.suffix in EXTENSIONS and not p.name.startswith('.')
             and (p.suffix != '.json' or p.name == 'notifications.json')
             and '.test.' not in p.name and p.name not in ('package.json', 'package-lock.json')]
    for directory in ('assets', 'vendor'):
        files.extend(p for p in (ROOT / directory).rglob('*') if p.is_file() and p.suffix in EXTENSIONS)
    files += [ROOT / 'desk' / name for name in ('index.html', 'desk-app.mjs', 'desk-app.mjs.LEGAL.txt')]
    # The master size roster and its runtime/stylesheet are loaded by Studio and Desk.
    files += [ROOT / 'design-system' / name for name in ('sizes.js', 'sizes.css', 'size-roster.json')]
    for source in files:
        if source.is_symlink():
            raise ValueError('Symbolic links cannot enter a release.')
        target = destination / source.relative_to(ROOT)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, target)
    (destination / '.nojekyll').write_text('')
    # Revalidation keeps entry HTML and mutable asset URLs on one release.
    (destination / '_headers').write_text('/*\n  Cache-Control: no-cache\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n')
    manifest = {'schema': 'ecco-build-v1', 'sha': sha, 'checkRunId': str(run_id), 'files': {}}
    for path in sorted(destination.rglob('*')):
        if path.is_file():
            manifest['files'][path.relative_to(destination).as_posix()] = hashlib.sha256(path.read_bytes()).hexdigest()
    (destination / 'release.json').write_text(json.dumps(manifest, indent=2) + '\n')
    return manifest


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', required=True)
    parser.add_argument('--sha', required=True)
    parser.add_argument('--run-id', required=True)
    args = parser.parse_args()
    build(args.output, args.sha, args.run_id)
