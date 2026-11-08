"""Deploy only the campaign read-visibility fix to the existing storage service.

Checks the reviewed live sources, preserves the live release configuration,
backs up code and SQLite, and restores the old modules if verification fails.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import signal
import sqlite3
import subprocess
import time
from urllib.error import HTTPError
from urllib.request import Request, urlopen


OLD = {
    'storage_api.py': 'df43d23c0c02c19579b36e1569836a0c7b516a3d7115fa6a3abd69bb400b5160',
    'ecco_desk.py': 'd5acc6a48c5566c37fc626fdcba1aa29296bf08c58e44ab62e3d73d1b3ce4d7e',
    'ecco_campaigns.py': '2af41ee7b8f82b167212332338ab5374fd2138845c884e3248a17a74b8649311',
}
NEW = {
    'ecco_desk.py': 'd504276e43b044e5f0bdb9427f0a88258b5ae175a080cbf3d52175654c021c3e',
    'ecco_campaigns.py': '2c10008cd2da30eed4c6e9075f2fb2a7cd9a32112d8a90e0e22aea9aa068b62e',
}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--pid', type=int, required=True)
    parser.add_argument('--commit', required=True)
    args = parser.parse_args()
    assert len(args.commit) == 40 and all(c in '0123456789abcdef' for c in args.commit)
    proc = Path('/proc') / str(args.pid)
    cwd = (proc / 'cwd').resolve()
    command = [s.decode() for s in (proc / 'cmdline').read_bytes().split(b'\0') if s]
    assert any(Path(s).name == 'storage_api.py' for s in command), 'Unexpected process'
    environment = dict(s.decode().split('=', 1) for s in (proc / 'environ').read_bytes().split(b'\0') if b'=' in s)
    previous = {name: (cwd / name).read_bytes() for name in OLD}
    for name, digest in OLD.items():
        assert hashlib.sha256(previous[name]).hexdigest() == digest, 'Live source changed: ' + name

    database = Path('/workspace/ecco-studio-data/studio.sqlite')
    terminal = {'done', 'failed', 'cancelled', 'canceled', 'interrupted', 'error', 'completed', 'stopped'}

    def idle():
        with sqlite3.connect('file:' + str(database) + '?mode=ro', uri=True) as db:
            active = [(kind, json.loads(body).get('status')) for kind, body in db.execute('SELECT kind,body FROM records')
                      if ('job' in kind or kind == 'audio_workflow_run') and json.loads(body).get('status') not in terminal]
        assert not active, 'Wait for active jobs before restarting: ' + repr(active)

    idle()
    updated = {}
    for name, digest in NEW.items():
        with urlopen(f'https://raw.githubusercontent.com/ecco-ai-labs/ecco-studio/{args.commit}/backend/{name}', timeout=30) as response:
            content = response.read(1024 * 1024)
        assert hashlib.sha256(content).hexdigest() == digest, 'Downloaded source mismatch: ' + name
        updated[name] = content

    # These four release hooks are absent from the reviewed live service.
    # Preserve that configuration instead of deploying unrelated release support.
    desk = updated['ecco_desk.py'].decode()
    for hook in (
        'import ecco_releases\n',
        '        ecco_releases.initialize(db)\n',
        '    if "releases" in query:\n        return ecco_releases.listing(db, me)\n',
        "    if op in ('prepareRelease', 'prepareRollback', 'publishRelease'):\n        return ecco_releases.write(db, me, body)\n",
    ):
        assert desk.count(hook) == 1, 'Release integration changed'
        desk = desk.replace(hook, '')
    updated['ecco_desk.py'] = desk.encode()
    for name, content in updated.items():
        compile(content, name, 'exec')

    private = Path('/workspace/ecco-storage-private')
    private.mkdir(mode=0o700, exist_ok=True)
    backup = private / ('campaign-visibility-' + str(time.time_ns()))
    backup.mkdir(mode=0o700)
    for name, content in previous.items():
        (backup / name).write_bytes(content)
    with sqlite3.connect(database) as live, sqlite3.connect(backup / 'studio.sqlite') as saved:
        live.backup(saved)
    os.chmod(backup / 'studio.sqlite', 0o600)
    logpath = backup / 'restart.log'
    logpath.touch(mode=0o600)
    log = logpath.open('ab')

    def start():
        return subprocess.Popen(command, cwd=cwd, env=environment, stdin=subprocess.DEVNULL,
                                stdout=log, stderr=subprocess.STDOUT, start_new_session=True)

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

    def install(sources):
        for name, content in sources.items():
            target = cwd / name
            staged = cwd / (name + '.campaign-staged')
            staged.write_bytes(content)
            staged.chmod(target.stat().st_mode & 0o777)
            staged.replace(target)

    idle()
    for name, digest in OLD.items():
        assert hashlib.sha256((cwd / name).read_bytes()).hexdigest() == digest, 'Live source changed before restart'
    os.kill(args.pid, signal.SIGTERM)
    for _ in range(50):
        try:
            if (proc / 'stat').read_text().split()[2] == 'Z':
                break
        except FileNotFoundError:
            break
        time.sleep(.1)
    else:
        raise SystemExit('Original process did not stop; source unchanged and no second service started')

    child = None
    try:
        install(updated)
        child = start()
        assert healthy(child), 'New service did not become healthy'
        for path in ('/api/desk', '/api/desk/support'):
            try:
                urlopen(Request('http://127.0.0.1:8888' + path, headers={'Origin': 'https://ecco-ai-labs.github.io'}), timeout=5)
                raise RuntimeError('Desk accepted an anonymous request')
            except HTTPError as response:
                assert response.code == 401, 'Unexpected authorization response'
        with sqlite3.connect(database) as db:
            assert db.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
            assert db.execute("SELECT name FROM sqlite_master WHERE name='desk_campaign_reads'").fetchone()
        print('Campaign visibility deployed. PID:', child.pid, 'Backup:', backup, 'Commit:', args.commit)
        print('Health, authentication, database integrity and campaign read migration: PASS')
    except Exception:
        if child is not None and child.poll() is None:
            child.terminate()
            child.wait(timeout=10)
        install({name: previous[name] for name in NEW})
        restored = start()
        print('Deployment failed; original modules restored. Healthy:', healthy(restored))
        raise


if __name__ == '__main__':
    main()
