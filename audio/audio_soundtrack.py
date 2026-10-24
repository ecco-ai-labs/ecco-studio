"""Library-backed music/effects. CPU FFmpeg mixing, with measured speech timing."""
import hashlib
import json
import math
from pathlib import Path
import re
import shutil
import subprocess
import wave


def validate_tracks(value, line_count):
    if not isinstance(value, list) or not 1 <= len(value) <= 12:
        raise ValueError('Choose between 1 and 12 sound cues.')
    result = []
    for cue in value:
        if not isinstance(cue, dict) or cue.get('kind') not in ('effect', 'ambience', 'music'):
            raise ValueError('Invalid sound cue type.')
        aid = cue.get('asset_id', '')
        if not isinstance(aid, str) or not re.fullmatch(r'[a-zA-Z0-9_-]{1,80}', aid):
            raise ValueError('Choose an Audio Library file for every cue.')
        start, end = cue.get('start_line'), cue.get('end_line')
        if any(isinstance(x, bool) or not isinstance(x, int) for x in (start, end)) or not 0 <= start <= end < line_count:
            raise ValueError('Invalid sound cue passage range.')
        edge = cue.get('start_edge', 'start')
        if edge not in ('start', 'end') or cue['kind'] != 'effect' and edge == 'end' and start == end:
            raise ValueError('The sound cue must cover a valid speech interval.')
        clean = dict(kind=cue['kind'], asset_id=aid, start_line=start, end_line=end, start_edge=edge,
                     description=str(cue.get('description', ''))[:600])
        for field, default, low, high in [('level_db', -24, -40, -3), ('fade', 1, 0, 5)]:
            number = cue.get(field, default)
            if isinstance(number, bool) or not isinstance(number, (float, int)) or not math.isfinite(number) or not low <= number <= high:
                raise ValueError('Invalid sound cue ' + field + '.')
            clean[field] = number
        for field in ('duck', 'loop'):
            value = cue.get(field, cue['kind'] != 'effect')
            if not isinstance(value, bool):
                raise ValueError('Invalid sound cue ' + field + '.')
            clean[field] = value if field != 'loop' or cue['kind'] != 'effect' else False
        result.append(clean)
    return result


def snapshot_assets(request, directory, env):
    """Copy only authenticated workspace audio records; never accept client paths/URLs."""
    if not request.get('soundtrack'):
        return
    root = env['DATA'].resolve()
    sources = {}
    total = 0
    for cue in request['soundtrack']:
        aid = cue['asset_id']
        if aid in sources:
            continue
        asset = env['get'](aid, 'asset')
        path = root / str(asset.get('path', ''))
        source = path.resolve()
        if (asset.get('kind') != 'asset' or asset.get('media') != 'audio' or asset.get('deleted')
                or not source.is_relative_to(root) or not source.is_file()
                or source.suffix.lower() not in ('.wav', '.mp3', '.m4a', '.ogg', '.flac')):
            raise ValueError('Choose an available audio file outside Trash for every sound cue.')
        size = source.stat().st_size
        total += size
        if not size or total > 64 * 1024 * 1024:
            raise ValueError('Selected sound files must total no more than 64 MB.')
        sources[aid] = source
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    manifest = {}
    for index, (aid, source) in enumerate(sources.items()):
        filename = f'sound-{index}{source.suffix.lower()}'
        target = directory / filename
        shutil.copyfile(source, target)
        target.chmod(0o600)
        manifest[aid] = dict(file=filename, sha256=hashlib.sha256(target.read_bytes()).hexdigest())
    temporary = directory / 'sound-assets.tmp'
    temporary.write_text(json.dumps(manifest))
    temporary.chmod(0o600)
    temporary.replace(directory / 'sound-assets.json')


def duration(path):
    result = subprocess.run(['ffprobe', '-v', 'error', '-protocol_whitelist', 'file,pipe',
                             '-show_entries', 'format=duration', '-of', 'json', str(path)],
                            capture_output=True, text=True, check=True, timeout=20)
    seconds = float(json.loads(result.stdout)['format']['duration'])
    if not math.isfinite(seconds) or seconds <= 0:
        raise ValueError('The selected sound file has no valid duration.')
    return seconds


def mix(request, speech, timeline, destination):
    """Cue positions use post-pitch/speed PCM frame boundaries, never guessed word times."""
    cues = validate_tracks(request['soundtrack'], len(request['lines']))
    with wave.open(str(speech)) as source:
        seconds = source.getnframes() / source.getframerate()
    if len(timeline) != len(request['lines']):
        raise ValueError('Speech timing is incomplete; the soundtrack was not mixed.')
    previous = 0
    for entry in timeline:
        start, end = entry['start'], entry['end']
        if any(not isinstance(v, (int, float)) or not math.isfinite(v) for v in (start, end)) or not previous <= start < end <= seconds + .001:
            raise ValueError('Invalid speech timing; the soundtrack was not mixed.')
        previous = end
    directory = Path(speech).parent
    manifest = json.loads((directory / 'sound-assets.json').read_text())
    command = ['ffmpeg', '-nostdin', '-y', '-v', 'error', '-protocol_whitelist', 'file,pipe', '-i', str(speech)]
    filters = ['[0:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo[speech]']
    duck_count = sum(c['duck'] for c in cues)
    if duck_count:
        filters.append('[speech]asplit=' + str(duck_count + 1) + '[voice]' + ''.join(f'[side{i}]' for i in range(duck_count)))
    else:
        filters.append('[speech]anull[voice]')
    labels = ['[voice]']
    total, side_index = seconds, 0
    for index, cue in enumerate(cues):
        item = manifest.get(cue['asset_id'], {})
        filename = item.get('file', '')
        if not re.fullmatch(r'sound-\d+\.(wav|mp3|m4a|ogg|flac)', filename):
            raise ValueError('The selected sound snapshot is missing.')
        path = directory / filename
        if not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest() != item.get('sha256'):
            raise ValueError('The selected sound snapshot failed verification.')
        source_seconds = duration(path)
        start = timeline[cue['start_line']][cue['start_edge']]
        length = min(source_seconds, 30) if cue['kind'] == 'effect' else timeline[cue['end_line']]['end'] - start
        if not cue['loop']:
            length = min(length, source_seconds)
        if length <= 0:
            raise ValueError('The sound cue has no duration.')
        total = max(total, start + length)
        if cue['loop']:
            command += ['-stream_loop', '-1']
        command += ['-protocol_whitelist', 'file,pipe', '-i', str(path)]
        fade = min(cue['fade'], length / 2)
        chain = f'[{index+1}:a]atrim=duration={length:.6f},asetpts=PTS-STARTPTS,aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,volume={cue["level_db"]}dB'
        if fade:
            chain += f',afade=t=in:d={fade:.6f},afade=t=out:st={length-fade:.6f}:d={fade:.6f}'
        chain += f',adelay={round(start*48000)}S:all=1[cue{index}]'
        filters.append(chain)
        label = f'[cue{index}]'
        if cue['duck']:
            filters.append(f'[side{side_index}]apad=pad_dur=30[duck{side_index}]')
            filters.append(label + f'[duck{side_index}]sidechaincompress=threshold=0.025:ratio=8:attack=25:release=350:makeup=1[mixed{index}]')
            side_index += 1
            label = f'[mixed{index}]'
        labels.append(label)
    filters.append(''.join(labels) + f'amix=inputs={len(labels)}:duration=longest:dropout_transition=0:normalize=0,alimiter=limit=0.95:level=false:latency=true,atrim=duration={total:.6f}[out]')
    command += ['-filter_complex_threads', '1', '-filter_complex', ';'.join(filters), '-map', '[out]', '-ar', '48000', '-ac', '2', '-c:a', 'pcm_s16le', str(destination)]
    subprocess.run(command, check=True, capture_output=True, timeout=180)
