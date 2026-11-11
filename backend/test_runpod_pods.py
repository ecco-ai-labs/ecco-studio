import io
import json
import os
import tempfile
import time
import unittest
import urllib.error
from pathlib import Path
from unittest.mock import patch

import gpu_relay
import runpod_pods


class Reply:
    def __init__(self, body):
        self.body = json.dumps(body).encode()

    def __enter__(self):
        return io.BytesIO(self.body)

    def __exit__(self, *exc):
        return False


def pod(pid, status='EXITED', runtime=None, cost=5.98):
    return {'id': pid, 'name': 'pod-' + pid, 'desiredStatus': status, 'costPerHr': cost, 'gpuCount': 1,
            'runtime': runtime, 'machine': {'gpuDisplayName': 'B200'}}


class FakeRunPod:
    """Records GraphQL calls; answers from a script of replies."""

    def __init__(self, *replies):
        self.replies, self.calls = list(replies), []

    def __call__(self, request, timeout):
        self.calls.append((request.full_url, json.loads(request.data), dict(request.header_items())))
        reply = self.replies.pop(0)
        if isinstance(reply, Exception):
            raise reply
        return Reply(reply)


class PodsTest(unittest.TestCase):
    def setUp(self):
        runpod_pods._cache.update(at=0.0, pods=None)
        self.env = patch.dict(os.environ, {'RUNPOD_API_KEY': 'secret-key'})
        self.env.start()
        self.temp = tempfile.TemporaryDirectory()
        self.relay = patch.object(gpu_relay, 'ROOT', Path(self.temp.name) / 'relay')
        self.relay.start()
        self.audio = patch.dict(os.environ, {'ECCO_AUDIO_QUEUE': str(Path(self.temp.name) / 'audio')})
        self.audio.start()

    def tearDown(self):
        self.audio.stop()
        self.relay.stop()
        self.env.stop()
        self.temp.cleanup()

    def test_lists_only_managed_pods_with_state_and_rate(self):
        api = FakeRunPod({'data': {'myself': {'pods': [
            pod('io8sphjo10kbuy'), pod('1muqctw9bxvguu', 'RUNNING', {'uptimeInSeconds': 2520}, 1.39),
            pod('p7lc6fqjuosti3', 'RUNNING', None), pod('someoneelse1234', 'RUNNING', {'uptimeInSeconds': 9})]}}})
        listed = {p['id']: p for p in runpod_pods.pods(opener=api)['pods']}
        self.assertEqual(set(listed), {'io8sphjo10kbuy', '1muqctw9bxvguu', 'p7lc6fqjuosti3'})
        self.assertEqual(listed['io8sphjo10kbuy']['state'], 'stopped')
        self.assertEqual(listed['1muqctw9bxvguu']['state'], 'running')
        self.assertEqual(listed['1muqctw9bxvguu']['uptime_seconds'], 2520)
        self.assertEqual(listed['1muqctw9bxvguu']['rate_per_hour'], 1.39)
        self.assertEqual(listed['p7lc6fqjuosti3']['state'], 'starting')
        url, _, headers = api.calls[0]
        self.assertEqual(url, runpod_pods.API)
        self.assertEqual(headers['Authorization'], 'Bearer secret-key')

    def test_status_is_cached_briefly(self):
        api = FakeRunPod({'data': {'myself': {'pods': [pod('io8sphjo10kbuy')]}}})
        clock = [100.0]
        runpod_pods.pods(opener=api, now=lambda: clock[0])
        runpod_pods.pods(opener=api, now=lambda: clock[0] + 5)
        self.assertEqual(len(api.calls), 1)

    def test_start_sends_podresume_with_gpu_count(self):
        api = FakeRunPod({'data': {'myself': {'pods': [pod('io8sphjo10kbuy')]}}},
                         {'data': {'podResume': pod('io8sphjo10kbuy', 'RUNNING')}})
        result = runpod_pods.start({'gpu': 'io8sphjo10kbuy'}, opener=api)
        self.assertEqual(result['pod']['state'], 'starting')
        mutation = api.calls[1][1]
        self.assertIn('podResume', mutation['query'])
        self.assertEqual(mutation['variables'], {'input': {'podId': 'io8sphjo10kbuy', 'gpuCount': 1}})

    def test_no_free_gpu_message_is_passed_through_word_for_word(self):
        message = 'There are not enough free GPUs on the host machine to start this pod.'
        api = FakeRunPod({'data': {'myself': {'pods': [pod('io8sphjo10kbuy')]}}},
                         {'errors': [{'message': message}], 'data': {'podResume': None}})
        with self.assertRaises(runpod_pods.PodError) as raised:
            runpod_pods.start({'gpu': 'io8sphjo10kbuy'}, opener=api)
        self.assertEqual(raised.exception.message, message)
        self.assertEqual(raised.exception.code, 409)

    def test_already_running_is_not_started_again(self):
        api = FakeRunPod({'data': {'myself': {'pods': [pod('io8sphjo10kbuy', 'RUNNING', {'uptimeInSeconds': 5})]}}})
        self.assertTrue(runpod_pods.start({'gpu': 'io8sphjo10kbuy'}, opener=api)['already'])
        self.assertEqual(len(api.calls), 1)

    def test_stop_sends_podstop(self):
        api = FakeRunPod({'data': {'podStop': {'id': '1muqctw9bxvguu', 'desiredStatus': 'EXITED'}}})
        self.assertEqual(runpod_pods.stop({'gpu': '1muqctw9bxvguu'}, opener=api)['pod']['state'], 'stopped')
        self.assertIn('podStop', api.calls[0][1]['query'])

    def test_only_ecco_pods_and_never_serverless(self):
        for gpu in ('serverless', 'someoneelse1234', None):
            with self.assertRaises(runpod_pods.PodError):
                runpod_pods.start({'gpu': gpu}, opener=FakeRunPod())
            with self.assertRaises(runpod_pods.PodError):
                runpod_pods.stop({'gpu': gpu}, opener=FakeRunPod())

    def test_missing_key_is_a_clear_setup_error(self):
        with patch.dict(os.environ, {'RUNPOD_API_KEY': ''}):
            with self.assertRaises(runpod_pods.PodError) as raised:
                runpod_pods.pods(opener=FakeRunPod())
        self.assertEqual(raised.exception.code, 503)

    def test_unreachable_runpod(self):
        with self.assertRaises(runpod_pods.PodError) as raised:
            runpod_pods.pods(opener=FakeRunPod(urllib.error.URLError('down')))
        self.assertIn('Could not reach RunPod', raised.exception.message)

    def test_active_jobs_counts_running_relay_and_audio_work(self):
        relay = gpu_relay.ROOT / '1muqctw9bxvguu'
        relay.mkdir(parents=True)
        gpu_relay.write(relay / ('a' * 32 + '.working'), {'path': 'images', 'body': {}})        # running
        gpu_relay.write(relay / ('b' * 32 + '.working'), {'completed': time.time()})           # finished marker
        gpu_relay.write(relay / ('c' * 32 + '.working'), {'path': 'images', 'body': {}})
        gpu_relay.write(relay / ('c' * 32 + '.result'), {'status': 'done'})                    # has a result
        audio = Path(os.environ['ECCO_AUDIO_QUEUE']) / ('d' * 32)
        audio.mkdir(parents=True)
        gpu_relay.write(audio / 'status.json', {'status': 'running', 'worker_pod': '1muqctw9bxvguu'})
        self.assertEqual(runpod_pods.active_jobs('1muqctw9bxvguu'), 2)
        self.assertEqual(runpod_pods.active_jobs('io8sphjo10kbuy'), 0)


if __name__ == '__main__':
    unittest.main()
