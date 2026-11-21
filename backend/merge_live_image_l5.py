"""Bring Image Levels 3-5 into the live Studio on the storage pod (21 Nov 2026, branch image-l5-native).

The live /workspace/ecco-studio/studio.py has drifted from migration/legacy/studio.py on main: it also has FLUX Klein
and the generation-queue routes. The image_level3/4/5 patches don't apply to it. This script does a three-way
merge instead:
    base  = main's migration/legacy/studio.py
    ours  = the live studio.py
    theirs = this branch's migration/legacy/studio.py (main + Image Levels 3-5 only)
It then resolves the four known conflicts by keeping every live line and adding the branch's lines, and checks that
the result compiles.

Usage:  python3 merge_live_image_l5.py LIVE BASE THEIRS OUT
        (writes OUT and changes nothing else; install it by copying OUT over LIVE after a backup)
"""
import re
import subprocess
import sys
from pathlib import Path

ADDED_CONFIG = re.compile(r"'image_sizes':\{'qwen-image-2512':list\(QWEN_SIZES\)\}.*?'image_batch':BATCH_CHUNK,", re.S)


def resolve(ours, theirs):
    o, t = '\n'.join(ours), '\n'.join(theirs)
    if 'is_flux' in o and 'sizes=' in o and 'QWEN_SIZES' in t:  # 1: live FLUX sizes + the 7 Qwen sizes
        return [l.replace("(('1664x928','1328x1328','928x1664') if is_qwen", "(QWEN_SIZES if is_qwen") for l in ours]
    if "'seed':number(" in o and "'seed':number(" in t:  # 2: live seed/steps line + Fast mode and house style lines
        return ours + theirs[1:]
    if "'model_settings_version':1" in o and ADDED_CONFIG.search(t):  # 3: live config + the new config keys
        added = ADDED_CONFIG.search(t).group(0)
        assert len(ours) == 1 and "'models_ready'" in ours[0]
        return [ours[0].replace("'models_ready'", added + "'models_ready'", 1)]
    if "elif path=='/api/image-edits'" in o and "/api/image-resize" in t:  # 4: live queue routes + the new routes
        return ours + [l for l in theirs if "/api/image-edits'" not in l]
    raise SystemExit('UNKNOWN_CONFLICT\n' + o[:800] + '\n=======\n' + t[:800])


def main(live, base, theirs, out):
    merged = subprocess.run(['git', 'merge-file', '-p', live, base, theirs], capture_output=True, text=True).stdout.split('\n')
    result, i, n = [], 0, 0
    while i < len(merged):
        line = merged[i]
        if line.startswith('<<<<<<< '):
            ours, theirs_lines, j = [], [], i + 1
            while not merged[j].startswith('======='):
                ours.append(merged[j]); j += 1
            j += 1
            while not merged[j].startswith('>>>>>>> '):
                theirs_lines.append(merged[j]); j += 1
            result += resolve(ours, theirs_lines); i = j + 1; n += 1
            continue
        result.append(line); i += 1
    text = '\n'.join(result)
    compile(text, out, 'exec')
    for mark in ("QWEN_SIZES=(", "UPSCALE_MODELS=(", "STYLE_LORA=re.compile(", "path=='/api/image-batch'", "'image_batch':BATCH_CHUNK", "is_flux"):
        assert mark in text, mark
    Path(out).write_text(text)
    print(f'MERGED conflicts_resolved={n} lines={len(result)}')


if __name__ == '__main__':
    main(*sys.argv[1:5])
