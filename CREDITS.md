# Credits and checkout

The frontend provides User → Credit and Usage → Purchase Additional Credits. Packs: USD 25 for 500, USD 50 for 750, USD 100 for 1500. Cart quantities and billing details are held in page memory only. No card fields, payment requests, orders, or purchased-credit grants occur. Closing Billing Information discards that dialog's unsaved edits only.

The current shared workspace bearer key does not identify individual users. Live per-user deductions are not enabled. Google sign-in is implemented, but the authenticated credit-ledger adapter is not connected. A verified signed-in account therefore shows **Unavailable** for Available credits, while a signed-out account shows **Sign in to view**. A balance is displayed only after an authenticated adapter returns it; the starting allowance is not used as a fabricated current balance. No credit-meter preview is exposed.

## Account integration still required

1. Use the existing server-verified individual Google identity. Do not accept a browser email or subject as authentication.
2. Mount `backend/credit_ledger.py` behind that authentication and call `heartbeat(verified_subject)` on studio entry and subsequent heartbeats. Account creation is transactional and grants 500 once; simultaneous account heartbeats share one clock. The ledger uses a 90-second heartbeat lease to avoid charging closed/offline sessions indefinitely. A deployment must test background-tab timer throttling and session termination before enabling real billing.
3. Supply `EccoCredits.connect({heartbeat: async () => authenticatedRequest(...)})`. On logout call `EccoCredits.disconnect()`. The adapter must return `{balance, used}`; the browser never writes the authoritative balance. Do not connect the existing shared-key storage API as if it were a user account.
4. Payment verification and credit grants remain intentionally unimplemented. Never grant credits merely for pressing Checkout.

There is no zero-balance job blocking yet; that behavior was not specified. Billing information is neither persisted nor transmitted in this prototype.

## Checks

`python -m unittest discover -s tests -p 'test_credit_ledger.py'` (with backend on PYTHONPATH).
`node --test tests/credits-dismissal.test.cjs google-signin.test.cjs` (requires jsdom).
`node --test tests/account-flyouts.browser.test.cjs` (requires Playwright and Chromium; optionally set `CHROMIUM_EXECUTABLE_PATH`).

The account slide-outs have no × control. Hover opens a panel when none is open; click switches between Credit and Usage and Billing. Pointer travel and hovering neighboring rows keep the current panel available. Click outside or dismiss the parent menu to close; Escape/ArrowRight returns focus to the source row. Keyboard focus leaving the parent menu also dismisses the panel. Purchase keeps its resting colors on hover, with the keyboard focus outline retained.
