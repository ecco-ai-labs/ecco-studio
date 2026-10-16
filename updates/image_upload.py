"""Validated local image import into Studio. Does not run GPU inference."""
import base64, binascii, io, time, uuid, warnings
from PIL import Image, ImageOps, UnidentifiedImageError
MAX_BYTES = 12 * 1024 * 1024
MAX_PIXELS = 20_000_000

def upload(body, env):
    if body.get('media') == 'video':
        return upload_video(body, env)
    Problem = env['Problem']
    encoded = body.get('data')
    if not isinstance(encoded, str) or not encoded or len(encoded) > ((MAX_BYTES + 2) // 3) * 4:
        raise Problem('Choose a PNG, JPEG or WebP image no larger than 12 MB', 413)
    try:
        raw = base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError):
        raise Problem('Invalid image upload')
    if len(raw) > MAX_BYTES:
        raise Problem('Image exceeds the 12 MB limit', 413)
    try:
        with warnings.catch_warnings():
            warnings.simplefilter('error', Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(raw)) as source:
                if source.format not in ('PNG', 'JPEG', 'WEBP'):
                    raise Problem('Choose a PNG, JPEG or WebP image')
                if getattr(source, 'n_frames', 1) != 1:
                    raise Problem('Choose a still image, not an animation')
                if source.width * source.height > MAX_PIXELS:
                    raise Problem('Choose an image up to 20 megapixels', 413)
                image = ImageOps.exif_transpose(source).convert('RGBA')
                image.load()
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError, Image.DecompressionBombWarning):
        raise Problem('This image cannot be read or is too large')
    sid = env['story_id'](body)
    aid = uuid.uuid4().hex
    rel = f'image-dev/{aid}.png'
    destination = env['DATA'] / rel
    destination.parent.mkdir(parents=True, exist_ok=True)
    # Filename is display metadata only; never a destination path.
    name = str(body.get('name') or 'Uploaded image').replace('\\', '/').split('/')[-1][:160]
    image.save(destination, 'PNG')
    record = dict(id=aid, kind='asset', created=time.time(), media='image', stage='dev',
                  story_id=sid, path=rel, title=name, prompt=name,
                  settings={'model':'uploaded-image', 'width':image.width, 'height':image.height, 'steps':0},
                  source='upload', sync='pending')
    try:
        return env['save'](record)
    except Exception:
        destination.unlink(missing_ok=True)
        raise

def upload_video(body, env):
    import json, subprocess
    Problem = env['Problem']
    if body.get('reviewed') is not True:
        raise Problem('Review the video before adding it to Video Library')
    encoded = body.get('data')
    if not isinstance(encoded, str) or not encoded or len(encoded) > ((MAX_BYTES + 2) // 3) * 4:
        raise Problem('Choose an MP4 or WebM video no larger than 12 MB', 413)
    try:
        raw = base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError):
        raise Problem('Invalid video upload')
    if len(raw) > MAX_BYTES:
        raise Problem('Video exceeds the 12 MB limit', 413)
    sid = env['story_id'](body)
    aid = uuid.uuid4().hex
    directory = env['DATA'] / 'video-prod'
    directory.mkdir(parents=True, exist_ok=True)
    temporary = directory / (aid + '.upload')
    destination = temporary
    try:
        temporary.write_bytes(raw)
        result = subprocess.run(['ffprobe', '-v', 'error', '-show_streams', '-show_format', '-of', 'json', str(temporary)],
                                capture_output=True, text=True, timeout=20, check=True)
        info = json.loads(result.stdout)
        stream = next((s for s in info.get('streams', []) if s.get('codec_type') == 'video'), None)
        formats = info.get('format', {}).get('format_name', '').split(',')
        if not stream or not (set(formats) & {'mp4', 'mov', 'webm'}):
            raise Problem('Choose a valid MP4 or WebM video')
        if stream.get('codec_name') not in ('h264', 'hevc', 'vp8', 'vp9', 'av1'):
            raise Problem('Unsupported video codec')
        seconds = float(info.get('format', {}).get('duration', 0))
        if not 0 < seconds <= 3600:
            raise Problem('Choose a video between 0 and 60 minutes')
        extension = '.mp4' if 'mp4' in formats or 'mov' in formats else '.webm'
        destination = directory / (aid + extension)
        temporary.replace(destination)
        name = str(body.get('name') or 'Uploaded video').replace(chr(92), '/').split('/')[-1][:160]
        record = dict(id=aid, kind='asset', created=time.time(), media='video', stage='prod', story_id=sid,
                      path='video-prod/' + destination.name, title=name, prompt=name, source='upload',
                      seconds=seconds, sync='pending', settings={'model':'uploaded-video','width':stream.get('width'), 'height':stream.get('height')})
        return env['save'](record)
    except Problem:
        temporary.unlink(missing_ok=True)
        destination.unlink(missing_ok=True)
        raise
    except Exception:
        temporary.unlink(missing_ok=True)
        destination.unlink(missing_ok=True)
        raise Problem('This video could not be imported. Choose a valid MP4 or WebM video.')
