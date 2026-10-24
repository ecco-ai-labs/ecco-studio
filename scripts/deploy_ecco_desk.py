"""Add Desk to the existing CPU service without replacing other live features.

Run on the existing CPU pod with its current storage API PID, pinned repository
commit and module SHA256. No credentials leave the service or enter logs.
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


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--pid', type=int, required=True)
    parser.add_argument('--commit', required=True)
    parser.add_argument('--module-sha256', required=True)
    parser.add_argument('--runtime-sha256', required=True)
    args = parser.parse_args()
    if len(args.commit) != 40 or any(c not in '0123456789abcdef' for c in args.commit):
        raise SystemExit('A full pinned commit is required.')
    proc = Path('/proc') / str(args.pid)
    cwd = (proc / 'cwd').resolve()
    command = [s.decode() for s in (proc / 'cmdline').read_bytes().split(b'\0') if s]
    if not any(Path(s).name == 'storage_api.py' for s in command):
        raise SystemExit('PID is not the storage API.')
    environment = dict(s.decode().split('=', 1) for s in (proc / 'environ').read_bytes().split(b'\0') if b'=' in s)
    source = cwd / 'storage_api.py'
    original = source.read_text()
    if hashlib.sha256(source.read_bytes()).hexdigest() != args.runtime_sha256:
        raise SystemExit('Runtime source changed. Inspect it before deploying.')
    database = Path('/workspace/ecco-studio-data/studio.sqlite')
    terminal = {'done','failed','cancelled','canceled','interrupted','error','completed','stopped'}

    def idle():
        with sqlite3.connect('file:' + str(database) + '?mode=ro', uri=True) as db:
            active = [(kind, json.loads(body).get('status')) for kind, body in db.execute('SELECT kind,body FROM records')
                      if ('job' in kind or kind == 'audio_workflow_run') and json.loads(body).get('status') not in terminal]
        if active:
            raise SystemExit('Wait for active jobs before restarting: ' + repr(active))

    idle()
    url = f'https://raw.githubusercontent.com/ecco-ai-labs/ecco-studio/{args.commit}/backend/ecco_desk.py'
    with urlopen(url, timeout=30) as response:
        module = response.read()
    if hashlib.sha256(module).hexdigest() != args.module_sha256:
        raise SystemExit('Downloaded module hash mismatch.')
    compile(module, 'ecco_desk.py', 'exec')
    if 'import ecco_desk' in original:
        raise SystemExit('Desk already installed; inspect before updating.')
    hook = 'if google_signin.handle(self, path, ALLOWED_ORIGIN): return'
    assert original.count(hook) == 2, 'Unexpected request handlers'
    assert original.count('    # Never run legacy.initialize()') == 1, 'Unexpected startup'
    updated = original.replace('import google_signin\n', 'import google_signin\nimport ecco_desk\n')
    updated = updated.replace("'Authorization,Content-Type,Range'", "'Authorization,Content-Type,Range,X-Ecco-Workspace-Key'")
    updated = updated.replace(hook, hook + "\n        if ecco_desk.handle(self, path, ALLOWED_ORIGIN, legacy.DATA / 'studio.sqlite', self.access_key): return")
    updated = updated.replace('    # Never run legacy.initialize()', "    ecco_desk.initialize(legacy.DATA / 'studio.sqlite')\n    # Never run legacy.initialize()")
    compile(updated, 'storage_api.py', 'exec')
    private = Path('/workspace/ecco-storage-private')
    backup = private / ('desk-backup-' + str(int(time.time())))
    backup.mkdir(mode=0o700)
    (backup / 'storage_api.py').write_text(original)
    with sqlite3.connect(database) as live, sqlite3.connect(backup / 'studio.sqlite') as saved:
        live.backup(saved)
    os.chmod(backup / 'studio.sqlite', 0o600)
    idle()
    (cwd / 'ecco_desk.py').write_bytes(module)
    source.write_text(updated)
    log = (backup / 'restart.log').open('ab')

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

    os.kill(args.pid, signal.SIGTERM)
    for _ in range(50):
        if not proc.exists():
            break
        # PID 1 may retain a zombie. It no longer owns the listening socket.
        if (proc / 'stat').read_text().split()[2] == 'Z':
            break
        time.sleep(.1)
    else:
        source.write_text(original)
        raise SystemExit('Original process did not stop. Source restored; no duplicate service started.')
    child = start()
    try:
        assert healthy(child), 'New service did not become healthy'
        try:
            urlopen(Request('http://127.0.0.1:8888/api/desk', headers={'Origin':'https://ecco-ai-labs.github.io'}), timeout=5)
            raise RuntimeError('Desk unexpectedly accepted an anonymous request')
        except HTTPError as response:
            assert response.code == 401
            assert 'storage access key' not in json.load(response)['error']
        with sqlite3.connect(database) as db:
            assert db.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
            assert db.execute("SELECT count(*) FROM sqlite_master WHERE type='table' AND name LIKE 'desk_%'").fetchone()[0] == 5
        print('Ecco Desk deployed. PID:', child.pid, 'Backup:', backup, 'Commit:', args.commit)
    except Exception:
        child.terminate()
        child.wait(timeout=10)
        source.write_text(original)
        restored = start()
        print('Deployment failed; original source restored. Healthy:', healthy(restored))
        raise


if __name__ == '__main__':
    main()
