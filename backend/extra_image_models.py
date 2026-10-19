"""Additional image backends, sharing Studio validation, jobs and asset storage."""
import json
import os
import subprocess
import time
import uuid
from pathlib import Path

RUNTIME = Path('/workspace/ecco-image-runtime')
PYTHON = RUNTIME / 'venv/bin/python'

def ready():
    return (RUNTIME / 'zimage-verified.json').is_file() and PYTHON.is_file() and Path('/workspace/ecco-models/z-image/model_index.json').is_file()

def create(body, g):
    problem = g['Problem']
    if body.get('model') == 'trellis-2':
        raise problem('TRELLIS.2 requires authorized Hugging Face access to facebook/dinov3-vitl16-pretrain-lvd1689m. Its image-to-3D runtime has not passed verification.', 503)
    if not ready():
        raise problem('Z-Image runtime is not ready on this GPU.', 503)
    if body.get('source_asset_id') or body.get('asset_ids'):
        raise problem('Z-Image creates new images from text. Select Qwen Image Edit to edit a reference image.')
    sid = g['story_id'](body)
    body = __import__('image_library').prepare_image(body, g)
    width, height = g['resolution'](body.get('resolution', '1024x1024'), ('1024x1024', '1280x720', '720x1280'))
    p = {'model': 'z-image', 'prompt': g['text'](body.get('prompt')), 'negative': str(body.get('negative', ''))[:2000],
         'width': width, 'height': height, 'resolution': f'{width}x{height}',
         'steps': g['number'](body.get('steps', 50), 5, 60, True),
         'cfg': g['number'](body.get('cfg', 4), 1, 15),
         'seed': g['number'](body.get('seed', 42), 0, 2**53-1, True),
         'image_style': body['image_style'], 'source_prompt': body['source_prompt']}
    def generate(jid):
        aid = uuid.uuid4().hex
        work = g['DATA'] / 'work' / jid
        work.mkdir(parents=True, exist_ok=True)
        output = g['DATA'] / 'image-dev' / (aid + '.png')
        progress = work / 'progress.json'
        request = work / 'request.json'
        request.write_text(json.dumps({**p, 'output_file': str(output), 'progress_file': str(progress)}))
        # Free idle Comfy models without cancelling any queued/running work.
        queue = g['request'](g['COMFY'] + '/queue')
        if queue.get('queue_running') or queue.get('queue_pending'):
            raise problem('ComfyUI is busy. Retry Z-Image when the current GPU work finishes.', 409)
        g['request'](g['COMFY'] + '/free', {'unload_models': True, 'free_memory': True})
        with (work / 'inference.log').open('w') as log:
            process = subprocess.Popen([str(PYTHON), str(RUNTIME / 'zimage_worker.py'), str(request)], stdout=log, stderr=subprocess.STDOUT, env={**os.environ, 'TOKENIZERS_PARALLELISM': 'false'})
            started = time.monotonic()
            last = None
            while process.poll() is None:
                job = g['get'](jid, 'job')
                if job.get('cancel_requested') or time.monotonic() - started > 1800:
                    process.terminate()
                    try: process.wait(timeout=15)
                    except subprocess.TimeoutExpired: process.kill(); process.wait()
                    raise problem('Z-Image generation cancelled or timed out.')
                try:
                    message = json.loads(progress.read_text())['progress']
                    if message != last: g['job_update'](jid, progress=message); last = message
                except (OSError, ValueError, KeyError): pass
                time.sleep(0.5)
        if process.returncode or not output.is_file():
            raise problem('Z-Image inference failed. Details are saved with this job in work/' + jid + '/inference.log', 500)
        return g['save'](dict(id=aid, kind='asset', created=time.time(), media='image', stage='dev', story_id=sid,
                              path=str(output.relative_to(g['DATA'])), prompt=p['prompt'], settings=p, job_id=jid, sync='pending'))['id']
    return g['launch']('Generate Z-Image 6B image', generate, {'model': 'z-image', 'story_id': sid})
