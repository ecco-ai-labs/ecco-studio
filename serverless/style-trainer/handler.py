"""RunPod Serverless worker: trains a house-style LoRA for Qwen-Image-2512 with Musubi Tuner (Image Level 5, IMG-5.1).

Job input
  {"key": "<training id>", "dataset": {"volume_key": "ecco-serverless/inputs/<id>.tar"} | {"inline": base64},
   "name": "ecco-style-<id>", "steps": 1200, "rank": 16, "resolution": 1024, "learning_rate": 1e-4}
  The dataset tar holds pictures (png/jpg/webp) with a .txt caption of the same name.
Job output
  {"lora": "ecco-style-<id>.safetensors", "bytes": n, "steps": n, "archive": {...result tar with the LoRA...}}

The finished LoRA is written straight into /runpod-volume/ComfyUI/models/loras, so this endpoint must use the same
volume as the image endpoint; a copy also comes back in the result archive for Studio's own records.
Base weights are read from the volume and fetched once if missing (Comfy-Org repackaged Qwen-Image files).
"""
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import runpod

sys.path.insert(0, str(Path(__file__).resolve().parent))
import worker_common  # noqa: E402

VOLUME = Path(os.getenv('ECCO_VOLUME', '/runpod-volume'))
MUSUBI = Path(os.getenv('MUSUBI_DIR', '/musubi-tuner'))
BASE = VOLUME / 'ecco-training' / 'base'
LORAS = VOLUME / 'ComfyUI' / 'models' / 'loras'
# (file on the volume, Hugging Face repo, path in the repo)
WEIGHTS = {
    'dit': ('qwen_image_2512_bf16.safetensors', 'Comfy-Org/Qwen-Image_ComfyUI', 'split_files/diffusion_models/qwen_image_2512_bf16.safetensors'),
    'vae': ('qwen_image_vae.safetensors', 'Qwen/Qwen-Image', 'vae/diffusion_pytorch_model.safetensors'),
    'text_encoder': ('qwen_2.5_vl_7b.safetensors', 'Comfy-Org/Qwen-Image_ComfyUI', 'split_files/text_encoders/qwen_2.5_vl_7b.safetensors'),
}
PICTURES = {'.png', '.jpg', '.jpeg', '.webp'}


def weights(progress):
    BASE.mkdir(parents=True, exist_ok=True)
    found = {}
    for key, (name, repo, path) in WEIGHTS.items():
        target = BASE / name
        if not target.is_file():
            progress(f'Fetching base weights once: {name}')
            from huggingface_hub import hf_hub_download
            got = Path(hf_hub_download(repo, path, local_dir=str(BASE / 'download')))
            shutil.move(str(got), target)
        found[key] = target
    return found


def dataset_config(images, cache, resolution):
    return (f'[general]\nresolution = [{resolution}, {resolution}]\ncaption_extension = ".txt"\nbatch_size = 1\n'
            f'enable_bucket = true\nbucket_no_upscale = false\n\n[[datasets]]\nimage_directory = "{images}"\n'
            f'cache_directory = "{cache}"\nnum_repeats = 1\n')


def check_dataset(folder):
    pictures = [p for p in folder.iterdir() if p.suffix.lower() in PICTURES]
    if not 10 <= len(pictures) <= 200:
        raise ValueError(f'A house style needs 10 to 200 pictures; got {len(pictures)}.')
    for p in pictures:
        if not p.with_suffix('.txt').is_file():
            p.with_suffix('.txt').write_text('in the house style')
    return len(pictures)


def commands(w, toml, out, name, steps, rank, lr):
    py, src = sys.executable, MUSUBI / 'src' / 'musubi_tuner'
    return [
        [py, str(src / 'qwen_image_cache_latents.py'), '--dataset_config', str(toml), '--vae', str(w['vae'])],
        [py, str(src / 'qwen_image_cache_text_encoder_outputs.py'), '--dataset_config', str(toml), '--text_encoder', str(w['text_encoder']), '--batch_size', '1'],
        ['accelerate', 'launch', '--num_cpu_threads_per_process', '1', '--mixed_precision', 'bf16', str(src / 'qwen_image_train_network.py'),
         '--dit', str(w['dit']), '--vae', str(w['vae']), '--text_encoder', str(w['text_encoder']), '--dataset_config', str(toml),
         '--sdpa', '--mixed_precision', 'bf16', '--timestep_sampling', 'shift', '--weighting_scheme', 'none', '--discrete_flow_shift', '2.2',
         '--optimizer_type', 'adamw8bit', '--learning_rate', str(lr), '--gradient_checkpointing', '--max_data_loader_n_workers', '2',
         '--network_module', 'networks.lora_qwen_image', '--network_dim', str(rank), '--max_train_steps', str(steps),
         '--save_every_n_steps', str(max(steps, 1)), '--seed', '42', '--output_dir', str(out), '--output_name', name + '-musubi'],
        [py, str(src / 'convert_lora.py'), '--input', str(out / (name + '-musubi.safetensors')), '--output', str(out / (name + '.safetensors')), '--target', 'other'],
    ]


def handler(job):
    data = job.get('input') or {}
    progress = lambda text: runpod.serverless.progress_update(job, text)  # noqa: E731
    name = str(data.get('name') or '')
    if not name.startswith('ecco-style-') or not name.replace('-', '').isalnum():
        return {'error': 'Invalid LoRA name.'}
    steps, rank = max(200, min(4000, int(data.get('steps') or 1200))), max(4, min(64, int(data.get('rank') or 16)))
    lr, resolution = float(data.get('learning_rate') or 1e-4), max(512, min(1328, int(data.get('resolution') or 1024)))
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        images, cache, out = tmp / 'images', tmp / 'cache', tmp / 'out'
        for p in (images, cache, out):
            p.mkdir()
        progress('Unpacking the pictures')
        worker_common.unpack_inputs(worker_common.fetch(data.get('dataset') or {}), images)
        count = check_dataset(images)
        w = weights(progress)
        toml = tmp / 'dataset.toml'
        toml.write_text(dataset_config(images, cache, resolution))
        labels = ['Reading the pictures', 'Reading the captions', f'Learning the style ({steps} steps)', 'Saving the style']
        for label, cmd in zip(labels, commands(w, toml, out, name, steps, rank, lr)):
            progress(label)
            run = subprocess.run(cmd, cwd=MUSUBI, capture_output=True, text=True)
            if run.returncode:
                return {'error': f'{label} failed.', 'log': (run.stdout + run.stderr)[-3000:]}
        lora = out / (name + '.safetensors')
        LORAS.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(lora, LORAS / lora.name)
        archive = worker_common.deliver(worker_common.pack([lora], out), name + '.tar')
        return {'lora': lora.name, 'bytes': lora.stat().st_size, 'steps': steps, 'pictures': count, 'archive': archive}


if __name__ == '__main__':
    runpod.serverless.start({'handler': handler})
