"""Run on the CPU pod: create a short test recording through authenticated HTTP."""
import json
from pathlib import Path
import time
import urllib.request

token = Path('/workspace/ecco-storage-private/access.key').read_text().strip()
def call(path, body=None):
    request = urllib.request.Request('http://127.0.0.1:8888/api/' + path,
        data=None if body is None else json.dumps(body).encode(),
        headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'})
    with urllib.request.urlopen(request, timeout=30) as response:
        raw = response.read()
        return raw if path.startswith('media/') else json.loads(raw)

print('Audio worker:', call('audio/status'), flush=True)
job = call('audio/generate', {'title': 'Audio integration test · English and Hindi',
    'lines': [{'text': 'Welcome to Ecco AI Labs.', 'language': 'English', 'voice': 'en_male'},
              {'text': 'नमस्ते। आपका स्वागत है।', 'language': 'Hindi', 'voice': 'en_female'}]})
Path('/workspace/ecco-audio/verification-job-id').write_text(job['id'])
print('Job:', job['id'], flush=True)
for attempt in range(180):
    job = call('audio/jobs/' + job['id'])
    if job['status'] in ('done', 'error'):
        break
    time.sleep(3)
if job['status'] != 'done':
    raise RuntimeError(job)
raw = call('media/' + job['asset_id'])
assert raw.startswith(b'RIFF') and len(raw) > 44
print('PASS: generation, durable asset commit and authenticated WAV playback;', len(raw), 'bytes', flush=True)
