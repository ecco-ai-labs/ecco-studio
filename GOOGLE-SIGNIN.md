# Google sign-in deployment

The configured web Client ID is public. No Google client secret is needed for
this Google Identity Services flow. Audience must be External, and the exact
GitHub Pages origin https://ecco-ai-labs.github.io must be authorized in Google
Cloud. No hosted-domain restriction is applied. Workspace administrators can
still restrict their users' access to external applications.

## Backend activation (CPU storage service, no GPU needed)

Deploy backend/google_signin.py and backend/storage_api.py from this commit to
the existing CPU service checkout. Use that service's Python interpreter:

    python -m pip install -r backend/requirements-auth.txt

Restart the existing storage API using its established process supervisor.
Do not start a second service on port 8888. Do not replace the database or keys.
The running service must return 200 for GET /api/auth/config with the header
Origin: https://ecco-ai-labs.github.io. Until then the UI reports sign-in service
not enabled; it never claims that an unverified Google response is a signed-in
user. No runtime deployment credentials are stored in this repository.

## Verification

Run: python -m unittest discover -s backend -p 'test_google_signin.py'
and python -m unittest discover -s backend -p 'test_storage_api.py'.
Then sign in manually using one Gmail and one Workspace test account. Confirm
name appears, logout revokes session, and a fresh account cannot list existing
workspace media or start inference. Actual Google credential verification and
consent require this live manual test; mocked tests are not a real login.

## Current scope

This is identity-only sign-in, not yet a mandatory entry gate or multi-tenant
workspace provisioning. Existing private-key access remains unchanged. Google
sessions use sessionStorage in the tab and memory in the server, last at most
one hour, and end on tab closure or server restart. A reload restores identity
only after successful server verification through /api/auth/me. User identity uses Google's stable sub claim;
email is display-only, never an account-linking or workspace authorization rule.
Sign-out revokes the session, clears this tab's shared workspace key, and reloads.
Existing browser-local drafts/settings are not yet isolated per Google account;
do not treat this release as public multi-user production readiness.
No credit deductions, shared workspace permissions or paid compute are enabled
by signing in. No automatic YouTube authorization is requested.

For domain migration, update both Google Authorized JavaScript origins and the
backend CORS origin policy. Keep this Client ID to preserve account identity.
