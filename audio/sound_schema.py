"""Sound requests are separate from speech: descriptions never enter narration."""
import math
import secrets

MODELS = {
    'moss-soundeffect-v2': {'name': 'MOSS SoundEffect v2', 'kinds': ('effect', 'ambience'), 'minimum': 1, 'maximum': 30},
    'ace-step-1.5': {'name': 'ACE-Step 1.5', 'kinds': ('music',), 'minimum': 10, 'maximum': 60},
}

def validate(body):
    if not isinstance(body, dict):
        raise ValueError('Provide a sound description.')
    kind = body.get('kind')
    model = body.get('model', 'ace-step-1.5' if kind == 'music' else 'moss-soundeffect-v2')
    if model not in MODELS or kind not in MODELS[model]['kinds']:
        raise ValueError('Choose a supported model for this sound type.')
    description = body.get('description', '')
    if not isinstance(description, str) or not 1 <= len(description.strip()) <= 500:
        raise ValueError('Describe the sound in 1–500 characters.')
    duration = body.get('duration', 20 if kind == 'music' else 5)
    if isinstance(duration, bool) or not isinstance(duration, (int, float)) or not math.isfinite(duration) or not MODELS[model]['minimum'] <= duration <= MODELS[model]['maximum']:
        raise ValueError('Choose a duration within the sound model limits.')
    compute = body.get('compute', 'cpu')
    if compute not in ('cpu', 'a100', 'b200'):
        raise ValueError('Choose CPU, A100 or B200.')
    seed = body.get('seed')
    if seed is None:
        seed = secrets.randbelow(2**31)
    if isinstance(seed, bool) or not isinstance(seed, int) or not 0 <= seed < 2**31:
        raise ValueError('Seed must be an integer from 0 to 2147483647.')
    title = body.get('title') or description.strip()[:100]
    if not isinstance(title, str) or len(title) > 160:
        raise ValueError('Sound title must be at most 160 characters.')
    return dict(task='sound', sound_generation_version=1, kind=kind, model=model,
                description=description.strip(), duration=float(duration), compute=compute,
                seed=seed, title=title.strip(), instrumental=kind == 'music')
