import datetime as dt
import unittest
import uuid
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch
import test_ecco_desk as fixtures
import ecco_desk as desk
import ecco_campaigns as campaigns
UTC=dt.timezone.utc
class ScheduleTest(unittest.TestCase):
 def plan(self,kind='cyber_monday',**kw):return dict(kind=kind,time='09:00',timezone='America/Los_Angeles',**kw)
 def test_holidays_and_zone(self):
  self.assertEqual(campaigns.next_run(self.plan(),dt.datetime(2026,11,1,tzinfo=UTC)),dt.datetime(2026,11,30,17,tzinfo=UTC))
  self.assertEqual(campaigns.next_run(self.plan(),dt.datetime(2026,12,1,tzinfo=UTC)),dt.datetime(2027,11,29,17,tzinfo=UTC))
  self.assertEqual(campaigns.next_run(self.plan('black_friday'),dt.datetime(2026,11,1,tzinfo=UTC)).day,27)
 def test_short_month_and_dst(self):
  self.assertEqual(campaigns.next_run(self.plan('monthly',day=31),dt.datetime(2027,2,1,tzinfo=UTC)).day,28)
  p={**self.plan('daily'),'time':'02:30'}
  self.assertEqual(campaigns.next_run(p,dt.datetime(2027,3,14,0,tzinfo=UTC)),dt.datetime(2027,3,14,10,30,tzinfo=UTC))
  p={**p,'time':'01:30'};first=campaigns.next_run(p,dt.datetime(2027,11,7,0,tzinfo=UTC))
  self.assertEqual(campaigns.next_run(p,first),dt.datetime(2027,11,8,9,30,tzinfo=UTC))
 def test_schedule_validation(self):
  for p in [{},self.plan('url'),{**self.plan(),'timezone':'Invalid'},self.plan('weekly',weekday=7),self.plan('monthly',day=True)]:
   with self.assertRaises(desk.DeskError):campaigns.next_run(p,dt.datetime.now(UTC))
class CampaignTest(unittest.TestCase):
 setUp=fixtures.DeskTest.setUp;tearDown=fixtures.DeskTest.tearDown;login=fixtures.DeskTest.login;call=fixtures.DeskTest.call;setup_team=fixtures.DeskTest.setup_team
 def payload(self,**changes):
  p=dict(op='createCampaign',id=str(uuid.uuid4()),name='Cyber Monday',title='Seasonal news',body='Our annual announcement',audience='all',recipientId=None,durationDays=2,schedule=dict(kind='cyber_monday',time='09:00',timezone='America/Los_Angeles'));p.update(changes);return p
 def create_campaign(self,**changes):
  self.setup_team();p=self.payload(**changes);status,r=self.call(body=p);self.assertEqual(status,200,r);return p,r['campaign']
 def due(self,c):return dt.datetime.fromisoformat(c['nextRunAt'])+dt.timedelta(seconds=5)
 def tick(self,c,clock=None):
  current=clock or self.due(c)
  with patch.object(desk,'now',return_value=campaigns.stamp(current)),patch.object(desk.ecco_desk_groups,'access',return_value={}):campaigns.process_due(self.database,current)
 def test_save_restart_retry_and_permissions(self):
  p,c=self.create_campaign();self.assertEqual(self.call(body=p)[0],200);desk.initialize(self.database,start_notifications=False)
  self.assertEqual(len(self.call(path='/api/desk?campaigns=1')[1]['campaigns']),1)
  for who in ('staff','alice','bob','anonymous'):
   self.assertIn(self.call(who,body=self.payload())[0],(401,403));self.assertIn(self.call(who,path='/api/desk?campaigns=1')[0],(401,403))
  self.assertEqual(self.call(body=self.payload(),path='/api/desk/support')[0],403)
  self.assertEqual(self.call(body={**p,'title':'different'})[0],409)
 def test_dispatch_once_and_durable_receipt(self):
  p,c=self.create_campaign();self.tick(c);self.tick(c);desk.initialize(self.database,start_notifications=False);self.tick(c)
  with desk.connect(self.database) as db:
   n=dict(db.execute('SELECT * FROM desk_notifications').fetchone());self.assertEqual(n['campaignId'],c['id']);self.assertEqual(n['audience'],'all');self.assertEqual(n['title'],p['title']);self.assertEqual(db.execute('SELECT COUNT(*) FROM desk_notifications').fetchone()[0],1)
   self.assertEqual(db.execute('SELECT COUNT(*) FROM desk_campaign_runs').fetchone()[0],1)
   self.assertEqual(db.execute('SELECT runCount FROM desk_campaigns').fetchone()[0],1)
   self.assertEqual(dt.datetime.fromisoformat(n['expiresAt'])-dt.datetime.fromisoformat(n['createdAt']),dt.timedelta(days=2))
 def test_concurrent_workers_send_once(self):
  p,c=self.create_campaign();current=self.due(c)
  with patch.object(desk.ecco_desk_groups,'access',return_value={}):
   with ThreadPoolExecutor(max_workers=2) as pool:list(pool.map(lambda _:campaigns.process_due(self.database,current),range(2)))
  with desk.connect(self.database) as db:self.assertEqual(db.execute('SELECT COUNT(*) FROM desk_notifications').fetchone()[0],1)
 def test_pause_resume_edit_and_stale_version(self):
  p,c=self.create_campaign();pause=dict(op='setCampaignActive',id=c['id'],version=1,enabled=False)
  self.assertEqual(self.call(body=pause)[0],200);self.tick(c)
  with desk.connect(self.database) as db:self.assertEqual(db.execute('SELECT COUNT(*) FROM desk_notifications').fetchone()[0],0)
  self.assertEqual(self.call(body=pause)[0],409)
  status,r=self.call(body={**p,'op':'updateCampaign','version':2,'title':'Updated'});self.assertEqual(status,200,r);self.assertFalse(r['campaign']['enabled'])
  status,r=self.call(body=dict(op='setCampaignActive',id=c['id'],version=3,enabled=True));self.assertEqual(status,200,r);self.assertTrue(r['campaign']['enabled'])
 def test_revoke_admin_blocks_then_recovers(self):
  p,c=self.create_campaign()
  with desk.connect(self.database) as db:db.execute("UPDATE desk_members SET active=0 WHERE userId='google:owner'")
  self.tick(c)
  with desk.connect(self.database) as db:
   self.assertEqual(db.execute('SELECT COUNT(*) FROM desk_notifications').fetchone()[0],0);self.assertEqual(db.execute('SELECT lastStatus FROM desk_campaigns').fetchone()[0],'blocked')
   db.execute("UPDATE desk_members SET active=1 WHERE userId='google:owner'")
  self.tick(c)
  with desk.connect(self.database) as db:self.assertEqual(db.execute('SELECT COUNT(*) FROM desk_notifications').fetchone()[0],1)
 def test_missed_date_is_skipped(self):
  p,c=self.create_campaign();self.tick(c,self.due(c)+dt.timedelta(days=1))
  with desk.connect(self.database) as db:
   self.assertEqual(db.execute('SELECT COUNT(*) FROM desk_notifications').fetchone()[0],0);self.assertEqual(db.execute('SELECT lastStatus FROM desk_campaigns').fetchone()[0],'missed')
 def test_group_creation_is_fresh_without_staff_escalation(self):
  self.setup_team()
  with patch.object(desk.ecco_desk_groups,'access',return_value={'canManageNotifications':True}) as access:
   status,r=self.call('alice',self.payload(audience='user',recipientId='google:alice'));self.assertEqual(status,200,r);self.assertTrue(access.call_args.kwargs['fresh'])
   c=r['campaign'];campaigns.process_due(self.database,self.due(c));self.assertTrue(access.call_args.kwargs['fresh'])
  with desk.connect(self.database) as db:
   self.assertEqual(db.execute('SELECT recipientId FROM desk_notifications').fetchone()[0],'google:alice');self.assertIsNone(db.execute("SELECT 1 FROM desk_members WHERE userId='google:alice'").fetchone())
if __name__=='__main__':unittest.main()
