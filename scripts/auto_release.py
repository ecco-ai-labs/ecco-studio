"""Automatically publish each successful main-branch build to production.

Owner decision (8 November 2026): for rapid development, every push to main that
passes Release checks goes live without a manual Ecco Desk release. It reuses
publish_release.py, so the same tested artifact, provenance and hash checks
apply. Ecco Desk Releases remains available for rollbacks.
"""
import os
import re
import secrets

import publish_release


def plan(sha, main_status, current_sha):
    """Return the expected production SHA to publish over, or None to skip."""
    if main_status != 'identical':
        return None  # A newer commit is on main; its own run will deploy it.
    if current_sha == sha:
        return None  # Already live.
    return current_sha


def main():
    sha, run_id = os.environ['SOURCE_SHA'], os.environ['CHECK_RUN_ID']
    publish_release.require(re.fullmatch('[0-9a-f]{40}', sha) and run_id.isdigit(), 'Invalid build identifiers.')
    account, project = os.environ['CLOUDFLARE_ACCOUNT_ID'], os.environ['CLOUDFLARE_PAGES_PROJECT']
    publish_release.require(re.fullmatch('[a-f0-9]{32}', account) and re.fullmatch('[a-z0-9-]{1,58}', project), 'Invalid hosting configuration.')
    hosting = publish_release.api(f'https://api.cloudflare.com/client/v4/accounts/{account}/pages/projects/{project}', os.environ['CLOUDFLARE_API_TOKEN'])
    current = hosting.get('canonical_deployment')
    current_sha = ((current or {}).get('deployment_trigger', {}).get('metadata', {}).get('commit_hash')) or 'none'
    status = publish_release.gh('/compare/' + sha + '...main')['status']
    expected = plan(sha, status, current_sha)
    if expected is None:
        print('Skipped: ' + ('already live.' if current_sha == sha else 'a newer commit is on main.'))
        return
    os.environ.update(RELEASE_ID=secrets.token_hex(16), EXPECTED_PRODUCTION_SHA=expected,
                      RELEASE_TITLE='Automatic release ' + sha[:7], RELEASE_KIND='release',
                      RELEASE_ACTOR=os.environ.get('RELEASE_ACTOR') or 'github-actions')
    publish_release.main()


if __name__ == '__main__':
    main()
