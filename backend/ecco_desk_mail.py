"""Persistent new-ticket mail queue. SMTP runs outside request transactions.

Credentials and the confirmed recipient belong in a private JSON file on the
CPU host, never in the repository, browser, ticket payload, or activity log.
"""
from contextlib import contextmanager
from email.message import EmailMessage
from email.utils import formatdate
import json
import datetime as dt
import logging
import os
from pathlib import Path
import re
import smtplib
import sqlite3
import ssl
import threading
import time
import uuid

LOG = logging.getLogger('ecco.desk.mail')
CONFIG_FILE = '/workspace/ecco-storage-private/desk-mail.json'
TEAM_URL = 'https://ecco-ai-labs.github.io/ecco-studio/desk/'
_workers = {}
_lock = threading.Lock()


@contextmanager
def connect(path):
    db = sqlite3.connect(path, timeout=15)
    db.row_factory = sqlite3.Row
    try:
        with db:
            yield db
    finally:
        db.close()


def initialize(db):
    db.execute('''CREATE TABLE IF NOT EXISTS desk_mail_outbox (
        ticketId INTEGER PRIMARY KEY REFERENCES desk_tickets(id),
        messageId TEXT NOT NULL UNIQUE,
        recipient TEXT, attempts INTEGER NOT NULL DEFAULT 0,
        availableAt REAL NOT NULL DEFAULT 0, leaseUntil REAL NOT NULL DEFAULT 0,
        claimToken TEXT, sentAt REAL, lastError TEXT)''')


def enqueue(db, ticket_id):
    # This insert commits or rolls back together with the new ticket.
    db.execute('INSERT INTO desk_mail_outbox(ticketId,messageId) VALUES (?,?)',
               (ticket_id, f'<ecco-desk-{uuid.uuid4().hex}@eccoailabs.com>'))
    event(db, ticket_id, 'New-ticket notification queued')


def event(db, ticket_id, detail):
    db.execute('INSERT INTO desk_events VALUES (?,?,?,?,?,?,?)',
               (uuid.uuid4().hex, ticket_id, 'system:desk-mail', 'Ecco Desk', detail,
                'internal', dt.datetime.now(dt.timezone.utc).isoformat(timespec='microseconds')))


def address(value):
    # One plain mailbox only; no header injection, display names or CC/BCC lists.
    if not isinstance(value, str) or len(value) > 254 or not re.fullmatch(
            r"[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,63}", value):
        raise ValueError('A single email address is required.')
    return value


def settings():
    path = Path(os.getenv('ECCO_DESK_MAIL_CONFIG', CONFIG_FILE))
    try:
        info = path.stat()
    except FileNotFoundError:
        return None
    if info.st_mode & 0o077:
        raise ValueError('Mail configuration must be private (mode 0600).')
    data = json.loads(path.read_text())
    if data.get('enabled') is not True:
        return None
    address(data.get('recipient'))
    address(data.get('sender'))
    host = data.get('host')
    if not isinstance(host, str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9.-]{0,252}', host):
        raise ValueError('SMTP host is required.')
    if type(data.get('port')) is not int or not 1 <= data['port'] <= 65535:
        raise ValueError('SMTP port is required.')
    if data.get('security') not in ('starttls', 'ssl'):
        raise ValueError('Encrypted SMTP is required.')
    user, password = data.get('username', ''), data.get('password', '')
    if not isinstance(user, str) or not isinstance(password, str) or bool(user) != bool(password):
        raise ValueError('SMTP username and password must be supplied together.')
    return data


def message(ticket, pending, config):
    msg = EmailMessage()
    msg['From'] = 'Ecco Desk <' + address(config['sender']) + '>'
    msg['To'] = address(pending['recipient'])
    msg['Date'] = formatdate(localtime=False, usegmt=True)
    msg['Message-ID'] = pending['messageId']
    label = 'Support ticket' if ticket['type'] == 'support' else 'Internal task'
    # User text is only body/subject data, never an SMTP destination.
    title = ' '.join(ticket['title'].split())
    msg['Subject'] = f'[Ecco Desk #{ticket["id"]}] New {label.lower()}: {title}'
    msg['Auto-Submitted'] = 'auto-generated'
    msg['X-Auto-Response-Suppress'] = 'All'
    msg.set_content(
        f'{label} #{ticket["id"]} was created.\n\n'
        f'Title: {ticket["title"]}\n'
        f'Opened by: {ticket["reporterName"]} <{ticket["reporterEmail"]}>\n'
        f'Priority: {ticket["priority"]}\nCategory: {ticket["category"]}\n'
        f'Created: {ticket["createdAt"]}\n\n'
        f'{ticket["description"]}\n\n'
        f'Open Ecco Desk: {TEAM_URL}\n'
        f'Sign in with an authorized team account and open ticket #{ticket["id"]}.\n'
        'This is an automatic notification. Reply to the ticket in Ecco Desk.\n')
    return msg


def send(msg, config):
    context = ssl.create_default_context()
    if config['security'] == 'ssl':
        client = smtplib.SMTP_SSL(config['host'], config['port'], timeout=20, context=context)
    else:
        client = smtplib.SMTP(config['host'], config['port'], timeout=20)
    try:
        if config['security'] == 'starttls':
            client.ehlo()
            client.starttls(context=context)
            client.ehlo()
        if config.get('username'):
            client.login(config['username'], config['password'])
        refused = client.send_message(msg, from_addr=config['sender'], to_addrs=[str(msg['To'])])
        if refused:
            raise smtplib.SMTPRecipientsRefused(refused)
    finally:
        # A QUIT/network failure after acceptance must not cause a duplicate.
        try:
            client.quit()
        except Exception:
            try:
                client.close()
            except Exception:
                pass


def deliver_one(path, config):
    stamp, token = time.time(), uuid.uuid4().hex
    with connect(path) as db:
        db.execute('BEGIN IMMEDIATE')
        row = db.execute('''SELECT * FROM desk_mail_outbox WHERE sentAt IS NULL
            AND availableAt<=? AND leaseUntil<=? ORDER BY ticketId LIMIT 1''', (stamp, stamp)).fetchone()
        if row is None:
            return False
        pending = dict(row)
        # Freeze the recipient on the first attempt, including across retries.
        pending['recipient'] = pending['recipient'] or config['recipient']
        db.execute('''UPDATE desk_mail_outbox SET recipient=?,attempts=attempts+1,
            leaseUntil=?,claimToken=? WHERE ticketId=?''',
            (pending['recipient'], stamp+600, token, pending['ticketId']))
        ticket = dict(db.execute('SELECT * FROM desk_tickets WHERE id=?', (pending['ticketId'],)).fetchone())
    try:
        send(message(ticket, pending, config), config)
    except Exception as exc:
        # SMTP responses can echo credentials, recipients or ticket content.
        # Persist/log only the exception class and numeric SMTP code.
        code = getattr(exc, 'smtp_code', None)
        error = type(exc).__name__ + (f' ({code})' if type(code) is int else '')
        delay = min(3600, 60 * 2 ** min(pending['attempts'], 6))
        with connect(path) as db:
            db.execute('''UPDATE desk_mail_outbox SET lastError=?,availableAt=?,
                leaseUntil=0,claimToken=NULL WHERE ticketId=? AND claimToken=?''',
                (error, time.time()+delay, pending['ticketId'], token))
            if pending['attempts'] == 0:
                event(db, pending['ticketId'], 'New-ticket notification delayed; automatic retry scheduled')
        LOG.warning('Ticket %s notification deferred: %s', pending['ticketId'], error)
    else:
        with connect(path) as db:
            db.execute('''UPDATE desk_mail_outbox SET sentAt=?,lastError=NULL,
                leaseUntil=0,claimToken=NULL WHERE ticketId=? AND claimToken=?''',
                (time.time(), pending['ticketId'], token))
            event(db, pending['ticketId'], 'New-ticket notification accepted by mail server')
        LOG.info('Ticket %s notification accepted by mail server', pending['ticketId'])
    return True


def _run(path, stop):
    prior_status = None
    while not stop.is_set():
        try:
            config = settings()
            status = 'ready' if config else 'not configured; new-ticket notifications remain queued'
            if status != prior_status:
                LOG.warning('Ecco Desk mail: %s', status)
                prior_status = status
            if config and deliver_one(path, config):
                continue
        except Exception as exc:
            status = type(exc).__name__
            if status != prior_status:
                LOG.warning('Ecco Desk mail worker deferred: %s', status)
                prior_status = status
        stop.wait(10)


def start(path):
    key = str(Path(path).resolve())
    with _lock:
        existing = _workers.get(key)
        if existing and existing[0].is_alive():
            return existing
        stop = threading.Event()
        thread = threading.Thread(target=_run, args=(key, stop), daemon=True, name='ecco-desk-mail')
        _workers[key] = (thread, stop)
        thread.start()
        return thread, stop
