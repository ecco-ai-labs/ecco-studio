"""RunPod Serverless worker for LongCat-Video-Avatar 1.5 talking-head shots.

Reuses run_shot() from video/longcat_jobs.py unchanged.

Job input
  {"image": "<base64 PNG>", "audio": "<base64 audio>", "key": "<job id>",
   "request": {"prompt", "resolution", "seed", "duration"}}
Job output
  {"archive": {...output.mp4...}, "duration": seconds, "sha256": hex}  or  {"error": "..."}
"""
import base64
import json
import sys
import tempfile
from pathlib import Path

import runpod

sys.path.insert(0, str(Path(__file__).resolve().parent))
import longcat_jobs  # noqa: E402
import worker_common  # noqa: E402


def handler(job):
    data = job.get('input') or {}
    request = data.get('request') or {}
    with tempfile.TemporaryDirectory(prefix='longcat-') as temp:
        d = Path(temp)
        try:
            (d / 'image.png').write_bytes(base64.b64decode(data['image'], validate=True))
            (d / 'audio-source').write_bytes(base64.b64decode(data['audio'], validate=True))
            runpod.serverless.progress_update(job, 'Running Generation')
            longcat_jobs.run_shot(d, request)
            result = json.loads((d / 'status.json').read_text())
            archive = worker_common.pack([d / 'output.mp4'], d)
            return {'archive': worker_common.deliver(archive, f'results/{data.get("key", "longcat")}.tar'),
                    'duration': result['duration'], 'sha256': result['sha256']}
        except Exception as exc:
            log = (d / 'worker.log').read_text(errors='replace')[-4000:] if (d / 'worker.log').is_file() else ''
            return {'error': 'LongCat generation failed: ' + longcat_jobs.redact_error(exc)[:1500],
                    'log': longcat_jobs.redact_error(log)}


if __name__ == '__main__':
    runpod.serverless.start({'handler': handler})
