# Ecco Studios UI changes

For every UI change, read `design-system/README.md` and
`design-system/ui-contract.json` before editing.

- Use the registered object type and property groups. Add new types, properties,
  variants and explicitly approved exceptions to the contract in the same change.
- Preserve user-approved appearance and behavior. Do not add controls, rename
  labels, change dimensions or normalize styles without user authorization.
- Sizes (font size, height, width) come only from the master size roster,
  `design-system/size-roster.json`. An element whose type is in the roster must
  not set its own size. Add a new kind of element to the roster (type or variant)
  in the same change, run `node scripts/size_roster.mjs`, and keep ROSTER-01
- Theme colors also live only in `design-system/size-roster.json` (`colors`). Change them there and run
  `node scripts/size_roster.mjs`; it regenerates the PALETTE/PRESETS lines in `theme.js` and the backdrops in
  `glass-themes.css`, and `--check` fails CI if they drift.
  passing. Administrators can also change the live roster in Studio > User
  Preferences > Look and Feel.
- Regenerate `design-system/ui-inventory.json` with
  `python3 scripts/ui_inventory.py` after changing UI source.
- Run `python3 scripts/ui_inventory.py --check` and review the inventory diff.
- Inventory refresh is not a substitute for checking the actual UI. Inspect
  affected states, keyboard focus and nested popup dismissal when applicable.
- Existing numerical styles are evidence, not approved shared defaults. Do not
  claim registry-only edits change the live UI.

# UX QA coverage

- The user stopped automatic UX QA Agent runs. Keep `ux-qa-agent.yml` manual-only;
  do not restore push, pull-request or scheduled triggers without their request.
- For every new feature or workflow change, add or update the observable browser
  checks in `qa/tests/workflows.spec.js` and the scope in `qa/coverage.json`.
- Follow `qa/README.md`. Run the browser suite when infrastructure permits, or
  inspect the GitHub UX QA Agent run and report its actual outcome.
- Keep known bugs as failing acceptance checks until the product is repaired.
  Do not skip a failed check, weaken an expectation, or auto-approve screenshots
  merely to make the workflow green.
- Report live-service checks that require test accounts or compute as blocked;
  passing synthetic frontend fixtures does not establish end-to-end success.
