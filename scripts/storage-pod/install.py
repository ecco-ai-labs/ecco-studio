"""One-time install on the storage pod: makes its services come back by themselves after a pod restart.

  python3 install.py [--check]

- Copies boot.sh and run-serverless-bridge.sh (next to this file) to /workspace/ecco-runtime/storage-pod/.
- Writes serverless-bridge.env there from the RUNNING bridge: only the endpoint IDs (ECCO_ENDPOINT_*) and
  ECCO_SERVERLESS_POD. No key is written: the bridge uses the pod's own RUNPOD_API_KEY (checked equal).
- Adds one line to /workspace/ecco-storage-app/scripts/start-storage-persistent.sh (the pod's start command)
  that runs boot.sh in the background before the storage API loop. The file is replaced atomically, so the
  copy already running as PID 1 is not disturbed; a backup is kept next to it.
Nothing is restarted. --check prints what would change.
"""
import os
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path

SRC = Path(__file__).resolve().parent
DEST = Path('/workspace/ecco-runtime/storage-pod')
START = Path('/workspace/ecco-storage-app/scripts/start-storage-persistent.sh')
HOOK = '[ -f /workspace/ecco-runtime/storage-pod/boot.sh ] && bash /workspace/ecco-runtime/storage-pod/boot.sh &\n'
KEEP = re.compile(r'^(ECCO_ENDPOINT_[A-Z]+|ECCO_SERVERLESS_POD)$')
VALUE = re.compile(r'^[A-Za-z0-9_.-]{1,80}$')


def environ(pid):
    return dict(x.split('=', 1) for x in Path(f'/proc/{pid}/environ').read_bytes().decode().split('\0') if '=' in x)


def main(check):
    pid = subprocess.check_output(['pgrep', '-f', 'serverless_studio.py']).split()[0].decode()
    bridge, init = environ(pid), environ(1)
    if bridge.get('RUNPOD_API_KEY') != init.get('RUNPOD_API_KEY'):
        raise SystemExit('The bridge uses a different RunPod key than the pod provides; not installing (it would '
                         'start without its key after a restart). Ask before saving a key.')
    settings = {k: v for k, v in bridge.items() if KEEP.match(k)}
    bad = [k for k, v in settings.items() if not VALUE.match(v)]
    if bad or not any(k.startswith('ECCO_ENDPOINT_') for k in settings):
        raise SystemExit('Unexpected bridge settings: ' + ', '.join(bad or ['no ECCO_ENDPOINT_*']))
    text = START.read_text()
    if HOOK in text:
        patched = text
    elif text.count('\nwhile true; do\n') != 1:
        raise SystemExit('start-storage-persistent.sh differs from what this install expects; not changed.')
    else:
        patched = text.replace('\nwhile true; do\n', '\n' + HOOK + 'while true; do\n', 1)
    print('settings:', ', '.join(f'{k}={v}' for k, v in sorted(settings.items())))
    print('start script:', 'hook already present' if patched == text else 'hook will be added')
    if check:
        return
    DEST.mkdir(parents=True, exist_ok=True)
    for name in ('boot.sh', 'run-serverless-bridge.sh'):
        shutil.copy2(SRC / name, DEST / name)
        os.chmod(DEST / name, 0o755)
    (DEST / 'serverless-bridge.env').write_text(''.join(f'{k}={v}\n' for k, v in sorted(settings.items())))
    if patched != text:
        shutil.copy2(START, START.with_name(START.name + '.before-boot-' + time.strftime('%Y%m%d%H%M%S')))
        temp = START.with_name(START.name + '.new')
        temp.write_text(patched)
        os.chmod(temp, START.stat().st_mode & 0o777)
        subprocess.run(['bash', '-n', str(temp)], check=True)
        os.replace(temp, START)
    for name in ('boot.sh', 'run-serverless-bridge.sh'):
        subprocess.run(['bash', '-n', str(DEST / name)], check=True)
    print('INSTALLED', DEST)


if __name__ == '__main__':
    main('--check' in sys.argv)
