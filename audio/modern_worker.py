"""Inference for Kokoro, VoxCPM2, Indic Parler (CPU or GPU) and svara-TTS (GPU) in isolated environments."""
import argparse
import json
from pathlib import Path
from audio_schema import MODELS, validate, performance_direction
from audio_worker import assemble, inference_device, speech_progress
from voice_refs import fetch as fetch_voice_ref, ref_id


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
            direction = (line.get('direction', '') if line.get('design') else performance_direction(request, line)).replace('(', '').replace(')', '')
            text = (f'({direction})' if direction else '') + line['text']
            if line.get('design'):
                # Voice design: the description alone shapes a new voice (no reference clip).
                return model.generate(text=text, normalize=False, denoise=False, seed=42)
            if ref_id(line['voice']):
                reference = fetch_voice_ref(request, line['voice'], output)[0]
            else:
                reference = runtime/'reference-voices'/voices[line['voice']]['file']
            if not reference.is_file():
                raise RuntimeError('The selected reference voice is not installed.')
            return model.generate(text=text, reference_wav_path=str(reference), normalize=False, denoise=False, seed=42)
    elif model_id == 'indic-parler':
        from parler_tts import ParlerTTSForConditionalGeneration
        from transformers import AutoTokenizer
        model = ParlerTTSForConditionalGeneration.from_pretrained(root, local_files_only=True).to(device).eval()
        tokenizer = AutoTokenizer.from_pretrained(root, local_files_only=True)
        description_tokenizer = AutoTokenizer.from_pretrained(root/'description-tokenizer', local_files_only=True)
        rate = model.config.sampling_rate
        def render(line):
            if line.get('design'):
                # Voice design: the user's description of the character's voice and feeling.
                description = line.get('direction', '') + ' Speaks in ' + line['language'] + '. Clear close-microphone recording with no background noise.'
            else:
                identity = voices[line['voice']].get('speaker')
                description = (identity + ' speaks' if identity else 'A speaker speaks') + ' in '+line['language']+'. Clear close-microphone recording with no background noise. '+performance_direction(request, line)
            desc = description_tokenizer(description, return_tensors='pt').to(device)
            prompt = tokenizer(line['text'], return_tensors='pt').to(device)
            result = model.generate(input_ids=desc.input_ids, attention_mask=desc.attention_mask, prompt_input_ids=prompt.input_ids, prompt_attention_mask=prompt.attention_mask)
            return result.squeeze().float().cpu().numpy()
    elif model_id == 'svara-tts':
        # GPU only. Weights: <runtime>/svara-tts (svara-TTS) and <runtime>/svara-tts/snac (SNAC 24 kHz decoder).
        import json as _json
        from snac import SNAC
        from transformers import AutoModelForCausalLM, AutoTokenizer
        import svara_codec
        if device != 'cuda':
            raise RuntimeError('svara-TTS runs on a GPU worker only.')
        tokenizer = AutoTokenizer.from_pretrained(root, local_files_only=True)
        model = AutoModelForCausalLM.from_pretrained(root, local_files_only=True, torch_dtype=torch.bfloat16).to(device).eval()
        snac = SNAC(**_json.loads((root/'snac'/'config.json').read_text()))
        snac.load_state_dict(torch.load(root/'snac'/'pytorch_model.bin', map_location='cpu'))
        snac = snac.to(device).eval()
        rate = svara_codec.SAMPLE_RATE
        def render(line):
            speaker = voices[line['voice']]['speaker']
            ids = svara_codec.prompt_ids(lambda t: tokenizer.encode(t, add_special_tokens=False), speaker, svara_codec.tagged_text(line['text'], line.get('emotion')))
            prompt = torch.tensor([ids], device=device)
            out = model.generate(prompt, attention_mask=torch.ones_like(prompt), max_new_tokens=4096, do_sample=True, temperature=0.7,
                                 top_p=0.95, repetition_penalty=1.1, eos_token_id=svara_codec.END_OF_SPEECH)
            codes = svara_codec.snac_codes(out[0, prompt.shape[1]:].tolist())
            audio = snac.decode([torch.tensor([c], device=device) for c in codes])
            return audio.squeeze().float().cpu().numpy()
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
