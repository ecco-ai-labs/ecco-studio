"""Tests for the serverless migration. Run: python3 -m unittest discover -s serverless/tests -v"""
import base64
import importlib.util
import io
import json
import os
import sys
import tarfile
import tempfile
import threading
import time
import unittest
import urllib.request
from pathlib import Path
from unittest.mock import patch

HERE = Path(__file__).resolve().parents[1]
REPO = HERE.parent
sys.path.insert(0, str(HERE))
import runpod_client as rp  # noqa: E402
import worker_common  # noqa: E402


def tar_of(files):
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode='w') as archive:
        for name, data in files.items():
            info = tarfile.TarInfo(name)
            info.size = len(data)
            archive.addfile(info, io.BytesIO(data))
    return buffer.getvalue()


class FakeResponse(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


class RunpodClient(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict(os.environ, {'RUNPOD_API_KEY': 'k', 'ECCO_ENDPOINT_IMAGES': 'img123'})
        self.env.start()

    def tearDown(self):
        self.env.stop()

    def test_submit_and_wait_until_completed(self):
        calls, replies = [], [{'id': 'job1'}, {'status': 'IN_QUEUE'}, {'status': 'IN_PROGRESS'},
                              {'status': 'COMPLETED', 'output': {'ok': True}}]

        def opener(request, timeout):
            calls.append((request.full_url, request.get_header('Authorization')))
            return FakeResponse(json.dumps(replies.pop(0)).encode())
        job = rp.submit('images', {'x': 1}, opener=opener)
        seen = []
        output = rp.wait('images', job, on_status=seen.append, opener=opener, sleep=lambda s: None)
        self.assertEqual(output, {'ok': True})
        self.assertEqual(seen, ['IN_QUEUE', 'IN_PROGRESS', 'COMPLETED'])
        self.assertTrue(calls[0][0].endswith('/img123/run'))
        self.assertEqual(calls[0][1], 'Bearer k')

    def test_worker_error_and_failed_status_raise(self):
        def opener_for(reply):
            return lambda request, timeout: FakeResponse(json.dumps(reply).encode())
        with self.assertRaisesRegex(rp.ServerlessError, 'boom'):
            rp.wait('images', 'j', opener=opener_for({'status': 'COMPLETED', 'output': {'error': 'boom'}}), sleep=lambda s: None)
        with self.assertRaisesRegex(rp.ServerlessError, 'failed'):
            rp.wait('images', 'j', opener=opener_for({'status': 'FAILED'}), sleep=lambda s: None)

    def test_cancel_request_cancels_remote_job(self):
        urls = []

        def opener(request, timeout):
            urls.append(request.full_url)
            return FakeResponse(b'{}')
        with self.assertRaisesRegex(rp.ServerlessError, 'Stopped'):
            rp.wait('images', 'j', should_cancel=lambda: True, opener=opener, sleep=lambda s: None)
        self.assertTrue(urls[0].endswith('/img123/cancel/j'))

    def test_unconfigured_endpoint_is_refused(self):
        self.assertFalse(rp.configured('video'))
        with self.assertRaisesRegex(rp.ServerlessError, 'No serverless endpoint'):
            rp.submit('video', {})

    def test_unpack_inline_archive_and_reject_traversal(self):
        with tempfile.TemporaryDirectory() as temp:
            files = rp.unpack({'inline': base64.b64encode(tar_of({'ecco-studio/a_00001_.png': b'png'})).decode()}, temp)
            self.assertEqual(files[0].read_bytes(), b'png')
            self.assertTrue(files[0].is_relative_to(Path(temp).resolve()))
            with self.assertRaisesRegex(rp.ServerlessError, 'unsafe'):
                rp.unpack({'inline': base64.b64encode(tar_of({'../escape.png': b'x'})).decode()}, temp)


class WorkerCommon(unittest.TestCase):
    def test_inputs_roundtrip_and_traversal_rejected(self):
        with tempfile.TemporaryDirectory() as temp:
            written = worker_common.write_inputs([{'name': 'ecco-x.png', 'data': base64.b64encode(b'img').decode()}], temp)
            self.assertEqual(written[0].read_bytes(), b'img')
            with self.assertRaises(ValueError):
                worker_common.write_inputs([{'name': '../x', 'data': ''}], temp)

    def test_inline_delivery_without_bucket_and_size_limit(self):
        with tempfile.TemporaryDirectory() as temp, patch.dict(os.environ, {}, clear=False):
            for key in ('ECCO_S3_BUCKET', 'ECCO_S3_ENDPOINT_URL'):
                os.environ.pop(key, None)
            path = Path(temp, 'out', 'f.png')
            path.parent.mkdir()
            path.write_bytes(b'data')
            ref = worker_common.deliver(worker_common.pack([path], temp), 'k')
            with tempfile.TemporaryDirectory() as dest:
                self.assertEqual(rp.unpack(ref, dest)[0].read_bytes(), b'data')
            with patch.object(worker_common, 'MAX_INLINE_BYTES', 1), self.assertRaisesRegex(RuntimeError, 'secrets'):
                worker_common.deliver(b'too big', 'k')


class FakeClient:
    """Stands in for runpod_client: echoes a fixed archive after the job 'runs'."""
    ServerlessError = rp.ServerlessError
    unpack = staticmethod(rp.unpack)

    def __init__(self, archive_files, extra=None, configured=('images', 'video', 'longcat')):
        self.archive = base64.b64encode(tar_of(archive_files)).decode()
        self.extra = extra or {}
        self.submitted = []
        self.enabled = set(configured)

    def configured(self, name):
        return name in self.enabled

    def submit(self, name, job_input):
        self.submitted.append((name, job_input))
        return 'rp-' + str(len(self.submitted))

    def wait(self, name, job_id, should_cancel=lambda: False, on_status=lambda s: None, timeout=0, **kw):
        on_status('IN_PROGRESS')
        if should_cancel():
            raise rp.ServerlessError('Stopped by user')
        return {'archive': {'inline': self.archive}, **self.extra}


class ComfyProxy(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        root = Path(self.temp.name)
        env = {'COMFY_ROOT': str(root / 'comfy'), 'ECCO_SERVERLESS_LOG': str(root / 'proxy.log')}
        with patch.dict(os.environ, env):
            spec = importlib.util.spec_from_file_location('comfy_proxy_test', HERE / 'comfy_proxy.py')
            self.proxy = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(self.proxy)
        (root / 'comfy/input').mkdir(parents=True)
        (root / 'comfy/input/ecco-edit-1.png').write_bytes(b'source')
        self.root = root

    def tearDown(self):
        self.temp.cleanup()

    def test_routes_wan_to_video_and_everything_else_to_images(self):
        wan = {'1': {'class_type': 'UNETLoader', 'inputs': {'unet_name': 'wan2.2_ti2v_5B_fp16.safetensors'}}}
        sdxl = {'1': {'class_type': 'CheckpointLoaderSimple', 'inputs': {'ckpt_name': 'sd_xl_base_1.0.safetensors'}}}
        self.assertEqual(self.proxy.route(wan), 'video')
        self.assertEqual(self.proxy.route(sdxl), 'images')

    def serve(self):
        from http.server import ThreadingHTTPServer
        server = ThreadingHTTPServer(('127.0.0.1', 0), self.proxy.Handler)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        return f'http://127.0.0.1:{server.server_address[1]}'

    def test_existing_studio_comfy_execute_works_against_proxy(self):
        """The retained Studio source runs its unchanged ComfyUI client against the proxy."""
        fake = FakeClient({'ecco-studio/abc_00001_.png': b'result'}, {'outputs': [{'filename': 'abc_00001_.png', 'subfolder': 'ecco-studio'}]})
        with patch.object(self.proxy, 'rp', fake):
            base = self.serve()
            env = {'ECCO_DATA': str(self.root / 'data'), 'COMFY_URL': base, 'COMFY_ROOT': str(self.root / 'comfy')}
            with patch.dict(os.environ, env):
                sys.path.insert(0, str(REPO / 'migration/legacy'))
                spec = importlib.util.spec_from_file_location('studio_under_test', REPO / 'migration/legacy/studio.py')
                studio = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(studio)
            studio.initialize()
            job = studio.save(studio.new('job', label='test', status='running'))
            with patch.object(studio.time, 'sleep', lambda s: time.sleep(0.02)):
                paths = studio.comfy_execute(self.graph(), job['id'])
        self.assertEqual(paths[0].read_bytes(), b'result')

    def call(self, base, path, payload=None):
        data = None if payload is None else json.dumps(payload).encode()
        with urllib.request.urlopen(urllib.request.Request(base + path, data=data), timeout=5) as r:
            return json.load(r)

    def graph(self):
        return {'1': {'class_type': 'LoadImage', 'inputs': {'image': 'ecco-edit-1.png'}},
                '2': {'class_type': 'SaveImage', 'inputs': {'images': ['1', 0], 'filename_prefix': 'ecco-studio/abc'}}}

    def wait_history(self, base, pid):
        for _ in range(100):
            entry = self.call(base, '/history/' + pid).get(pid)
            if entry:
                return entry
            time.sleep(0.02)
        self.fail('history never completed')

    def test_studio_style_round_trip_writes_outputs_where_studio_reads_them(self):
        fake = FakeClient({'ecco-studio/abc_00001_.png': b'result'}, {'outputs': [{'filename': 'abc_00001_.png', 'subfolder': 'ecco-studio'}]})
        with patch.object(self.proxy, 'rp', fake):
            base = self.serve()
            pid = self.call(base, '/prompt', {'prompt': self.graph(), 'client_id': 'ecco-studio'})['prompt_id']
            entry = self.wait_history(base, pid)
        self.assertTrue(entry['status']['completed'])
        item = entry['outputs']['0']['images'][0]
        path = self.root / 'comfy/output' / item['subfolder'] / item['filename']
        self.assertEqual(path.read_bytes(), b'result')
        name, job_input = fake.submitted[0]
        self.assertEqual(name, 'images')
        self.assertEqual(base64.b64decode(job_input['files'][0]['data']), b'source')

    def test_cancel_reports_interrupted(self):
        fake = FakeClient({})
        release = threading.Event()
        original = fake.wait

        def slow_wait(*a, **kw):
            release.wait(2)
            return original(*a, **kw)
        fake.wait = slow_wait
        with patch.object(self.proxy, 'rp', fake):
            base = self.serve()
            pid = self.call(base, '/prompt', {'prompt': self.graph()})['prompt_id']
            self.call(base, f'/api/jobs/{pid}/cancel', {})
            release.set()
            entry = self.wait_history(base, pid)
        self.assertEqual(entry['status']['messages'][0][0], 'execution_interrupted')

    def test_unconfigured_endpoint_rejects_prompt(self):
        with patch.object(self.proxy, 'rp', FakeClient({}, configured=())):
            base = self.serve()
            with self.assertRaises(urllib.error.HTTPError) as caught:
                self.call(base, '/prompt', {'prompt': self.graph()})
            self.assertEqual(caught.exception.code, 400)


class LongCatDispatch(unittest.TestCase):
    def test_queued_shot_completes_through_endpoint(self):
        sys.path.insert(0, str(REPO / 'video'))
        import longcat_jobs
        import longcat_dispatch
        video = b'mp4 bytes'
        import hashlib
        fake = FakeClient({'output.mp4': video}, {'duration': 3.0, 'sha256': hashlib.sha256(video).hexdigest()})
        with tempfile.TemporaryDirectory() as temp, patch.object(longcat_jobs, 'QUEUE', Path(temp) / 'queue'):
            d = longcat_jobs.QUEUE / ('a' * 32)
            d.mkdir(parents=True)
            (d / 'image.png').write_bytes(b'png')
            (d / 'audio-source').write_bytes(b'audio')
            longcat_jobs.write(d / 'request.json', dict(prompt='Talk', pod='podx', resolution='832x480', seed=1, duration=3.0))
            longcat_jobs.write(d / 'status.json', {'status': 'queued'})
            stop = threading.Event()

            def fake_ffmpeg(command, **kw):
                Path(command[-1]).write_bytes(b'wav')
            with patch.object(longcat_dispatch.subprocess, 'run', fake_ffmpeg):
                thread = threading.Thread(target=longcat_dispatch.dispatcher, args=(longcat_jobs, 'podx', stop, fake))
                thread.start()
                for _ in range(200):
                    if longcat_jobs.read(d / 'status.json', {}).get('status') == 'complete':
                        break
                    time.sleep(0.02)
                heartbeat = longcat_jobs.read(longcat_jobs.QUEUE / 'worker-podx.json', {})
                stop.set()
                thread.join(5)
            status = longcat_jobs.read(d / 'status.json', {})
            self.assertEqual(status['status'], 'complete')
            self.assertEqual((d / 'output.mp4').read_bytes(), video)
            self.assertTrue(heartbeat['ready'])
            self.assertEqual(base64.b64decode(fake.submitted[0][1]['audio']), b'wav')

    def test_lock_held_by_real_worker_keeps_dispatcher_idle(self):
        sys.path.insert(0, str(REPO / 'video'))
        import longcat_jobs
        import longcat_dispatch
        with tempfile.TemporaryDirectory() as temp, patch.object(longcat_jobs, 'QUEUE', Path(temp) / 'queue'):
            longcat_jobs.QUEUE.mkdir(parents=True)
            held = longcat_jobs.worker_lock('podx')
            try:
                self.assertFalse(longcat_dispatch.dispatcher(longcat_jobs, 'podx', threading.Event(), FakeClient({})))
            finally:
                held.close()


class ZImageClient(unittest.TestCase):
    def test_request_file_contract_matches_zimage_worker(self):
        import zimage_client
        fake = FakeClient({'zimage.png': b'image'})
        with tempfile.TemporaryDirectory() as temp:
            request = Path(temp, 'request.json')
            request.write_text(json.dumps({'prompt': 'cat', 'negative': '', 'width': 1024, 'height': 1024, 'steps': 8, 'cfg': 4,
                                           'seed': 1, 'output_file': str(Path(temp, 'out.png')), 'progress_file': str(Path(temp, 'p.json'))}))
            zimage_client.main(request, client=fake)
            self.assertEqual(Path(temp, 'out.png').read_bytes(), b'image')
            self.assertEqual(json.loads(Path(temp, 'p.json').read_text())['progress'], 'Image saved')
            self.assertEqual(fake.submitted[0][1]['params']['prompt'], 'cat')


class Launcher(unittest.TestCase):
    def test_model_checks_point_at_volume_models(self):
        import serverless_studio
        with tempfile.TemporaryDirectory() as temp:
            models = Path(temp, 'ComfyUI/models/checkpoints')
            models.mkdir(parents=True)
            (models / 'sd_xl_base_1.0.safetensors').write_bytes(b'')
            link = serverless_studio.link_models(Path(temp, 'ComfyUI/models'), Path(temp, 'root'))
            self.assertTrue((link / 'checkpoints/sd_xl_base_1.0.safetensors').is_file())
            serverless_studio.link_models(Path(temp, 'ComfyUI/models'), Path(temp, 'root'))  # idempotent


class VolumeResults(unittest.TestCase):
    def test_result_written_through_volume_api_is_read_and_removed(self):
        with tempfile.TemporaryDirectory() as volume, tempfile.TemporaryDirectory() as dest:
            key = 'ecco-serverless/results/job.tar'
            Path(volume, key).parent.mkdir(parents=True)
            Path(volume, key).write_bytes(tar_of({'output.mp4': b'video'}))
            files = rp.unpack({'volume_key': key}, dest, volume=volume)
            self.assertEqual(files[0].read_bytes(), b'video')
            self.assertFalse(Path(volume, key).exists())

    def test_volume_key_outside_results_folder_is_refused(self):
        with tempfile.TemporaryDirectory() as volume, tempfile.TemporaryDirectory() as dest:
            with self.assertRaisesRegex(rp.ServerlessError, 'unsafe'):
                rp.unpack({'volume_key': 'ecco-studio-data/studio.sqlite'}, dest, volume=volume)
            with self.assertRaisesRegex(rp.ServerlessError, 'unsafe'):
                rp.unpack({'volume_key': 'ecco-serverless/results/../../etc/passwd'}, dest, volume=volume)

    def test_worker_uploads_large_results_to_the_volume_in_parts(self):
        calls = {}

        class Client:
            def upload_fileobj(self, fileobj, bucket, key, Config):
                calls.update(bucket=bucket, key=key, data=fileobj.read(), chunk=Config.multipart_chunksize)

        boto3 = type(sys)('boto3')
        boto3.client = lambda *a, **kw: Client()
        transfer = type(sys)('boto3.s3.transfer')

        class TransferConfig:
            def __init__(self, **kw):
                self.__dict__.update(kw)
        transfer.TransferConfig = TransferConfig
        env = {'ECCO_S3_BUCKET': 'b3qo8lps92', 'ECCO_S3_ENDPOINT_URL': 'https://s3api-eu-ro-1.runpod.io/',
               'ECCO_S3_ACCESS_KEY_ID': 'a', 'ECCO_S3_SECRET_ACCESS_KEY': 's'}
        with patch.dict(os.environ, env), patch.dict(sys.modules, {'boto3': boto3, 'boto3.s3': type(sys)('boto3.s3'),
                                                                   'boto3.s3.transfer': transfer}):
            ref = worker_common.deliver(b'tar', 'job.tar')
        self.assertEqual(ref['volume_key'], 'ecco-serverless/results/job.tar')
        self.assertEqual((calls['bucket'], calls['key'], calls['data']), ('b3qo8lps92', 'ecco-serverless/results/job.tar', b'tar'))
        self.assertLess(calls['chunk'], 500 * 1024 * 1024)


if __name__ == '__main__':
    unittest.main()
