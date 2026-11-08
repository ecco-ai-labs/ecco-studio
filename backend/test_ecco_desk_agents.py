"""Shared agent definitions use verified admin authority and durable bounded plans."""
import unittest
import uuid
from unittest.mock import patch
import test_ecco_desk as fixtures
import ecco_desk as desk

class AgentTest(unittest.TestCase):
    setUp=fixtures.DeskTest.setUp
    tearDown=fixtures.DeskTest.tearDown
    login=fixtures.DeskTest.login
    call=fixtures.DeskTest.call
    setup_team=fixtures.DeskTest.setup_team

    def payload(self, **changes):
        p=dict(op='createAgent',id=str(uuid.uuid4()),name='Release checks',description='Video then story',
               steps=[dict(mode='workflow',workflow='video'),dict(mode='workflow',workflow='story')])
        p.update(changes);return p

    def test_admin_creation_shared_persistence_and_idempotent_retry(self):
        self.setup_team();p=self.payload()
        status,result=self.call(body=p);self.assertEqual(status,200,result)
        self.assertEqual(self.call(body=p)[0],200)
        desk.initialize(self.database,start_notifications=False)
        customer=self.call('alice')[1]
        self.assertEqual(customer['agentWorkflowVersion'],1)
        self.assertEqual(len(customer['agents']),1)
        self.assertEqual(customer['agents'][0]['steps'],p['steps'])
        self.assertNotIn('createdBy',customer['agents'][0])
        self.assertFalse(customer['me']['canManageAgents'])
        self.assertEqual(customer['members'],[])
        with desk.connect(self.database) as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM records').fetchone()[0],1)

    def test_unprivileged_and_embedded_surfaces_cannot_create(self):
        self.setup_team()
        for who in ('staff','alice','bob'):
            self.assertEqual(self.call(who,self.payload())[0],403)
        self.assertEqual(self.call(body=self.payload(),path='/api/desk/support')[0],403)
        self.assertNotIn('agents',self.call(path='/api/desk/support')[1])
        self.assertEqual(self.call('anonymous',self.payload())[0],401)
        self.assertEqual(self.call(body=self.payload(),origin='https://evil.example')[0],403)

    def test_group_admin_is_verified_fresh_and_revocation_blocks_create(self):
        self.setup_team()
        with patch.object(desk.ecco_desk_groups,'access',return_value={'canManageNotifications':True}) as access:
            self.assertEqual(self.call('alice',self.payload())[0],200)
            self.assertTrue(access.call_args.kwargs['fresh'])
            me=self.call('alice')[1]['me'];self.assertEqual(me['role'],'customer');self.assertTrue(me['canManageAgents'])
            access.return_value={'canManageNotifications':False}
            self.assertEqual(self.call('alice',self.payload(name='Next checks'))[0],403)
        with desk.connect(self.database) as db:
            self.assertIsNone(db.execute("SELECT 1 FROM desk_members WHERE userId='google:alice'").fetchone())

    def test_invalid_or_executable_plans_are_rejected(self):
        self.setup_team()
        for change in [dict(name=' '),dict(name='x'*81),dict(description='x'*501),dict(id='invalid'),
                       dict(steps=[]),dict(steps=[dict(mode='ux',workflow='libraries')]*13),
                       dict(steps=[dict(mode='publish',workflow='video')]),
                       dict(steps=[dict(mode='workflow',workflow='https://example.test')]),
                       dict(steps=[dict(mode='ux',workflow='libraries',code='alert(1)')]),dict(canManageAgents=True)]:
            status,result=self.call(body=self.payload(**change));self.assertEqual(status,400,(change,result))
        self.assertEqual(self.call()[1]['agents'],[])

    def test_duplicate_names_reserved_builtin_and_conflicting_retry(self):
        self.setup_team();p=self.payload();self.assertEqual(self.call(body=p)[0],200)
        self.assertEqual(self.call(body=self.payload(name='RELEASE CHECKS'))[0],409)
        self.assertEqual(self.call(body=self.payload(name='Tester Agent'))[0],409)
        self.assertEqual(self.call(body={**p,'name':'Different plan'})[0],409)
        self.assertEqual(len(self.call()[1]['agents']),1)

if __name__=='__main__':unittest.main()
