import base64
import hashlib
import json
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import Mock, patch
from urllib.parse import parse_qs, urlsplit

import storage_api as api
import youtube_connection as yt
from google.oauth2.credentials import Credentials


class YouTubeConnectionTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.client_file = Path(self.tmp.name) / 'client.json'
        self.token_file = Path(self.tmp.name) / 'private' / 'token.json'
        self.config = {'web': {'client_id': yt.google_signin.CLIENT_ID,
                              'client_secret': 'fixture-secret',
                              'auth_uri': 'https://accounts.google.com/o/oauth2/auth',
                              'token_uri': 'https://oauth2.googleapis.com/token',
                              'redirect_uris': [yt.CALLBACK]}}
        self.client_file.write_text(json.dumps(self.config))
        for name, value in [('CLIENT_FILE', self.client_file), ('TOKEN_FILE', self.token_file)]:
            p = patch.object(yt, name, value)
            p.start()
            self.addCleanup(p.stop)
        yt._pending.clear()
        self.addCleanup(yt._pending.clear)
        self.addCleanup(self.tmp.cleanup)
        self.channel = {'id': 'UC-test', 'title': 'Ecco AI Labs', 'handle': '@EccoAILabs'}

    def credentials(self, scopes=yt.SCOPES, refresh='fixture-refresh', granted=None):
        return Credentials('fixture-access', refresh_token=refresh,
                           token_uri='https://oauth2.googleapis.com/token',
                           client_id=yt.google_signin.CLIENT_ID,
                           client_secret='fixture-secret', scopes=scopes, granted_scopes=granted)

    def pending(self, credentials=None):
        flow = Mock(credentials=credentials or self.credentials())
        yt._pending['fixture-state'] = (time.monotonic(), flow)
        return flow

    def finish(self):
        return yt.finish({'state': ['fixture-state'], 'code': ['fixture-code']})

    def test_actual_oauth_url_uses_pkce_existing_client_and_only_youtube_scopes(self):
        result = yt.start()
        params = parse_qs(urlsplit(result['url']).query)
        self.assertEqual(params['client_id'], [yt.google_signin.CLIENT_ID])
        self.assertEqual(params['redirect_uri'], [yt.CALLBACK])
        self.assertEqual(set(params['scope'][0].split()), set(yt.SCOPES))
        self.assertEqual(params['access_type'], ['offline'])
        self.assertEqual(params['code_challenge_method'], ['S256'])
        flow = yt._pending[params['state'][0]][1]
        challenge = base64.urlsafe_b64encode(hashlib.sha256(flow.code_verifier.encode()).digest()).rstrip(b'=').decode()
        self.assertEqual(params['code_challenge'], [challenge])
        self.assertNotIn('fixture-secret', result['url'])

    def test_callback_saves_only_verified_channel_with_private_permissions(self):
        flow = self.pending()
        with patch.object(yt, '_build'), patch.object(yt.legacy, 'verify_channel', return_value=self.channel):
            self.assertEqual(self.finish(), self.channel)
        flow.fetch_token.assert_called_once_with(code='fixture-code', timeout=20)
        self.assertEqual(self.token_file.stat().st_mode & 0o777, 0o600)
        self.assertEqual(self.token_file.parent.stat().st_mode & 0o777, 0o700)
        self.assertEqual(yt.status()['youtube_channel'], self.channel)
        self.assertNotIn('fixture-', json.dumps(yt.status()))
        with self.assertRaises(yt.legacy.Problem):
            self.finish()
        self.assertEqual(flow.fetch_token.call_count, 1)

    def test_wrong_channel_does_not_replace_existing_connection(self):
        yt._save(self.credentials(), self.channel)
        before = self.token_file.read_bytes()
        self.pending()
        with patch.object(yt, '_build'), patch.object(yt.legacy, 'verify_channel', side_effect=yt.legacy.Problem('Wrong channel', 403)):
            with self.assertRaises(yt.legacy.Problem) as error:
                self.finish()
        self.assertEqual(error.exception.code, 403)
        self.assertEqual(self.token_file.read_bytes(), before)

    def test_expired_missing_duplicate_and_cancelled_requests_do_not_exchange_codes(self):
        for query, age in [({}, 0), ({'state': ['fixture-state']}, yt.TTL),
                           ({'state': ['fixture-state', 'second']}, 0),
                           ({'state': ['fixture-state'], 'error': ['access_denied']}, 0)]:
            flow = self.pending()
            yt._pending['fixture-state'] = (time.monotonic() - age, flow)
            with self.assertRaises(yt.legacy.Problem):
                yt.finish(query)
            flow.fetch_token.assert_not_called()
        self.assertFalse(self.token_file.exists())

    def test_missing_permissions_or_refresh_token_not_connected(self):
        for credentials in [self.credentials(scopes=yt.SCOPES[:1]), self.credentials(refresh=None),
                            self.credentials(granted=yt.SCOPES[:1])]:
            self.pending(credentials)
            with self.assertRaises(yt.legacy.Problem), patch.object(yt, '_build') as build:
                self.finish()
            build.assert_not_called()
            self.assertFalse(self.token_file.exists())

    def test_token_exchange_failure_is_sanitized(self):
        flow = self.pending()
        flow.fetch_token.side_effect = RuntimeError('fixture-secret fixture-code')
        with self.assertRaises(yt.legacy.Problem) as error:
            self.finish()
        self.assertNotIn('fixture-', error.exception.message)
        self.assertFalse(self.token_file.exists())

    def test_missing_wrong_client_and_callback_configuration_fail_closed(self):
        self.client_file.unlink()
        self.assertFalse(yt.status()['youtube_configured'])
        for key, value in [('client_id', 'other-client'), ('redirect_uris', []),
                           ('token_uri', 'https://untrusted.example/token')]:
            config = json.loads(json.dumps(self.config))
            config['web'][key] = value
            self.client_file.write_text(json.dumps(config))
            with self.assertRaises(yt.legacy.Problem):
                yt.start()
        self.assertFalse(yt._pending)

    def test_bounded_state_store_and_expired_state_cleanup(self):
        self.pending()
        with patch.object(yt, 'MAX_PENDING', 1):
            with self.assertRaises(yt.legacy.Problem) as error:
                yt.start()
            self.assertEqual(error.exception.code, 429)
            yt._pending['fixture-state'] = (time.monotonic() - yt.TTL, Mock())
            yt.start()
        self.assertEqual(len(yt._pending), 1)
        self.assertNotIn('fixture-state', yt._pending)

    def test_channel_guard_rejects_different_owned_channel(self):
        client = Mock()
        client.channels.return_value.list.return_value.execute.side_effect = [
            {'items': [{'id': 'UC-target'}]},
            {'items': [{'id': 'UC-other', 'snippet': {'title': 'Other'}}]}]
        with self.assertRaises(yt.legacy.Problem) as error:
            yt.legacy.verify_channel(client)
        self.assertEqual(error.exception.code, 403)

    def test_upload_still_requires_explicit_confirmation(self):
        asset = {'id': 'a'*32, 'media': 'video', 'stage': 'prod'}
        factory = Mock()
        with patch.object(yt.legacy, 'get', return_value=asset), patch.object(yt.legacy, 'launch') as launch:
            with self.assertRaises(yt.legacy.Problem):
                yt.legacy.publish({'asset_id': asset['id']}, client_factory=factory)
            factory.assert_not_called()
            launch.assert_not_called()


if __name__ == '__main__':
    unittest.main()
