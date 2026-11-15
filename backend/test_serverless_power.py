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
    """Records every RunPod call; answers from a script of replies (or exceptions)."""

    def __init__(self, *replies):
        self.replies, self.calls = list(replies), []

    def __call__(self, request, timeout):
        body = json.loads(request.data) if request.data else None
        self.calls.append((request.get_method(), request.full_url, body))
        reply = self.replies.pop(0) if self.replies else {}
        if isinstance(reply, Exception):
            raise reply
        return Reply(reply)


def http_error(code, body=b'{}'):
    return urllib.error.HTTPError('https://rest.runpod.io', code, 'error', {}, io.BytesIO(body))


CLIENT_A, CLIENT_B = 'browser-aaaaaaaa', 'browser-bbbbbbbb'


class ServerlessPowerTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.env = patch.dict(os.environ, {'ECCO_RUNPOD_MANAGE_KEY': 'secret-key', 'ECCO_RUNPOD_KEY_FILE': '/nonexistent',
                                           'ECCO_WARM_ENDPOINTS': 'img123', 'ECCO_SERVERLESS_IDLE_MINUTES': '20'})
        self.env.start()
        self.file = patch.object(power, 'STATE_FILE', Path(self.temp.name) / 'power.json')
        self.file.start()
        power._health.update(at=0.0, value=None)

    def tearDown(self):
        self.file.stop()
        self.env.stop()
        self.temp.cleanup()

    def test_on_sets_one_warm_worker_and_off_sets_zero(self):
        runpod = FakeRunPod({}, {})
        reply = power.power({'on': True, 'client': CLIENT_A, 'reason': 'sign-in'}, opener=runpod, now=lambda: 1000)
        self.assertTrue(reply['on'])
        self.assertEqual(reply['reason'], 'sign-in')
        self.assertEqual(runpod.calls[0], ('PATCH', 'https://rest.runpod.io/v1/endpoints/img123', {'workersMin': 1}))
        reply = power.power({'on': False, 'client': CLIENT_A, 'reason': 'button'}, opener=runpod, now=lambda: 1100)
        self.assertFalse(reply['on'])
        self.assertEqual(runpod.calls[1], ('PATCH', 'https://rest.runpod.io/v1/endpoints/img123', {'workersMin': 0}))

    def test_turning_on_twice_calls_runpod_once(self):
        runpod = FakeRunPod({})
        power.power({'on': True, 'client': CLIENT_A}, opener=runpod, now=lambda: 1000)
        power.power({'on': True, 'client': CLIENT_B}, opener=runpod, now=lambda: 1010)
        self.assertEqual(len(runpod.calls), 1)

    def test_runpod_refusal_leaves_state_unchanged(self):
        runpod = FakeRunPod(http_error(400, b'{"error":"workersMin exceeds account limit"}'))
        with self.assertRaises(power.PowerError) as caught:
            power.power({'on': True, 'client': CLIENT_A}, opener=runpod, now=lambda: 1000)
        self.assertIn('workersMin exceeds account limit', caught.exception.message)
        self.assertFalse(power.status(now=lambda: 1001)['on'])

    def test_rest_unauthorized_falls_back_to_graphql_keeping_settings(self):
        endpoint = {'id': 'img123', 'name': 'images', 'gpuIds': 'ADA_48', 'idleTimeout': 5, 'locations': None,
                    'networkVolumeId': 'vol1', 'scalerType': 'QUEUE_DELAY', 'scalerValue': 4, 'templateId': 'tpl',
                    'workersMax': 3, 'workersMin': 0}
        runpod = FakeRunPod(http_error(401), {'data': {'myself': {'endpoints': [endpoint]}}},
                            {'data': {'saveEndpoint': {'id': 'img123', 'workersMin': 1}}})
        power.power({'on': True, 'client': CLIENT_A}, opener=runpod, now=lambda: 1000)
        saved = runpod.calls[2][2]['variables']['input']
        self.assertEqual(saved['workersMin'], 1)
        self.assertEqual(saved['workersMax'], 3)
        self.assertEqual(saved['templateId'], 'tpl')
        self.assertNotIn('locations', saved)

    def test_sign_out_keeps_it_on_while_another_browser_is_active(self):
        runpod = FakeRunPod({}, {})
        power.power({'on': True, 'client': CLIENT_A, 'reason': 'sign-in'}, opener=runpod, now=lambda: 1000)
        power.heartbeat({'client': CLIENT_B, 'active': True}, now=lambda: 1100)
        reply = power.power({'on': False, 'client': CLIENT_A, 'reason': 'sign-out'}, opener=runpod, now=lambda: 1200)
        self.assertTrue(reply['on'])
        self.assertEqual(reply['kept_on_for_others'], 1)
        self.assertEqual(len(runpod.calls), 1)
        reply = power.power({'on': False, 'client': CLIENT_B, 'reason': 'sign-out'}, opener=runpod, now=lambda: 1300)
        self.assertFalse(reply['on'])
        self.assertEqual(runpod.calls[1][2], {'workersMin': 0})

    def test_button_off_turns_off_even_with_other_browsers(self):
        runpod = FakeRunPod({}, {})
        power.power({'on': True, 'client': CLIENT_A}, opener=runpod, now=lambda: 1000)
        power.heartbeat({'client': CLIENT_B, 'active': True}, now=lambda: 1100)
        self.assertFalse(power.power({'on': False, 'client': CLIENT_A, 'reason': 'button'}, opener=runpod, now=lambda: 1200)['on'])

    def test_idle_watchdog_turns_off_after_idle_minutes(self):
        runpod = FakeRunPod({}, {})
        power.power({'on': True, 'client': CLIENT_A}, opener=runpod, now=lambda: 1000)
        power.heartbeat({'client': CLIENT_A, 'active': True}, now=lambda: 1500)
        power.heartbeat({'client': CLIENT_A, 'active': False}, now=lambda: 2000)
        self.assertFalse(power.tick(opener=runpod, now=lambda: 1500 + 19 * 60, jobs=lambda: 0))
        self.assertFalse(power.tick(opener=runpod, now=lambda: 1500 + 21 * 60, jobs=lambda: 1))
        self.assertTrue(power.tick(opener=runpod, now=lambda: 1500 + 21 * 60, jobs=lambda: 0))
        state = power.status(now=lambda: 1500 + 21 * 60)
        self.assertFalse(state['on'])
        self.assertEqual(state['reason'], 'idle')
        self.assertEqual(runpod.calls[-1][2], {'workersMin': 0})

    def test_state_survives_restart_and_reports_auto_off(self):
        power.power({'on': True, 'client': CLIENT_A}, opener=FakeRunPod({}), now=lambda: 1000)
        state = json.loads(power.STATE_FILE.read_text())
        self.assertTrue(state['on'])
        self.assertEqual(power.status(now=lambda: 1001)['auto_off_at'], 1000 + 20 * 60)

    def test_rejects_bad_requests_and_ignores_bad_client_ids(self):
        with self.assertRaises(power.PowerError):
            power.power({'on': 'yes'}, opener=FakeRunPod(), now=lambda: 1)
        power.heartbeat({'client': '../etc', 'active': True}, now=lambda: 1)
        self.assertEqual(power._load()['clients'], {})

    def test_health_counts_loaded_workers(self):
        runpod = FakeRunPod({'workers': {'idle': 1, 'running': 0, 'initializing': 0}})
        self.assertEqual(power.health(opener=runpod, now=lambda: 5), {'idle': 1, 'running': 0, 'initializing': 0})
        self.assertEqual(runpod.calls[0][1], 'https://api.runpod.ai/v2/img123/health')


if __name__ == '__main__':
    unittest.main()
