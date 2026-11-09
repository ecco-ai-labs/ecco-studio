"""Look and Feel: public read, administrator-only versioned publish, strict roster validation."""
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import test_ecco_desk as fixtures
import ecco_desk_groups

ROSTER = json.loads((Path(__file__).resolve().parent.parent / 'design-system' / 'size-roster.json').read_text())
PATH = '/api/look-and-feel'


class LookAndFeelTest(unittest.TestCase):
    def setUp(self):
        # Keep sign-in sessions in a temporary folder, as test_ecco_releases does, so CI
        # runners without a writable /workspace can run these tests.
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

    def read(self, user=None):
        return self.call(user or 'nobody', path=PATH)

    def publish(self, user='owner', **body):
        return self.call(user, {'op': 'publish', 'roster': ROSTER, 'baseVersion': 0, **body}, path=PATH)

    def test_default_is_repository_roster_and_read_is_public(self):
        status, data = self.read()
        self.assertEqual(status, 200, data)
        self.assertEqual((data['version'], data['roster']), (0, None))
        self.assertNotIn('canPublish', data)

    def test_admin_publishes_versioned_roster_everyone_reads_it(self):
        self.setup_team()
        changed = json.loads(json.dumps(ROSTER))
        changed['types'][0]['font'] = 8
        changed['scale'][0]['tokens'][0]['value'] = 30
        status, data = self.publish(roster=changed)
        self.assertEqual(status, 200, data)
        self.assertEqual(data['version'], 1)
        self.assertEqual(data['roster']['scale'][0]['tokens'][0]['value'], 30)
        self.assertEqual(data['roster']['types'][1]['font'], ROSTER['types'][1]['font'])
        self.assertEqual(data['history'][0]['updatedBy'], 'Owner')
        status, public = self.read()
        self.assertEqual(public['roster']['types'][0]['font'], 8)
        self.assertEqual(self.read('owner')[1]['canPublish'], True)
        self.assertEqual(self.read('alice')[1]['canPublish'], False)
        self.assertNotIn('history', self.read('alice')[1])

    def test_only_administrators_publish(self):
        self.setup_team()
        for who in ('staff', 'alice'):
            self.assertEqual(self.publish(who)[0], 403)
        self.assertEqual(self.call('nobody', {'op': 'publish', 'roster': ROSTER, 'baseVersion': 0}, path=PATH)[0], 401)
        with patch.object(ecco_desk_groups, 'access', return_value={'canManageNotifications': True}):
            self.assertEqual(self.publish('alice')[0], 200)

    def test_stale_base_version_is_refused_and_reset_restores_default(self):
        self.setup_team()
        self.assertEqual(self.publish()[0], 200)
        status, data = self.publish()
        self.assertEqual(status, 409, data)
        status, data = self.call('owner', {'op': 'reset', 'baseVersion': 1}, path=PATH)
        self.assertEqual((status, data['version'], data['roster']), (200, 2, None))
        self.assertTrue(data['history'][0]['default'])

    def test_unsafe_or_invalid_rosters_are_refused(self):
        self.setup_team()
        cases = []
        for change in (
            lambda r: r['types'][0]['selectors'].append('p{color:red}'),
            lambda r: r['types'][0]['selectors'].append('</style><script>'),
            lambda r: r['types'][0].update(font=2),
            lambda r: r['types'][0].update(font='12px; color:red'),
            lambda r: r['types'][0].update(id='Bad Id'),
            lambda r: r['variants'][0].update(of='missing-type'),
            lambda r: r['types'].append(dict(r['types'][0])),
            lambda r: r['types'][0].update(font='@no-such-size'),
            lambda r: r['scale'][0]['tokens'][0].update(value=500),
            lambda r: r['scale'][0]['tokens'].append(dict(r['scale'][0]['tokens'][0])),
        ):
            roster = json.loads(json.dumps(ROSTER))
            change(roster)
            cases.append(roster)
        for roster in cases:
            status, data = self.publish(roster=roster)
            self.assertEqual(status, 400, data)
        self.assertEqual(self.read()[1]['version'], 0)

    def test_origin_is_checked(self):
        self.assertEqual(self.call('nobody', path=PATH, origin='https://evil.example')[0], 403)


if __name__ == '__main__':
    unittest.main()
