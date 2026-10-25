"""Poll the private volume queue; inference runs here, never in the CPU API."""
import fcntl
import hashlib
import os
from pathlib import Path
import subprocess
import sys
import time
import traceback
import generation_cancel as cancellation
from contextlib import contextmanager
from audio_queue import ROOT, MODELS, read, write
from sound_schema import MODELS as SOUND_MODELS
from audio_routing import worker_id, memory_bytes, cpu_count, sound_memory_ready

def compute_from_name(name):
    for target in ('a100', 'b200'):
        if target in name.lower().replace('-', ' ').split():
            return target
    raise RuntimeError('This audio worker requires a supported A100 or B200 GPU.')

def owns(request, compute, pod=''):
    # Jobs queued before compute selection was introduced belong to the original B200 worker.
    return request.get('compute', 'b200') == compute and (not request.get('worker_id') or request['worker_id'] == pod)

def recover_jobs(compute, pod=''):
    for directory in ROOT.glob('[a-f0-9]' * 32):
        request = read(directory / 'request.json', {})
        status = read(directory / 'status.json', {})
        if owns(request, compute, pod) and status.get('status') == 'running' and (not pod or status.get('worker_pod') == pod):
            write(directory / 'status.json', {'status': 'cancelled', 'progress': 'Stopped by user'} if (directory / 'cancel.json').exists() else {'status': 'error', 'error': 'Audio worker restarted. Please generate again.'})

@contextmanager
def claim_job(directory, compute, pod, models, sounds):
    """One owner per job across hosts; never consume a job for another instance."""
    with (directory / 'claim.lock').open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            yield None
            return
        request = read(directory / 'request.json', {})
        status = read(directory / 'status.json', {})
        enabled = sounds if request.get('task') == 'sound' else models
        if not request or not owns(request, compute, pod) or status.get('status') != 'queued' or request.get('model', 'indic-mio') not in enabled:
            yield None
            return
        if (directory / 'cancel.json').exists():
            write(directory / 'status.json', {'status': 'cancelled', 'progress': 'Stopped by user'})
            yield None
            return
        write(directory / 'status.json', {'status': 'running', 'compute': compute, 'worker_pod': pod, 'started': time.time(),
                                         'progress': 'Loading sound model' if request.get('task') == 'sound' else 'Generating speech'})
        yield request

def cpu_threads():
    pod = worker_id(os.environ.get('RUNPOD_POD_ID', 'local'))
    config = read(Path(__file__).with_name('worker-configs') / (pod + '.json'), {})
    wanted = config.get('threads', 1)
    return str(min(cpu_count(), max(1, int(wanted))))

def worker_command(request, directory):
    model = request.get('model', 'indic-mio')
    base = Path(__file__).parent
    if request.get('task') == 'sound':
        if model not in SOUND_MODELS:
            raise ValueError('Unsupported sound model.')
        runtime = base / 'sounds' / model
        python = runtime / (request['compute'] + '-venv/bin/python')
        if not python.is_file():
            raise RuntimeError('Install and verify this sound model on the selected compute first.')
        if request['compute'] == 'cpu' and not sound_memory_ready():
            raise RuntimeError('Choose a CPU audio worker with at least 16 GiB RAM for sound generation.')
        env = dict(os.environ, HF_HUB_OFFLINE='1', TRANSFORMERS_OFFLINE='1', TORCHDYNAMO_DISABLE='1')
        env.pop('PYTHONPATH', None)
        if request['compute'] == 'cpu':
            threads = cpu_threads()
            env.update(CUDA_VISIBLE_DEVICES='', ECCO_AUDIO_CPU_THREADS=threads, OMP_NUM_THREADS=threads, MKL_NUM_THREADS=threads, OPENBLAS_NUM_THREADS=threads, MALLOC_ARENA_MAX='2')
        return [str(python), str(base / 'sound_worker.py'), '--request', str(directory / 'request.json'), '--runtime', str(base / 'sounds'), '--output', str(directory / 'output.wav')], env
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
        env['ECCO_AUDIO_CPU_THREADS'] = cpu_threads()
        for key in ('OMP_NUM_THREADS', 'MKL_NUM_THREADS', 'OPENBLAS_NUM_THREADS'):
            env[key] = env['ECCO_AUDIO_CPU_THREADS']
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
    pod = worker_id(os.environ.get('RUNPOD_POD_ID', 'local'))
    config = read(Path(__file__).with_name('worker-configs') / (pod + '.json'), {})
    def enabled_models():
        verified = read(Path(__file__).with_name('cpu-ready-models.json'), []) if compute == 'cpu' else list(MODELS)
        return [m for m in MODELS if isinstance(verified, list) and m in verified and (compute != 'cpu' or Path('/opt/ecco-audio-cpu', 'cpu-' + m + '-venv/bin/python').is_file())]
    def enabled_sounds():
        verified = read(Path(__file__).with_name('sound-ready-' + compute + '.json'), [])
        return [m for m in SOUND_MODELS if isinstance(verified, list) and m in verified
                and (compute != 'cpu' or sound_memory_ready())
                and (Path(__file__).parent / 'sounds' / m / (compute + '-venv/bin/python')).is_file()]
    # Independent queues allow A100 audio and B200 work to coexist on the shared volume.
    lock = (ROOT / ('worker-' + compute + '-' + pod + '.lock')).open('a')
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        return
    heartbeat = ROOT / ('worker-' + pod + '.json')
    def beat():
        write(heartbeat, {'updated': time.time(), 'pod': pod, 'name': config.get('name', pod), 'compute': compute, 'gpu': gpu, 'models': enabled_models(), 'instance_routing_version': 1, 'cpu_count': cpu_count(), 'memory_gb': round(memory_bytes()/1e9), 'character_controls_version': 1, 'sound_design_version': 1, 'sound_generation_version': 1, 'cancellation_version': 1, 'sound_models': enabled_sounds()})
    recover_jobs(compute, pod)
    while True:
        beat()
        for d in sorted(ROOT.glob('[a-f0-9]' * 32)):
            with claim_job(d, compute, pod, enabled_models(), enabled_sounds()) as request:
                if request is None:
                    continue
                run_job(request, d, compute, pod, beat)
        time.sleep(2)

def run_job(request, d, compute, pod, beat):
    process = None
    try:
        cancellation.check(d)
        with (d / 'worker.log').open('wb') as log:
            command, env = worker_command(request, d)
            process = subprocess.Popen(command, start_new_session=True, env=env, stdout=log, stderr=subprocess.STDOUT)
            started = time.monotonic()
            while process.poll() is None:
                cancellation.check(d)
                beat()
                details = read(d / 'progress.json', {})
                progress = details.get('progress')
                if details.get('phase') == 'speech':
                    completed, total = details.get('completed'), details.get('total')
                    if type(completed) is int and type(total) is int and total == len(request['lines']) and 0 <= completed <= total:
                        progress = f'Generating speech · {completed} of {total} passages complete'
                        write(d / 'status.json', {'status': 'running', 'progress': progress, 'compute': compute, 'worker_pod': pod})
                if progress in ('Mixing music and effects', 'Loading sound model', 'Generating sound effect', 'Generating instrumental music'):
                    write(d / 'status.json', {'status': 'running', 'progress': progress, 'compute': compute, 'worker_pod': pod})
                if time.monotonic() - started > 1800:
                    cancellation.terminate(process)
                    raise RuntimeError('Audio generation timed out. Split the script into shorter recordings.')
                time.sleep(2)
            cancellation.check(d)
            if process.returncode:
                phase = read(d / 'progress.json', {}).get('progress', '')
                raise RuntimeError('Soundtrack mixing failed. Check the sound files and audio worker log.' if phase == 'Mixing music and effects' else 'Sound generation failed. Check the sound worker log and try again.' if request.get('task') == 'sound' else 'Speech inference failed. Check the audio worker log and try again.')
        output = d / 'output.wav'
        if not output.is_file() or output.stat().st_size <= 44:
            raise RuntimeError('The audio model returned an empty recording.')
        cancellation.check(d)
        write(d / 'status.json', {'status': 'complete', 'compute': compute, 'worker_pod': pod,
            'provenance': read(d / 'provenance.json', {}), 'sha256': hashlib.sha256(output.read_bytes()).hexdigest()})
    except cancellation.Cancelled:
        if process is not None:
            cancellation.terminate(process)
        write(d / 'status.json', {'status': 'cancelled', 'progress': 'Stopped by user'})
    except Exception as error:
        if process is not None and process.poll() is None:
            cancellation.terminate(process)
        traceback.print_exc()
        write(d / 'status.json', {'status': 'error', 'error': str(error)})

if __name__ == '__main__':
    main()




