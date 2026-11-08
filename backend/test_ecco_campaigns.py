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
 def test_legacy_year_allows_past_dates(self):
  current=dt.datetime(2026,11,8,tzinfo=UTC)
  self.assertEqual(campaigns.planned_run(self.plan('yearly',month=11,day=1,year=2026),current),dt.datetime(2027,11,1,16,tzinfo=UTC))
 def test_calendar_ranges_and_recurrence(self):
  current=dt.datetime(2026,11,8,tzinfo=UTC)
  p=self.plan('daily',startDate='2026-11-01',endDate='2026-11-30')
  self.assertEqual(campaigns.planned_run(p,current),dt.datetime(2026,11,7,17,tzinfo=UTC))
  self.assertIsNone(campaigns.planned_run({**p,'endDate':'2026-11-02'},current))
  self.assertIsNone(campaigns.planned_run({**p,'kind':'once'},current))
  self.assertEqual(campaigns.planned_run({**p,'kind':'weekly'},current),dt.datetime(2026,11,8,17,tzinfo=UTC))
  self.assertIsNone(campaigns.planned_run({**p,'kind':'yearly'},current))
  self.assertEqual(campaigns.planned_run({**p,'kind':'yearly','endDate':'2027-11-01'},current),dt.datetime(2027,11,1,16,tzinfo=UTC))
  p=self.plan('monthly',startDate='2026-01-31',endDate='2027-03-31')
  self.assertEqual(campaigns.next_run(p,dt.datetime(2027,2,1,tzinfo=UTC)),dt.datetime(2027,2,28,17,tzinfo=UTC))
  self.assertEqual(campaigns.next_run(p,dt.datetime(2027,3,1,tzinfo=UTC)),dt.datetime(2027,3,31,16,tzinfo=UTC))
  p=self.plan('yearly',startDate='2024-02-29',endDate='2028-02-29')
  self.assertEqual(campaigns.next_run(p,dt.datetime(2027,1,1,tzinfo=UTC)),dt.datetime(2027,2,28,17,tzinfo=UTC))
  self.assertEqual(campaigns.next_run(p,dt.datetime(2028,1,1,tzinfo=UTC)),dt.datetime(2028,2,29,17,tzinfo=UTC))
 def test_calendar_boundaries_validation_and_time_zone(self):
  p=self.plan('once',startDate='2026-12-31',endDate='2026-12-31');p['time']='20:00'
  self.assertEqual(campaigns.planned_run(p,dt.datetime(2027,1,1,2,tzinfo=UTC)),dt.datetime(2027,1,1,4,tzinfo=UTC))
  self.assertEqual(campaigns.planned_run(p,dt.datetime(2027,1,1,4,tzinfo=UTC)),dt.datetime(2027,1,1,4,tzinfo=UTC))
  self.assertIsNone(campaigns.planned_run(p,dt.datetime(2027,1,2,4,tzinfo=UTC)))
  future=self.plan('daily',startDate='2035-05-06',endDate='2035-05-06')
  self.assertEqual(campaigns.planned_run(future,dt.datetime(2026,1,1,tzinfo=UTC)),dt.datetime(2035,5,6,16,tzinfo=UTC))
  for change in [{'endDate':'2026-12-30'},{'startDate':'2026-02-30'},{'startDate':'2026-1-1'},{'endDate':''},{'endDate':None},{'startDate':True}]:
   with self.assertRaises(desk.DeskError):campaigns.schedule({**p,**change})
  p=self.plan('daily',startDate='2027-03-14',endDate='2027-03-14');p['time']='02:30'
  run=campaigns.next_run(p,dt.datetime(2027,3,14,tzinfo=UTC));self.assertEqual(run,dt.datetime(2027,3,14,10,30,tzinfo=UTC));self.assertIsNone(campaigns.next_run(p,run))
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
 def test_presentation_survives_schedule_dispatch_and_edit(self):
  p,c=self.create_campaign(placements=['billing'],badge='Dhamaka');self.tick(c)
  with desk.connect(self.database) as db:
   n=desk.notification_public(db.execute('SELECT * FROM desk_notifications').fetchone());self.assertEqual(n['kind'],'marketing_campaign');self.assertEqual(n['placements'],['billing']);self.assertEqual(n['badge'],'Dhamaka')
  status,r=self.call(body={**p,'op':'updateCampaign','version':1,'placements':['bell'],'badge':'NEW'});self.assertEqual(status,200,r);self.assertEqual(r['campaign']['placements'],['bell']);self.assertEqual(r['campaign']['badge'],'NEW')
 def test_calendar_past_range_saves_edits_restarts_and_never_sends(self):
  past=dict(kind='daily',time='09:00',timezone='America/Los_Angeles',startDate='2020-01-01',endDate='2020-01-31')
  p,c=self.create_campaign(schedule=past)
  self.assertEqual(c['schedule'],past);self.assertIsNone(c['nextRunAt']);self.assertEqual(self.call(body=p)[0],200)
  desk.initialize(self.database,start_notifications=False);self.tick(c,dt.datetime.now(UTC))
  saved=self.call(path='/api/desk?campaigns=1')[1];self.assertEqual(saved['campaignCalendarVersion'],1);self.assertIsNone(saved['campaigns'][0]['nextRunAt'])
  with desk.connect(self.database) as db:self.assertEqual(db.execute('SELECT COUNT(*) FROM desk_notifications').fetchone()[0],0)
  status,r=self.call(body={**p,'op':'updateCampaign','version':1,'schedule':{**past,'endDate':'2019-12-01'}});self.assertEqual(status,400,r)
  self.assertEqual(self.call(path='/api/desk?campaigns=1')[1]['campaigns'][0]['version'],1)
  future=dt.datetime.now(UTC).year+2
  new={**past,'startDate':f'{future}-01-01','endDate':f'{future}-01-02'}
  status,r=self.call(body={**p,'op':'updateCampaign','version':1,'schedule':new});self.assertEqual(status,200,r);self.assertEqual(r['campaign']['schedule'],new);self.assertIsNotNone(r['campaign']['nextRunAt'])
 def test_calendar_end_inclusive_dispatch_stops_and_resume_does_not_replay(self):
  future=dt.datetime.now(UTC).year+2
  plan=dict(kind='daily',time='09:00',timezone='America/Los_Angeles',startDate=f'{future}-01-01',endDate=f'{future}-01-02')
  p,c=self.create_campaign(schedule=plan);self.tick(c)
  c=self.call(path='/api/desk?campaigns=1')[1]['campaigns'][0];self.tick(c);last=self.due(c)
  saved=self.call(path='/api/desk?campaigns=1')[1]['campaigns'][0];self.assertIsNone(saved['nextRunAt']);self.assertEqual(saved['runCount'],2)
  self.tick(saved,last+dt.timedelta(days=1))
  with desk.connect(self.database) as db:
   self.assertEqual(db.execute('SELECT COUNT(*) FROM desk_notifications').fetchone()[0],2)
   me=desk.actor(db,dict(db.execute("SELECT * FROM desk_users WHERE id='google:owner'").fetchone()))
   result=campaigns.write(db,me,dict(op='setCampaignActive',id=c['id'],version=1,enabled=True),last+dt.timedelta(days=1));self.assertIsNone(result['campaign']['nextRunAt'])
 def test_preview_past_range_is_successful_and_save_is_idempotent(self):
  self.setup_team();plan=dict(kind='monthly',time='09:00',timezone='UTC',startDate='2020-01-31',endDate='2020-03-31')
  status,r=self.call(body=dict(op='previewCampaign',schedule=plan));self.assertEqual(status,200,r);self.assertIsNone(r['nextRunAt']);self.assertEqual(r['campaignCalendarVersion'],1)
 def test_late_today_publishes_to_billing_once_for_30_days_and_repeats_next_year(self):
  self.setup_team();current=dt.datetime(2026,11,8,1,30,tzinfo=UTC)
  plan=dict(kind='yearly',time='09:00',timezone='America/Los_Angeles',startDate='2026-11-07',endDate='2028-03-31')
  payload=self.payload(schedule=plan,durationDays=30,placements=['billing'],badge='Thanks Giving Offer!')
  with desk.connect(self.database) as db:
   me=desk.actor(db,dict(db.execute("SELECT * FROM desk_users WHERE id='google:owner'").fetchone()))
   preview=campaigns.write(db,me,dict(op='previewCampaign',id=payload['id'],schedule=plan),current)
   c=campaigns.write(db,me,payload,current)['campaign'];self.assertEqual(preview['nextRunAt'],c['nextRunAt']);self.assertEqual(c['nextRunAt'],'2026-11-07T17:00:00.000000+00:00')
   self.assertEqual(campaigns.write(db,me,payload,current)['campaign']['version'],1)
  self.tick(c,current);self.tick(c,current)
  with desk.connect(self.database) as db:
   n=dict(db.execute('SELECT * FROM desk_notifications WHERE campaignId=?',(c['id'],)).fetchone());self.assertEqual(db.execute('SELECT COUNT(*) FROM desk_notifications').fetchone()[0],1)
   self.assertEqual(dt.datetime.fromisoformat(n['expiresAt'])-dt.datetime.fromisoformat(n['createdAt']),dt.timedelta(days=30))
   c=campaigns.public(db.execute('SELECT * FROM desk_campaigns WHERE id=?',(c['id'],)).fetchone());self.assertEqual(c['runCount'],1);self.assertEqual(c['nextRunAt'],'2027-11-07T17:00:00.000000+00:00')
   edited=campaigns.write(db,me,{**payload,'op':'updateCampaign','version':1,'schedule':{**plan,'time':'20:00'}},current)['campaign'];self.assertEqual(edited['nextRunAt'],'2027-11-08T04:00:00.000000+00:00')
   resumed=campaigns.write(db,me,dict(op='setCampaignActive',id=c['id'],version=2,enabled=True),current)['campaign'];self.assertEqual(resumed['nextRunAt'],edited['nextRunAt'])
   preview=campaigns.write(db,me,dict(op='previewCampaign',id=c['id'],schedule=plan),current);self.assertEqual(preview['nextRunAt'],c['nextRunAt'])
  with patch.object(desk,'now',return_value=campaigns.stamp(current)):
   status,feed=self.call('alice',path='/api/desk/support?userNotifications=1');self.assertEqual(status,200,feed);self.assertEqual(feed['billingNotifications'][0]['id'],n['id']);self.assertEqual(feed['billingNotifications'][0]['badge'],'Thanks Giving Offer!');self.assertEqual(feed['notifications'],[])
  self.tick(c,current);self.assertEqual(self.call(path='/api/desk?campaigns=1')[1]['campaigns'][0]['runCount'],1)
 def test_saving_existing_skipped_today_campaign_and_future_time(self):
  self.setup_team();current=dt.datetime(2026,11,8,1,30,tzinfo=UTC);plan=dict(kind='yearly',time='09:00',timezone='America/Los_Angeles',startDate='2026-11-07',endDate='2028-03-31');payload=self.payload(schedule=plan)
  with desk.connect(self.database) as db:
   me=desk.actor(db,dict(db.execute("SELECT * FROM desk_users WHERE id='google:owner'").fetchone()))
   with patch.object(campaigns,'planned_run',side_effect=lambda p,c,*args:campaigns.next_run(p,c)):old=campaigns.write(db,me,payload,current)['campaign']
   self.assertEqual(old['nextRunAt'],'2027-11-07T17:00:00.000000+00:00')
   fixed=campaigns.write(db,me,{**payload,'op':'updateCampaign','version':1},current)['campaign'];self.assertEqual(fixed['nextRunAt'],'2026-11-07T17:00:00.000000+00:00')
  self.assertEqual(campaigns.planned_run({**plan,'time':'20:00'},current),dt.datetime(2026,11,8,4,tzinfo=UTC))
  self.assertEqual(campaigns.planned_run(plan,current+dt.timedelta(days=1)),dt.datetime(2027,11,7,17,tzinfo=UTC))
 def test_upcoming_default_legacy_lead_time_and_validation(self):
  import json
  p,c=self.create_campaign();starts=dt.datetime.fromisoformat(c['nextRunAt']);self.assertEqual(c['upcomingDays'],7)
  with desk.connect(self.database) as db:
   me={'userId':'google:alice'}
   self.assertEqual(campaigns.upcoming(db,me,starts-dt.timedelta(days=7,seconds=1)),[])
   preview=campaigns.upcoming(db,me,starts-dt.timedelta(days=7))[0]
   self.assertEqual(preview['title'],p['title']);self.assertEqual(preview['status'],'upcoming')
   self.assertEqual(dt.datetime.fromisoformat(preview['expiresAt'])-starts,dt.timedelta(days=2))
   config=json.loads(db.execute('SELECT config FROM desk_campaigns WHERE id=?',(c['id'],)).fetchone()[0]);config.pop('upcomingDays');db.execute('UPDATE desk_campaigns SET config=? WHERE id=?',(json.dumps(config),c['id']))
   self.assertEqual(len(campaigns.upcoming(db,me,starts-dt.timedelta(days=6))),1)
   self.assertEqual(db.execute('SELECT COUNT(*) FROM desk_notifications').fetchone()[0],0)
   self.assertEqual(db.execute('SELECT COUNT(*) FROM desk_campaign_runs').fetchone()[0],0)
  self.assertEqual(self.call(body=p)[0],200) # legacy retry remains idempotent
  for lead in [-1,91,True,'7',1.5,None]:
   self.assertEqual(self.call(body=self.payload(upcomingDays=lead))[0],400)
  for lead in [0,14,30,90]:
   status,data=self.call(body=self.payload(upcomingDays=lead));self.assertEqual(status,200,data);self.assertEqual(data['campaign']['upcomingDays'],lead)
 def test_upcoming_target_placement_pause_and_window(self):
  self.call('alice',path='/api/desk/support')
  p,c=self.create_campaign(audience='user',recipientId='google:alice',placements=['billing'],upcomingDays=30)
  starts=dt.datetime.fromisoformat(c['nextRunAt']);clock=starts-dt.timedelta(days=20)
  with patch.object(desk,'now',return_value=campaigns.stamp(clock)):
   status,data=self.call('alice',path='/api/desk/support?userNotifications=1');self.assertEqual(status,200,data);self.assertEqual(data['upcomingCampaignVersion'],1);self.assertEqual(len(data['upcomingCampaigns']),1);self.assertEqual(data['notifications'],[]);self.assertEqual(data['billingNotifications'],[])
   self.assertEqual(self.call('bob',path='/api/desk/support?userNotifications=1')[1]['upcomingCampaigns'],[])
  status,paused=self.call(body=dict(op='setCampaignActive',id=c['id'],version=1,enabled=False));self.assertEqual(status,200)
  with desk.connect(self.database) as db:self.assertEqual(campaigns.upcoming(db,{'userId':'google:alice'},clock),[])
  self.call(body={**p,'op':'updateCampaign','version':2,'placements':['bell']});self.call(body=dict(op='setCampaignActive',id=c['id'],version=3,enabled=True))
  with desk.connect(self.database) as db:self.assertEqual(campaigns.upcoming(db,{'userId':'google:alice'},clock),[])
  self.call(body={**p,'op':'updateCampaign','version':4,'upcomingDays':0})
  with desk.connect(self.database) as db:self.assertEqual(campaigns.upcoming(db,{'userId':'google:alice'},clock),[])
 def test_upcoming_becomes_active_only_after_dispatch_and_not_after_expiry(self):
  p,c=self.create_campaign(placements=['billing'],badge='Dhamaka',durationDays=30);starts=dt.datetime.fromisoformat(c['nextRunAt']);clock=starts-dt.timedelta(hours=1)
  with desk.connect(self.database) as db:
   me={'userId':'google:alice'};self.assertEqual(len(campaigns.upcoming(db,me,clock)),1)
   self.assertEqual(len(campaigns.upcoming(db,me,starts)),1) # waiting for the worker, never a purchase
   self.assertEqual(campaigns.upcoming(db,me,starts+dt.timedelta(days=1)),[])
  self.tick(c)
  with patch.object(desk,'now',return_value=campaigns.stamp(self.due(c))):
   data=self.call('alice',path='/api/desk/support?userNotifications=1')[1];self.assertEqual(data['upcomingCampaigns'],[]);self.assertEqual(len(data['billingNotifications']),1);self.assertEqual(data['billingNotifications'][0]['badge'],'Dhamaka')
  with patch.object(desk,'now',return_value=campaigns.stamp(starts+dt.timedelta(days=31))):
   data=self.call('alice',path='/api/desk/support?userNotifications=1')[1];self.assertEqual(data['upcomingCampaigns'],[]);self.assertEqual(data['billingNotifications'],[])
 def test_upcoming_bounded_sorted_and_blocked_or_completed_hidden(self):
  self.setup_team();clock=dt.datetime(2026,11,1,tzinfo=UTC)
  with desk.connect(self.database) as db:
   admin=desk.actor(db,dict(db.execute("SELECT * FROM desk_users WHERE id='google:owner'").fetchone()));me={'userId':'google:alice'}
   for day in range(7,1,-1):
    plan=dict(kind='once',time='09:00',timezone='UTC',startDate=f'2026-11-{day:02}',endDate=f'2026-11-{day:02}')
    campaigns.write(db,admin,self.payload(schedule=plan),clock)
   rows=campaigns.upcoming(db,me,clock);self.assertEqual(len(rows),5);self.assertEqual([r['startsAt'][8:10] for r in rows],['02','03','04','05','06'])
   db.execute("UPDATE desk_campaigns SET lastError='Access blocked' WHERE id=?",(rows[0]['campaignId'],));db.execute("UPDATE desk_campaigns SET nextRunAt='' WHERE id=?",(rows[1]['campaignId'],))
   self.assertEqual(len(campaigns.upcoming(db,me,clock)),4)
if __name__=='__main__':unittest.main()
