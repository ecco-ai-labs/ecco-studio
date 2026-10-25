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
    parser.add_argument('--mail-module-sha256', required=True)
    parser.add_argument('--runtime-sha256', required=True)
    parser.add_argument('--previous-module-sha256')
    parser.add_argument('--previous-mail-module-sha256')
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
    mail_url = f'https://raw.githubusercontent.com/ecco-ai-labs/ecco-studio/{args.commit}/backend/ecco_desk_mail.py'
    with urlopen(mail_url, timeout=30) as response:
        mail_module = response.read()
    if hashlib.sha256(mail_module).hexdigest() != args.mail_module_sha256:
        raise SystemExit('Downloaded mail module hash mismatch.')
    compile(mail_module, 'ecco_desk_mail.py', 'exec')
    module_path = cwd / 'ecco_desk.py'
    mail_path = cwd / 'ecco_desk_mail.py'
    old_mail = mail_path.read_bytes() if mail_path.exists() else None
    extras = {}
    for name in ('ecco_desk_chat.py', 'ecco_desk_replies.py', 'ecco_desk_inbox.py'):
        with urlopen(f'https://raw.githubusercontent.com/ecco-ai-labs/ecco-studio/{args.commit}/backend/{name}', timeout=30) as response:
            content = response.read(1024 * 1024)
        compile(content, name, 'exec')
        target = cwd / name
        previous = target.read_bytes() if target.exists() else None
        # First installation only. A later update must be reviewed against its
        # live hashes, rather than silently overwriting another deployment.
        if previous is not None and previous != content:
            raise SystemExit('Conversation module already exists with different content: ' + name)
        extras[name] = (content, previous)
    if old_mail is not None and (not args.previous_mail_module_sha256 or
            hashlib.sha256(old_mail).hexdigest() != args.previous_mail_module_sha256):
        raise SystemExit('Existing mail module changed. Inspect it before updating.')
    old_module = None
    installed = 'import ecco_desk' in original
    if installed:
        old_module = module_path.read_bytes()
        if not args.previous_module_sha256 or hashlib.sha256(old_module).hexdigest() != args.previous_module_sha256:
            raise SystemExit('Existing Desk module changed. Inspect it before updating.')
    hook = 'if google_signin.handle(self, path, ALLOWED_ORIGIN): return'
    assert original.count(hook) == 2, 'Unexpected request handlers'
    assert original.count('    # Never run legacy.initialize()') == 1, 'Unexpected startup'
    updated = original
    if not installed:
        updated = updated.replace('import google_signin\n', 'import google_signin\nimport ecco_desk\n')
        updated = updated.replace("'Authorization,Content-Type,Range'", "'Authorization,Content-Type,Range,X-Ecco-Workspace-Key'")
        updated = updated.replace(hook, hook + "\n        if ecco_desk.handle(self, path, ALLOWED_ORIGIN, legacy.DATA / 'studio.sqlite', self.access_key): return")
        updated = updated.replace('    # Never run legacy.initialize()', "    ecco_desk.initialize(legacy.DATA / 'studio.sqlite')\n    # Never run legacy.initialize()")
    old_start = "ecco_desk.initialize(legacy.DATA / 'studio.sqlite')"
    new_start = "ecco_desk.initialize(legacy.DATA / 'studio.sqlite', start_notifications=True)"
    assert updated.count(old_start) + updated.count(new_start) == 1, 'Unexpected Desk startup'
    updated = updated.replace(old_start, new_start)
    compile(updated, 'storage_api.py', 'exec')
    private = Path('/workspace/ecco-storage-private')
    backup = private / ('desk-backup-' + str(int(time.time())))
    backup.mkdir(mode=0o700)
    (backup / 'storage_api.py').write_text(original)
    if old_module is not None:
        (backup / 'ecco_desk.py').write_bytes(old_module)
    if old_mail is not None:
        (backup / 'ecco_desk_mail.py').write_bytes(old_mail)
    for name, (_, previous) in extras.items():
        if previous is not None:
            (backup / name).write_bytes(previous)
    with sqlite3.connect(database) as live, sqlite3.connect(backup / 'studio.sqlite') as saved:
        live.backup(saved)
    os.chmod(backup / 'studio.sqlite', 0o600)
    idle()
    for name, (content, _) in extras.items():
        (cwd / name).write_bytes(content)
    module_path.write_bytes(module)
    mail_path.write_bytes(mail_module)
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

    def restore():
        source.write_text(original)
        if old_module is not None:
            module_path.write_bytes(old_module)
        if old_mail is not None:
            mail_path.write_bytes(old_mail)
        else:
            mail_path.unlink(missing_ok=True)
        for name, (_, previous) in extras.items():
            if previous is None:
                (cwd / name).unlink(missing_ok=True)
            else:
                (cwd / name).write_bytes(previous)

    os.kill(args.pid, signal.SIGTERM)
    for _ in range(50):
        try:
            # PID 1 may retain a zombie. It no longer owns the listening socket.
            if (proc / 'stat').read_text().split()[2] == 'Z':
                break
        except FileNotFoundError:
            break
        time.sleep(.1)
    else:
        restore()
        raise SystemExit('Original process did not stop. Source restored; no duplicate service started.')
    child = start()
    try:
        assert healthy(child), 'New service did not become healthy'
        for path in ('/api/desk', '/api/desk/support'):
            try:
                urlopen(Request('http://127.0.0.1:8888'+path, headers={'Origin':'https://ecco-ai-labs.github.io'}), timeout=5)
                raise RuntimeError('Desk unexpectedly accepted an anonymous request')
            except HTTPError as response:
                assert response.code == 401
                assert 'storage access key' not in json.load(response)['error']
        with sqlite3.connect(database) as db:
            assert db.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
            tables = {r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'desk_%'")}
            assert {'desk_users','desk_members','desk_tickets','desk_comments','desk_events','desk_mail_outbox'} <= tables
        print('Ecco Desk deployed. PID:', child.pid, 'Backup:', backup, 'Commit:', args.commit)
    except Exception:
        child.terminate()
        child.wait(timeout=10)
        restore()
        restored = start()
        print('Deployment failed; original source restored. Healthy:', healthy(restored))
        raise


if __name__ == '__main__':
    main()
