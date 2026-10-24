# Ecco Desk

Ecco Desk uses Ecco's existing GitHub Pages host and CPU storage service.
Studio's **Support** header button opens customer support inside the Studio page.
`/ecco-studio/desk/` opens the team dashboard for assignments and customer replies.
Both reuse Studio's Google identity; customers need no storage key or GPU.

## Team setup

1. The workspace owner signs into Studio with Google and connects existing storage.
2. Open the team dashboard at `/ecco-studio/desk/`, then **Activate team access**. This explicit
   first-admin claim requires both verified identity and the existing workspace key.
3. Teammates sign into Studio and open Support once. The admin refreshes Desk and
   selects their verified account under **Team members → Add team member**.
4. Staff can assign tasks, reply to customers, change status/priority and leave
   internal notes. Admins can add or deactivate team members.

Roles use stable Google subjects, never email/domain matching. Customers see
only their own tickets. Membership changes take effect on the next request.
Adding a member does not send a message or email.

Studio customer support uses `/api/desk/support`. It applies requester-only
permissions to all accounts, including staff/admins: no other customer tickets,
internal notes, team directory or team operations. The customer page does not
link to the team dashboard. Account changes clear previously loaded tickets;
responses from the old sign-in are ignored. Authorized support agents use the
separate team dashboard and `/api/desk` to manage the support queue.

## Build and validation

```sh
cd desk
npm ci
npm run build
cd ..
node tests/ecco-desk-ui.test.mjs
PYTHONPATH=backend python3 -m unittest backend/test_ecco_desk.py backend/test_ecco_desk_mail.py backend/test_google_signin.py backend/test_storage_api.py
python3 scripts/ui_inventory.py
python3 scripts/ui_inventory.py --check
```

The generated `desk-app.mjs` and license notices are committed for Pages. React
and icons are bundled locally. The inventory indexes authored TSX/CSS instead
of duplicating the minified bundle. Styles stay inside a shadow root.

## Deployment

Deploy `backend/ecco_desk.py` and the storage API hooks to the current CPU service
before enabling the Studio entry point. Dedicated `desk_*` tables use the existing
persistent `studio.sqlite` and never enter Studio's shared records API. Back up
SQLite using its online backup API, preserve runtime configuration, and restart
only when generation/publishing work is idle. Updating Pages alone does not update
Python. In-memory Google sessions expire on service restart; sign in again.

## New-ticket email notifications

Every newly created support ticket or internal task queues one notification in
`desk_mail_outbox`, in the same transaction as the ticket. Comments and status
updates do not generate another notification. Existing tickets are not backfilled.
The confirmed destination is `support@saazztechnologies.com`.

The CPU worker delivers pending messages within about 10 seconds when configured,
without delaying ticket creation or requiring a GPU. Emails include the ticket
number, title, requester, priority, category, initial description and team-console
link. The link requires authorized team access; it does not grant access. SMTP
credentials and the recipient can never be set through customer ticket payloads.
Queued, delayed and accepted notifications appear as internal ticket activity;
customers cannot see those events. Acceptance by SMTP is not proof of inbox delivery.

Mail delivery is disabled until an outbound sender/relay is configured. Create
`/workspace/ecco-storage-private/desk-mail.json` with mode `0600` on the CPU host
(or set `ECCO_DESK_MAIL_CONFIG` to another private file):

```json
{
  "enabled": false,
  "recipient": "support@saazztechnologies.com",
  "sender": "",
  "host": "smtp-relay.gmail.com",
  "port": 587,
  "security": "starttls",
  "username": "",
  "password": ""
}
```

Set an authorized sender and configure the Workspace relay before enabling.
An IP-authenticated relay needs no username/password; an authenticated SMTP
provider needs both. Port 465 with `security: "ssl"` is also supported. TLS and
certificate verification are mandatory. Keep actual credentials only in the
private server file, never GitHub, Pages, browser storage, activity or chat.
Configuration is reloaded every 10 seconds, so activation needs no API restart.

Temporary delivery failures retry after 1, 2, 4, 8 minutes, up to once per hour,
and survive service restarts. The recipient is frozen on the first attempt.
Workers lease each message so concurrent workers do not send it twice. Retries
reuse its Message-ID; SMTP cannot guarantee exactly-once delivery if the process
crashes after acceptance but before recording success. Sent messages are never
deliberately resent. Inspect pending counts/`lastError` in the private outbox and
the service log to diagnose delivery without exposing credentials or SMTP replies.

This version supports text tickets, in-app replies/status and outbound new-ticket
notifications. Attachments, inbound email, SLAs and customer organizations are not
configured.
