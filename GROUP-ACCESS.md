# Studio tester group activation

Status: implementation prepared; deployment and Google administration are separate.
Creating the Google Group alone does not authorize Directory API access.

## Access boundary

Only a server-verified Google session with verified email, the configured hosted domain, and confirmed membership in the configured tester group receives tester permissions.
The server checks Google's immutable subject, not a client-supplied email or role.
Membership results are cached for at most 60 seconds after Google's directory
reflects a change; failures after cache expiry deny access.

Testers share the existing workspace (stories, media, and drafts saved there).
This is not per-user media isolation. They can use configured AI and submit work
to already-running generation services. They cannot create/start/stop GPUs,
change API keys, change AI configuration, publish, purge, or enable unattended
schedules. Existing owner-key access and Ecco Desk permissions remain unchanged.
No private storage key, AI key, Directory credential, or RunPod key is sent to testers.

## Google administrator setup

1. Enable the Admin SDK API in the project's Google Cloud console.
2. Create a dedicated service account for group membership checking.
3. A Workspace super administrator must authorize that service account's numeric
   client ID in Security > Access and data control > API controls >
   Manage Domain Wide Delegation, with ONLY this scope:

   https://www.googleapis.com/auth/admin.directory.group.member.readonly

4. Keep organization policies disabling service-account key creation enabled.
   Enable the IAM Service Account Credentials API as well as Admin SDK API.
5. Deploy `services/group-reader` to Cloud Run with a dedicated runtime identity.
   Grant that runtime identity `iam.serviceAccounts.signJwt` on the group-reader
   service account only (a custom role containing only that permission is sufficient).
   Do not grant project-wide Token Creator. No user-managed Google key is required.
6. Configure these server-only environment variables on the Cloud Run service:
   - GROUP_READER_SERVICE_ACCOUNT: the delegated service account email
   - GROUP_READER_ADMIN: an administrator permitted to read group members
   - GROUP_READER_GROUP: the one authorized tester group
   - GROUP_READER_SECRET: a random server-to-server secret of at least 32 characters,
     injected from Secret Manager, never included in source or deployment logs
7. The broker requires HTTPS ingress reachable by the existing backend. Cloud Run
   IAM unauthenticated invocation permits requests to reach the application's
   bearer-secret check; this is NOT an unauthenticated membership API. Every
   membership request needs the private secret. Do not give this secret to browsers.
   Deploy with minimum instances 0 and maximum instances 1 initially. Confirm
   region, billing, IAM grants and ingress before deployment. Public ingress can
   incur invocation cost even when an application request is denied.
8. Place the same broker secret in a private file on the existing CPU backend,
   mode 0600. Set ECCO_GROUP_ACCESS_CONFIG to a private JSON file, mode 0600:

   {
     "enabled": true,
     "domain": "<Workspace domain>",
     "broker_url": "https://<Cloud Run hostname>/membership",
     "broker_secret_file": "<protected server-to-server secret file>"
   }

The broker uses ADC to call signJwt, exchanges the signed assertion for a scoped
short-lived Directory token, then reads the fixed group's membership. It returns
only the checked subject and a boolean. Redirects from the broker are rejected by
the backend; responses must match the requested subject. Directory failures fail
closed. The broker secret is separate from Google credentials and must be rotated
on both services if exposed. The legacy JSON-key path remains supported in code
for existing deployments but is not required or recommended for this setup.

A missing, disabled, malformed or unreadable configuration denies tester access.
Changing enabled to false disables access on the next backend request, even when
a positive membership result was cached.

## Deployment and acceptance

Deploy the backend modules first using the existing CPU service interpreter and
backend/requirements-auth.txt. Restart only its established supervisor, preserving
the database and existing keys. Backend restart expires existing Google sessions.
Then deploy the frontend assets and index cache versions.

Run backend/test_workspace_access.py, backend/test_google_signin.py and
tester-access.test.cjs before activation. With real Google accounts, verify a
member can sign in and load Storage/AI without a key or page navigation; a
nonmember is denied; removing membership denies subsequent requests after the
directory change and cache expiry. Test denied GPU power/key/publishing requests
without launching compute. Real Google directory authorization and end-to-end
browser sign-in must be verified before announcing live access.

References:
- https://developers.google.com/workspace/admin/directory/reference/rest/v1/members/hasMember
- https://developers.google.com/identity/protocols/oauth2/service-account#delegatingauthority
