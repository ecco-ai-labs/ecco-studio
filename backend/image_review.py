"""Review links for pictures (Image Level 4, IMG-4.4; 21 Nov 2026, branch image-l5-native).

The owner shares up to 12 pictures as a review. Anyone with the link can look at those pictures only and pin comments
to a spot on them; nothing else in storage is reachable with it. A link lasts 14 days unless the owner closes it.

Owner routes (storage key required): POST /api/review/create, POST /api/review/close.
Public routes (the link's token is the only key): GET /api/review/public/<token>,
GET /api/review/public/<token>/media/<asset id>, POST /api/review/public/<token>/comment.
Reviews are records of kind 'review' in studio.sqlite, so they reach the owner's Studio with the rest of the state.
"""
import re
import secrets
import threading
import time

DAYS = 14
MAX_PICTURES = 12
MAX_COMMENTS = 300
TOKEN = re.compile(r'^[A-Za-z0-9_-]{24,64}$')
_lock = threading.Lock()
_recent = {}  # token -> recent comment times (a light brake on a link that is being misused)


def _text(value, limit):
    return re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]', '', str(value or '')).strip()[:limit]


def _find(token, L):
    if not isinstance(token, str) or not TOKEN.match(token):
        raise L['Problem']('Review link not found', 404)
    for r in L['records']('review'):
        if secrets.compare_digest(r.get('token', ''), token):
            if r.get('closed'):
                raise L['Problem']('This review has been closed by its owner', 410)
            if r.get('expires', 0) < time.time():
                raise L['Problem']('This review link has expired', 410)
            return r
    raise L['Problem']('Review link not found', 404)


def create(body, L):
    ids = body.get('asset_ids')
    if not isinstance(ids, list) or not 1 <= len(ids) <= MAX_PICTURES or len(set(ids)) != len(ids):
        raise L['Problem'](f'Choose 1 to {MAX_PICTURES} pictures to share')
    pictures = []
    for aid in ids:
        a = L['get'](aid if isinstance(aid, str) else '', 'asset')
        if a.get('media') != 'image' or a.get('deleted'):
            raise L['Problem']('Choose pictures outside Trash')
        pictures.append({'id': a['id'], 'title': _text(a.get('title') or 'Picture', 120)})
    now = time.time()
    review = L['new']('review', token=secrets.token_urlsafe(32), title=_text(body.get('title') or 'Pictures for review', 120),
                      pictures=pictures, comments=[], expires=now + DAYS * 86400, closed=False, story_id=body.get('story_id'))
    L['save'](review)
    return {'id': review['id'], 'token': review['token'], 'expires': review['expires'], 'pictures': pictures}


def close(body, L):
    r = L['get'](body.get('review_id', ''), 'review')
    r['closed'] = True
    L['save'](r)
    return {'id': r['id'], 'closed': True}


def public(token, L):
    r = _find(token, L)
    return {'title': r['title'], 'pictures': r['pictures'], 'comments': r.get('comments', []), 'expires': r['expires']}


def media(token, asset_id, L):
    r = _find(token, L)
    if not any(p['id'] == asset_id for p in r['pictures']):
        raise L['Problem']('Not part of this review', 404)
    a = L['get'](asset_id, 'asset')
    if a.get('deleted'):
        raise L['Problem']('This picture is no longer available', 404)
    return L['asset_path'](a)


def comment(token, body, L):
    with _lock:
        r = _find(token, L)
        aid = body.get('asset_id')
        if not any(p['id'] == aid for p in r['pictures']):
            raise L['Problem']('Choose a picture in this review')
        try:
            x, y = float(body.get('x')), float(body.get('y'))
        except (TypeError, ValueError):
            raise L['Problem']('Pin the comment to a spot on the picture')
        if not (0 <= x <= 1 and 0 <= y <= 1):
            raise L['Problem']('Pin the comment to a spot on the picture')
        text = _text(body.get('text'), 500)
        if not text:
            raise L['Problem']('Write a comment')
        now = time.time()
        recent = [t for t in _recent.get(token, []) if now - t < 60]
        if len(recent) >= 20:
            raise L['Problem']('Too many comments in a minute. Wait a moment and try again.', 429)
        comments = r.get('comments', [])
        if len(comments) >= MAX_COMMENTS:
            raise L['Problem']('This review has reached its comment limit', 409)
        c = {'id': secrets.token_hex(8), 'asset_id': aid, 'x': round(x, 4), 'y': round(y, 4), 'text': text,
             'name': _text(body.get('name'), 60) or 'Reviewer', 'created': now}
        r['comments'] = comments + [c]
        L['save'](r)
        _recent[token] = recent + [now]
        return c
