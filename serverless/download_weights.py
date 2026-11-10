"""Docker build step: download one weight group listed in the bucket manifest.

  python download_weights.py <group> <destination> [--prefix comfy/=models/ ...]

The base URL is read from serverless/weights-url.txt (a public, read-only URL).
Every file is checked against the size recorded by publish_weights.py.
"""
import argparse
import json
import shutil
import sys
import urllib.request
from pathlib import Path, PurePosixPath


def base_url():
    lines = (Path(__file__).resolve().parent / 'weights-url.txt').read_text().splitlines()
    text = next((l.strip() for l in lines if l.strip() and not l.strip().startswith('#')), '')
    if not text.startswith('https://'):
        sys.exit('Set serverless/weights-url.txt to the public HTTPS address of the weights/ folder.')
    return text.rstrip('/')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('group')
    parser.add_argument('destination')
    parser.add_argument('--rename', action='append', default=[], help='OLD_PREFIX=NEW_PREFIX for target paths')
    args = parser.parse_args()
    url = base_url()
    with urllib.request.urlopen(url + '/manifest.json', timeout=60) as response:
        manifest = json.load(response)
    items = manifest['groups'][args.group]
    renames = [r.split('=', 1) for r in args.rename]
    destination = Path(args.destination)
    for item in items:
        relative = PurePosixPath(item['path'])
        if relative.is_absolute() or '..' in relative.parts:
            sys.exit(f'Unsafe path in manifest: {item["path"]}')
        target_name = item['path']
        for old, new in renames:
            if target_name.startswith(old):
                target_name = new + target_name[len(old):]
                break
        target = destination / target_name
        target.parent.mkdir(parents=True, exist_ok=True)
        print(f'{item["size"] / 1e9:6.2f} GB  {item["path"]}', flush=True)
        with urllib.request.urlopen(f'{url}/{item["path"]}', timeout=600) as response, target.open('wb') as out:
            shutil.copyfileobj(response, out, 16 * 1024 * 1024)
        if target.stat().st_size != item['size']:
            sys.exit(f'Size mismatch for {item["path"]}')
    (destination / f'.manifest-{args.group}.json').write_text(json.dumps(manifest))
    print(f'Downloaded {len(items)} files for {args.group}.')


if __name__ == '__main__':
    main()
