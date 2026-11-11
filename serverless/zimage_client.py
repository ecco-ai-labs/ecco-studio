"""Drop-in for zimage_worker.py: same request file, but generation runs on the image endpoint.

extra_image_models.py starts `<PYTHON> <RUNTIME>/zimage_worker.py request.json`; the
launcher points RUNTIME at a folder where zimage_worker.py is this file.
Stopping the process (Studio's cancel) also cancels the serverless job.
"""
import json
import signal
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import runpod_client as rp  # noqa: E402

STATE = {'job': None, 'stop': False}


def update(progress, message):
    temporary = progress.with_suffix('.tmp')
    temporary.write_text(json.dumps({'progress': message}))
    temporary.replace(progress)


def main(path, client=rp):
    request = json.loads(Path(path).read_text())
    progress = Path(request['progress_file'])
    output = Path(request['output_file'])
    signal.signal(signal.SIGTERM, lambda *a: STATE.update(stop=True))
    params = {k: request[k] for k in ('prompt', 'negative', 'width', 'height', 'steps', 'cfg', 'seed') if k in request}
    update(progress, 'Waiting for a serverless GPU')
    STATE['job'] = client.submit('images', {'mode': 'zimage', 'params': params, 'key': output.stem})

    def on_status(state):
        if state == 'IN_PROGRESS':
            update(progress, 'Generating Z-Image on a serverless GPU')
    result = client.wait('images', STATE['job'], should_cancel=lambda: STATE['stop'], on_status=on_status, timeout=1800)
    with tempfile.TemporaryDirectory() as temp:
        files = client.unpack(result['archive'], temp)
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_bytes(files[0].read_bytes())
    update(progress, 'Image saved')


if __name__ == '__main__':
    try:
        main(sys.argv[1])
    except rp.ServerlessError as exc:
        print('Z-Image serverless job failed:', exc, file=sys.stderr)
        sys.exit(1)
