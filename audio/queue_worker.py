"""Poll the private volume queue; inference runs here, never in the CPU API."""
import fcntl
import hashlib
import os
from pathlib import Path
import subprocess
import sys
import time
import traceback
from audio_queue import ROOT, MODELS, read, write

def compute_from_name(name):
    for target in ('a100', 'b200'):
        if target in name.lower().replace('-', ' ').split():
            return target
    raise RuntimeError('This audio worker requires a supported A100 or B200 GPU.')

def owns(request, compute):
    # Jobs queued before compute selection was introduced belong to the original B200 worker.
    return request.get('compute', 'b200') == compute

def recover_jobs(compute):
    for directory in ROOT.glob('[a-f0-9]' * 32):
        request = read(directory / 'request.json', {})
        status = read(directory / 'status.json', {})
        if owns(request, compute) and status.get('status') == 'running':
            write(directory / 'status.json', {'status': 'error', 'error': 'Audio worker restarted. Please generate again.'})

def worker_command(request, directory):
    model = request.get('model', 'indic-mio')
    base = Path(__file__).parent
    if model not in MODELS:
        raise ValueError('Unsupported audio model.')
    if request.get('compute') == 'cpu':
        python = str(Path('/opt/ecco-audio-cpu') / ('cpu-' + model + '-venv/bin/python'))
        script = base / ('audio_worker.py' if model == 'indic-mio' else 'extra_worker.py')
        if not Path(python).is_file():
            raise RuntimeError('The selected CPU audio model runtime is not installed.')
    elif model == 'indic-mio':
        python, script = sys.executable, base / 'audio_worker.py'
    elif model in ('chatterbox', 'indicf5'):
        python, script = str(base / (model + '-venv/bin/python')), base / 'extra_worker.py'
        if not Path(python).is_file():
            raise RuntimeError('The selected audio model runtime is not installed on this worker.')
    else:
        raise ValueError('Unsupported audio model.')
    env = dict(os.environ)
    if model != 'indic-mio' or request.get('compute') == 'cpu':
        env.pop('PYTHONPATH', None)
        env['HF_HOME'] = str(base / 'hf-cache')
        env['HF_HUB_OFFLINE'] = '1'
    if request.get('compute') == 'cpu':
        env['CUDA_VISIBLE_DEVICES'] = ''
        env['ECCO_AUDIO_CPU_THREADS'] = '1'
        for key in ('OMP_NUM_THREADS', 'MKL_NUM_THREADS', 'OPENBLAS_NUM_THREADS'):
            env[key] = '1'
        env['MALLOC_ARENA_MAX'] = '2'
    return [python, str(script), '--request', str(directory / 'request.json'),
            '--runtime', str(base / 'models'), '--output', str(directory / 'output.wav')], env

def main():
    ROOT.mkdir(parents=True, exist_ok=True, mode=0o700)
    if os.getenv('ECCO_AUDIO_DEVICE') == 'cpu':
        compute, gpu = 'cpu', ''
        os.nice(10)
    else:
        gpu = subprocess.check_output(['nvidia-smi', '--query-gpu=name', '--format=csv,noheader'], text=True).splitlines()[0].strip()
        compute = compute_from_name(gpu)
    def enabled_models():
        verified = read(Path(__file__).with_name('cpu-ready-models.json'), []) if compute == 'cpu' else list(MODELS)
        return [m for m in MODELS if isinstance(verified, list) and m in verified]
    # Independent queues allow A100 audio and B200 work to coexist on the shared volume.
    lock = (ROOT / ('worker-' + compute + '.lock')).open('a')
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        return
    pod = os.environ.get('RUNPOD_POD_ID', 'local')
    heartbeat = ROOT / ('worker-' + pod + '.json')
    def beat():
        write(heartbeat, {'updated': time.time(), 'pod': pod, 'compute': compute, 'gpu': gpu, 'models': enabled_models()})
    recover_jobs(compute)
    while True:
        beat()
        for d in sorted(ROOT.glob('[a-f0-9]' * 32)):
            request = read(d / 'request.json')
            status = read(d / 'status.json', {})
            if not request or not owns(request, compute) or status.get('status') != 'queued':
                continue
            write(d / 'status.json', {'status': 'running', 'progress': 'Generating speech', 'started': time.time()})
            try:
                if request.get('model', 'indic-mio') not in enabled_models():
                    raise RuntimeError('The selected audio model is not enabled on ' + compute.upper() + '.')
                with (d / 'worker.log').open('wb') as log:
                    command, env = worker_command(request, d)
                    process = subprocess.Popen(command, env=env, stdout=log, stderr=subprocess.STDOUT)
                    started = time.monotonic()
                    while process.poll() is None:
                        beat()
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
                write(d / 'status.json', {'status': 'complete', 'compute': compute, 'worker_pod': pod,
                    'sha256': hashlib.sha256(output.read_bytes()).hexdigest()})
            except Exception as error:
                traceback.print_exc()
                write(d / 'status.json', {'status': 'error', 'error': str(error)})
        time.sleep(2)

if __name__ == '__main__':
    main()



