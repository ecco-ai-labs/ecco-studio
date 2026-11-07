"""HTTP permission and persistence checks against isolated temporary SQLite."""
import json
import sqlite3
import tempfile
import threading
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen
from unittest.mock import patch
from http.server import ThreadingHTTPServer

import storage_api as api
import ecco_desk as desk
import google_signin as auth


class DeskTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.data_patch = patch.object(api.legacy, 'DATA', self.root)
        self.data_patch.start()
        self.database = self.root / 'studio.sqlite'
        with sqlite3.connect(self.database) as db:
            db.execute('CREATE TABLE records(id TEXT PRIMARY KEY,kind TEXT,body TEXT)')
            db.execute('INSERT INTO records VALUES (?,?,?)', ('existing', 'story', '{"id":"existing","kind":"story"}'))
        desk.initialize(self.database, start_notifications=False)
        api.Handler.access_key = 'test-private-key-' + 'x'*32
        self.server = ThreadingHTTPServer(('127.0.0.1', 0), api.Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base = 'http://127.0.0.1:' + str(self.server.server_port)
        self.tokens = {n: self.login(n) for n in ('owner', 'staff', 'alice', 'bob')}

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.data_patch.stop()
        self.tmp.cleanup()

    def login(self, name, email=None):
        pending = auth.challenge()
        claims = dict(sub=name, name=name.title(), email=email or name+'@example.test',
                      aud=auth.CLIENT_ID, iss='https://accounts.google.com', exp=time.time()+3600, nonce=pending['nonce'])
        with patch.object(auth, 'verifier', return_value=claims):
            return auth.login({'challenge':pending['challenge'],'credential':'fixture'})['session_token']

    def call(self, user='owner', body=None, path='/api/desk', origin=api.ALLOWED_ORIGIN, key=False, extra=None):
        headers = {'Origin':origin, 'Content-Type':'application/json', **(extra or {})}
        if user in self.tokens: headers['Authorization'] = 'Bearer '+self.tokens[user]
        if key: headers['X-Ecco-Workspace-Key'] = api.Handler.access_key
        try:
            with urlopen(Request(self.base+path, data=json.dumps(body).encode() if body is not None else None, headers=headers)) as r:
                return r.status, json.load(r)
        except HTTPError as r:
            return r.code, json.load(r)

    def setup_team(self):
        self.assertEqual(self.call(body={'op':'bootstrap'}, key=True)[0], 200)
        self.call('staff')
        self.assertEqual(self.call(body={'op':'addMember','userId':'google:staff','role':'staff'})[0], 200)

    def create(self, user='alice', **kwargs):
        code, data = self.call(user, {'op':'createTicket','type':'support','title':'Help with Studio','description':'Test issue', **kwargs})
        self.assertEqual(code, 201, data)
        return data['ticket']

    def test_after_hours_create_persists_type_reply_works_and_chat_stays_closed(self):
        import ecco_desk_chat as chat
        with patch.object(chat, 'is_open', return_value=False):
            for request_type in desk.REQUEST_TYPES:
                code, result = self.call('alice', dict(op='createTicket', type='support',
                    requestType=request_type, title='After-hours issue', description='Please help'), path='/api/desk/support')
                self.assertEqual(code, 201, result)
                t = result['ticket']
                self.assertEqual(t['requestType'], request_type)
                self.assertEqual(t['type'], 'support')
                self.assertEqual(self.call('alice', dict(op='comment', id=t['id'], body='More details'), path='/api/desk/support')[0], 200)
                self.assertEqual(self.call('alice', dict(op='chatRequest', id=t['id']), path='/api/desk/support')[0], 409)
                self.assertEqual(self.call('bob', path=f'/api/desk/support?ticket={t["id"]}')[0], 404)
            desk.initialize(self.database, start_notifications=False)
            saved = self.call('alice', path='/api/desk/support')[1]
            self.assertFalse(saved['chatSupport']['open'])
            self.assertEqual({t['requestType'] for t in saved['tickets']}, set(desk.REQUEST_TYPES))

    def test_unreadable_mail_configuration_does_not_reject_ticket(self):
        with patch.object(desk.ecco_desk_mail, 'settings', side_effect=PermissionError('private-fixture')):
            t = self.create(requestType='Bug')
        with desk.connect(self.database) as db:
            self.assertEqual(db.execute('SELECT ticketId FROM desk_ack_pending').fetchone()[0], t['id'])

    def test_typing_customer_endpoint_keeps_requester_boundary(self):
        import ecco_desk_chat as chat
        self.setup_team()
        t=self.create()
        with patch.object(chat,'is_open',return_value=True):
            for user,body,path in [
                ('alice',dict(op='chatRequest',id=t['id']),'/api/desk/support'),
                ('staff',dict(op='chatPresence',available=True),'/api/desk'),
                ('staff',dict(op='chatAccept',id=t['id']),'/api/desk'),
                ('alice',dict(op='chatTyping',id=t['id'],typing=True),'/api/desk/support')]:
                self.assertEqual(self.call(user,body,path)[0],200)
            self.assertEqual(self.call('staff',path=f'/api/desk?ticket={t["id"]}')[1]['chat']['typing']['name'],'Alice')
            self.assertEqual(self.call('bob',dict(op='chatTyping',id=t['id'],typing=True),'/api/desk/support')[0],404)
            self.assertEqual(self.call('staff',dict(op='chatTyping',id=t['id'],typing=True),'/api/desk/support')[0],404)

    def test_server_error_has_traceable_reference_without_private_values(self):
        with patch.object(desk, 'write', side_effect=sqlite3.OperationalError('secret-fixture')), self.assertLogs(desk.LOG, level='ERROR') as logs:
            code, result = self.call('alice', dict(op='createTicket', type='support', title='x', description='y'), path='/api/desk/support')
        self.assertEqual(code, 503)
        self.assertRegex(result['reference'], r'^[a-f0-9]{12}$')
        self.assertIn(result['reference'], ' '.join(logs.output))
        self.assertNotIn('secret-fixture', json.dumps(result) + ' '.join(logs.output))

    def test_type_migration_and_staff_edit_preserve_ticket_permissions(self):
        self.setup_team()
        support = self.create()
        internal = self.create('staff', type='internal')
        with desk.connect(self.database) as db:
            db.execute('ALTER TABLE desk_tickets DROP COLUMN requestType')
        desk.initialize(self.database, start_notifications=False)
        with desk.connect(self.database) as db:
            self.assertEqual(dict(db.execute('SELECT id,requestType FROM desk_tickets')), {support['id']:'Other', internal['id']:'Task'})
        self.assertEqual(self.call('alice', dict(op='updateTicket', id=support['id'], version=1, requestType='Task'), path='/api/desk/support')[0], 403)
        self.assertEqual(self.call('staff', dict(op='claimTicket', id=support['id']))[0], 200)
        current = self.call('staff', path=f'/api/desk?ticket={support["id"]}')[1]['ticket']
        code, result = self.call('staff', dict(op='updateTicket', id=support['id'], version=current['version'], requestType='Feature Request'))
        self.assertEqual(code, 200)
        self.assertEqual(result['ticket']['requestType'], 'Feature Request')
        self.assertEqual(result['ticket']['type'], 'support')
        history = self.call('alice', path=f'/api/desk/support?ticket={support["id"]}')[1]['events']
        self.assertTrue(any(e['detail']=='Type changed to Feature Request' for e in history))

    def test_live_chat_routes_preserve_customer_isolation_and_require_staff_acceptance(self):
        import ecco_desk_chat as chat
        self.setup_team()
        t = self.create()
        with patch.object(chat, 'is_open', return_value=True):
            for user in ('owner', 'staff', 'alice'):
                code, _ = self.call(user, {'op':'chatPresence','available':True}, path='/api/desk/support')
                self.assertEqual(code, 403)
            code, result = self.call('alice', {'op':'chatRequest','id':t['id']}, path='/api/desk/support')
            self.assertEqual(code, 200)
            self.assertEqual(result['chat']['state'], 'queued')
            self.assertEqual(self.call('bob', {'op':'chatRequest','id':t['id']}, path='/api/desk/support')[0], 404)
            self.assertEqual(self.call('alice', {'op':'chatAccept','id':t['id']})[0], 403)
            self.assertEqual(self.call('staff', {'op':'chatPresence','available':True})[0], 200)
            self.assertEqual(self.call('staff', {'op':'chatAccept','id':t['id']})[0], 200)

            self.assertEqual(self.call('alice', {'op':'chatMessage','id':t['id'],'body':'Customer chat'}, path='/api/desk/support')[0], 200)
            self.assertEqual(self.call('staff', {'op':'chatMessage','id':t['id'],'body':'Wrong surface'}, path='/api/desk/support')[0], 404)
            self.assertEqual(self.call('staff', {'op':'chatMessage','id':t['id'],'body':'Staff chat'})[0], 200)
            code, detail = self.call('alice', path='/api/desk/support?ticket='+str(t['id']))
            self.assertEqual(code, 200)
            self.assertEqual([c['channel'] for c in detail['comments']], ['chat','chat'])

    def test_customer_can_close_and_reopen_only_own_issue_without_losing_history(self):
        import ecco_desk_chat as chat
        t = self.create()
        path = '/api/desk/support'
        with patch.object(chat, 'is_open', return_value=True):
            self.assertEqual(self.call('alice', {'op':'chatRequest','id':t['id']}, path=path)[0], 200)
            self.assertEqual(self.call('bob', {'op':'closeIssue','id':t['id'],'version':t['version']}, path=path)[0], 404)
            code, closed = self.call('alice', {'op':'closeIssue','id':t['id'],'version':t['version'],'assigneeId':'forged'}, path=path)
            self.assertEqual(code, 200)
            self.assertEqual(closed['ticket']['status'], 'closed')
            self.assertIsNone(closed['ticket']['assigneeId'])
            detail = self.call('alice', path=path+'?ticket='+str(t['id']))[1]
            self.assertEqual(detail['chat']['state'], 'ended')
            self.assertTrue(any(e['detail']=='Issue closed by requester' for e in detail['events']))
            self.assertEqual(self.call('alice', {'op':'chatRequest','id':t['id']}, path=path)[0], 409)
            self.assertEqual(self.call('alice', {'op':'reopenIssue','id':t['id'],'version':t['version']}, path=path)[0], 409)
            code, reopened = self.call('alice', {'op':'reopenIssue','id':t['id'],'version':closed['ticket']['version']}, path=path)
            self.assertEqual(code, 200)
            self.assertEqual(reopened['ticket']['status'], 'open')
            self.assertEqual(self.call('alice', {'op':'chatRequest','id':t['id']}, path=path)[0], 200)

    def test_identity_does_not_grant_internal_or_shared_workspace_access(self):
        self.assertEqual(self.call('missing')[0], 401)
        self.assertEqual(self.call(origin='https://evil.example')[0], 403)
        self.assertEqual(self.call(path='/api/state')[0], 401)
        self.assertEqual(self.call(body={'op':'bootstrap'})[0], 403)
        self.assertEqual(self.call('alice', {'op':'createTicket','type':'internal'})[0], 403)
        self.assertEqual(self.call('alice', {'op':'addMember','userId':'google:bob','role':'admin'})[0], 403)

    def test_bootstrap_is_single_explicit_claim_and_subject_not_email(self):
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda user:self.call(user, {'op':'bootstrap'}, key=True)[0], ('owner','alice')))
        self.assertEqual(sorted(results), [200,409])
        winner = 'owner' if results[0] == 200 else 'alice'
        self.tokens['bob'] = self.login('different-sub', winner+'@example.test')
        self.assertEqual(self.call('bob')[1]['me']['role'], 'customer')

    def test_customer_isolation_and_internal_notes(self):
        self.setup_team()
        own = self.create()
        other = self.create('bob')
        task = self.create('staff', type='internal')
        self.assertEqual([t['id'] for t in self.call('alice')[1]['tickets']], [own['id']])
        self.assertEqual(self.call('alice')[1]['members'], [])
        self.assertEqual(self.call('alice')[1]['users'], [])
        self.assertEqual(self.call('alice')[1]['activity'], [])
        for tid in (other['id'], task['id'], 999):
            self.assertEqual(self.call('alice', path=f'/api/desk?ticket={tid}')[0], 404)
            self.assertEqual(self.call('alice', {'op':'comment','id':tid,'body':'intrusion'})[0], 404)
        self.assertEqual(self.call('staff', {'op':'claimTicket','id':own['id']})[0],200)
        for visibility in ('public','internal'):
            self.assertEqual(self.call('staff', {'op':'comment','id':own['id'],'body':visibility+' message','visibility':visibility})[0], 200)
        detail = self.call('alice', path=f'/api/desk?ticket={own["id"]}')[1]
        self.assertEqual([c['body'] for c in detail['comments']], ['public message'])
        self.assertTrue(all(e['visibility']=='public' for e in detail['events']))
        self.assertEqual(self.call('alice', {'op':'comment','id':own['id'],'body':'reply','visibility':'internal'})[0],200)
        self.assertEqual(self.call('staff', path=f'/api/desk?ticket={own["id"]}')[1]['comments'][-1]['visibility'], 'public')
        self.assertEqual(self.call('alice', {'op':'updateTicket','id':own['id'],'version':1,'status':'closed'})[0],403)

    def test_assignment_updates_conflicts_and_revocation(self):
        self.setup_team()
        mid = self.call('staff')[1]['me']['memberId']
        t = self.create()
        t = self.call('staff', {'op':'claimTicket','id':t['id']})[1]['ticket']
        body = {'op':'updateTicket','id':t['id'],'version':t['version'],'status':'in_progress','priority':'urgent','assigneeId':mid,'dueDate':'2026-12-01'}
        code, result = self.call('staff', body)
        self.assertEqual(code,200)
        self.assertEqual(result['ticket']['assigneeId'],mid)
        self.assertEqual(self.call('staff',body)[0],409)
        public = self.call('alice',path=f'/api/desk?ticket={t["id"]}')[1]
        self.assertIsNone(public['ticket']['assigneeId'])
        self.assertIsNone(public['ticket']['dueDate'])
        self.assertEqual(len(public['events']),3)
        self.assertEqual(self.call('staff',{'op':'updateMember','id':mid,'active':0})[0],403)
        self.assertEqual(self.call(body={'op':'updateMember','id':mid,'active':0})[0],200)
        self.assertEqual(self.call('staff')[1]['me']['role'],'customer')
        self.assertEqual(self.call('staff',path=f'/api/desk?ticket={t["id"]}')[0],404)
        self.assertEqual(self.call(body={'op':'updateMember','id':self.call()[1]['me']['memberId'],'active':0})[0],400)

    def test_studio_support_enforces_ownership_for_every_role(self):
        self.setup_team()
        own = {name: self.create(name) for name in self.tokens}
        internal = self.create('owner', type='internal')
        for name in self.tokens:
            tid = own[name]['id']
            self.call('staff', {'op':'comment','id':tid,'body':'Staff-only note','visibility':'internal'})
            code, result = self.call(name, path='/api/desk/support')
            self.assertEqual(code, 200)
            self.assertEqual([t['id'] for t in result['tickets']], [tid])
            self.assertEqual(result['me']['role'], 'customer')
            self.assertIsNone(result['me']['memberId'])
            for key in ('members','users','activity'):
                self.assertEqual(result[key], [])
            self.assertFalse(result['needsSetup'])
            detail = self.call(name, path=f'/api/desk/support?ticket={tid}')[1]
            self.assertEqual(detail['comments'], [])
            self.assertTrue(all(e['visibility']=='public' for e in detail['events']))
            self.assertEqual(self.call(name, {'op':'comment','id':tid,'body':'My reply','visibility':'internal'}, path='/api/desk/support')[0], 200)
            self.assertEqual(self.call(name, path=f'/api/desk/support?ticket={tid}')[1]['comments'][0]['visibility'], 'public')
            for other in [t for t in own.values() if t['id'] != tid] + [internal]:
                self.assertEqual(self.call(name, path=f'/api/desk/support?ticket={other["id"]}')[0], 404)
                self.assertEqual(self.call(name, {'op':'comment','id':other['id'],'body':'No access'}, path='/api/desk/support')[0], 404)
            for body in ({'op':'createTicket','type':'internal'}, {'op':'bootstrap'},
                         {'op':'addMember','userId':'google:bob','role':'admin'},
                         {'op':'updateTicket','id':tid,'version':1,'status':'closed'}):
                self.assertEqual(self.call(name, body, path='/api/desk/support', key=True)[0], 403)
            code, created = self.call(name, {'op':'createTicket','type':'support','title':'New request','description':'Please help','reporterId':'google:other','assigneeId':'fake'}, path='/api/desk/support')
            self.assertEqual(code,201)
            self.assertEqual(created['ticket']['reporterId'], 'google:'+name)
            self.assertIsNone(created['ticket']['assigneeId'])
        # The separate, explicitly authorized team console still serves support.
        self.assertEqual(self.call('owner')[1]['me']['role'],'admin')
        self.assertEqual(self.call('staff',path=f'/api/desk?ticket={own["alice"]["id"]}')[0],200)

    def test_validation_and_persistence_preserve_legacy_records(self):
        self.setup_team()
        for change in ({'title':''},{'title':'x'*161},{'description':'x'*12001},{'priority':'invalid'},{'category':'unknown'},{'type':'wrong'},{'requestType':'internal'}):
            self.assertEqual(self.call('alice',{'op':'createTicket','type':'support','title':'x','description':'y',**change})[0],400)
        self.assertEqual(self.call(body={'op':'addMember','userId':'google:unverified','role':'admin'})[0],400)
        self.assertEqual(self.call('staff',{'op':'createTicket','type':'internal','title':'x','description':'y','dueDate':'2026-02-30'})[0],400)
        t=self.create('alice',assigneeId='fake',dueDate='invalid')
        self.assertIsNone(t['assigneeId'])
        self.assertEqual(self.call('alice',{'op':'comment','id':t['id'],'body':'x'*40000})[0],413)
        desk.initialize(self.database, start_notifications=False)
        self.assertEqual(self.call('alice')[1]['tickets'][0]['id'],t['id'])
        self.assertEqual(api.legacy.records(),[{'id':'existing','kind':'story'}])
        with sqlite3.connect(self.database) as db:
            self.assertEqual(db.execute('PRAGMA integrity_check').fetchone()[0],'ok')

if __name__ == '__main__':
    unittest.main()
