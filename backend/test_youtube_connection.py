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
        for name, value in [('CLIENT_FILE', self.client_file), ('TOKEN_FILE', self.token_file), ('KEY_FILE', Path(self.tmp.name) / 'private' / 'key')]:
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
        yt._pending['fixture-state'] = (time.monotonic(), flow, yt._generation)
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
        with patch.object(yt, '_build'), patch.object(yt, 'verify_channel', return_value=self.channel):
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
        with patch.object(yt, '_build'), patch.object(yt, 'verify_channel', side_effect=yt.legacy.Problem('Wrong channel', 403)):
            with self.assertRaises(yt.legacy.Problem) as error:
                self.finish()
        self.assertEqual(error.exception.code, 403)
        self.assertEqual(self.token_file.read_bytes(), before)

    def test_expired_missing_duplicate_and_cancelled_requests_do_not_exchange_codes(self):
        for query, age in [({}, 0), ({'state': ['fixture-state']}, yt.TTL),
                           ({'state': ['fixture-state', 'second']}, 0),
                           ({'state': ['fixture-state'], 'error': ['access_denied']}, 0)]:
            flow = self.pending()
            yt._pending['fixture-state'] = (time.monotonic() - age, flow, yt._generation)
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

    def test_first_setup_encrypts_client_and_returns_only_safe_status(self):
        self.client_file.unlink()
        self.assertTrue(yt.status()['youtube_setup_available'])
        self.config['web']['unused_secret'] = 'must-not-save-this'
        self.config['web']['redirect_uris'] = ['https://untrusted.example/callback']
        result = yt.configure(self.config)
        self.assertTrue(result['youtube_configured'])
        self.assertFalse(result['youtube_setup_available'])
        self.assertIsNone(result['youtube_channel'])
        self.assertNotIn('fixture-secret', json.dumps(result))
        self.assertNotIn('fixture-secret', self.client_file.read_text())
        self.assertNotIn('unused_secret', yt._config()['web'])
        self.assertEqual(self.client_file.stat().st_mode & 0o777, 0o600)
        self.assertEqual(yt.KEY_FILE.stat().st_mode & 0o777, 0o600)
        self.assertEqual(yt._config()['web']['client_secret'], 'fixture-secret')
        self.assertEqual(yt._config()['web']['redirect_uris'], [yt.CALLBACK])
        self.assertIn('https://accounts.google.com/', yt.start()['url'])
        self.assertFalse(list(self.client_file.parent.glob('.youtube-client-*')))

    def test_setup_rejects_invalid_configs_without_writing_files(self):
        self.client_file.unlink()
        bad_configs = [None, [], {}, {'web': []}, {'installed': self.config['web']}]
        for key, value in [('client_id', 'other-client'), ('client_secret', '****last'),
                           ('client_secret', 123), ('client_secret', ' ' * 30),
                           ('auth_uri', 'https://untrusted.example/auth'),
                           ('token_uri', 'https://untrusted.example/token')]:
            config = json.loads(json.dumps(self.config))
            config['web'][key] = value
            bad_configs.append(config)
        for config in bad_configs:
            with self.subTest(config=config):
                with self.assertRaises(yt.legacy.Problem) as error:
                    yt.configure(config)
                self.assertNotIn('fixture-secret', error.exception.message)
                self.assertFalse(self.client_file.exists())
                self.assertFalse(yt.KEY_FILE.exists())

    def test_setup_cannot_replace_existing_client_or_saved_channel(self):
        before = self.client_file.read_bytes()
        with self.assertRaises(yt.legacy.Problem) as error:
            yt.configure(self.config)
        self.assertEqual(error.exception.code, 409)
        self.assertEqual(self.client_file.read_bytes(), before)
        yt._save(self.credentials(), self.channel)
        self.client_file.unlink()
        before = self.token_file.read_bytes()
        self.assertFalse(yt.status()['youtube_setup_available'])
        with self.assertRaises(yt.legacy.Problem) as error:
            yt.configure(self.config)
        self.assertEqual(error.exception.code, 409)
        self.assertEqual(self.token_file.read_bytes(), before)
        self.assertFalse(self.client_file.exists())

    def test_setup_exclusive_install_prevents_cross_process_overwrite(self):
        self.client_file.unlink()
        link = yt.os.link
        def another_writer(source, target):
            target.write_text('other-process-configuration')
            return link(source, target)
        with patch.object(yt.os, 'link', side_effect=another_writer):
            with self.assertRaises(yt.legacy.Problem) as error:
                yt.configure(self.config)
        self.assertEqual(error.exception.code, 409)
        self.assertEqual(self.client_file.read_text(), 'other-process-configuration')
        self.assertFalse(list(self.client_file.parent.glob('.youtube-client-*')))

    def test_client_encryption_key_loss_fails_closed_without_secret_output(self):
        self.client_file.unlink()
        yt.configure(self.config)
        yt.KEY_FILE.unlink()
        self.assertFalse(yt.status()['youtube_configured'])
        self.assertFalse(yt.status()['youtube_setup_available'])
        with self.assertRaises(yt.legacy.Problem) as error:
            yt.start()
        self.assertNotIn('fixture-secret', error.exception.message)

    def test_bounded_state_store_and_expired_state_cleanup(self):
        self.pending()
        with patch.object(yt, 'MAX_PENDING', 1):
            with self.assertRaises(yt.legacy.Problem) as error:
                yt.start()
            self.assertEqual(error.exception.code, 429)
            yt._pending['fixture-state'] = (time.monotonic() - yt.TTL, Mock(), yt._generation)
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


    def test_any_owned_channel_is_verified_without_public_handle_lookup(self):
        client = Mock()
        client.channels.return_value.list.return_value.execute.return_value = {'items': [
            {'id': 'UC-owner', 'snippet': {'title': 'Owner channel', 'customUrl': '@Owner'}}]}
        self.assertEqual(yt.verify_channel(client), {'id': 'UC-owner', 'title': 'Owner channel', 'handle': '@Owner'})
        client.channels.return_value.list.assert_called_once_with(part='snippet', mine=True)
        with self.assertRaises(yt.legacy.Problem):
            yt.verify_channel(client, 'UC-other')
        for items in ([], [{'id': 'UC-one'}, {'id': 'UC-two'}]):
            client.channels.return_value.list.return_value.execute.return_value = {'items': items}
            with self.assertRaises(yt.legacy.Problem):
                yt.verify_channel(client)

    def test_tokens_are_encrypted_and_missing_key_fails_closed(self):
        yt._save(self.credentials(), self.channel)
        self.assertNotIn('fixture-refresh', self.token_file.read_text())
        self.assertNotIn('fixture-secret', self.token_file.read_text())
        self.assertEqual(yt.KEY_FILE.stat().st_mode & 0o777, 0o600)
        self.assertEqual(yt._saved()['channel'], self.channel)
        yt.KEY_FILE.unlink()
        self.assertIsNone(yt._saved())

    def test_disconnection_cancels_pending_and_inflight_authorization(self):
        yt._save(self.credentials(), self.channel)
        flow = self.pending()
        flow.fetch_token.side_effect = lambda **kwargs: yt.disconnect()
        with patch.object(yt, '_build'), patch.object(yt, 'verify_channel', return_value=self.channel):
            with self.assertRaises(yt.legacy.Problem):
                self.finish()
        self.assertFalse(self.token_file.exists())
        self.assertFalse(yt._pending)

    def test_publish_requires_confirmed_destination_and_binds_both_checks(self):
        with patch.object(yt.legacy, 'publish') as publish:
            for body in ({}, {'channel_id': 'https://evil.example'}):
                with self.assertRaises(yt.legacy.Problem):
                    yt.publish(body)
            publish.assert_not_called()
            yt.publish({'channel_id': 'UC-owner'})
            kwargs = publish.call_args.kwargs
            with patch.object(yt, 'client') as client:
                kwargs['client_factory']()
                client.assert_called_once_with('UC-owner')
            with patch.object(yt, 'verify_channel') as verify:
                kwargs['channel_verifier']('api')
                verify.assert_called_once_with('api', 'UC-owner')

    def test_channel_switch_before_worker_cannot_upload_to_new_destination(self):
        yt._save(self.credentials(), self.channel)
        with self.assertRaises(yt.legacy.Problem), patch.object(yt, '_build') as build:
            yt.client('UC-other')
        build.assert_not_called()

    def test_scheduled_resumable_upload_records_channel_visibility_and_time(self):
        from datetime import datetime, timedelta, timezone
        scheduled = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()
        asset = {'id': 'a'*32, 'kind': 'asset', 'media': 'video', 'stage': 'prod'}
        body = {'asset_id': asset['id'], 'confirmed': True, 'channel_id': self.channel['id'],
                'visibility': 'private', 'made_for_kids': False, 'title': 'Test', 'publish_at': scheduled}
        client = Mock()
        client.videos.return_value.insert.return_value.next_chunk.return_value = (None, {
            'id': 'test-video', 'status': {'privacyStatus': 'private', 'publishAt': scheduled}})
        verifier = Mock(return_value=self.channel)
        with patch.object(yt.legacy, 'get', return_value=asset), patch.object(yt.legacy, 'save'), \
                patch.object(yt.legacy, 'asset_path', return_value=Path('test.mp4')), \
                patch('googleapiclient.http.MediaFileUpload') as media, \
                patch.object(yt.legacy, 'launch', side_effect=lambda label, fn: fn('job')):
            self.assertEqual(yt.legacy.publish(body, client_factory=lambda: client, channel_verifier=verifier), 'test-video')
        self.assertEqual(verifier.call_count, 2)
        media.assert_called_once_with('test.mp4', mimetype='video/mp4', resumable=True)
        status = client.videos.return_value.insert.call_args.kwargs['body']['status']
        self.assertEqual(status['publishAt'], scheduled)
        self.assertEqual(status['privacyStatus'], 'private')
        self.assertEqual(asset['youtube_channel_id'], self.channel['id'])
        self.assertEqual(asset['youtube_publish_at'], scheduled)

    def test_invalid_schedule_never_reaches_upload(self):
        asset = {'id': 'a'*32, 'media': 'video', 'stage': 'prod'}
        with patch.object(yt.legacy, 'get', return_value=asset), patch.object(yt.legacy, 'launch') as launch:
            for date, visibility in [('invalid', 'private'), ('2000-01-01T00:00:00Z', 'private'),
                                     ('2099-01-01T00:00:00', 'private'), ('2099-01-01T00:00:00Z', 'public')]:
                with self.assertRaises(yt.legacy.Problem):
                    yt.legacy.publish({'confirmed': True, 'publish_at': date, 'visibility': visibility})
            launch.assert_not_called()

if __name__ == '__main__':
    unittest.main()
