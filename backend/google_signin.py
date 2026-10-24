"""Google identity sessions, deliberately NOT shared workspace authorization."""
import hashlib
import secrets
import threading
import time

CLIENT_ID = '219292517219-tngp5k9kso8jvk4ps6oqee45l0j97p78.apps.googleusercontent.com'
CHALLENGE_TTL = 300
SESSION_TTL = 3600
MAX_ENTRIES = 1000
_lock = threading.RLock()
_challenges = {}
_sessions = {}


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
    for entries in (_challenges, _sessions):
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
    expires = min(time.time() + SESSION_TTL, float(claims['exp']))
    with _lock:
        _prune()
        if len(_sessions) >= MAX_ENTRIES:
            raise AuthError('Sign-in is busy. Please try again shortly.', 429)
        _sessions[hashlib.sha256(token.encode()).hexdigest()] = {'user': user, 'expires': expires, 'email_verified': claims.get('email_verified') is True, 'hosted_domain': claims.get('hd')}
    return {'user': user, 'session_token': token, 'expires_at': expires}


def session(authorization, logout=False, include_claims=False):
    token = authorization.removeprefix('Bearer ')
    key = hashlib.sha256(token.encode()).hexdigest()
    with _lock:
        _prune()
        value = _sessions.pop(key, None) if logout else _sessions.get(key)
    if not value:
        raise AuthError('Please sign in again.')
    if logout: return {'ok': True}
    result = {'user': value['user'], 'expires_at': value['expires']}
    if include_claims:
        result.update(email_verified=value.get('email_verified', False), hosted_domain=value.get('hosted_domain'))
    return result


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
