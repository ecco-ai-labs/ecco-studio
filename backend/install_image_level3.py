"""Install Image Level 2-3 server pieces into the live Studio (21 Nov 2026, branch image-l5).

Adds Qwen-Image-2512's native sizes (4:3, 3:4, 3:2, 2:3), optional Lightning "Fast" LoRAs for pictures (8 steps) and
edits (4 steps), and returns edits at the source picture's size. Studio advertises them in config.image_sizes,
config.image_fast and config.image_edit_full_size, so Image Studio only offers what the server can do.

Usage on the storage pod (idempotent; keeps a backup; changes nothing if any anchor is missing):
    python3 install_image_level3.py /workspace/ecco-studio/studio.py
The patch is the unified diff in image_level3.patch (generated from migration/legacy/studio.py), applied with
`patch --dry-run` first. Restart the Studio process afterwards (kill -TERM <studio pid>; the runner relaunches it).
"""
import hashlib, shutil, subprocess, sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
PATCH = HERE / 'image_level3.patch'
MARK = "QWEN_SIZES=('1664x928','1328x1328','928x1664','1472x1104'"


def main(target):
    path = Path(target)
    source = path.read_text()
    if MARK in source:
        print('ALREADY_INSTALLED')
        return 0
    dry = subprocess.run(['patch', '--dry-run', '-p3', str(path), str(PATCH)], capture_output=True, text=True)
    if dry.returncode:
        print('PATCH_DOES_NOT_APPLY\n' + dry.stdout + dry.stderr)
        return 1
    backup = path.with_name(path.name + '.before-image-level3-' + hashlib.sha256(source.encode()).hexdigest()[:12])
    if not backup.exists():
        shutil.copyfile(path, backup)
    done = subprocess.run(['patch', '-p3', str(path), str(PATCH)], capture_output=True, text=True)
    if done.returncode:
        shutil.copyfile(backup, path)
        print('PATCH_FAILED_RESTORED\n' + done.stdout + done.stderr)
        return 1
    compile(path.read_text(), str(path), 'exec')
    print('IMAGE_LEVEL3_INSTALLED backup=' + backup.name)
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else '/workspace/ecco-studio/studio.py'))
