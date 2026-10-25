"""Native actions keep Google identity, ownership and ticket threads separate."""
from unittest.mock import patch
import json
import unittest
import ecco_desk as desk
import ecco_desk_google_chat as native
import test_ecco_desk_conversations as fixture

class NativeChat(unittest.TestCase):
    create=fixture.Conversations.create
    action=fixture.Conversations.action
    detail=fixture.Conversations.detail
    def setUp(self):
        fixture.Conversations.setUp(self)
        self.config={'enabled':True,'space':'spaces/SUPPORT','serviceAccount':'chat@system.gserviceaccount.com'}
        # Real Chat names map to the same Google subject used by Ecco sign-in.
        with desk.connect(self.db) as db:
            for n,me in enumerate((self.agent,self.agent2),1):
                db.execute('INSERT INTO desk_users VALUES (?,?,?)',(f'google:{n}',me['name'],me['email']))
                db.execute('UPDATE desk_members SET userId=? WHERE id=?',(f'google:{n}',me['memberId']))
                me['userId']=f'google:{n}'
    def event(self,nonce=None,who=1,**extra):
        return {'type':'CARD_CLICKED' if nonce else 'MESSAGE','user':{'name':f'users/{who}','type':'HUMAN'},'space':{'name':'spaces/SUPPORT'},'message':{'thread':{'name':'spaces/SUPPORT/threads/T1'}},'action':{'parameters':[{'key':'nonce','value':nonce}]},**extra}
    def execute(self,event):
        with desk.connect(self.db) as db:
            db.execute('BEGIN IMMEDIATE');return native.process(db,event,self.config)
    def nonce(self,op):
        with desk.connect(self.db) as db:
            t=desk.ticket(db,self.agent,self.t['id'])
            return native.button(db,t,op,op)['onClick']['action']['parameters'][0]['value']
    def test_native_claim_reply_deduplicates_and_blocks_other_agent(self):
        event=self.event(self.nonce('claimTicket'));self.execute(event);self.execute(event)
        event=self.event(self.nonce('reply'),common={'formInputs':{'reply':{'stringInputs':{'value':['Native response']}}}})
        self.execute(event);self.execute(event)
        self.assertEqual([c['body'] for c in self.detail(self.alice)['comments']],['Native response'])
        with self.assertRaises(desk.DeskError):self.execute(self.event(self.nonce('reply'),who=2,common={'formInputs':{'reply':{'stringInputs':{'value':['Wrong owner']}}}}))
    def test_native_identity_space_and_nonce_are_required(self):
        for event in [self.event(who=9),self.event(space={'name':'spaces/OTHER'}),self.event('forged')]:
            with self.assertRaises(desk.DeskError):self.execute(event)
    def test_native_accept_chat_and_customer_reply_stays_on_thread(self):
        self.action(self.alice,'chatRequest');self.execute(self.event(self.nonce('chatAccept')))
        self.clock.return_value+=80
        self.assertEqual(self.detail(self.alice)['chat']['state'],'live')
        self.action(self.alice,'chatMessage',body='Customer in Studio')
        with desk.connect(self.db) as db:
            row=db.execute('SELECT thread,body FROM desk_native_chat_outbox').fetchone()
            self.assertEqual(row['thread'],'spaces/SUPPORT/threads/T1');self.assertIn('Customer in Studio',row['body'])
    def test_native_google_token_rejected_without_valid_authorization(self):
        with self.assertRaises(ValueError):native.verify('',self.config)

if __name__=='__main__':unittest.main()
