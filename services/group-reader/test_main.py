import os
import unittest
from unittest.mock import patch, MagicMock
import main


class BrokerTest(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict(os.environ, {'GROUP_READER_SECRET': 'x'*40})
        self.env.start()
        self.addCleanup(self.env.stop)
        self.client = main.app.test_client()
        self.headers = {'Authorization': 'Bearer ' + 'x'*40}

    def test_unauthorized_never_calls_directory(self):
        with patch.object(main, 'membership') as lookup:
            self.assertEqual(self.client.post('/membership', json={'subject': '123'}).status_code, 401)
            lookup.assert_not_called()

    def test_fixed_group_and_numeric_subject_only(self):
        for body in ({'subject': '../admin'}, {'subject': '123', 'group': 'other'}, {'subject': 123}, []):
            with patch.object(main, 'membership') as lookup:
                self.assertEqual(self.client.post('/membership', json=body, headers=self.headers).status_code, 400)
                lookup.assert_not_called()

    def test_member_and_nonmember_bound_to_subject(self):
        for value in (True, False):
            with patch.object(main, 'membership', return_value=value):
                response = self.client.post('/membership', json={'subject': '123'}, headers=self.headers)
                self.assertEqual(response.json, {'subject': '123', 'isMember': value})

    def test_failure_does_not_leak_secrets(self):
        with patch.object(main, 'membership', side_effect=RuntimeError('secret-token')):
            response = self.client.post('/membership', json={'subject': '123'}, headers=self.headers)
            self.assertEqual(response.status_code, 503)
            self.assertNotIn('secret-token', response.get_data(as_text=True))

    def test_unconfigured_secret_denies(self):
        with patch.dict(os.environ, {'GROUP_READER_SECRET': ''}):
            self.assertEqual(self.client.post('/membership', json={'subject': '123'}, headers=self.headers).status_code, 503)

    def test_keyless_signing_scope_subject_and_token_cache(self):
        import json
        main._token = None
        main._expires = 0
        signed = MagicMock()
        signed.json.return_value = {'signedJwt': 'test-assertion'}
        client = MagicMock()
        client.post.return_value = signed
        exchange = MagicMock()
        exchange.json.return_value = {'access_token': 'test-token', 'expires_in': 3600}
        with patch.dict(os.environ, {'GROUP_READER_SERVICE_ACCOUNT': 'reader@example.iam.gserviceaccount.com', 'GROUP_READER_ADMIN': 'admin@example.org'}), patch.object(main.google.auth, 'default', return_value=(object(), None)), patch.object(main, 'AuthorizedSession') as session, patch.object(main.requests, 'post', return_value=exchange) as token_request:
            session.return_value.__enter__.return_value = client
            self.assertEqual(main.directory_token(), 'test-token')
            self.assertEqual(main.directory_token(), 'test-token')
            client.post.assert_called_once()
            token_request.assert_called_once()
            claims = json.loads(client.post.call_args.kwargs['json']['payload'])
            self.assertEqual(claims['sub'], 'admin@example.org')
            self.assertEqual(claims['scope'], main.SCOPE)
            self.assertTrue(client.post.call_args.args[0].endswith(':signJwt'))
        main._token = None
        main._expires = 0


if __name__ == '__main__': unittest.main()
