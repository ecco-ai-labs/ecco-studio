"""Read-only Google group membership for notification administration only.

An owner-protected setup endpoint starts OAuth for a privately pinned group and
Google subject. Membership never creates a persistent Desk staff/admin grant.
"""
import html
import json
import os
from pathlib import Path
import re
import secrets
import tempfile
import threading
import time
from urllib.parse import parse_qs, urlsplit

import google_signin
import youtube_connection as oauth

CONFIG_FILE = Path('/workspace/ecco-storage-private/desk-notification-group.json')
TOKEN_FILE = Path('/workspace/ecco-storage-private/desk-notification-group-token.json')
SCOPES = ('openid', 'https://www.googleapis.com/auth/userinfo.email',
          'https://www.googleapis.com/auth/admin.directory.group.member.readonly')
PREFIX = 'desk-notification-group-'
TTL = 60
_pending = {}
_cache = {}
_lock = threading.RLock()


class AuthorizationError(ValueError):
    """Safe, application-authored setup error suitable for the callback page."""


def config():
    try:
        if CONFIG_FILE.stat().st_mode & 0o077:
            return None
        value = json.loads(CONFIG_FILE.read_text())
        if (not re.fullmatch(r'[A-Za-z0-9_-]{1,100}', value['groupId'])
                or not re.fullmatch(r'[^\s@]+@[^\s@]+', value['groupEmail'])
                or not re.fullmatch(r'google:[0-9]{1,128}', value['ownerId'])
                or not re.fullmatch(r'[^\s@]+@[^\s@]+', value['ownerEmail'])):
            return None
        return {key: value[key] for key in ('groupId','groupEmail','ownerId','ownerEmail')}
    except (OSError, ValueError, KeyError, TypeError):
        return None


def _saved(settings):
    try:
        if TOKEN_FILE.stat().st_mode & 0o077:
            return None
        value = json.loads(oauth._cipher().decrypt(json.loads(TOKEN_FILE.read_text())['encrypted'].encode()))
        credentials = value['credentials']
        if (value['config'] != settings or credentials.get('client_id') != google_signin.CLIENT_ID
                or credentials.get('token_uri') != 'https://oauth2.googleapis.com/token'
                or not credentials.get('refresh_token') or not set(SCOPES) <= set(credentials.get('scopes', []))):
            return None
        return credentials
    except Exception:
        return None


def _save(credentials, settings):
    TOKEN_FILE.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    encrypted = oauth._cipher(create=True).encrypt(json.dumps({'config': settings,
        'credentials': json.loads(credentials.to_json())}).encode()).decode()
    fd, temporary = tempfile.mkstemp(dir=TOKEN_FILE.parent, prefix='.desk-group-')
    try:
        with os.fdopen(fd, 'w') as output:
            json.dump({'encrypted': encrypted}, output); output.flush(); os.fsync(output.fileno())
        os.replace(temporary, TOKEN_FILE)
    finally:
        if os.path.exists(temporary): os.unlink(temporary)
    with _lock:
        _cache.clear()


def _build(credentials):
    import httplib2
    import google_auth_httplib2
    _, _, build = oauth._dependencies()
    authorized = google_auth_httplib2.AuthorizedHttp(credentials, http=httplib2.Http(timeout=8))
    return build('admin', 'directory_v1', http=authorized, cache_discovery=False)


def _member(credentials, settings, subject):
    record = _build(credentials).members().get(groupKey=settings['groupId'], memberKey=subject).execute()
    # Bind the result to the verified Google subject, never an email/domain match.
    return (record.get('id') == subject and record.get('type') == 'USER'
            and record.get('status') == 'ACTIVE' and record.get('role') in ('OWNER','MANAGER','MEMBER'))


def access(user, fresh=False):
    settings = config()
    result = {'canManageNotifications': False}
    if not settings:
        return result
    result['notificationAdminGroup'] = settings['groupEmail']
    credentials = _saved(settings)
    if not credentials:
        return {**result, 'notificationGroupStatus': 'not_connected'}
    uid = user.get('id', '')
    if not isinstance(uid, str) or not re.fullmatch(r'google:[0-9]{1,128}', uid):
        return result
    key = (settings['groupId'], uid)
    with _lock:
        cached = _cache.get(key)
        if not fresh and cached and time.monotonic() < cached[0]:
            return {**result, **cached[1]}
    try:
        _, Credentials, _ = oauth._dependencies()
        allowed = _member(Credentials.from_authorized_user_info(credentials, SCOPES), settings, uid[7:])
        grant = {'canManageNotifications': allowed, 'notificationGroupStatus': 'connected'}
    except Exception as exc:
        code = getattr(getattr(exc, 'resp', None), 'status', None)
        # A missing membership denies access; provider failure also denies access.
        grant = {'canManageNotifications': False,
                 'notificationGroupStatus': 'connected' if code == 404 else 'unavailable'}
    with _lock:
        if len(_cache) >= 2000: _cache.clear()
        _cache[key] = (time.monotonic() + TTL, grant)
    return {**result, **grant}


def start():
    settings = config()
    if not settings:
        raise ValueError('Configure the approved notification administrator group on the service first.')
    Flow, _, _ = oauth._dependencies()
    state = PREFIX + secrets.token_urlsafe(32)
    flow = Flow.from_client_config(oauth._config(), scopes=SCOPES, redirect_uri=oauth.CALLBACK,
                                  autogenerate_code_verifier=True)
    url, _ = flow.authorization_url(state=state, access_type='offline', prompt='consent',
        login_hint=settings['ownerEmail'], include_granted_scopes='false')
    with _lock:
        for key in list(_pending):
            if time.monotonic() - _pending[key][0] >= 600: del _pending[key]
        if len(_pending) >= 5: raise ValueError('An authorization is already pending. Try again later.')
        _pending[state] = (time.monotonic(), flow, settings)
    return {'url': url}


def _owner(credentials, settings):
    from google.auth.transport.requests import Request
    from google.oauth2.id_token import verify_oauth2_token
    claims = verify_oauth2_token(credentials.id_token, Request(), google_signin.CLIENT_ID)
    return (claims.get('iss') in ('accounts.google.com','https://accounts.google.com')
            and 'google:' + str(claims.get('sub', '')) == settings['ownerId']
            and claims.get('email_verified') is True)


def _denied_message(exc):
    # Use only known reason identifiers; provider messages/URLs can contain secrets.
    reasons = set()
    try:
        error = json.loads(exc.content).get('error', {})
        for item in error.get('errors', []) + error.get('details', []):
            reason = item.get('reason')
            if isinstance(reason, str): reasons.add(reason)
    except (AttributeError, ValueError, TypeError):
        pass
    if reasons & {'accessNotConfigured', 'SERVICE_DISABLED'}:
        return ('Admin SDK API is disabled for the Studio Google Cloud project. '
                'Enable Admin SDK API in that project, then reconnect the administrator group.')
    if reasons & {'insufficientPermissions', 'ACCESS_TOKEN_SCOPE_INSUFFICIENT'}:
        return ('Google did not grant the required group-membership scope. '
                'Reconnect and allow read-only group membership access.')
    return ('Google denied the approved account access to group membership. '
            'A Google Workspace administrator must check Directory API privileges and app-access policy.')


def finish(query):
    states = query.get('state', [])
    with _lock:
        pending = _pending.pop(states[0], None) if len(states) == 1 else None
    if not pending or time.monotonic() - pending[0] >= 600:
        raise AuthorizationError('Group authorization expired. Start the connection again.')
    _, flow, settings = pending
    if settings != config():
        raise AuthorizationError('The group configuration changed. Start the connection again.')
    if 'error' in query:
        raise AuthorizationError('Group authorization was cancelled. No permissions changed.')
    codes = query.get('code', [])
    if len(codes) != 1 or not isinstance(codes[0], str) or not 1 <= len(codes[0]) <= 8192:
        raise AuthorizationError('Google did not return a valid authorization.')
    try:
        flow.fetch_token(code=codes[0], timeout=20)
        credentials = flow.credentials
        if (not credentials.has_scopes(SCOPES) or not credentials.refresh_token
                or credentials.granted_scopes is not None and not set(SCOPES) <= set(credentials.granted_scopes)):
            raise AuthorizationError('Allow read-only group membership access to connect the group.')
        if not _owner(credentials, settings):
            raise AuthorizationError('Use the approved group owner account to connect the group.')
        if not _member(credentials, settings, settings['ownerId'][7:]):
            raise AuthorizationError('The approved owner must be an active direct member of the group.')
        _save(credentials, settings)
        return settings['groupEmail']
    except AuthorizationError:
        raise
    except Exception as exc:
        code = getattr(getattr(exc, 'resp', None), 'status', None)
        if code == 403:
            raise AuthorizationError(_denied_message(exc)) from None
        raise AuthorizationError('Could not verify the Google group connection. No permissions changed.') from None


def callback(handler):
    try:
        group = finish(parse_qs(urlsplit(handler.path).query, max_num_fields=20))
        message = group + ' is connected. Active members can now create, publish and withdraw user notifications.'
        code = 200
    except ValueError as exc:
        message = str(exc); code = 400
    handler.send(('<!doctype html><html lang="en"><meta charset="utf-8"><title>Ecco notification administrators</title>'
        '<h1>Notification administrator group</h1><p>' + html.escape(message) + '</p>'
        '<a href="https://ecco-ai-labs.github.io/ecco-studio/desk/">Return to Ecco Desk</a></html>').encode(),
        code, mime='text/html; charset=utf-8')
