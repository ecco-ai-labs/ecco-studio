"""Local, pinned Chatterbox/IndicF5 inference in isolated model environments."""
import argparse
import copy
import json
from pathlib import Path

from audio_schema import MODELS, validate
from audio_worker import assemble, inference_device


def reference(runtime, voice):
    catalog = {v['id']: v for v in MODELS['indicf5']['voices']}
    item = catalog[voice]
    path = runtime / 'reference-voices' / item['file']
    if not path.is_file():
        raise RuntimeError('This reference voice is not installed.')
    return path


def chatterbox_controls(request, line):
    exaggeration = line.get('exaggeration', request['exaggeration'])
    # Upstream recommends lower guidance for expressive delivery and zero for
    # cross-language reference clips. Never change the user's selected voice.
    cfg = .3 if exaggeration > .5 else .5
    item = next((v for v in MODELS['chatterbox']['voices'] if v['id'] == line['voice']), None)
    if item and item.get('file') and not item['name'].startswith(line['language'] + ' '):
        cfg = 0
    return {'exaggeration': exaggeration, 'cfg_weight': line.get('cfg_weight', cfg)}


def synthesize(request, output, runtime):
    import numpy as np
    import torch
    device = inference_device(request, torch)
    if device == 'cuda':
        torch.set_num_threads(4)
    clips = []
    if request['model'] == 'chatterbox':
        from chatterbox.mtl_tts import ChatterboxMultilingualTTS
        model = ChatterboxMultilingualTTS.from_local(runtime / 'chatterbox', device, t3_model='v3')
        original = copy.deepcopy(model.conds)
        rate = model.sr
        for line in request['lines']:
            # Reset between speakers; the default must never inherit another voice.
            model.conds = copy.deepcopy(original)
            ref = None if line['voice'] == 'default' else str(reference(runtime, line['voice']))
            clip = model.generate(line['text'], language_id=MODELS['chatterbox']['language_codes'][line['language']],
                                  audio_prompt_path=ref, **chatterbox_controls(request, line))
            clips.append(clip.squeeze().float().cpu().numpy())
    elif request['model'] == 'indicf5':
        from safetensors.torch import load_file
        from f5_tts.model import DiT
        from f5_tts.infer.utils_infer import load_model, load_vocoder, infer_process
        model = load_model(DiT, dict(dim=1024, depth=22, heads=16, ff_mult=2, text_dim=512, conv_layers=4),
                           vocab_file=str(runtime / 'indicf5/checkpoints/vocab.txt'), device=device)
        weights = load_file(str(runtime / 'indicf5/model.safetensors'), device='cpu')
        prefix = 'ema_model._orig_mod.'
        model.load_state_dict({k[len(prefix):]: v for k, v in weights.items() if k.startswith(prefix)}, strict=True)
        del weights
        model.eval()
        vocoder = load_vocoder(is_local=True, local_path=str(runtime / 'vocos'), device=device)
        transcripts = json.loads((runtime / 'reference-voices/transcripts.json').read_text())
        rate = 24000
        for line in request['lines']:
            ref = reference(runtime, line['voice'])
            text = transcripts.get(line['voice'], '').strip()
            if not text:
                raise RuntimeError('This reference voice needs a transcript.')
            clip, returned_rate, _ = infer_process(str(ref), text, line['text'], model, vocoder, device=device)
            if returned_rate != rate:
                raise RuntimeError('Unexpected IndicF5 sample rate.')
            clips.append(np.asarray(clip, dtype=np.float32))
    else:
        raise ValueError('Unsupported model for this worker.')
    for clip in clips:
        if clip.ndim != 1 or len(clip) < rate // 10 or not np.isfinite(clip).all() or np.max(np.abs(clip)) < 1e-5:
            raise RuntimeError('The model returned empty or invalid speech.')
    assemble(clips, request, output, rate)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--request', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--runtime', required=True, type=Path)
    args = parser.parse_args()
    synthesize(validate(json.loads(args.request.read_text())), args.output, args.runtime)

