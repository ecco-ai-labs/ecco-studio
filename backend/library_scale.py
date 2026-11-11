"""Library at scale (owner request, 10 November 2026: 250,000 pictures must stay quick).

Three storage-side pieces, all opt-in for the browser through ``config.storage``:

* Change log: SQLite triggers record every insert, update and delete of ``records``.
  They live in the database file, so writes from the GPU service are logged too.
  ``/api/state?since=<cursor>`` then returns only what changed.
* Thumbnails: ``/api/thumb/<id>`` returns a small WebP of an image asset, made once
  and kept beside the data under ``thumbs/``.
* Revalidation: media and thumbnails carry an ETag, so the browser keeps its copy and
  the server answers 304 Not Modified instead of resending the file.
"""
import hashlib
import shutil
import subprocess
import sqlite3
import threading
import time
from pathlib import Path

THUMB_EDGE = 384          # px on the longest side; tiles show at up to ~190 css px on 2x screens
THUMB_QUALITY = 72
KEEP_CHANGES = 200_000    # change-log rows kept; an older cursor gets a full state instead
ACTIVE_STATUSES = ('queued', 'running', 'pending', 'processing', 'cancelling')

_installed = set()
_install_lock = threading.Lock()
_thumb_locks = {}
_thumb_locks_lock = threading.Lock()
_last_prune = {}

TRIGGERS = (
    'CREATE TABLE IF NOT EXISTS record_changes (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL, at REAL NOT NULL)',
    'CREATE INDEX IF NOT EXISTS record_changes_id ON record_changes(id)',
    "CREATE TRIGGER IF NOT EXISTS record_changes_insert AFTER INSERT ON records BEGIN "
    "INSERT INTO record_changes(id, at) VALUES (NEW.id, (julianday('now') - 2440587.5) * 86400.0); END",
    "CREATE TRIGGER IF NOT EXISTS record_changes_update AFTER UPDATE ON records BEGIN "
    "INSERT INTO record_changes(id, at) VALUES (NEW.id, (julianday('now') - 2440587.5) * 86400.0); END",
    "CREATE TRIGGER IF NOT EXISTS record_changes_delete AFTER DELETE ON records BEGIN "
    "INSERT INTO record_changes(id, at) VALUES (OLD.id, (julianday('now') - 2440587.5) * 86400.0); END",
    "CREATE INDEX IF NOT EXISTS records_status ON records(json_extract(body, '$.status'))",
)


def _db(data):
    return Path(data) / 'studio.sqlite'


def ensure(data):
    """Install the change log once per database file. Safe to call on every request."""
    path = str(_db(data).resolve())
    if path in _installed:
        return
    with _install_lock:
        if path in _installed:
            return
        with sqlite3.connect(path, timeout=30) as db:
            for statement in TRIGGERS:
                db.execute(statement)
        _installed.add(path)


def cursor(data):
    ensure(data)
    with sqlite3.connect(_db(data), timeout=30) as db:
        row = db.execute('SELECT MAX(seq) FROM record_changes').fetchone()
    return int(row[0] or 0)


def changes_since(data, since):
    """Return (changed_records, deleted_ids, cursor), or None when a full state is needed.

    Records whose status is still active (queued, running and so on) are always included:
    their progress is computed from the clock and the queue, not stored on every tick.
    """
    ensure(data)
    import json
    with sqlite3.connect(_db(data), timeout=30) as db:
        low, high = db.execute('SELECT MIN(seq), MAX(seq) FROM record_changes').fetchone()
        high = int(high or 0)
        if since < 0 or since > high or (low is not None and since < int(low) - 1):
            return None
        ids = [row[0] for row in db.execute('SELECT DISTINCT id FROM record_changes WHERE seq > ?', (since,))]
        bodies = {}
        for start in range(0, len(ids), 500):
            chunk = ids[start:start + 500]
            marks = ','.join('?' * len(chunk))
            for rid, body in db.execute(f'SELECT id, body FROM records WHERE id IN ({marks})', chunk):
                bodies[rid] = body
        marks = ','.join('?' * len(ACTIVE_STATUSES))
        for rid, body in db.execute(f"SELECT id, body FROM records WHERE json_extract(body, '$.status') IN ({marks})", ACTIVE_STATUSES):
            bodies[rid] = body
    deleted = [rid for rid in ids if rid not in bodies]
    return [json.loads(body) for body in bodies.values()], deleted, high


def prune(data, keep=KEEP_CHANGES, every=600):
    """Trim the change log; at most once per ``every`` seconds per database."""
    path = str(_db(data))
    now = time.time()
    if now - _last_prune.get(path, 0) < every:
        return
    _last_prune[path] = now
    ensure(data)
    with sqlite3.connect(path, timeout=30) as db:
        db.execute('DELETE FROM record_changes WHERE seq <= (SELECT MAX(seq) FROM record_changes) - ?', (keep,))


def etag(file, extra=''):
    stat = Path(file).stat()
    return '"' + hashlib.sha1(f'{stat.st_size}-{stat.st_mtime_ns}-{extra}'.encode()).hexdigest()[:20] + '"'


def matches(header, tag):
    if not header:
        return False
    return header.strip() == '*' or tag in [part.strip().removeprefix('W/') for part in header.split(',')]


def _lock_for(key):
    with _thumb_locks_lock:
        return _thumb_locks.setdefault(key, threading.Lock())


def thumbnail(data, asset, source):
    """Path of the WebP thumbnail for an image asset, making it on first use."""
    from PIL import Image, ImageOps
    stat = Path(source).stat()
    folder = Path(data) / 'thumbs' / asset['id'][:2]
    target = folder / f"{asset['id']}-{THUMB_EDGE}-{stat.st_mtime_ns}.webp"
    if target.is_file():
        return target
    with _lock_for(asset['id']):
        if target.is_file():
            return target
        folder.mkdir(parents=True, exist_ok=True)
        with Image.open(source) as image:
            image.draft('RGB', (THUMB_EDGE * 2, THUMB_EDGE * 2))
            image = ImageOps.exif_transpose(image)
            if image.mode not in ('RGB', 'RGBA'):
                image = image.convert('RGBA' if 'transparency' in image.info or image.mode in ('LA', 'P') else 'RGB')
            image.thumbnail((THUMB_EDGE, THUMB_EDGE), Image.Resampling.LANCZOS)
            partial = target.with_suffix('.part')
            image.save(partial, 'WEBP', quality=THUMB_QUALITY, method=4)
        partial.replace(target)
        for old in folder.glob(f"{asset['id']}-*.webp"):
            if old != target:
                old.unlink(missing_ok=True)
    return target


def video_thumbnails_available():
    return bool(shutil.which('ffmpeg'))


def video_thumbnail(data, asset, source):
    """Path of a WebP poster frame for a video asset (about one second in), made on first use."""
    from PIL import Image
    stat = Path(source).stat()
    folder = Path(data) / 'thumbs' / asset['id'][:2]
    target = folder / f"{asset['id']}-{THUMB_EDGE}-{stat.st_mtime_ns}.webp"
    if target.is_file():
        return target
    ffmpeg = shutil.which('ffmpeg')
    if not ffmpeg:
        raise ValueError('Video thumbnails need ffmpeg on the storage service')
    with _lock_for(asset['id']):
        if target.is_file():
            return target
        folder.mkdir(parents=True, exist_ok=True)
        frame = target.with_suffix('.png')
        for seek in ('1', '0'):
            result = subprocess.run([ffmpeg, '-v', 'error', '-y', '-ss', seek, '-i', str(source), '-frames:v', '1',
                                     '-vf', f'scale={THUMB_EDGE}:{THUMB_EDGE}:force_original_aspect_ratio=decrease', str(frame)],
                                    capture_output=True, timeout=60)
            if result.returncode == 0 and frame.is_file() and frame.stat().st_size:
                break
        else:
            frame.unlink(missing_ok=True)
            raise ValueError('Could not read a frame from this video')
        with Image.open(frame) as image:
            partial = target.with_suffix('.part')
            image.convert('RGB').save(partial, 'WEBP', quality=THUMB_QUALITY, method=4)
        partial.replace(target)
        frame.unlink(missing_ok=True)
        for old in folder.glob(f"{asset['id']}-*.webp"):
            if old != target:
                old.unlink(missing_ok=True)
    return target
