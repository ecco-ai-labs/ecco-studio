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

4. Choose a delegated Workspace administrator authorized to read group members.
   Store the service-account JSON on the CPU server, outside the repository and
   web root, mode 0600. Never paste its private key into chat or GitHub.
5. Set ECCO_GROUP_ACCESS_CONFIG to a private configuration file, mode 0600:

   {
     "enabled": true,
     "group": "<tester group email>",
     "domain": "<Workspace domain>",
     "service_account_file": "<protected service-account JSON file>",
     "delegated_admin": "<authorized Workspace administrator email>"
   }

The group address and domain remain in private server configuration; the read-only scope is fixed in code.
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
