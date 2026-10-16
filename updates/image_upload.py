"""Validated local image import into Studio. Does not run GPU inference."""
import base64, binascii, io, time, uuid, warnings
from PIL import Image, ImageOps, UnidentifiedImageError
MAX_BYTES = 12 * 1024 * 1024
MAX_PIXELS = 20_000_000

def upload(body, env):
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
