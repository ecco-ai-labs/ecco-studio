import io
import json
import os
import tempfile
import unittest
import urllib.error
from pathlib import Path
from unittest.mock import patch

import serverless_power as power


class Reply:
    def __init__(self, body):
        self.body = json.dumps(body).encode()

    def __enter__(self):
        return io.BytesIO(self.body)

    def __exit__(self, *exc):
        return False


class FakeRunPod:
    """Records every RunPod call; answers from a script of replies (or exceptions), else {}."""

    def __init__(self, *replies):
        self.replies, self.calls = list(replies), []

    def __call__(self, request, timeout):
        body = json.loads(request.data) if request.data else None
        self.calls.append((request.get_method(), request.full_url, body))
        reply = self.replies.pop(0) if self.replies else {}
        if isinstance(reply, Exception):
            raise reply
        return Reply(reply)

    def patches(self):
        return [c for c in self.calls if c[0] == 'PATCH']


def http_error(code, body=b'{}'):
    return urllib.error.HTTPError('https://rest.runpod.io', code, 'error', {}, io.BytesIO(body))


CLIENT_A, CLIENT_B = 'browser-aaaaaaaa', 'browser-bbbbbbbb'
ENDPOINTS = {'ECCO_ENDPOINT_IMAGES': 'img1', 'ECCO_ENDPOINT_VIDEO': 'vid1', 'ECCO_ENDPOINT_AUDIO': 'aud1'}


class ServerlessPowerTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.env = patch.dict(os.environ, {'ECCO_RUNPOD_MANAGE_KEY': 'secret-key', 'ECCO_RUNPOD_KEY_FILE': '/nonexistent',
                                           'ECCO_STUDIO_DB': '/nonexistent.sqlite', **ENDPOINTS})
        self.env.start()
        os.environ.pop('ECCO_WARM_ENDPOINTS', None)
        self.file = patch.object(power, 'STATE_FILE', Path(self.temp.name) / 'power.json')
        self.file.start()
        power._health.update(at=0.0, value=None)

    def tearDown(self):
        self.file.stop()
        self.env.stop()
        self.temp.cleanup()

    def on(self, runpod, client=CLIENT_A, at=1000, reason='sign-in'):
        return power.power({'on': True, 'client': client, 'reason': reason}, opener=runpod, now=lambda: at, wake_jobs=False)

    def test_on_warms_image_video_and_audio_and_off_releases_all(self):
        runpod = FakeRunPod()
        reply = self.on(runpod)
        self.assertTrue(reply['on'])
        self.assertEqual(reply['endpoints'], ['audio', 'images', 'video'])
        self.assertEqual({(c[1].rsplit('/', 1)[1], c[2]['workersMin']) for c in runpod.patches()},
                         {('img1', 1), ('vid1', 1), ('aud1', 1)})
        reply = power.power({'on': False, 'client': CLIENT_A, 'reason': 'button'}, opener=runpod, now=lambda: 1100)
        self.assertFalse(reply['on'])
        self.assertEqual({(c[1].rsplit('/', 1)[1], c[2]['workersMin']) for c in runpod.patches()[3:]},
                         {('img1', 0), ('vid1', 0), ('aud1', 0)})

    def test_turning_on_twice_calls_runpod_once(self):
        runpod = FakeRunPod()
        self.on(runpod)
        self.on(runpod, CLIENT_B, 1010)
        self.assertEqual(len(runpod.patches()), 3)

    def test_one_refused_endpoint_still_turns_on_and_reports_it(self):
        runpod = FakeRunPod({}, http_error(400, b'{"error":"worker limit"}'), {})
        reply = self.on(runpod)
        self.assertTrue(reply['on'])
        self.assertIn('worker limit', reply['not_warmed']['video'])

    def test_all_refused_leaves_it_off(self):
        refusal = http_error(400, b'{"error":"workersMin exceeds account limit"}')
        with self.assertRaises(power.PowerError) as caught:
            self.on(FakeRunPod(refusal, http_error(400), http_error(400)))
        self.assertIn('workersMin exceeds account limit', caught.exception.message)
        self.assertFalse(power.status(now=lambda: 1001)['on'])

    def test_off_that_fails_somewhere_stays_on_so_it_is_retried(self):
        runpod = FakeRunPod()
        self.on(runpod)
        runpod.replies = [{}, http_error(500, b'busy'), {}]
        with self.assertRaises(power.PowerError):
            power.power({'on': False, 'reason': 'button'}, opener=runpod, now=lambda: 1100)
        self.assertTrue(power.status(now=lambda: 1101)['on'])

    def test_rest_unauthorized_falls_back_to_graphql_keeping_settings(self):
        os.environ['ECCO_WARM_ENDPOINTS'] = 'images'
        endpoint = {'id': 'img1', 'name': 'images', 'gpuIds': 'ADA_48', 'idleTimeout': 5, 'locations': None,
                    'networkVolumeId': 'vol1', 'scalerType': 'QUEUE_DELAY', 'scalerValue': 4, 'templateId': 'tpl',
                    'workersMax': 3, 'workersMin': 0}
        runpod = FakeRunPod(http_error(401), {'data': {'myself': {'endpoints': [endpoint]}}},
                            {'data': {'saveEndpoint': {'id': 'img1', 'workersMin': 1}}})
        self.on(runpod)
        saved = runpod.calls[2][2]['variables']['input']
        self.assertEqual((saved['workersMin'], saved['workersMax'], saved['templateId']), (1, 3, 'tpl'))
        self.assertNotIn('locations', saved)

    def test_image_and_video_wakeups_go_through_the_bridge_and_audio_gets_none(self):
        runpod = FakeRunPod({'prompt_id': 'p-img'}, {'prompt_id': 'p-vid'})
        with patch.object(power, 'AUDIO_QUEUE', Path(self.temp.name) / 'queue'):
            sent = power.wake(opener=runpod, now=lambda: 5)
            self.assertEqual((sent['images'], sent['video']), ('p-img', 'p-vid'))
            self.assertEqual([c[1] for c in runpod.calls], ['http://127.0.0.1:8188/prompt'] * 2)
            image, video = (c[2]['prompt'] for c in runpod.calls)
            self.assertEqual(image['1']['inputs']['unet_name'], 'qwen_image_2512_fp8_e4m3fn.safetensors')
            self.assertEqual(image['8']['inputs']['steps'], 1)
            self.assertEqual(video['1']['inputs']['unet_name'], 'wan2.2_ti2v_5B_fp16.safetensors')
            self.assertNotIn('start_image', video['8']['inputs'])
            self.assertNotIn('audio', sent)
            self.assertFalse((Path(self.temp.name) / 'queue').exists())

    def test_a_failed_wakeup_is_reported_not_raised(self):
        os.environ['ECCO_WARM_ENDPOINTS'] = 'images,video'
        sent = power.wake(opener=FakeRunPod(urllib.error.URLError('refused'), {'prompt_id': 'v'}))
        self.assertTrue(sent['images'].startswith('error:'))
        self.assertEqual(sent['video'], 'v')

    def test_cleanup_leaves_real_audio_jobs_alone(self):
        queue = Path(self.temp.name) / 'queue'
        job = queue / ('a' * 32)
        job.mkdir(parents=True)
        (job / 'request.json').write_text('{"model": "chatterbox"}')
        (job / 'status.json').write_text('{"status": "done"}')
        with patch.object(power, 'AUDIO_QUEUE', queue):
            self.assertEqual(power.cleanup_wakeups(now=lambda: 10 ** 10), 0)
        self.assertTrue(job.exists())

    def test_sign_out_keeps_it_on_while_another_browser_is_active(self):
        runpod = FakeRunPod()
        self.on(runpod)
        power.heartbeat({'client': CLIENT_B, 'active': True}, now=lambda: 1100)
        reply = power.power({'on': False, 'client': CLIENT_A, 'reason': 'sign-out'}, opener=runpod, now=lambda: 1200,
                            jobs=lambda: 0)
        self.assertEqual((reply['on'], reply['kept_on_for_others']), (True, 1))
        reply = power.power({'on': False, 'client': CLIENT_B, 'reason': 'sign-out'}, opener=runpod, now=lambda: 1300,
                            jobs=lambda: 0)
        self.assertFalse(reply['on'])

    def test_sign_out_waits_for_running_jobs_then_turns_off(self):
        runpod = FakeRunPod()
        self.on(runpod)
        reply = power.power({'on': False, 'client': CLIENT_A, 'reason': 'sign-out'}, opener=runpod, now=lambda: 1100,
                            jobs=lambda: 2)
        self.assertEqual((reply['on'], reply['kept_on_for_jobs'], reply['off_when_done']), (True, 2, True))
        self.assertFalse(power.tick(opener=runpod, now=lambda: 1160, jobs=lambda: 1))
        self.assertTrue(power.tick(opener=runpod, now=lambda: 1220, jobs=lambda: 0))
        state = power.status(now=lambda: 1221)
        self.assertEqual((state['on'], state['reason']), (False, 'sign-out'))

    def test_signing_in_again_cancels_a_pending_sign_out(self):
        runpod = FakeRunPod()
        self.on(runpod)
        power.power({'on': False, 'client': CLIENT_A, 'reason': 'sign-out'}, opener=runpod, now=lambda: 1100, jobs=lambda: 1)
        self.on(runpod, CLIENT_A, 1150)
        power.settings({'auto_off_minutes': None}, now=lambda: 1150)
        self.assertFalse(power.tick(opener=runpod, now=lambda: 9999, jobs=lambda: 0))

    def test_button_off_turns_off_even_with_other_browsers_and_jobs(self):
        runpod = FakeRunPod()
        self.on(runpod)
        power.heartbeat({'client': CLIENT_B, 'active': True}, now=lambda: 1100)
        self.assertFalse(power.power({'on': False, 'reason': 'button'}, opener=runpod, now=lambda: 1200, jobs=lambda: 3)['on'])

    def test_auto_off_defaults_to_30_minutes(self):
        runpod = FakeRunPod()
        self.on(runpod)
        power.heartbeat({'client': CLIENT_A, 'active': True}, now=lambda: 1500)
        self.assertEqual(power.status(now=lambda: 1501)['auto_off_minutes'], 30)
        self.assertFalse(power.tick(opener=runpod, now=lambda: 1500 + 29 * 60, jobs=lambda: 0))
        self.assertFalse(power.tick(opener=runpod, now=lambda: 1500 + 31 * 60, jobs=lambda: 1))
        self.assertTrue(power.tick(opener=runpod, now=lambda: 1500 + 31 * 60, jobs=lambda: 0))
        self.assertEqual(power.status(now=lambda: 1)['reason'], 'idle')

    def test_auto_off_never_keeps_it_on_when_idle(self):
        runpod = FakeRunPod()
        self.on(runpod)
        reply = power.settings({'auto_off_minutes': None, 'client': CLIENT_A}, now=lambda: 1100)
        self.assertIsNone(reply['auto_off_minutes'])
        self.assertNotIn('auto_off_at', reply)
        self.assertFalse(power.tick(opener=runpod, now=lambda: 1100 + 48 * 3600, jobs=lambda: 0))
        self.assertTrue(power.status(now=lambda: 1)['on'])

    def test_auto_off_setting_is_workspace_wide_and_survives_restart(self):
        power.settings({'auto_off_minutes': None}, now=lambda: 1)
        self.assertIsNone(json.loads(power.STATE_FILE.read_text())['auto_off_minutes'])
        with self.assertRaises(power.PowerError):
            power.settings({'auto_off_minutes': 5}, now=lambda: 1)
        power.settings({'auto_off_minutes': 30}, now=lambda: 2)
        self.assertEqual(power.status(now=lambda: 3)['auto_off_minutes'], 30)

    def test_state_reports_auto_off_time(self):
        self.on(FakeRunPod())
        self.assertEqual(power.status(now=lambda: 1001)['auto_off_at'], 1000 + 30 * 60)

    def test_rejects_bad_requests_and_ignores_bad_client_ids(self):
        with self.assertRaises(power.PowerError):
            power.power({'on': 'yes'}, opener=FakeRunPod(), now=lambda: 1)
        power.heartbeat({'client': '../etc', 'active': True}, now=lambda: 1)
        self.assertEqual(power._load()['clients'], {})

    def test_health_counts_workers_per_endpoint(self):
        os.environ['ECCO_WARM_ENDPOINTS'] = 'images'
        runpod = FakeRunPod({'workers': {'idle': 1, 'running': 0, 'initializing': 0}})
        self.assertEqual(power.health(opener=runpod, now=lambda: 5), {'images': {'idle': 1, 'running': 0, 'initializing': 0}})
        self.assertEqual(runpod.calls[0][1], 'https://api.runpod.ai/v2/img1/health')


if __name__ == '__main__':
    unittest.main()
