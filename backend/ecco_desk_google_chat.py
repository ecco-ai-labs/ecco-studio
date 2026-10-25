"""Native Google Chat cards. Disabled until the owner configures an interactive app.

The existing incoming webhook sends notifications; it cannot authenticate staff
clicks. This endpoint verifies Google's app token, allowed space, and exact Google
user membership before running the same ownership checks as Ecco Desk.
"""
import hashlib
import html
import json
import os
from pathlib import Path
import re
import time
import uuid

ENDPOINT='https://vowmjru85f2gzo-8888.proxy.runpod.net/api/desk/google-chat'


def initialize(db):
    db.executescript('''
    CREATE TABLE IF NOT EXISTS desk_native_chat_threads(ticketId INTEGER PRIMARY KEY,space TEXT NOT NULL,thread TEXT NOT NULL UNIQUE);
    CREATE TABLE IF NOT EXISTS desk_native_chat_actions(nonce TEXT PRIMARY KEY,ticketId INTEGER NOT NULL,op TEXT NOT NULL,version INTEGER NOT NULL,expires REAL NOT NULL);
    CREATE TABLE IF NOT EXISTS desk_native_chat_receipts(eventId TEXT PRIMARY KEY,response TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS desk_native_chat_presence(userId TEXT PRIMARY KEY,expires REAL NOT NULL);
    CREATE TABLE IF NOT EXISTS desk_native_chat_outbox(id TEXT PRIMARY KEY,thread TEXT NOT NULL,body TEXT NOT NULL,sent INTEGER NOT NULL DEFAULT 0,attempts INTEGER NOT NULL DEFAULT 0,availableAt REAL NOT NULL DEFAULT 0);
    ''')


def settings():
    p=Path(os.getenv('ECCO_DESK_NATIVE_CHAT_CONFIG','/workspace/ecco-storage-private/desk-native-chat.json'))
    if not p.exists(): return None
    if p.stat().st_mode & 0o077: raise ValueError('Native Chat configuration must be private.')
    c=json.loads(p.read_text())
    if c.get('enabled') is not True: return None
    if not re.fullmatch(r'spaces/[A-Za-z0-9_-]+',c.get('space','')): raise ValueError('Choose the approved support space.')
    if not re.fullmatch(r'(chat@system\.gserviceaccount\.com|service-[0-9]+@gcp-sa-gsuiteaddons\.iam\.gserviceaccount\.com)',c.get('serviceAccount','')): raise ValueError('Choose the Chat app service account.')
    return c


def verify(authorization, config):
    import google.auth.transport.requests
    from google.oauth2 import id_token
    import requests,cachecontrol
    if not authorization.startswith('Bearer ') or len(authorization)>20000: raise ValueError('Missing app identity')
    request=google.auth.transport.requests.Request(session=cachecontrol.CacheControl(requests.Session()))
    claims=id_token.verify_oauth2_token(authorization[7:],lambda *a,**k:request(*a,**{**k,'timeout':10}),ENDPOINT)
    if claims.get('email')!=config['serviceAccount'] or claims.get('email_verified') is not True: raise ValueError('Wrong app identity')


def agent(db,event,config):
    import ecco_desk as desk
    if event.get('space',{}).get('name')!=config['space']: raise desk.DeskError('This space is not configured for support.',403)
    user=event.get('user',{})
    if user.get('type')!='HUMAN' or not re.fullmatch(r'users/[0-9]+',user.get('name','')): raise desk.DeskError('A verified support agent is required.',403)
    row=db.execute('SELECT userId,name,email,role,id AS memberId FROM desk_members WHERE userId=? AND active=1',('google:'+user['name'].split('/')[1],)).fetchone()
    if not row: raise desk.DeskError('Your Google account is not an active support agent.',403)
    return dict(row)


def touch(db,me):
    db.execute('INSERT INTO desk_native_chat_presence VALUES (?,?) ON CONFLICT(userId) DO UPDATE SET expires=excluded.expires',(me['userId'],time.time()+900))


def button(db,t,label,op):
    nonce=uuid.uuid4().hex
    db.execute('INSERT INTO desk_native_chat_actions VALUES (?,?,?,?,?)',(nonce,t['id'],op,t['version'],time.time()+86400))
    return {'text':label,'onClick':{'action':{'function':'deskAction','parameters':[{'key':'nonce','value':nonce}]}}}


def card(db,me,t):
    import ecco_desk as desk
    owner=db.execute('SELECT name FROM desk_members WHERE id=?',(t['assigneeId'],)).fetchone()
    own=t['assigneeId']==me['memberId'];closed=t['status'] in ('closed','resolved')
    widgets=[{'textParagraph':{'text':html.escape(t['description'][:3000])}}, {'textParagraph':{'text':'Status: '+t['status']+' · Owner: '+html.escape(owner[0] if owner else 'Awaiting acceptance')}}]
    buttons=[]
    if not t['assigneeId'] and not closed: buttons.append(button(db,t,'Accept case','claimTicket'))
    session=db.execute('SELECT state FROM desk_chat_sessions WHERE ticketId=?',(t['id'],)).fetchone()
    if session and session['state']=='queued' and (own or not t['assigneeId']): buttons.append(button(db,t,'Accept chat','chatAccept'))
    if own:
        buttons += [button(db,t,'Reopen' if closed else 'Resolve','reopen' if closed else 'resolve')]
        if not closed: buttons.append(button(db,t,'Close issue','close'))
        members=[dict(text=r['name']+' · '+r['email'],value=r['id'],selected=False) for r in db.execute('SELECT id,name,email FROM desk_members WHERE active=1 AND id<>?',(me['memberId'],))]
        if members:
            widgets += [{'selectionInput':{'name':'delegate','label':'Delegate to','type':'DROPDOWN','items':members}},{'buttonList':{'buttons':[button(db,t,'Delegate','delegate')]}}]
        widgets += [{'textInput':{'name':'reply','label':'Reply to this customer','type':'MULTIPLE_LINE'}},{'buttonList':{'buttons':[button(db,t,'Send reply','reply')]}}]
    if buttons: widgets.append({'buttonList':{'buttons':buttons}})
    widgets.append({'buttonList':{'buttons':[button(db,t,'Refresh','refresh')]}})
    widgets.append({'textParagraph':{'text':'Actions stay in Google Chat. Accepting chat marks you available. Native chat returns to the queue after 15 minutes without an agent interaction. Your case ownership remains until resolution or delegation.'}})
    return {'cardsV2':[{'cardId':'desk-'+str(t['id']),'card':{'header':{'title':f'SUP-{t["id"]:04d} · '+t['title']},'sections':[{'widgets':widgets}]}}]}


def queue_card(db,me):
    import ecco_desk_chat as chat
    chat.maintain(db)
    widgets=[]
    for r in db.execute("SELECT * FROM desk_tickets WHERE type='support' AND status NOT IN ('closed','resolved') ORDER BY createdAt,id LIMIT 40"):
        t=dict(r)
        widgets += [{'textParagraph':{'text':f'SUP-{t["id"]:04d} · '+html.escape(t['title'])}},{'buttonList':{'buttons':[button(db,t,'Open case','refresh')]}}]
    return {'cardsV2':[{'cardId':'desk-queue','card':{'header':{'title':'Ecco Desk support queue'},'sections':[{'widgets':widgets or [{'textParagraph':{'text':'No open support cases.'}}]}]}}]}


def process(db,event,config):
    import ecco_desk as desk
    import ecco_desk_chat as chat
    me=agent(db,event,config)
    key=hashlib.sha256(json.dumps(event,sort_keys=True,separators=(',',':')).encode()).hexdigest()
    cached=db.execute('SELECT response FROM desk_native_chat_receipts WHERE eventId=?',(key,)).fetchone()
    if cached:return json.loads(cached[0])
    kind=event.get('type')
    if kind=='CARD_CLICKED':
        parameters={p['key']:p['value'] for p in event.get('action',{}).get('parameters',[])}
        action=db.execute('SELECT * FROM desk_native_chat_actions WHERE nonce=? AND expires>?',(parameters.get('nonce'),time.time())).fetchone()
        if not action:raise desk.DeskError('This card expired. Ask Ecco Desk for the queue again.',409)
        t=desk.ticket(db,me,action['ticketId']);op=action['op']
        if op!='refresh' and action['version']!=t['version']:return card(db,me,t)|{'text':'The case changed. Review its current status before acting.'}
        inputs=event.get('common',{}).get('formInputs',{})
        value=lambda n:inputs.get(n,{}).get('stringInputs',{}).get('value',[''])[0]
        if op=='chatAccept':
            # A click is an explicit indication that this agent is available now.
            touch(db,me);chat.write(db,me,{'op':'chatPresence','available':True});desk.write(db,me,{'op':'chatAccept','id':t['id']},'','')
        elif op=='claimTicket':desk.claim_support(db,me,t)
        elif op in ('resolve','close','reopen','delegate'):
            desk.require_case_owner(me,t)
            body={'op':'updateTicket','id':t['id'],'version':t['version']}
            body.update({'assigneeId':value('delegate')} if op=='delegate' else {'status':{'resolve':'resolved','close':'closed','reopen':'open'}[op]})
            desk.write(db,me,body,'','')
        elif op=='reply':
            desk.require_case_owner(me,t);touch(db,me)
            live=db.execute("SELECT 1 FROM desk_chat_sessions WHERE ticketId=? AND state='live'",(t['id'],)).fetchone()
            desk.write(db,me,{'op':'chatMessage' if live else 'comment','id':t['id'],'body':value('reply')},'','')
        thread=event.get('message',{}).get('thread',{}).get('name','')
        if re.fullmatch(re.escape(config['space'])+r'/threads/[A-Za-z0-9_-]+',thread):
            existing=db.execute('SELECT ticketId FROM desk_native_chat_threads WHERE thread=?',(thread,)).fetchone()
            if existing and existing[0]!=t['id']:raise desk.DeskError('Use a separate Google Chat thread for each ticket.',409)
            db.execute('INSERT INTO desk_native_chat_threads VALUES (?,?,?) ON CONFLICT(ticketId) DO UPDATE SET space=excluded.space,thread=excluded.thread',(t['id'],config['space'],thread))
        result=card(db,me,desk.ticket(db,me,t['id']))
    elif kind in ('MESSAGE','ADDED_TO_SPACE'):
        thread=event.get('message',{}).get('thread',{}).get('name','')
        bound=db.execute('SELECT ticketId FROM desk_native_chat_threads WHERE thread=? AND space=?',(thread,config['space'])).fetchone()
        text=event.get('message',{}).get('argumentText',event.get('message',{}).get('text','')).strip()
        if kind=='MESSAGE' and bound and text and text.casefold() not in ('queue','/queue','help','/help'):
            t=desk.ticket(db,me,bound['ticketId']);desk.require_case_owner(me,t);touch(db,me)
            live=db.execute("SELECT 1 FROM desk_chat_sessions WHERE ticketId=? AND state='live'",(t['id'],)).fetchone()
            desk.write(db,me,{'op':'chatMessage' if live else 'comment','id':t['id'],'body':text},'','')
            result={'text':f'Reply saved to SUP-{t["id"]:04d}.'}
        else:result=queue_card(db,me)
    else:result={}
    db.execute('INSERT INTO desk_native_chat_receipts VALUES (?,?)',(key,json.dumps(result)))
    return result


def enqueue_customer_message(db,t,content):
    thread=db.execute('SELECT thread FROM desk_native_chat_threads WHERE ticketId=?',(t['id'],)).fetchone()
    if thread:db.execute('INSERT INTO desk_native_chat_outbox(id,thread,body) VALUES (?,?,?)',(uuid.uuid4().hex,thread[0],f'SUP-{t["id"]:04d} · {t["reporterName"]}:\n{content}'))


def deliver(path):
    import ecco_desk_chat as chat
    import ecco_desk_mail as mail
    from urllib.parse import urlsplit
    from urllib.request import Request,build_opener,HTTPRedirectHandler
    class NoRedirect(HTTPRedirectHandler):
        def redirect_request(self,*a,**k):return None
    config=settings();webhook=chat.alert_settings()
    if not config or not webhook:return False
    if urlsplit(webhook['webhook']).path!='/v1/'+config['space']+'/messages':raise ValueError('Native Chat must use its approved support space.')
    with mail.connect(path) as db:
        db.execute('BEGIN IMMEDIATE')
        row=db.execute('SELECT * FROM desk_native_chat_outbox WHERE sent=0 AND availableAt<=? ORDER BY rowid LIMIT 1',(time.time(),)).fetchone()
        if not row:return False
        row=dict(row);db.execute('UPDATE desk_native_chat_outbox SET attempts=attempts+1,availableAt=? WHERE id=?',(time.time()+60,row['id']))
    request=Request(webhook['webhook']+'&messageReplyOption=REPLY_MESSAGE_OR_FAIL',data=json.dumps({'text':row['body'],'thread':{'name':row['thread']}}).encode(),headers={'Content-Type':'application/json'})
    try:
        with build_opener(NoRedirect).open(request,timeout=20) as r:
            if not json.load(r).get('name'):raise ValueError('No delivery confirmation')
    except Exception:
        with mail.connect(path) as db:db.execute('UPDATE desk_native_chat_outbox SET availableAt=? WHERE id=?',(time.time()+min(600,30*2**min(row['attempts'],4)),row['id']))
    else:
        with mail.connect(path) as db:db.execute('UPDATE desk_native_chat_outbox SET sent=1 WHERE id=?',(row['id'],))
    return True


def handle(handler,path,database):
    if path!='/api/desk/google-chat':return False
    import ecco_desk as desk
    try:
        config=settings()
        if not config:raise desk.DeskError('Native Google Chat is not configured.',503)
        try:verify(handler.headers.get('Authorization',''),config)
        except Exception:raise desk.DeskError('Google Chat authentication required.',401) from None
        length=int(handler.headers.get('Content-Length','0'))
        if handler.command!='POST' or not 0<length<=100000 or handler.headers.get('Content-Type','').split(';')[0]!='application/json':raise desk.DeskError('Invalid Chat request.',400)
        event=json.loads(handler.rfile.read(length))
        with desk.connect(database) as db:
            db.execute('BEGIN IMMEDIATE');result=process(db,event,config)
        handler.send(result)
    except desk.DeskError as exc:handler.send({'text':str(exc)},exc.status)
    except Exception:handler.send({'text':'Support action could not be completed. No success was confirmed.'},503)
    return True
