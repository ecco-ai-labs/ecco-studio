"""CPU-side stand-in for the LongCat GPU worker: sends queued shots to the LongCat endpoint.

It claims the same per-instance lock and heartbeat as video/longcat_jobs.worker(),
so Studio's existing queue, progress and finalize steps are unchanged. While the
real GPU pod for that instance is running, the lock is held there and this
dispatcher stays idle.
"""
import base64
import hashlib
import subprocess
import tempfile
import threading
import time
from pathlib import Path

import runpod_client as rp


def run_shot(d, request, jobs, client=rp):
    """Send one queued shot directory to the endpoint and write output.mp4 + status.json."""
    with tempfile.TemporaryDirectory() as temp:
        wav = Path(temp) / 'audio.wav'
        subprocess.run(['ffmpeg', '-y', '-v', 'error', '-i', str(d / 'audio-source'), '-ac', '1', '-ar', '16000', str(wav)],
                       check=True, timeout=60)
        job_input = {'image': base64.b64encode((d / 'image.png').read_bytes()).decode(),
                     'audio': base64.b64encode(wav.read_bytes()).decode(), 'key': d.name,
                     'request': {k: request[k] for k in ('prompt', 'resolution', 'seed', 'duration')}}
        job_id = client.submit('longcat', job_input)
        jobs.write(d / 'status.json', dict(status='running', progress='Waiting for a serverless GPU', serverless_job=job_id))

        def on_status(state):
            if state == 'IN_PROGRESS':
                jobs.write(d / 'status.json', dict(status='running', progress='Running Generation', serverless_job=job_id))
        result = client.wait('longcat', job_id, should_cancel=lambda: (d / 'cancel.json').exists(), on_status=on_status, timeout=2700)
        files = client.unpack(result['archive'], temp)
        video = next(f for f in files if f.name == 'output.mp4')
        digest = hashlib.sha256(video.read_bytes()).hexdigest()
        if digest != result['sha256']:
            raise rp.ServerlessError('Video integrity check failed after download.')
        temporary = d / 'output.mp4.tmp'
        temporary.write_bytes(video.read_bytes())
        temporary.replace(d / 'output.mp4')
    jobs.write(d / 'status.json', dict(status='complete', duration=float(result['duration']), sha256=digest))


def dispatcher(jobs, pod, stop=None, client=rp):
    """Mirror of longcat_jobs.worker() for instance `pod`, running shots on the endpoint."""
    stop = stop or threading.Event()
    jobs.QUEUE.mkdir(parents=True, exist_ok=True)
    try:
        lock = jobs.worker_lock(pod)
    except BlockingIOError:
        return False  # the real GPU worker for this instance is running
    heart = jobs.QUEUE / ('worker-' + pod + '.json')

    def beat():
        while not stop.is_set():
            jobs.write(heart, dict(updated=time.time(), pod=pod, ready=client.configured('longcat'), model=jobs.MODEL, serverless=True))
            stop.wait(3)
    threading.Thread(target=beat, daemon=True, name='longcat-serverless-heartbeat').start()
    while not stop.is_set():
        for d in sorted(jobs.QUEUE.glob('[a-f0-9]' * 32)):
            r, s = jobs.read(d / 'request.json', {}), jobs.read(d / 'status.json', {})
            if r.get('pod') != pod or s.get('status') != 'queued':
                continue
            if (d / 'cancel.json').exists():
                jobs.write(d / 'status.json', dict(status='cancelled', progress='Stopped by user'))
                continue
            jobs.write(d / 'status.json', dict(status='running', progress='Sending to serverless GPU'))
            try:
                run_shot(d, r, jobs, client)
            except Exception as error:
                if (d / 'cancel.json').exists():
                    jobs.write(d / 'status.json', dict(status='cancelled', progress='Stopped by user'))
                else:
                    jobs.write(d / 'status.json', dict(status='error', error='LongCat generation failed: ' + jobs.redact_error(error),
                                                       error_details=jobs.diagnostics(d, error)))
        stop.wait(2)
    lock.close()
    return True
