"""RunPod Serverless worker: runs Studio's ComfyUI workflows (and Z-Image) on demand.

Job input
  {"mode": "comfy", "workflow": {...ComfyUI API graph...},
   "files": [{"name": "ecco-edit-x.png", "data": "<base64>"}], "key": "<job id>"}
  {"mode": "zimage", "params": {"prompt", "negative", "width", "height", "steps", "cfg", "seed"}, "key": ...}
Job output
  {"archive": {"url"|"inline": ...}, "outputs": [{"filename", "subfolder"}]}  or  {"error": "..."}
"""
import json
import os
import shutil
import subprocess
import sys
import time
import urllib.request
import uuid
from pathlib import Path

import runpod

sys.path.insert(0, str(Path(__file__).resolve().parent))
import worker_common  # noqa: E402

COMFY_DIR = Path(os.getenv('COMFY_DIR', '/comfyui'))
COMFY = 'http://127.0.0.1:8188'
ZIMAGE_DIR = Path(os.getenv('ZIMAGE_DIR', '/runpod-volume/ecco-models/z-image'))
_zimage = None


def request(path, payload=None, timeout=30):
    data = None if payload is None else json.dumps(payload).encode()
    req = urllib.request.Request(COMFY + path, data=data, headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=timeout) as response:
        body = response.read()
        return json.loads(body) if body else {}


def start_comfy():
    log = open('/tmp/comfyui.log', 'a')
    subprocess.Popen([sys.executable, str(COMFY_DIR / 'main.py'), '--listen', '127.0.0.1', '--port', '8188',
                      '--disable-auto-launch', '--disable-metadata'], cwd=COMFY_DIR, stdout=log, stderr=subprocess.STDOUT)
    deadline = time.monotonic() + 600
    while time.monotonic() < deadline:
        try:
            request('/system_stats', timeout=5)
            return
        except Exception:
            time.sleep(1)
    raise RuntimeError('ComfyUI did not start. See /tmp/comfyui.log in the worker.')


def tail_log():
    try:
        return Path('/tmp/comfyui.log').read_text(errors='replace')[-3000:]
    except OSError:
        return ''


def reset():
    """Drop anything left from a cancelled job before starting a new one."""
    try:
        request('/queue', {'clear': True})
        request('/interrupt', {})
    except Exception:
        pass
    for folder in (COMFY_DIR / 'input', COMFY_DIR / 'output'):
        shutil.rmtree(folder, ignore_errors=True)
        folder.mkdir(parents=True, exist_ok=True)


def run_comfy(job, data):
    workflow = data.get('workflow')
    if not isinstance(workflow, dict) or not workflow:
        return {'error': 'Missing ComfyUI workflow.'}
    worker_common.write_inputs(data.get('files'), COMFY_DIR / 'input')
    reply = request('/prompt', {'prompt': workflow, 'client_id': 'ecco-serverless'})
    prompt_id = reply.get('prompt_id')
    if not prompt_id:
        return {'error': 'ComfyUI rejected the workflow: ' + json.dumps(reply.get('node_errors') or reply)[:1500]}
    runpod.serverless.progress_update(job, 'Generating')
    while True:
        entry = request('/history/' + prompt_id).get(prompt_id)
        if entry:
            status = entry.get('status', {})
            if status.get('status_str') == 'error':
                messages = [m for m in status.get('messages', []) if m[0] == 'execution_error']
                detail = messages[-1][1].get('exception_message', '') if messages else ''
                return {'error': ('ComfyUI generation failed. ' + detail).strip()[:1500], 'log': tail_log()}
            if status.get('completed'):
                break
        time.sleep(1)
    outputs, paths = [], []
    for node_output in entry.get('outputs', {}).values():
        for kind in ('images', 'gifs', 'videos'):
            for item in node_output.get(kind, []):
                if item.get('type', 'output') != 'output':
                    continue
                path = (COMFY_DIR / 'output' / item.get('subfolder', '') / item['filename']).resolve()
                if not path.is_relative_to((COMFY_DIR / 'output').resolve()) or not path.is_file():
                    return {'error': 'ComfyUI returned an invalid output path.'}
                outputs.append({'filename': item['filename'], 'subfolder': item.get('subfolder', ''), 'kind': kind})
                paths.append(path)
    if not paths:
        return {'error': 'ComfyUI returned no outputs.'}
    runpod.serverless.progress_update(job, 'Uploading result')
    archive = worker_common.pack(paths, COMFY_DIR / 'output')
    return {'archive': worker_common.deliver(archive, f'{data.get("key") or uuid.uuid4().hex}.tar'), 'outputs': outputs}


def run_zimage(job, data):
    global _zimage
    import torch
    p = data.get('params') or {}
    if _zimage is None:
        try:
            request('/free', {'unload_models': True, 'free_memory': True})
        except Exception:
            pass
        runpod.serverless.progress_update(job, 'Loading Z-Image 6B')
        from diffusers import ZImagePipeline
        _zimage = ZImagePipeline.from_pretrained(str(ZIMAGE_DIR), torch_dtype=torch.bfloat16, local_files_only=True).to('cuda')
    steps = int(p['steps'])

    def callback(pipeline, step, timestep, kwargs):
        runpod.serverless.progress_update(job, f'Generating Z-Image: step {step + 1}/{steps}')
        return kwargs
    image = _zimage(prompt=p['prompt'], negative_prompt=p.get('negative', ''), height=int(p['height']), width=int(p['width']),
                    num_inference_steps=steps, guidance_scale=float(p['cfg']), cfg_normalization=False,
                    generator=torch.Generator('cuda').manual_seed(int(p['seed'])), callback_on_step_end=callback).images[0]
    out = COMFY_DIR / 'output' / 'zimage.png'
    image.save(out)
    archive = worker_common.pack([out], COMFY_DIR / 'output')
    return {'archive': worker_common.deliver(archive, f'{data.get("key") or uuid.uuid4().hex}.tar'),
            'outputs': [{'filename': 'zimage.png', 'subfolder': '', 'kind': 'images'}]}


def handler(job):
    data = job.get('input') or {}
    reset()
    try:
        if data.get('mode') == 'zimage':
            return run_zimage(job, data)
        return run_comfy(job, data)
    except Exception as exc:  # report, never crash the worker
        return {'error': f'{type(exc).__name__}: {exc}'[:1500], 'log': tail_log()}


if __name__ == '__main__':
    start_comfy()
    runpod.serverless.start({'handler': handler})
