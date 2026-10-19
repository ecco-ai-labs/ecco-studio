"""CPU-pod check: authenticated CPU job, durable saved WAV and playback bytes."""
import hashlib
import io
import json
from pathlib import Path
import time
import urllib.request
import wave

token = Path('/workspace/ecco-storage-private/access.key').read_text().strip()

def call(path, body=None):
    request = urllib.request.Request('http://127.0.0.1:8888/api/' + path,
        data=None if body is None else json.dumps(body).encode(),
        headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'})
    with urllib.request.urlopen(request, timeout=30) as response:
        data = response.read()
        return data if path.startswith('media/') else json.loads(data)

status = call('audio/status')['compute']['cpu']
assert status['ready'] and 'indic-mio' in status['models']
started = time.monotonic()
job = call('audio/generate', {'compute': 'cpu', 'model': 'indic-mio',
    'title': 'CPU verification · Hindi and Urdu', 'lines': [
        {'text': 'नमस्ते। आपका स्वागत है।', 'language': 'Hindi', 'voice': 'en_female'},
        {'text': 'آپ کیسے ہیں؟', 'language': 'Urdu', 'voice': 'en_male'}]})
assert job['compute'] == 'cpu'
print('CPU job', job['id'], flush=True)
for _ in range(300):
    job = call('audio/jobs/' + job['id'])
    if job['status'] in ('done', 'error'):
        break
    time.sleep(2)
assert job['status'] == 'done', str(job)
asset = next(r for r in call('state')['records'] if r['id'] == job['asset_id'])
assert asset['settings']['compute'] == asset['settings']['worker_compute'] == 'cpu'
assert asset['settings']['worker_pod'], 'Missing worker provenance'
raw = call('media/' + job['asset_id'])
assert hashlib.sha256(raw).hexdigest() == asset['sha256']
with wave.open(io.BytesIO(raw)) as audio:
    assert audio.getnchannels() == 1 and audio.getnframes() > 0
    report = dict(job=job['id'], compute='cpu', worker=asset['settings']['worker_pod'],
                  seconds=round(audio.getnframes()/audio.getframerate(), 2),
                  wall_seconds=round(time.monotonic()-started, 2), sample_rate=audio.getframerate(),
                  bytes=len(raw), sha256=asset['sha256'])
Path('/workspace/ecco-audio/cpu-verification/api-report.json').write_text(json.dumps(report, indent=2))
print('PASS CPU API', json.dumps(report), flush=True)
