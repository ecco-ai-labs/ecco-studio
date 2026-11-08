"""Durable recurring campaigns; no browser session is needed at dispatch time."""
import calendar
import datetime as dt
import json
import logging
import re
import threading
import uuid
from zoneinfo import ZoneInfo

UTC=dt.timezone.utc
ZONES=('America/Los_Angeles','America/New_York','Asia/Kolkata','UTC')
KINDS=('once','cyber_monday','black_friday','new_year','daily','weekly','monthly','yearly')
_workers=set()
_lock=threading.Lock()

def stamp(value):return value.astimezone(UTC).isoformat(timespec='microseconds') if value else ''

def schedule(raw):
    from ecco_desk import DeskError
    if not isinstance(raw,dict) or set(raw)-{'kind','time','timezone','weekday','day','month','year','startDate','endDate'}:
        raise DeskError('Choose a valid campaign schedule.')
    kind=raw.get('kind');zone=raw.get('timezone');time=raw.get('time')
    if kind not in KINDS or zone not in ZONES or not isinstance(time,str) or not re.fullmatch(r'(?:[01][0-9]|2[0-3]):[0-5][0-9]',time):
        raise DeskError('Choose a valid schedule, time and time zone.')
    result=dict(kind=kind,time=time,timezone=zone)
    if 'startDate' in raw or 'endDate' in raw:
        dates={}
        for key,label in [('startDate','Start'),('endDate','End')]:
            value=raw.get(key)
            try:
                if not isinstance(value,str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}',value):raise ValueError()
                dates[key]=dt.date.fromisoformat(value)
            except (ValueError,TypeError):raise DeskError('Choose a valid '+label+' date.')
        if dates['endDate']<dates['startDate']:raise DeskError('End must be on or after Start.')
        result.update({key:value.isoformat() for key,value in dates.items()})
        start=dates['startDate']
        if kind=='weekly':result['weekday']=start.weekday()
        if kind in ('monthly','yearly'):result['day']=start.day
        if kind=='yearly':result['month']=start.month
        return result
    if kind=='once':raise DeskError('Choose Start and End dates.')
    for key,minimum,maximum,needed in [('weekday',0,6,kind=='weekly'),('day',1,31,kind in ('monthly','yearly')),('month',1,12,kind=='yearly')]:
        if needed:
            value=raw.get(key)
            if type(value) is not int or not minimum<=value<=maximum:raise DeskError('Choose a valid '+key+'.')
            result[key]=value
    if 'year' in raw:
        year=raw['year']
        if type(year) is not int or not 2000<=year<=2100:raise DeskError('Choose a valid campaign year (2000–2100).')
        result['year']=year
    return result

def next_run(plan,after):
    """One occurrence per local date. DST gaps shift forward; folds run only once."""
    plan=schedule(plan);zone=ZoneInfo(plan['timezone']);local=after.astimezone(zone)
    hour,minute=map(int,plan['time'].split(':'));kind=plan['kind']
    start=dt.date.fromisoformat(plan['startDate']) if 'startDate' in plan else dt.date(plan.get('year',local.year),1,1)
    end=dt.date.fromisoformat(plan['endDate']) if 'endDate' in plan else dt.date.max
    first_day=max(local.date(),start)
    if first_day>end:return None
    for offset in range(740):
        if offset>(end-first_day).days:break
        day=first_day+dt.timedelta(days=offset)
        thanksgiving=dt.date(day.year,11,1)
        thanksgiving+=dt.timedelta(days=(3-thanksgiving.weekday())%7+21)
        match=(kind=='once' and day==start or kind=='daily' or kind=='weekly' and day.weekday()==plan['weekday'] or
               kind=='monthly' and day.day==min(plan['day'],calendar.monthrange(day.year,day.month)[1]) or
               kind=='yearly' and day.month==plan['month'] and day.day==min(plan['day'],calendar.monthrange(day.year,day.month)[1]) or
               kind=='cyber_monday' and day==thanksgiving+dt.timedelta(days=4) or
               kind=='black_friday' and day==thanksgiving+dt.timedelta(days=1) or
               kind=='new_year' and (day.month,day.day)==(1,1))
        if match:
            candidate=dt.datetime.combine(day,dt.time(hour,minute),zone).astimezone(UTC)
            if candidate>after.astimezone(UTC):return candidate
    return None

def planned_run(raw,current,db=None,cid=None):
    """Include today's unsent occurrence when saving, even after its send time."""
    plan=schedule(raw);zone=ZoneInfo(plan['timezone']);today=current.astimezone(zone).date()
    day_start=dt.datetime.combine(today,dt.time(),zone).astimezone(UTC)
    day_end=dt.datetime.combine(today+dt.timedelta(days=1),dt.time(),zone).astimezone(UTC)
    if db is not None and cid and db.execute(
            'SELECT 1 FROM desk_campaign_runs WHERE campaignId=? AND scheduledAt>=? AND scheduledAt<? LIMIT 1',
            (cid,stamp(day_start),stamp(day_end))).fetchone():
        return next_run(plan,day_end-dt.timedelta(microseconds=1))
    return next_run(plan,day_start-dt.timedelta(microseconds=1))

def initialize(db):
    db.executescript('''
    CREATE TABLE IF NOT EXISTS desk_campaigns (
      id TEXT PRIMARY KEY, config TEXT NOT NULL, createdBy TEXT NOT NULL REFERENCES desk_users(id),
      enabled INTEGER NOT NULL, version INTEGER NOT NULL DEFAULT 1,
      createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL, nextRunAt TEXT NOT NULL,
      lastRunAt TEXT, lastStatus TEXT, lastError TEXT, runCount INTEGER NOT NULL DEFAULT 0);
    CREATE INDEX IF NOT EXISTS desk_campaign_due ON desk_campaigns(enabled,nextRunAt);
    CREATE TABLE IF NOT EXISTS desk_campaign_runs (
      campaignId TEXT NOT NULL REFERENCES desk_campaigns(id), scheduledAt TEXT NOT NULL,
      status TEXT NOT NULL, notificationId TEXT, completedAt TEXT NOT NULL,
      PRIMARY KEY(campaignId,scheduledAt));
    ''')
    if 'campaignId' not in {r['name'] for r in db.execute('PRAGMA table_info(desk_notifications)')}:
        db.execute('ALTER TABLE desk_notifications ADD COLUMN campaignId TEXT')

def public(row):
    result=dict(row);result.update(json.loads(result.pop('config')));result.pop('createdBy',None)
    result['nextRunAt']=result['nextRunAt'] or None;result['enabled']=bool(result['enabled']);result.setdefault('placements',['bell','billing']);result.setdefault('badge','NEW');result.setdefault('upcomingDays',7);return result

def listing(db,me):
    from ecco_desk import require_notification_admin
    require_notification_admin(me)
    return {'campaignVersion':1,'campaignYearVersion':1,'campaignCalendarVersion':1,'upcomingCampaignVersion':1,'notificationPresentationVersion':1,'campaigns':[public(r) for r in db.execute('SELECT * FROM desk_campaigns ORDER BY createdAt DESC')]}

def upcoming(db,me,current=None):
    """Recipient-scoped Billing previews; never create unread notices or receipts."""
    current=current or dt.datetime.now(UTC);items=[]
    for row in db.execute("SELECT * FROM desk_campaigns WHERE enabled=1 AND nextRunAt!='' ORDER BY nextRunAt,id"):
        config=json.loads(row['config']);lead=config.get('upcomingDays',7)
        if not lead or row['lastError'] or 'billing' not in config.get('placements',['bell','billing']):continue
        if config['audience']!='all' and config.get('recipientId')!=me['userId']:continue
        starts=dt.datetime.fromisoformat(row['nextRunAt']);zone=ZoneInfo(config['schedule']['timezone'])
        # Keep today's due preview while the worker dispatches. Never replay old dates.
        if starts-current>dt.timedelta(days=lead) or starts.astimezone(zone).date()<current.astimezone(zone).date():continue
        if db.execute('SELECT 1 FROM desk_campaign_runs WHERE campaignId=? AND scheduledAt=?',(row['id'],row['nextRunAt'])).fetchone():continue
        expires=starts+dt.timedelta(days=config['durationDays'])
        if expires<=current:continue
        items.append(dict(id='upcoming:'+row['id']+':'+row['nextRunAt'],campaignId=row['id'],kind='marketing_campaign',
            status='upcoming',title=config['title'],body=config['body'],severity='informational',badge=config.get('badge','NEW'),
            startsAt=stamp(starts),expiresAt=stamp(expires),timezone=config['schedule']['timezone']))
        if len(items)==5:break
    return items

def validated(db,body):
    from ecco_desk import text,choice,DeskError,notification_presentation
    result={key:text(body,key,maximum) for key,maximum in [('name',80),('title',160),('body',4000)]}
    result['audience']=choice(body,'audience',('all','user'))
    result['recipientId']=text(body,'recipientId',256) if result['audience']=='user' else None
    if result['recipientId'] and not db.execute('SELECT 1 FROM desk_users WHERE id=?',(result['recipientId'],)).fetchone():
        raise DeskError('Choose a verified Studio user.')
    days=body.get('durationDays')
    if type(days) is not int or not 1<=days<=365:raise DeskError('Notification duration must be 1 to 365 days.')
    result['durationDays']=days;result['schedule']=schedule(body.get('schedule'))
    lead=body.get('upcomingDays',7)
    if type(lead) is not int or not 0<=lead<=90:raise DeskError('Upcoming notice must be 0 to 90 days before the campaign.')
    result['upcomingDays']=lead
    mask,result['badge']=notification_presentation(body,('bell','billing'))
    result['placements']=[p for p,bit in (('bell',1),('billing',2)) if mask & bit]
    return result

def write(db,me,body,current=None):
    from ecco_desk import require_notification_admin,text,DeskError,event
    require_notification_admin(me);current=current or dt.datetime.now(UTC);op=body.get('op')
    if op=='previewCampaign':return {'campaignVersion':1,'campaignYearVersion':1,'campaignCalendarVersion':1,'upcomingCampaignVersion':1,'notificationPresentationVersion':1,'nextRunAt':stamp(planned_run(body.get('schedule'),current,db,body.get('id'))) or None}
    cid=str(uuid.UUID(text(body,'id',36)));old=db.execute('SELECT * FROM desk_campaigns WHERE id=?',(cid,)).fetchone()
    if op in ('updateCampaign','setCampaignActive'):
        if not old:raise DeskError('Campaign not found.',404)
        if body.get('version')!=old['version']:raise DeskError('This campaign changed. Refresh before saving.',409)
    if op=='setCampaignActive':
        if type(body.get('enabled')) is not bool:raise DeskError('Choose Active or Paused.')
        enabled=body['enabled'];plan=json.loads(old['config'])['schedule']
        db.execute('UPDATE desk_campaigns SET enabled=?,version=version+1,createdBy=?,updatedAt=?,nextRunAt=?,lastError=NULL WHERE id=?',
                   (int(enabled),me['userId'],stamp(current),stamp(planned_run(plan,current,db,cid)),cid))
        event(db,me,('Campaign resumed: ' if enabled else 'Campaign paused: ')+cid)
    elif op in ('createCampaign','updateCampaign'):
        config=validated(db,body);encoded=json.dumps(config,sort_keys=True,separators=(',',':'))
        if op=='createCampaign' and old:
            old_config=json.loads(old['config']);old_config.setdefault('placements',['bell','billing']);old_config.setdefault('badge','NEW');old_config.setdefault('upcomingDays',7)
            if old_config!=config or old['createdBy']!=me['userId']:raise DeskError('This campaign request was already saved. Refresh before changing it.',409)
        elif op=='createCampaign':
            if db.execute('SELECT COUNT(*) FROM desk_campaigns').fetchone()[0]>=100:raise DeskError('The workspace has reached 100 campaigns.',409)
            db.execute('INSERT INTO desk_campaigns(id,config,createdBy,enabled,createdAt,updatedAt,nextRunAt) VALUES(?,?,?,1,?,?,?)',
                       (cid,encoded,me['userId'],stamp(current),stamp(current),stamp(planned_run(config['schedule'],current,db,cid))))
            event(db,me,'Campaign scheduled: '+cid)
        else:
            db.execute('UPDATE desk_campaigns SET config=?,createdBy=?,version=version+1,updatedAt=?,nextRunAt=?,lastError=NULL WHERE id=?',
                       (encoded,me['userId'],stamp(current),stamp(planned_run(config['schedule'],current,db,cid)),cid))
            event(db,me,'Campaign updated: '+cid)
    else:raise DeskError('Unknown campaign action.')
    return {'campaignVersion':1,'campaignYearVersion':1,'campaignCalendarVersion':1,'upcomingCampaignVersion':1,'notificationPresentationVersion':1,'campaign':public(db.execute('SELECT * FROM desk_campaigns WHERE id=?',(cid,)).fetchone())}

def process_due(database,current=None):
    import ecco_desk as desk
    current=current or dt.datetime.now(UTC);instant=stamp(current)
    with desk.connect(database) as db:
        due=[dict(r) for r in db.execute("SELECT * FROM desk_campaigns WHERE enabled=1 AND nextRunAt!='' AND nextRunAt<=? ORDER BY nextRunAt LIMIT 25",(instant,))]
    for pending in due:
        config=json.loads(pending['config']);scheduled=dt.datetime.fromisoformat(pending['nextRunAt']);zone=ZoneInfo(config['schedule']['timezone'])
        missed=scheduled.astimezone(zone).date()!=current.astimezone(zone).date()
        with desk.connect(database) as db:
            user=db.execute('SELECT * FROM desk_users WHERE id=?',(pending['createdBy'],)).fetchone()
        grants=desk.ecco_desk_groups.access(dict(user),fresh=True) if user and not missed else {}
        with desk.connect(database) as db:
            db.execute('BEGIN IMMEDIATE')
            row=db.execute('SELECT * FROM desk_campaigns WHERE id=?',(pending['id'],)).fetchone()
            if not row or not row['enabled'] or row['version']!=pending['version'] or row['nextRunAt']!=pending['nextRunAt']:continue
            me={**desk.actor(db,dict(user)),**grants} if user else None
            if not missed and (not me or me['role']!='admin' and me.get('canManageNotifications') is not True):
                db.execute("UPDATE desk_campaigns SET lastStatus='blocked',lastError=? WHERE id=?",('Administrator access could not be verified.',row['id']))
                continue
            existing=db.execute('SELECT 1 FROM desk_campaign_runs WHERE campaignId=? AND scheduledAt=?',(row['id'],row['nextRunAt'])).fetchone()
            notification_id=None
            if not existing:
                if not missed:
                    receipt=desk.write_notification(db,me,dict(op='createNotification',requestId=uuid.uuid5(uuid.UUID(row['id']),row['nextRunAt']).hex,
                        title=config['title'],body=config['body'],kind='notification',severity='informational',audience=config['audience'],
                        recipientId=config['recipientId'],durationDays=config['durationDays'],placements=config.get('placements',['bell','billing']),badge=config.get('badge','NEW')))
                    notification_id=receipt['id']
                    db.execute('UPDATE desk_notifications SET campaignId=? WHERE id=?',(row['id'],notification_id))
                db.execute('INSERT INTO desk_campaign_runs VALUES(?,?,?,?,?)',(row['id'],row['nextRunAt'],'missed' if missed else 'sent',notification_id,instant))
            db.execute('UPDATE desk_campaigns SET nextRunAt=?,lastRunAt=?,lastStatus=?,lastError=NULL,runCount=runCount+? WHERE id=?',
                       (stamp(next_run(config['schedule'],current)),instant,'missed' if missed else 'sent',int(not missed and not existing),row['id']))

def start(database):
    key=str(database)
    with _lock:
        if key in _workers:return
        _workers.add(key)
    def loop():
        while True:
            try:process_due(database)
            except Exception as exc:logging.getLogger('ecco.campaigns').error('Campaign tick failed: %s',type(exc).__name__)
            threading.Event().wait(30)
    threading.Thread(target=loop,name='ecco-campaigns',daemon=True).start()
