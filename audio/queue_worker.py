"""Poll the private volume queue; inference runs here, never in the CPU API."""
import fcntl
import hashlib
import os
from pathlib import Path
import subprocess
import sys
import time
import traceback
from audio_queue import ROOT, read, write

def main():
    ROOT.mkdir(parents=True, exist_ok=True, mode=0o700)
    # One inference at a time across pods sharing this volume. flock releases on crash.
    lock = (ROOT / 'worker.lock').open('a')
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        return
    pod = os.environ.get('RUNPOD_POD_ID', 'local')
    heartbeat = ROOT / ('worker-' + pod + '.json')
    for d in ROOT.glob('[a-f0-9]' * 32):
        status = read(d / 'status.json', {})
        if status.get('status') == 'running':
            write(d / 'status.json', {'status': 'error', 'error': 'Audio worker restarted. Please generate again.'})
    while True:
        write(heartbeat, {'updated': time.time(), 'pod': pod})
        for d in sorted(ROOT.glob('[a-f0-9]' * 32)):
            request = read(d / 'request.json')
            status = read(d / 'status.json', {})
            if not request or status.get('status') != 'queued':
                continue
            write(d / 'status.json', {'status': 'running', 'progress': 'Generating speech', 'started': time.time()})
            try:
                with (d / 'worker.log').open('wb') as log:
                    process = subprocess.Popen([sys.executable, str(Path(__file__).with_name('audio_worker.py')),
                        '--request', str(d / 'request.json'), '--runtime', '/workspace/ecco-audio/models',
                        '--output', str(d / 'output.wav')], stdout=log, stderr=subprocess.STDOUT)
                    started = time.monotonic()
                    while process.poll() is None:
                        write(heartbeat, {'updated': time.time(), 'pod': pod})
                        if time.monotonic() - started > 1800:
                            process.kill()
                            process.wait()
                            raise RuntimeError('Audio generation timed out. Split the script into shorter recordings.')
                        time.sleep(2)
                    if process.returncode:
                        raise RuntimeError('Speech inference failed. Check the audio worker log and try again.')
                output = d / 'output.wav'
                if not output.is_file() or output.stat().st_size <= 44:
                    raise RuntimeError('The audio model returned an empty recording.')
                write(d / 'status.json', {'status': 'complete', 'sha256': hashlib.sha256(output.read_bytes()).hexdigest()})
            except Exception as error:
                traceback.print_exc()
                write(d / 'status.json', {'status': 'error', 'error': str(error)})
        time.sleep(2)

if __name__ == '__main__':
    main()
