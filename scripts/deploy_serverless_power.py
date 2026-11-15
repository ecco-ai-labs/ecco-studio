"""Deploy Serverless On/Off (PR #94) to the storage API pod and restart only the storage API.

Run on the storage pod (python3 deploy_serverless_power.py --api-pid PID):
  1. Refuses unless Studio is idle: no audio or Studio jobs (deploy_audio_delivery.assert_idle) and no
     relayed GPU generation in progress on any pod, Serverless included.
  2. Downloads backend/serverless_power.py from SOURCE_COMMIT and checks its SHA-256.
  3. Adds the four Serverless On/Off hooks to the pod's OWN storage_api.py (import, write routes, the
     status route, the action routes, the idle watcher). Nothing else in that file changes.
     Stops if an anchor is missing, so a differently patched file is never guessed at.
  4. Backs both files up, writes them, restarts the storage API with its existing command, folder and
     environment, and waits for /healthz. Any failure restores the old files and the old process.
The audio worker, the Serverless bridge and every credential file are left alone.
Add --check to run steps 1-3 only (nothing is written or restarted).
"""
import argparse
import hashlib
import json
import os
import shutil
import signal
import subprocess
import sys
import time
from pathlib import Path
from urllib.request import urlopen

sys.path.insert(0, str(Path(__file__).resolve().parent))
import deploy_audio_delivery as base  # noqa: E402

SOURCE_COMMIT = '5412656fd8ea063a6f768baa74f96b7082ce2b00'
MODULE = 'backend/serverless_power.py'
MODULE_HASH = '2d9130aa26b2881aac15a10a027b24d2863b164bbce0e07b0c16d997b8263820'
APP = base.APP
API = APP / 'backend/storage_api.py'
TARGET = APP / MODULE
RELAY = Path(os.getenv('ECCO_GPU_RELAY_ROOT', '/workspace/ecco-gpu-relay'))

HOOKS = [
    ('import runpod_pods\n', 'import runpod_pods\nimport serverless_power\n', 'import serverless_power\n'),
    ('    *runpod_pods.ROUTES,\n', '    *runpod_pods.ROUTES,\n    *serverless_power.ROUTES,\n', '*serverless_power.ROUTES,'),
    ("            if path == '/api/gpu/pods':\n"
     "                try: return self.send(runpod_pods.pods())\n"
     "                except runpod_pods.PodError as exc: raise legacy.Problem(exc.message, exc.code)\n",
     "            if path == '/api/gpu/pods':\n"
     "                try: return self.send(runpod_pods.pods())\n"
     "                except runpod_pods.PodError as exc: raise legacy.Problem(exc.message, exc.code)\n"
     "            if path == '/api/gpu/serverless': return self.send(serverless_power.status())\n",
     "'/api/gpu/serverless': return self.send(serverless_power.status())"),
    ("            if path in runpod_pods.ROUTES:\n"
     "                try: return self.send(runpod_pods.handle(path, body))\n"
     "                except runpod_pods.PodError as exc: raise legacy.Problem(exc.message, exc.code)\n",
     "            if path in runpod_pods.ROUTES:\n"
     "                try: return self.send(runpod_pods.handle(path, body))\n"
     "                except runpod_pods.PodError as exc: raise legacy.Problem(exc.message, exc.code)\n"
     "            if path in serverless_power.ROUTES:\n"
     "                try: return self.send(serverless_power.handle(path, body))\n"
     "                except serverless_power.PowerError as exc: raise legacy.Problem(exc.message, exc.code if 400 <= exc.code < 600 else 502)\n",
     'serverless_power.handle(path, body)'),
    ('    auto_series.start(vars(legacy))\n', '    auto_series.start(vars(legacy))\n    serverless_power.start()\n',
     'serverless_power.start()'),
]


def patched(source):
    for anchor, replacement, marker in HOOKS:
        if marker in source:
            continue
        if source.count(anchor) != 1:
            raise RuntimeError('storage_api.py differs from what this deploy expects (anchor not found once): '
                               + anchor.strip().splitlines()[0])
        source = source.replace(anchor, replacement, 1)
    compile(source, 'storage_api.py', 'exec')
    return source


def relayed_jobs():
    busy = []
    for work in RELAY.glob('*/*.working'):
        if work.with_suffix('.result').exists() or time.time() - work.stat().st_mtime > 6 * 3600:
            continue
        try:
            if 'completed' not in json.loads(work.read_text() or '{}'):
                busy.append(str(work.relative_to(RELAY)))
        except (OSError, ValueError):
            busy.append(str(work.relative_to(RELAY)))
    return busy


def assert_idle():
    base.assert_idle()
    busy = relayed_jobs()
    if busy:
        raise RuntimeError('GPU generations are running; deployment stopped: ' + ', '.join(busy[:5]))


def check_helpers():
    pods = (APP / 'backend/runpod_pods.py').read_text()
    missing = [name for name in ('class PodError', 'def _key(', 'def _graphql(', 'def active_jobs(', 'ROUTES')
               if name not in pods]
    if missing:
        raise RuntimeError('runpod_pods.py on the pod lacks: ' + ', '.join(missing))


def download():
    with urlopen('https://raw.githubusercontent.com/ecco-ai-labs/ecco-studio/' + SOURCE_COMMIT + '/' + MODULE,
                 timeout=30) as response:
        content = response.read(1024 * 1024)
    if MODULE_HASH and hashlib.sha256(content).hexdigest() != MODULE_HASH:
        raise RuntimeError('Source checksum mismatch: ' + MODULE)
    compile(content, MODULE, 'exec')
    return content


def healthy(child):
    for _ in range(80):
        if child is not None and child.poll() is not None:
            return False
        try:
            with urlopen('http://127.0.0.1:8888/healthz', timeout=2) as response:
                if json.load(response).get('ok'):
                    return True
        except Exception:
            pass
        time.sleep(.25)
    return False


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--api-pid', type=int, required=True)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    api = base.process(args.api_pid)
    if not base.matching_script(api, 'storage_api.py') or Path(api['cwd']) != APP / 'backend':
        raise RuntimeError('Expected the running storage API in ' + str(APP / 'backend'))
    assert_idle()
    check_helpers()
    module = download()
    old_api = API.read_bytes()
    new_api = patched(old_api.decode()).encode()
    print('CHECK OK: idle; storage_api.py hooks', 'already present' if new_api == old_api else 'will be added',
          '; serverless_power.py', 'unchanged' if base.digest(TARGET) == hashlib.sha256(module).hexdigest() else 'will be written',
          flush=True)
    if args.check:
        return
    root = Path('/workspace') / ('ecco-serverless-power-update-' + str(time.time_ns()))
    (root / 'backup').mkdir(parents=True, mode=0o700)
    (root / 'backup/storage_api.py').write_bytes(old_api)
    had_module = TARGET.exists()
    if had_module:
        shutil.copy2(TARGET, root / 'backup/serverless_power.py')
    environment = dict(x.decode().split('=', 1) for x in
                       (Path('/proc') / str(api['pid']) / 'environ').read_bytes().split(b'\0') if b'=' in x)
    log = (root / 'activation.log').open('ab')
    child, written, stopped = None, False, False

    def start():
        return subprocess.Popen(api['command'], cwd=api['cwd'], env=environment, stdin=subprocess.DEVNULL,
                                stdout=log, stderr=log, start_new_session=True)
    try:
        base.assert_same(api)
        assert_idle()
        written = True
        base.atomic(TARGET, module)
        base.atomic(API, new_api)
        base.terminate(api['pid'])
        stopped = True
        child = start()
        if not healthy(child):
            raise RuntimeError('Updated storage API did not become healthy; see ' + str(root / 'activation.log'))
        with urlopen('http://127.0.0.1:8888/healthz', timeout=5) as response:
            response.read()
        print('ACTIVATED storage API pid', child.pid, 'source', SOURCE_COMMIT[:7], 'backup', root / 'backup', flush=True)
    except Exception:
        if child is not None:
            base.terminate(child.pid)
        if written:
            base.atomic(API, old_api)
            if had_module:
                base.atomic(TARGET, (root / 'backup/serverless_power.py').read_bytes())
            else:
                TARGET.unlink(missing_ok=True)
        if stopped:
            restored = start()
            print('ROLLED BACK; old storage API restarted, pid', restored.pid,
                  'healthy' if healthy(restored) else 'NOT HEALTHY - check ' + str(root / 'activation.log'), flush=True)
        raise


if __name__ == '__main__':
    main()
