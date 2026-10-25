"""Threaded outbound replies and idempotent, authenticated inbound email import."""
import base64
import datetime as dt
from email import policy
from email.message import EmailMessage
from email.parser import BytesParser
from email.utils import getaddresses, formatdate
from html.parser import HTMLParser
import json
import re
import time
import uuid

import ecco_desk_mail as mail


def initialize(db):
    db.executescript('''
    CREATE TABLE IF NOT EXISTS desk_email_threads(ticketId INTEGER PRIMARY KEY REFERENCES desk_tickets(id), token TEXT NOT NULL UNIQUE);
    CREATE TABLE IF NOT EXISTS desk_reply_outbox(
        id TEXT PRIMARY KEY, ticketId INTEGER NOT NULL REFERENCES desk_tickets(id),
        commentId TEXT, recipient TEXT NOT NULL, messageId TEXT UNIQUE NOT NULL,
        subject TEXT NOT NULL, body TEXT NOT NULL, replyTo TEXT NOT NULL,
        parentMessageId TEXT, attempts INTEGER NOT NULL DEFAULT 0,
        availableAt REAL NOT NULL DEFAULT 0, leaseUntil REAL NOT NULL DEFAULT 0,
        claimToken TEXT, sentAt REAL, lastError TEXT);
    CREATE TABLE IF NOT EXISTS desk_inbound_mail(
        gmailId TEXT PRIMARY KEY, messageId TEXT, ticketId INTEGER,
        outcome TEXT NOT NULL, processedAt REAL NOT NULL);
    CREATE UNIQUE INDEX IF NOT EXISTS desk_inbound_message_id ON desk_inbound_mail(messageId) WHERE messageId IS NOT NULL;
    CREATE TABLE IF NOT EXISTS desk_inbox_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    ''')


def reply_address(db, tid, config):
    db.execute('INSERT OR IGNORE INTO desk_email_threads VALUES (?,?)', (tid, uuid.uuid4().hex))
    token = db.execute('SELECT token FROM desk_email_threads WHERE ticketId=?', (tid,)).fetchone()[0]
    local, domain = mail.address(config['recipient']).split('@')
    return f'{local}+desk-{token}@{domain}'


def queue(db, t, recipient, subject, content, comment_id=None, parent=None):
    config = mail.settings()
    if not config or not recipient:
        return
    mail.address(recipient)
    db.execute('''INSERT INTO desk_reply_outbox
        (id,ticketId,commentId,recipient,messageId,subject,body,replyTo,parentMessageId)
        VALUES (?,?,?,?,?,?,?,?,?)''', (uuid.uuid4().hex,t['id'],comment_id,recipient,
        f'<ecco-reply-{uuid.uuid4().hex}@eccoailabs.com>',subject,content,
        mail.address(t['reporterEmail']) if recipient.casefold()==config['recipient'].casefold()
        else reply_address(db,t['id'],config),parent))


def acknowledge(db, t):
    # A requester receives a replyable thread as soon as the support ticket exists.
    if t['type'] == 'support':
        queue(db, t, t['reporterEmail'], f'[Ecco Desk #{t["id"]}] {t["title"]}',
              f'Your support ticket #{t["id"]} is open.\n\n{t["description"]}\n\nReply to this email or continue in Ecco Studio.\nhttps://ecco-ai-labs.github.io/ecco-studio/?desk=support')


def notify_comment(db, t, me, cid, content, already_delivered=()):
    if t['type'] != 'support':
        return
    config = mail.settings()
    if not config:
        return
    recipient = config['recipient'] if me['userId']==t['reporterId'] else t['reporterEmail']
    if recipient.casefold() in {s.casefold() for s in already_delivered}:
        return
    parent = db.execute('SELECT messageId FROM desk_reply_outbox WHERE ticketId=? AND recipient=? ORDER BY rowid DESC LIMIT 1',
                        (t['id'],recipient)).fetchone()
    queue(db,t,recipient,f'Re: [Ecco Desk #{t["id"]}] {t["title"]}',
          f'{me["name"]} replied to ticket #{t["id"]}:\n\n{content}\n\nReply above this line to continue the ticket.\nhttps://ecco-ai-labs.github.io/ecco-studio/?desk=support',
          cid,parent[0] if parent else None)


def deliver_one(path, config):
    stamp, token = time.time(), uuid.uuid4().hex
    with mail.connect(path) as db:
        db.execute('BEGIN IMMEDIATE')
        r = db.execute('SELECT * FROM desk_reply_outbox WHERE sentAt IS NULL AND availableAt<=? AND leaseUntil<=? ORDER BY rowid LIMIT 1', (stamp,stamp)).fetchone()
        if not r:
            return False
        r = dict(r)
        db.execute('UPDATE desk_reply_outbox SET attempts=attempts+1,leaseUntil=?,claimToken=? WHERE id=?', (stamp+600,token,r['id']))
    try:
        msg = EmailMessage()
        msg['From'] = 'Ecco Desk <' + mail.address(config['sender']) + '>'
        msg['To'] = mail.address(r['recipient'])
        msg['Reply-To'] = mail.address(r['replyTo'])
        msg['Subject'] = ' '.join(r['subject'].split())
        msg['Message-ID'] = r['messageId']
        msg['Date'] = formatdate(usegmt=True)
        msg['Auto-Submitted'] = 'auto-generated'
        msg['X-Auto-Response-Suppress'] = 'All'
        if r['parentMessageId']:
            msg['In-Reply-To'] = r['parentMessageId']
            msg['References'] = r['parentMessageId']
        msg.set_content(r['body'])
        mail.send(msg,config)
    except Exception as exc:
        code = getattr(exc,'smtp_code',None)
        error = type(exc).__name__ + (f' ({code})' if type(code) is int else '')
        with mail.connect(path) as db:
            db.execute('UPDATE desk_reply_outbox SET lastError=?,availableAt=?,leaseUntil=0,claimToken=NULL WHERE id=? AND claimToken=?',
                       (error,time.time()+min(3600,60*2**min(r['attempts'],6)),r['id'],token))
        mail.LOG.warning('Ticket %s reply email deferred: %s',r['ticketId'],error)
    else:
        with mail.connect(path) as db:
            db.execute('UPDATE desk_reply_outbox SET sentAt=?,lastError=NULL,leaseUntil=0,claimToken=NULL WHERE id=? AND claimToken=?', (time.time(),r['id'],token))
    return True


class PlainHTML(HTMLParser):
    def __init__(self):
        super().__init__(); self.parts=[]; self.skip=0
    def handle_starttag(self, tag, attrs):
        if tag in ('script','style','blockquote'):
            self.skip+=1
        if tag in ('p','br','div','li') and not self.skip:
            self.parts.append('\n')
    def handle_endtag(self, tag):
        if tag in ('script','style','blockquote') and self.skip:
            self.skip-=1
    def handle_data(self, data):
        if not self.skip:
            self.parts.append(data)


def body_text(msg):
    part = msg.get_body(preferencelist=('plain','html'))
    if not part:
        return ''
    content = part.get_content()
    if part.get_content_type()=='text/html':
        parser=PlainHTML(); parser.feed(content); content=''.join(parser.parts)
    lines=[]
    for line in content.splitlines():
        if re.match(r'^\s*(On .{3,200}wrote:|[-_]{3,}\s*Original Message|Reply above this line)',line):
            break
        if not line.lstrip().startswith('>'):
            lines.append(line)
    content='\n'.join(lines).strip()
    if len(content)>30000:
        content=content[:30000]+'\n[Email text truncated at 30,000 characters.]'
    attachments=[p.get_filename() for p in msg.iter_attachments() if p.get_filename()]
    if attachments:
        content+='\n[Email attachments remain in the support mailbox: '+', '.join(' '.join(n.split())[:160] for n in attachments[:10])+']'
    return content


def authenticated_sender(msg, sender, labels, mailbox):
    if 'SENT' in labels and sender==mailbox:
        return True
    # Only Gmail's first Authentication-Results header is authoritative. Never trust
    # later attacker-supplied headers or a forged From value by itself.
    values=msg.get_all('Authentication-Results',[])
    if not values:
        return False
    first=str(values[0])
    if not re.match(r'^\s*mx\.google\.com\s*;',first,re.I):
        return False
    domain=sender.rsplit('@',1)[-1].casefold()
    for result in first.split(';')[1:]:
        if re.search(r'\bdmarc=pass\b',result,re.I):
            match=re.search(r'\bheader\.from=([^\s;]+)',result,re.I)
            if match and match.group(1).strip('"').casefold()==domain:
                return True
    return False


def import_message(db, data, config):
    """Only called for messages fetched from the authorized Gmail mailbox."""
    import ecco_desk as desk
    gmail_id=data['id']
    if db.execute('SELECT 1 FROM desk_inbound_mail WHERE gmailId=?',(gmail_id,)).fetchone():
        return 'duplicate'
    try:
        raw=base64.urlsafe_b64decode(data.get('raw','')+'===')
    except (ValueError, TypeError):
        db.execute('INSERT INTO desk_inbound_mail VALUES (?,NULL,NULL,?,?)',(gmail_id,'malformed',time.time()))
        return 'malformed'
    if len(raw)>2_000_000:
        db.execute('INSERT INTO desk_inbound_mail VALUES (?,NULL,NULL,?,?)',(gmail_id,'oversized',time.time()))
        return 'oversized'
    msg=BytesParser(policy=policy.default).parsebytes(raw)
    mid=str(msg.get('Message-ID','')).strip() or None
    if mid and db.execute('SELECT 1 FROM desk_inbound_mail WHERE messageId=?',(mid,)).fetchone():
        return 'duplicate'
    def record(outcome,tid=None):
        db.execute('INSERT OR IGNORE INTO desk_inbound_mail VALUES (?,?,?,?,?)',(gmail_id,mid,tid,outcome,time.time()))
        return outcome
    if str(msg.get('Auto-Submitted','no')).casefold()!='no' or msg.get_content_type()=='multipart/report':
        return record('automatic')
    senders=getaddresses(msg.get_all('From',[]))
    if len(senders)!=1 or not senders[0][1]:
        return record('invalid_sender')
    sender=senders[0][1].casefold()
    mailbox=config['recipient'].casefold()
    if not authenticated_sender(msg,sender,data.get('labelIds',[]),mailbox):
        return record('sender_not_authenticated')
    matches=set()
    for _,addr in getaddresses(msg.get_all('To',[])+msg.get_all('Cc',[])+msg.get_all('Delivered-To',[])):
        token=re.fullmatch(re.escape(mailbox.split('@')[0])+r'\+desk-([a-f0-9]{32})@'+re.escape(mailbox.split('@')[1]),addr.casefold())
        if token:
            row=db.execute('SELECT ticketId FROM desk_email_threads WHERE token=?',(token[1],)).fetchone()
            if row: matches.add(row[0])
    references=re.findall(r'<[^<>\s]{1,250}>',' '.join(msg.get_all('References',[])+msg.get_all('In-Reply-To',[])))
    for ref in references[-30:]:
        for table in ('desk_mail_outbox','desk_reply_outbox','desk_inbound_mail'):
            row=db.execute(f'SELECT ticketId FROM {table} WHERE messageId=?',(ref,)).fetchone()
            if row and row[0]: matches.add(row[0])
    if len(matches)!=1:
        return record('unmatched_or_ambiguous_thread')
    tid=matches.pop()
    t=dict(db.execute('SELECT * FROM desk_tickets WHERE id=?',(tid,)).fetchone())
    if t['type']!='support':
        return record('internal_ticket_ignored',tid)
    if sender==t['reporterEmail'].casefold():
        me=dict(userId=t['reporterId'],name=t['reporterName'])
    elif sender==mailbox:
        me=dict(userId='system:support-mailbox',name='Support')
    else:
        staff=db.execute('SELECT userId,name FROM desk_members WHERE lower(email)=? AND active=1',(sender,)).fetchall()
        if len(staff)!=1:
            return record('sender_not_participant',tid)
        me=dict(staff[0])
    try:
        content=body_text(msg)
    except (LookupError, ValueError, UnicodeError):
        return record('malformed',tid)
    if not content:
        return record('empty_reply',tid)
    cid,stamp=uuid.uuid4().hex,desk.now()
    db.execute('INSERT INTO desk_comments VALUES (?,?,?,?,?,?,?)',(cid,tid,me['userId'],me['name'],content,'public',stamp))
    db.execute('INSERT INTO desk_comment_sources VALUES (?,?,?)',(cid,'email',gmail_id))
    db.execute('UPDATE desk_tickets SET version=version+1,updatedAt=? WHERE id=?',(stamp,tid))
    desk.event(db,me,'Email reply received',tid,'public')
    delivered=[a for _,a in getaddresses(msg.get_all('To',[])+msg.get_all('Cc',[]))]
    notify_comment(db,t,me,cid,content,delivered)
    return record('logged',tid)
