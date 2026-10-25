"""Mail is tested with isolated SQLite and a fake SMTP transport; never real mail."""
from concurrent.futures import ThreadPoolExecutor
import json
import os
from pathlib import Path
import smtplib
import sqlite3
import tempfile
import threading
import time
import unittest
from unittest.mock import Mock, patch

import ecco_desk as desk
import ecco_desk_mail as mail


class DeskMailTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.database = Path(self.tmp.name) / 'studio.sqlite'
        self.config_path = Path(self.tmp.name) / 'mail.json'
        self.env = patch.dict(os.environ, {'ECCO_DESK_MAIL_CONFIG': str(self.config_path)})
        self.env.start()
        desk.initialize(self.database, start_notifications=False)
        self.config = dict(enabled=True, recipient='support@example.test', sender='desk@example.test',
                           host='smtp.example.test', port=587, security='starttls',
                           username='desk@example.test', password='secret-fixture')

    def tearDown(self):
        self.env.stop()
        self.tmp.cleanup()

    def create(self, kind='support', **changes):
        with desk.connect(self.database) as db:
            actor = desk.actor(db, dict(id='google:alice', name='Alice', email='alice@example.test'))
            if kind == 'internal':
                actor['role'] = 'staff'
            return desk.write(db, actor, {'op':'createTicket', 'type':kind, 'title':'Help with Studio',
                'description':'My generation did not finish.', **changes}, '', '')['ticket']

    def row(self, tid):
        with mail.connect(self.database) as db:
            return dict(db.execute('SELECT * FROM desk_mail_outbox WHERE ticketId=?', (tid,)).fetchone())

    def configure(self, **changes):
        self.config_path.write_text(json.dumps({**self.config, **changes}))
        self.config_path.chmod(0o600)

    def test_one_queue_entry_per_new_support_or_internal_ticket(self):
        tickets = [self.create(kind) for kind in ('support', 'internal')]
        desk.initialize(self.database, start_notifications=False)
        with desk.connect(self.database) as db:
            self.assertEqual(db.execute('SELECT count(*) FROM desk_mail_outbox').fetchone()[0], 2)
            me = desk.actor(db, dict(id='google:alice', name='Alice', email='alice@example.test'))
            desk.write(db, me, dict(op='comment', id=tickets[0]['id'], body='Follow-up'), '', '')
            self.assertEqual(db.execute('SELECT count(*) FROM desk_mail_outbox').fetchone()[0], 2)
            detail = desk.read(db, me, {'ticket':[str(tickets[0]['id'])]})
            self.assertTrue(all(e['visibility'] == 'public' for e in detail['events']))

    def test_ticket_and_notification_roll_back_together(self):
        with patch.object(mail, 'enqueue', side_effect=sqlite3.OperationalError('fixture')):
            with self.assertRaises(sqlite3.OperationalError):
                self.create()
        with mail.connect(self.database) as db:
            self.assertEqual(db.execute('SELECT count(*) FROM desk_tickets').fetchone()[0], 0)
            self.assertEqual(db.execute('SELECT count(*) FROM desk_mail_outbox').fetchone()[0], 0)

    def test_ticket_creation_does_not_wait_for_or_call_smtp(self):
        with patch.object(mail, 'send', side_effect=AssertionError('must be async')):
            ticket = self.create()
        self.assertIsNone(self.row(ticket['id'])['sentAt'])
        self.assertEqual(self.row(ticket['id'])['attempts'], 0)

    def test_current_and_legacy_service_startup_drain_pending_notifications(self):
        import storage_api as api
        from contextlib import ExitStack

        self.configure()
        key_file = Path(self.tmp.name) / 'access.key'
        key_file.write_text('test-only-' + 'x' * 32)
        for startup in ('current', 'legacy'):
            with self.subTest(startup=startup), ExitStack() as stack:
                self.configure(enabled=False)
                ticket = self.create(title='Queued before service startup')
                self.configure()
                send = stack.enter_context(patch.object(mail, 'send'))
                if startup == 'current':
                    stack.enter_context(patch.object(api, 'TOKEN_FILE', key_file))
                    stack.enter_context(patch.object(api.legacy, 'DATA', self.database.parent))
                    stack.enter_context(patch.object(api.legacy, 'github_token'))
                    stack.enter_context(patch.object(api.Handler, 'access_key', ''))
                    stack.enter_context(patch.object(api, 'ThreadingHTTPServer'))
                    for module in (api.longcat_jobs, api.audio_video_sequence,
                                   api.audio_jobs, api.audio_workflows):
                        stack.enter_context(patch.object(module, 'start'))
                try:
                    if startup == 'current':
                        api.main()
                    else:
                        desk.initialize(self.database)
                    deadline = time.monotonic() + 3
                    while self.row(ticket['id'])['sentAt'] is None and time.monotonic() < deadline:
                        time.sleep(.01)
                    row = self.row(ticket['id'])
                    self.assertIsNotNone(row['sentAt'])
                    self.assertEqual(row['attempts'], 1)
                    send.assert_called_once()
                    self.assertIn(f'#{ticket["id"]}', str(send.call_args.args[0]['Subject']))
                finally:
                    worker = mail._workers.pop(str(self.database.resolve()), None)
                    if worker:
                        worker[1].set()
                        worker[0].join(timeout=3)
                        self.assertFalse(worker[0].is_alive())

    def test_success_persists_and_does_not_resend_after_reinitialize(self):
        t = self.create()
        with patch.object(mail, 'send') as send:
            self.assertTrue(mail.deliver_one(self.database, self.config))
            desk.initialize(self.database, start_notifications=False)
            self.assertFalse(mail.deliver_one(self.database, self.config))
            send.assert_called_once()
        self.assertIsNotNone(self.row(t['id'])['sentAt'])
        with mail.connect(self.database) as db:
            self.assertEqual(db.execute("SELECT count(*) FROM desk_events WHERE detail='New-ticket notification accepted by mail server' AND visibility='internal'").fetchone()[0], 1)

    def test_failure_retries_without_leaking_smtp_response_and_preserves_recipient(self):
        t = self.create()
        with patch.object(mail, 'send', side_effect=smtplib.SMTPAuthenticationError(535, b'secret-fixture')) as send:
            with self.assertLogs(mail.LOG, level='WARNING') as logs:
                self.assertTrue(mail.deliver_one(self.database, self.config))
            self.assertFalse(mail.deliver_one(self.database, self.config))
            send.assert_called_once()
        self.assertNotIn('secret-fixture', ' '.join(logs.output))
        pending = self.row(t['id'])
        self.assertEqual(pending['lastError'], 'SMTPAuthenticationError (535)')
        self.assertGreater(pending['availableAt'], time.time())
        with mail.connect(self.database) as db:
            db.execute('UPDATE desk_mail_outbox SET availableAt=0')
        with patch.object(mail, 'send') as send:
            mail.deliver_one(self.database, {**self.config, 'recipient':'changed@example.test'})
        msg = send.call_args.args[0]
        self.assertEqual(str(msg['To']), self.config['recipient'])
        self.assertEqual(str(msg['Message-ID']), pending['messageId'])
        self.assertEqual(self.row(t['id'])['attempts'], 2)

    def test_parallel_workers_claim_only_once_without_holding_database_lock(self):
        t = self.create()
        entered, release = threading.Event(), threading.Event()
        def slow_send(*args):
            entered.set()
            self.assertTrue(release.wait(5))
        with patch.object(mail, 'send', side_effect=slow_send) as send, ThreadPoolExecutor(max_workers=2) as pool:
            result = pool.submit(mail.deliver_one, self.database, self.config)
            self.assertTrue(entered.wait(5))
            try:
                self.assertFalse(mail.deliver_one(self.database, self.config))
                # A slow SMTP connection does not block another ticket transaction.
                self.create()
            finally:
                release.set()
            self.assertTrue(result.result(5))
            send.assert_called_once()
        self.assertIsNotNone(self.row(t['id'])['sentAt'])

    def test_abandoned_lease_is_retried_after_restart(self):
        self.create()
        with mail.connect(self.database) as db:
            db.execute('UPDATE desk_mail_outbox SET leaseUntil=?,claimToken=?', (time.time()+300, 'old'))
        with patch.object(mail, 'send') as send:
            self.assertFalse(mail.deliver_one(self.database, self.config))
            with mail.connect(self.database) as db:
                db.execute('UPDATE desk_mail_outbox SET leaseUntil=0')
            self.assertTrue(mail.deliver_one(self.database, self.config))
            send.assert_called_once()

    def test_body_contains_ticket_details_but_not_credentials_or_injected_recipients(self):
        t = self.create(title='Hello\r\nBcc: victim@example.test', recipient='victim@example.test')
        pending = {**self.row(t['id']), 'recipient':self.config['recipient']}
        msg = mail.message(t, pending, self.config)
        self.assertIsNone(msg['Bcc'])
        self.assertEqual(str(msg['To']), self.config['recipient'])
        for content in (str(t['id']), 'Alice', 'alice@example.test', t['description'], mail.TEAM_URL):
            self.assertIn(content, msg.get_content())
        self.assertNotIn(self.config['password'], msg.as_string())

    def test_configuration_requires_private_file_explicit_enable_and_encrypted_smtp(self):
        self.assertIsNone(mail.settings())
        self.configure(enabled=False)
        self.assertIsNone(mail.settings())
        self.configure()
        self.assertEqual(mail.settings(), self.config)
        self.config_path.chmod(0o644)
        with self.assertRaises(ValueError): mail.settings()
        for changes in ({'recipient':'a@example.test,b@example.test'}, {'sender':'a@example.test\nBcc: b@example.test'},
                        {'security':'none'}, {'port':True}, {'password':''}):
            self.configure(**changes)
            with self.assertRaises(ValueError): mail.settings()

    def test_smtp_starts_tls_before_login_uses_exact_envelope_and_accepts_quit_failure(self):
        t = self.create()
        msg = mail.message(t, {**self.row(t['id']), 'recipient':self.config['recipient']}, self.config)
        client = Mock()
        client.send_message.return_value = {}
        client.quit.side_effect = OSError('closed after acceptance')
        with patch.object(mail.smtplib, 'SMTP', return_value=client), patch.object(mail.ssl, 'create_default_context') as tls:
            mail.send(msg, self.config)
        names = [call[0] for call in client.method_calls]
        self.assertLess(names.index('starttls'), names.index('login'))
        client.starttls.assert_called_once_with(context=tls.return_value)
        client.send_message.assert_called_once_with(msg, from_addr=self.config['sender'], to_addrs=[self.config['recipient']])
        client.close.assert_called_once()

    def test_ssl_transport_and_ip_authenticated_relay(self):
        t = self.create()
        config = {**self.config, 'security':'ssl', 'port':465, 'username':'', 'password':''}
        msg = mail.message(t, {**self.row(t['id']), 'recipient':config['recipient']}, config)
        client = Mock()
        client.send_message.return_value = {}
        with patch.object(mail.smtplib, 'SMTP_SSL', return_value=client) as smtp:
            mail.send(msg, config)
        smtp.assert_called_once()
        client.login.assert_not_called()
        client.starttls.assert_not_called()

    def test_worker_reloads_configuration_and_deduplicates_start(self):
        self.create()
        seen = threading.Event()
        with patch.object(mail, 'settings', return_value=self.config), patch.object(mail, 'send', side_effect=lambda *a: seen.set()):
            thread, stop = mail.start(self.database)
            try:
                self.assertEqual(mail.start(self.database), (thread, stop))
                self.assertTrue(seen.wait(5))
            finally:
                stop.set()
                thread.join(5)
        self.assertFalse(thread.is_alive())


if __name__ == '__main__':
    unittest.main()
