"""Local, pinned Chatterbox/IndicF5 inference in isolated model environments."""
import argparse
import copy
import json
from pathlib import Path

from audio_schema import MODELS, validate
from audio_worker import assemble, inference_device, speech_progress
from voice_refs import fetch as fetch_voice_ref, ref_id


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
    if ref_id(line['voice']):
        # A saved character clip: keep its accent unless the clip's language differs from the line.
        item = (request.get('voice_refs') or {}).get(ref_id(line['voice']), {})
        cfg = cfg if item.get('language', line['language']) == line['language'] else 0
        return {'exaggeration': exaggeration, 'cfg_weight': line.get('cfg_weight', cfg)}
    item = next((v for v in MODELS['chatterbox']['voices'] if v['id'] == line['voice']), None)
    if item and item.get('file') and not item['name'].startswith(line['language'] + ' '):
        cfg = 0
    return {'exaggeration': exaggeration, 'cfg_weight': line.get('cfg_weight', cfg)}


HINDI_PACK = ('t3_hi.safetensors', 's3gen_v3.pt', 'grapheme_mtl_merged_expanded_v1.json')


def hindi_pack(runtime):
    """The Chatterbox Multilingual V3 Hindi finetune (ResembleAI/Chatterbox-Multilingual-hi), when installed."""
    folder = runtime / 'chatterbox' / 'hi'
    return folder if all((folder / name).is_file() for name in HINDI_PACK) else None


# Buffers the model computes itself at construction; the finetune's s3gen_v3.pt does not store them.
S3GEN_COMPUTED = {'tokenizer._mel_filters', 'tokenizer.window'}


def load_hindi(runtime, device, output):
    """The Hindi finetune ships its own T3, S3Gen weights and tokenizer; the voice encoder and default voice
    come from the base checkpoint. Load a link checkpoint (base S3Gen), then swap in the finetune's S3Gen
    weights, allowing only the computed buffers to be absent."""
    import torch
    from chatterbox.mtl_tts import ChatterboxMultilingualTTS
    base, hindi = runtime / 'chatterbox', hindi_pack(runtime)
    folder = output.parent / 'chatterbox-hi-checkpoint'
    folder.mkdir(exist_ok=True)
    links = {'ve.pt': base / 've.pt', 'conds.pt': base / 'conds.pt', 'Cangjie5_TC.json': base / 'Cangjie5_TC.json',
             's3gen.pt': base / 's3gen.pt', 'grapheme_mtl_merged_expanded_v1.json': hindi / 'grapheme_mtl_merged_expanded_v1.json',
             't3_hi.safetensors': hindi / 't3_hi.safetensors'}
    for name, target in links.items():
        if target.exists() and not (folder / name).exists():
            (folder / name).symlink_to(target)
    model = ChatterboxMultilingualTTS.from_local(folder, device, t3_model='t3_hi.safetensors')
    state = torch.load(hindi / 's3gen_v3.pt', map_location='cpu' if device in ('cpu', 'mps') else None, weights_only=True)
    result = model.s3gen.load_state_dict(state, strict=False)
    if result.unexpected_keys or set(result.missing_keys) - S3GEN_COMPUTED:
        raise RuntimeError('The Hindi Chatterbox decoder does not match this Chatterbox version.')
    model.s3gen.to(device).eval()
    return model


def synthesize(request, output, runtime):
    import numpy as np
    import torch
    device = inference_device(request, torch)
    if device == 'cuda':
        torch.set_num_threads(4)
    clips = []
    speech_progress(output, 0, len(request['lines']))
    if request['model'] == 'chatterbox':
        from chatterbox.mtl_tts import ChatterboxMultilingualTTS
        lines = request['lines']
        use_hindi = hindi_pack(runtime) is not None and any(line['language'] == 'Hindi' for line in lines)
        models = {}
        if not use_hindi or any(line['language'] != 'Hindi' for line in lines):
            models['base'] = ChatterboxMultilingualTTS.from_local(runtime / 'chatterbox', device, t3_model='v3')
        if use_hindi:
            models['hi'] = load_hindi(runtime, device, output)
        originals = {key: copy.deepcopy(m.conds) for key, m in models.items()}
        rate = next(iter(models.values())).sr
        for index, line in enumerate(lines):
            key = 'hi' if use_hindi and line['language'] == 'Hindi' else 'base'
            model = models[key]
            # Reset between speakers; the default must never inherit another voice.
            model.conds = copy.deepcopy(originals[key])
            if ref_id(line['voice']):
                ref = str(fetch_voice_ref(request, line['voice'], output)[0])
            else:
                ref = None if line['voice'] == 'default' else str(reference(runtime, line['voice']))
            clip = model.generate(line['text'], language_id=MODELS['chatterbox']['language_codes'][line['language']],
                                  audio_prompt_path=ref, **chatterbox_controls(request, line))
            clips.append(clip.squeeze().float().cpu().numpy())
            speech_progress(output, index + 1, len(request['lines']))
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
        for index, line in enumerate(request['lines']):
            if ref_id(line['voice']):
                ref, item = fetch_voice_ref(request, line['voice'], output)
                text = item.get('transcript', '').strip()
            else:
                ref = reference(runtime, line['voice'])
                text = transcripts.get(line['voice'], '').strip()
            if not text:
                raise RuntimeError('This reference voice needs a transcript.')
            clip, returned_rate, _ = infer_process(str(ref), text, line['text'], model, vocoder, device=device)
            if returned_rate != rate:
                raise RuntimeError('Unexpected IndicF5 sample rate.')
            clips.append(np.asarray(clip, dtype=np.float32))
            speech_progress(output, index + 1, len(request['lines']))
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

