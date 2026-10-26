"""Dedicated character worker, explicitly installed on one selected GPU.

Run: python -m characters.worker --config /private/characters.json
No runtime downloads, remote listener, free-form shell commands or AI scripts.
"""
import argparse
import fcntl
import json
import os
from pathlib import Path
import signal
import re
import subprocess
import sys
import threading
import time

from . import transport as queue
from .glb import inspect

HERE = Path(__file__).resolve().parent


class Stopped(Exception): pass


def configuration(path):
    config = json.loads(Path(path).read_text())
    if not isinstance(config, dict): raise ValueError('Worker configuration must be an object.')
    for name in ('blender', 'trellis_python', 'trellis_root', 'trellis_weights', 'unirig_root', 'unirig_python'):
        if config.get(name) and not Path(config[name]).is_absolute(): raise ValueError(name + ' must be an absolute path.')
    return config


def capabilities(config):
    blender = Path(config.get('blender', '/missing')).is_file()
    trellis = all(Path(config.get(k, '/missing')).exists() for k in ('trellis_python', 'trellis_root', 'trellis_weights'))
    unirig = all(Path(config.get(k, '/missing')).exists() for k in ('unirig_root', 'unirig_python'))
    # Readiness requires an explicit local qualification record, produced by
    # --qualify after a real model/rig/render run, not just downloaded weights.
    qualified = queue.read(Path(config.get('qualification', '/missing')))
    signature = config_signature(config)
    matched = qualified.get('configuration') == signature
    return {'model': bool(blender and trellis and matched and qualified.get('model')),
            'rig': bool(blender and unirig and matched and qualified.get('rig')),
            'performance': bool(blender and matched and qualified.get('performance')),
            'import': bool(blender and matched and qualified.get('performance'))}


def config_signature(config):
    import hashlib
    data = {k: v for k, v in config.items() if k != 'qualification'}
    data['implementation'] = {p.name: hashlib.sha256(p.read_bytes()).hexdigest()
                              for p in HERE.glob('*.py')}
    return hashlib.sha256(json.dumps(data, sort_keys=True).encode()).hexdigest()


def run(command, cwd, base, message, timeout=3600, extra_env=None):
    if (base / 'cancel.json').exists(): raise Stopped()
    # Children receive only inference/runtime variables, not Studio/OAuth keys.
    allowed = ('PATH', 'HOME', 'TMPDIR', 'LD_LIBRARY_PATH', 'CUDA_HOME', 'CUDA_PATH',
               'CUDA_VISIBLE_DEVICES', 'HF_HOME', 'TORCH_HOME', 'XDG_CACHE_HOME')
    child_env = {k: os.environ[k] for k in allowed if k in os.environ}
    child_env.update(HF_HUB_OFFLINE='1', TRANSFORMERS_OFFLINE='1', PYTHONUNBUFFERED='1')
    child_env.update(extra_env or {})
    deadline = time.monotonic() + timeout
    with (base / 'worker.log').open('ab') as log:
        process = subprocess.Popen(command, cwd=cwd, stdout=log, stderr=subprocess.STDOUT,
                                   env=child_env, start_new_session=True)
        queue.write(base / 'process.json', {'pid': process.pid, 'start': process_start(process.pid)})
        try:
            while process.poll() is None:
                if (base / 'cancel.json').exists(): raise Stopped()
                if time.monotonic() > deadline: raise RuntimeError('Character stage exceeded its time limit.')
                queue.write(base / 'progress.json', {'message': message, 'at': time.time()})
                time.sleep(.5)
            if process.returncode: raise RuntimeError(message + ' failed. Inspect the private worker log; completed stages are preserved.')
        finally:
            if process.poll() is None:
                os.killpg(process.pid, signal.SIGTERM)
                try: process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    os.killpg(process.pid, signal.SIGKILL)
                    process.wait()
            (base / 'process.json').unlink(missing_ok=True)


def process_start(pid):
    try: return Path('/proc/' + str(int(pid)) + '/stat').read_text().rsplit(')', 1)[1].split()[19]
    except (OSError, ValueError, IndexError, TypeError): return None


def stop_orphan(base):
    previous = queue.read(base / 'process.json')
    pid = previous.get('pid')
    if previous.get('start') and process_start(pid) == previous['start']:
        # Only this worker's recorded process group, guarded against PID reuse.
        os.killpg(pid, signal.SIGKILL)


def execute(task, config, base):
    root = Path(os.getenv('ECCO_DATA', '/workspace/ecco-studio-data')).resolve()
    jid = queue.identifier(task['id'])
    output = (root / 'character-dev' / jid).resolve()
    source = Path(task['params']['input_path']).resolve()
    if not source.is_relative_to(root) or not source.is_file() or source.is_symlink():
        raise ValueError('Character source must be an existing workspace asset.')
    if Path(task['data_root']).resolve() != root or Path(task['output_dir']).resolve() != output:
        raise ValueError('Invalid character output directory.')
    output.mkdir(parents=True, exist_ok=True)
    stage = task['stage']
    local_task = dict(task)
    local_task['render_device'] = config.get('blender_device', 'CPU')
    task_path = base / 'task.json'
    queue.write(task_path, local_task)
    if stage == 'model':
        run([config['trellis_python'], str(HERE / 'trellis_adapter.py'), '--task', str(task_path),
             '--weights', config['trellis_weights']], config['trellis_root'], base,
            'Reconstructing geometry and baking textures', extra_env={'PYTHONPATH': config['trellis_root']})
        model = output / 'model.glb'
    elif stage == 'rig' and not task['params'].get('imported'):
        inspect(source)
        unirig = Path(config['unirig_root'])
        # Upstream launchers interpolate paths in shell expressions. Never allow
        # user-controlled metacharacters to enter those launchers.
        if any(not re.fullmatch(r'[a-zA-Z0-9/_.-]+', str(p)) for p in (source, output, unirig)):
            raise ValueError('UniRig paths must contain only letters, numbers, slash, dot, dash or underscore.')
        environment = {'PATH': str(Path(config['unirig_python']).parent) + os.pathsep + os.environ.get('PATH', ''),
                       'PYTHONPATH': str(unirig)}
        skeleton, skin, model = output / 'skeleton.fbx', output / 'skin.fbx', output / 'rig.glb'
        for script, argv, label in (
            ('generate_skeleton.sh', ['--input', str(source), '--output', str(skeleton)], 'Predicting body skeleton'),
            ('generate_skin.sh', ['--input', str(skeleton), '--output', str(skin)], 'Predicting skin weights'),
            ('merge.sh', ['--source', str(skin), '--target', str(source), '--output', str(model)], 'Merging rig and textured mesh')):
            run(['bash', str(unirig / 'launch/inference' / script), *argv], unirig, base, label, extra_env=environment)
    else:
        model = source
    report = inspect(model)
    if stage == 'model' and not report['textures']:
        raise ValueError('3D reconstruction produced no embedded textures.')
    if stage in ('rig', 'performance') and not report['skinned']:
        raise ValueError('The model contains no skinned armature.')
    local_task['model_path'] = str(model)
    queue.write(task_path, local_task)
    threads = config.get('blender_threads', 8)
    if type(threads) != int or not 1 <= threads <= 32: raise ValueError('Use 1 to 32 Blender threads.')
    run([config['blender'], '--background', '--factory-startup', '--disable-autoexec', '--threads', str(threads),
         '--python-exit-code', '1', '--python', str(HERE / 'blender_scene.py'), '--', str(task_path)],
        HERE, base, 'Blender: ' + ('rendering performance' if stage == 'performance' else 'preparing model preview'))
    result = queue.read(output / 'manifest.json')
    if not result.get('files'): raise ValueError('Blender did not produce a validated manifest.')
    if stage == 'rig': inspect(output / 'rig.glb')
    return {**result, 'status': 'done', 'model': 'TRELLIS.2' if stage == 'model' else 'UniRig / Blender' if stage == 'rig' else 'Blender'}


def worker(config, pod):
    base = queue.ROOT / pod
    base.mkdir(parents=True, exist_ok=True, mode=0o700)
    lock = (base / 'worker.lock').open('a')
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    caps = capabilities(config)
    def heartbeat():
        while True:
            queue.write(base / 'health.json', {'at': time.time(), 'ready': any(caps.values()),
                        'capabilities': caps, 'detail': '' if all(caps.values()) else 'Some stages need local runtime qualification.'})
            time.sleep(5)
    threading.Thread(target=heartbeat, daemon=True).start()
    # Never rerun a claimed inference after a crash. Preserve its files for review.
    for working in base.glob('*/working.json'):
        if not (working.parent / 'result.json').exists():
            stop_orphan(working.parent)
            queue.write(working.parent / 'result.json', {'status': 'failed', 'error': 'Character worker restarted during this stage. Review partial output before retrying.'})
    while True:
        for request in sorted(base.glob('*/request.json')):
            directory = request.parent
            if (directory / 'result.json').exists(): continue
            try:
                os.rename(request, directory / 'working.json')
                task = queue.read(directory / 'working.json')
                required = 'import' if task.get('params', {}).get('imported') else task['stage']
                if task['gpu'] != pod or not caps.get(required): raise ValueError('This worker is not qualified for the requested stage.')
                if (directory / 'cancel.json').exists(): raise Stopped()
                result = execute(task, config, directory)
            except Stopped:
                result = {'status': 'cancelled'}
            except Exception as exc:
                result = {'status': 'failed', 'error': str(exc)[:1000]}
            queue.write(directory / 'result.json', result)
        time.sleep(.5)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--config', required=True)
    parser.add_argument('--check', action='store_true')
    parser.add_argument('--qualify', help='Run an actual workspace task JSON and record only the stage that passes.')
    args = parser.parse_args()
    config = configuration(args.config)
    if args.check:
        print(json.dumps(capabilities(config), indent=2))
        return
    if args.qualify:
        task = queue.read(Path(args.qualify))
        base = queue.directory(task['gpu'], task['id'])
        base.mkdir(parents=True, exist_ok=True)
        result = execute(task, config, base)
        path = Path(config['qualification'])
        old = queue.read(path)
        signature = config_signature(config)
        qualification = old if old.get('configuration') == signature else {'configuration': signature}
        stage = 'import' if task['params'].get('imported') else task['stage']
        if stage == 'performance' and task['params'].get('output') != 'clip':
            raise ValueError('Qualification must include an actual animated clip.')
        qualification[stage] = True
        qualification['at'] = time.time()
        queue.write(path, qualification)
        print(json.dumps({'qualified': task['stage'], 'files': result['files']}))
        return
    pod = os.environ.get('RUNPOD_POD_ID', '')
    queue.directory(pod, '0' * 32)
    worker(config, pod)


if __name__ == '__main__': main()
