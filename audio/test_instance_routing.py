import os
from pathlib import Path
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parent))
import audio_queue as queue
import queue_worker as worker
from audio_routing import worker_id


class InstanceRoutingTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name) / 'queue'
        self.patches = [patch.object(queue, 'ROOT', self.root), patch.object(worker, 'ROOT', self.root)]
        for p in self.patches: p.start()
        for pod in ('small', 'large'):
            queue.write(self.root.parent / 'worker-configs' / (pod + '.json'), {'name': pod, 'compute': 'cpu'})

    def tearDown(self):
        for p in self.patches: p.stop()
        self.tmp.cleanup()

    def heartbeat(self, pod, **fields):
        queue.write(self.root / ('worker-' + pod + '.json'), dict(updated=time.time(), pod=pod, compute='cpu', models=['chatterbox'], instance_routing_version=1, **fields))

    def test_selected_instance_cannot_use_another_instances_capability(self):
        self.heartbeat('small', sound_generation_version=1, sound_models=[])
        self.heartbeat('large', sound_generation_version=1, sound_models=['moss-soundeffect-v2'])
        self.assertTrue(queue.sound_ready('cpu', 'moss-soundeffect-v2', 'large'))
        self.assertFalse(queue.sound_ready('cpu', 'moss-soundeffect-v2', 'small'))
        self.assertFalse(queue.sound_ready('cpu', 'moss-soundeffect-v2', 'missing'))
        self.assertTrue(queue.ready('cpu', 'chatterbox', 'large'))
        (self.root / 'worker-large.json').unlink()
        status = queue.availability()
        self.assertEqual(len(status['instances']), 2)
        self.assertFalse(queue.target(status, 'cpu', 'large')['ready'])
        self.assertTrue(queue.target(status, 'cpu', 'small')['ready'])

    def test_old_worker_is_visible_but_not_instance_routable(self):
        queue.write(self.root / 'worker-small.json', dict(updated=time.time(), pod='small', compute='cpu', models=['chatterbox']))
        self.assertFalse(queue.ready('cpu', 'chatterbox', 'small'))
        self.assertFalse(queue.target(queue.availability(), 'cpu', 'small')['ready'])

    def test_claim_is_exclusive_and_respects_exact_worker(self):
        d = self.root / ('a' * 32)
        request = dict(compute='cpu', worker_id='large', model='chatterbox')
        queue.write(d / 'request.json', request)
        queue.write(d / 'status.json', {'status': 'queued'})
        with worker.claim_job(d, 'cpu', 'small', ['chatterbox'], []) as wrong:
            self.assertIsNone(wrong)
        with worker.claim_job(d, 'cpu', 'large', ['chatterbox'], []) as right:
            self.assertEqual(right, request)
            with worker.claim_job(d, 'cpu', 'large', ['chatterbox'], []) as duplicate:
                self.assertIsNone(duplicate)
        self.assertEqual(queue.read(d / 'status.json')['worker_pod'], 'large')
        worker.recover_jobs('cpu', 'small')
        self.assertEqual(queue.read(d / 'status.json')['status'], 'running')
        worker.recover_jobs('cpu', 'large')
        self.assertEqual(queue.read(d / 'status.json')['status'], 'error')

    def test_invalid_worker_identifiers_are_rejected(self):
        for invalid in ('../large', 'cpu:large', ['large'], 'a' * 81):
            with self.assertRaises(ValueError): worker_id(invalid)


if __name__ == '__main__': unittest.main()
