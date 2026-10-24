# Ecco Desk

Ecco Desk uses Ecco's existing GitHub Pages host and CPU storage service.
Studio's **Support** header button opens customer support inside the Studio page.
`/ecco-studio/desk/` opens the team dashboard for assignments and customer replies.
Both reuse Studio's Google identity; customers need no storage key or GPU.

## Team setup

1. The workspace owner signs into Studio with Google and connects existing storage.
2. Open **Team workspace** from Support, then **Activate team access**. This explicit
   first-admin claim requires both verified identity and the existing workspace key.
3. Teammates sign into Studio and open Support once. The admin refreshes Desk and
   selects their verified account under **Team members → Add team member**.
4. Staff can assign tasks, reply to customers, change status/priority and leave
   internal notes. Admins can add or deactivate team members.

Roles use stable Google subjects, never email/domain matching. Customers see
only their own tickets. Membership changes take effect on the next request.
Adding a member does not send a message or email.

## Build and validation

```sh
cd desk
npm ci
npm run build
cd ..
node tests/ecco-desk-ui.test.mjs
PYTHONPATH=backend python3 -m unittest backend/test_ecco_desk.py backend/test_google_signin.py backend/test_storage_api.py
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

This version supports text tickets and in-app replies/status. Attachments, email
intake/notifications, SLAs and customer organizations are not configured.
