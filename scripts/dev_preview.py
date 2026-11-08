"""Assemble GitHub Pages Dev plus the 10 latest immutable version previews.

Previous static snapshots are retained in the dev-previews branch. This branch
is never a production source. All files are already public frontend assets.
"""
import json
from pathlib import Path
import shutil


def assemble(build, previous, output):
    build, previous, output = map(Path, (build, previous, output))
    manifest = json.loads((build / 'release.json').read_text())
    # Runs can finish out of order. Retain the newest successful Dev entry point
    # while still adding the older build's immutable preview.
    root_source = build
    if (previous / 'release.json').exists():
        old = json.loads((previous / 'release.json').read_text())
        if int(old['checkRunId']) > int(manifest['checkRunId']):
            root_source = previous
    shutil.copytree(root_source, output, ignore=shutil.ignore_patterns('.git', 'previews'))
    previews = output / 'previews'
    if (previous / 'previews').exists():
        shutil.copytree(previous / 'previews', previews)
    previews.mkdir(exist_ok=True)
    target = previews / manifest['sha']
    if target.exists():
        shutil.rmtree(target)
    shutil.copytree(build, target)
    ordered = sorted(previews.iterdir(), key=lambda p: int(json.loads((p/'release.json').read_text())['checkRunId']), reverse=True)
    for path in ordered[10:]:
        shutil.rmtree(path)


if __name__ == '__main__':
    assemble('release-dist', 'previous-previews', 'dev-dist')
