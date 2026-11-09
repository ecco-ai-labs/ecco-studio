"""Administrator-only, pinned frontend releases. Credentials never reach the browser.

GitHub is Dev/Test. A manual workflow uploads the tested artifact to production;
this module never executes repository code or restarts a running worker.
"""
import json
import os
from pathlib import Path
import re
import uuid
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

REPO = 'ecco-ai-labs/ecco-studio'
DEV_URL = 'https://ecco-ai-labs.github.io/ecco-studio/'
PROD_URL = 'https://ecco-ai-labs.github.io/ecco-studio/'
CHECK_WORKFLOW = 'release-checks.yml'
PUBLISH_WORKFLOW = 'production-release.yml'
SHA = re.compile(r'^[0-9a-f]{40}$')


def error(message, status=400):
    from ecco_desk import DeskError
    raise DeskError(message, status)


def require_admin(me):
    if me.get('role') != 'admin':
        error('Only Ecco Desk administrators can manage production releases.', 403)


def initialize(db):
    db.execute('''CREATE TABLE IF NOT EXISTS desk_releases (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, sha TEXT NOT NULL,
        baseSha TEXT NOT NULL, checkRunId INTEGER NOT NULL,
        kind TEXT NOT NULL, state TEXT NOT NULL, createdAt TEXT NOT NULL,
        createdBy TEXT NOT NULL, createdName TEXT NOT NULL,
        publishedBy TEXT, publishedName TEXT, requestedAt TEXT,
        runId INTEGER, runUrl TEXT, error TEXT)''')


def token():
    name = os.getenv('ECCO_RELEASE_GITHUB_TOKEN_FILE', '/workspace/ecco-storage-private/releases-github.token')
    try:
        return Path(name).read_text().strip()
    except FileNotFoundError:
        return ''


def github(path, body=None):
    headers = {'Accept': 'application/vnd.github+json', 'User-Agent': 'Ecco-Releases',
               'X-GitHub-Api-Version': '2022-11-28'}
    credential = token()
    if credential:
        headers['Authorization'] = 'Bearer ' + credential
    if body is not None:
        if not credential:
            error('Connect the release service to GitHub before publishing.', 503)
        headers['Content-Type'] = 'application/json'
    request = Request('https://api.github.com/repos/' + REPO + path, headers=headers,
                      data=json.dumps(body).encode() if body is not None else None)
    try:
        with urlopen(request, timeout=8) as response:
            raw = response.read(4 * 1024 * 1024)
            return json.loads(raw) if raw else {}
    except HTTPError as exc:
        if exc.code == 404:
            error('The release workflow is not installed on GitHub yet.', 503)
        if exc.code in (401, 403, 429):
            error('GitHub access is unavailable or rate limited. Check the release service connection.', 503)
        error('GitHub could not confirm the request. Refresh release history before trying again.', 503)
    except (URLError, TimeoutError, OSError, ValueError):
        error('GitHub could not confirm the request. Refresh release history before trying again.', 503)


def production_history():
    records = []
    # Keep the production ledger distinct from unrelated repository releases.
    for release in github('/releases?per_page=100'):
        if release.get('draft') or release.get('prerelease') or not release.get('tag_name', '').startswith('prod-'):
            continue
        try:
            info = json.loads(release.get('body') or '')
        except ValueError:
            continue
        if info.get('schema') == 'ecco-production-v1' and SHA.fullmatch(info.get('sha', '')):
            records.append({**info, 'publishedAt': release['published_at'], 'url': release['html_url']})
    return sorted(records, key=lambda r: r['publishedAt'], reverse=True)


def checked_run(sha):
    result = github('/actions/workflows/' + CHECK_WORKFLOW + '/runs?head_sha=' + sha + '&event=push&per_page=100')
    runs = [r for r in result.get('workflow_runs', []) if r.get('head_sha') == sha
            and r.get('head_branch') == 'main' and r.get('event') == 'push']
    if not runs:
        return {'state': 'not_run', 'label': 'Not run', 'id': None, 'url': None}
    run = max(runs, key=lambda r: (r['id'], r.get('run_attempt', 1)))
    state = run.get('conclusion') if run.get('status') == 'completed' else run.get('status', 'queued')
    return {'state': state, 'label': 'Passed' if state == 'success' else str(state).replace('_', ' ').capitalize(),
            'id': run['id'], 'url': run['html_url']}


def require_artifact(sha, run_id):
    check = checked_run(sha)
    if check['state'] != 'success' or check['id'] != run_id:
        error('This exact version must pass Release checks before it can be published.', 409)
    items = github(f'/actions/runs/{run_id}/artifacts?per_page=100').get('artifacts', [])
    if not any(a['name'] == 'ecco-release-' + sha and not a.get('expired') for a in items):
        error('The tested build has expired. Run Release checks again and prepare a new release.', 409)
    return check


def changes(base, sha):
    if base == sha:
        return []
    if not base:
        commit = github('/commits/' + sha)
        return [{'sha': sha, 'title': 'Initial production release — complete Studio',
                 'author': commit['commit']['author']['name'], 'url': commit['html_url']}]
    records = []
    for page in range(1, 7):
        comparison = github(f'/compare/{base}...{sha}?per_page=100&page={page}')
        if comparison.get('status') not in ('ahead', 'identical'):
            error('Development and production histories diverged. Resolve the release branch before publishing.', 409)
        items = comparison.get('commits', [])
        records.extend({'sha': c['sha'], 'title': c['commit']['message'].split('\n')[0],
                        'author': c['commit']['author']['name'], 'url': c['html_url']} for c in items)
        if len(records) >= comparison.get('total_commits', 0):
            return records
    error('This release exceeds 600 commits. Establish a reviewed production baseline first.', 409)


def reconcile(db, history):
    receipts = {r['id']: r for r in history}
    pending = list(db.execute("SELECT * FROM desk_releases WHERE state IN ('dispatching','queued','in_progress','unknown')"))
    if not pending:
        return
    runs = github('/actions/workflows/' + PUBLISH_WORKFLOW + '/runs?event=workflow_dispatch&per_page=100').get('workflow_runs', [])
    for item in pending:
        if item['id'] in receipts:
            receipt = receipts[item['id']]
            if receipt['sha'] != item['sha']:
                error('Production receipt does not match the prepared release.', 409)
            db.execute("UPDATE desk_releases SET state='deployed',error=NULL WHERE id=?", (item['id'],))
            continue
        matched = [r for r in runs if r.get('display_title') == 'Production release ' + item['id']]
        if not matched:
            continue  # An uncertain dispatch is never automatically sent twice.
        run = max(matched, key=lambda r: r['id'])
        state = run['status']
        message = None
        if state == 'completed':
            # The deployment receipt, not the dispatch HTTP response, proves success.
            state = 'unknown' if run.get('conclusion') == 'success' else 'failed'
            message = 'Waiting for the production receipt.' if state == 'unknown' else 'Publishing did not complete. Review the GitHub run before preparing another release.'
        db.execute('UPDATE desk_releases SET state=?,runId=?,runUrl=?,error=? WHERE id=?',
                   (state, run['id'], run['html_url'], message, item['id']))


def listing(db, me):
    require_admin(me)
    blockers = []
    if not token():
        blockers.append('Connect the release service to GitHub.')
    if os.getenv('ECCO_RELEASES_ENABLED') != '1':
        blockers.append('Complete production hosting, domain and sign-in setup.')
    history = production_history()
    reconcile(db, history)
    current = history[0] if history else None
    head = github('/commits/main')['sha']
    check = checked_run(head)
    pending = changes(current['sha'] if current else '', head)
    prepared = [dict(r) for r in db.execute('SELECT * FROM desk_releases ORDER BY createdAt DESC LIMIT 50')]
    # No tokens, customer details, workspace keys or service configuration are returned.
    return {'releaseVersion': 1, 'productionUrl': PROD_URL, 'devUrl': DEV_URL,
            'blockers': blockers, 'current': current, 'head': head, 'checks': check,
            'changes': pending, 'releases': prepared, 'history': history,
            'previewEnabled': os.getenv('ECCO_DEV_PREVIEWS_ENABLED') == '1',
            'previewUrl': DEV_URL + 'previews/' + head + '/',
            'active': next((r['id'] for r in prepared if r['state'] in ('dispatching','queued','in_progress','unknown')), None)}


def write(db, me, body):
    from ecco_desk import now, text, event
    require_admin(me)
    op = body.get('op')
    rid = body.get('id', '')
    if not isinstance(rid, str) or not re.fullmatch(r'[0-9a-f]{32}', rid):
        error('Invalid release identifier.')
    existing = db.execute('SELECT * FROM desk_releases WHERE id=?', (rid,)).fetchone()
    if op in ('prepareRelease', 'prepareRollback'):
        sha = body.get('sha', '')
        if not isinstance(sha, str) or not SHA.fullmatch(sha):
            error('Choose a full development version.')
        title = text(body, 'title', 120)
        kind = 'rollback' if op == 'prepareRollback' else 'release'
        if existing:
            if existing['sha'] != sha or existing['title'] != title or existing['kind'] != kind:
                error('This release identifier was already used for a different version.', 409)
            return {'releaseVersion': 1, 'release': dict(existing)}
        history = production_history()
        base = history[0]['sha'] if history else ''
        if base == sha:
            error('This version is already in production.', 409)
        if kind == 'rollback':
            if not any(r['sha'] == sha for r in history):
                error('Rollback must use a previously published version.', 409)
        elif sha != github('/commits/main')['sha']:
            error('Development changed. Refresh and review the updated collection of changes.', 409)
        check = checked_run(sha)
        require_artifact(sha, check['id'])
        if kind == 'release':
            changes(base, sha)  # Refuse diverged or unbounded release collections.
        db.execute('INSERT INTO desk_releases (id,title,sha,baseSha,checkRunId,kind,state,createdAt,createdBy,createdName) VALUES (?,?,?,?,?,?,?,?,?,?)',
                   (rid, title, sha, base, check['id'], kind, 'prepared', now(), me['userId'], me['name']))
        event(db, me, 'Prepared production ' + kind + ': ' + title + ' (' + sha[:8] + ')')
        return {'releaseVersion': 1, 'release': dict(db.execute('SELECT * FROM desk_releases WHERE id=?', (rid,)).fetchone())}
    if op != 'publishRelease' or not existing:
        error('Prepared release not found.', 404)
    if existing['state'] != 'prepared':
        return {'releaseVersion': 1, 'release': dict(existing)}
    if os.getenv('ECCO_RELEASES_ENABLED') != '1' or not token():
        error('Complete the release service and production setup before publishing.', 409)
    if db.execute("SELECT 1 FROM desk_releases WHERE state IN ('dispatching','queued','in_progress','unknown')").fetchone():
        error('Another release is awaiting a production result. Refresh its status first.', 409)
    history = production_history()
    base = history[0]['sha'] if history else ''
    if base != existing['baseSha']:
        error('Production changed after this release was prepared. Prepare it again against the current production version.', 409)
    require_artifact(existing['sha'], existing['checkRunId'])
    db.execute("UPDATE desk_releases SET state='dispatching',publishedBy=?,publishedName=?,requestedAt=? WHERE id=?",
               (me['userId'], me['name'], now(), rid))
    event(db, me, 'Requested production ' + existing['kind'] + ': ' + existing['title'])
    # Commit intent before the external write. A timeout or process exit cannot
    # roll back the receipt and accidentally permit a duplicate deployment.
    db.commit()
    try:
        github('/actions/workflows/' + PUBLISH_WORKFLOW + '/dispatches', {
            'ref': 'main', 'inputs': {'release_id': rid, 'source_sha': existing['sha'],
            'expected_production_sha': base or 'none', 'check_run_id': str(existing['checkRunId']),
            'title': existing['title'], 'actor': me['name'], 'kind': existing['kind']}})
    except Exception:
        db.execute("UPDATE desk_releases SET state='unknown',error=? WHERE id=?",
                   ('GitHub has not confirmed this request. Refresh status; do not publish a duplicate.', rid))
    else:
        db.execute("UPDATE desk_releases SET state='queued',error=NULL WHERE id=?", (rid,))
    return {'releaseVersion': 1, 'release': dict(db.execute('SELECT * FROM desk_releases WHERE id=?', (rid,)).fetchone())}
