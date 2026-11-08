"""Published Look and Feel (master size roster) for every Studio and Desk page.

Anyone may read the published roster; it contains only element sizes and selectors.
Only Desk administrators, or members of the approved administrator group, may publish.
Every publish is kept as a numbered version so a change can be traced and restored.
A published value of null means "use the roster in the repository".
"""
import json
import re

import ecco_desk_groups
import google_signin

MAX_BYTES = 65536
ID = re.compile(r'^[a-z][a-z0-9-]{1,47}$')
KEPT_FONT = re.compile(r'^calc\(\d{1,2}(\.\d{1,3})?px - 2pt\)$')
UNSAFE = re.compile(r'[{};@\\]|/\*|</')
LIMITS = {'font': (4, 96), 'height': (10, 200), 'width': (10, 1200)}
SCHEMA = '''CREATE TABLE IF NOT EXISTS look_and_feel_versions (
    version INTEGER PRIMARY KEY, roster TEXT NOT NULL, updatedBy TEXT NOT NULL,
    updatedByName TEXT NOT NULL, updatedAt TEXT NOT NULL)'''


class LookError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


def initialize(db):
    db.execute(SCHEMA)


def _selector(value):
    if not isinstance(value, str) or not value.strip() or len(value) > 300 or UNSAFE.search(value):
        raise LookError('Selectors must be plain CSS selectors without braces, semicolons, at-rules or comments.')
    return value.strip()


def _size(kind, value):
    if value is None:
        return None
    if isinstance(value, bool):
        raise LookError(kind.title() + ' must be a number of pixels.')
    if isinstance(value, (int, float)):
        low, high = LIMITS[kind]
        if not low <= value <= high:
            raise LookError(f'{kind.title()} must be between {low} and {high} px.')
        return round(float(value), 3)
    if kind == 'font' and isinstance(value, str) and KEPT_FONT.match(value):
        return value
    raise LookError(kind.title() + ' must be a number of pixels.')


def validate(roster):
    """Returns a normalized roster or raises LookError with a message a person can act on."""
    if not isinstance(roster, dict) or not isinstance(roster.get('types'), list):
        raise LookError('The roster needs a list of element types.')
    variants = roster.get('variants', [])
    if not isinstance(variants, list):
        raise LookError('Variants must be a list.')
    seen, types, clean_variants = set(), [], []

    def entry(item, variant):
        if not isinstance(item, dict):
            raise LookError('Each element needs a name and selectors.')
        eid = item.get('id')
        if not isinstance(eid, str) or not ID.match(eid):
            raise LookError('Each element needs an id of lowercase letters, digits and hyphens.')
        if eid in seen:
            raise LookError(f'Two elements share the id "{eid}".')
        seen.add(eid)
        name = item.get('name')
        if not isinstance(name, str) or not name.strip() or len(name) > 80:
            raise LookError(f'"{eid}" needs a name of at most 80 characters.')
        selectors = item.get('selectors')
        if not isinstance(selectors, list) or not 1 <= len(selectors) <= 40:
            raise LookError(f'"{name}" needs between 1 and 40 selectors.')
        out = {'id': eid, 'name': name.strip(), 'selectors': [_selector(s) for s in selectors]}
        for kind in LIMITS:
            out[kind] = _size(kind, item.get(kind))
        exclude = item.get('excludeInside')
        if exclude is not None:
            if not isinstance(exclude, list) or len(exclude) > 60:
                raise LookError(f'"{name}" has an invalid exclusion list.')
            out['excludeInside'] = [_selector(s) for s in exclude]
        for key in ('contractComponent', 'of'):
            if item.get(key) is not None:
                if not isinstance(item[key], str) or not ID.match(item[key]):
                    raise LookError(f'"{name}" has an invalid {key}.')
                out[key] = item[key]
        if variant and out.get('of') not in {t['id'] for t in types}:
            raise LookError(f'"{name}" is a variant of an element type that does not exist.')
        for key in ('keptCurrent', 'added'):
            if isinstance(item.get(key), bool):
                out[key] = item[key]
        examples = item.get('examples')
        if isinstance(examples, list):
            out['examples'] = [str(x)[:80] for x in examples[:6]]
        return out

    for item in roster['types']:
        types.append(entry(item, False))
    for item in variants:
        clean_variants.append(entry(item, True))
    if not types:
        raise LookError('The roster needs at least one element type.')
    if len(types) + len(clean_variants) > 200:
        raise LookError('The roster is limited to 200 elements.')
    return {'schemaVersion': 1, 'types': types, 'variants': clean_variants}


def current(db):
    row = db.execute('SELECT * FROM look_and_feel_versions ORDER BY version DESC LIMIT 1').fetchone()
    if not row:
        return {'lookAndFeelVersion': 1, 'version': 0, 'roster': None, 'updatedAt': None, 'updatedBy': None}
    return {'lookAndFeelVersion': 1, 'version': row['version'], 'roster': json.loads(row['roster']),
            'updatedAt': row['updatedAt'], 'updatedBy': row['updatedByName']}


def can_publish(db, user, actor, fresh=False):
    me = actor(db, user)
    if me['role'] == 'admin':
        return True
    return ecco_desk_groups.access(user, fresh=fresh).get('canManageNotifications') is True


def history(db):
    return [dict(version=r['version'], updatedAt=r['updatedAt'], updatedBy=r['updatedByName'],
                 default=r['roster'] == 'null')
            for r in db.execute('SELECT version,roster,updatedAt,updatedByName FROM look_and_feel_versions ORDER BY version DESC LIMIT 20')]


def publish(db, user, body, actor, now):
    if set(body) - {'op', 'roster', 'baseVersion'} or body.get('op') not in ('publish', 'reset'):
        raise LookError('Unsupported Look and Feel request.')
    if not can_publish(db, user, actor, fresh=True):
        raise LookError('Only administrators can apply Look and Feel changes.', 403)
    base = body.get('baseVersion')
    if isinstance(base, bool) or not isinstance(base, int):
        raise LookError('Reload Look and Feel before applying changes.', 409)
    latest = current(db)
    if base != latest['version']:
        raise LookError('Someone else applied a newer Look and Feel. Reload to see it before applying yours.', 409)
    roster = None if body['op'] == 'reset' else validate(body.get('roster'))
    encoded = json.dumps(roster, separators=(',', ':'))
    if len(encoded.encode()) > MAX_BYTES:
        raise LookError('The roster is too large.', 413)
    db.execute('INSERT INTO look_and_feel_versions VALUES (?,?,?,?,?)',
               (latest['version'] + 1, encoded, user['id'], user['name'], now()))
    return {**current(db), 'canPublish': True, 'history': history(db)}


def handle(handler, allowed_origin, database, connect, actor, now):
    """Serves /api/look-and-feel. Returns True once the request has been answered."""
    try:
        if handler.headers.get('Origin') != allowed_origin:
            raise LookError('Origin denied.', 403)
        authorization = handler.headers.get('Authorization', '')
        if handler.command == 'GET':
            with connect(database) as db:
                initialize(db)
                result = current(db)
                if authorization:
                    user = google_signin.session(authorization)['user']
                    db.execute('BEGIN IMMEDIATE')
                    result['canPublish'] = can_publish(db, user, actor)
                    if result['canPublish']:
                        result['history'] = history(db)
            return handler.send(result) or True
        if handler.command != 'POST':
            raise LookError('Use GET or POST.', 405)
        user = google_signin.session(authorization)['user']
        length = int(handler.headers.get('Content-Length', '0'))
        if not 0 < length <= MAX_BYTES + 1024:
            raise LookError('Request is too large.', 413)
        if handler.headers.get('Content-Type', '').split(';')[0] != 'application/json':
            raise LookError('Expected JSON.', 415)
        body = json.loads(handler.rfile.read(length))
        if not isinstance(body, dict):
            raise LookError('Expected an object.')
        with connect(database) as db:
            initialize(db)
            db.execute('BEGIN IMMEDIATE')
            result = publish(db, user, body, actor, now)
        handler.send(result)
    except (LookError, google_signin.AuthError) as exc:
        handler.send({'error': str(exc)}, exc.status)
    except (ValueError, TypeError):
        handler.send({'error': 'Invalid Look and Feel request.'}, 400)
    except (BrokenPipeError, ConnectionResetError):
        pass
    return True
