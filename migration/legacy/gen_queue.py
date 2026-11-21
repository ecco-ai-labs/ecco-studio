"""Generation queue for picture jobs (owner-approved mock, 20 Nov 2026).

Thousands of picture jobs can wait here; the dispatcher runs as many at once as RunPod allows for each
endpoint (read live from RunPod, at most 8 pictures in all). Users see, reorder and cancel only their
own jobs. Waiting order lives in the gen_queue table of studio.sqlite, next to the job records.

Studio (studio.py) keeps creating one job record per submission, so the Activity and Generation views keep
working. Only the moment a job starts moves here: launch() hands picture jobs to enqueue() instead of its
one-worker pool.
"""
import json
import os
import sqlite3
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

MAX_PARALLEL = 8
CAP_TTL = 60
PAGE = 50
LOCK = threading.RLock()
RUNS = {}          # job_id -> the job's run function (in memory; rebuilt after a restart)
RUNNING = {}       # job_id -> group
CAPS = {'at': 0, 'groups': {}}
LOCAL = threading.local()
_STATE = {'db': None, 'g': None, 'thread': None}

# One list of picture models for Select Model and the queue tabs ("Model Garden").
MODELS_FILE = Path(__file__).with_name('image_models.json')


def models_list():
    try:
        data = json.loads(MODELS_FILE.read_text())
        return [m for m in data.get('models', []) if isinstance(m, dict) and m.get('id')]
    except (OSError, ValueError):
        return [{'id': 'qwen-image-2512', 'name': 'Qwen-Image-2512', 'group': 'images', 'default': True,
                 'quality': 4, 'quality_label': 'High', 'seconds': 60}]


def model_info(model_id):
    for m in models_list():
        if m['id'] == model_id:
            return m
    return {'id': model_id, 'name': model_id, 'group': 'images', 'quality': 3, 'seconds': 60}


def group_for(model_id):
    return model_info(model_id).get('group') or 'images'


# ----- database -------------------------------------------------------------------------------

def db():
    con = sqlite3.connect(_STATE['db'], timeout=30)
    con.row_factory = sqlite3.Row
    return con


def create_table(path):
    _STATE['db'] = str(path)
    with db() as con:
        con.execute('PRAGMA journal_mode=WAL')
        con.execute('CREATE TABLE IF NOT EXISTS gen_queue (job_id TEXT PRIMARY KEY, owner TEXT, model TEXT, grp TEXT, '
                    'pos REAL, status TEXT, created REAL, started REAL, finished REAL, seconds REAL, '
                    'kind TEXT, label TEXT, body TEXT)')
        con.execute('CREATE INDEX IF NOT EXISTS gen_queue_wait ON gen_queue (status, pos)')
        con.execute('CREATE INDEX IF NOT EXISTS gen_queue_owner ON gen_queue (owner, status, pos)')
        con.execute('CREATE TABLE IF NOT EXISTS gen_queue_caps (grp TEXT PRIMARY KEY, cap INTEGER, at REAL)')


def _row(job_id):
    with db() as con:
        r = con.execute('SELECT * FROM gen_queue WHERE job_id=?', (job_id,)).fetchone()
    return dict(r) if r else None


def _set(job_id, **kw):
    if not kw:
        return
    with LOCK, db() as con:
        con.execute('UPDATE gen_queue SET ' + ','.join(k + '=?' for k in kw) + ' WHERE job_id=?', (*kw.values(), job_id))


# ----- submission -----------------------------------------------------------------------------

def remember_request(kind, body):
    """Called by Studio before create_image/create_edit, so launch() knows who sent the job and what."""
    LOCAL.request = (kind, dict(body or {}))


def reuse_id():
    """When a waiting job is rebuilt after a restart, launch() reuses its job record."""
    return getattr(LOCAL, 'reuse', None)


def wants(metadata):
    # Every picture request (any model, including Z-Image's own path) goes to the queue; video and other jobs do not.
    return bool(getattr(LOCAL, 'request', None)) and (not metadata or metadata.get('media') in (None, 'image'))


def enqueue(job, run, label):
    kind, body = LOCAL.request
    LOCAL.request = None
    model = body.get('model') or ('qwen-image-edit-2511' if kind == 'edit' else 'qwen-image-2512')
    if kind == 'edit':
        model = 'qwen-image-edit-2511'
    owner = str(body.get('owner') or '')[:200]
    with LOCK:
        RUNS[job['id']] = run
        existing = _row(job['id'])
        if existing:
            _set(job['id'], status='waiting', started=None)
            return job
        with db() as con:
            last = con.execute('SELECT MAX(pos) FROM gen_queue').fetchone()[0] or 0
            con.execute('INSERT INTO gen_queue (job_id, owner, model, grp, pos, status, created, kind, label, body) '
                        'VALUES (?,?,?,?,?,?,?,?,?,?)',
                        (job['id'], owner, model, group_for(model), last + 1, 'waiting', time.time(), kind, label,
                         json.dumps({k: v for k, v in body.items() if k != 'owner'})[:200000]))
    try:
        _STATE['g']['job_update'](job['id'], owner=owner, model=model, progress='Waiting in the queue',
                                  prompt=str(body.get('prompt') or '').split('\nVisual style:')[0][:500])
    except Exception:
        pass
    wake()
    return job


# ----- capacity (read live from RunPod) ---------------------------------------------------------

def _endpoint_max(endpoint_id, opener=urllib.request.urlopen):
    key = os.getenv('RUNPOD_API_KEY')
    if not key or not endpoint_id:
        return None
    req = urllib.request.Request('https://rest.runpod.io/v1/endpoints/' + endpoint_id,
                                 headers={'Authorization': 'Bearer ' + key})
    try:
        with opener(req, timeout=15) as res:
            value = json.load(res).get('workersMax')
        return int(value) if value is not None else None
    except (urllib.error.URLError, ValueError, TypeError, OSError, TimeoutError):
        return None


def caps(groups, opener=urllib.request.urlopen, now=None):
    """Workers each group may use at once: the endpoint's max workers on RunPod, 8 pictures in all."""
    now = time.time() if now is None else now
    if now - CAPS['at'] > CAP_TTL or any(g not in CAPS['groups'] for g in groups):
        found = {}
        for g in groups:
            eid = os.getenv('ECCO_ENDPOINT_' + g.upper(), '').strip()
            value = _endpoint_max(eid, opener)
            if value is None:  # RunPod not reachable: keep the last answer, else one at a time
                value = CAPS['groups'].get(g, int(os.getenv('ECCO_QUEUE_CAP_' + g.upper(), '1')))
            found[g] = max(0, value)
        CAPS.update(at=now, groups=found)
        try:  # the storage service reads these for estimated waits
            with db() as con:
                for g, v in found.items():
                    con.execute('INSERT OR REPLACE INTO gen_queue_caps VALUES (?,?,?)', (g, v, now))
        except sqlite3.Error:
            pass
    return {g: CAPS['groups'].get(g, 1) for g in groups}


# ----- dispatcher -----------------------------------------------------------------------------

_EVENT = threading.Event()


def wake():
    _EVENT.set()


def _finish(job_id, started):
    g = _STATE['g']
    status = 'done'
    try:
        job = g['get'](job_id, 'job')
        status = job.get('status') if job.get('status') in ('done', 'failed', 'cancelled') else 'failed'
        if status == 'cancelled' and job.get('result'):
            # Cancelled while RunPod finished it anyway: the picture is not shown.
            for aid in job['result'] if isinstance(job['result'], list) else [job['result']]:
                try:
                    asset = g['get'](aid, 'asset')
                    asset['deleted'] = True
                    asset['hidden_reason'] = 'cancelled'
                    g['save'](asset)
                except Exception:
                    pass
    except Exception:
        status = 'failed'
    with LOCK:
        RUNNING.pop(job_id, None)
        RUNS.pop(job_id, None)
    _set(job_id, status=status, finished=time.time(), seconds=round(time.time() - started, 1))
    wake()


def _stopped(job_id):
    g = _STATE['g']
    try:
        if g['get'](job_id, 'job').get('cancel_requested'):
            return True
    except Exception:
        return False
    return (Path(str(g.get('DATA', ''))) / 'generation-control' / job_id / 'cancel.json').exists() if g.get('DATA') else False


def _start(row):
    job_id = row['job_id']
    if _stopped(job_id):  # Stop pressed while it was waiting: it never starts
        _set(job_id, status='cancelled', finished=time.time())
        with LOCK:
            RUNS.pop(job_id, None)
        try:
            _STATE['g']['job_update'](job_id, status='cancelled', progress='Stopped by user', error='')
        except Exception:
            pass
        return
    run = RUNS.get(job_id)
    if run is None:
        rebuilt = rebuild(row)
        run = RUNS.get(job_id) if rebuilt else None
    if run is None:
        _set(job_id, status='failed', finished=time.time())
        try:
            _STATE['g']['job_update'](job_id, status='failed', error='This job could not be restarted. Send it again.')
        except Exception:
            pass
        return
    started = time.time()
    with LOCK:
        RUNNING[job_id] = row['grp']
    _set(job_id, status='running', started=started)

    def go():
        try:
            run()
        finally:
            _finish(job_id, started)
    threading.Thread(target=go, daemon=True, name='queue-' + job_id[:8]).start()


def dispatch_once(opener=urllib.request.urlopen):
    """Start waiting jobs while their endpoint has a free worker. Returns how many started."""
    with db() as con:
        groups = [r[0] for r in con.execute("SELECT DISTINCT grp FROM gen_queue WHERE status='waiting'")]
    if not groups:
        return 0
    # Read every picture endpoint, so "pictures at once" counts the edit endpoint too.
    limit = caps(sorted(set(groups) | {m.get('group') or 'images' for m in models_list()}), opener)
    started = 0
    with LOCK:
        busy = {}
        for grp in RUNNING.values():
            busy[grp] = busy.get(grp, 0) + 1
        total = len(RUNNING)
    with db() as con:
        rows = [dict(r) for r in con.execute("SELECT * FROM gen_queue WHERE status='waiting' ORDER BY pos LIMIT 400")]
    for row in rows:
        if total >= MAX_PARALLEL:
            break
        grp = row['grp']
        if busy.get(grp, 0) >= limit.get(grp, 1):
            continue
        busy[grp] = busy.get(grp, 0) + 1
        total += 1
        _start(row)
        started += 1
    return started


def loop():
    while True:
        try:
            dispatch_once()
        except Exception:
            pass
        _EVENT.wait(2)
        _EVENT.clear()


def rebuild(row):
    """Recreate a waiting job's run function after a restart by sending its request again into the same record."""
    g = _STATE['g']
    creator = {'image': 'create_image', 'edit': 'create_edit'}.get(row.get('kind'))
    if not creator or creator not in g:
        return False
    try:
        body = json.loads(row.get('body') or '{}')
        body['owner'] = row.get('owner') or ''
        LOCAL.reuse = row['job_id']
        remember_request(row['kind'], body)
        g[creator](body)
        return row['job_id'] in RUNS
    except Exception:
        return False
    finally:
        LOCAL.reuse = None
        LOCAL.request = None


def install(g, path):
    """Called once when Studio starts: table, restart recovery, dispatcher thread."""
    _STATE['g'] = g
    create_table(path)
    with db() as con:
        top = con.execute("SELECT MIN(pos) FROM gen_queue WHERE status='waiting'").fetchone()[0] or 1
        # Jobs that were running when the server stopped go back to the front of the line.
        for n, r in enumerate(con.execute("SELECT job_id FROM gen_queue WHERE status='running' ORDER BY started").fetchall()):
            con.execute("UPDATE gen_queue SET status='waiting', started=NULL, pos=? WHERE job_id=?", (top - 100 + n, r[0]))
    with db() as con:
        waiting = [r[0] for r in con.execute("SELECT job_id FROM gen_queue WHERE status='waiting'")]
    for jid in waiting:
        try:
            job = g['get'](jid, 'job')
            if job.get('status') in ('queued', 'running', 'interrupted'):
                job.update(status='queued', error='', progress='Waiting in the queue')
                g['save'](job)
        except Exception:
            pass
    if not _STATE['thread']:
        _STATE['thread'] = threading.Thread(target=loop, daemon=True, name='gen-queue')
        _STATE['thread'].start()


# ----- owner actions (sent through Studio, the only writer) -------------------------------------

def _mine(owner):
    with db() as con:
        return [dict(r) for r in con.execute("SELECT job_id, pos FROM gen_queue WHERE status='waiting' AND owner=? ORDER BY pos", (owner,))]


def move(owner, job_id, before_id=None, top=False):
    """Reorder one of the owner's waiting jobs among the places the owner's jobs already hold."""
    owner = str(owner or '')
    with LOCK:
        mine = _mine(owner)
        ids = [r['job_id'] for r in mine]
        if job_id not in ids:
            raise ValueError('You can only reorder your own waiting jobs.')
        places = [r['pos'] for r in mine]
        ids.remove(job_id)
        if top:
            ids.insert(0, job_id)
        elif before_id in ids:
            ids.insert(ids.index(before_id), job_id)
        else:
            ids.append(job_id)
        with db() as con:
            for jid, pos in zip(ids, places):
                con.execute('UPDATE gen_queue SET pos=? WHERE job_id=?', (pos, jid))
    return {'ok': True}


def cancel(owner, job_ids):
    """Cancel the owner's jobs: waiting ones leave the line; running ones are stopped on RunPod."""
    g = _STATE['g']
    owner = str(owner or '')
    done = 0
    for jid in job_ids:
        row = _row(jid)
        if not row or row['owner'] != owner or row['status'] not in ('waiting', 'running'):
            continue
        if row['status'] == 'waiting':
            _set(jid, status='cancelled', finished=time.time())
            with LOCK:
                RUNS.pop(jid, None)
            try:
                g['job_update'](jid, status='cancelled', cancel_requested=True, progress='Stopped by user', error='')
            except Exception:
                pass
        else:
            try:
                g['job_update'](jid, cancel_requested=True)
            except Exception:
                pass
        done += 1
    wake()
    return {'cancelled': done}


def cancel_all(owner):
    with db() as con:
        ids = [r[0] for r in con.execute("SELECT job_id FROM gen_queue WHERE status='waiting' AND owner=?", (str(owner or ''),))]
    return cancel(owner, ids)


# ----- reading (also used directly by the storage service) --------------------------------------

def speeds(con):
    """Average seconds per model from the last finished jobs; the model list's figure until 5 have run."""
    out = {}
    for m in models_list():
        rows = con.execute("SELECT seconds FROM gen_queue WHERE model=? AND status='done' AND seconds>0 "
                           "ORDER BY finished DESC LIMIT 20", (m['id'],)).fetchall()
        measured = [r[0] for r in rows]
        out[m['id']] = (sum(measured) / len(measured)) if len(measured) >= 5 else float(m.get('seconds') or 60)
    return out


def _estimates(con, limit_caps):
    """Estimated seconds until each waiting job starts, by walking the line per endpoint."""
    speed = speeds(con)
    clock = {}
    now = time.time()
    for r in con.execute("SELECT grp, model, started FROM gen_queue WHERE status='running'"):
        left = max(5.0, speed.get(r['model'], 60) - (now - (r['started'] or now)))
        clock.setdefault(r['grp'], []).append(left)
    est = {}
    for r in con.execute("SELECT job_id, grp, model FROM gen_queue WHERE status='waiting' ORDER BY pos"):
        cap = max(1, limit_caps.get(r['grp'], 1))
        lanes = sorted(clock.get(r['grp'], []))
        while len(lanes) < cap:
            lanes.append(0.0)
        start = lanes[0]
        est[r['job_id']] = start
        lanes[0] = start + speed.get(r['model'], 60)
        clock[r['grp']] = sorted(lanes)[:max(cap, len(lanes))]
    return est


def saved_caps(con):
    return {r[0]: r[1] for r in con.execute('SELECT grp, cap FROM gen_queue_caps')}


def parallel(con):
    """How many pictures can run at once right now (all picture endpoints, at most 8)."""
    return max(1, min(MAX_PARALLEL, sum(saved_caps(con).values()) or 1))


def page(owner, model='', search='', offset=0, limit=PAGE, path=None):
    """One page of the owner's waiting jobs, with each job's place in the whole line and estimated wait."""
    if path and _STATE['db'] != str(path):
        create_table(path)
    owner = str(owner or '')
    offset = max(0, int(offset or 0))
    limit = max(1, min(PAGE, int(limit or PAGE)))
    with db() as con:
        groups = [r[0] for r in con.execute("SELECT DISTINCT grp FROM gen_queue WHERE status IN ('waiting','running')")]
        est = _estimates(con, dict(CAPS['groups']) or saved_caps(con) or {g: 1 for g in groups})
        at_once = parallel(con)
        place = {r[0]: n + 1 for n, r in enumerate(con.execute("SELECT job_id FROM gen_queue WHERE status='waiting' ORDER BY pos"))}
        where, args = "status='waiting' AND owner=?", [owner]
        if model:
            where += ' AND model=?'
            args.append(model)
        if search:
            where += ' AND label LIKE ? ESCAPE "\\"'
            args.append('%' + search.replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_')[:100] + '%')
        total = con.execute('SELECT COUNT(*) FROM gen_queue WHERE ' + where, args).fetchone()[0]
        rows = [dict(r) for r in con.execute('SELECT job_id, model, label, body, created FROM gen_queue WHERE ' + where +
                                             ' ORDER BY pos LIMIT ? OFFSET ?', (*args, limit, offset))]
        mine = {r[0]: r[1] for r in con.execute("SELECT status, COUNT(*) FROM gen_queue WHERE owner=? AND created>? GROUP BY status",
                                                (owner, time.time() - 24 * 3600))}
        per_model = {r[0]: r[1] for r in con.execute("SELECT model, COUNT(*) FROM gen_queue WHERE status='waiting' AND owner=? GROUP BY model", (owner,))}
        my_ids = [r[0] for r in con.execute("SELECT job_id FROM gen_queue WHERE status='waiting' AND owner=?", (owner,))]
    items = []
    for r in rows:
        try:
            prompt = json.loads(r['body'] or '{}').get('prompt', '')
        except ValueError:
            prompt = ''
        items.append({'id': r['job_id'], 'model': r['model'], 'model_name': model_info(r['model']).get('name', r['model']),
                      'name': (str(prompt).split('\nVisual style:')[0] or r['label'] or 'Picture')[:160],
                      'place': place.get(r['job_id']), 'wait_seconds': round(est.get(r['job_id'], 0))})
    return {'items': items, 'total': total, 'parallel': at_once, 'offset': offset, 'limit': limit, 'per_model': per_model,
            'mine': {'waiting': mine.get('waiting', 0), 'running': mine.get('running', 0), 'done': mine.get('done', 0)},
            'last_wait_seconds': round(max([est.get(j, 0) for j in my_ids] or [0]))}


def models_status(path=None):
    """The picture models with quality, speed, jobs in line and estimated wait right now."""
    if path and _STATE['db'] != str(path):
        create_table(path)
    with db() as con:
        speed = speeds(con)
        waiting = {r[0]: r[1] for r in con.execute("SELECT model, COUNT(*) FROM gen_queue WHERE status='waiting' GROUP BY model")}
        groups = [r[0] for r in con.execute("SELECT DISTINCT grp FROM gen_queue WHERE status IN ('waiting','running')")]
        est = _estimates(con, dict(CAPS['groups']) or saved_caps(con) or {g: 1 for g in groups})
        by_model = {}
        for r in con.execute("SELECT job_id, model FROM gen_queue WHERE status='waiting' ORDER BY pos"):
            by_model[r[1]] = est.get(r[0], 0) + speed.get(r[1], 60)
    out = []
    for m in models_list():
        grp = m.get('group') or 'images'
        tail = by_model.get(m['id'])
        if tail is None:  # nothing of this model waiting: it starts on the next free worker of its endpoint
            tail = speed.get(m['id'], 60) if grp in groups else 0
        out.append({**m, 'seconds': round(speed.get(m['id'], m.get('seconds') or 60)),
                    'waiting': waiting.get(m['id'], 0), 'wait_seconds': round(tail), 'group': grp})
    return {'models': out}
