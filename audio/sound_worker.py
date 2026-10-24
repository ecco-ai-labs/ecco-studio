"""Isolated, offline inference from pinned local MOSS/ACE-Step installations."""
import argparse
import json
import os
from pathlib import Path
import sys

from sound_schema import validate
from audio_queue import write

def generate(request, runtime, output):
    request = validate(request)
    base = runtime / request['model']
    manifest = json.loads((base / 'manifest.json').read_text())
    os.environ.update(HF_HUB_OFFLINE='1', TRANSFORMERS_OFFLINE='1', TORCHDYNAMO_DISABLE='1')
    sys.path.insert(0, str(base / 'source'))
    import torch
    import soundfile as sf
    device = 'cpu' if request['compute'] == 'cpu' else 'cuda'
    if device == 'cuda' and not torch.cuda.is_available():
        raise RuntimeError('The selected GPU is unavailable; no CPU fallback was used.')
    if device == 'cpu':
        torch.set_num_threads(int(os.getenv('ECCO_AUDIO_CPU_THREADS', '1')))
    write(output.parent / 'progress.json', {'progress': 'Loading sound model'})
    if request['model'] == 'moss-soundeffect-v2':
        from moss_soundeffect_v2 import MossSoundEffectPipeline
        pipe = MossSoundEffectPipeline.from_pretrained(str(base / 'weights'), torch_dtype=torch.bfloat16, device=device)
        write(output.parent / 'progress.json', {'progress': 'Generating sound effect'})
        tensor = pipe(prompt=request['description'], seconds=request['duration'], seed=request['seed'],
                      num_inference_steps=100, cfg_scale=4.0, sigma_shift=5.0)[0]
        rate = pipe.sample_rate
    else:
        os.environ['ACESTEP_CHECKPOINTS_DIR'] = str(base / 'weights')
        from acestep.handler import AceStepHandler
        from acestep.llm_inference import LLMHandler
        from acestep.inference import GenerationParams, GenerationConfig, generate_music
        handler = AceStepHandler()
        status, ok = handler.initialize_service(project_root=str(base), config_path='acestep-v15-turbo',
                                               device=device, use_flash_attention=False, compile_model=False, use_mlx_dit=False,
                                               vae_checkpoint='official')
        if not ok:
            raise RuntimeError('Music model initialization failed: ' + status)
        if handler.device != device:
            raise RuntimeError('The music runtime changed compute unexpectedly; generation stopped.')
        write(output.parent / 'progress.json', {'progress': 'Generating instrumental music'})
        params = GenerationParams(task_type='text2music', caption=request['description'], lyrics='[Instrumental]',
            instrumental=True, duration=request['duration'], inference_steps=8, shift=3.0, guidance_scale=1.0,
            seed=request['seed'], thinking=False, use_cot_metas=False, use_cot_caption=False, use_cot_lyrics=False, use_cot_language=False)
        result = generate_music(handler, LLMHandler(), params,
            GenerationConfig(batch_size=1, use_random_seed=False, seeds=[request['seed']], audio_format='wav'), save_dir=None)
        if not result.success or not result.audios:
            raise RuntimeError('Music inference failed: ' + str(result.error))
        tensor, rate = result.audios[0]['tensor'], result.audios[0]['sample_rate']
    data = tensor.detach().float().cpu().numpy()
    if data.ndim == 2:
        data = data.T
    if not len(data):
        raise RuntimeError('The model returned no sound.')
    import numpy as np
    if not np.isfinite(data).all() or np.max(np.abs(data)) < 1e-6:
        raise RuntimeError('The model returned invalid or silent audio.')
    # Bound output duration even when an upstream sampler pads its latent sequence.
    data = data[:round(rate * request['duration'])]
    temporary = output.with_suffix('.tmp.wav')
    sf.write(str(temporary), data, rate, subtype='PCM_16')
    temporary.replace(output)
    write(output.parent / 'provenance.json', {k: manifest[k] for k in ('source_revision', 'model_revision', 'model_repository')})

if __name__ == '__main__':
    p = argparse.ArgumentParser()
    p.add_argument('--request', type=Path, required=True)
    p.add_argument('--runtime', type=Path, required=True)
    p.add_argument('--output', type=Path, required=True)
    args = p.parse_args()
    generate(json.loads(args.request.read_text()), args.runtime, args.output)
