"""CPU inference for Kokoro, VoxCPM2 and Indic Parler in isolated environments."""
import argparse
import json
from pathlib import Path
from audio_schema import MODELS, validate
from audio_worker import assemble, inference_device, speech_progress


def synthesize(request, output, runtime):
    import numpy as np
    import torch
    device = inference_device(request, torch)
    torch.manual_seed(42)
    model_id = request['model']
    root = runtime / model_id
    voices = {v['id']: v for v in MODELS[model_id]['voices']}
    clips = []
    speech_progress(output, 0, len(request['lines']))
    if model_id == 'kokoro':
        from kokoro import KModel, KPipeline
        model = KModel(repo_id='hexgrad/Kokoro-82M', config=str(root/'config.json'), model=str(root/'kokoro-v1_0.pth')).to(device).eval()
        pipelines = {}
        rate = 24000
        def render(line):
            code = voices[line['voice']]['code']
            if code not in pipelines:
                pipelines[code] = KPipeline(lang_code=code, model=model, device=device)
            parts = [audio.float().cpu().numpy() for _, _, audio in pipelines[code](line['text'], voice=str(root/'voices'/(line['voice']+'.pt')), speed=1)]
            if not parts:
                raise RuntimeError('Kokoro returned no spoken audio.')
            return np.concatenate(parts)
    elif model_id == 'voxcpm2':
        from voxcpm import VoxCPM
        model = VoxCPM.from_pretrained(str(root), load_denoiser=False, local_files_only=True, optimize=False, device=device)
        rate = model.tts_model.sample_rate
        def render(line):
            reference = runtime/'reference-voices'/voices[line['voice']]['file']
            if not reference.is_file():
                raise RuntimeError('The selected reference voice is not installed.')
            direction = line.get('direction', '').replace('(', '').replace(')', '')
            text = (f'({direction})' if direction else '') + line['text']
            return model.generate(text=text, reference_wav_path=str(reference), normalize=False, denoise=False, seed=42)
    elif model_id == 'indic-parler':
        from parler_tts import ParlerTTSForConditionalGeneration
        from transformers import AutoTokenizer
        model = ParlerTTSForConditionalGeneration.from_pretrained(root, local_files_only=True).to(device).eval()
        tokenizer = AutoTokenizer.from_pretrained(root, local_files_only=True)
        description_tokenizer = AutoTokenizer.from_pretrained(root/'description-tokenizer', local_files_only=True)
        rate = model.config.sampling_rate
        def render(line):
            identity = voices[line['voice']].get('speaker')
            description = (identity + ' speaks' if identity else 'A speaker speaks') + ' in '+line['language']+'. Clear close-microphone recording with no background noise. '+line.get('direction', '')
            desc = description_tokenizer(description, return_tensors='pt').to(device)
            prompt = tokenizer(line['text'], return_tensors='pt').to(device)
            result = model.generate(input_ids=desc.input_ids, attention_mask=desc.attention_mask, prompt_input_ids=prompt.input_ids, prompt_attention_mask=prompt.attention_mask)
            return result.squeeze().float().cpu().numpy()
    else:
        raise ValueError('Unsupported model.')
    with torch.inference_mode():
        for index, line in enumerate(request['lines']):
            clip = np.asarray(render(line), dtype=np.float32).squeeze()
            if clip.ndim != 1 or len(clip) < rate//10 or not np.isfinite(clip).all() or np.max(np.abs(clip)) < 1e-5:
                raise RuntimeError('The model returned empty or invalid speech.')
            clips.append(clip)
            speech_progress(output, index+1, len(request['lines']))
    assemble(clips, request, output, rate)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    for name in ('request', 'output', 'runtime'):
        parser.add_argument('--'+name, required=True, type=Path)
    args = parser.parse_args()
    synthesize(validate(json.loads(args.request.read_text())), args.output, args.runtime)
