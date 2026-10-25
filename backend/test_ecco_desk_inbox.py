import json
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import Mock,patch

import storage_api  # Establish the existing service module paths.
import ecco_desk as desk
import ecco_desk_inbox as inbox
import ecco_desk_mail as mail


class InboxSecurity(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.db=Path(self.temp.name)/'studio.sqlite';desk.initialize(self.db,start_notifications=False)
        inbox._pending.clear()
        self.config={'recipient':'support@example.test'}
        self.credentials=Mock(refresh_token='fixture',has_scopes=Mock(return_value=True))
        self.flow=Mock(credentials=self.credentials)

    def authorize(self,profile):
        state='desk-inbox-fixture';inbox._pending[state]=(time.monotonic(),self.flow)
        client=Mock();client.users.return_value.getProfile.return_value.execute.return_value={'emailAddress':profile}
        with patch.object(inbox,'_build',return_value=client),patch.object(mail,'settings',return_value=self.config),patch.object(inbox,'_save') as save:
            result=inbox.finish({'state':[state],'code':['fixture-code']})
            return result,save.call_args

    def test_wrong_inbox_is_rejected_without_saving(self):
        with self.assertRaisesRegex(ValueError,'other inboxes'):
            self.authorize('personal@example.test')

    def test_expected_mailbox_and_scope_are_required_and_state_is_single_use(self):
        result,args=self.authorize('support@example.test');self.assertEqual(result,'support@example.test')
        self.assertEqual(args.args[1],result)
        with self.assertRaisesRegex(ValueError,'expired'):inbox.finish({'state':['desk-inbox-fixture'],'code':['same-code']})
        self.credentials.has_scopes.return_value=False
        with self.assertRaisesRegex(ValueError,'read-only Gmail'):self.authorize('support@example.test')

    def test_provider_error_does_not_expose_code_or_tokens(self):
        self.flow.fetch_token.side_effect=RuntimeError('secret token fixture-code')
        with self.assertRaises(ValueError) as error:self.authorize('support@example.test')
        self.assertNotIn('secret',str(error.exception));self.assertNotIn('fixture-code',str(error.exception))

    def test_cancel_and_expired_states_do_not_exchange_code(self):
        for when,query in [(time.monotonic()-601,{}),(time.monotonic(),{'error':['access_denied']})]:
            inbox._pending['desk-inbox-x']=(when,self.flow)
            with self.assertRaises(ValueError):inbox.finish({'state':['desk-inbox-x'],'code':['unused'],**query})
        self.flow.fetch_token.assert_not_called()

    def test_initial_sync_captures_baseline_before_scan_and_history_is_replayed_safely(self):
        client=Mock();users=client.users.return_value
        users.getProfile.return_value.execute.return_value={'historyId':'100'}
        users.messages.return_value.list.return_value.execute.return_value={'messages':[{'id':'one'}]}
        users.messages.return_value.get.return_value.execute.return_value={'id':'one','raw':'','labelIds':['INBOX']}
        users.history.return_value.list.return_value.execute.return_value={'historyId':'101','history':[{'messagesAdded':[{'message':{'id':'two'}}]}]}
        credentials=Mock();credentials.to_json.return_value='{}'
        saved=dict(mailbox='support@example.test',credentials={})
        def imported(db,data,config):
            db.execute('INSERT INTO desk_inbound_mail VALUES (?,NULL,NULL,?,?)',(data['id'],'unmatched',time.time()))
        with patch.object(inbox,'_saved',return_value=saved),patch.object(inbox,'_save'),patch.object(mail,'settings',return_value=self.config),patch.object(inbox,'_build',return_value=client),patch.object(inbox.oauth,'_dependencies',return_value=(Mock(),Mock(from_authorized_user_info=Mock(return_value=credentials)),Mock())),patch.object(inbox.replies,'import_message',side_effect=imported) as import_message:
            inbox._last_sync=0;inbox.sync(self.db)
            with mail.connect(self.db) as db:self.assertEqual(db.execute("SELECT value FROM desk_inbox_meta WHERE key='historyId'").fetchone()[0],'100')
            users.messages.return_value.get.return_value.execute.return_value={'id':'two','raw':'','labelIds':['INBOX']}
            inbox._last_sync=0;inbox.sync(self.db)
            self.assertEqual(import_message.call_count,2)
            users.history.return_value.list.assert_called_once()
            with mail.connect(self.db) as db:self.assertEqual(db.execute("SELECT value FROM desk_inbox_meta WHERE key='historyId'").fetchone()[0],'101')
            inbox._last_sync=0;inbox.sync(self.db)
            self.assertEqual(import_message.call_count,2)
