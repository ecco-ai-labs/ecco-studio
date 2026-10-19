"""CPU-pod smoke test: authenticated queue, model inference, durable WAV playback."""
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
        raw = response.read()
        return raw if path.startswith('media/') else json.loads(raw)


cases = [
    ('chatterbox', [
        {'text': 'Welcome to Ecco AI Labs.', 'language': 'English', 'voice': 'default'},
        {'text': 'नमस्ते। आपका स्वागत है।', 'language': 'Hindi', 'voice': 'mar_m'}]),
    ('indicf5', [
        {'text': 'नमस्ते। आपका स्वागत है।', 'language': 'Hindi', 'voice': 'mar_f'},
        {'text': 'வணக்கம். உங்களை அன்புடன் வரவேற்கிறோம்.', 'language': 'Tamil', 'voice': 'tam_f'},
        {'text': 'ਸਤਿ ਸ੍ਰੀ ਅਕਾਲ। ਤੁਹਾਡਾ ਸਵਾਗਤ ਹੈ।', 'language': 'Punjabi', 'voice': 'pan_f'}]),
]

assert call('audio/status')['ready'], 'Audio worker is unavailable'
for model, lines in cases:
    job = call('audio/generate', {'model': model, 'title': model + ' · integration verification', 'lines': lines})
    print(model, 'job', job['id'], flush=True)
    for attempt in range(300):
        job = call('audio/jobs/' + job['id'])
        if job['status'] in ('done', 'error'):
            break
        time.sleep(3)
    if job['status'] != 'done':
        raise RuntimeError(model + ': ' + str(job))
    raw = call('media/' + job['asset_id'])
    with wave.open(io.BytesIO(raw)) as audio:
        seconds = audio.getnframes() / audio.getframerate()
        assert seconds > 0.1 and audio.getnchannels() == 1
        print('PASS', model, round(seconds, 2), 'seconds;', audio.getframerate(), 'Hz;',
              len(raw), 'bytes; SHA256', hashlib.sha256(raw).hexdigest(), flush=True)
print('ALL AUDIO MODEL API TESTS PASSED', flush=True)
