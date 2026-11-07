"""Notification audience, authority and lifetime checks through real HTTP/SQLite."""
import datetime as dt
import unittest
import uuid
from unittest.mock import patch
import test_ecco_desk as fixtures
import ecco_desk as desk


class NotificationTest(unittest.TestCase):
    setUp = fixtures.DeskTest.setUp
    tearDown = fixtures.DeskTest.tearDown
    login = fixtures.DeskTest.login
    call = fixtures.DeskTest.call
    setup_team = fixtures.DeskTest.setup_team

    def prepare(self):
        self.setup_team()
        self.call('alice', path='/api/desk/support?userNotifications=1')
        self.call('bob', path='/api/desk/support?userNotifications=1')

    def payload(self, **kwargs):
        return dict(op='createNotification', requestId=str(uuid.uuid4()), title='Credit notice',
                    body='Your credits expire soon.', severity='warning', audience='all', durationDays=3, **kwargs)

    def publish(self, **kwargs):
        p = self.payload()
        p.update(kwargs)
        status, data = self.call(body=p)
        self.assertEqual(status, 200, data)
        return data['id']

    def feed(self, who):
        status, data = self.call(who, path='/api/desk/support?userNotifications=1')
        self.assertEqual(status, 200, data)
        self.assertEqual(data['notificationVersion'], 1)
        return data['notifications']

    def test_broadcast_read_is_per_user_durable_and_idempotent(self):
        self.prepare()
        nid = self.publish()
        self.assertEqual([n['id'] for n in self.feed('alice')], [nid])
        self.assertEqual(self.call('alice', dict(op='readNotification', id=nid), path='/api/desk/support')[0], 200)
        self.assertEqual(self.feed('alice'), [])
        self.assertEqual([n['id'] for n in self.feed('bob')], [nid])
        self.call('alice', dict(op='readNotification', id=nid), path='/api/desk/support')
        desk.initialize(self.database, start_notifications=False)
        self.assertEqual(self.feed('alice'), [])
        history = self.call(path='/api/desk?manageNotifications=1')[1]
        self.assertEqual(history['notifications'][0]['readCount'], 1)
        self.assertEqual(history['notifications'][0]['status'], 'active')
        self.assertNotIn('recipientId', self.feed('bob')[0])

    def test_specific_user_is_not_visible_or_readable_by_other_accounts(self):
        self.prepare()
        nid = self.publish(audience='user', recipientId='google:alice', severity='error', durationDays=None)
        self.assertEqual(self.feed('bob'), [])
        self.assertEqual(self.feed('owner'), [])
        self.assertEqual(self.call('bob', dict(op='readNotification', id=nid), path='/api/desk/support')[0], 404)
        self.assertEqual(self.feed('alice')[0]['severity'], 'error')
        self.assertIsNone(self.feed('alice')[0]['expiresAt'])
        # A different verified subject with the same email gains no access.
        self.tokens['alias'] = self.login('alias', 'alice@example.test')
        self.assertEqual(self.feed('alias'), [])
        self.call('alice', dict(op='readNotification', id=nid), path='/api/desk/support')
        self.assertEqual(self.call(path='/api/desk?manageNotifications=1')[1]['notifications'][0]['status'], 'read')

    def test_expiry_at_exact_deadline_and_until_read(self):
        self.prepare()
        instant = dt.datetime(2030, 1, 1, tzinfo=dt.timezone.utc)
        with patch.object(desk, 'now', return_value=instant.isoformat(timespec='microseconds')):
            timed = self.publish()
            forever = self.publish(durationDays=None)
        with patch.object(desk, 'now', return_value=(instant+dt.timedelta(days=3, microseconds=-1)).isoformat(timespec='microseconds')):
            self.assertEqual({n['id'] for n in self.feed('alice')}, {timed, forever})
        with patch.object(desk, 'now', return_value=(instant+dt.timedelta(days=3)).isoformat(timespec='microseconds')):
            self.assertEqual([n['id'] for n in self.feed('alice')], [forever])
            self.assertEqual(self.call(path='/api/desk?manageNotifications=1')[1]['notifications'][1]['status'], 'expired')

    def test_authorization_origin_and_validation(self):
        self.prepare()
        for who in ('staff', 'alice', 'bob'):
            self.assertEqual(self.call(who, self.payload())[0], 403)
            self.assertEqual(self.call(who, path='/api/desk?manageNotifications=1')[0], 403)
        self.assertEqual(self.call(body=self.payload(), path='/api/desk/support')[0], 403)
        self.assertEqual(self.call(path='/api/desk/support?manageNotifications=1')[0], 403)
        self.assertEqual(self.call('anonymous', path='/api/desk/support?userNotifications=1')[0], 401)
        self.assertEqual(self.call(body=self.payload(), origin='https://evil.example')[0], 403)
        for changes in [dict(severity='urgent'),dict(audience='everyone'),dict(audience='user',recipientId='unknown'),
                        *[dict(durationDays=x) for x in (-1,0,366,1.5,True,'3')],dict(title=' '),dict(body='x'*4001)]:
            payload = self.payload();payload.update(changes)
            self.assertEqual(self.call(body=payload)[0], 400, changes)
        self.assertEqual(self.feed('alice'), [])

    def test_retries_withdrawal_and_latest_five_do_not_resurface_old_notices(self):
        self.prepare()
        first = self.publish()
        payload = self.payload()
        self.assertEqual(self.call(body=payload)[0], 200)
        self.assertEqual(self.call(body=payload)[0], 200)
        payload['title'] = 'Changed'
        self.assertEqual(self.call(body=payload)[0], 409)
        for _ in range(4):
            newest = self.publish()
        self.assertEqual(len(self.feed('alice')), 5)
        self.assertNotIn(first, [n['id'] for n in self.feed('alice')])
        self.assertEqual(self.call('staff',dict(op='withdrawNotification',id=newest))[0],403)
        self.assertEqual(self.call(body=dict(op='withdrawNotification',id=newest))[0],200)
        self.assertEqual(len(self.feed('alice')),4)
        self.assertNotIn(first, [n['id'] for n in self.feed('alice')])
        self.assertEqual(self.call(path='/api/desk?manageNotifications=1')[1]['notifications'][0]['status'], 'withdrawn')
        with desk.connect(self.database) as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM records').fetchone()[0], 1)
            self.assertEqual(db.execute('SELECT COUNT(*) FROM desk_notifications').fetchone()[0], 6)


if __name__ == '__main__':
    unittest.main()
