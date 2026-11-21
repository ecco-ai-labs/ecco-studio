"""Put the Lightning "Fast" LoRAs on the models volume (Image Level 2-3, 21 Nov 2026).

Image workers read LoRAs from /runpod-volume/ComfyUI/models/loras (extra_model_paths.yaml). Studio offers Fast mode
only when a matching file is there (studio.fast_lora). Run once where the volume is mounted, for example as an
install job on the image endpoint or from a pod that mounts ecco-models-workspace:
    python3 download_fast_loras.py [/runpod-volume/ComfyUI/models/loras]
Picks the 8-step picture LoRA when the repository has one (4-step otherwise) and the 4-step edit LoRA, preferring
bf16, then fp32. Files that are already present are kept.
"""
import fnmatch, sys
from pathlib import Path

WANTED = [
    ('lightx2v/Qwen-Image-2512-Lightning', ['Qwen-Image-2512-Lightning-8steps*bf16*.safetensors', 'Qwen-Image-2512-Lightning-8steps*.safetensors',
                                            'Qwen-Image-2512-Lightning-4steps*bf16*.safetensors', 'Qwen-Image-2512-Lightning-4steps*.safetensors']),
    ('lightx2v/Qwen-Image-Edit-2511-Lightning', ['Qwen-Image-Edit-2511-Lightning-4steps*bf16*.safetensors', 'Qwen-Image-Edit-2511-Lightning-4steps*.safetensors']),
]


def pick(files, patterns):
    for pattern in patterns:
        found = sorted(f for f in files if '/' not in f and fnmatch.fnmatch(f, pattern) and 'fp8' not in f)
        if found:
            return found[0]
    return ''


def main(target):
    from huggingface_hub import hf_hub_download, list_repo_files
    folder = Path(target)
    folder.mkdir(parents=True, exist_ok=True)
    for repo, patterns in WANTED:
        name = pick(list_repo_files(repo), patterns)
        if not name:
            print('NOT_FOUND', repo)
            continue
        if (folder / name).is_file():
            print('PRESENT', name)
            continue
        hf_hub_download(repo, name, local_dir=str(folder))
        print('DOWNLOADED', name)


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else '/runpod-volume/ComfyUI/models/loras')
