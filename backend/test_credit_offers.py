"""Offer validation, targeting and lifecycle through the real authenticated routes."""
import json
import unittest
import ecco_desk as desk
from test_user_notifications import NotificationTest
class CreditOffersTest(unittest.TestCase):
    setUp=NotificationTest.setUp
    tearDown=NotificationTest.tearDown
    login=NotificationTest.login
    call=NotificationTest.call
    setup_team=NotificationTest.setup_team
    prepare=NotificationTest.prepare
    feed=NotificationTest.feed
    payload=NotificationTest.payload
    def offer(self):
        p=self.payload();p.update(kind='special_offer',severity='informational',offer=dict(credits=100,bonusCredits=50,cents=1000));return p
    def test_terms_targeting_idempotency_and_withdrawal(self):
        self.prepare();p=self.offer();p.update(audience='user',recipientId='google:alice')
        code,data=self.call(body=p);self.assertEqual(code,200,data);nid=data['id'];self.assertEqual(data['specialOfferVersion'],1)
        self.assertEqual(self.call(body=p)[0],200);self.assertEqual(self.feed('bob'),[])
        n=self.feed('alice')[0];self.assertEqual(n['kind'],'special_offer');self.assertEqual(n['offer'],p['offer'])
        p['offer']['cents']=2000;self.assertEqual(self.call(body=p)[0],409)
        self.assertEqual(self.call('staff',body=self.offer())[0],403)
        self.assertEqual(self.call(body=self.offer(),path='/api/desk/support')[0],403)
        self.call(body=dict(op='withdrawNotification',id=nid));self.assertEqual(self.feed('alice'),[])
    def test_read_and_expiry_and_invalid_terms(self):
        self.prepare();p=self.offer();nid=self.call(body=p)[1]['id'];self.call('alice',dict(op='readNotification',id=nid),path='/api/desk/support')
        self.assertEqual(self.feed('alice'),[]);self.assertEqual(len(self.feed('bob')),1)
        with desk.connect(self.database) as db:db.execute("UPDATE desk_notifications SET expiresAt='2000-01-01' WHERE id=?",(nid,))
        self.assertEqual(self.feed('bob'),[])
        for key,bad in [('credits',0),('credits',True),('bonusCredits',-1),('bonusCredits',1.5),('cents',0),('cents',100000001),('cents','1000')]:
            p=self.offer();p['offer'][key]=bad;self.assertEqual(self.call(body=p)[0],400,(key,bad))
        p=self.offer();p['severity']='warning';self.assertEqual(self.call(body=p)[0],400)
    def test_additive_migration_keeps_existing_records(self):
        self.prepare();nid=self.call(body=self.payload())[1]['id']
        with desk.connect(self.database) as db:db.execute('ALTER TABLE desk_notifications DROP COLUMN offer')
        desk.initialize(self.database,start_notifications=False)
        self.assertEqual(self.feed('alice')[0]['id'],nid);self.assertIsNone(self.feed('alice')[0]['offer'])
        self.assertEqual(self.call(body=self.offer())[0],200)
if __name__=='__main__':unittest.main()
