"""On-demand Indic-Mio inference. All paths are explicitly supplied temporary worker files."""
import argparse
import json
import re
import subprocess
from pathlib import Path

def synthesize(request, output, runtime):
    import numpy as np
    import soundfile as sf
    import torch
    from transformers import AutoModelForCausalLM, AutoTokenizer
    from miocodec import MioCodecModel

    if not torch.cuda.is_available():
        raise RuntimeError('A CUDA GPU is required for this audio worker.')
    tokenizer = AutoTokenizer.from_pretrained(runtime / 'model', local_files_only=True)
    model = AutoModelForCausalLM.from_pretrained(runtime / 'model', local_files_only=True,
                                                torch_dtype=torch.bfloat16).eval().to('cuda')
    codec = MioCodecModel.from_pretrained(str(runtime / 'codec')).eval().to('cuda')
    sample_rate = int(codec.config.sample_rate)
    clips = []
    with torch.inference_mode():
        for index, line in enumerate(request['lines']):
            prompt_text = line['text'] + (f" <{line['emotion']}>" if line['emotion'] != 'neutral' else '')
            prompt = tokenizer.apply_chat_template([{'role': 'user', 'content': prompt_text}],
                                                    tokenize=False, add_generation_prompt=True)
            inputs = tokenizer(prompt, return_tensors='pt').to('cuda')
            tokens = model.generate(**inputs, max_new_tokens=2048, do_sample=True, temperature=0.9,
                                    top_p=0.9, pad_token_id=tokenizer.eos_token_id)
            generated = tokens[0, inputs['input_ids'].shape[1]:]
            if len(generated) >= 2048:
                raise RuntimeError('Speech reached the length limit; split this line into shorter lines.')
            speech = tokenizer.decode(generated, skip_special_tokens=False)
            codes = [int(n) for n in re.findall(r'<\|s_(\d+)\|>', speech)]
            if not codes:
                raise RuntimeError('No speech tokens generated.')
            embedding = torch.load(runtime / 'presets' / (line['voice'] + '.pt'), map_location='cpu', weights_only=True)
            if isinstance(embedding, dict):
                embedding = embedding.get('global_embedding', embedding.get('embedding'))
            embedding = torch.as_tensor(embedding).squeeze().flatten().to('cuda')
            waveform = codec.decode(global_embedding=embedding,
                                    content_token_indices=torch.tensor(codes, device='cuda', dtype=torch.long))
            clip = waveform.squeeze().float().cpu().numpy()
            if clip.ndim != 1 or not len(clip) or not np.isfinite(clip).all():
                raise RuntimeError('The codec returned invalid audio.')
            if index:
                clips.append(np.zeros(round(request['pause'] * sample_rate), dtype=np.float32))
            clips.append(clip)
    raw = output.with_suffix('.raw.wav')
    try:
        sf.write(raw, np.concatenate(clips), sample_rate, subtype='PCM_16')
        # Pitch and pace are real DSP controls; emotion comes from the model.
        ratio = 2 ** (request['pitch'] / 12)
        filters = f'asetrate={round(sample_rate*ratio)},aresample={sample_rate},atempo={request["speed"]/ratio:.6f}'
        subprocess.run(['ffmpeg', '-nostdin', '-y', '-v', 'error', '-i', str(raw), '-af', filters,
                        '-c:a', 'pcm_s16le', str(output)], check=True, timeout=120)
    finally:
        raw.unlink(missing_ok=True)

if __name__ == '__main__':
    p = argparse.ArgumentParser()
    p.add_argument('--request', required=True, type=Path)
    p.add_argument('--output', required=True, type=Path)
    p.add_argument('--runtime', required=True, type=Path)
    args = p.parse_args()
    from audio_schema import validate
    synthesize(validate(json.loads(args.request.read_text())), args.output, args.runtime)
