"""Bounded frame sampling of private library videos for AI production direction."""
import base64
import json
import math
import subprocess


def content(ids, env, error):
    if not isinstance(ids, list) or len(ids) > 3 or any(not isinstance(i, str) for i in ids):
        raise error('Choose up to three reference videos.')
    result = []
    for rid in dict.fromkeys(ids):
        asset = env['get'](rid, 'asset')
        if asset.get('deleted') or asset.get('media') != 'video':
            raise error('A selected reference video is unavailable.')
        path = str(env['asset_path'](asset))
        try:
            probe = subprocess.run(['ffprobe', '-v', 'error', '-show_format', '-of', 'json', path],
                                   capture_output=True, check=True, timeout=15)
            duration = float(json.loads(probe.stdout)['format']['duration'])
            if not math.isfinite(duration) or duration <= 0:
                raise ValueError('Invalid video duration')
            result.append({'type': 'input_text', 'text':
                'Style reference video: '+str(asset.get('title', rid))+
                '. These are ordered sampled frames, not an exact motion trajectory. '
                'Use composition, lighting, framing and observable action for direction; '
                'retain the selected avatar identity. Do not copy the reference person or invent unseen motion.'})
            for fraction in (.05, .35, .65, .9):
                at = duration*fraction
                frame = subprocess.run(['ffmpeg', '-v', 'error', '-ss', str(at), '-i', path,
                    '-frames:v', '1', '-vf', 'scale=640:640:force_original_aspect_ratio=decrease',
                    '-f', 'image2pipe', '-vcodec', 'mjpeg', 'pipe:1'],
                    capture_output=True, check=True, timeout=30)
                if not frame.stdout or len(frame.stdout) > 3000000:
                    raise ValueError('Frame unavailable')
                result.extend([{'type': 'input_text', 'text': 'Frame at %.2f seconds' % at},
                    {'type': 'input_image', 'image_url': 'data:image/jpeg;base64,'+
                     base64.b64encode(frame.stdout).decode(), 'detail': 'auto'}])
        except (subprocess.SubprocessError, OSError, ValueError, KeyError):
            raise error('Could not inspect the reference video. Your script has not changed.', 422) from None
    return result
