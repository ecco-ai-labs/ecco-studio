"""On-demand Indic-Mio inference. All paths are explicitly supplied temporary worker files."""
import argparse
import json
import os
import re
import subprocess
from pathlib import Path
import tempfile

def inference_device(request, torch):
    if request.get('compute') == 'cpu':
        torch.set_num_threads(max(1, min(4, int(os.getenv('ECCO_AUDIO_CPU_THREADS', '1')))))
        return 'cpu'
    if not torch.cuda.is_available():
        raise RuntimeError('The selected GPU is not available on this audio worker.')
    return 'cuda'

def assemble(clips, request, output, sample_rate):
    """Apply delivery DSP to speech first; insert exact silence in the final sample rate."""
    import numpy as np
    import soundfile as sf
    ratio = 2 ** (request['pitch'] / 12)
    filters = f'asetrate={round(sample_rate*ratio)},aresample={sample_rate},atempo={request["speed"]/ratio:.6f}'
    final = []
    with tempfile.TemporaryDirectory(prefix='ecco-speech-') as directory:
        for index, clip in enumerate(clips):
            raw, processed = Path(directory)/'raw.wav', Path(directory)/'processed.wav'
            sf.write(raw, clip, sample_rate, subtype='PCM_16')
            subprocess.run(['ffmpeg', '-nostdin', '-y', '-v', 'error', '-i', str(raw), '-af', filters,
                            '-c:a', 'pcm_s16le', str(processed)], check=True, timeout=120)
            spoken, rate = sf.read(processed, dtype='float32')
            if rate != sample_rate: raise RuntimeError('Unexpected output sample rate.')
            if index:
                pause = request['lines'][index].get('pause_before', request['pause'])
                final.append(np.zeros(round(pause * sample_rate), dtype=np.float32))
            final.append(spoken)
        sf.write(output, np.concatenate(final), sample_rate, subtype='PCM_16')

def synthesize(request, output, runtime):
    import numpy as np
    import soundfile as sf
    import torch
    from transformers import AutoModelForCausalLM, AutoTokenizer
    from miocodec import MioCodecModel

    device = inference_device(request, torch)
    tokenizer = AutoTokenizer.from_pretrained(runtime / 'model', local_files_only=True)
    model = AutoModelForCausalLM.from_pretrained(runtime / 'model', local_files_only=True,
                                                torch_dtype=torch.float32 if device == 'cpu' else torch.bfloat16,
                                                low_cpu_mem_usage=True).eval().to(device)
    codec = MioCodecModel.from_pretrained(config_path=str(runtime / 'codec' / 'config.yaml'), weights_path=str(runtime / 'codec' / 'model.safetensors')).eval().to(device)
    sample_rate = int(codec.config.sample_rate)
    clips = []
    with torch.inference_mode():
        for index, line in enumerate(request['lines']):
            prompt_text = line['text'] + (f" <{line['emotion']}>" if line['emotion'] != 'neutral' else '')
            prompt = tokenizer.apply_chat_template([{'role': 'user', 'content': prompt_text}],
                                                    tokenize=False, add_generation_prompt=True)
            inputs = tokenizer(prompt, return_tensors='pt').to(device)
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
            embedding = torch.as_tensor(embedding).squeeze().flatten().to(device)
            waveform = codec.decode(global_embedding=embedding,
                                    content_token_indices=torch.tensor(codes, device=device, dtype=torch.long))
            clip = waveform.squeeze().float().cpu().numpy()
            if clip.ndim != 1 or not len(clip) or not np.isfinite(clip).all():
                raise RuntimeError('The codec returned invalid audio.')
            clips.append(clip)
    assemble(clips, request, output, sample_rate)

if __name__ == '__main__':
    p = argparse.ArgumentParser()
    p.add_argument('--request', required=True, type=Path)
    p.add_argument('--output', required=True, type=Path)
    p.add_argument('--runtime', required=True, type=Path)
    args = p.parse_args()
    from audio_schema import validate
    synthesize(validate(json.loads(args.request.read_text())), args.output, args.runtime)


