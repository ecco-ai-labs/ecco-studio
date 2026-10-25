"""Ticket-bound live chat: Pacific hours, durable FIFO queue, leased agent presence."""
import datetime as dt
import time
import uuid
from zoneinfo import ZoneInfo

PACIFIC = ZoneInfo('America/Los_Angeles')
HOURS = '7 AM–11:59 PM Pacific time, daily'
AGENT_TTL = 75
CUSTOMER_TTL = 150


def initialize(db):
    db.executescript('''
    CREATE TABLE IF NOT EXISTS desk_chat_presence (
        userId TEXT PRIMARY KEY REFERENCES desk_users(id), available INTEGER NOT NULL,
        seenAt REAL NOT NULL);
    CREATE TABLE IF NOT EXISTS desk_chat_sessions (
        ticketId INTEGER PRIMARY KEY REFERENCES desk_tickets(id), state TEXT NOT NULL,
        requestedAt REAL NOT NULL, customerSeen REAL NOT NULL, agentId TEXT,
        connectedAt REAL, endedAt REAL, reason TEXT);
    CREATE TABLE IF NOT EXISTS desk_comment_sources (
        commentId TEXT PRIMARY KEY REFERENCES desk_comments(id), channel TEXT NOT NULL,
        externalId TEXT UNIQUE);
    CREATE TABLE IF NOT EXISTS desk_chat_alerts (
        id TEXT PRIMARY KEY,ticketId INTEGER NOT NULL REFERENCES desk_tickets(id),requestedAt REAL NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,availableAt REAL NOT NULL DEFAULT 0,
        leaseUntil REAL NOT NULL DEFAULT 0,state TEXT NOT NULL DEFAULT 'pending',lastError TEXT);
    ''')


def is_open(stamp=None):
    local = dt.datetime.fromtimestamp(time.time() if stamp is None else stamp, PACIFIC)
    return 7 <= local.hour < 24


def _event(db, tid, detail):
    import ecco_desk as desk
    desk.event(db, {'userId':'system:desk-chat', 'name':'Ecco Desk'}, detail, tid, 'public')


def _end(db, row, reason, stamp):
    db.execute("UPDATE desk_chat_sessions SET state='ended',endedAt=?,reason=? WHERE ticketId=?",
               (stamp, reason, row['ticketId']))
    _event(db, row['ticketId'], reason + ' Continue through ticket replies.')


def maintain(db, stamp=None):
    stamp = time.time() if stamp is None else stamp
    for r in db.execute("SELECT * FROM desk_chat_sessions WHERE state IN ('queued','live')").fetchall():
        if not is_open(stamp):
            _end(db, r, 'Live chat closed for the day', stamp)
        elif stamp-r['customerSeen'] > CUSTOMER_TTL:
            _end(db, r, 'Live chat ended because the customer disconnected', stamp)
        elif r['state'] == 'live':
            active = db.execute('''SELECT 1 FROM desk_chat_presence p JOIN desk_members m ON m.userId=p.userId
                WHERE p.userId=? AND m.active=1 AND p.seenAt>?''', (r['agentId'], stamp-AGENT_TTL)).fetchone()
            if not active:
                db.execute("UPDATE desk_chat_sessions SET state='queued',agentId=NULL,connectedAt=NULL,reason=NULL WHERE ticketId=?", (r['ticketId'],))
                _event(db, r['ticketId'], 'Support agent disconnected; returned to the chat queue')


def support_status(db, me):
    import ecco_desk as desk
    stamp = time.time()
    maintain(db, stamp)
    available = db.execute('''SELECT count(*) FROM desk_chat_presence p JOIN desk_members m ON m.userId=p.userId
        WHERE m.active=1 AND p.available=1 AND p.seenAt>? AND NOT EXISTS
        (SELECT 1 FROM desk_chat_sessions c WHERE c.agentId=p.userId AND c.state='live')''', (stamp-AGENT_TTL,)).fetchone()[0]
    result = dict(open=is_open(stamp), hours=HOURS, availableAgents=available if is_open(stamp) else 0)
    if desk.staff(me):
        p = db.execute('SELECT * FROM desk_chat_presence WHERE userId=?', (me['userId'],)).fetchone()
        result['available'] = bool(p and p['available'] and p['seenAt']>stamp-AGENT_TTL)
        result['queue'] = [dict(r) for r in db.execute('''SELECT c.ticketId,c.state,c.requestedAt,t.title,t.reporterName,
            c.agentId FROM desk_chat_sessions c JOIN desk_tickets t ON t.id=c.ticketId
            WHERE c.state IN ('queued','live') ORDER BY c.requestedAt,c.ticketId''')]
    return result


def detail(db, me, ticket):
    stamp = time.time()
    maintain(db, stamp)
    # Only an authenticated customer viewing their own open conversation renews its lease.
    if me['userId'] == ticket['reporterId']:
        db.execute("UPDATE desk_chat_sessions SET customerSeen=? WHERE ticketId=? AND state IN ('queued','live')",
                   (stamp, ticket['id']))
    maintain(db, stamp)
    row = db.execute('SELECT * FROM desk_chat_sessions WHERE ticketId=?', (ticket['id'],)).fetchone()
    result = dict(state='idle', open=is_open(stamp), hours=HOURS, position=None, agentName=None,
                  assignedToMe=False, reason=None)
    if row:
        result.update(state=row['state'], reason=row['reason'])
        result['assignedToMe'] = row['agentId'] == me['userId']
        if row['state'] == 'queued':
            result['position'] = db.execute("SELECT count(*) FROM desk_chat_sessions WHERE state='queued' AND (requestedAt<? OR (requestedAt=? AND ticketId<=?))",
                (row['requestedAt'], row['requestedAt'], row['ticketId'])).fetchone()[0]
        if row['agentId']:
            agent = db.execute('SELECT name FROM desk_users WHERE id=?', (row['agentId'],)).fetchone()
            result['agentName'] = agent['name'] if agent else 'Support'
    return result


def write(db, me, body):
    import ecco_desk as desk
    op = body.get('op')
    stamp = time.time()
    maintain(db, stamp)
    if op == 'chatPresence':
        desk.require_staff(me)
        available = body.get('available')
        if type(available) is not bool:
            raise desk.DeskError('Choose available or unavailable.')
        db.execute('INSERT INTO desk_chat_presence VALUES (?,?,?) ON CONFLICT(userId) DO UPDATE SET available=excluded.available,seenAt=excluded.seenAt',
                   (me['userId'], int(available), stamp))
        return support_status(db, me)
    t = desk.ticket(db, me, body.get('id'))
    if t['type'] != 'support':
        raise desk.DeskError('Live chat is available for customer support tickets only.')
    r = db.execute('SELECT * FROM desk_chat_sessions WHERE ticketId=?', (t['id'],)).fetchone()
    if op == 'chatRequest':
        if me['userId'] != t['reporterId']:
            raise desk.DeskError('Only the requester can join the chat queue.', 403)
        if not is_open(stamp):
            raise desk.DeskError('Live chat is open ' + HOURS + '. You can still send a ticket reply.', 409)
        if not r or r['state'] == 'ended':
            if db.execute('''SELECT 1 FROM desk_chat_sessions c JOIN desk_tickets t ON t.id=c.ticketId
                WHERE t.reporterId=? AND c.state IN ('queued','live') AND c.ticketId<>?''', (me['userId'], t['id'])).fetchone():
                raise desk.DeskError('You already have a queued or live chat. Open that ticket to continue.', 409)
            db.execute("INSERT INTO desk_chat_sessions(ticketId,state,requestedAt,customerSeen) VALUES (?,'queued',?,?) ON CONFLICT(ticketId) DO UPDATE SET state='queued',requestedAt=excluded.requestedAt,customerSeen=excluded.customerSeen,agentId=NULL,connectedAt=NULL,endedAt=NULL,reason=NULL",
                       (t['id'], stamp, stamp))
            _event(db, t['id'], 'Customer joined the live chat queue')
            db.execute('INSERT INTO desk_chat_alerts(id,ticketId,requestedAt) VALUES (?,?,?)',(str(uuid.uuid4()),t['id'],stamp))
        return {'chat': detail(db, me, t)}
    if op == 'chatAccept':
        desk.require_staff(me)
        if not is_open(stamp):
            raise desk.DeskError('Live chat is closed. ' + HOURS + '.', 409)
        presence = db.execute('SELECT * FROM desk_chat_presence WHERE userId=?', (me['userId'],)).fetchone()
        if not presence or not presence['available'] or stamp-presence['seenAt']>=AGENT_TTL:
            raise desk.DeskError('Set yourself available before accepting a chat.', 409)
        if db.execute("SELECT 1 FROM desk_chat_sessions WHERE agentId=? AND state='live'", (me['userId'],)).fetchone():
            raise desk.DeskError('Finish your current chat before accepting another.', 409)
        first = db.execute("SELECT ticketId FROM desk_chat_sessions WHERE state='queued' ORDER BY requestedAt,ticketId LIMIT 1").fetchone()
        if not first or first['ticketId'] != t['id']:
            raise desk.DeskError('Accept the next waiting customer in queue order.', 409)
        db.execute("UPDATE desk_chat_sessions SET state='live',agentId=?,connectedAt=?,reason=NULL WHERE ticketId=? AND state='queued'",
                   (me['userId'], stamp, t['id']))
        _event(db, t['id'], me['name'] + ' connected to live chat')
        return {'chat': detail(db, me, t)}
    if op in ('chatCancel', 'chatEnd'):
        if me['userId'] != t['reporterId'] and not (desk.staff(me) and r and r['agentId']==me['userId']):
            raise desk.DeskError('Only a chat participant can end this chat.', 403)
        if r and r['state'] in ('queued', 'live'):
            _end(db, r, 'Live chat ended by ' + me['name'], stamp)
        return {'chat': detail(db, me, t)}
    if op == 'chatMessage':
        if not r or r['state'] != 'live' or not is_open(stamp):
            raise desk.DeskError('Wait for a support agent to connect before sending a chat message.', 409)
        if me['userId'] != t['reporterId'] and not (desk.staff(me) and r['agentId']==me['userId']):
            raise desk.DeskError('Only the assigned support agent can send in this live chat.', 403)
        content = desk.text(body, 'body', 10000)
        recent = dt.datetime.fromtimestamp(stamp-60, dt.timezone.utc).isoformat()
        if db.execute('SELECT count(*) FROM desk_comments WHERE ticketId=? AND authorId=? AND createdAt>?', (t['id'], me['userId'], recent)).fetchone()[0] >= 60:
            raise desk.DeskError('Too many messages. Please wait a moment.', 429)
        cid, created = uuid.uuid4().hex, desk.now()
        db.execute('INSERT INTO desk_comments VALUES (?,?,?,?,?,?,?)', (cid,t['id'],me['userId'],me['name'],content,'public',created))
        db.execute('INSERT INTO desk_comment_sources VALUES (?,?,NULL)', (cid,'chat'))
        db.execute('UPDATE desk_tickets SET version=version+1,updatedAt=? WHERE id=?', (created,t['id']))
        return {'ok': True}
    raise desk.DeskError('Unknown chat action.')


def alert_settings():
    """The owner installs the approved Chat webhook privately, never via tickets."""
    import json,os,re
    from pathlib import Path
    from urllib.parse import urlsplit,parse_qs
    path=Path(os.getenv('ECCO_DESK_CHAT_CONFIG','/workspace/ecco-storage-private/desk-chat.json'))
    if not path.exists(): return None
    if path.stat().st_mode & 0o077: raise ValueError('Chat configuration must be private.')
    config=json.loads(path.read_text())
    if config.get('enabled') is not True: return None
    url=urlsplit(config.get('webhook',''))
    query=parse_qs(url.query)
    if url.scheme!='https' or url.netloc!='chat.googleapis.com' or url.fragment or not re.fullmatch(r'/v1/spaces/[A-Za-z0-9_-]+/messages',url.path) or set(query)!={'key','token'} or any(len(v)!=1 or not v[0] for v in query.values()):
        raise ValueError('Use the approved Google Chat incoming webhook.')
    return config


def send_alert(url,tid):
    import json
    from urllib.request import Request,build_opener,HTTPRedirectHandler
    class NoRedirect(HTTPRedirectHandler):
        def redirect_request(self,*args,**kwargs): return None
    text=f'Online support requested for SUP-{tid:04d}. Open Ecco Desk → Live support to accept the next waiting customer.\nhttps://ecco-ai-labs.github.io/ecco-studio/desk/\nThe customer remains queued until an available agent accepts.'
    # Incoming webhooks reject the Chat API's requestId option. The outbox
    # handles local deduplication; send only the webhook's key/token query.
    request=Request(url,data=json.dumps({'text':text}).encode(),headers={'Content-Type':'application/json; charset=UTF-8'})
    with build_opener(NoRedirect).open(request,timeout=20) as response:
        if not json.load(response).get('name'): raise ValueError('Chat did not confirm the message.')


def deliver_alert(path):
    import ecco_desk_mail as mail
    config=alert_settings()
    if not config: return False
    stamp=time.time()
    with mail.connect(path) as db:
        db.execute('BEGIN IMMEDIATE');maintain(db,stamp)
        db.execute("""UPDATE desk_chat_alerts SET state='skipped' WHERE state='pending' AND NOT EXISTS
            (SELECT 1 FROM desk_chat_sessions s WHERE s.ticketId=desk_chat_alerts.ticketId
             AND s.requestedAt=desk_chat_alerts.requestedAt AND s.state='queued')""")
        row=db.execute("SELECT * FROM desk_chat_alerts WHERE state='pending' AND availableAt<=? AND leaseUntil<=? ORDER BY requestedAt,id LIMIT 1",(stamp,stamp)).fetchone()
        if not row:return False
        row=dict(row)
        db.execute('UPDATE desk_chat_alerts SET attempts=attempts+1,leaseUntil=? WHERE id=?',(stamp+60,row['id']))
    try:
        send_alert(config['webhook'],row['ticketId'])
    except Exception as exc:
        error=type(exc).__name__+(f' ({exc.code})' if type(getattr(exc,'code',None)) is int else '')
        with mail.connect(path) as db:
            db.execute('UPDATE desk_chat_alerts SET lastError=?,availableAt=?,leaseUntil=0 WHERE id=?',(error,time.time()+min(300,10*2**min(row['attempts'],5)),row['id']))
        mail.LOG.warning('Ecco Desk Google Chat alert deferred: %s',error)
    else:
        with mail.connect(path) as db:db.execute("UPDATE desk_chat_alerts SET state='sent',leaseUntil=0,lastError=NULL WHERE id=?",(row['id'],))
    return True
