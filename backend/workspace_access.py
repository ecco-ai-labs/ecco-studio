"""Server-only Google Group authorization. Missing configuration fails closed."""
import json
import os
from pathlib import Path
import threading
import time
from urllib.parse import quote

CONFIG = os.getenv('ECCO_GROUP_ACCESS_CONFIG', '')
SCOPE = 'https://www.googleapis.com/auth/admin.directory.group.member.readonly'
CACHE_SECONDS = 60
_cache = {}
_lock = threading.RLock()


class AccessError(Exception):
    def __init__(self, message, status=403):
        super().__init__(message)
        self.status = status


def configuration():
    try:
        if not CONFIG: raise ValueError()
        config = json.loads(Path(CONFIG).read_text())
        if config.get('enabled') is not True or not config.get('service_account_file') or not config.get('delegated_admin') or not config.get('group') or not config.get('domain'):
            raise ValueError()
        return config
    except (OSError, ValueError, TypeError, AttributeError):
        raise AccessError('Tester access is awaiting Google administrator setup.', 503) from None


def lookup(config, subject):
    from google.oauth2 import service_account
    from google.auth.transport.requests import AuthorizedSession
    credentials = service_account.Credentials.from_service_account_file(
        config['service_account_file'], scopes=[SCOPE]).with_subject(config['delegated_admin'])
    with AuthorizedSession(credentials) as client:
        response = client.get('https://admin.googleapis.com/admin/directory/v1/groups/'
                              + quote(config['group'], safe='') + '/hasMember/' + quote(subject, safe=''), timeout=10)
        response.raise_for_status()
        result = response.json()
        if type(result.get('isMember')) is not bool:
            raise ValueError('Invalid membership response')
        return result['isMember']


def authorize(identity):
    # These claims come exclusively from the verified server session, never headers/body.
    user = identity['user']
    if (identity.get('email_verified') is not True or not identity.get('hosted_domain')
            or not user.get('id', '').startswith('google:')):
        raise AccessError('This Google account does not have tester access.')
    config = configuration()  # Re-read: disabling access is immediate.
    if identity['hosted_domain'] != config['domain']:
        raise AccessError('This Google account does not have tester access.')
    subject = user['id'][7:]
    cache_key = (subject, json.dumps(config, sort_keys=True))
    with _lock:
        cached = _cache.get(cache_key)
        if cached and time.monotonic() < cached[1]:
            member = cached[0]
        else:
            try:
                member = lookup(config, subject)
            except Exception:
                _cache.pop(cache_key, None)
                raise AccessError('Group membership could not be verified. Please try again.', 503) from None
            if len(_cache) >= 1000:
                _cache.clear()
            _cache[cache_key] = (member, time.monotonic() + CACHE_SECONDS)
    if not member:
        raise AccessError('Your account is not a member of the Studio tester group.')
    return {'role': 'tester', 'storage': True, 'ai': True, 'gpu_power': False,
            'publishing': False, 'manage_keys': False}


# Explicit allowlist: new endpoints never silently become tester permissions.
READ = frozenset(('/api/workspace/access', '/api/state', '/api/ai/status',
                  '/api/gpu/status', '/api/audio/status'))
WRITE = frozenset(('/api/ai/enhance', '/api/ai/news/research', '/api/ai/news/storyboard',
                   '/api/stories/plan', '/api/stories', '/api/stories/archive', '/api/boards',
                   '/api/images/upload', '/api/audio/upload', '/api/audio/folders', '/api/audio/labels',
                   '/api/library/folders', '/api/library/save', '/api/library/rename',
                   '/api/trash', '/api/trash/board', '/api/trash/folder', '/api/trash/draft',
                   '/api/trash/restore-draft', '/api/characters', '/api/object-edits',
                   '/api/approve', '/api/director/update', '/api/audio/generate',
                   '/api/gpu/request', '/api/longcat/generate', '/api/longcat/sequence', '/api/longcat/control'))


def allowed(method, path):
    if method == 'GET':
        return path in READ or path.startswith(('/api/media/', '/api/audio/jobs/', '/api/gpu/requests/'))
    return method == 'POST' and path in WRITE
