"""Ecco Desk: Google identities, explicit staff grants, existing CPU/SQLite storage.

These tables never enter Studio's shared records API. A workspace-key holder can
explicitly claim the first administrator while signed in; later grants require
an administrator and refer to a verified Google subject, never an email/domain.
"""
import datetime as dt
from contextlib import contextmanager
import hmac
import json
import logging
import sqlite3
import traceback
import uuid
from urllib.parse import parse_qs, urlsplit

import google_signin
import ecco_desk_mail
import ecco_desk_chat
import ecco_desk_replies

STATUSES = ('open', 'in_progress', 'waiting', 'resolved', 'closed')
PRIORITIES = ('low', 'normal', 'high', 'urgent')
CATEGORIES = ('General', 'Ecco Studio', 'Account & access', 'Billing', 'Infrastructure', 'Engineering', 'Operations')
REQUEST_TYPES = ('Bug', 'Feature Request', 'Task', 'Question', 'Other')
LOG = logging.getLogger('ecco.desk')


class DeskError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


@contextmanager
def connect(path):
    db = sqlite3.connect(path, timeout=15)
    db.row_factory = sqlite3.Row
    db.execute('PRAGMA foreign_keys=ON')
    try:
        with db:
            yield db
    finally:
        db.close()


def initialize(path, start_notifications=True):
    # Older service launchers call initialize(path) without keyword arguments.
    # Keep notification startup enabled across deployments of those launchers.
    with connect(path) as db:
        db.executescript('''
        CREATE TABLE IF NOT EXISTS desk_users (
            id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS desk_members (
            id TEXT PRIMARY KEY, userId TEXT NOT NULL UNIQUE REFERENCES desk_users(id),
            name TEXT NOT NULL, email TEXT NOT NULL,
            role TEXT NOT NULL CHECK(role IN ('admin','staff')), active INTEGER NOT NULL DEFAULT 1);
        CREATE TABLE IF NOT EXISTS desk_tickets (
            id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL CHECK(type IN ('internal','support')),
            title TEXT NOT NULL, description TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open',
            priority TEXT NOT NULL, category TEXT NOT NULL,
            reporterId TEXT NOT NULL REFERENCES desk_users(id), reporterName TEXT NOT NULL, reporterEmail TEXT NOT NULL,
            assigneeId TEXT REFERENCES desk_members(id), dueDate TEXT,
            version INTEGER NOT NULL DEFAULT 1, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS desk_tickets_reporter ON desk_tickets(reporterId, updatedAt);
        CREATE TABLE IF NOT EXISTS desk_comments (
            id TEXT PRIMARY KEY, ticketId INTEGER NOT NULL REFERENCES desk_tickets(id),
            authorId TEXT NOT NULL, authorName TEXT NOT NULL, body TEXT NOT NULL,
            visibility TEXT NOT NULL CHECK(visibility IN ('internal','public')), createdAt TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS desk_comments_ticket ON desk_comments(ticketId, createdAt);
        CREATE TABLE IF NOT EXISTS desk_ticket_reads (
            ticketId INTEGER NOT NULL REFERENCES desk_tickets(id),
            userId TEXT NOT NULL REFERENCES desk_users(id), lastCommentRow INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY(ticketId,userId));
        CREATE TABLE IF NOT EXISTS desk_events (
            id TEXT PRIMARY KEY, ticketId INTEGER REFERENCES desk_tickets(id), actorId TEXT NOT NULL,
            actorName TEXT NOT NULL, detail TEXT NOT NULL, visibility TEXT NOT NULL, createdAt TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS desk_events_ticket ON desk_events(ticketId, createdAt);
        CREATE TABLE IF NOT EXISTS desk_notifications (
            id TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL,
            severity TEXT NOT NULL CHECK(severity IN ('informational','warning','error')),
            audience TEXT NOT NULL CHECK(audience IN ('all','user')),
            recipientId TEXT REFERENCES desk_users(id), durationDays INTEGER,
            createdBy TEXT NOT NULL REFERENCES desk_users(id), createdAt TEXT NOT NULL,
            expiresAt TEXT, revokedAt TEXT,
            CHECK((audience='all' AND recipientId IS NULL) OR (audience='user' AND recipientId IS NOT NULL)));
        CREATE INDEX IF NOT EXISTS desk_notifications_recipient ON desk_notifications(recipientId,createdAt);
        CREATE TABLE IF NOT EXISTS desk_notification_reads (
            notificationId TEXT NOT NULL REFERENCES desk_notifications(id),
            userId TEXT NOT NULL REFERENCES desk_users(id), readAt TEXT NOT NULL,
            PRIMARY KEY(notificationId,userId));
        ''')
        notification_columns = {row['name'] for row in db.execute('PRAGMA table_info(desk_notifications)')}
        if 'offer' not in notification_columns:
            db.execute('ALTER TABLE desk_notifications ADD COLUMN offer TEXT')
        # Additive migration preserves existing ticket IDs, content and permissions.
        columns = {row['name'] for row in db.execute('PRAGMA table_info(desk_tickets)')}
        if 'requestType' not in columns:
            db.execute("ALTER TABLE desk_tickets ADD COLUMN requestType TEXT NOT NULL DEFAULT 'Other'")
            db.execute("UPDATE desk_tickets SET requestType='Task' WHERE type='internal'")
        ecco_desk_mail.initialize(db)
        ecco_desk_chat.initialize(db)
        ecco_desk_replies.initialize(db)
        import ecco_desk_google_chat
        ecco_desk_google_chat.initialize(db)
    if start_notifications:
        ecco_desk_mail.start(path)


def now():
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec='microseconds')


def text(body, key, maximum, default=None):
    value = body.get(key, default)
    if not isinstance(value, str) or not value.strip() or len(value) > maximum:
        raise DeskError(f'{key} is required and must be at most {maximum} characters.')
    return value.strip()


def choice(body, key, values, default=None):
    value = body.get(key, default)
    if value not in values:
        raise DeskError(f'Invalid {key}.')
    return value


def number(value):
    if isinstance(value, bool) or not str(value).isdigit() or not 0 < int(value) < 2**63:
        raise DeskError('Invalid ticket ID.')
    return int(value)


def actor(db, user):
    db.execute('INSERT INTO desk_users VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,email=excluded.email',
               (user['id'], user['name'], user.get('email', '')))
    member = db.execute('SELECT * FROM desk_members WHERE userId=? AND active=1', (user['id'],)).fetchone()
    return dict(userId=user['id'], name=user['name'], email=user.get('email', ''),
                role=member['role'] if member else 'customer', memberId=member['id'] if member else None)


def staff(me):
    return me['role'] in ('admin', 'staff')


def require_staff(me, admin=False):
    if (me['role'] != 'admin') if admin else not staff(me):
        raise DeskError('This action requires team access.', 403)


def require_case_owner(me, t, allow_admin=False):
    if t['type'] == 'support' and (not allow_admin or me['role'] != 'admin'):
        if not me.get('memberId') or t['assigneeId'] != me['memberId']:
            raise DeskError('Accept this case first, or ask its current owner to delegate it to you.', 403)


def claim_support(db, me, t):
    require_staff(me)
    if t['type'] != 'support':
        raise DeskError('Accept case is available for support issues only.')
    if t['assigneeId']:
        require_case_owner(me, t)
        return
    db.execute("UPDATE desk_tickets SET assigneeId=?,status=CASE WHEN status='open' THEN 'in_progress' ELSE status END,version=version+1,updatedAt=? WHERE id=? AND assigneeId IS NULL", (me['memberId'], now(), t['id']))
    event(db, me, 'Case accepted by ' + me['name'], t['id'], 'public')


def event(db, me, detail, ticket=None, visibility='internal'):
    db.execute('INSERT INTO desk_events VALUES (?,?,?,?,?,?,?)',
               (uuid.uuid4().hex, ticket, me['userId'], me['name'], detail, visibility, now()))


def ticket(db, me, value):
    row = db.execute('SELECT * FROM desk_tickets WHERE id=?', (number(value),)).fetchone()
    if not row or not (staff(me) or row['type'] == 'support' and row['reporterId'] == me['userId']):
        raise DeskError('Ticket not found.', 404)
    return dict(row)


def customer_ticket(row, me):
    if staff(me):
        return row
    return {**row, 'assigneeId': None, 'dueDate': None}


def properties(db, body):
    assignee, due = body.get('assigneeId') or None, body.get('dueDate') or None
    if assignee and (not isinstance(assignee, str) or not db.execute('SELECT 1 FROM desk_members WHERE id=? AND active=1', (assignee,)).fetchone()):
        raise DeskError('Choose an active team member.')
    if due:
        try:
            if not isinstance(due, str) or dt.date.fromisoformat(due).isoformat() != due:
                raise ValueError()
        except (ValueError, TypeError):
            raise DeskError('Choose a valid due date.')
    return assignee, due


def unread(db, me):
    rows=db.execute('''SELECT t.id,COUNT(*) AS replies FROM desk_tickets t
        JOIN desk_comments c ON c.ticketId=t.id
        LEFT JOIN desk_ticket_reads r ON r.ticketId=t.id AND r.userId=t.reporterId
        WHERE t.type='support' AND t.reporterId=? AND c.visibility='public'
        AND c.authorId<>t.reporterId AND c.rowid>COALESCE(r.lastCommentRow,0)
        GROUP BY t.id''',(me['userId'],)).fetchall()
    return dict(unreadTickets=len(rows),unreadByTicket={str(r['id']):r['replies'] for r in rows})


def user_notifications(db, me):
    # Apply the five-newest limit before receipts/expiry so dismissed older
    # notices never reappear to fill a newly vacant slot.
    rows = db.execute('''SELECT n.id,n.title,n.body,n.severity,n.createdAt,n.expiresAt,n.revokedAt,n.offer,r.readAt
        FROM (SELECT rowid AS sequence,* FROM desk_notifications
              WHERE audience='all' OR recipientId=? ORDER BY rowid DESC LIMIT 5) n
        LEFT JOIN desk_notification_reads r ON r.notificationId=n.id AND r.userId=?
        WHERE r.readAt IS NULL AND n.revokedAt IS NULL AND (n.expiresAt IS NULL OR n.expiresAt>?)
        ORDER BY n.sequence DESC''', (me['userId'], me['userId'], now()))
    return dict(notificationVersion=1, specialOfferVersion=1, notifications=[{**{k:r[k] for k in
        ('id','title','body','severity','createdAt','expiresAt')},
        'kind': 'special_offer' if r['offer'] else 'notification',
        'offer': json.loads(r['offer']) if r['offer'] else None} for r in rows])


def manage_notifications(db, me):
    require_staff(me, admin=True)
    rows = db.execute('''SELECT n.*,u.name AS recipientName,u.email AS recipientEmail,
        (SELECT COUNT(*) FROM desk_notification_reads r WHERE r.notificationId=n.id) AS readCount
        FROM desk_notifications n LEFT JOIN desk_users u ON u.id=n.recipientId
        ORDER BY n.rowid DESC LIMIT 200''')
    current = now()
    notices = []
    for r in rows:
        item = dict(r)
        item['kind'] = 'special_offer' if r['offer'] else 'notification'
        item['offer'] = json.loads(r['offer']) if r['offer'] else None
        item['status'] = ('withdrawn' if r['revokedAt'] else 'expired' if r['expiresAt'] and r['expiresAt'] <= current
                          else 'read' if r['audience'] == 'user' and r['readCount'] else 'active')
        notices.append(item)
    return dict(notificationVersion=1, specialOfferVersion=1, notifications=notices,
                users=[dict(r) for r in db.execute('SELECT * FROM desk_users ORDER BY name,email')])


def write_notification(db, me, body):
    op = body['op']
    if op == 'readNotification':
        nid = text(body, 'id', 64)
        row = db.execute("SELECT id FROM desk_notifications WHERE id=? AND (audience='all' OR recipientId=?)",
                         (nid, me['userId'])).fetchone()
        if not row:
            raise DeskError('Notification not found.', 404)
        db.execute('INSERT OR IGNORE INTO desk_notification_reads VALUES (?,?,?)', (nid, me['userId'], now()))
        return user_notifications(db, me)
    require_staff(me, admin=True)
    if op == 'withdrawNotification':
        nid = text(body, 'id', 64)
        row = db.execute('SELECT revokedAt FROM desk_notifications WHERE id=?', (nid,)).fetchone()
        if not row:
            raise DeskError('Notification not found.', 404)
        if not row['revokedAt']:
            db.execute('UPDATE desk_notifications SET revokedAt=? WHERE id=?', (now(), nid))
            event(db, me, 'User notification withdrawn: ' + nid)
        return {'ok': True, 'notificationVersion': 1}
    nid = uuid.UUID(text(body, 'requestId', 36)).hex
    title, message = text(body, 'title', 160), text(body, 'body', 4000)
    severity = choice(body, 'severity', ('informational','warning','error'))
    kind = choice(body, 'kind', ('notification','special_offer'), 'notification')
    offer = None
    if kind == 'special_offer':
        raw = body.get('offer')
        if severity != 'informational' or not isinstance(raw, dict):
            raise DeskError('Special offers must be informational and include credit and price terms.')
        for key, minimum, maximum in (('credits',1,1000000),('bonusCredits',0,1000000),('cents',1,100000000)):
            if type(raw.get(key)) is not int or not minimum <= raw[key] <= maximum:
                raise DeskError('Special offer credits and price must be valid whole numbers.')
        offer = json.dumps({k: raw[k] for k in ('credits','bonusCredits','cents')}, sort_keys=True)
    elif body.get('offer') is not None:
        raise DeskError('Choose Special offer to include purchase terms.')
    audience = choice(body, 'audience', ('all','user'))
    recipient = text(body, 'recipientId', 256) if audience == 'user' else None
    if recipient and not db.execute('SELECT 1 FROM desk_users WHERE id=?', (recipient,)).fetchone():
        raise DeskError('Choose a verified Studio user.')
    days = body.get('durationDays')
    if days is not None and (type(days) is not int or not 1 <= days <= 365):
        raise DeskError('Duration must be a whole number from 1 to 365 days, or Until read.')
    existing = db.execute('SELECT * FROM desk_notifications WHERE id=?', (nid,)).fetchone()
    values = dict(title=title, body=message, severity=severity, audience=audience,
                  recipientId=recipient, durationDays=days, createdBy=me['userId'], offer=offer)
    if existing:
        if any(existing[k] != v for k,v in values.items()):
            raise DeskError('This notification request was already used. Refresh before creating another.', 409)
        return {'notificationVersion': 1, 'specialOfferVersion': 1, 'id': nid}
    created = now()
    expires = (dt.datetime.fromisoformat(created) + dt.timedelta(days=days)).isoformat(timespec='microseconds') if days else None
    db.execute('''INSERT INTO desk_notifications
        (id,title,body,severity,audience,recipientId,durationDays,createdBy,createdAt,expiresAt,offer)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)''', (nid,title,message,severity,audience,recipient,days,me['userId'],created,expires,offer))
    event(db, me, 'User notification published: ' + nid)
    return {'notificationVersion': 1, 'specialOfferVersion': 1, 'id': nid}


def read(db, me, query):
    if 'manageNotifications' in query:
        return manage_notifications(db, me)
    if 'userNotifications' in query:
        return user_notifications(db, me)
    if 'notifications' in query:
        return unread(db, me)
    if 'ticket' in query:
        t = ticket(db, me, query['ticket'][0])
        chat_state = ecco_desk_chat.detail(db, me, t) if t['type']=='support' else None
        clause = '' if staff(me) else " AND visibility='public'"
        comments = [dict(r) for r in db.execute("SELECT c.id,authorName,body,visibility,createdAt,COALESCE(s.channel,'web') AS channel FROM desk_comments c LEFT JOIN desk_comment_sources s ON s.commentId=c.id WHERE ticketId=?" + clause + ' ORDER BY createdAt,c.rowid', (t['id'],))]
        events = [dict(r) for r in db.execute('SELECT id,ticketId,actorName,detail,visibility,createdAt FROM desk_events WHERE ticketId=?' + clause + ' ORDER BY createdAt', (t['id'],))]
        through=db.execute("SELECT id FROM desk_comments WHERE ticketId=? AND visibility='public' AND authorId<>? ORDER BY rowid DESC LIMIT 1",(t['id'],t['reporterId'])).fetchone() if t['reporterId']==me['userId'] else None
        return dict(ticket=customer_ticket(t, me), comments=comments, events=events,
                    chat=chat_state,readThrough=through[0] if through else None)
    rows = db.execute('SELECT * FROM desk_tickets ORDER BY updatedAt DESC') if staff(me) else db.execute("SELECT * FROM desk_tickets WHERE type='support' AND reporterId=? ORDER BY updatedAt DESC", (me['userId'],))
    result = dict(me=me, tickets=[customer_ticket(dict(r), me) for r in rows],
                members=[dict(r) for r in db.execute('SELECT * FROM desk_members ORDER BY name')] if staff(me) else [],
                users=[dict(r) for r in db.execute('SELECT * FROM desk_users ORDER BY name')] if me['role'] == 'admin' else [],
                activity=[dict(r) for r in db.execute('SELECT id,ticketId,actorName,detail,visibility,createdAt FROM desk_events ORDER BY createdAt DESC LIMIT 100')] if staff(me) else [],
                needsSetup=not bool(db.execute("SELECT 1 FROM desk_members WHERE role='admin' AND active=1").fetchone()),
                chatSupport=ecco_desk_chat.support_status(db, me))
    if me['role']=='admin':
        import ecco_desk_inbox
        result['inbox'] = ecco_desk_inbox.status()
    result.update(unread(db,me))
    return result


def write(db, me, body, workspace_key, configured_key):
    op = body.get('op')
    if op in ('createNotification', 'withdrawNotification', 'readNotification'):
        return write_notification(db, me, body)
    if op == 'claimTicket':
        t = ticket(db, me, body.get('id'))
        claim_support(db, me, t)
        return {'ticket': ticket(db, me, t['id'])}
    if op in ('closeIssue', 'reopenIssue'):
        t = ticket(db, me, body.get('id'))
        if t['type'] != 'support' or t['reporterId'] != me['userId']:
            raise DeskError('Ticket not found.', 404)
        if body.get('version') != t['version']:
            raise DeskError('This ticket changed. Refresh it before changing its status.', 409)
        status = 'closed' if op == 'closeIssue' else 'open'
        if status != t['status']:
            if status == 'closed':
                ecco_desk_chat.end_for_closed_ticket(db, t['id'])
            db.execute('UPDATE desk_tickets SET status=?,version=version+1,updatedAt=? WHERE id=?', (status, now(), t['id']))
            event(db, me, 'Issue closed by requester' if status == 'closed' else 'Issue reopened by requester', t['id'], 'public')
        return {'ticket': customer_ticket(ticket(db, me, t['id']), me)}
    if op == 'readTicket':
        t=ticket(db,me,body.get('id'))
        if t['type']!='support' or t['reporterId']!=me['userId']:
            raise DeskError('Ticket not found.',404)
        through=text(body,'through',64)
        row=db.execute("SELECT rowid FROM desk_comments WHERE id=? AND ticketId=? AND visibility='public' AND authorId<>?",(through,t['id'],t['reporterId'])).fetchone()
        if not row: raise DeskError('Reply not found.',404)
        db.execute('''INSERT INTO desk_ticket_reads VALUES (?,?,?)
            ON CONFLICT(ticketId,userId) DO UPDATE SET lastCommentRow=MAX(lastCommentRow,excluded.lastCommentRow)''',(t['id'],me['userId'],row[0]))
        return unread(db,me)
    if op in ('chatRequest','chatCancel','chatEnd','chatMessage','chatTyping','chatPresence','chatAccept'):
        return ecco_desk_chat.write(db, me, body)
    if op == 'connectInbox':
        require_staff(me, admin=True)
        import ecco_desk_inbox
        return ecco_desk_inbox.start()
    if op == 'bootstrap':
        if not configured_key or not hmac.compare_digest(workspace_key, configured_key):
            raise DeskError('Connect your existing Studio storage account before activating the team workspace.', 403)
        if db.execute("SELECT 1 FROM desk_members WHERE role='admin' AND active=1").fetchone():
            raise DeskError('Team access is already configured. Ask an administrator to add you.', 409)
        mid = uuid.uuid4().hex
        db.execute('INSERT INTO desk_members VALUES (?,?,?,?,?,1)', (mid, me['userId'], me['name'], me['email'], 'admin'))
        event(db, me, 'Activated Ecco Desk team workspace')
        return {'ok': True}
    if op == 'createTicket':
        kind = choice(body, 'type', ('internal', 'support'))
        if kind == 'internal':
            require_staff(me)
        title, description = text(body, 'title', 160), text(body, 'description', 12000)
        priority, category = choice(body, 'priority', PRIORITIES, 'normal'), choice(body, 'category', CATEGORIES, 'General')
        request_type = choice(body, 'requestType', REQUEST_TYPES, 'Task' if kind == 'internal' else 'Other')
        assignee, due = properties(db, body) if staff(me) else (None, None)
        # Bound accidental/repeated submissions without a separate service.
        recent = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(hours=1)).isoformat()
        if db.execute('SELECT count(*) FROM desk_tickets WHERE reporterId=? AND createdAt>?', (me['userId'], recent)).fetchone()[0] >= 60:
            raise DeskError('Too many new requests. Please try again later.', 429)
        stamp = now()
        tid = db.execute('INSERT INTO desk_tickets(type,title,description,priority,category,reporterId,reporterName,reporterEmail,assigneeId,dueDate,createdAt,updatedAt,requestType) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
                         (kind, title, description, priority, category, me['userId'], me['name'], me['email'], assignee, due, stamp, stamp, request_type)).lastrowid
        event(db, me, 'Ticket opened' if kind == 'support' else 'Task created', tid, 'public' if kind == 'support' else 'internal')
        ecco_desk_mail.enqueue(db, tid)
        created = ticket(db, me, tid)
        ecco_desk_replies.acknowledge(db, created)
        return {'ticket': customer_ticket(created, me)}
    if op == 'updateTicket':
        require_staff(me)
        t = ticket(db, me, body.get('id'))
        require_case_owner(me, t, allow_admin=True)
        if body.get('version') != t['version']:
            raise DeskError('This ticket changed. Refresh it before saving again.', 409)
        status = choice(body, 'status', STATUSES, t['status'])
        priority = choice(body, 'priority', PRIORITIES, t['priority'])
        request_type = choice(body, 'requestType', REQUEST_TYPES, t['requestType'])
        assignee, due = properties(db, {**t, **body})
        if t['type'] == 'support' and t['assigneeId'] and assignee is None:
            raise DeskError('Choose an active delegate instead of leaving an accepted case unassigned.')
        db.execute('UPDATE desk_tickets SET status=?,priority=?,requestType=?,assigneeId=?,dueDate=?,version=version+1,updatedAt=? WHERE id=?', (status, priority, request_type, assignee, due, now(), t['id']))
        if t['type'] == 'support' and status in ('resolved', 'closed'):
            ecco_desk_chat.end_for_closed_ticket(db, t['id'])
        visibility = 'public' if t['type'] == 'support' else 'internal'
        if request_type != t['requestType']:
            event(db, me, 'Type changed to ' + request_type, t['id'], visibility)
        for key, value in (('status', status), ('priority', priority)):
            if value != t[key]:
                event(db, me, f'{key.title()} changed to {value.replace("_", " ")}', t['id'], visibility)
        if assignee != t['assigneeId']:
            name = db.execute('SELECT name FROM desk_members WHERE id=?', (assignee,)).fetchone() if assignee else None
            event(db, me, ('Delegated to ' if t['type']=='support' and t['assigneeId'] else 'Assigned to ') + name[0] if name else 'Assignment cleared', t['id'], visibility)
            if t['type'] == 'support':
                ecco_desk_chat.delegate(db, t['id'], assignee)
        if due != t['dueDate']:
            event(db, me, 'Due date set to ' + due if due else 'Due date cleared', t['id'])
        return {'ticket': ticket(db, me, t['id'])}
    if op == 'comment':
        t = ticket(db, me, body.get('id'))
        content = text(body, 'body', 10000)
        visibility = choice(body, 'visibility', ('public', 'internal'), 'public') if staff(me) else 'public'
        if t['type'] == 'internal':
            visibility = 'internal'
        if t['type'] == 'support' and visibility == 'public' and me['userId'] != t['reporterId']:
            require_case_owner(me, t)
        stamp = now()
        if visibility=='public' and t['type']=='support':
            ecco_desk_chat.maintain(db)
            if db.execute("SELECT 1 FROM desk_chat_sessions WHERE ticketId=? AND state='live'", (t['id'],)).fetchone():
                raise DeskError('This ticket is in live chat. Use the chat composer or end chat to return to email.', 409)
        cid = uuid.uuid4().hex
        db.execute('INSERT INTO desk_comments VALUES (?,?,?,?,?,?,?)', (cid, t['id'], me['userId'], me['name'], content, visibility, stamp))
        db.execute('UPDATE desk_tickets SET version=version+1,updatedAt=? WHERE id=?', (stamp, t['id']))
        event(db, me, 'Internal note added' if visibility == 'internal' else 'Reply added', t['id'], visibility)
        if visibility=='public':
            ecco_desk_replies.notify_comment(db, t, me, cid, content)
        return {'ok': True}
    if op == 'addMember':
        require_staff(me, admin=True)
        uid = text(body, 'userId', 256)
        user = db.execute('SELECT * FROM desk_users WHERE id=?', (uid,)).fetchone()
        if not user:
            raise DeskError('This person must sign in to Ecco Desk once before they can join your team.')
        if db.execute('SELECT 1 FROM desk_members WHERE userId=?', (uid,)).fetchone():
            raise DeskError('This account is already listed in the team directory.', 409)
        role = choice(body, 'role', ('staff', 'admin'))
        db.execute('INSERT INTO desk_members VALUES (?,?,?,?,?,1)', (uuid.uuid4().hex, uid, user['name'], user['email'], role))
        event(db, me, f'Added {user["name"]} as {role}')
        return {'ok': True}
    if op == 'updateMember':
        require_staff(me, admin=True)
        mid = text(body, 'id', 64)
        active = body.get('active')
        if type(active) is not int or active not in (0, 1):
            raise DeskError('Invalid member state.')
        if mid == me['memberId']:
            raise DeskError('You cannot deactivate your own administrator account.')
        member = db.execute('SELECT * FROM desk_members WHERE id=?', (mid,)).fetchone()
        if not member:
            raise DeskError('Team member not found.', 404)
        db.execute('UPDATE desk_members SET active=? WHERE id=?', (active, mid))
        event(db, me, ('Reactivated ' if active else 'Deactivated ') + member['name'])
        return {'ok': True}
    raise DeskError('Unknown Desk action.')


def handle(handler, path, allowed_origin, database, configured_key):
    if path == '/api/desk/inbox/connect':
        # The existing workspace owner can configure the support mailbox before
        # a team administrator is enrolled. This is the same private owner key
        # used for other backend provider connections, never a customer session.
        try:
            if handler.headers.get('Origin') != allowed_origin:
                raise DeskError('Origin denied.', 403)
            if not configured_key or not hmac.compare_digest(handler.headers.get('Authorization',''), 'Bearer '+configured_key):
                raise DeskError('Workspace owner authentication is required.', 401)
            if handler.command != 'POST':
                raise DeskError('Use POST to start an inbox connection.', 405)
            length=int(handler.headers.get('Content-Length','0'))
            if not 0 < length <= 32 or handler.headers.get('Content-Type','').split(';')[0]!='application/json':
                raise DeskError('Expected an empty JSON object.')
            if json.loads(handler.rfile.read(length)) != {}:
                raise DeskError('Inbox settings cannot be supplied in this request.')
            import ecco_desk_inbox
            handler.send(ecco_desk_inbox.start())
        except DeskError as exc:
            handler.send({'error':str(exc)},exc.status)
        except Exception:
            handler.send({'error':'Could not start support inbox authorization. Check the existing Google OAuth configuration.'},503)
        return True
    if path == '/api/youtube/callback' and any(s.startswith('desk-inbox-') for s in parse_qs(urlsplit(handler.path).query).get('state', [])):
        import ecco_desk_inbox
        ecco_desk_inbox.callback(handler)
        return True
    import ecco_desk_google_chat
    if ecco_desk_google_chat.handle(handler,path,database): return True
    if path not in ('/api/desk', '/api/desk/support'):
        return False
    personal_support = path == '/api/desk/support'
    try:
        if handler.headers.get('Origin') != allowed_origin:
            raise DeskError('Origin denied.', 403)
        user = google_signin.session(handler.headers.get('Authorization', ''))['user']
        body = None
        if handler.command == 'POST':
            length = int(handler.headers.get('Content-Length', '0'))
            if not 0 < length <= 32768:
                raise DeskError('Request is too large.', 413)
            if handler.headers.get('Content-Type', '').split(';')[0] != 'application/json':
                raise DeskError('Expected JSON.', 415)
            body = json.loads(handler.rfile.read(length))
            if not isinstance(body, dict):
                raise DeskError('Expected an object.')
            if personal_support and not (body.get('op') in ('comment','readTicket','readNotification','closeIssue','reopenIssue','chatRequest','chatCancel','chatEnd','chatMessage','chatTyping') or
                                         body.get('op') == 'createTicket' and body.get('type') == 'support'):
                raise DeskError('This support page is for your own tickets only.', 403)
        with connect(database) as db:
            # Serializes the permission check + mutation, including first-admin claim.
            db.execute('BEGIN IMMEDIATE')
            me = actor(db, user)
            # The Studio customer surface always uses requester permissions,
            # even if this Google identity separately has a staff/admin role.
            if personal_support:
                me = {**me, 'role': 'customer', 'memberId': None}
            result = write(db, me, body, handler.headers.get('X-Ecco-Workspace-Key', ''), configured_key) if body is not None else read(db, me, parse_qs(urlsplit(handler.path).query))
            if personal_support and 'needsSetup' in result:
                result['needsSetup'] = False
        handler.send(result, 201 if body and body.get('op') == 'createTicket' else 200)
    except (DeskError, google_signin.AuthError) as exc:
        handler.send({'error': str(exc)}, exc.status)
    except (ValueError, TypeError, OverflowError):
        handler.send({'error': 'Invalid Desk request.'}, 400)
    except (BrokenPipeError, ConnectionResetError):
        pass
    except Exception as exc:
        reference = uuid.uuid4().hex[:12]
        # Never log request bodies, headers, credentials or exception values.
        frames = ' > '.join(f'{frame.name}:{frame.lineno}' for frame in traceback.extract_tb(exc.__traceback__))
        LOG.error('Desk failure ref=%s kind=%s sqlite=%s frames=%s', reference,
                  type(exc).__name__, getattr(exc, 'sqlite_errorname', 'none'), frames)
        handler.send({'error': 'Ecco Desk is temporarily unavailable. Please try again. Reference: ' + reference,
                      'reference': reference}, 503)
    return True
