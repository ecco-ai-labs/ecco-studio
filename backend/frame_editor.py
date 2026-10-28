"""CPU-only, non-destructive frame edits. Source assets and their audio remain intact.

Edits refer to a deterministic 25 fps conform of the source. Export creates a new
library asset. No inference service or GPU provisioning is used.
"""
import base64
import hashlib
import json
import logging
import math
import re
import shutil
import subprocess
import tempfile
import threading
import time
import wave
from pathlib import Path

FPS = 25
MAX_FRAMES = 3000
_lock = threading.RLock()
_active = set()


def status():
    return {'available': bool(shutil.which('ffmpeg') and shutil.which('ffprobe')),
            'fps': FPS, 'max_seconds': MAX_FRAMES // FPS, 'gpu_required': False,
            'ai_repair_available': False}


def run(command, timeout=300):
    result = subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                            timeout=timeout, check=False)
    if result.returncode:
        raise ValueError('Video processing failed: ' + result.stderr.decode(errors='replace')[-700:])
    return result.stdout


def probe(path):
    return json.loads(run(['ffprobe', '-v', 'error', '-show_streams', '-show_format',
                           '-of', 'json', str(path)], 30))


def frame_ids(values, total):
    if not isinstance(values, list) or len(values) > MAX_FRAMES or any(
            type(n) is not int or not 1 <= n <= total for n in values):
        raise ValueError('Invalid original frame numbers.')
    return sorted(set(values))


def validate(body, env):
    if body.get('fps') != FPS or type(body.get('total')) is not int or not 1 <= body['total'] <= MAX_FRAMES:
        raise env['Problem']('Use the 25 fps review timeline, up to 2 minutes.')
    aid = body.get('asset_id', '')
    asset = env['get'](aid, 'asset')
    if asset.get('deleted') or asset.get('media') != 'video' or asset.get('story_id', env['LEGACY_STORY']) != body.get('story_id'):
        raise env['Problem']('Choose an available video from this story.')
    source = env['asset_path'](asset)
    info = probe(source)
    video = next((s for s in info['streams'] if s['codec_type'] == 'video'), None)
    if not video or video.get('width', 0) > 1920 or video.get('height', 0) > 1920:
        raise env['Problem']('Frame export supports videos up to 1920 pixels on each side.')
    duration = float(video.get('duration') or info['format']['duration'])
    if not math.isfinite(duration) or abs(duration*FPS-body['total']) > 1:
        raise env['Problem']('The source timeline changed. Reopen this video before exporting.', 409)
    try:
        removed = frame_ids(body.get('removed', []), body['total'])
    except ValueError as e:
        raise env['Problem'](str(e))
    if len(removed) == body['total']:
        raise env['Problem']('Keep at least one frame.')
    replacements = body.get('replacements', {})
    if not isinstance(replacements, dict) or len(replacements) > 100:
        raise env['Problem']('Choose no more than 100 replacement frames per export.')
    cleaned = {}
    for key, value in replacements.items():
        if not re.fullmatch(r'[1-9][0-9]*', key) or not 1 <= int(key) <= body['total'] or not isinstance(value, dict):
            raise env['Problem']('Invalid replacement frame.')
        data = value.get('dataUrl', '')
        if not isinstance(data, str) or len(data) > 2800000 or not re.match(r'^data:image/(png|jpeg|webp);base64,', data):
            raise env['Problem']('Invalid replacement image.')
        try:
            raw = base64.b64decode(data.split(',', 1)[1], validate=True)
        except (ValueError, TypeError):
            raise env['Problem']('Invalid replacement image encoding.')
        if not (raw.startswith(b'\x89PNG\r\n\x1a\n') or raw.startswith(b'\xff\xd8\xff') or
                (raw[:4] == b'RIFF' and raw[8:12] == b'WEBP')):
            raise env['Problem']('Replacement must be PNG, JPEG or WebP.')
        cleaned[key] = data
    return asset, source, info, {'fps': FPS, 'total': body['total'], 'removed': removed, 'replacements': cleaned}


def render(source, output, edit, progress=lambda text: None):
    info = probe(source)
    video = next(s for s in info['streams'] if s['codec_type'] == 'video')
    width, height = video['width'], video['height']
    has_audio = any(s['codec_type'] == 'audio' for s in info['streams'])
    keep = [n for n in range(1, edit['total']+1) if n not in set(edit['removed'])]
    if not keep:
        raise ValueError('Keep at least one frame.')
    with tempfile.TemporaryDirectory(prefix='ecco-frames-', dir=str(output.parent)) as temp:
        root = Path(temp)
        original = root/'original'; original.mkdir()
        ordered = root/'ordered'; ordered.mkdir()
        progress('Decoding the original video at 25 fps')
        run(['ffmpeg', '-v', 'error', '-threads', '2', '-i', str(source), '-map', '0:v:0',
             '-an', '-vf', 'fps=25', '-frames:v', str(edit['total']), '-q:v', '2',
             '-threads', '2', str(original/'%06d.jpg')])
        decoded = len(list(original.glob('*.jpg')))
        if decoded != edit['total']:
            raise ValueError('Source frame count differs from the review timeline. Reopen the video.')
        for key, data in edit['replacements'].items():
            raw = root/('replacement-'+key)
            raw.write_bytes(base64.b64decode(data.split(',', 1)[1], validate=True))
            target = original/('%06d.jpg' % int(key))
            run(['ffmpeg', '-v', 'error', '-y', '-threads', '1', '-i', str(raw), '-vf',
                 'scale=%d:%d:force_original_aspect_ratio=decrease,pad=%d:%d:(ow-iw)/2:(oh-ih)/2' % (width,height,width,height),
                 '-frames:v', '1', '-q:v', '2', '-threads', '1', str(target)], 30)
        for index, n in enumerate(keep, 1):
            (ordered/('%06d.jpg' % index)).symlink_to(original/('%06d.jpg' % n))
        args = ['ffmpeg', '-v', 'error', '-y', '-threads', '2', '-framerate', '25', '-i', str(ordered/'%06d.jpg')]
        if has_audio:
            progress('Matching audio to the retained frames')
            audio = root/'original.wav'
            run(['ffmpeg', '-v', 'error', '-i', str(source), '-map', '0:a:0', '-vn', '-ar', '48000', '-ac', '2',
                 '-c:a', 'pcm_s16le', '-t', str(edit['total']/FPS), str(audio)])
            cut = root/'edited.wav'
            with wave.open(str(audio),'rb') as reader, wave.open(str(cut),'wb') as writer:
                writer.setparams(reader.getparams())
                samples = reader.readframes(reader.getnframes())
                bytes_per_frame = 48000//FPS * 2 * 2
                for n in keep:
                    part = samples[(n-1)*bytes_per_frame:n*bytes_per_frame]
                    writer.writeframesraw(part + b'\x00'*(bytes_per_frame-len(part)))
            args += ['-i', str(cut), '-map', '0:v:0', '-map', '1:a:0', '-c:a', 'aac', '-b:a', '128k']
        progress('Encoding the edited MP4')
        # Respect the existing Video Library size cap, including long inputs.
        duration = len(keep)/FPS
        bitrate = min(2200000, int(11000000*8/duration)-160000)
        args += ['-c:v', 'libx264', '-preset', 'fast', '-threads', '2', '-pix_fmt', 'yuv420p',
                 '-vf', 'pad=ceil(iw/2)*2:ceil(ih/2)*2', '-b:v', str(bitrate), '-maxrate', str(bitrate),
                 '-bufsize', str(bitrate*2), '-frames:v', str(len(keep)), '-t', str(duration),
                 '-movflags', '+faststart', str(output)]
        run(args, 600)
    result = probe(output)
    stream = next(s for s in result['streams'] if s['codec_type'] == 'video')
    if int(stream.get('nb_frames', 0)) != len(keep) or abs(float(stream['duration'])-len(keep)/FPS) > .001:
        raise ValueError('Export timing validation failed.')
    if output.stat().st_size > 12000000:
        raise ValueError('Edited video exceeds the Video Library limit.')
    return {'frames':len(keep),'seconds':len(keep)/FPS,'has_audio':has_audio,'width':stream['width'],'height':stream['height']}


def view(job):
    return {k:v for k,v in job.items() if k not in ('edit',)}


def public_record(record):
    return view(record) if record.get('kind') == 'frame_edit_job' else record


def export(body, env):
    if not status()['available']:
        raise env['Problem']('CPU video export is not installed.', 503)
    request_id = body.get('request_id', '')
    if not isinstance(request_id, str) or not re.fullmatch('[a-f0-9]{32}', request_id):
        raise env['Problem']('A valid export request ID is required.')
    digest = hashlib.sha256(json.dumps({k:v for k,v in body.items() if k!='request_id'}, sort_keys=True).encode()).hexdigest()
    with _lock:
        existing = next((r for r in env['records']() if r['id'] == request_id), None)
        if existing:
            if existing.get('kind') != 'frame_edit_job' or existing.get('digest') != digest:
                raise env['Problem']('Export request ID already used.',409)
            if existing['status'] in ('queued','running') and request_id not in _active:
                existing.update(status='failed',error='Export interrupted by service restart. Submit a new export.')
                env['save'](existing)
            return view(existing)
        if _active:
            raise env['Problem']('Another frame export is running. Try again after it finishes.',429)
        asset, source, info, edit = validate(body, env)
        job = env['new']('frame_edit_job', story_id=body['story_id'], asset_id=asset['id'], digest=digest,
                         status='queued', progress='Preparing CPU export', edit=edit)
        job['id'] = request_id
        env['save'](job)
        _active.add(request_id)
        thread = threading.Thread(target=_work,args=(job,asset,source,env),daemon=True)
        thread.start()
        return view(job)


def _work(job, asset, source, env):
    output = None
    try:
        directory = env['DATA']/'frame-edits'; directory.mkdir(parents=True,exist_ok=True)
        output = directory/(job['id']+'.mp4')
        def progress(text):
            job.update(status='running',progress=text);env['save'](job)
        result = render(source,output,job['edit'],progress)
        generated = env['new']('asset',media='video',stage='dev',story_id=job['story_id'],
                    title=(asset.get('title') or 'Video').rsplit('.',1)[0]+' · frame edit.mp4',
                    path=str(output.relative_to(env['DATA'])),source='frame_edit',mode='frame_edit',
                    settings={'model':'CPU frame edit','fps':FPS},source_asset_id=asset['id'],
                    frame_edit={'fps':FPS,'total':job['edit']['total'],'removed':job['edit']['removed'],
                                'replaced':list(job['edit']['replacements'])},sync='pending',**result)
        env['save'](generated)
        job.update(status='done',progress='Edited MP4 saved to Video Library',output_asset_id=generated['id'],finished=time.time())
    except Exception as error:
        logging.exception('Frame export failed')
        job.update(status='failed',error=str(error),progress='Export failed',finished=time.time())
        if output and output.exists(): output.unlink()
    finally:
        env['save'](job)
        with _lock: _active.discard(job['id'])


def handle_get(path, env):
    if path == '/api/frame-editor/status': return status()
    if path.startswith('/api/frame-editor/jobs/'):
        request_id=path.rsplit('/',1)[-1]
        if not re.fullmatch('[a-f0-9]{32}',request_id): raise env['Problem']('Invalid export ID.')
        return view(env['get'](request_id,'frame_edit_job'))
    raise env['Problem']('Unknown frame editor action.',404)
