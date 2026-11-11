"""Listen-back jobs on the queue worker: GPU only, Whisper in the IndicF5 environment, transcript output."""
import hashlib
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parent))
import audio_queue as queue
import listen_worker
import queue_worker as worker


class ListenBackTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.base = Path(self.tmp.name)
        self.root = self.base / 'queue'
        self.patches = [patch.object(queue, 'ROOT', self.root), patch.object(worker, 'ROOT', self.root),
                        patch.dict(os.environ, {'ECCO_AUDIO_VENVS': str(self.base)})]
        for p in self.patches:
            p.start()

    def tearDown(self):
        for p in self.patches:
            p.stop()
        self.tmp.cleanup()

    def job(self, compute='b200'):
        d = self.root / ('b' * 32)
        request = {'task': 'listen', 'listen_version': 1, 'model': 'whisper-large-v3-turbo', 'compute': compute, 'language': 'English',
                   'input': {'sha256': 'x', 'path': '/api/audio/auto/listen-input/' + 'c' * 32}}
        queue.write(d / 'request.json', request)
        queue.write(d / 'status.json', {'status': 'queued'})
        return d, request

    def test_ready_only_on_gpu_with_environment_and_cached_weights(self):
        self.assertFalse(worker.listen_ready('b200', self.base))
        (self.base / 'indicf5-venv/bin').mkdir(parents=True)
        (self.base / 'indicf5-venv/bin/python').write_text('')
        self.assertFalse(worker.listen_ready('b200', self.base))
        (self.base / 'hf-cache/hub/models--openai--whisper-large-v3-turbo').mkdir(parents=True)
        self.assertTrue(worker.listen_ready('b200', self.base))
        self.assertFalse(worker.listen_ready('cpu', self.base))

    def test_claim_needs_listen_capability(self):
        d, request = self.job()
        with worker.claim_job(d, 'b200', 'gpu', ['voxcpm2'], [], False) as claimed:
            self.assertIsNone(claimed)
        with worker.claim_job(d, 'b200', 'gpu', ['voxcpm2'], [], True) as claimed:
            self.assertEqual(claimed, request)
        self.assertEqual(queue.read(d / 'status.json')['progress'], 'Listening back')

    def test_command_uses_indicf5_environment_offline(self):
        d, request = self.job()
        (self.base / 'indicf5-venv/bin').mkdir(parents=True)
        (self.base / 'indicf5-venv/bin/python').write_text('')
        command, env = worker.worker_command(request, d)
        self.assertEqual(command[0], str(self.base / 'indicf5-venv/bin/python'))
        self.assertEqual(Path(command[1]).name, 'listen_worker.py')
        self.assertEqual(command[-1], str(d / 'output.json'))
        self.assertEqual(env['HF_HUB_OFFLINE'], '1')
        with self.assertRaises(RuntimeError):
            worker.worker_command({**request, 'compute': 'cpu'}, d)

    def test_worker_prefers_the_verified_local_copy(self):
        d, request = self.job()
        (d / 'input.wav').write_bytes(b'audio')
        request['input']['sha256'] = hashlib.sha256(b'audio').hexdigest()
        self.assertEqual(listen_worker.source(request, d), d / 'input.wav')
        request['input']['sha256'] = '0' * 64
        with self.assertRaises(RuntimeError):
            listen_worker.source(request, d)   # no HTTPS link to fall back to


if __name__ == '__main__':
    unittest.main()
