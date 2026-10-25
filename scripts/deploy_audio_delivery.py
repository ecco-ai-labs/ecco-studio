"""Stage and activate the reviewed audio modules on the existing CPU pod.

No credential files are read or changed. No model downloads or GPU starts.
Preparation is separate from activation. Activation checks the reviewed hashes,
pauses idle processes, backs up only source files, and rolls back on failure.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import signal
import sqlite3
import subprocess
import time
from urllib.request import urlopen

SOURCE_COMMIT = 'dd36c342bd36464bc5b8f6d4cb13c70b87c023d5'
SOURCE_HASHES = {'audio/audio_worker.py': 'b15e3eebf01b80bcd140e123301e2c9ef915a1dbba74e07fac5e757a4a79bec4', 'audio/extra_worker.py': '538d094b1433c5b196fec2181089a62dafe50142e5857bc30d39336f2cb5123d', 'audio/queue_worker.py': '286d6413ec94eaaacda1b60ebbfaf4d1a06932764cd03d2281fc4bb986fbc95a', 'audio/install_sound_models.py': '25258ab8433fc132d1251918e941309b55c220374d9a30d34c7430f514c3ad3b'}
APP = Path('/workspace/ecco-storage-app')
AUDIO = Path('/workspace/ecco-audio')
DATABASE = Path('/workspace/ecco-studio-data/studio.sqlite')
QUEUE = AUDIO / 'queue'
TERMINAL = {'done', 'complete', 'completed', 'error', 'failed', 'cancelled',
            'canceled', 'interrupted', 'stopped'}


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest() if path.is_file() else None


def process(pid):
    proc = Path('/proc') / str(pid)
    command = [x.decode() for x in (proc / 'cmdline').read_bytes().split(b'\0') if x]
    stat = (proc / 'stat').read_text().rsplit(')', 1)[1].split()
    return {'pid': int(pid), 'start': stat[19], 'parent': int(stat[1]),
            'cwd': str((proc / 'cwd').resolve()), 'command': command}


def matching_script(p, name):
    return any(Path(x).name == name for x in p['command'])


def assert_same(expected):
    current = process(expected['pid'])
    if current != expected:
        raise RuntimeError('Service process changed. Prepare a new deployment plan.')


def live_workers():
    result = []
    for f in QUEUE.glob('worker-*.json'):
        w = json.loads(f.read_text())
        if 0 <= time.time() - w.get('updated', 0) < 30:
            result.append(w)
    return result


def assert_idle():
    active = []
    for f in QUEUE.glob('*/status.json'):
        status = json.loads(f.read_text()).get('status')
        if status not in TERMINAL:
            active.append(('audio_queue', status))
    with sqlite3.connect('file:' + str(DATABASE) + '?mode=ro', uri=True) as db:
        rows = db.execute("SELECT kind, json_extract(body, '$.status') FROM records "
                          "WHERE kind LIKE '%job%' OR kind='audio_workflow_run'").fetchall()
    active.extend((kind, status) for kind, status in rows if status not in TERMINAL)
    if active:
        raise RuntimeError('Active or unresolved jobs; deployment stopped: ' + repr(active))
    if any(w.get('compute') != 'cpu' for w in live_workers()):
        raise RuntimeError('Another audio worker is live. Coordinate its update before continuing.')


def destinations(source):
    if source.startswith('backend/'):
        return [APP / source]
    return [AUDIO / Path(source).name, APP / source]


def prepare(api_pid, worker_pid):
    api, worker = process(api_pid), process(worker_pid)
    launcher = process(worker['parent'])
    if not matching_script(api, 'storage_api.py') or Path(api['cwd']) != APP / 'backend':
        raise RuntimeError('Expected the existing CPU storage API.')
    if not matching_script(worker, 'queue_worker.py') or Path(worker['cwd']) != AUDIO:
        raise RuntimeError('Expected the existing CPU audio worker.')
    if not matching_script(launcher, 'start_cpu_worker.sh'):
        raise RuntimeError('Unexpected audio supervisor; inspect before changing it.')
    assert_idle()
    if not shutil.which('ffmpeg') or not shutil.which('ffprobe'):
        raise RuntimeError('FFmpeg and ffprobe must already be installed.')
    source = (APP / 'backend/storage_api.py').read_text()
    if not all(x in source for x in ('audio_jobs.start(', 'audio_workflows.start(')):
        raise RuntimeError('Existing coordinator hooks differ; inspect before changing it.')
    root = Path('/workspace') / ('ecco-audio-update-' + str(time.time_ns()))
    root.mkdir(mode=0o700)
    files = []
    for name, expected in SOURCE_HASHES.items():
        with urlopen('https://raw.githubusercontent.com/ecco-ai-labs/ecco-studio/'
                     + SOURCE_COMMIT + '/' + name, timeout=30) as response:
            content = response.read(1024 * 1024)
        if hashlib.sha256(content).hexdigest() != expected:
            raise RuntimeError('Source checksum mismatch: ' + name)
        if name.endswith('.py'):
            compile(content, name, 'exec')
        else:
            json.loads(content)
        staged = root / 'new' / name
        staged.parent.mkdir(parents=True, exist_ok=True)
        staged.write_bytes(content)
        for target in destinations(name):
            if target.is_symlink() or not target.parent.is_dir():
                raise RuntimeError('Unexpected runtime layout: ' + str(target))
            files.append({'source': name, 'target': str(target), 'old': digest(target), 'new': expected})
    plan = {'source_commit': SOURCE_COMMIT, 'api': api, 'worker': worker, 'launcher': launcher,
            'api_source_hash': digest(APP / 'backend/storage_api.py'), 'files': files}
    (root / 'plan.json').write_text(json.dumps(plan, indent=2))
    print('PREPARED', root, flush=True)
    for item in files:
        print('UNCHANGED' if item['old'] == item['new'] else 'UPDATE', item['target'])
    return root


def wait_dead(pid, timeout=12):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        try:
            if (Path('/proc') / str(pid) / 'stat').read_text().rsplit(')', 1)[1].split()[0] == 'Z':
                return
        except FileNotFoundError:
            return
        time.sleep(.1)
    raise RuntimeError('Process did not stop: ' + str(pid))


def terminate(pid):
    try:
        os.kill(pid, signal.SIGTERM)
        os.kill(pid, signal.SIGCONT)
    except ProcessLookupError:
        return
    wait_dead(pid)


def atomic(path, content):
    temporary = path.with_name(path.name + '.audio-update.tmp')
    with temporary.open('xb') as f:
        f.write(content)
        f.flush()
        os.fsync(f.fileno())
    os.chmod(temporary, path.stat().st_mode & 0o777 if path.exists() else 0o644)
    temporary.replace(path)


def healthy(child):
    for _ in range(40):
        if child.poll() is not None:
            return False
        try:
            with urlopen('http://127.0.0.1:8888/healthz', timeout=2) as response:
                if json.load(response).get('ok'):
                    return True
        except Exception:
            time.sleep(.25)
    return False


def activate(root):
    plan = json.loads((root / 'plan.json').read_text())
    if plan['source_commit'] != SOURCE_COMMIT:
        raise RuntimeError('Unexpected source revision.')
    expected_targets = {(s, str(p)): h for s, h in SOURCE_HASHES.items() for p in destinations(s)}
    if {(x['source'], x['target']): x['new'] for x in plan['files']} != expected_targets:
        raise RuntimeError('Deployment plan differs from the allowlisted modules.')
    for name in ('api', 'worker', 'launcher'):
        assert_same(plan[name])
    if digest(APP / 'backend/storage_api.py') != plan['api_source_hash']:
        raise RuntimeError('Storage API changed since preparation. Prepare again.')
    for item in plan['files']:
        if digest(Path(item['target'])) != item['old'] or digest(root / 'new' / item['source']) != item['new']:
            raise RuntimeError('A reviewed runtime/source file changed: ' + item['target'])
    assert_idle()
    backup = root / 'backup'
    backup.mkdir(mode=0o700)
    for i, item in enumerate(plan['files']):
        if item['old'] is not None:
            shutil.copy2(item['target'], backup / str(i))
    # Preserve the existing service environment privately in memory for its restart.
    # It is never printed, persisted, returned to the browser or sent elsewhere.
    api_environment = dict(x.decode().split('=', 1) for x in
                           (Path('/proc') / str(plan['api']['pid']) / 'environ').read_bytes().split(b'\0') if b'=' in x)
    log = (root / 'activation.log').open('ab')
    paused, written, worker_stopped, api_stopped = [], False, False, False
    child = None
    def start_api():
        return subprocess.Popen(plan['api']['command'], cwd=plan['api']['cwd'], env=api_environment,
                                stdin=subprocess.DEVNULL, stdout=log, stderr=log, start_new_session=True)
    try:
        for role in ('launcher', 'api', 'worker'):
            os.kill(plan[role]['pid'], signal.SIGSTOP)
            paused.append(role)
        assert_idle()
        # Recheck lease after all writers/consumers are stopped.
        if digest(APP / 'backend/storage_api.py') != plan['api_source_hash']:
            raise RuntimeError('Storage API changed during activation.')
        for item in plan['files']:
            if digest(Path(item['target'])) != item['old']:
                raise RuntimeError('Runtime changed during activation.')
        written = True
        for item in plan['files']:
            if item['old'] != item['new']:
                atomic(Path(item['target']), (root / 'new' / item['source']).read_bytes())
        terminate(plan['worker']['pid'])
        worker_stopped = True
        terminate(plan['api']['pid'])
        api_stopped = True
        os.kill(plan['launcher']['pid'], signal.SIGCONT)
        paused.remove('launcher')
        for _ in range(80):
            workers = [w for w in live_workers() if w.get('compute') == 'cpu']
            if workers and all(w.get('instance_routing_version') == 1 and w.get('character_controls_version') == 1 and w.get('sound_design_version') == 1 and w.get('sound_generation_version') == 1 for w in workers):
                break
            time.sleep(.25)
        else:
            raise RuntimeError('Updated CPU worker did not advertise its capabilities.')
        child = start_api()
        if not healthy(child):
            raise RuntimeError('Updated CPU service did not become healthy.')
        report = {'source_commit': SOURCE_COMMIT, 'api_pid': child.pid,
                  'completed_at': time.time(), 'instance_routing_version': 1, 'character_controls_version': 1,
                  'sound_design_version': 1, 'sound_generation_version': 1, 'compute': 'cpu',
                  'sound_models_verified': sorted(set(m for w in workers for m in w.get('sound_models', []))),
                  'authenticated_generation_verified': False}
        (root / 'result.json').write_text(json.dumps(report, indent=2))
        print('ACTIVATED', json.dumps(report), 'BACKUP', str(backup), flush=True)
    except Exception:
        if child is not None:
            terminate(child.pid)
        # If the supervisor was resumed, stop it and its new worker before restoring code.
        if worker_stopped:
            os.kill(plan['launcher']['pid'], signal.SIGSTOP)
            for proc in Path('/proc').glob('[0-9]*'):
                try:
                    p = process(int(proc.name))
                    if p['parent'] == plan['launcher']['pid'] and matching_script(p, 'queue_worker.py'):
                        terminate(p['pid'])
                except (OSError, ValueError):
                    pass
        if written:
            for i, item in enumerate(plan['files']):
                path = Path(item['target'])
                if item['old'] is None:
                    path.unlink(missing_ok=True)
                else:
                    atomic(path, (backup / str(i)).read_bytes())
        if worker_stopped:
            os.kill(plan['launcher']['pid'], signal.SIGCONT)
        if api_stopped:
            restored = start_api()
            print('ROLLED_BACK', 'storage_healthy=' + str(healthy(restored)), flush=True)
        raise
    finally:
        for role in paused:
            try:
                os.kill(plan[role]['pid'], signal.SIGCONT)
            except ProcessLookupError:
                pass
        log.close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='action', required=True)
    pre = sub.add_parser('prepare')
    pre.add_argument('--api-pid', type=int, required=True)
    pre.add_argument('--worker-pid', type=int, required=True)
    apply = sub.add_parser('activate')
    apply.add_argument('directory', type=Path)
    args = parser.parse_args()
    if args.action == 'prepare':
        prepare(args.api_pid, args.worker_pid)
    else:
        activate(args.directory.resolve())
