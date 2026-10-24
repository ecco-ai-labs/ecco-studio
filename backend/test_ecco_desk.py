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
        desk.initialize(self.database)
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
        body = {'op':'updateTicket','id':t['id'],'version':1,'status':'in_progress','priority':'urgent','assigneeId':mid,'dueDate':'2026-12-01'}
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

    def test_validation_and_persistence_preserve_legacy_records(self):
        self.setup_team()
        for change in ({'title':''},{'title':'x'*161},{'description':'x'*12001},{'priority':'invalid'},{'category':'unknown'},{'type':'wrong'}):
            self.assertEqual(self.call('alice',{'op':'createTicket','type':'support','title':'x','description':'y',**change})[0],400)
        self.assertEqual(self.call(body={'op':'addMember','userId':'google:unverified','role':'admin'})[0],400)
        self.assertEqual(self.call('staff',{'op':'createTicket','type':'internal','title':'x','description':'y','dueDate':'2026-02-30'})[0],400)
        t=self.create('alice',assigneeId='fake',dueDate='invalid')
        self.assertIsNone(t['assigneeId'])
        self.assertEqual(self.call('alice',{'op':'comment','id':t['id'],'body':'x'*40000})[0],413)
        desk.initialize(self.database)
        self.assertEqual(self.call('alice')[1]['tickets'][0]['id'],t['id'])
        self.assertEqual(api.legacy.records(),[{'id':'existing','kind':'story'}])
        with sqlite3.connect(self.database) as db:
            self.assertEqual(db.execute('PRAGMA integrity_check').fetchone()[0],'ok')

if __name__ == '__main__':
    unittest.main()
