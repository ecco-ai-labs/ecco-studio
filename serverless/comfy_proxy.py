"""Local stand-in for ComfyUI that runs every workflow on RunPod Serverless.

Studio talks to ComfyUI over HTTP (/prompt, /history, /queue, /free, cancel).
This server answers the same calls on 127.0.0.1:8188, so Studio runs unchanged
on the CPU pod: workflows go to the image or video endpoint, input images are
read from COMFY_ROOT/input, and results are written to COMFY_ROOT/output where
Studio expects them. The WebSocket progress feed is not provided; Studio already
falls back to polling and shows "Step updates unavailable".
"""
import base64
import json
import os
import re
import threading
import time
import traceback
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import runpod_client as rp

COMFY_ROOT = Path(os.getenv('COMFY_ROOT', '/workspace/ecco-serverless/comfy-root')).resolve()
MANIFEST = Path(os.getenv('ECCO_SERVERLESS_MANIFEST', '/workspace/ecco-serverless/manifest.json'))
LOG = Path(os.getenv('ECCO_SERVERLESS_LOG', '/workspace/ecco-serverless/proxy.log'))
MODEL_KEYS = ('unet_name', 'ckpt_name', 'clip_name', 'clip_name1', 'clip_name2', 'vae_name', 'lora_name', 'model_name')
LOCK = threading.Lock()
PROMPTS = {}


def log(message):
    try:
        LOG.parent.mkdir(parents=True, exist_ok=True)
        with LOG.open('a') as out:
            out.write(time.strftime('%Y-%m-%dT%H:%M:%S ') + message + '\n')
    except OSError:
        pass


def manifest_files(group):
    try:
        items = json.loads(MANIFEST.read_text())['groups'][group]
    except (OSError, ValueError, KeyError):
        return set()
    return {Path(i['path']).name for i in items if i['path'].startswith('comfy/')}


def route(graph):
    """'video' when the workflow loads any video-endpoint model, otherwise 'images'."""
    names = {str(node.get('inputs', {}).get(k)) for node in graph.values() if isinstance(node, dict) for k in MODEL_KEYS}
    names.discard('None')
    video = manifest_files('video')
    if video:
        return 'video' if names & video else 'images'
    return 'video' if any(re.search(r'wan|umt5', n, re.I) for n in names) else 'images'


def input_files(graph):
    """Base64 copies of the files referenced by LoadImage nodes."""
    files, root = [], (COMFY_ROOT / 'input').resolve()
    for node in graph.values():
        if not isinstance(node, dict) or not str(node.get('class_type', '')).startswith('LoadImage'):
            continue
        name = node.get('inputs', {}).get('image')
        if not isinstance(name, str):
            continue
        path = (root / name).resolve()
        if not path.is_relative_to(root) or not path.is_file():
            raise ValueError(f'Input image not found: {name}')
        files.append({'name': name, 'data': base64.b64encode(path.read_bytes()).decode()})
    return files


def run(pid):
    record = PROMPTS[pid]
    group = record['group']
    try:
        job_input = {'mode': 'comfy', 'workflow': record['graph'], 'files': input_files(record['graph']), 'key': pid}
        record['runpod_id'] = rp.submit(group, job_input)
        log(f'{pid} submitted to {group} endpoint as {record["runpod_id"]}')

        def on_status(state):
            if state == 'IN_PROGRESS':
                record['state'] = 'running'
        output = rp.wait(group, record['runpod_id'], should_cancel=lambda: record['cancel'], on_status=on_status)
        destination = COMFY_ROOT / 'output'
        rp.unpack(output['archive'], destination)
        record['outputs'] = {'0': {'images': [{'filename': o['filename'], 'subfolder': o.get('subfolder', ''),
                                               'type': 'output'} for o in output.get('outputs', [])]}}
        record['state'] = 'done'
        log(f'{pid} done ({len(output.get("outputs", []))} files)')
    except Exception as exc:
        record['state'] = 'interrupted' if record['cancel'] else 'error'
        record['error'] = str(exc)
        log(f'{pid} {record["state"]}: {exc}\n{traceback.format_exc() if not isinstance(exc, rp.ServerlessError) else ""}')


def submit(graph):
    if not isinstance(graph, dict) or not graph:
        raise ValueError('Empty workflow')
    group = route(graph)
    if not rp.configured(group):
        raise ValueError(f'The {group} serverless endpoint is not configured.')
    pid = uuid.uuid4().hex
    with LOCK:
        PROMPTS[pid] = {'graph': graph, 'group': group, 'state': 'pending', 'cancel': False,
                        'created': time.time(), 'outputs': {}, 'error': ''}
    threading.Thread(target=run, args=(pid,), daemon=True, name='serverless-' + pid[:8]).start()
    return pid


def history_entry(record):
    state = record['state']
    if state == 'done':
        return {'status': {'status_str': 'success', 'completed': True, 'messages': []}, 'outputs': record['outputs']}
    if state == 'error':
        return {'status': {'status_str': 'error', 'completed': False,
                           'messages': [['execution_error', {'exception_message': record['error']}]]}, 'outputs': {}}
    if state == 'interrupted':
        return {'status': {'status_str': 'error', 'completed': False,
                           'messages': [['execution_interrupted', {}]]}, 'outputs': {}}
    return None


def queue():
    with LOCK:
        items = sorted(PROMPTS.items(), key=lambda kv: kv[1]['created'])
    return {'queue_running': [[n, pid, {}, {}, []] for n, (pid, r) in enumerate(items) if r['state'] == 'running'],
            'queue_pending': [[n, pid, {}, {}, []] for n, (pid, r) in enumerate(items) if r['state'] == 'pending']}


def forget_old(max_age=24 * 3600):
    cutoff = time.time() - max_age
    with LOCK:
        for pid in [p for p, r in PROMPTS.items() if r['created'] < cutoff and r['state'] in ('done', 'error', 'interrupted')]:
            del PROMPTS[pid]


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def reply(self, data, status=200):
        body = json.dumps(data).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def body(self):
        length = int(self.headers.get('Content-Length', '0') or 0)
        return json.loads(self.rfile.read(length)) if length else {}

    def do_GET(self):
        path = self.path.split('?', 1)[0].rstrip('/')
        if path == '/system_stats':
            return self.reply({'system': {'comfyui_version': 'ecco-serverless-proxy'},
                               'devices': [{'name': 'RunPod Serverless', 'type': 'serverless'}]})
        if path == '/queue':
            return self.reply(queue())
        if path.startswith('/history/'):
            pid = path.rsplit('/', 1)[1]
            record = PROMPTS.get(pid)
            entry = history_entry(record) if record else None
            return self.reply({pid: entry} if entry else {})
        return self.reply({'error': 'Not available on the serverless proxy'}, 404)

    def do_POST(self):
        path = self.path.split('?', 1)[0].rstrip('/')
        try:
            data = self.body()
            if path == '/prompt':
                forget_old()
                return self.reply({'prompt_id': submit(data.get('prompt')), 'number': 0, 'node_errors': {}})
            if path == '/free':
                return self.reply({})
            if path == '/interrupt':
                for record in PROMPTS.values():
                    if record['state'] == 'running':
                        record['cancel'] = True
                return self.reply({})
            match = re.fullmatch(r'/api/jobs/([a-f0-9]{32})/cancel', path)
            if match and match[1] in PROMPTS:
                PROMPTS[match[1]]['cancel'] = True
                return self.reply({})
            if path == '/queue':
                for pid in data.get('delete', []):
                    if pid in PROMPTS:
                        PROMPTS[pid]['cancel'] = True
                return self.reply({})
            return self.reply({'error': 'Not available on the serverless proxy'}, 404)
        except ValueError as exc:
            log(f'rejected: {exc}')
            return self.reply({'error': {'type': 'invalid_prompt', 'message': str(exc)}, 'node_errors': {}}, 400)


def serve(host='127.0.0.1', port=8188):
    for folder in ('input', 'output'):
        (COMFY_ROOT / folder).mkdir(parents=True, exist_ok=True)
    log(f'proxy listening on {host}:{port}')
    ThreadingHTTPServer((host, port), Handler).serve_forever()


if __name__ == '__main__':
    serve(port=int(os.getenv('ECCO_PROXY_PORT', '8188')))
