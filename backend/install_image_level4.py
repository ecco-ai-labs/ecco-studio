"""Install Image Level 4 server pieces into the live Studio (21 Nov 2026, branch image-l5-native).

Adds Change shape (fill the new sides with the edit model, keep the middle) and 4K copies (upscale model).
Needs Image Level 3 installed first (install_image_level3.py). Studio advertises the new pieces in
config.image_resize and config.image_upscale; 4K appears only once download_upscaler.py has put a model on the volume.

Usage on the storage pod (idempotent; keeps a backup; changes nothing if any anchor is missing):
    python3 install_image_level4.py /workspace/ecco-studio/studio.py
The patch is the unified diff in image_level4.patch (generated from migration/legacy/studio.py), applied with
`patch --dry-run` first. Restart the Studio process afterwards (kill -TERM <studio pid>; the runner relaunches it).
"""
import hashlib, shutil, subprocess, sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
PATCH = HERE / 'image_level4.patch'
MARK = "UPSCALE_MODELS=('4x-UltraSharp"
NEEDS = "QWEN_SIZES=('1664x928','1328x1328','928x1664','1472x1104'"


def main(target):
    path = Path(target)
    source = path.read_text()
    if MARK in source:
        print('ALREADY_INSTALLED')
        return 0
    if NEEDS not in source:
        print('INSTALL_IMAGE_LEVEL3_FIRST')
        return 1
    dry = subprocess.run(['patch', '--dry-run', '-p3', str(path), str(PATCH)], capture_output=True, text=True)
    if dry.returncode:
        print('PATCH_DOES_NOT_APPLY\n' + dry.stdout + dry.stderr)
        return 1
    backup = path.with_name(path.name + '.before-image-level4-' + hashlib.sha256(source.encode()).hexdigest()[:12])
    if not backup.exists():
        shutil.copyfile(path, backup)
    done = subprocess.run(['patch', '-p3', str(path), str(PATCH)], capture_output=True, text=True)
    if done.returncode:
        shutil.copyfile(backup, path)
        print('PATCH_FAILED_RESTORED\n' + done.stdout + done.stderr)
        return 1
    compile(path.read_text(), str(path), 'exec')
    print('IMAGE_LEVEL4_INSTALLED backup=' + backup.name)
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else '/workspace/ecco-studio/studio.py'))
