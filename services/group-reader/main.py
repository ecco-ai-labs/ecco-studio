"""Keyless, server-to-server membership broker. Never returns Google tokens."""
import hmac
import os
import re
import threading
import time
from urllib.parse import quote

import google.auth
from google.auth.transport.requests import AuthorizedSession
import requests
from flask import Flask, jsonify, request

app = Flask(__name__)
app.config['MAX_CONTENT_LENGTH'] = 2048
SCOPE = 'https://www.googleapis.com/auth/admin.directory.group.member.readonly'
_lock = threading.Lock()
_token = None
_expires = 0


def directory_token():
    global _token, _expires
    with _lock:
        if _token and time.monotonic() < _expires:
            return _token
        credentials, _ = google.auth.default(scopes=['https://www.googleapis.com/auth/cloud-platform'])
        account = os.environ['GROUP_READER_SERVICE_ACCOUNT']
        now = int(time.time())
        import json
        payload = {'iss': account, 'sub': os.environ['GROUP_READER_ADMIN'],
                   'scope': SCOPE, 'aud': 'https://oauth2.googleapis.com/token',
                   'iat': now, 'exp': now + 3600}
        with AuthorizedSession(credentials) as client:
            signed = client.post('https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/'
                                 + quote(account, safe='') + ':signJwt',
                                 json={'payload': json.dumps(payload)}, timeout=10)
            signed.raise_for_status()
        response = requests.post('https://oauth2.googleapis.com/token', data={
            'grant_type': 'urn:ietf:params:oauth:grant-type:jwt-bearer',
            'assertion': signed.json()['signedJwt']}, timeout=10)
        response.raise_for_status()
        data = response.json()
        _token = data['access_token']
        _expires = time.monotonic() + max(0, min(int(data['expires_in']), 3600) - 120)
        return _token


def membership(subject):
    response = requests.get('https://admin.googleapis.com/admin/directory/v1/groups/'
                            + quote(os.environ['GROUP_READER_GROUP'], safe='') + '/hasMember/' + subject,
                            headers={'Authorization': 'Bearer ' + directory_token()}, timeout=10)
    if response.status_code == 404:
        return False
    response.raise_for_status()
    result = response.json()
    if type(result.get('isMember')) is not bool:
        raise ValueError('Invalid Directory response')
    return result['isMember']


@app.post('/membership')
def check():
    # Public HTTPS ingress is authenticated here with a server-only random secret.
    # This is not a Google private key and is never provided to Studio browsers.
    secret = os.getenv('GROUP_READER_SECRET', '')
    if len(secret) < 32:
        return jsonify(error='Membership service is not configured'), 503
    if not hmac.compare_digest(request.headers.get('Authorization', ''), 'Bearer ' + secret):
        return jsonify(error='Unauthorized'), 401
    data = request.get_json(silent=True)
    if not isinstance(data, dict) or set(data) != {'subject'} or not isinstance(data['subject'], str) or not re.fullmatch(r'[0-9]{1,64}', data['subject']):
        return jsonify(error='Invalid subject'), 400
    try:
        return jsonify(subject=data['subject'], isMember=membership(data['subject']))
    except Exception:
        # Never log credentials, signed assertions, Directory responses or member IDs.
        app.logger.warning('Directory membership lookup failed')
        return jsonify(error='Membership lookup unavailable'), 503
