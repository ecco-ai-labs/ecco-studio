import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import test_ecco_desk as fixtures
import ecco_desk as desk
import ecco_releases as releases
import web_origins

HEAD = 'a' * 40
OLD = 'b' * 40
RID = 'c' * 32


class ReleaseTest(unittest.TestCase):
    def setUp(self):
        sessions = tempfile.TemporaryDirectory()
        self.addCleanup(sessions.cleanup)
        session_path = patch.object(fixtures.auth, 'SESSION_DB', Path(sessions.name) / 'sessions.sqlite')
        session_path.start()
        self.addCleanup(session_path.stop)
        fixtures.DeskTest.setUp(self)

    tearDown = fixtures.DeskTest.tearDown
    login = fixtures.DeskTest.login
    call = fixtures.DeskTest.call
    setup_team = fixtures.DeskTest.setup_team

    def github(self, path, body=None):
        if path.startswith('/actions/workflows/release-checks.yml/runs'):
            return {'workflow_runs': [{'id': 42, 'head_sha': HEAD if 'head_sha='+HEAD in path else OLD,
                'head_branch': 'main', 'event': 'push', 'status': 'completed', 'conclusion': 'success',
                'html_url': 'https://github.com/ecco-ai-labs/ecco-studio/actions/runs/42'}]}
        if path == '/commits/main': return {'sha': HEAD}
        if path.startswith('/commits/'): return {'html_url': 'https://github.com/ecco-ai-labs/ecco-studio/commit/'+HEAD, 'commit': {'author': {'name': 'Developer'}}}
        if path == '/releases?per_page=100': return []
        if path.startswith('/actions/runs/42/artifacts'):
            return {'artifacts': [{'name': 'ecco-release-'+HEAD, 'expired': False}, {'name': 'ecco-release-'+OLD, 'expired': False}]}
        if path.endswith('/dispatches'): return {}
        if path.startswith('/actions/workflows/production-release.yml/runs'): return {'workflow_runs': []}
        raise AssertionError(path)

    def payload(self, **overrides):
        return dict(op='prepareRelease', id=RID, title='Navigation release', sha=HEAD, **overrides)

    def test_admin_only_read_write_and_customer_surface(self):
        self.setup_team()
        with patch.object(releases, 'github') as remote:
            for who in ('staff', 'alice', 'bob'):
                self.assertEqual(self.call(who, path='/api/desk?releases=1')[0], 403)
                self.assertEqual(self.call(who, self.payload())[0], 403)
            self.assertEqual(self.call(body=self.payload(), path='/api/desk/support')[0], 403)
            self.assertEqual(self.call(path='/api/desk/support?releases=1')[0], 403)
            self.assertEqual(self.call('anonymous', path='/api/desk?releases=1')[0], 401)
            self.assertEqual(self.call(body=self.payload(), origin='https://evil.example')[0], 403)
            remote.assert_not_called()

    @patch.object(releases, 'token', return_value='')
    def test_setup_and_initial_collection_are_truthful(self, _):
        self.setup_team()
        with patch.object(releases, 'github', side_effect=self.github):
            status, result = self.call(path='/api/desk?releases=1')
        self.assertEqual(status, 200, result)
        self.assertEqual(result['checks']['state'], 'success')
        self.assertIsNone(result['current'])
        self.assertEqual(len(result['blockers']), 2)
        self.assertEqual(len(result['changes']), 1)
        self.assertFalse(result['previewEnabled'])

    def test_prepare_pins_version_and_retries_idempotently(self):
        self.setup_team()
        with patch.object(releases, 'github', side_effect=self.github):
            first = self.call(body=self.payload())
            again = self.call(body=self.payload())
            changed = self.call(body={**self.payload(), 'title': 'Different'})
        self.assertEqual(first[0], 200, first)
        self.assertEqual(first[1], again[1])
        self.assertEqual(first[1]['release']['checkRunId'], 42)
        self.assertEqual(first[1]['release']['state'], 'prepared')
        self.assertEqual(changed[0], 409)

    def test_new_dev_revision_and_unpublished_rollback_rejected(self):
        self.setup_team()
        with patch.object(releases, 'github', side_effect=self.github):
            self.assertEqual(self.call(body={**self.payload(), 'sha': OLD})[0], 409)
            self.assertEqual(self.call(body={**self.payload(), 'op': 'prepareRollback', 'sha': OLD})[0], 409)

    def test_failed_checks_and_expired_artifact_rejected(self):
        self.setup_team()
        for mode in ('failure', 'expired'):
            def remote(path, body=None):
                result = self.github(path, body)
                if mode == 'failure' and 'workflow_runs' in result:
                    for run in result['workflow_runs']: run['conclusion'] = 'failure'
                if mode == 'expired' and 'artifacts' in result:
                    for artifact in result['artifacts']: artifact['expired'] = True
                return result
            with patch.object(releases, 'github', side_effect=remote):
                self.assertEqual(self.call(body=self.payload())[0], 409)

    def test_publish_requires_explicit_setup(self):
        self.setup_team()
        with patch.object(releases, 'github', side_effect=self.github):
            self.call(body=self.payload())
            self.assertEqual(self.call(body={'op':'publishRelease','id':RID})[0], 409)

    @patch.dict(os.environ, {'ECCO_RELEASES_ENABLED':'1'})
    @patch.object(releases, 'token', return_value='fixture-token')
    def test_publish_dispatches_exact_build_once(self, _):
        self.setup_team()
        with patch.object(releases, 'github', side_effect=self.github) as remote:
            self.call(body=self.payload())
            result = self.call(body={'op':'publishRelease','id':RID})
            self.assertEqual(result[0], 200, result)
            self.assertEqual(result[1]['release']['state'], 'queued')
            self.call(body={'op':'publishRelease','id':RID})
            dispatches = [call for call in remote.call_args_list if call.args[0].endswith('/dispatches')]
            self.assertEqual(len(dispatches), 1)
            payload = dispatches[0].args[1]
            self.assertEqual(payload['inputs']['source_sha'], HEAD)
            self.assertEqual(payload['inputs']['check_run_id'], '42')
            self.assertEqual(payload['inputs']['expected_production_sha'], 'none')
            self.assertEqual(payload['inputs']['actor'], 'Owner')

    @patch.dict(os.environ, {'ECCO_RELEASES_ENABLED':'1'})
    @patch.object(releases, 'token', return_value='fixture-token')
    def test_uncertain_dispatch_is_durable_and_never_retried(self, _):
        self.setup_team()
        def remote(path, body=None):
            if path.endswith('/dispatches'): raise TimeoutError('fixture')
            return self.github(path, body)
        with patch.object(releases, 'github', side_effect=remote) as calls:
            self.call(body=self.payload())
            result = self.call(body={'op':'publishRelease','id':RID})
            self.assertEqual(result[1]['release']['state'], 'unknown')
            self.call(body={'op':'publishRelease','id':RID})
            self.assertEqual(sum(c.args[0].endswith('/dispatches') for c in calls.call_args_list), 1)
        with desk.connect(self.database) as db:
            self.assertEqual(db.execute('SELECT state FROM desk_releases').fetchone()[0], 'unknown')

    def test_reconcile_requires_matching_production_receipt(self):
        self.setup_team()
        with patch.object(releases, 'github', side_effect=self.github):
            self.call(body=self.payload())
            with desk.connect(self.database) as db:
                db.execute("UPDATE desk_releases SET state='queued'")
                releases.reconcile(db, [{'id': RID, 'sha': HEAD}])
                self.assertEqual(db.execute('SELECT state FROM desk_releases').fetchone()[0], 'deployed')

    @patch.dict(os.environ, {'ECCO_ALLOWED_ORIGINS': 'https://ecco-ai-labs.github.io,https://eccoailabs.com'})
    def test_prod_origin_preserves_server_authorization(self):
        self.setup_team()
        self.assertEqual(self.call(origin='https://eccoailabs.com')[0], 200)
        self.assertEqual(self.call(origin='https://eccoailabs.com.evil.example')[0], 403)
        self.assertEqual(self.call('alice', self.payload(), origin='https://eccoailabs.com')[0], 403)
        self.assertEqual(web_origins.request_origin({'Origin': 'https://evil.example'}), '')


if __name__ == '__main__': unittest.main()
