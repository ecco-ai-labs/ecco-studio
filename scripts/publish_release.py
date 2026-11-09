"""Publish an immutable, successful GitHub build; never build inside production.

Run only from the trusted main-branch manual workflow. Input values are passed
through the environment, never interpolated into shell code.
"""
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import subprocess
import tempfile
import time
import zipfile
from urllib.error import HTTPError
from urllib.request import Request, urlopen, build_opener, HTTPRedirectHandler

REPO = 'ecco-ai-labs/ecco-studio'


def require(condition, message):
    if not condition:
        raise ValueError(message)


def api(url, token, body=None, method=None):
    headers = {'Authorization': 'Bearer ' + token, 'Accept': 'application/json', 'User-Agent': 'Ecco-Releases'}
    if body is not None:
        headers['Content-Type'] = 'application/json'
    with urlopen(Request(url, data=json.dumps(body).encode() if body is not None else None, headers=headers, method=method), timeout=30) as response:
        result = json.load(response)
    require(result.get('success', True) is not False, 'Hosting API rejected the request.')
    return result.get('result', result)


def gh(path, body=None):
    return api('https://api.github.com/repos/' + REPO + path, os.environ['GH_TOKEN'], body)


def validate_run(run, sha, run_id):
    require(run['id'] == int(run_id) and run['head_sha'] == sha and run['head_branch'] == 'main'
            and run['event'] == 'push' and run['conclusion'] == 'success'
            and run['status'] == 'completed' and run['path'] == '.github/workflows/release-checks.yml',
            'The selected build is not a successful main-branch Release checks run.')


def validate_bundle(folder, sha, run_id):
    folder = Path(folder)
    manifest = json.loads((folder / 'release.json').read_text())
    require(manifest['schema'] == 'ecco-build-v1' and manifest['sha'] == sha
            and str(manifest['checkRunId']) == str(run_id), 'Build provenance mismatch.')
    actual = {p.relative_to(folder).as_posix() for p in folder.rglob('*') if p.is_file()}
    require(actual == set(manifest['files']) | {'release.json'}, 'Unexpected or missing build files.')
    for name, digest in manifest['files'].items():
        path = PurePosixPath(name)
        require(not path.is_absolute() and '..' not in path.parts, 'Invalid asset path.')
        require(hashlib.sha256((folder / name).read_bytes()).hexdigest() == digest, 'Build file hash mismatch.')
    require('index.html' in actual and 'desk/desk-app.mjs' in actual, 'Incomplete Studio build.')
    require(not any(p.split('/')[0] in ('backend', 'qa', 'migration', 'scripts', '.git', 'functions') for p in actual), 'Private or executable server files in build.')


def extract_archive(data, directory):
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        require(sum(i.file_size for i in archive.infolist()) < 100 * 1024 * 1024, 'Build exceeds 100 MB.')
        for item in archive.infolist():
            path = PurePosixPath(item.filename)
            require(not path.is_absolute() and '..' not in path.parts and '\\' not in item.filename, 'Unsafe artifact path.')
            require((item.external_attr >> 16) & 0o170000 != 0o120000, 'Artifact contains a symbolic link.')
        archive.extractall(directory)


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def download_artifact(artifact):
    # GitHub redirects to signed object storage. Do not forward its token there.
    request = Request(artifact['archive_download_url'], headers={'Authorization': 'Bearer ' + os.environ['GH_TOKEN'], 'User-Agent': 'Ecco-Releases'})
    try:
        response = build_opener(NoRedirect).open(request, timeout=30)
    except HTTPError as exc:
        require(exc.code == 302, 'Could not download the tested artifact.')
        location = exc.headers['Location']
        require(location.startswith('https://'), 'Insecure artifact download URL.')
        response = urlopen(location, timeout=60)
    with response:
        data = response.read(100 * 1024 * 1024 + 1)
    require(len(data) <= 100 * 1024 * 1024, 'Artifact exceeds 100 MB.')
    digest = artifact.get('digest', '')
    require(digest.startswith('sha256:') and hashlib.sha256(data).hexdigest() == digest[7:], 'GitHub artifact digest mismatch.')
    return data


def main():
    sha, rid, run_id = (os.environ[k] for k in ('SOURCE_SHA', 'RELEASE_ID', 'CHECK_RUN_ID'))
    expected, title, actor, kind = (os.environ[k] for k in ('EXPECTED_PRODUCTION_SHA', 'RELEASE_TITLE', 'RELEASE_ACTOR', 'RELEASE_KIND'))
    require(re.fullmatch('[0-9a-f]{40}', sha) and re.fullmatch('[0-9a-f]{32}', rid)
            and run_id.isdigit() and (expected == 'none' or re.fullmatch('[0-9a-f]{40}', expected)), 'Invalid release identifiers.')
    require(kind in ('release', 'rollback') and 0 < len(title) <= 120 and 0 < len(actor) <= 200, 'Invalid release metadata.')
    account, project = os.environ['CLOUDFLARE_ACCOUNT_ID'], os.environ['CLOUDFLARE_PAGES_PROJECT']
    require(re.fullmatch('[a-f0-9]{32}', account) and re.fullmatch('[a-z0-9-]{1,58}', project), 'Invalid hosting configuration.')
    base_url = f'https://api.cloudflare.com/client/v4/accounts/{account}/pages/projects/{project}'
    cf = lambda: api(base_url, os.environ['CLOUDFLARE_API_TOKEN'])
    hosting = cf()
    require(hosting.get('source') is None, 'Production must be a Direct Upload project with no automatic Git deployments.')
    branch = hosting['production_branch']
    current = hosting.get('canonical_deployment')
    current_sha = ((current or {}).get('deployment_trigger', {}).get('metadata', {}).get('commit_hash')) or 'none'
    require(current_sha == expected, 'Production changed. Refresh Ecco Desk and prepare a new release.')
    validate_run(gh('/actions/runs/' + run_id), sha, run_id)
    # No arbitrary revision, PR artifact or unverified branch can be published.
    comparison = gh('/compare/' + sha + '...main')
    require(comparison['status'] in ('identical', 'ahead'), 'Selected revision is not in main history.')
    artifacts = gh('/actions/runs/' + run_id + '/artifacts?per_page=100')['artifacts']
    candidates = [a for a in artifacts if a['name'] == 'ecco-release-' + sha and not a['expired']]
    require(len(candidates) == 1, 'The tested artifact is missing, expired or ambiguous.')
    data = download_artifact(candidates[0])
    with tempfile.TemporaryDirectory() as temp:
        output = Path(temp) / 'site'
        output.mkdir()
        extract_archive(data, output)
        validate_bundle(output, sha, run_id)
        # Run in an empty temporary folder: no repository functions/wrangler config.
        subprocess.run(['npx', '--yes', 'wrangler@4.158.0', 'pages', 'deploy', str(output),
                        '--project-name', project, '--branch', branch, '--commit-hash', sha,
                        '--commit-message', 'Ecco production release ' + rid, '--commit-dirty=false'],
                       cwd=temp, env={k: v for k, v in os.environ.items() if k != 'GH_TOKEN'},
                       check=True, timeout=240)
    deployed = None
    for _ in range(12):
        deployed = cf().get('canonical_deployment')
        if deployed and deployed.get('latest_stage', {}).get('status') == 'success' and deployed.get('deployment_trigger', {}).get('metadata', {}).get('commit_hash') == sha:
            break
        time.sleep(5)
    else:
        raise ValueError('Hosting did not confirm the production version. Inspect Cloudflare before retrying.')
    receipt = {'schema': 'ecco-production-v1', 'id': rid, 'title': title, 'sha': sha,
               'previousSha': expected, 'checkRunId': run_id, 'kind': kind, 'actor': actor,
               'deploymentId': deployed['id'], 'productionUrl': 'https://ecco-ai-labs.github.io/ecco-studio/'}
    # This is written only after the host confirms success; no optimistic UI result.
    gh('/releases', {'tag_name': 'prod-' + rid, 'target_commitish': sha, 'name': title,
                     'body': json.dumps(receipt, indent=2), 'draft': False, 'prerelease': False,
                     'make_latest': 'false'})
    print('Production deployment confirmed for ' + sha)


if __name__ == '__main__':
    main()
