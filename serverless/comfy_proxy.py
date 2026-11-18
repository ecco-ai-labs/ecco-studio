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


VIDEO_MODELS = re.compile(os.getenv('ECCO_VIDEO_MODEL_PATTERN', r'wan|umt5'), re.I)


VIDEO_LARGE_MODELS = re.compile(os.getenv('ECCO_VIDEO_LARGE_MODEL_PATTERN', r'wan.*14B'), re.I)
IMAGE_EDIT_MODELS = re.compile(os.getenv('ECCO_IMAGE_EDIT_MODEL_PATTERN', r'qwen_image_edit'), re.I)
# Per-model endpoints (owner, 17 Nov 2026): each holds one model built into its worker image, so a second
# request for the same model waits for that endpoint's warm worker. When a per-model endpoint is not
# configured, its jobs go to the shared endpoint as before.
FALLBACK = {'imageedit': 'images', 'videolarge': 'video'}


def route(graph):
    """The endpoint group for a workflow: 'videolarge' (Wan 14B), 'video' (other Wan), 'imageedit'
    (Qwen Image Edit) or 'images', falling back to the shared endpoint when the per-model one is not set."""
    names = {str(node.get('inputs', {}).get(k)) for node in graph.values() if isinstance(node, dict) for k in MODEL_KEYS}
    names.discard('None')
    if any(VIDEO_MODELS.search(n) for n in names):
        group = 'videolarge' if any(VIDEO_LARGE_MODELS.search(n) for n in names) else 'video'
    else:
        group = 'imageedit' if any(IMAGE_EDIT_MODELS.search(n) for n in names) else 'images'
    return group if group not in FALLBACK or rp.configured(group) else FALLBACK[group]


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


LOG_KEEP = 300


def absorb_log(record, text):
    """Keep the worker's new log lines (sent numbered with each progress update) on the prompt record."""
    try:
        lines = json.loads(text).get('log') if isinstance(text, str) and text.startswith('{') else None
    except ValueError:
        lines = None
    if not isinstance(lines, list):
        return
    seen = record.get('log_seq', 0)
    fresh = [{'seq': n, 't': t, 'line': str(line)[:300]} for n, t, line in
             (x for x in lines if isinstance(x, list) and len(x) == 3) if isinstance(n, int) and n > seen]
    if fresh:
        with LOCK:
            record['log'] = (record.get('log', []) + fresh)[-LOG_KEEP:]
            record['log_seq'] = fresh[-1]['seq']
            record['log_changed'] = True


def sync_logs(db_path):
    """Copy new worker log lines into the Studio job that owns each prompt (its comfy_prompt_id), so the
    generation tab shows them in Activity. Each write re-reads the job inside one write transaction, so a
    newer status Studio saved is never overwritten."""
    import sqlite3
    with LOCK:
        changed = [(pid, list(r['log'])) for pid, r in PROMPTS.items() if r.get('log_changed')]
        for pid, _ in changed:
            PROMPTS[pid]['log_changed'] = False
    if not changed or not Path(db_path).is_file():
        return 0
    written = 0
    db = sqlite3.connect(db_path, timeout=10, isolation_level=None)
    try:
        for pid, lines in changed:
            db.execute('BEGIN IMMEDIATE')
            try:
                for rid, body in db.execute("SELECT id, body FROM records WHERE kind='job' AND body LIKE ?",
                                            ('%' + pid + '%',)).fetchall():
                    job = json.loads(body)
                    if job.get('comfy_prompt_id') != pid:
                        continue
                    job['worker_log'] = [{'seq': x['seq'], 't': x['t'], 'line': x['line']} for x in lines[-200:]]
                    db.execute('UPDATE records SET body=? WHERE id=?', (json.dumps(job), rid))
                    written += 1
                db.execute('COMMIT')
            except Exception:
                db.execute('ROLLBACK')
                with LOCK:
                    PROMPTS[pid]['log_changed'] = True
                raise
    finally:
        db.close()
    return written


def sync_logs_forever(db_path, every=2.0):
    while True:
        try:
            sync_logs(db_path)
        except Exception as exc:
            log(f'worker log sync failed: {exc}')
        time.sleep(every)


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
        output = rp.wait(group, record['runpod_id'], should_cancel=lambda: record['cancel'], on_status=on_status,
                         on_progress=lambda text: absorb_log(record, text))
        absorb_log(record, json.dumps({'log': output.get('log_lines') or []}))
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


# Wake-up jobs for the audio endpoints (Tell Your Story, owner 17 Nov 2026). They go straight to RunPod from
# here because this bridge holds the job-running key; the worker only unpacks its runtime and environments.
WARMUP_VENVS = {'audio': [], 'sound': ['sounds/ace-step-1.5/a100-venv', 'sounds/moss-soundeffect-v2/a100-venv']}


def warmup_audio(groups):
    """Send one warm-up job to each named audio endpoint that is configured; {group: job id or error}."""
    sent = {}
    for group in groups if isinstance(groups, list) else []:
        if group not in WARMUP_VENVS or not rp.configured(group):
            continue
        try:
            sent[group] = rp.submit(group, {'warmup': True, 'key': 'warmup-' + group, 'venvs': WARMUP_VENVS[group]})
            log(f'warm-up sent to {group} endpoint as {sent[group]}')
        except rp.ServerlessError as exc:
            sent[group] = 'error: ' + str(exc)[:200]
    return {'sent': sent}


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
            if path == '/ecco/warmup':
                return self.reply(warmup_audio(data.get('groups')))
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
