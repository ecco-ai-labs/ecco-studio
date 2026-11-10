"""Copy the model weights from the shared RunPod volume to a bucket the worker builds can download from.

Run once on any pod that has the shared volume mounted at /workspace (the CPU storage pod works):

  pip install boto3
  export ECCO_S3_BUCKET=... ECCO_S3_ENDPOINT_URL=... ECCO_S3_ACCESS_KEY_ID=... ECCO_S3_SECRET_ACCESS_KEY=...
  python serverless/publish_weights.py --dry-run     # review what will be copied
  python serverless/publish_weights.py               # upload

It writes weights/manifest.json in the bucket and a local copy at
/workspace/ecco-serverless/manifest.json. Re-running skips files already uploaded with the same size.

Groups
  images  : every ComfyUI model file except the Wan video models, plus Z-Image (diffusers folder)
  video   : the Wan 2.2 models, their VAEs and the UMT5 text encoder
  longcat : LongCat-Video-Avatar 1.5 source, prepared runner and weights
"""
import argparse
import fnmatch
import json
import os
import subprocess
import time
from pathlib import Path

WORKSPACE = Path(os.getenv('ECCO_WORKSPACE', '/workspace'))
COMFY_MODELS = WORKSPACE / 'ComfyUI/models'
ZIMAGE = WORKSPACE / 'ecco-models/z-image'
LONGCAT = WORKSPACE / 'ecco-video/longcat'
VIDEO_PATTERNS = ('*wan*', '*umt5*')
SKIP_PATTERNS = ('*.tmp', '*/.cache/*', '*.lock', '*/put_*_here')
PREFIX = 'weights'


def video_file(relative):
    return any(fnmatch.fnmatch(relative.lower(), p) for p in VIDEO_PATTERNS)


def files_under(root):
    for path in sorted(root.rglob('*')):
        if path.is_file() and not path.is_symlink() and not any(fnmatch.fnmatch(str(path), p) for p in SKIP_PATTERNS):
            yield path


def collect(exclude=()):
    groups = {'images': [], 'video': [], 'longcat': []}
    def add(group, path, target):
        if any(fnmatch.fnmatch(target, p) for p in exclude):
            return
        groups[group].append({'source': str(path), 'path': target, 'size': path.stat().st_size})
    for path in files_under(COMFY_MODELS):
        relative = str(path.relative_to(COMFY_MODELS))
        add('video' if video_file(relative) else 'images', path, 'comfy/' + relative)
    if ZIMAGE.is_dir():
        for path in files_under(ZIMAGE):
            add('images', path, 'z-image/' + str(path.relative_to(ZIMAGE)))
    for part in ('source', 'weights/LongCat-Video-Avatar-1.5', 'runner.py'):
        target = LONGCAT / part
        for path in ([target] if target.is_file() else files_under(target) if target.is_dir() else []):
            add('longcat', path, 'longcat/' + str(path.relative_to(LONGCAT)))
    return groups


def comfy_commit():
    try:
        return subprocess.check_output(['git', '-C', str(WORKSPACE / 'ComfyUI'), 'rev-parse', 'HEAD'], text=True).strip()
    except (OSError, subprocess.CalledProcessError):
        return None


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--dry-run', action='store_true')
    parser.add_argument('--exclude', action='append', default=[], help='glob on the target path, e.g. "comfy/checkpoints/old_*"')
    args = parser.parse_args()
    groups = collect(args.exclude)
    for name, items in groups.items():
        size = sum(i['size'] for i in items)
        print(f'{name}: {len(items)} files, {size / 1e9:.1f} GB')
        if args.dry_run:
            for item in items:
                print(f'   {item["size"] / 1e9:7.2f} GB  {item["path"]}')
    manifest = {'created': time.time(), 'comfy_commit': comfy_commit(),
                'groups': {n: [{'path': i['path'], 'size': i['size']} for i in items] for n, items in groups.items()}}
    if args.dry_run:
        print('ComfyUI commit:', manifest['comfy_commit'] or 'unknown')
        return
    import boto3
    client = boto3.client('s3', endpoint_url=os.environ['ECCO_S3_ENDPOINT_URL'],
                          aws_access_key_id=os.environ['ECCO_S3_ACCESS_KEY_ID'],
                          aws_secret_access_key=os.environ['ECCO_S3_SECRET_ACCESS_KEY'],
                          region_name=os.getenv('ECCO_S3_REGION', 'auto'))
    bucket = os.environ['ECCO_S3_BUCKET']
    for items in groups.values():
        for item in items:
            key = f'{PREFIX}/{item["path"]}'
            try:
                if client.head_object(Bucket=bucket, Key=key)['ContentLength'] == item['size']:
                    print('already uploaded', key)
                    continue
            except client.exceptions.ClientError:
                pass
            print('uploading', key, f'({item["size"] / 1e9:.2f} GB)', flush=True)
            client.upload_file(item['source'], bucket, key)
    body = json.dumps(manifest, indent=1)
    client.put_object(Bucket=bucket, Key=f'{PREFIX}/manifest.json', Body=body.encode(), ContentType='application/json')
    local = WORKSPACE / 'ecco-serverless/manifest.json'
    local.parent.mkdir(parents=True, exist_ok=True)
    local.write_text(body)
    print('Manifest written to the bucket and', local)


if __name__ == '__main__':
    main()
