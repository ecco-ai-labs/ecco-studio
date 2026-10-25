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

Settings → Theme offers six packages: Default, Dark Mode,
Forest, Desert, Ocean and Dark Sky in a side-sliding menu matching Billing. Selecting a preset
saves immediately. Choosing Default restores the original palette. The selected
preset persists in this browser. Moving the pointer away retracts the panel. No individual color inputs are exposed. Older custom
color settings are ignored; the initial package is Default.

| Package | Colors |
|---|---|
| Default | Existing purple and yellow palette |
| Dark Mode | Black page, dark grey surfaces, light grey borders and accents |
| Forest | Green page, lighter green surfaces, white borders and accents |
| Desert | Sand page, light sand surfaces, brown borders and accents |

Ocean and Dark Sky add glass surfaces and blue accents through `glass-themes.css`, with gradient backdrops and opaque accessibility fallbacks. Existing presets remain color-only. Fonts, dimensions, spacing, layout, wording and actions remain
fixed. `theme.js` maps accessible CSS color declarations and dynamic inline styles
to shared variables while preserving original values as Default fallbacks. Media
pixels and cross-origin styles are not recolored. This remains a color bridge,
not a completed shared-component migration.

Activity, Logs and Errors is accessed through the right-edge sliding-panel arrow,
not through an item in the Settings menu. Its Activity, Debugging and Errors tabs
remain available in that panel. Background refresh reconciles existing rows and
preserves open log entries, reading selection and scroll position. Audio worker
progress is shown verbatim, including reconnect waits; Audio Debugging shows
compute, model, status and submitted speech instead of image-reference fields.

GPU buttons and the AI, Storage and GPU connection icons share status colors: Default white/yellow, Dark Mode grey/mint, Forest white/yellow, Desert light brown/dark brown (disconnected/connected). All menu and slide-out surfaces inherit the selected theme. Status colors follow existing live connection attributes; theme selection never changes connection state.

## Accelerator connections

Connections → GPU groups RunPod instances in the existing B200 and A100 cards.
Each card has an instance dropdown and a button showing Connected, Unavailable
or Connect for that instance. Only Connect is enabled. Connecting an instance adds it to the connected set; other instances stay
connected, including others of the same class. Choices do not connect automatically.
Saved connections require a fresh authenticated health response before displaying
Connected. Availability refreshes every 20 seconds.

The top ribbon Settings menu retains the internal Activity category identifier. Its file browser is labeled Workspace Drive, including its dialog title and accessible name.

## Audio characters and AI scripts

Audio Studio adds a Characters section using the existing generation controls. Names
and IDs remain independent of voice choices; voices and emotion are assigned in
Additional Controls. News starts with one newsreader; podcasts start with a host
and guest until the user customizes the cast.

Generate with AI on every Audio story setup and in Audio Studio opens the same
four-step modal: Source → Questions → Characters → Script. Audience, genre,
language, tone and source-specific questions guide suggested character counts and
properties. Audience uses genre-specific categories in both the main form and Questions;
changing genre retains valid selections and clears incompatible ones. Existing saved
audiences remain available when reopening. Character names, roles, gender, age group and speaking style are editable.
Save Characters explicitly stores reusable named sets in this browser for later chapters.
Menus and AI guidance, questions and explanations stay in English. The chosen language
applies to the generated script; source quotations and character names are preserved.
Pending AI actions show the shared revolving generation indicator and a busy label.
Script follow-up questions stay on the current screen with earlier answers and cast
edits intact; only a valid script moves to review. Failures allow a retry in place.
Language Style is chosen before script generation and defaults to Everyday / Conversational.
Child-friendly, conversational with English (Hinglish for Hindi), formal, literary
and custom styles guide vocabulary and sentence complexity. This choice and custom
instructions carry through Apply and into later chapters; the interface stays English.

Opening and Closing are optional direction boxes in Questions. Blank boxes omit those
sections; requested wording or directions are adapted into the selected script language.
Review labels and edits the generated bookends, and Apply carries them into audio.

Uploads use the same shared source-picker as the main Story Upload: Upload menu,
Preview & Select, resizable page preview and an editable selected-text box. PDF pages
remain available in full for selection; TXT/Markdown use a selectable text preview.
Only applying a selection changes the source, up to 20,000 characters for Audio.
Closing the nested viewer preserves its parent and returns focus to Upload.
Uploads are read locally. Selecting a passage replaces the source before any
AI call; unselected text and unrelated story records are never sent. The chosen source
is sent when Read Source is clicked. Generated character-assigned turns remain editable.
Apply fills the main fields; Save and Continue with Script preserves subsequent manual
edits and the character-to-turn mapping. Neither action starts speech generation.
Story saves show the shared revolving indicator and Saving Story… inside the submit
button. A confirmed save proceeds immediately; normal background polling refreshes
the wider workspace. Failed saves restore the idle button and retain the draft.
Existing audio limits, voice controls and compute choices remain in force. Topic-only
News uses cited research and displays its sources before Apply.

## Audio workflow scheduling

The existing workflow canvas now offers Save Workflow, Run Now, Enable Schedule,
Pause Schedule and Run History for news, podcast topic/paper and book chapters.
Controls require the authenticated workspace to advertise its scheduler. Saving
pauses a definition; enabling is explicit. Run Now preserves an existing schedule.
Local edits do not replace an active server definition until saved. Removing a
persisted audio workflow pauses it before hiding it in this browser Trash.

The CPU workspace runner retains definitions, source evidence, scripts and run
results. It uses the selected compute without fallback or GPU provisioning.
GitHub Pages publication alone does not deploy this backend or activate schedules.

## Storytelling, chapter selection and final-script review

Generate Script now includes an audience-focused editorial and delivery pass before
review. It preserves the selected source, plot and character assignments while
requesting idiomatic spoken language and genre-appropriate listening structure.
Delivery cues are stored separately from speech. Additional Controls uses one
keyboard-accessible tab per character, with voice preview, style, emotion, pitch,
speed, pause, language/accent and extra instructions. Only supported native controls
are applied; identical UI does not guarantee identical performance from all models.

Both PDF upload surfaces support physical page ranges and Find Chapter with AI.
The locator reads a numbered outline and verifies boundary pages; local extraction
uses exact anchors and excludes the next chapter. It never falls back to the
book opening or truncates an oversized chapter. Apply commits the reviewed excerpt.
Only that excerpt goes to narrative generation, while the locator necessarily
inspects book structure. New uploads block stale-source reuse until selection.

Final Script appears beside Review Audio. Select a passage, choose Improve with AI,
enter instructions above the selected text and review the replacement. Apply changes
only that range, rejects stale edits and preserves character assignments. Existing
recordings stay unchanged until the user generates again.

Per-character native controls require the matching CPU coordinator and audio worker
update; GitHub Pages publication alone does not install that runtime.

## Narrative sound design

Review Audio → Music & Effects opens the shared Sound Design modal. AI suggests
cues from the final spoken script and the user's directions; it does not generate
audio files. Users select existing Audio Library recordings or upload sounds in a
nested dialog, preview them, choose passage/phrase timing, gain, fades, looping and
automatic volume reduction under narration, then Apply. Exact phrase triggers split
speech before synthesis, so mixing uses measured PCM boundaries rather than guessed
word timings. Missing files and changed scripts require review before generation.

The matching service/worker update enables one mixed stereo WAV across all speech
models. Per-compute capability gates stop older workers from silently dropping the
soundtrack. No GPU is provisioned and no new model is installed. Cues currently
apply to individual recordings; schedules reject them because each new script needs
new cue timing. Final Script textareas expand to fit their complete contents.

## Approved storybook journey — 24 October 2026

Generate with AI exposes Upload Paper / Text directly and uses a Tone dropdown
with custom instructions. Chapter selection reports local extraction and AI
boundary progress beside the controls. The Script step supports exact-selection
improvement and repeated refinement before Apply, followed by uniquely named
sound cues. Saving persists the cast, selected source, script and sound plan,
then opens Audio. The right-hand workspace uses Final Script, Progress and
Review tabs with native keyboard navigation and the existing theme styles.

Per-cue sound generation uses isolated MOSS SoundEffect v2 / ACE-Step 1.5
workers and the existing durable Audio Library. Availability requires an
installed, verified runtime on the explicitly selected compute; no fallback.
The earlier description of library-only sound design is superseded by this
authorized generation path. Runtime, live end-to-end and listening acceptance
are separate release gates; local tests do not establish artistic quality.

## Ecco Desk email and live support

Customer support tickets keep email, in-app replies and live-chat messages in one
conversation with a source label. Online support in the ticket drawer joins a
FIFO waiting queue; a chat becomes live only after an available staff member
accepts it in the team console's Live support view. Staff availability requires
continued presence; a lost agent returns the customer to the queue. Closing the
customer's ticket eventually expires their presence. Customers can leave the
queue or end chat and resume email replies. Internal notes remain private.

Hours are enforced by the server: 7 AM–11:59 PM America/Los_Angeles, every day,
including PST/PDT. At closing time live sessions return to ticket replies.
Live messages do not produce an email for every chat message. Administrators
connect the support mailbox in Team members; inbox authorization and reply
synchronization are separate from the existing outbound SMTP relay.

## Minimize and save preparation drafts

Studio native dialogs share a Minimize control beside Close. The Resume popups
menu keeps each nested stack and its originating screen alive while the user
visits another screen or Connections. Minimize does not run close cleanup.
The menu explicitly distinguishes in-tab retention from saving before refresh.

Generate with AI and both source-pickers offer Save Draft. Browser IndexedDB
stores the local document, excerpts and complete preparation step, including
answers, cast, script edits and named sounds. Resume Saved Draft/Selection is
explicit and never generates or applies content. Story Library retains the
parent local story. Nothing is sent to AI or workspace storage by Save Draft;
the saved draft is available only in the same browser profile. Credentials are
not part of the draft schema. Missing AI/storage is explained before Continue,
and Open Connections minimizes the preparation without discarding it.

Number of Turns retains its existing editable proposal. If Generate Script returns
a different valid count, pause on Characters and show the requested and actual
counts, the preserved draft and an explicit Continue with N turns action. The
creator can instead change the requested count and generate again. Failed retries
keep the candidate; source/brief/cast edits prevent stale acceptance. Save Draft
also retains this unresolved decision. Character coverage and runtime limits still
apply. A failed editorial pass retains the valid script for targeted refinement.

The Studio headset shows a small count of tickets with unread public support
responses. Counts and read receipts are scoped to the signed-in requester and
each ticket. Opening its visible conversation acknowledges only the responses
actually loaded. Other tickets and later responses remain unread.

Customer support reply indicators use per-ticket unread counts: a small count on
the headset, a highlighted ticket row with Support replied, and New reply in the
conversation tab. Read receipts wait until the latest support reply end is visible
in the focused drawer; loading or polling a conversation alone does not clear it.

Customer ticket drawers include Close issue and Reopen issue. Closing preserves
history and ends a queued or active chat. Closed issues must be reopened before
joining online support. The drawer X only dismisses the panel.

Ecco Desk staff use a separate Google session from Studio customers. Accepting a
case or chat establishes one owner; public responses and resolution require that
owner, and delegation transfers responsibility to an active agent. Customers have
Close issue and Reopen issue without deleting history. Mailbox action buttons
compose explicit commands whose acknowledgements stay private to the agent.
Native Chat cards use the same server rules and remain disabled until the
interactive Google Chat app is configured for the approved space.
