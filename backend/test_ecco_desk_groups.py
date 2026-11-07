"""Stable-identity group grants, revocation, setup security and narrow permissions."""
import json
import os
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import Mock, patch
from cryptography.fernet import Fernet
import storage_api
import ecco_desk_groups as groups
import ecco_desk as desk
import test_user_notifications as fixtures

SETTINGS = dict(groupId='group123', groupEmail='admins@example.test', ownerId='google:123', ownerEmail='owner@example.test')


class GroupSecurity(unittest.TestCase):
    def setUp(self):
        groups._pending.clear(); groups._cache.clear()
        self.temp=tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name)
        for name, value in [('CONFIG_FILE',self.root/'config.json'),('TOKEN_FILE',self.root/'token.json')]:
            p=patch.object(groups,name,value); p.start(); self.addCleanup(p.stop)
        groups.CONFIG_FILE.write_text(json.dumps(SETTINGS)); groups.CONFIG_FILE.chmod(0o600)
        self.credentials=Mock(refresh_token='private-refresh', granted_scopes=list(groups.SCOPES))
        self.credentials.has_scopes.return_value=True
        self.flow=Mock(credentials=self.credentials)

    def authorize(self, **kwargs):
        state=groups.PREFIX+'test'; groups._pending[state]=(time.monotonic(),self.flow,SETTINGS)
        with patch.object(groups,'_owner',return_value=kwargs.get('owner',True)), patch.object(groups,'_member',return_value=kwargs.get('member',True)), patch.object(groups,'_save') as save:
            result=groups.finish({'state':[state],'code':['private-code']})
            self.assertEqual(save.call_count,1)
            return result

    def test_scope_owner_membership_and_single_use(self):
        self.assertEqual(self.authorize(),SETTINGS['groupEmail'])
        with self.assertRaisesRegex(ValueError,'expired'): groups.finish({'state':[groups.PREFIX+'test']})
        for kwargs in ({'owner':False},{'member':False}):
            with self.assertRaises(ValueError): self.authorize(**kwargs)
        self.credentials.granted_scopes=['openid']
        with self.assertRaisesRegex(ValueError,'read-only'): self.authorize()
        self.credentials.granted_scopes=list(groups.SCOPES); self.credentials.refresh_token=None
        with self.assertRaisesRegex(ValueError,'read-only'): self.authorize()

    def test_cancel_expiry_configuration_changes_and_provider_secrets(self):
        for timestamp, query in [(time.monotonic()-601,{}),(time.monotonic(),{'error':['denied']})]:
            groups._pending['s']=(timestamp,self.flow,SETTINGS)
            with self.assertRaises(ValueError): groups.finish({'state':['s'],'code':['x'],**query})
        groups._pending['s']=(time.monotonic(),self.flow,{**SETTINGS,'groupId':'other'})
        with self.assertRaisesRegex(ValueError,'changed'): groups.finish({'state':['s'],'code':['x']})
        self.flow.fetch_token.assert_not_called()
        for error in (RuntimeError('private-code private-refresh'),ValueError('private-code private-refresh')):
            self.flow.fetch_token.side_effect=error
            with self.assertRaises(ValueError) as caught: self.authorize()
            self.assertNotIn('private-',str(caught.exception))

    def test_denial_distinguishes_disabled_api_scope_and_admin_privileges_without_secrets(self):
        for reason, expected in [('SERVICE_DISABLED', 'Admin SDK API is disabled'),
                                 ('accessNotConfigured', 'Admin SDK API is disabled'),
                                 ('ACCESS_TOKEN_SCOPE_INSUFFICIENT', 'required group-membership scope'),
                                 ('forbidden', 'Directory API privileges')]:
            error=RuntimeError('private-refresh private-code')
            error.resp=Mock(status=403)
            error.content=json.dumps({'error':{'message':'private-code',
                'details':[{'reason':reason,'metadata':{'secret':'private-refresh'}}]}}).encode()
            self.flow.fetch_token.side_effect=error
            with self.assertRaisesRegex(ValueError,expected) as caught: self.authorize()
            self.assertNotIn('private-',str(caught.exception))
        self.assertIn('Directory API privileges',groups._denied_message(ValueError('private-code')))

    def test_membership_is_bound_to_subject_and_active_direct_user(self):
        client=Mock(); get=client.members.return_value.get
        record=dict(id='123',type='USER',status='ACTIVE',role='OWNER')
        with patch.object(groups,'_build',return_value=client):
            get.return_value.execute.return_value=record
            self.assertTrue(groups._member(self.credentials,SETTINGS,'123'))
            get.assert_called_with(groupKey='group123',memberKey='123')
            for changed in ({'id':'456'},{'type':'GROUP'},{'status':'SUSPENDED'},{'role':'UNKNOWN'}):
                get.return_value.execute.return_value={**record,**changed}
                self.assertFalse(groups._member(self.credentials,SETTINGS,'123'))

    def test_revocation_refresh_and_provider_failure_never_reuse_positive_grant(self):
        deps=(Mock(),Mock(from_authorized_user_info=Mock(return_value=self.credentials)),Mock())
        with patch.object(groups,'_saved',return_value={'fixture':True}),patch.object(groups.oauth,'_dependencies',return_value=deps),patch.object(groups,'_member',return_value=True) as member:
            user={'id':'google:123','email':'owner@example.test'}
            self.assertTrue(groups.access(user)['canManageNotifications'])
            member.return_value=False
            self.assertTrue(groups.access(user)['canManageNotifications'])
            self.assertFalse(groups.access(user,fresh=True)['canManageNotifications'])
            member.side_effect=RuntimeError('provider unavailable')
            result=groups.access(user,fresh=True)
            self.assertFalse(result['canManageNotifications']);self.assertEqual(result['notificationGroupStatus'],'unavailable')
            groups._cache.clear(); member.side_effect=None; member.return_value=True
            self.assertTrue(groups.access(user)['canManageNotifications'])
            groups._cache[('group123','google:123')]=(time.monotonic()-1,{'canManageNotifications':True})
            member.side_effect=RuntimeError('provider unavailable')
            self.assertFalse(groups.access(user)['canManageNotifications'])
            member.reset_mock()
            self.assertFalse(groups.access({'id':'email:owner@example.test'})['canManageNotifications']);member.assert_not_called()

    def test_private_encrypted_credentials_are_bound_to_approved_config(self):
        payload=dict(refresh_token='private-refresh',client_id=groups.google_signin.CLIENT_ID,token_uri='https://oauth2.googleapis.com/token',scopes=list(groups.SCOPES))
        self.credentials.to_json.return_value=json.dumps(payload)
        cipher=Fernet(Fernet.generate_key())
        with patch.object(groups.oauth,'_cipher',return_value=cipher):
            groups._save(self.credentials,SETTINGS)
            self.assertNotIn('private-refresh',groups.TOKEN_FILE.read_text())
            self.assertEqual(groups.TOKEN_FILE.stat().st_mode&0o777,0o600)
            self.assertEqual(groups._saved(SETTINGS),payload)
            self.assertIsNone(groups._saved({**SETTINGS,'groupId':'other'}))
            groups.TOKEN_FILE.chmod(0o644); self.assertIsNone(groups._saved(SETTINGS))
        groups.CONFIG_FILE.chmod(0o644); self.assertIsNone(groups.config())


class GroupPermissions(unittest.TestCase):
    setUp=fixtures.NotificationTest.setUp
    tearDown=fixtures.NotificationTest.tearDown
    login=fixtures.NotificationTest.login
    call=fixtures.NotificationTest.call
    setup_team=fixtures.NotificationTest.setup_team
    payload=fixtures.NotificationTest.payload

    def test_group_only_grant_cannot_access_staff_tickets_or_members_and_is_revocable(self):
        self.setup_team()
        ticket=self.call('bob',dict(op='createTicket',type='support',title='Private',description='Private'))[1]['ticket']
        with patch.object(groups,'access',return_value={'canManageNotifications':True}) as access:
            data=self.call('alice')[1]
            self.assertEqual(data['me']['role'],'customer');self.assertEqual(data['tickets'],[])
            self.assertEqual(data['members'],[]);self.assertEqual(data['users'],[])
            self.assertEqual(self.call('alice',path='/api/desk?ticket='+str(ticket['id']))[0],404)
            self.assertEqual(self.call('alice',dict(op='addMember',userId='google:bob',role='admin'))[0],403)
            self.assertEqual(self.call('alice',dict(op='createTicket',type='internal',title='x',description='y'))[0],403)
            self.assertEqual(self.call('alice',path='/api/desk?manageNotifications=1')[0],200)
            status,result=self.call('alice',self.payload());self.assertEqual(status,200,result)
            self.assertTrue(access.call_args.kwargs['fresh'])
            self.assertEqual(self.call('alice',dict(op='withdrawNotification',id=result['id']))[0],200)
            self.assertTrue(access.call_args.kwargs['fresh'])
            self.assertEqual(self.call('alice',path='/api/desk/support?manageNotifications=1')[0],403)
            self.assertEqual(self.call('alice',self.payload(),path='/api/desk/support')[0],403)
            access.return_value={'canManageNotifications':False,'notificationGroupStatus':'unavailable'}
            self.assertEqual(self.call('alice',self.payload())[0],403)
            self.assertEqual(self.call('alice',path='/api/desk?manageNotifications=1')[0],403)
        with desk.connect(self.database) as db:
            self.assertIsNone(db.execute("SELECT 1 FROM desk_members WHERE userId='google:alice'").fetchone())

    def test_setup_endpoint_requires_owner_key_origin_and_empty_post(self):
        endpoint='/api/desk/notification-group/connect'
        with patch.object(groups,'start',return_value={'url':'https://accounts.google.com/fixture'}) as start:
            self.assertEqual(self.call('alice',{},path=endpoint)[0],401)
            headers={'Authorization':'Bearer '+storage_api.Handler.access_key}
            self.assertEqual(self.call('anonymous',{},path=endpoint,extra=headers,origin='https://evil.example')[0],403)
            self.assertEqual(self.call('anonymous',path=endpoint,extra=headers)[0],405)
            self.assertEqual(self.call('anonymous',{'groupId':'other'},path=endpoint,extra=headers)[0],400)
            start.assert_not_called()
            self.assertEqual(self.call('anonymous',{},path=endpoint,extra=headers)[0],200)
            start.assert_called_once_with()


if __name__=='__main__': unittest.main()
