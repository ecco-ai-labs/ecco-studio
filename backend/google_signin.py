"""Google identity sessions, deliberately NOT shared workspace authorization."""
import hashlib
import json
import os
import sqlite3
from pathlib import Path
import secrets
import threading
import time

CLIENT_ID = '219292517219-tngp5k9kso8jvk4ps6oqee45l0j97p78.apps.googleusercontent.com'
CHALLENGE_TTL = 300
SESSION_DB = Path(os.getenv("ECCO_SIGNIN_DB", "/workspace/ecco-storage-private/google-sessions.sqlite3"))
MAX_ENTRIES = 1000
_lock = threading.RLock()
_challenges = {}
_sessions = {}  # Legacy in-process sessions may be imported during a live upgrade.


def _database():
    SESSION_DB.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd = os.open(SESSION_DB, os.O_CREAT | os.O_RDWR, 0o600)
    os.close(fd)
    os.chmod(SESSION_DB, 0o600)
    db = sqlite3.connect(SESSION_DB, timeout=15)
    db.execute('CREATE TABLE IF NOT EXISTS sessions (digest TEXT PRIMARY KEY, user_json TEXT NOT NULL, created REAL NOT NULL)')
    return db



class AuthError(Exception):
    def __init__(self, message, status=401):
        super().__init__(message)
        self.status = status


def verifier(credential):
    from google.auth.transport.requests import Request
    from google.oauth2 import id_token
    import requests
    import cachecontrol
    # Respect Google's certificate-cache headers; bound network requests.
    if not hasattr(_local, 'request'):
        request = Request(session=cachecontrol.CacheControl(requests.Session()))
        _local.request = lambda *args, **kwargs: request(*args, **{**kwargs, 'timeout': 10})
    return id_token.verify_oauth2_token(credential, _local.request, CLIENT_ID)


_local = threading.local()


def ready():
    try:
        import google.auth.transport.requests
        import google.oauth2.id_token
        import cachecontrol
        return True
    except ImportError:
        return False


def _prune():
    now = time.time()
    for entries in (_challenges,):
        for key in list(entries):
            if entries[key]['expires'] <= now:
                del entries[key]


def challenge():
    with _lock:
        _prune()
        if len(_challenges) >= MAX_ENTRIES:
            raise AuthError('Sign-in is busy. Please try again shortly.', 429)
        secret = secrets.token_urlsafe(32)
        nonce = secrets.token_urlsafe(32)
        _challenges[secret] = {'nonce': nonce, 'expires': time.time() + CHALLENGE_TTL}
        return {'challenge': secret, 'nonce': nonce, 'client_id': CLIENT_ID}


def login(body):
    credential, secret = body.get('credential'), body.get('challenge')
    if not isinstance(credential, str) or not 1 <= len(credential) <= 16384 or not isinstance(secret, str):
        raise AuthError('Invalid sign-in request.', 400)
    with _lock:
        _prune()
        pending = _challenges.pop(secret, None)
    if not pending:
        raise AuthError('Sign-in expired. Please try again.')
    try:
        claims = verifier(credential)
        if (claims.get('aud') != CLIENT_ID or claims.get('iss') not in ('accounts.google.com', 'https://accounts.google.com')
                or float(claims.get('exp', 0)) <= time.time()
                or claims.get('nonce') != pending['nonce']
                or not isinstance(claims.get('sub'), str) or not claims['sub']):
            raise ValueError('Invalid claims')
    except Exception:
        raise AuthError('Google sign-in could not be verified. Please try again.') from None
    # Never grant membership or merge accounts based on email or domain.
    user = {'id': 'google:' + claims['sub'], 'name': str(claims.get('name', ''))[:200],
            'email': str(claims.get('email', ''))[:320]}
    token = secrets.token_urlsafe(32)
    with _lock, _database() as db:
        db.execute('INSERT INTO sessions VALUES (?, ?, ?)',
                   (hashlib.sha256(token.encode()).hexdigest(), json.dumps(user), time.time()))
    return {'user': user, 'session_token': token, 'expires_at': None, 'persistent': True}


def session(authorization, logout=False):
    if not isinstance(authorization, str) or not authorization.startswith('Bearer '):
        raise AuthError('Please sign in again.')
    token = authorization[7:]
    if not token or len(token) > 512:
        raise AuthError('Please sign in again.')
    key = hashlib.sha256(token.encode()).hexdigest()
    with _lock, _database() as db:
        row = db.execute('SELECT user_json FROM sessions WHERE digest=?', (key,)).fetchone()
        # Accept only a still-valid, previously verified legacy session.
        legacy = _sessions.pop(key, None)
        if not row and legacy and legacy.get('expires', 0) > time.time():
            row = (json.dumps(legacy['user']),)
            db.execute('INSERT INTO sessions VALUES (?, ?, ?)', (key, row[0], time.time()))
        if logout:
            db.execute('DELETE FROM sessions WHERE digest=?', (key,))
            return {'ok': True}
        if not row:
            raise AuthError('Please sign in again.')
        return {'user': json.loads(row[0]), 'expires_at': None, 'persistent': True}


def handle(handler, path, allowed_origin):
    if not path.startswith('/api/auth/'):
        return False
    try:
        # Browser-only JSON flow: exact Origin, no ambient cookies, nonce and
        # one-time challenge bind the credential to the initiating browser.
        if handler.headers.get('Origin') != allowed_origin:
            raise AuthError('Origin denied', 403)
        if not ready():
            raise AuthError('Google sign-in service is not enabled yet.', 503)
        if handler.command == 'GET' and path == '/api/auth/config':
            result = {'client_id': CLIENT_ID}
        elif handler.command == 'GET' and path == '/api/auth/me':
            result = session(handler.headers.get('Authorization', ''))
        elif handler.command == 'POST' and path in ('/api/auth/challenge', '/api/auth/google', '/api/auth/logout'):
            import json
            if handler.headers.get('Content-Type', '').split(';')[0] != 'application/json':
                raise AuthError('Expected JSON', 415)
            length = int(handler.headers.get('Content-Length', '0'))
            if not 0 < length <= 20000:
                raise AuthError('Invalid request size', 413)
            body = json.loads(handler.rfile.read(length))
            if not isinstance(body, dict):
                raise AuthError('Invalid request', 400)
            if path.endswith('/challenge'):
                result = challenge()
            elif path.endswith('/google'):
                result = login(body)
            else:
                result = session(handler.headers.get('Authorization', ''), logout=True)
        else:
            raise AuthError('Not found', 404)
        handler.send(result)
    except AuthError as error:
        handler.send({'error': str(error)}, error.status)
    except (ValueError, TypeError):
        handler.send({'error': 'Invalid request'}, 400)
    except Exception:
        handler.send({'error': 'Sign-in service unavailable'}, 503)
    return True
