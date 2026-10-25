"""Live chat and email-reply privacy, queue, business-hours and delivery regressions."""
import base64
import datetime as dt
from email.message import EmailMessage
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import ecco_desk as desk
import ecco_desk_chat as chat
import ecco_desk_mail as mail
import ecco_desk_replies as replies


class Conversations(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.db=Path(self.tmp.name)/'studio.sqlite'
        desk.initialize(self.db,start_notifications=False)
        self.config=dict(enabled=True,recipient='support@example.test',sender='support@example.test',host='smtp.example.test',port=587,security='starttls',username='',password='')
        config=Path(self.tmp.name)/'mail.json'; config.write_text(json.dumps(self.config)); config.chmod(0o600)
        env=patch.dict(os.environ,{'ECCO_DESK_MAIL_CONFIG':str(config)}); env.start(); self.addCleanup(env.stop)
        clock=patch.object(chat.time,'time',return_value=dt.datetime(2026,10,24,17,tzinfo=dt.timezone.utc).timestamp()); self.clock=clock.start(); self.addCleanup(clock.stop)
        with desk.connect(self.db) as db:
            self.alice=desk.actor(db,{'id':'alice','name':'Alice','email':'alice@example.test'})
            self.bob=desk.actor(db,{'id':'bob','name':'Bob','email':'bob@example.test'})
            self.agent=desk.actor(db,{'id':'agent','name':'Agent','email':'agent@example.test'})
            self.agent2=desk.actor(db,{'id':'agent2','name':'Agent Two','email':'agent2@example.test'})
            for me in (self.agent,self.agent2):
                db.execute('INSERT INTO desk_members VALUES (?,?,?,?,?,1)',('m-'+me['userId'],me['userId'],me['name'],me['email'],'staff'))
                me.update(role='staff',memberId='m-'+me['userId'])
        self.t=self.create(self.alice)

    def create(self,me):
        with desk.connect(self.db) as db:
            return desk.write(db,me,dict(op='createTicket',type='support',title='Conversation test',description='Please help.'),'','')['ticket']

    def action(self,me,op,tid=None,**values):
        with desk.connect(self.db) as db:
            db.execute('BEGIN IMMEDIATE')
            return desk.write(db,me,dict(op=op,id=tid or self.t['id'],**values),'','')

    def detail(self,me,tid=None):
        with desk.connect(self.db) as db:
            db.execute('BEGIN IMMEDIATE')
            return desk.read(db,me,{'ticket':[str(tid or self.t['id'])]})

    def connect(self):
        self.action(self.alice,'chatRequest')
        self.action(self.agent,'chatPresence',available=True)
        self.action(self.agent,'chatAccept')

    def test_pacific_hours_summer_winter_and_close_boundary(self):
        for month,offset in [(7,7),(12,8)]:
            for hour,minute,expected in [(6,59,False),(7,0,True),(18,59,True),(19,0,False)]:
                stamp=(dt.datetime(2026,month,10,tzinfo=dt.timezone.utc)+dt.timedelta(hours=hour+offset,minutes=minute)).timestamp()
                self.assertEqual(chat.is_open(stamp),expected)

    def test_queue_does_not_connect_until_available_agent_accepts(self):
        result=self.action(self.alice,'chatRequest')['chat']
        self.assertEqual((result['state'],result['position']),('queued',1))
        with self.assertRaises(desk.DeskError): self.action(self.agent,'chatAccept')
        with self.assertRaises(desk.DeskError): self.action(self.alice,'chatMessage',body='Too early')
        self.action(self.agent,'chatPresence',available=True)
        self.assertEqual(self.detail(self.alice)['chat']['state'],'queued')
        self.action(self.agent,'chatAccept')
        self.assertEqual(self.detail(self.alice)['chat']['state'],'live')

    def test_fifo_one_chat_per_agent_and_request_is_idempotent(self):
        t2=self.create(self.bob)
        self.action(self.alice,'chatRequest'); self.action(self.alice,'chatRequest')
        self.action(self.bob,'chatRequest',t2['id'])
        self.assertEqual(self.detail(self.bob,t2['id'])['chat']['position'],2)
        self.action(self.agent,'chatPresence',available=True)
        with self.assertRaises(desk.DeskError): self.action(self.agent,'chatAccept',t2['id'])
        self.action(self.agent,'chatAccept')
        with self.assertRaises(desk.DeskError): self.action(self.agent2,'chatAccept')
        with self.assertRaises(desk.DeskError): self.action(self.agent,'chatAccept',t2['id'])

    def test_chat_messages_share_transcript_without_email_and_end_restores_email(self):
        self.connect()
        with desk.connect(self.db) as db: before=db.execute('SELECT count(*) FROM desk_reply_outbox').fetchone()[0]
        self.action(self.alice,'chatMessage',body='Hello support')
        self.action(self.agent,'chatMessage',body='Hello Alice')
        comments=self.detail(self.alice)['comments']
        self.assertEqual([c['channel'] for c in comments],['chat','chat'])
        with desk.connect(self.db) as db: self.assertEqual(db.execute('SELECT count(*) FROM desk_reply_outbox').fetchone()[0],before)
        with self.assertRaises(desk.DeskError): self.action(self.alice,'comment',body='Wrong composer')
        self.action(self.alice,'chatEnd')
        self.action(self.agent,'comment',body='Email follow-up')
        with desk.connect(self.db) as db:
            self.assertEqual(db.execute('SELECT recipient FROM desk_reply_outbox ORDER BY rowid DESC LIMIT 1').fetchone()[0],'alice@example.test')

    def test_simultaneous_agent_accepts_connect_only_one_agent(self):
        from concurrent.futures import ThreadPoolExecutor
        self.action(self.alice,'chatRequest')
        for me in (self.agent,self.agent2): self.action(me,'chatPresence',available=True)
        def accept(me):
            try:
                self.action(me,'chatAccept')
                return True
            except desk.DeskError:
                return False
        with ThreadPoolExecutor(max_workers=2) as pool:
            self.assertEqual(sorted(pool.map(accept,(self.agent,self.agent2))),[False,True])
        self.assertEqual(self.detail(self.alice)['chat']['state'],'live')

    def test_other_customer_and_unassigned_staff_cannot_send_chat(self):
        self.connect()
        for me in (self.bob,self.agent2):
            with self.assertRaises(desk.DeskError): self.action(me,'chatMessage',body='Not allowed')
        with self.assertRaises(desk.DeskError): self.detail(self.bob)
        self.action(self.agent,'comment',body='Private note',visibility='internal')
        self.assertFalse(self.detail(self.alice)['comments'])

    def test_offline_agent_requeues_and_off_hours_end_sessions(self):
        self.connect(); original=self.clock.return_value
        self.clock.return_value=original+chat.AGENT_TTL+1
        self.assertEqual(self.detail(self.alice)['chat']['state'],'queued')
        self.clock.return_value=dt.datetime(2026,10,25,2,tzinfo=dt.timezone.utc).timestamp()
        self.assertEqual(self.detail(self.alice)['chat']['state'],'ended')
        with self.assertRaises(desk.DeskError): self.action(self.alice,'chatRequest')

    def message(self,sender='alice@example.test',body='My email reply',tid=None,mid='<reply-1@example.test>',authenticated=True,sent=False,ref=None):
        with desk.connect(self.db) as db: destination=replies.reply_address(db,tid or self.t['id'],self.config)
        m=EmailMessage();m['From']=sender;m['To']=destination;m['Subject']='Re: support';m['Message-ID']=mid
        if ref: m['In-Reply-To']=ref
        if authenticated: m['Authentication-Results']='mx.google.com; dmarc=pass header.from='+sender.split('@')[1]
        m.set_content(body)
        return dict(id=mid,raw=base64.urlsafe_b64encode(m.as_bytes()).decode(),labelIds=['SENT'] if sent else ['INBOX'])

    def ingest(self,data):
        with desk.connect(self.db) as db:
            db.execute('BEGIN IMMEDIATE')
            return replies.import_message(db,data,self.config)

    def test_email_reply_logs_once_and_forwards_to_support(self):
        data=self.message(body='More information\n\nOn Monday Alice wrote:\nold quoted email')
        self.assertEqual(self.ingest(data),'logged');self.assertEqual(self.ingest(data),'duplicate')
        comment=self.detail(self.alice)['comments'][0]
        self.assertEqual(comment['channel'],'email');self.assertEqual(comment['body'],'More information')
        with desk.connect(self.db) as db:
            self.assertEqual(db.execute('SELECT recipient FROM desk_reply_outbox ORDER BY rowid DESC LIMIT 1').fetchone()[0],'support@example.test')

    def test_staff_email_and_support_sent_mail_log_and_customer_gets_reply(self):
        self.assertEqual(self.ingest(self.message(sender='agent@example.test')),'logged')
        with desk.connect(self.db) as db:
            self.assertEqual(db.execute('SELECT recipient FROM desk_reply_outbox ORDER BY rowid DESC LIMIT 1').fetchone()[0],'alice@example.test')
        self.assertEqual(self.ingest(self.message(sender='support@example.test',authenticated=False,sent=True,mid='<supportsent@example.test>')),'logged')
        self.assertEqual(len(self.detail(self.alice)['comments']),2)

    def test_wrong_sender_spoof_and_automatic_mail_never_log(self):
        self.assertEqual(self.ingest(self.message(sender='bob@example.test')),'sender_not_participant')
        self.assertEqual(self.ingest(self.message(authenticated=False,mid='<spoof@example.test>')),'sender_not_authenticated')
        data=self.message(mid='<auto@example.test>');raw=base64.urlsafe_b64decode(data['raw']);data['raw']=base64.urlsafe_b64encode(b'Auto-Submitted: auto-generated\n'+raw).decode()
        self.assertEqual(self.ingest(data),'automatic')
        self.assertEqual(self.detail(self.alice)['comments'],[])

    def test_subject_number_alone_is_not_enough_and_old_notification_reference_works(self):
        data=self.message(mid='<subject@example.test>');m=EmailMessage();m['From']='alice@example.test';m['To']='support@example.test';m['Subject']='Re: [Ecco Desk #1]';m['Authentication-Results']='mx.google.com; dmarc=pass header.from=example.test';m.set_content('Guessing a ticket number')
        data['raw']=base64.urlsafe_b64encode(m.as_bytes()).decode()
        self.assertEqual(self.ingest(data),'unmatched_or_ambiguous_thread')
        with desk.connect(self.db) as db: ref=db.execute('SELECT messageId FROM desk_mail_outbox').fetchone()[0]
        m['In-Reply-To']=ref;data.update(id='legacy-ref',raw=base64.urlsafe_b64encode(m.as_bytes()).decode())
        self.assertEqual(self.ingest(data),'logged')

    def test_reply_delivery_retries_without_duplicate_after_success(self):
        with patch.object(mail,'send',side_effect=OSError('network')):
            self.assertTrue(replies.deliver_one(self.db,self.config))
        with desk.connect(self.db) as db:
            r=dict(db.execute('SELECT * FROM desk_reply_outbox').fetchone());self.assertEqual(r['attempts'],1);self.assertIsNone(r['sentAt'])
            db.execute('UPDATE desk_reply_outbox SET availableAt=0')
        with patch.object(mail,'send') as send:
            self.assertTrue(replies.deliver_one(self.db,self.config));self.assertFalse(replies.deliver_one(self.db,self.config));send.assert_called_once()
            self.assertIn('+desk-',str(send.call_args.args[0]['Reply-To']))
