import json
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError

import google_signin
import workspace_access as access
from test_storage_api import StorageTest


class MembershipTest(unittest.TestCase):
    def setUp(self):
        access._cache.clear()
        self.identity = {'user': {'id': 'google:123'}, 'email_verified': True,
                         'hosted_domain': 'example.org'}
        self.config = {'enabled': True, 'service_account_file': '/test-only', 'delegated_admin': 'admin@example.org', 'domain': 'example.org', 'group': 'testers@example.org'}

    def test_unverified_and_wrong_domain_denied_before_lookup(self):
        for changes in ({'email_verified': False}, {'hosted_domain': 'evil.example'}):
            with patch.object(access, 'configuration', return_value=self.config), patch.object(access, 'lookup') as lookup, self.assertRaises(access.AccessError):
                access.authorize({**self.identity, **changes})
            lookup.assert_not_called()

    def test_missing_or_disabled_configuration_denies(self):
        with tempfile.TemporaryDirectory() as directory:
            with patch.object(access, 'CONFIG', Path(directory) / 'config.json'):
                with self.assertRaises(access.AccessError): access.authorize(self.identity)
                Path(access.CONFIG).write_text('{"enabled": false}')
                with self.assertRaises(access.AccessError): access.authorize(self.identity)

    def test_membership_is_bound_to_subject_and_revoked_after_cache(self):
        with patch.object(access, 'configuration', return_value=self.config), patch.object(access, 'lookup', side_effect=[True, False]) as lookup:
            self.assertFalse(access.authorize(self.identity)['gpu_power'])
            access.authorize(self.identity)
            lookup.assert_called_once_with(self.config, '123')
            with patch.object(access.time, 'monotonic', return_value=time.monotonic()+61):
                with self.assertRaises(access.AccessError): access.authorize(self.identity)

    def test_directory_failure_has_no_stale_success_fallback(self):
        with patch.object(access, 'configuration', return_value=self.config), patch.object(access, 'lookup', side_effect=RuntimeError('private detail')):
            with self.assertRaises(access.AccessError) as error: access.authorize(self.identity)
            self.assertEqual(error.exception.status, 503)
            self.assertNotIn('private detail', str(error.exception))


class TesterHTTPTest(StorageTest):
    def setUp(self):
        super().setUp()
        pending = google_signin.challenge()
        claims = {'sub': 'tester', 'email': 'tester@example.org', 'email_verified': True,
                  'hd': 'example.org', 'aud': google_signin.CLIENT_ID, 'iss': 'https://accounts.google.com',
                  'exp': time.time()+3600, 'nonce': pending['nonce']}
        with patch.object(google_signin, 'verifier', return_value=claims):
            self.token = google_signin.login({'challenge': pending['challenge'], 'credential': 'test'})['session_token']
        self.membership = patch.object(access, 'authorize', return_value={'role': 'tester', 'gpu_power': False})
        self.membership.start()

    def tearDown(self):
        self.membership.stop()
        super().tearDown()

    def call_tester(self, path, body=None):
        return self.call(path, body, auth=False, extra={'Authorization': 'Bearer '+self.token})

    def test_tester_storage_and_ai_allowed_no_owner_key_returned(self):
        for path in ('/api/state', '/api/workspace/access', '/api/ai/status'):
            with self.call_tester(path) as response:
                body = response.read().decode()
                self.assertNotIn(self.server.RequestHandlerClass.access_key, body)
        # Use the module loaded by the base test, not another handler instance.
        from test_storage_api import api
        with patch.object(api.openai_assistant, 'handle', return_value={'text': 'test'}) as enhance:
            with self.call_tester('/api/ai/enhance', {'text': 'test'}): pass
            enhance.assert_called_once()

    def test_tester_admin_routes_denied_even_with_forged_role(self):
        for path in ('/api/gpu/start', '/api/gpu/stop', '/api/gpu/create', '/api/power',
                     '/api/billing/connect', '/api/ai/connect', '/api/ai/settings', '/api/ai/disconnect',
                     '/api/youtube/publish', '/api/youtube/configure', '/api/audio/workflows/control',
                     '/api/purge', '/api/trash/empty'):
            with self.assertRaises(HTTPError) as error:
                self.call_tester(path, {'role': 'owner', 'admin': True})
            self.assertEqual(error.exception.code, 403, path)

    def test_gpu_relay_cannot_tunnel_power_command(self):
        with self.assertRaises(HTTPError) as error:
            self.call_tester('/api/gpu/request', {'gpu': 'p7lc6fqjuosti3', 'path': 'power/start', 'body': {}})
        self.assertEqual(error.exception.code, 400)

    def test_logout_denies_existing_token(self):
        google_signin.session('Bearer '+self.token, logout=True)
        with self.assertRaises(HTTPError) as error: self.call_tester('/api/state')
        self.assertEqual(error.exception.code, 401)

    def test_revoked_membership_denies_existing_session(self):
        with patch.object(access, 'authorize', side_effect=access.AccessError('Revoked')):
            with self.assertRaises(HTTPError) as error: self.call_tester('/api/state')
            self.assertEqual(error.exception.code, 403)

    # Base class test intentionally tests an unprivileged identity; restore real policy.
    def test_google_identity_cannot_access_workspace(self):
        self.membership.stop()
        super().test_google_identity_cannot_access_workspace()


if __name__ == '__main__': unittest.main()
