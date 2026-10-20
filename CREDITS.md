# Credits and checkout

The frontend provides Account and Billing → Credits & Usage and Purchase Additional Credits. Packs: USD 25 for 500, USD 50 for 750, USD 100 for 1500. Cart quantities and billing details are held in page memory only. No card fields, payment requests, orders, or purchased-credit grants occur. Closing Billing Information discards that dialog's unsaved edits only.

The current shared workspace bearer key does not identify individual users. Consequently live per-user deductions are NOT enabled. The explicit credit-meter preview grants a separate 500-credit demo balance, deducts 100 per elapsed minute while the page stays open (including idle/background time), warns once at 100 or below, and floors at zero. Reloading ends the preview; this is not an account balance.

## Account integration still required

1. Connect individual sign-in and verify each account on the server. Do not accept a browser email or subject as authentication.
2. Mount `backend/credit_ledger.py` behind that authentication and call `heartbeat(verified_subject)` on studio entry and subsequent heartbeats. Account creation is transactional and grants 500 once; simultaneous account heartbeats share one clock. The ledger uses a 90-second heartbeat lease to avoid charging closed/offline sessions indefinitely. A deployment must test background-tab timer throttling and session termination before enabling real billing.
3. Supply `EccoCredits.connect({heartbeat: async () => authenticatedRequest(...)})`. On logout call `EccoCredits.disconnect()`. The adapter must return `{balance, used}`; the browser never writes the authoritative balance. Do not connect the existing shared-key storage API as if it were a user account.
4. Payment verification and credit grants remain intentionally unimplemented. Never grant credits merely for pressing Checkout.

There is no zero-balance job blocking yet; that behavior was not specified. Billing information is neither persisted nor transmitted in this prototype.

## Checks

`python -m unittest discover -s tests -p 'test_credit_ledger.py'` (with backend on PYTHONPATH).
`node --test tests/credits-store.test.cjs` (requires jsdom).
