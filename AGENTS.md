# Ecco Studios UI changes

For every UI change, read `design-system/README.md` and
`design-system/ui-contract.json` before editing.

- Use the registered object type and property groups. Add new types, properties,
  variants and explicitly approved exceptions to the contract in the same change.
- Preserve user-approved appearance and behavior. Do not add controls, rename
  labels, change dimensions or normalize styles without user authorization.
- Regenerate `design-system/ui-inventory.json` with
  `python3 scripts/ui_inventory.py` after changing UI source.
- Run `python3 scripts/ui_inventory.py --check` and review the inventory diff.
- Inventory refresh is not a substitute for checking the actual UI. Inspect
  affected states, keyboard focus and nested popup dismissal when applicable.
- Existing numerical styles are evidence, not approved shared defaults. Do not
  claim registry-only edits change the live UI.

# UX QA coverage

- For every new feature or workflow change, add or update the observable browser
  checks in `qa/tests/workflows.spec.js` and the scope in `qa/coverage.json`.
- Follow `qa/README.md`. Run the browser suite when infrastructure permits, or
  inspect the GitHub UX QA Agent run and report its actual outcome.
- Keep known bugs as failing acceptance checks until the product is repaired.
  Do not skip a failed check, weaken an expectation, or auto-approve screenshots
  merely to make the workflow green.
- Report live-service checks that require test accounts or compute as blocked;
  passing synthetic frontend fixtures does not establish end-to-end success.
