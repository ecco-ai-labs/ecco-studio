"""Owner-authorized YouTube OAuth on the CPU service; no browser-side secrets."""
import html
import json
import os
from pathlib import Path
import tempfile
import threading
import time
from urllib.parse import parse_qs, urlsplit

import google_signin
import studio as legacy

PRIVATE = Path('/workspace/ecco-storage-private')
CLIENT_FILE = Path(os.getenv('YOUTUBE_CLIENT_SECRET_FILE', str(PRIVATE / 'youtube-client.json')))
TOKEN_FILE = Path(os.getenv('ECCO_YOUTUBE_TOKEN_FILE', str(PRIVATE / 'youtube-connection.json')))
CALLBACK = os.getenv('ECCO_YOUTUBE_REDIRECT_URI',
                    'https://vowmjru85f2gzo-8888.proxy.runpod.net/api/youtube/callback')
STUDIO_URL = 'https://ecco-ai-labs.github.io/ecco-studio/'
SCOPES = ('https://www.googleapis.com/auth/youtube.readonly',
          'https://www.googleapis.com/auth/youtube.upload')
TTL = 600
MAX_PENDING = 100
_pending = {}
_lock = threading.RLock()


def _config():
    try:
        config = json.loads(CLIENT_FILE.read_text())
        web = config['web']
        if web['client_id'] != google_signin.CLIENT_ID or not web['client_secret']:
            raise ValueError()
        if (web['auth_uri'] != 'https://accounts.google.com/o/oauth2/auth'
                or web['token_uri'] != 'https://oauth2.googleapis.com/token'):
            raise ValueError()
        parsed = urlsplit(CALLBACK)
        if (parsed.scheme != 'https' or not parsed.hostname or parsed.username
                or parsed.password or parsed.query or parsed.fragment
                or parsed.path != '/api/youtube/callback'
                or CALLBACK not in web.get('redirect_uris', [])):
            raise ValueError()
        return config
    except (OSError, ValueError, KeyError, TypeError):
        raise legacy.Problem('Configure the Google OAuth client and YouTube callback on the storage backend.', 503) from None


def _dependencies():
    from google_auth_oauthlib.flow import Flow
    from google.oauth2.credentials import Credentials
    from googleapiclient.discovery import build
    return Flow, Credentials, build


def _saved():
    try:
        data = json.loads(TOKEN_FILE.read_text())
        if (data['channel']['handle'] != '@EccoAILabs'
                or not data['channel']['id'] or not data['channel']['title']
                or data['credentials']['client_id'] != google_signin.CLIENT_ID
                or not data['credentials']['refresh_token']
                or not set(SCOPES).issubset(data['credentials']['scopes'])):
            return None
        return data
    except (OSError, ValueError, KeyError, TypeError):
        return None


def status():
    try:
        _config()
        _dependencies()
        configured = True
    except (legacy.Problem, ImportError):
        configured = False
    saved = _saved() if configured else None
    channel = {k: saved['channel'][k] for k in ('id', 'title', 'handle')} if saved else None
    return {'youtube_configured': configured, 'youtube_channel': channel}


def _save(credentials, channel):
    # One atomic private file: never advertise a channel before its token is durable.
    TOKEN_FILE.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(prefix='.youtube-', dir=TOKEN_FILE.parent)
    try:
        with os.fdopen(fd, 'w') as output:
            json.dump({'credentials': json.loads(credentials.to_json()), 'channel': channel}, output)
            output.flush()
            os.fsync(output.fileno())
        os.replace(name, TOKEN_FILE)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def start():
    config = _config()
    try:
        Flow, _, _ = _dependencies()
    except ImportError:
        raise legacy.Problem('Install the YouTube OAuth dependencies on the storage backend.', 503) from None
    with _lock:
        now = time.monotonic()
        for state in list(_pending):
            if now - _pending[state][0] >= TTL:
                del _pending[state]
        if len(_pending) >= MAX_PENDING:
            raise legacy.Problem('Too many pending connections. Please try again shortly.', 429)
        flow = Flow.from_client_config(config, scopes=SCOPES, redirect_uri=CALLBACK,
                                       autogenerate_code_verifier=True)
        url, state = flow.authorization_url(access_type='offline', prompt='consent')
        _pending[state] = (now, flow)
    return {'url': url}


def finish(query):
    # State is issued only after workspace-owner authentication. It is single-use,
    # short-lived, unlogged, and paired with a server-held PKCE verifier.
    state = query.get('state', [])
    if len(state) != 1 or not state[0] or len(state[0]) > 512:
        raise legacy.Problem('YouTube authorization expired. Start Connect YouTube again.', 403)
    with _lock:
        pending = _pending.pop(state[0], None)
    if not pending or time.monotonic() - pending[0] >= TTL:
        raise legacy.Problem('YouTube authorization expired. Start Connect YouTube again.', 403)
    if 'error' in query:
        raise legacy.Problem('YouTube authorization was cancelled. No connection was changed.')
    codes = query.get('code', [])
    if len(codes) != 1 or not codes[0] or len(codes[0]) > 8192:
        raise legacy.Problem('Google did not return a valid authorization code.')
    flow = pending[1]
    try:
        flow.fetch_token(code=codes[0], timeout=20)
        credentials = flow.credentials
        granted = credentials.granted_scopes
        if (not credentials.has_scopes(SCOPES) or not credentials.refresh_token
                or (granted is not None and not set(SCOPES).issubset(granted))):
            raise legacy.Problem('Allow both YouTube permissions to finish connecting the channel.')
        channel = legacy.verify_channel(_build(credentials))
        with _lock:
            _save(credentials, channel)
        return channel
    except legacy.Problem:
        raise
    except Exception:
        # OAuth/provider exceptions can contain codes, tokens or client secrets.
        raise legacy.Problem('YouTube could not verify the channel. Check the YouTube Data API and OAuth configuration, then reconnect.', 502) from None


def _build(credentials):
    import httplib2
    import google_auth_httplib2
    _, _, build = _dependencies()
    http = google_auth_httplib2.AuthorizedHttp(credentials, http=httplib2.Http(timeout=20))
    return build('youtube', 'v3', http=http, cache_discovery=False)


def client():
    with _lock:
        saved = _saved()
        if not saved:
            raise legacy.Problem('Connect the YouTube channel first.', 409)
        _, Credentials, _ = _dependencies()
        credentials = Credentials.from_authorized_user_info(saved['credentials'], scopes=SCOPES)
        if not credentials.valid:
            try:
                from google.auth.transport.requests import Request
                request = Request()
                credentials.refresh(lambda *args, **kwargs: request(*args, **{**kwargs, 'timeout': 20}))
                _save(credentials, saved['channel'])
            except Exception:
                raise legacy.Problem('YouTube authorization needs to be renewed. Connect the channel again.', 409) from None
    return _build(credentials)


def callback(handler):
    try:
        query = parse_qs(urlsplit(handler.path).query, max_num_fields=20)
        finish(query)
        message, code = '@EccoAILabs is connected. Close this tab and return to Studio.', 200
    except legacy.Problem as exc:
        message, code = exc.message, exc.code
    except Exception:
        message, code = 'YouTube connection could not complete. Return to Studio and try again.', 400
    # No scripts, external resources, codes in redirects, or provider error details.
    page = ('<!doctype html><html lang="en"><meta charset="utf-8">'
            '<meta name="viewport" content="width=device-width, initial-scale=1">'
            '<title>YouTube connection · Ecco Studio</title><main>'
            '<h1>YouTube connection</h1><p>' + html.escape(message) + '</p>'
            '<a href="' + STUDIO_URL + '">Return to Studio</a></main></html>')
    return handler.send(page, code, mime='text/html; charset=utf-8')
