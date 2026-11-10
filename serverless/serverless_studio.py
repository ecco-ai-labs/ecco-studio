"""Run the GPU Studio service on the CPU pod, with all generation on RunPod Serverless.

Off unless started. Start it on the CPU storage pod (shared volume at /workspace):

  export RUNPOD_API_KEY=...                       # RunPod API key
  export ECCO_ENDPOINT_IMAGES=... ECCO_ENDPOINT_VIDEO=... ECCO_ENDPOINT_LONGCAT=...
  export ECCO_SERVERLESS_POD=sup07jsgh2evnf        # GPU instance this replaces (pick a stopped one)
  python serverless/serverless_studio.py

What it does
  1. Starts a local ComfyUI stand-in (comfy_proxy.py) on 127.0.0.1:8188.
  2. Creates empty placeholder model files so Studio's "model ready" checks pass
     for the models the configured endpoints carry (from the weights manifest).
  3. Sends Z-Image to the image endpoint (zimage_client.py) and reports the
     accelerator as "RunPod Serverless".
  4. Answers the GPU relay and the LongCat queue for ECCO_SERVERLESS_POD, so
     Studio's existing instance picker reaches it. If that pod is actually
     running, its own workers keep the locks and this launcher stays out of the way.
  5. Runs the existing Studio service (studio.py from the shared volume) unchanged.

Rollback: stop this process and start the GPU pod again. Nothing on the volume is
changed except files under /workspace/ecco-serverless/.
"""
import importlib
import json
import os
import runpy
import shutil
import sys
import threading
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
WORKSPACE = Path(os.getenv('ECCO_WORKSPACE', '/workspace'))
BASE = WORKSPACE / 'ecco-serverless'
STUDIO_DIR = Path(os.getenv('ECCO_STUDIO_DIR', str(WORKSPACE / 'ecco-studio')))
COMFY_ROOT = Path(os.getenv('COMFY_ROOT', str(BASE / 'comfy-root')))
RATE = float(os.getenv('ECCO_SERVERLESS_HOURLY_RATE', '6.0'))

sys.path.insert(0, str(HERE))
import runpod_client as rp  # noqa: E402


def say(message):
    print('[serverless] ' + message, flush=True)


def placeholders(manifest_path=BASE / 'manifest.json', comfy_root=COMFY_ROOT):
    """Create empty files named like each model the configured endpoints carry."""
    try:
        groups = json.loads(Path(manifest_path).read_text())['groups']
    except (OSError, ValueError, KeyError):
        say('No weights manifest yet; run publish_weights.py first. Model checks will report "not ready".')
        return 0
    count = 0
    for group in ('images', 'video'):
        if not rp.configured(group):
            continue
        for item in groups.get(group, []):
            if item['path'].startswith('comfy/'):
                target = Path(comfy_root) / 'models' / item['path'][len('comfy/'):]
                target.parent.mkdir(parents=True, exist_ok=True)
                target.touch(exist_ok=True)
                count += 1
    return count


def zimage_runtime(runtime=BASE / 'zimage-runtime'):
    runtime.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(HERE / 'zimage_client.py', runtime / 'zimage_worker.py')
    shutil.copyfile(HERE / 'runpod_client.py', runtime / 'runpod_client.py')
    (runtime / 'zimage-verified.json').write_text(json.dumps({'serverless': True, 'at': time.time()}))
    python = runtime / 'venv/bin/python'
    python.parent.mkdir(parents=True, exist_ok=True)
    if python.is_symlink() or python.exists():
        python.unlink()
    python.symlink_to(sys.executable)
    return runtime, python


def patch_studio_modules():
    """Point Studio's helper modules at serverless, where the live versions allow it."""
    if rp.configured('images'):
        try:
            extra = importlib.import_module('extra_image_models')
            extra.RUNTIME, extra.PYTHON = zimage_runtime()
            say('Z-Image routed to the image endpoint.')
        except ImportError:
            say('extra_image_models not found; Z-Image unchanged.')
    device = {'name': 'RunPod Serverless', 'serverless': True}
    try:
        accel = importlib.import_module('accelerator_status')
        accel.status = lambda: {'status': 'detected', 'devices': [device], 'pod_id': 'serverless', 'checked_at': time.time()}
    except ImportError:
        pass
    try:
        dispatch = importlib.import_module('gpu_dispatch')
        if hasattr(dispatch, 'local_gpu'):
            dispatch.local_gpu = lambda: {'id': 'serverless', 'name': 'RunPod Serverless', 'hourly_rate': RATE, 'ready': True, 'local': True}
    except ImportError:
        pass


def start_relay(pod):
    os.environ['ECCO_RELAY_WORKER_ID'] = pod
    sys.path.insert(0, str(REPO / 'backend'))
    relay = importlib.import_module('gpu_relay')

    def run():
        relay.worker()
        say(f'GPU relay for {pod} is held by the running pod; serverless relay idle.')
    threading.Thread(target=run, daemon=True, name='serverless-relay').start()


def start_longcat(pod):
    live = WORKSPACE / 'ecco-video/longcat/longcat_jobs.py'
    sys.path.insert(0, str(live.parent if live.is_file() else REPO / 'video'))
    jobs = importlib.import_module('longcat_jobs')
    dispatch = importlib.import_module('longcat_dispatch')

    def run():
        if not dispatch.dispatcher(jobs, pod):
            say(f'LongCat queue for {pod} is held by the running pod; serverless LongCat idle.')
    threading.Thread(target=run, daemon=True, name='serverless-longcat').start()


def main():
    pod = os.getenv('ECCO_SERVERLESS_POD', '')
    if not os.getenv('RUNPOD_API_KEY'):
        raise SystemExit('Set RUNPOD_API_KEY and the ECCO_ENDPOINT_* variables first.')
    if not (STUDIO_DIR / 'studio.py').is_file():
        raise SystemExit(f'Studio not found at {STUDIO_DIR}. Set ECCO_STUDIO_DIR.')
    os.environ.setdefault('COMFY_URL', 'http://127.0.0.1:8188')
    os.environ['COMFY_ROOT'] = str(COMFY_ROOT)
    os.environ.setdefault('ECCO_PUBLIC_URL', 'http://127.0.0.1:8765')
    os.environ.setdefault('STUDIO_ORIGIN', os.environ['ECCO_PUBLIC_URL'])
    os.environ.setdefault('ECCO_HOURLY_RATE', str(RATE))
    say(f'{placeholders()} model placeholders ready.')
    import comfy_proxy
    threading.Thread(target=comfy_proxy.serve, daemon=True, name='comfy-proxy').start()
    sys.path.insert(0, str(STUDIO_DIR))
    patch_studio_modules()
    if pod:
        start_relay(pod)
        if rp.configured('longcat'):
            start_longcat(pod)
    else:
        say('ECCO_SERVERLESS_POD not set: Studio runs locally only, not reachable through the GPU picker.')
    for name in ('images', 'video', 'longcat'):
        say(f'{name} endpoint: {"configured" if rp.configured(name) else "not configured"}')
    runpy.run_path(str(STUDIO_DIR / 'studio.py'), run_name='__main__')


if __name__ == '__main__':
    main()
