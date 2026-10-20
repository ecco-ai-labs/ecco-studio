"""Read-only progress projection; never changes or interrupts inference jobs."""
from pathlib import Path
import re
import time

QUEUE = Path('/workspace/ecco-video/longcat/queue')
ANSI = re.compile(r'\x1b\[[0-9;]*[A-Za-z]')


def parse_progress(text):
    text = ANSI.sub('', text)
    segment = None
    detail = None
    for line in re.split(r'[\r\n]', text):
        m = re.search(r'Generating segment (\d+)/(\d+)', line)
        if m:
            segment = f'Segment {m[1]}/{m[2]}'
            detail = None
        m = re.search(r'(Loading checkpoint shards|Denoising):\s*\d+%\|[^\r\n]*?\|\s*(\d+)/(\d+)', line)
        if m:
            current, total = int(m[2]), int(m[3])
            if not total or current > total:
                continue
            if m[1] == 'Loading checkpoint shards':
                detail = f'Loading model: {current}/{total} shards ({round(current/total*100)}%)'
            else:
                detail = f'Generating: step {current}/{total}'
        elif 'frame=' in line or '[libx264' in line:
            detail = 'Encoding video'
    return ' · '.join(x for x in (segment, detail) if x)


def enrich(records, queue=QUEUE, now=None):
    """Return copies; terminal jobs and stored records are never modified."""
    now = time.time() if now is None else now
    result = [dict(r) for r in records]
    by_id = {r['id']: r for r in result}
    for job in result:
        if job.get('kind') != 'longcat_job' or job.get('status') != 'running':
            continue
        if not re.fullmatch(r'[a-f0-9]{32}', job.get('id', '')):
            continue
        try:
            path = queue / job['id'] / 'worker.log'
            with path.open('rb') as stream:
                stream.seek(0, 2)
                stream.seek(max(0, stream.tell()-65536))
                detail = parse_progress(stream.read().decode('utf-8', errors='replace'))
            if detail:
                age = max(0, int(now-path.stat().st_mtime))
                job['progress'] = detail + (f' · Last progress {age//60}m ago' if age >= 120 else '')
                job['progress_updated_at'] = path.stat().st_mtime
        except OSError:
            pass
    for job in result:
        if job.get('kind') != 'audio_video_job' or job.get('status') != 'running':
            continue
        children = job.get('children') or []
        child = by_id.get(children[-1]) if children else None
        if not child or child.get('status') not in ('queued', 'running'):
            continue
        total = len(job.get('request', {}).get('clips', []))
        prefix = f'Rendering clip {len(children)} of {total}' if total else job.get('progress', 'Rendering clip')
        detail = child.get('progress', '')
        job['progress'] = prefix + (' · '+detail if detail else '')
        if job.get('stop_requested'):
            job['progress'] += ' · Stopping after this clip'
        elif job.get('pause_requested'):
            job['progress'] += ' · Pausing after this clip'
    return result
