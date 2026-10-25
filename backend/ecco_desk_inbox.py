"""Read-only Gmail reply synchronization for the explicitly connected support mailbox."""
import base64
import html
import json
import os
from pathlib import Path
import secrets
import tempfile
import threading
import time
from urllib.parse import parse_qs,urlsplit

import ecco_desk_mail as mail
import ecco_desk_replies as replies
import youtube_connection as oauth

TOKEN_FILE=Path('/workspace/ecco-storage-private/desk-inbox.json')
SCOPES=('https://www.googleapis.com/auth/gmail.readonly',)
_pending={}
_lock=threading.RLock()
_sync_lock=threading.Lock()
_last_sync=0
_last_error=None
_last_connect_error=None


def _saved():
    try:
        if TOKEN_FILE.stat().st_mode & 0o077:
            return None
        data=json.loads(oauth._cipher().decrypt(json.loads(TOKEN_FILE.read_text())['encrypted'].encode()))
        config=mail.settings()
        if not config or data['mailbox'].casefold()!=config['recipient'].casefold():
            return None
        if not data['credentials'].get('refresh_token') or not set(SCOPES)<=set(data['credentials'].get('scopes',[])):
            return None
        return data
    except Exception:
        return None


def status():
    saved=_saved()
    return dict(connected=bool(saved),mailbox=saved['mailbox'] if saved else None,
                lastSync=_last_sync or None,error=_last_error or _last_connect_error)


def _save(credentials,mailbox):
    TOKEN_FILE.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
    fd,name=tempfile.mkstemp(dir=TOKEN_FILE.parent,prefix='.desk-inbox-')
    try:
        with os.fdopen(fd,'w') as output:
            encrypted=oauth._cipher(create=True).encrypt(json.dumps({'mailbox':mailbox,'credentials':json.loads(credentials.to_json())}).encode()).decode()
            json.dump({'encrypted':encrypted},output); output.flush(); os.fsync(output.fileno())
        os.replace(name,TOKEN_FILE)
    finally:
        if os.path.exists(name): os.unlink(name)


def start():
    config=mail.settings()
    if not config:
        raise ValueError('Configure support email before connecting the inbox.')
    Flow,_,_=oauth._dependencies()
    state='desk-inbox-'+secrets.token_urlsafe(32)
    flow=Flow.from_client_config(oauth._config(),scopes=SCOPES,redirect_uri=oauth.CALLBACK,
                                autogenerate_code_verifier=True)
    url,_=flow.authorization_url(state=state,access_type='offline',prompt='consent',
                                 login_hint=config['recipient'],include_granted_scopes='false')
    with _lock:
        for key in list(_pending):
            if time.monotonic()-_pending[key][0]>600: del _pending[key]
        if len(_pending)>=10: raise ValueError('Too many pending inbox connections. Try again shortly.')
        _pending[state]=(time.monotonic(),flow)
    return {'url':url}


def _build(credentials):
    import httplib2
    import google_auth_httplib2
    _,_,build=oauth._dependencies()
    authorized=google_auth_httplib2.AuthorizedHttp(credentials,http=httplib2.Http(timeout=20))
    return build('gmail','v1',http=authorized,cache_discovery=False)


def finish(query):
    global _last_connect_error
    state=query.get('state',[])
    with _lock:
        pending=_pending.pop(state[0],None) if len(state)==1 else None
    if not pending or time.monotonic()-pending[0]>=600:
        raise ValueError('Inbox authorization expired. Connect support email again.')
    if 'error' in query:
        raise ValueError('Inbox authorization was cancelled. No connection changed.')
    codes=query.get('code',[])
    if len(codes)!=1 or not codes[0] or len(codes[0])>8192:
        raise ValueError('Google did not return a valid inbox authorization.')
    stage='token exchange'
    try:
        flow=pending[1]; flow.fetch_token(code=codes[0],timeout=20); credentials=flow.credentials
        if not credentials.has_scopes(SCOPES) or not credentials.refresh_token:
            raise ValueError('Allow read-only Gmail access to log support replies.')
        stage='mailbox verification'
        profile=_build(credentials).users().getProfile(userId='me').execute()
        expected=mail.settings()['recipient']
        if profile['emailAddress'].casefold()!=expected.casefold():
            raise ValueError('Connect '+expected+'; other inboxes are not accepted.')
        stage='saving the connection'
        _save(credentials,expected)
        _last_connect_error=None
        return expected
    except ValueError:
        raise
    except Exception as exc:
        # Whitelist provider reasons, never print OAuth codes, tokens, URLs or
        # exception text. The previous generic error hid the failing setup step.
        status=getattr(getattr(exc,'resp',None),'status',None)
        reasons=set()
        try:
            error=json.loads(exc.content).get('error',{})
            reasons={d.get('reason') for d in error.get('errors',[])+error.get('details',[]) if isinstance(d,dict)}
        except (AttributeError,ValueError,TypeError): pass
        if reasons & {'accessNotConfigured','SERVICE_DISABLED','serviceDisabled'}:
            message='Enable Gmail API in the existing Ecco Google Cloud project, then reconnect support email.'
        elif reasons & {'insufficientPermissions','ACCESS_TOKEN_SCOPE_INSUFFICIENT'}:
            message='Google did not grant Gmail read access. Reconnect support email with the requested permission.'
        else:
            message=f'Could not connect support email during {stage} ({type(exc).__name__}'+(f', HTTP {status}' if type(status) is int else '')+').'
        _last_connect_error=message
        mail.LOG.warning('Ecco Desk inbox authorization: %s',message)
        raise ValueError(message) from None


def callback(handler):
    try:
        mailbox=finish(parse_qs(urlsplit(handler.path).query,max_num_fields=20))
        text='Support email connected: '+mailbox+'. Email replies will appear in Ecco Desk.'
        code=200
    except ValueError as exc:
        text=str(exc); code=400
    handler.send(('<!doctype html><html lang="en"><meta charset="utf-8"><title>Ecco Desk email</title>'
                  '<h1>Ecco Desk email</h1><p>'+html.escape(text)+'</p>'
                  '<a href="https://ecco-ai-labs.github.io/ecco-studio/desk/">Return to Ecco Desk</a></html>').encode(),code,
                 mime='text/html; charset=utf-8')


def sync(path):
    global _last_sync,_last_error
    if time.time()-_last_sync<25 or not _sync_lock.acquire(blocking=False):
        return
    try:
        saved=_saved()
        if not saved: return
        _,Credentials,_=oauth._dependencies()
        credentials=Credentials.from_authorized_user_info(saved['credentials'],SCOPES)
        client=_build(credentials)
        with mail.connect(path) as db:
            cursor=db.execute("SELECT value FROM desk_inbox_meta WHERE key='historyId'").fetchone()
        history=cursor[0] if cursor else None
        ids=[]; page=None; new_history=None
        if history:
            try:
                while True:
                    response=client.users().history().list(userId='me',startHistoryId=history,historyTypes=['messageAdded'],pageToken=page,maxResults=100).execute()
                    for change in response.get('history',[]):
                        ids.extend(m['message']['id'] for m in change.get('messagesAdded',[]))
                    new_history=response.get('historyId',new_history)
                    page=response.get('nextPageToken')
                    if not page: break
                    if len(ids)>5000: raise ValueError('Inbox backlog exceeds one sync batch')
            except Exception as exc:
                if getattr(getattr(exc,'resp',None),'status',None)!=404: raise
                history=None; ids=[]; page=None
        if not history:
            # Capture the baseline first; mail arriving during the scan is then
            # recovered by history on the next poll. Read-only: no labels change.
            new_history=client.users().getProfile(userId='me').execute()['historyId']
            while True:
                response=client.users().messages().list(userId='me',q='newer_than:7d',maxResults=100,pageToken=page).execute()
                ids.extend(m['id'] for m in response.get('messages',[]))
                page=response.get('nextPageToken')
                if not page: break
                if len(ids)>5000: raise ValueError('Inbox backlog exceeds one sync batch')
        config=mail.settings()
        for mid in dict.fromkeys(ids):
            with mail.connect(path) as db:
                seen=db.execute('SELECT 1 FROM desk_inbound_mail WHERE gmailId=?',(mid,)).fetchone()
            if seen: continue
            try:
                data=client.users().messages().get(userId='me',id=mid,format='raw').execute()
            except Exception as exc:
                if getattr(getattr(exc,'resp',None),'status',None)==404: continue
                raise
            if 'DRAFT' in data.get('labelIds',[]): continue
            with mail.connect(path) as db:
                db.execute('BEGIN IMMEDIATE')
                replies.import_message(db,data,config)
        with mail.connect(path) as db:
            db.execute("INSERT INTO desk_inbox_meta VALUES ('historyId',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",(new_history,))
        _save(credentials,saved['mailbox'])
        _last_error=None
    except Exception as exc:
        _last_error=type(exc).__name__
        mail.LOG.warning('Ecco Desk inbox sync deferred: %s',_last_error)
    finally:
        _last_sync=time.time()
        _sync_lock.release()
