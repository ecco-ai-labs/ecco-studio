"""Audio uploads and labels on the existing GPU-independent storage service."""
import base64
import binascii
import hashlib
import json
import math
import subprocess
import time
import uuid

MAX_BYTES = 12 * 1024 * 1024


def upload(body, env):
    problem = env['Problem']
    encoded = body.get('data')
    if not isinstance(encoded, str) or not encoded or len(encoded) > ((MAX_BYTES + 2) // 3) * 4:
        raise problem('Choose an audio file no larger than 12 MB.', 413)
    try:
        raw = base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError):
        raise problem('Invalid audio upload.')
    if not raw or len(raw) > MAX_BYTES:
        raise problem('Choose an audio file no larger than 12 MB.', 413)
    sid = env['story_id'](body)
    aid = uuid.uuid4().hex
    directory = env['DATA'] / 'audio-prod'
    directory.mkdir(parents=True, exist_ok=True)
    temporary = directory / (aid + '.upload')
    destination = temporary
    try:
        temporary.write_bytes(raw)
        probe = subprocess.run(['ffprobe', '-v', 'error', '-protocol_whitelist', 'file,pipe',
                                '-show_streams', '-show_format', '-of', 'json', str(temporary)],
                               capture_output=True, text=True, timeout=20, check=True)
        info = json.loads(probe.stdout)
        streams = info.get('streams', [])
        audio = next((s for s in streams if s.get('codec_type') == 'audio'), None)
        if not audio or any(s.get('codec_type') == 'video' and not s.get('disposition', {}).get('attached_pic') for s in streams):
            raise problem('Choose an audio file, not a video.')
        formats = set(info.get('format', {}).get('format_name', '').split(','))
        extensions = [('wav', '.wav'), ('mp3', '.mp3'), ('ogg', '.ogg'), ('flac', '.flac'), ('m4a', '.m4a'), ('mp4', '.m4a')]
        extension = next((ext for fmt, ext in extensions if fmt in formats), None)
        seconds = float(info.get('format', {}).get('duration') or audio.get('duration') or 0)
        if not extension or not math.isfinite(seconds) or seconds <= 0:
            raise problem('Choose a valid WAV, MP3, M4A, OGG or FLAC file.')
        destination = directory / (aid + extension)
        temporary.replace(destination)
        name = str(body.get('name') or 'Uploaded audio').replace(chr(92), '/').split('/')[-1][:160]
        return env['save'](dict(id=aid, kind='asset', created=time.time(), media='audio', stage='prod',
                                story_id=sid, path='audio-prod/' + destination.name, title=name,
                                prompt='', source='upload', seconds=seconds, duration=seconds,
                                sync='pending', settings={'model': 'uploaded-audio',
                                'sample_rate': int(audio.get('sample_rate', 0)), 'channels': audio.get('channels')}))
    except Exception as error:
        temporary.unlink(missing_ok=True)
        destination.unlink(missing_ok=True)
        if isinstance(error, problem):
            raise
        raise problem('This audio could not be imported. Choose a valid WAV, MP3, M4A, OGG or FLAC file.')


def create_folder(body, env):
    name = body.get('name', '')
    if not isinstance(name, str) or not 1 <= len(name.strip()) <= 80:
        raise env['Problem']('Label name must contain 1–80 characters.')
    name = name.strip()
    fid = hashlib.sha256(('audio-folder:' + name.casefold()).encode()).hexdigest()[:32]
    with env['LOCK']:
        all_folders = env['records']('audio_folder')
        existing = next((f for f in all_folders if f['name'].casefold() == name.casefold()), None)
        if any(f['id'] == fid for f in all_folders): fid = uuid.uuid4().hex
        if existing:
            return existing
        return env['save'](dict(id=fid, kind='audio_folder', created=time.time(), name=name))


def save_labels(body, env):
    title = body.get('title', '')
    ids = body.get('folder_ids')
    if not isinstance(title, str) or not 1 <= len(title.strip()) <= 160:
        raise env['Problem']('Audio name must contain 1–160 characters.')
    if not isinstance(ids, list) or not ids or len(ids) > 100 or any(not isinstance(fid, str) for fid in ids):
        raise env['Problem']('Choose at least one audio label.')
    with env['LOCK']:
        asset = env['get'](body.get('asset_id', ''), 'asset')
        folders = [env['get'](fid, 'audio_folder') for fid in set(ids)]
        if asset.get('media') != 'audio' or asset.get('deleted') or any(f.get('deleted') for f in folders):
            raise env['Problem']('Choose audio and labels outside Trash.')
        # Validate every label before writing the name or memberships.
        asset['title'] = title.strip()
        env['save'](asset)
        for folder in folders:
            rid = hashlib.sha256(('library-item:' + asset['id'] + ':' + folder['id']).encode()).hexdigest()[:32]
            env['save'](dict(id=rid, kind='library_item', created=time.time(),
                             asset_id=asset['id'], folder_id=folder['id']))
        return asset

