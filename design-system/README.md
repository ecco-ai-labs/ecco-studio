# Master UI Object Registry

This is the master list for Ecco AI Labs Studios UI objects and their properties.
It records the existing implementation and establishes the contract for future
components. It does not change the running UI or claim existing styles are unified.

## Master files

| File | Purpose |
|---|---|
| [ui-contract.json](ui-contract.json) | Shared property groups, approved rules, component types and type-specific properties |
| [ui-inventory.json](ui-inventory.json) | Generated inventory of source objects, their attributes, creation locations, style blocks and property/event assignments |
| [../scripts/ui_inventory.py](../scripts/ui_inventory.py) | Regenerate or verify the inventory |

## Properties every object must account for

| Group | Properties |
|---|---|
| Identity | ID, type, variant, parent, source location |
| Appearance | Font, size, weight, line height, text/background/border colors, border width/radius, shadow, opacity, icon size |
| Layout | Width/height and limits, padding, margin, gap, alignment, positioning, overflow, responsive rules, stacking order |
| Content | Label, text, placeholder, tooltip, icon, value, dropdown options |
| States | Default, hover, keyboard focus, pressed, selected, disabled, loading, connected/disconnected, error, empty, expanded/collapsed |
| Interaction | Action, events, keyboard behavior, dismissal, validation, single/multiple selection |
| Accessibility | Accessible name, role, label association, tab order, focus management, ARIA states and error announcements |
| Usage | Screens, selectors, instances, approved exceptions and implementation status |

## Object families

| Family | Included objects |
|---|---|
| Text | Labels, headings, body/help text, links |
| Actions | Buttons, icon buttons, popup close buttons |
| Icons | Decorative icons, status indicators |
| Inputs | Text, password, number, search, multiline text, date/time, file upload, sliders |
| Selection | Checkbox, radio, switch, dropdown, option, multi-select |
| Navigation | Menus/items, tabs, toolbar, sidebar, step navigation, collapsible sections |
| Surfaces | Popups, drawers, panels, cards, containers, header/footer |
| Libraries | Library root, labels, items, selection and view controls |
| Content | Lists/items, tables/cells, images, audio, video, canvas, PDF preview |
| Feedback | Progress, spinner, badge, error, notification, tooltip, empty state |
| Workflow | Forms, field groups, workflow nodes, costs, code/log displays, dividers |

## Adding or changing an object

1. Find its type in `ui-contract.json`. Reuse it; register a new type only when needed.
2. Account for all property groups. Use explicit `not applicable` in reviewed specifications where appropriate. Do not invent UI changes or numerical defaults.
3. Record any new variants, properties and approved exceptions in the contract in the same change.
4. Implement the change, then run `python3 scripts/ui_inventory.py`.
5. Commit the updated contract, source and inventory together. Run `python3 scripts/ui_inventory.py --check` before merging.

The CI check fails when scanned UI source changes without a matching inventory
refresh. Reviewers must still check component semantics and the visual result;
regeneration alone does not prove consistency.

## Coverage and limitations

The inventory scans all repository HTML, CSS and JavaScript except generated
registry content, scripts, tests and dependencies. It records HTML opening tags,
literal `createElement` calls, attributes, complete CSS files, recognized embedded
style templates and source lines containing property/event assignments. Each source
file is hashed, including dynamically constructed code the recognizers cannot parse.

Repeated scenes/library entries are represented by their source template, not by
user data. Dynamic expressions remain verbatim. Source positions identify evidence;
they are not permanent component IDs. Some declarations are hidden, replaced or
unused at runtime. CSS cascade, runtime-generated names and computed responsive
styles require browser inspection; the inventory does not label a source value as
the final rendered value. No credentials, workspace content or generated media are
collected by the generator.

## Applying systemic changes

The contract is the specification. The current source still contains independent
styles; editing the registry alone will not restyle screens. Migrating those styles
into shared CSS tokens/components is the next implementation step after visual
standards are approved. Existing approved color/close-button behavior is recorded;
unapproved dimensions remain unset instead of being silently chosen.

## Color theme

Activity → Theme offers exactly four packages: Default, Dark Mode,
Forest and Desert in a side-sliding menu matching Billing. Selecting a preset
saves immediately. Choosing Default restores the original palette. The selected
preset persists in this browser. Moving the pointer away retracts the panel. No individual color inputs are exposed. Older custom
color settings are ignored; the initial package is Default.

| Package | Colors |
|---|---|
| Default | Existing purple and yellow palette |
| Dark Mode | Black page, dark grey surfaces, light grey borders and accents |
| Forest | Green page, lighter green surfaces, white borders and accents |
| Desert | Sand page, light sand surfaces, brown borders and accents |

Only colors change; fonts, dimensions, spacing, layout, wording and actions remain
fixed. `theme.js` maps accessible CSS color declarations and dynamic inline styles
to shared variables while preserving original values as Default fallbacks. Media
pixels and cross-origin styles are not recolored. This remains a color bridge,
not a completed shared-component migration.

Activity, Logs and Errors is accessed through the right-edge sliding-panel arrow,
not through an item in the Activity menu. Its Activity, Debugging and Errors tabs
remain available in that panel.

Connection icons use separate status colors: Default white/yellow, Dark Mode grey/mint, Forest white/yellow, Desert brown/green (disconnected/connected). All menu and slide-out surfaces inherit the selected theme. Status colors follow existing live connection attributes; theme selection never changes connection state.
