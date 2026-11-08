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

User Preferences → Themes offers six packages: Default, Dark Mode,
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

Left-navigation rows remain unboxed in all six themes: transparent backgrounds,
no borders or shadows, theme-accent selection text and visible keyboard focus.
This includes Library branches/actions, production steps and Trash; sidebar
surfaces and popup menus retain their existing theme treatment.

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

The top ribbon Settings control panel has three icons: Model Garden (sprout), User Preferences (sliders), and Workspace Drive (drive). It matches the adjacent panels with 32px icon targets, 16px SVGs, equal 8px gaps, immediate hover/focus labels and theme-aware surfaces. User Preferences contains only Themes and retains the internal Activity category identifier. Existing model navigation, theme persistence and file browsing are reused. Its file browser is labeled Workspace Drive, including its dialog title and accessible name. Type, Location and a self-contained Search box share one ribbon, with Search last. It filters immediately by file name, title or path as the user types, combined with Type, Location and job scope. Matching is case-insensitive; clearing the search restores the current scope. The result count and empty state update without moving typing focus. Files appear in a sortable table with Name, Kind, Date Last Opened and Date Created. Header arrows show both sort directions and highlight the current one. File names open a preview with existing download/trash actions. The enlarged popup uses compact single-line rows and short display names without generated duration/frame-edit suffixes or extensions; original names remain in tooltips and search. The All jobs and stories button is removed. Last-opened dates track explicit Drive previews in this browser, scoped to the signed-in user and workspace; unknown dates display an em dash and sort last.

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

Final Script starts with the existing Spoken script overview and actions, followed
by numbered turns. Each turn exposes Add Sound and its named cue cards. Expand a
cue to describe/generate a sound, attach Audio Library audio, upload or preview it;
settings and timing/mix controls stay collapsed. Generate with AI and exact-range
Improve with AI retain their existing dialogs and Apply behavior.

Generate audio automatically generates missing cue assets serially on the selected
compute, saves each assignment, then submits the complete speech and soundtrack.
If music/effects are enabled without cues, AI first plans cues from the spoken
script. Existing assets are retained; disabled sound design is untouched. Confirmed
sound jobs resume after interruption, failed jobs can retry, and an uncertain POST
response blocks automatic resubmission. Script edits still require timing review.
The existing Music & Effects modal remains available for whole-plan edits.

The Progress tab renders a native bar from actual worker passage counts, followed
by “Generating Speech: 1 of 14 passages complete”. Without a worker count it is
indeterminate; sound generation and mixing show their own real status.

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

## Mixed character models and voice samples

Prepared update: each character has a Character Model override in the existing
Additional Controls tab. Recording default remains available; explicit overrides
and saved model voices survive switching. Voices are filtered by language. Listen
opens a short editable sample using the character settings, reuses saved samples
and resumes confirmed preview jobs. It does not replace the story script.

Weights live once under shared models storage. Device-specific runtimes load those
weights on the selected worker. Mixed speech renders one model group at a time,
then restores passage order and applies original pauses and the existing soundtrack.
Live runtime qualification and authenticated playback remain release gates.

## Character generation and Blender

Image Studio → Generate with AI offers Character alongside the existing prompt
operation. Six stages retain explicit approval checkpoints: Appearance, Character
set, 3D model, Rig, Performance and Export. Named actors, jobs and outputs persist
in the workspace. Closing or minimizing preserves work; Stop cancels one job.

The prepared backend connects existing image generation, TRELLIS.2 reconstruction,
UniRig body rigging and Blender procedural movement previews. Facial shape keys
are validated separately; no automatic facial rig generation is claimed. Missing
worker qualification disables the relevant generation control with an explanation.
Model preview uses bundled model-viewer, tracked by inventory hash. Existing
generation styles and popup controls remain in use. Live deployment and visual
acceptance are separate gates from the local automated tests.


## Clips & Frames

Video Studio Review and its AI menu open a frame contact sheet with 3–4 second
review segments. Original 25 fps frame IDs remain stable through nonconsecutive
selection, cuts, reinsertion, replacement and undo/redo. Context repair requests
are prepared locally; the UI does not claim an installed AI repair worker.
Browser drafts are scoped by account, story and source. CPU export is separately
capability-gated, cuts matching audio intervals and creates a new library asset.
Local file review does not upload the source or modify the original file.
See `video/FRAME_REVIEW.md` for workflow and validation details.

Frame review keeps its preview/group selectors compact and names the active local video. Thumbnail decoding is serialized across navigation; definitive rejected exports can be retried with updated edits.

## Three-tab story workspace — 7 November 2026

Tell Your Story → New Story now opens one workspace with three browser-style tabs:
Story Details, Story & Characters, and Generate & Publish. Details collects output,
type, genre, age group, language, optional location and recurrence. The second tab
uses the existing PDF selection experience or an editable script, with explicit AI
suggestions and editable library characters. Model and character properties are
collapsed until needed. The third tab embeds the selected existing studio and its
real generation/progress/review controls; video can prepare audio and images here.

Draft fields save in this browser. Continue saves new stories to connected storage;
this does not claim cross-device synchronization of all setup fields. Existing
studio edits and completed assets are retained; jobs only start on Generate. AI
suggestions cannot overwrite intervening edits. Unknown story-create outcomes
block duplicate submissions. Publish reuses the existing approved-video destination
and scheduling controls within tab three. Audio/image publishing remains unavailable;
downloads remain available. Recurring prepares a new episode/chapter and never
enables an automatic schedule. Standalone Studio and its advanced preparation remain.

## Compact library file browser — 7 November 2026

All five main libraries open in List, with Small icons and Large icons next.
Rows share sortable File Name, Type, Date Created and Date Last Accessed columns.
There are no item boxes; the icon views replace the name with a 28px or 64px
preview, retaining its filename tooltip and accessible name. Search, filters
and existing actions remain available; previews retain the original controls.
Library controls form a compact, theme-aware panel aligned to the right,
with equal 8px gaps and natural-width controls. The filter is followed by Search,
with no item counter. Controls wrap within the panel on narrow screens. Video Library has
no Publish button in its ribbon.
Unknown dates stay blank. Access dates combine supplied workspace timestamps
with explicit library opens recorded in this browser per user/workspace.

### Story workspace follow-up fixes

The left navigation remains visible during the three-tab workflow. New Story begins
with blank details, content and selections, and detaches any prior PDF picker; saved
stories and explicitly started next episodes remain separate. Generate with AI opens
the shared instruction dialog immediately, using only this draft’s instructions and
language. Submission has visible busy/status/error states beside its button and an
Open Connections action when required. Library and other non-workflow views hide
the tabs and deactivate workflow routing; resuming minimized workflow popups restores
the original draft and header.

Clicking the top-level Library heading shows a compact list of Story, Image,
Audio, Video and Workflow Libraries on the right. No library opens by default;
story tabs and the journey guide stay hidden, and the draft is preserved.
Choosing a library opens its contents and expands, highlights and focuses the
matching left-navigation entry. Keyboard and pointer activation behave alike.

## Tester Agent

Signed-in Ecco Desk navigation includes Agents → Tester Agent. The pool opens a same-screen action, findings and ticket workflow. Browser checks exercise the current Studio; skipped prerequisites and limits are explicit. CI reports can be imported from the automatic workflow. One selected finding becomes one Bug ticket (internal for staff, support for customers), with severity, reproduction steps and evidence. History is browser-local and account-scoped. Receipt ambiguity stops a batch without blindly repeating a ticket. See the `eccoDesk.testerAgent` contract and `qa/README.md`.

### Desk access recovery

Agents is available to signed-in standalone Desk customers as well as staff. Customer findings become their own support Bug tickets; staff retains internal Bug tickets and assignment. No staff role is inferred from notification group membership. Pending notification group setup offers Connect Google and Refresh access through the existing owner-protected endpoint; publishing remains blocked until Google consent and membership verification succeed.

## Three-pane upload viewer — 7 November 2026

PDF, TXT and Markdown uploads use three equal desktop panes: the complete document,
initially empty Selected Text with a yellow border, and Improve with AI. The AI
pane places a compact AI sparkle action and Story Type, Genre, Audience and Language
in one ribbon directly above the prompt box, without a visible Prompt label or
selection helper sentence. Choices carry over from Story Details and update them
immediately; reopening or resuming reflects later changes. They accompany the
prompt in each request. Changing settings invalidates pending or unapplied AI
output while preserving the selected passage and prompt. The prompt and AI output textareas
share equal height. Use AI Text copies output to Selected Text; Clear AI Output
removes only that output. AI clarification questions and errors appear in nested
popups and never occupy the output area. Dismissing a clarification focuses the
prompt. Remove the redundant For: story caption. The original document is untouched.
The bottom ribbon contains page selection, verified chapter selection, Find and
Replace, Save Draft, Clear Text and Apply Text. Clear Text is a secondary button
immediately left of Apply Text. Its tools open upward
without resizing the panes; Escape, Back and outside clicks dismiss only that tool.
All panes have independent content scrolling and stack equally on narrow screens.

## Previous-screen navigation — 7 November 2026

Every Studio screen has a compact ← Back control above its title. It restores
the preceding in-tab view, including library search/view, story tab and draft,
focus and scroll. Up to 30 prior views are retained; an empty history disables
Back and never substitutes the welcome page. Identity changes clear history.
Page Back text and arrows always use the selected theme accent, including idle,
hover and keyboard focus: yellow in Default. Existing disabled cues remain.
Back is restricted to pages in the right-hand content pane, including Desk page
views. Popups, hover panels, menus and drawers never receive page Back controls.
Their existing close/minimize, Escape and outside-dismissal behavior remains.
Audio preparation retains its specific Edit Source / Questions / Characters actions.
No backend action is replayed.
### Source suitability and drafts

The AI ribbon reflects current Story Details. Before accepting a selected source,
AI compares it with the story title, type, genre and brief. A fiction passage for
Sports News, for example, prompts an explanation and explicit Use Anyway or Choose
Different Text. An unavailable assessment is clearly unverified and requires an
explicit Use Without Checking. Only selected text is sent. Changed stories or
selections invalidate pending checks and confirmations. Sports is a Genre option.
Save Draft retains the selected text, prompt and uncommitted AI output locally.

### Story generation defaults

Generate With AI matches Upload PDF in action size and workspace dimensions.
Its prompt is beside Story Type, Genre, Age Group, Output language and Audience
Location controls initialized from Story Details. Changing a choice immediately
updates and saves Story Details, including when the generation dialog is closed
without generating. Details changes carry into the next AI opening. These values
accompany the prompt in generation; opening or changing options never starts AI.

### Ecco Desk identity and appearance

At the user’s request, Desk retains its previous navy sidebar, yellow accents, light panels, Arial typography, sizes and spacing. Only the Ecco AI Labs name and actual Ecco logo remain from the branding update. Embedded support retains its original theme-aware heading/sign-in treatment and light ticket panels. The bell uses Number / Notification / Date it expires tables, 14px titles and 13px bodies, bold unread and regular read rows; the latest-three read history and expiry lifecycle remain.

## Shared agent workflows

Agents exposes Create New Agents at the top for Desk administrators and verified members of the configured administrator group. The inline builder saves a named sequence of up to 12 supported checks to dedicated server storage. Signed-in Desk users can run saved agents and review combined findings with separate Bug tickets. Group membership does not grant staff ticket access. Support and Notifications are the shortened navigation labels.

## Recurring campaigns

Notifications → Campaign offers set-once recurring announcements with a server-computed next occurrence. Cyber Monday, Black Friday and New Year presets follow their calendar dates each year. Daily, weekly, monthly and yearly schedules use the selected local time zone. Admins can edit or pause/resume a schedule. An existing CPU service publishes due notifications automatically, records each occurrence atomically, and skips dates missed while offline. Each dispatch rechecks current administrator authority. No browser, GPU or manual re-issue is required.


### Notification category tabs

Notifications, OutReach and Campaign are browser-style tabs that open on their respective histories. The circled plus at the right opens the inline creation form; Cancel or successful publish/save returns to history. OutReach retains special-offer credit terms; Campaign retains automatic recurring schedules. Keyboard arrow/Home/End navigation and focus return are supported.

## Notification locations and Billing offers

Show in selects Bell Icon, Billing, or both for notifications, OutReach and recurring campaigns. OutReach/Campaign creation offers NEW, Dhamaka, Limited Time or custom text icons. Saved icons and locations survive edits/re-issue and scheduled dispatch. Billing, Credit and Usage and Purchase Additional Credits display active promotional cards above regular options, with Offer lasts till dates. Three regular credit packages remain below; campaigns without purchase terms are announcements. Shared per-user reads and expiry remove cards. Backend presentation version 1 must precede Pages deployment.

Campaign creation and editing now include Year for the first upcoming run. The date preview and save reject dates already passed in that year instead of silently advancing a year. Recurrence continues normally after the first run. Existing schedules stay unchanged until edited; opening Edit shows the next scheduled year.
