"""Report locally detected accelerator hardware; never infer power state from URLs."""
import csv
import io
import os
import subprocess
import threading
import time

_lock = threading.Lock()
_cache = None
_checked = 0

def detect():
    result = {'status': 'unknown', 'devices': [], 'pod_id': os.environ.get('RUNPOD_POD_ID', ''), 'checked_at': time.time()}
    try:
        output = subprocess.run(['nvidia-smi', '--query-gpu=name,memory.total', '--format=csv,noheader,nounits'], capture_output=True, text=True, timeout=3, check=True).stdout
        for row in csv.reader(io.StringIO(output)):
            if len(row) != 2 or not row[0].strip(): raise ValueError('Unexpected device response')
            memory = int(row[1].strip())
            if memory <= 0: raise ValueError('Invalid device memory')
            result['devices'].append({'name': row[0].strip(), 'memory_mib': memory})
        if result['devices']: result['status'] = 'detected'
    except (OSError, subprocess.SubprocessError, ValueError):
        result['devices'] = []
    return result

def status():
    global _cache, _checked
    with _lock:
        if _cache is None or time.monotonic() - _checked >= 15:
            _cache = detect()
            _checked = time.monotonic()
        return _cache
