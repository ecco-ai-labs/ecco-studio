"""Character voice references: saved clips that copying models speak with.

A reference is an ordinary audio asset with a `voice_reference` block. It is made
from an uploaded or recorded clip (trimmed, optionally cleaned with FFmpeg, mono,
24 kHz, 3–30 s) or from a designed voice job. Generation requests name clips as
`ref:<asset id>` (or a per-line palette), and the coordinator adds `voice_refs`
with each clip's sha256, transcript and a short-lived signed URL, so the request
is self-contained for a stateless (serverless) worker. On a pod the clip is also
copied into the job folder.
"""
import hashlib
import hmac
import json
import math
import os
import re
import shutil
import subprocess
import sys
import time
import uuid
from pathlib import Path
from urllib.parse import urlencode

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'audio'))
from audio_schema import DESIGN_MODELS, LANGUAGES, MODELS, SLUG

SECRET = ''          # set by storage_api.main from the private access key
LINK_SECONDS = 6 * 3600
MIN_SECONDS, MAX_SECONDS = 3.0, 30.0
RATE = 24000
CLEAN_FILTER = 'highpass=f=80,afftdn=nf=-25,loudnorm=I=-20:TP=-2:LRA=11'
SOURCES = ('upload', 'recording', 'designed', 'catalog')


def _key():
    if len(SECRET) < 32:
        raise RuntimeError('Voice reference signing is not configured.')
    return hmac.new(SECRET.encode(), b'ecco-voice-reference-links-v1', hashlib.sha256).digest()


def signature(asset_id, sha256, expires):
    return hmac.new(_key(), f'{asset_id}:{sha256}:{expires}'.encode(), hashlib.sha256).hexdigest()


def link(asset, now=None):
    expires = int((now or time.time()) + LINK_SECONDS)
    path = '/api/voice-refs/' + asset['id'] + '?' + urlencode({'expires': expires, 'sig': signature(asset['id'], asset['sha256'], expires)})
    base = os.environ.get('ECCO_STORAGE_PUBLIC_URL', '').rstrip('/')
    return {'path': path, 'expires': expires, **({'url': base + path} if base.startswith('https://') else {})}


def verify_link(asset_id, query, env):
    """Signed, unauthenticated read of a voice reference clip for workers. Returns the file path."""
    problem = env['Problem']
    try:
        expires = int(query.get('expires', [''])[0])
        supplied = query.get('sig', [''])[0]
    except (TypeError, ValueError):
        raise problem('Invalid voice link.', 403)
    if not re.fullmatch(r'[0-9a-f]{32}', asset_id or '') or expires < time.time():
        raise problem('This voice link has expired.', 403)
    asset = env['get'](asset_id, 'asset')
    if not asset.get('voice_reference') or asset.get('deleted') or not hmac.compare_digest(supplied, signature(asset_id, asset.get('sha256', ''), expires)):
        raise problem('Invalid voice link.', 403)
    return env['asset_path'](asset)


def _text(body, key, limit, required=False, default=''):
    value = body.get(key, default)
    if not isinstance(value, str) or len(value.strip()) > limit or (required and not value.strip()):
        raise ValueError(key)
    return value.strip()


def _probe(path):
    result = subprocess.run(['ffprobe', '-v', 'error', '-protocol_whitelist', 'file,pipe', '-show_entries',
                             'format=duration:stream=sample_rate,channels', '-of', 'json', str(path)],
                            capture_output=True, text=True, check=True, timeout=20)
    info = json.loads(result.stdout)
    seconds = float(info.get('format', {}).get('duration') or 0)
    stream = (info.get('streams') or [{}])[0]
    return seconds, int(stream.get('sample_rate') or 0), int(stream.get('channels') or 0)


def _render(source, destination, start, length, clean):
    command = ['ffmpeg', '-nostdin', '-y', '-v', 'error', '-ss', f'{start:.3f}', '-t', f'{length:.3f}', '-i', str(source)]
    if clean:
        command += ['-af', CLEAN_FILTER]
    command += ['-ac', '1', '-ar', str(RATE), '-c:a', 'pcm_s16le', str(destination)]
    subprocess.run(command, capture_output=True, check=True, timeout=120)


def _save_reference(env, *, source_asset, story_id, start, end, clean, info):
    """Render the clip and store a new reference asset. `info` is the voice_reference block."""
    problem = env['Problem']
    source = env['asset_path'](source_asset)
    total, _, _ = _probe(source)
    end = total if end is None else end
    if not (0 <= start < end <= total + 0.05):
        raise problem('Choose a part of the clip that is inside the recording.')
    length = end - start
    if not MIN_SECONDS <= length <= MAX_SECONDS:
        raise problem(f'Choose {MIN_SECONDS:g}–{MAX_SECONDS:g} seconds of the recording.')
    rid = uuid.uuid4().hex
    directory = env['DATA'] / 'audio-voices'
    directory.mkdir(parents=True, exist_ok=True)
    destination = directory / (rid + '.wav')
    temporary = directory / (rid + '.tmp.wav')
    try:
        _render(source, temporary, start, length, clean)
        seconds, rate, channels = _probe(temporary)
        if not math.isfinite(seconds) or seconds < MIN_SECONDS - 0.25 or rate != RATE or channels != 1:
            raise problem('The voice clip could not be prepared. Try another part of the recording.')
        temporary.replace(destination)
    except subprocess.SubprocessError:
        temporary.unlink(missing_ok=True)
        raise problem('The voice clip could not be prepared. Try another part of the recording.')
    except Exception:
        temporary.unlink(missing_ok=True)
        raise
    digest = hashlib.sha256(destination.read_bytes()).hexdigest()
    block = {**info, 'trimmed_start': round(start, 3), 'trimmed_end': round(end, 3), 'cleaned': bool(clean),
             'source_asset_id': source_asset['id']}
    return env['save'](dict(id=rid, kind='asset', created=time.time(), media='audio', stage='prod', story_id=story_id,
                            path='audio-voices/' + destination.name, title=info['character'] + ' · ' + info['emotion'],
                            prompt=info.get('transcript', ''), source='voice-reference', seconds=seconds, duration=round(seconds, 2),
                            sha256=digest, sync='pending', voice_reference=block,
                            settings={'model': 'voice-reference', 'sample_rate': RATE, 'channels': 1}))


def _identity(body):
    character = _text(body, 'character', 80, required=True)
    emotion = _text(body, 'emotion', 32, default='default') or 'default'
    if not SLUG.match(emotion):
        raise ValueError('emotion')
    language = _text(body, 'language', 40, default='')
    if language and language not in LANGUAGES:
        raise ValueError('language')
    return dict(character=character, character_id=_text(body, 'character_id', 64), emotion=emotion, language=language,
                transcript=_text(body, 'transcript', 600))


def create(body, env):
    """POST /api/audio/voices/create — a reference from an uploaded/recorded clip."""
    problem = env['Problem']
    try:
        info = _identity(body)
        start = float(body.get('start', 0) or 0)
        end = body.get('end')
        end = None if end in (None, '') else float(end)
        if not math.isfinite(start) or (end is not None and not math.isfinite(end)):
            raise ValueError('range')
    except (TypeError, ValueError) as error:
        raise problem('Invalid voice clip field: ' + str(error))
    source_kind = body.get('source', 'upload')
    if source_kind not in ('upload', 'recording', 'designed'):
        raise problem('Choose an uploaded or recorded clip.')
    with env['LOCK']:
        asset = env['get'](body.get('asset_id', ''), 'asset')
        if asset.get('media') != 'audio' or asset.get('deleted'):
            raise problem('Choose an audio clip outside Trash.')
        generated = asset.get('source') == 'generated'
        if source_kind == 'designed' and not generated:
            raise problem('Only a generated clip can be saved as a designed voice.')
        if source_kind in ('upload', 'recording') and body.get('consent') is not True:
            raise problem('Confirm you have permission to use this person’s voice.')
        info.update(source=source_kind, consent=source_kind == 'designed' or body.get('consent') is True)
        return public(_save_reference(env, source_asset=asset, story_id=env['story_id'](body) if body.get('story_id') else asset.get('story_id'),
                                      start=start, end=end, clean=body.get('clean') is True, info=info))


def references(env, story_id=None, character=None, character_id=None):
    out = []
    for asset in env['records']('asset'):
        ref = asset.get('voice_reference')
        if not ref or asset.get('deleted') or asset.get('media') != 'audio':
            continue
        if story_id and asset.get('story_id') != story_id:
            continue
        if character_id and ref.get('character_id') != character_id:
            continue
        if character and ref.get('character', '').casefold() != character.casefold():
            continue
        out.append(asset)
    return sorted(out, key=lambda a: a.get('created', 0))


def public(asset):
    ref = asset['voice_reference']
    return {'id': asset['id'], 'title': asset.get('title', ''), 'story_id': asset.get('story_id'), 'duration': asset.get('duration'),
            'sha256': asset.get('sha256'), 'created': asset.get('created'), **{k: ref.get(k) for k in (
                'character', 'character_id', 'emotion', 'language', 'transcript', 'source', 'consent', 'cleaned',
                'trimmed_start', 'trimmed_end', 'source_asset_id', 'description')}}


def list_references(body, env):
    """POST /api/audio/voices/list — {story_id?, character?, character_id?}."""
    story = env['story_id'](body) if body.get('story_id') else None
    return {'references': [public(a) for a in references(env, story, body.get('character'), body.get('character_id'))]}


def update(body, env):
    """POST /api/audio/voices/update — change transcript, emotion or character name."""
    problem = env['Problem']
    with env['LOCK']:
        asset = env['get'](body.get('asset_id', ''), 'asset')
        ref = asset.get('voice_reference')
        if not ref or asset.get('deleted'):
            raise problem('Choose a saved character voice.')
        try:
            for key, limit in (('transcript', 600), ('character', 80), ('character_id', 64), ('emotion', 32)):
                if key in body:
                    value = _text(body, key, limit, required=key in ('character', 'emotion'))
                    if key == 'emotion' and not SLUG.match(value):
                        raise ValueError(key)
                    ref[key] = value
        except ValueError as error:
            raise problem('Invalid voice clip field: ' + str(error))
        asset['title'] = ref['character'] + ' · ' + ref['emotion']
        asset['prompt'] = ref.get('transcript', '')
        return public(env['save'](asset))


def design_request(body, env):
    """Build the audio job for a designed voice. The job's clip becomes a reference when it finishes."""
    problem = env['Problem']
    model = body.get('model', '')
    if model not in DESIGN_MODELS:
        raise problem('Choose VoxCPM2 (English and other languages) or Indic Parler-TTS (Indian languages) to design a voice.')
    try:
        info = _identity({**body, 'transcript': body.get('text', '')})
        description = _text(body, 'description', 1200, required=True)
    except ValueError as error:
        raise problem('Invalid voice design field: ' + str(error))
    if not info['transcript']:
        raise problem('Add a sample sentence for the new voice to say.')
    language = info['language'] or 'English'
    catalog = MODELS[model]
    if language not in catalog['languages']:
        raise problem(catalog['name'] + ' does not speak ' + language + '.')
    voices = [v for v in catalog['voices'] if not v.get('language') or v['language'] == language]
    request = {'model': model, 'compute': body.get('compute', 'b200'), 'title': info['character'] + ' · ' + info['emotion'] + ' (designed voice)',
               'lines': [{'text': info['transcript'], 'language': language, 'voice': voices[0]['id'] if voices else '', 'direction': description, 'design': True}],
               'voice_design': {**{k: info[k] for k in ('character', 'character_id', 'emotion', 'transcript')}, 'language': language, 'description': description}}
    for key in ('worker_id', 'story_id'):
        if body.get(key):
            request[key] = body[key]
    return request


def design(body, env, generate):
    """POST /api/audio/voices/design — queue a designed voice; returns the audio job."""
    return generate(design_request(body, env), env)


def from_design(job, asset, env):
    """When a designed-voice job finishes, save its clip as the character's reference."""
    design = job['request'].get('voice_design')
    if not design or job.get('voice_reference_id'):
        return None
    seconds = float(asset.get('seconds') or 0)
    info = {**design, 'source': 'designed', 'consent': True}
    ref = _save_reference(env, source_asset=asset, story_id=job.get('story_id'), start=0, end=min(seconds, MAX_SECONDS),
                          clean=False, info=info)
    return ref


def attach(request, env, now=None):
    """Add `voice_refs` for every `ref:` voice: checksum, transcript and a signed link. No files are copied here."""
    ids = sorted({line['voice'][4:] for line in request['lines'] if line['voice'].startswith('ref:')})
    if not ids:
        return request
    refs = {}
    for rid in ids:
        try:
            asset = env['get'](rid, 'asset')
        except Exception:
            raise env['Problem']('A character voice is no longer available. Choose or create the voice again.')
        block = asset.get('voice_reference')
        if not block or asset.get('deleted') or asset.get('media') != 'audio' or not asset.get('sha256'):
            raise env['Problem']('A character voice is no longer available. Choose or create the voice again.')
        users = [line for line in request['lines'] if line['voice'] == 'ref:' + rid]
        if any(line.get('model', request['model']) == 'indicf5' for line in users) and not block.get('transcript'):
            raise env['Problem']('Type what the “' + asset.get('title', 'character') + '” clip says before using it with IndicF5.')
        refs[rid] = {'sha256': asset['sha256'], 'transcript': block.get('transcript', ''), 'language': block.get('language', ''),
                     'emotion': block.get('emotion', 'default'), 'character': block.get('character', ''), **link(asset, now)}
    return {**request, 'voice_refs': refs}


def copy_into(request, directory, env):
    """Pod path: copy each referenced clip next to the job so a long-lived worker needs no download."""
    for rid, item in (request.get('voice_refs') or {}).items():
        asset = env['get'](rid, 'asset')
        source = env['asset_path'](asset)
        if hashlib.sha256(source.read_bytes()).hexdigest() != item['sha256']:
            raise env['Problem']('A character voice clip changed. Choose the voice again.')
        directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        target = directory / ('voice-ref-' + rid + '.wav')
        shutil.copyfile(source, target)
        target.chmod(0o600)


def stable(request):
    """The request without short-lived link fields, for idempotency comparisons."""
    if not request.get('voice_refs'):
        return request
    return {**request, 'voice_refs': {k: {f: v for f, v in item.items() if f not in ('path', 'url', 'expires')}
                                      for k, item in request['voice_refs'].items()}}
