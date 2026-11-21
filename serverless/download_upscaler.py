"""Put a 4x upscale model on the models volume for "Make 4K" (Image Level 4, 21 Nov 2026).

Image workers read upscale models from /runpod-volume/ComfyUI/models/upscale_models (extra_model_paths.yaml).
Studio offers Make 4K only when a matching file is there (studio.upscale_model). Run once where the volume is mounted:
    python3 download_upscaler.py [/runpod-volume/ComfyUI/models/upscale_models]
Real-ESRGAN x4plus (BSD-3-Clause, Xintao Wang et al.) is taken from the first repository below that has it.
A file that is already present is kept.
"""
import sys
from pathlib import Path

NAME = 'RealESRGAN_x4plus.pth'
REPOS = ['lllyasviel/Annotators', 'ai-forever/Real-ESRGAN']


def main(target):
    from huggingface_hub import hf_hub_download, list_repo_files
    folder = Path(target)
    folder.mkdir(parents=True, exist_ok=True)
    if (folder / NAME).is_file():
        print('PRESENT', NAME)
        return 0
    for repo in REPOS:
        try:
            files = list_repo_files(repo)
        except Exception as error:  # repository moved or unreachable: try the next one
            print('SKIPPED', repo, type(error).__name__)
            continue
        match = next((f for f in files if f.split('/')[-1] == NAME), '')
        if not match:
            print('NOT_FOUND', repo)
            continue
        path = Path(hf_hub_download(repo, match, local_dir=str(folder)))
        if path != folder / NAME:
            path.replace(folder / NAME)
        print('DOWNLOADED', NAME, 'from', repo)
        return 0
    print('NOT_FOUND_ANYWHERE')
    return 1


if __name__ == '__main__':
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else '/runpod-volume/ComfyUI/models/upscale_models'))
