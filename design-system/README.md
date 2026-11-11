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

## Master size roster

[size-roster.json](size-roster.json) is the single place for every size, height
and theme color. Its `colors` section holds the color roles and each theme's
colors (and the Ocean / Dark Sky backdrops); `node scripts/size_roster.mjs`
generates them into `theme.js` and `glass-themes.css`, so never edit those
values there directly.

Font size, height and width of every element type are defined once in
[size-roster.json](size-roster.json). Each entry names an element type, the
selectors that belong to it and its sizes; variants refine a type for specific
places. Every instance of a type takes the type's size, on every screen, the way
a CSS rule applies to every matching element.

| File | Purpose |
|---|---|
| [size-roster.json](size-roster.json) | The master roster: the repository default |
| [sizes.js](sizes.js) | Compiles the roster into one stylesheet on every Studio and Desk page, including Desk shadow roots, and loads the published roster |
| [sizes.css](sizes.css) | Generated first-paint stylesheet. Run `node scripts/size_roster.mjs`; never edit it by hand |

**Size scale.** Sizes have names, grouped into categories: Title, Heading,
Text, Control height, Icon and Image. Each element picks a size by name
(`"font": "@heading-2"`), so changing "Heading 2" changes every element that uses
it. A plain number is allowed for a one-off size, but prefer a name.

**Editing.** Administrators open **Studio > User Preferences > Look and Feel**.
It is a panel beside the real screen: the Elements tab lists what is on the
current screen, the Sizes tab edits the scale, and **Pick on page** selects an
element by clicking it. Every change previews immediately; **Apply to everyone**
publishes it. Only administrators see it: people the Look and Feel service names as administrators, or Google accounts listed in [look-and-feel-admins.json](look-and-feel-admins.json). A Colors tab edits each theme's colors. **Copy roster**
exports the edited roster. Each Apply is a numbered
version on the Desk service (`/api/look-and-feel`); every page loads the latest
one and falls back to the repository roster. **Download roster** exports the
live roster so it can replace `size-roster.json` here.

**New screens and elements.** Do not give an element its own font size, height
or width when its type is in the roster. A new kind of element is added to the
roster (a type, or a variant of a type) in the same change, with its contract
component. Then run `node scripts/size_roster.mjs`. The `ROSTER-01` browser check
fails on any visible element whose size is neither its roster type's size nor
inherited from its surroundings.

## Adding or changing an object

1. Find its type in `ui-contract.json`. Reuse it; register a new type only when needed.
2. Account for all property groups. Use explicit `not applicable` in reviewed specifications where appropriate. Do not invent UI changes or numerical defaults.
3. Record any new variants, properties and approved exceptions in the contract in the same change.
4. Implement the change, then run `python3 scripts/ui_inventory.py`.
5. For sizes, update `size-roster.json` and run `node scripts/size_roster.mjs` (see Master size roster).
6. Commit the updated contract, roster, source and inventory together. Run `python3 scripts/ui_inventory.py --check` before merging.

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

Tell Your Story → New Story → Describe Your Story opens one workspace with three browser-style tabs:
Story Details, Story & Characters, and Generate & Publish. Details collects output,
type, genre, age group, language, optional location and recurrence. The second tab
uses the existing PDF selection experience or an editable script, with editable library characters. Apply Text automatically identifies characters and
fills their count and properties from the applied source; Use AI Text only updates the
selection for review. Audio retains distinct speaking roles plus narration when needed,
with language, accent, delivery, emotion and available model voices. Image shows
appearance; video shows both. The count remains editable. Analysis never starts a
media job, never sends unselected source content, and rejects stale replies. Audio
speaker assignments preserve source words and order. Missing connections or invalid
results keep the text and show an actionable error. Back refreshes Story Details
from the current draft, including changes made in the second tab. Model and character properties are
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

Upload PDF, Generate With AI and Write share 160px × 32px buttons aligned to
the right of the Story & Characters source row. On narrow screens, the buttons
wrap without changing size and each row stays right-aligned.

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
popups and never occupy the output area. Clarifications show a recommendation and
2–4 concrete answer buttons from AI notes, with one marked Recommended. Clicking
an answer resumes the selected-only improvement immediately; approved answers
never enter a repeated blocking-question loop. Continue Anyway opens the already
validated draft for review without another AI call. Edit Prompt returns focus to
the prompt. If structured choices are unavailable, offer preserving the source
details. Genuine request failures show recovery advice, Try Again, Edit Prompt
and Continue Without AI; the latter focuses Apply Text without committing it.
Every action rejects stale source, settings or prompt state. Remove the redundant For: story caption. The original document is untouched.
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

Campaign creation and editing use native Start and End calendars followed by Recurrence. Past dates and fully elapsed ranges save normally; only invalid dates or End before Start are rejected. Recurrence is anchored to Start and stops after the inclusive End date. A completed range remains editable in history with no remaining runs. Existing legacy schedules retain their behavior until explicitly edited. Backend calendar capability 1 must precede the UI deployment.

### Applied PDF content — 8 November 2026

The story workspace accepts selections up to 100,000 characters so ordinary complete
chapters can populate the middle pane without the former 20,000-character rejection.
Select Chapter lists actual PDF bookmarks with physical page numbers. Listed chapters
extract locally, including headings spanning multiple lines, and stop at the next
same-level chapter heading even mid-page. A missing or ambiguous bookmark is never
guessed. An optional title search retains verified AI chapter lookup. Listed chapters
and page ranges require no AI connection. The original source remains unchanged;
Selected Text stays editable. Explicit translation/tone instructions override AI defaults.
Apply Text analyzes the final edited middle-box content and auto-fills characters and
output-appropriate properties. It does not analyze the unselected original document.
A valid cast survives a failed speaker-assignment attempt; the text and failure remain
visible. Audio generation retains its separate 4,000-character/80-turn service limits.
PDF selection is verified with real PDF.js rendering; AI quality and live service delivery
remain separate checks requiring connected services.

Story review respects the hidden candidate state after automatic Apply Text character
detection; no empty review panel remains. An explicitly changed character emotion
overrides AI-generated turn defaults, while a manually edited turn retains its own
emotion. Native PDF text highlighting, actual Find and Replace, saved-selection resume,
and final manual text application are part of browser acceptance coverage.

Completing a voice audition, including a later polling response, refreshes the Audio Studio Generate control immediately;
active recording jobs continue to keep it disabled.

PDF text-layer line endings use positioned newline spans so a mouse drag beyond a
line selects that line only. Native BR hit boxes must not pull following rows
into Selected Text. The original document and copied line breaks remain intact.

Saving or resuming a campaign includes today’s unsent occurrence in the selected time zone, even after its send time. The preview shows Starts now; prior dates remain skipped. Receipt checks prevent resaving or resuming today’s sent campaign from duplicating it. Notification Duration continues to control each notice’s expiry.

Campaigns also have Show Upcoming (days before), default 7; 14 means two weeks and 0 turns it off (maximum 90). Enabled Billing campaigns appear in the recipient’s Billing drawer, Credit and Usage and purchase popup before their start, with Upcoming plus their configured badge and start/expiry dates. These previews have no purchase/read actions or Bell unread count. Pause, targeting, placement and lead time apply; the scheduled notification replaces the preview after dispatch. Backend upcomingCampaignVersion 1 precedes frontend deployment.

Save Draft makes Resume Saved Selection available immediately. Resume reads the latest
saved selection and cannot restore a previous story’s source after navigation.

## Selective agent checks

Tester Agent and saved agents open with no tests selected. Choose an action/workflow, expand the relevant group and tick individual checks, or explicitly Select all tests. Run selected tests stays disabled until a test is chosen. Scope changes clear the selection. Execution skips unchecked tests and empty workflow steps, and reports retain the selected IDs and available count. Required navigation can still report blocked prerequisites. Ticket selection remains separate.


## Complete recordings and applied speaker scripts

Apply Text assigns every source passage to a speaker and displays the complete
speaker-labelled script. The original selected text remains available separately.
Older applied drafts with missing assignments are repaired before opening Audio
Studio. Assignment failures retain the text and request a targeted retry.
Recording-wide 4,000-character and 80-turn restrictions are removed from editing,
review, save, handoff and worker validation. Workers process internal sections and
assemble one recording; no source words are dropped to fit a recording cap.
Runtime capability and live-service verification are separate from fixture tests.

## Generated script review — 8 November 2026

In Select Story Text, Generate Script opens Generated Script for audio/video.
Ordered editable turns and speaker dropdowns appear on the left; the character
selector and properties appear on the right. Apply Text commits the complete plan
and settings to Story and Characters. Generate opens the generation tab. The
review saves a story-scoped Resume Script draft, retains edits across Close and
Minimize, and never starts media inference. Source words are assigned completely
before review; intentional user edits are retained.

## Compact story editing and AI review

Story and Characters uses browser-style Character 1, 2, 3 tabs and a trailing +
that adds and selects the final character. Only its properties are displayed.
Number of characters, Choose from Library, Create Character and the source caption
are removed. Upload PDF, Generate With AI and Write use equal compact control
panels; the optional story brief is two lines, with empty status/resume rows hidden.
Story preparation and selection errors open the shared error popup.

Generate With AI retains prompt and editable generated story together in the same
popup. Generate Script opens the shared screenplay review, where every turn and
speaker/property is editable. Apply Text returns the reviewed work to the main
Story and Characters screen. Text edits survive closing and reopening; minimizing
and navigating away preserves the screenplay. No media inference starts here.

## Campaign read visibility

Upcoming and current campaigns remain in all Billing surfaces after acknowledgement.
Unread titles and messages are bold; read titles, messages and badges use regular
weight. Per-user occurrence receipts persist through reload and upcoming-to-active
dispatch. Later recurrences begin unread. Campaigns are not displaced by newer
notifications; expiry, withdrawal and recipient/schedule eligibility still apply.

## Library and Tell Your Story landing pages — 8 November 2026

Library shows only the five library entries, with icons and names. The secondary
heading, descriptions and trailing chevrons are removed. Tell Your Story uses the
same list for the six existing workflow options. New Story and Go to Studio on the
main page both open it, as does the Tell Your Story sidebar heading. New Story
prepares a fresh draft; other entry routes retain existing work. Describe Your Story
opens the three-tab workspace. Theme colors, keyboard controls, Back and draft
preservation remain; no generation starts from opening a landing page.

Library and Tell Your Story headings are 3px larger: the top-level sidebar
labels are 16px (previously 13px), and both landing-page titles are 21px
(previously 18px). Subtitles in the two landing lists and their matching sidebar
entries are 14px. Both landing lists start 24px lower and have no outer border
or row dividers. 2026-11-10: StoryBoard Your Story and Publish Your Story are removed
from both locations; publishing is part of the Describe Your Story workspace.
Existing row dimensions, theme styles and keyboard focus remain.

## Story Type and Genre / Topic — 8 November 2026

Story Details, Generate With AI and Select Story Text share 12 presentation types
and 17 genres/topics, defined in story-workspace-model.js. News Report and
Documentary are types; Educational is replaced by Lesson / Tutorial and Training
as types. Animation remains a visual style; adaptation, dubbing and repurposing
remain creation workflows. Output and recurrence are independent. Existing saved
values remain intact and are shown as additional options only for that draft;
retired type IDs keep their friendly labels. No additional fields or layout changes.
Interview starts with Host/Guest and retains Interview delivery in Audio Studio.

## Story Details reference — 8 November 2026

The owner-approved reference replaces the flat Details grid with two equally sized
cards, each at most 640px wide: Your Story (name, three single-choice output tiles,
type, genre/topic) and Your Audience (age, language, optional location). Story choices
start empty; only All ages and English are preselected, with Default badges.
Type and genre/topic remain independent. Cards stack on smaller screens.

Every required field is labelled. Submit and forward tabs show one linked summary
of all missing fields plus individual text errors and aria-invalid; focus moves to
the summary, and each link focuses its control. This is the approved exception to
popup errors for operational failures. Draft saved in this browser sits at top
right. The sticky footer pairs Publishing schedule: set in the last step. with a
right-aligned, 48px Next: Story and characters button. One-time or recurring moves
to Generate & Publish and retains saved preferences without scheduling anything.

## Grouped Story Details choices and journeys — 8 November 2026

Only Story Details replaces the type and genre selects visually with compact
buttons and nonmodal panels. The approved references use full-width group titles
and two-column option grids: four groups with descriptions for type, two groups
with names only for genre/topic. Existing stored IDs, saved categories and AI prompt
values remain intact. Panels fit the viewport below the trigger and scroll at a
470px maximum. Native option buttons expose aria-pressed and check marks; triggers
expose aria-haspopup/expanded/controls. Tab reaches every option, arrows navigate,
Escape closes with focus return, and selection or an outside pointer closes.

Other reveals its required description; both descriptions use the existing
complete linked validation summary. Default badges disappear permanently for that
draft once the user edits age or language. Output filters and renumbers the sidebar
and journey list: Audio and Image each retain four applicable steps including
Publish; Video and an empty output retain all six. No other editor gains these
custom dropdowns, and choosing output does not start generation or publishing.

The follow-up uses title case for Your Story and Your Audience and equal card
heights on desktop and mobile. Grid rows size both cards to the larger content
height, including validation and Other fields; no fixed-height clipping.

## Compact typography

The November 8, 2026 owner request reduces every authored UI font by 2pt
(2.6667 CSS pixels), superseding earlier font and spacing numbers. Sizes use
`calc(original - 2pt)` at the declaration so inherited text is reduced once.
UI padding and gaps of 6px or more decrease by 2px; fixed text controls and
dropdown triggers also shrink. Story Details uses 40px fields, 52px output
tiles and a 44px Next action. Equal card sizes and bounded popup panels remain.
Media, PDF document fonts and Google-hosted sign-in remain outside application
typography; icon-only close/minimize and toolbar targets keep their dimensions.

## Story source tabs, settings labels and drafts — 8 November 2026

The owner reviewed a mock-up and approved replacing the three Story and Characters
source buttons with browser-style tabs: Upload PDF, Generate With AI and Write
Yourself (renamed from Write). Each tab keeps its own menus inside the tab and uses
the Select Story Text three-pane layout inline rather than a popup. Upload PDF shows
its Upload PDF button and, after a file is chosen, Document Preview, Selected Text
and Improve with AI. Generate With AI shows What should your story be about? with
Write Story, then Story Text and Improve with AI. Write Yourself shows Your Story and
Improve with AI.

Story Type, Genre / Topic, Audience and Language move out of Improve with AI into
editable labels above the tabs. Each lists every Story Details choice, starts on the
Story Details value (shown in its normal list position) and writes back to Story
Details immediately.

In all three tabs, Draft 1, Draft 2 and Draft 3 replace AI Output. Each Write Story
or Improve with AI result fills the next free draft; the user picks a draft and
selects Use AI Text. Other drafts stay available as alternatives until Selected Text
is edited. Clear AI Output clears only the chosen draft. Inline workspaces are
non-modal dialogs marked data-inline-panel, so popup close/minimize controls and
popup minimizing skip them. Story Import and the Audio journey keep their single AI
Output. Before a file is chosen, the Upload PDF tab already shows the three boxes with Upload PDF inside Document Preview; afterwards Upload PDF sits under the document name. The old Story / Script box is no longer shown; it remains only as hidden storage for the applied script. Characters below the tabs are unchanged.

## Six workflow steps — 8 November 2026

After reviewing screenshots, the owner approved six steps across the top in place
of the three tabs: 1. Details, 2. Story, 3. Characters, 4. Script, 5. Generate,
6. Publish. Story holds the settings labels and the three source tabs and ends
with Next: Characters. The Characters box moves into Characters (cast tabs,
Recommend with AI and suggestion review), ending with Next: Script. Script shows
the applied turn-by-turn script for review and editing, with Resume Script, and
ends with Generate; applying a reviewed script opens Script. Generate and Publish
reuse the existing generation and publishing pages. Details' button reads Next:
Story. Saved three-tab drafts open their Generate & Publish tab as Generate, or
Publish when publishing was open.

## Characters step: Create and Test — 8 November 2026

The owner reviewed the Characters mock-up and asked for it to be implemented. The
step keeps its place before Script; the Script step is unchanged.

- One tab per character with a status marker: Not created (ring), Created (gold
  `#d8bd88`) or Tested (green `#5fd08a` with a check). The tab's accessible name
  stays the character name; `aria-description` carries the status.
- Left: **From Story** (name, role, age group, gender, personality, language,
  dialect; More properties, open by default, holds the rest and Save to Character Library). Dialect replaces the earlier Accent label, as in the mock-up.
- Right, audio stories: **Create voice** (Suggested voice, Audio model, Voice,
  Generate voice, sample player) and **Test** (the character's story lines or
  your own line, Mark as tested). Samples run through `EccoAudioStudio.sample`.
- Right, image and video stories: **Create avatar** (Suggested avatar prompt,
  Image model, Generate avatar, avatar options and preview) and **Test** (review,
  Mark as tested). Avatars run through the existing images job; the chosen avatar
  becomes the character's `reference_id`.
- Next: Script is disabled until every character is created. Changing voice
  settings clears that character's voice; choosing another avatar clears Tested.
- New roster entries: `character-avatar`, `status-marker` and the button variant
  `button-avatar-option`.

## Story pane icons and AI character reading — 8 November 2026

The owner approved the interactive prototype. Upload PDF and Full Screen are icon
buttons in each box header (aria-labels Upload PDF, Full Screen / Exit Full Screen,
with tooltips); Full Screen is on the document box and on the story text box in
all three tabs, and the same icon or Esc returns it. Before a file is chosen, the
document box is one large Upload PDF target. Keep previous selection is removed.
Next: Characters sits on the right. Clicking it sends the selected tab's story text
to AI, which returns one character per speaker; each becomes a tab named after the
character, with suggested gender, age group, accent, speaking style, personality
and voice, and the properties open. The same text is not read twice. Personality
is a new character property.

## Story step produces only the story — 8 November 2026

Owner direction: the Story step only generates the story, with three drafts.
The Generate Script / Apply Text button is removed from all three Story tabs, so
the Generated Script popup no longer opens from Story (it remains only to resume
a saved draft). Next: Characters carries the chosen story text to Script and asks
AI for the characters.


Resume Script is removed from the Story and Script steps, and a leftover Generated
Script draft in a saved story is discarded on open so it no longer blocks Generate
(owner request 2026-11-08).

The character reading started by Next: Characters is no longer cancelled by moving
between steps or changing settings while AI works; only switching to another story
cancels it (owner report 2026-11-08: only Narrator appeared after Back).

## One story tab at a time — 8 November 2026

Owner request: only one of Upload PDF, Generate With AI and Write Yourself holds
the story. Leaving a tab with work opens "Leave <tab>?" with Go back (returns to
that tab, nothing changes) and Proceed (erases that tab — file, selected text,
idea, drafts and saved selection — and opens the new tab). Empty tabs switch
without asking. Write Story is now the same ✦ icon button as Improve with AI
(owner choice: icon everywhere), and the title line inside the inline boxes is
hidden because the tab already names the box.

Next: Characters ignores any clarification question AI adds beside its character
list and tells AI not to ask questions there (owner report 2026-11-08: a title
question stopped the character tabs from appearing).

While AI generates characters, Characters shows a spinner beside the status and an
animated progress bar (role progressbar, "Generating characters") until the tabs
arrive (owner request 2026-11-08).

After Next: Characters, AI's explanation of its cast is no longer shown. Generate
voice on Characters loads the story's audio settings itself, so it works before
Audio Studio has been opened (owner report 2026-11-08: "reading 'compute'").

## Recurring generation — 9 November 2026

Owner-approved flow (clickable mock). Story Details: the Story type list opens in
two panes, One time generation (all 12 types) and Recurring Generation (8 types;
Presentation, Advertisement, Music / Ambient and Other are one-time only). The
choice sets `recurrence` and shows as a tag on the Story type button and as a pill
on the Story Script ribbon. When Recurring, the PDF tab reads PDF with multiple
chapters/episodes and a Recurrence tab is the last Story Script tab (it also
appears for a One time story found to have chapters or parts, with Make it
recurring). Recurrence holds the schedule, the episode list and Save as workflow,
which writes a draft to the Workflows store. A recurring story with no chapters
or parts gets "This story is a one-time story" with Go back and Switch to One
time (checked after a PDF upload and on Next: Story Characters; headings are
counted, and AI confirms before the warning for written or generated text).
Story Generation and Story Publishing no longer show the Publishing schedule box:
a recurring story shows a summary with Change in Story Script → Recurrence.

The two Story type panes are equal width with one column each. When Recurring, the
one-time warning also appears right after Use AI Text, and Generate With AI hints at
a series ("a 5-part series…").

Audit fixes (owner-approved, 2026-11-09): the Recurrence tab is renamed Schedule
(the summary button reads Change in Story Script → Schedule). For a recurring
story, Next reads Next: Schedule and opens Schedule until it has been seen, then
Next: Story Characters. Headings may follow a speaker label ("Narrator: Part 1");
Schedule shows "Found N episodes/chapters/parts." using the headings' own word and
lists each heading's title (falling back to "Chapter N" / "Part N"). AI series
drafts start each episode with "Episode N: Title". After a PDF upload the whole
document is selected (Select Pages can narrow it), so the one-time check runs on
selected text.

New Each Episode (owner fixes I1–I3, I5, 2026-11-09): recurring stories get a New
Each Episode Story Script tab (between Write Yourself and Schedule; it opens first
for recurring News, Podcast, Interview and Documentary). It reuses the Story Script
boxes in three equal columns: series brief (What is the series about?, What changes
each episode?, and for News: Use news from, Stories per episode), Episode 1 preview
(✦ writes a sample) and Episode plan (editable list, + Add episode, ✦ Suggest more;
News shows Coming up dates). Opening it never erases other tabs. Schedule for this
source says "A new episode each time it runs.", Ends offers Never or After a number
of episodes, and Save as workflow writes source_mode news or series (backend
contract af73c97). The one-time warning adds Make a new episode each time. In Story
Characters a series written each episode shows a Changes each episode checkbox
(default on for guest roles); those characters show the tag on their tab, are
picked per episode, and don't count toward Create every character.

## Output-aware steps — 9 November 2026

Owner-approved mock. Image: Story Details shows Image style (the Image Studio
styles) instead of Story type, and no Genre / Topic or Language; Image is always
one time. Steps: Story Details, Story Picture, Story Characters (optional, Create
look), Story Generation, Story Publishing. Story Picture has two tabs: Upload a
Photo (photo, What to make from it, Improve with AI) and Generate With AI (idea,
three AI picture descriptions, Picture Description). The description becomes the
picture prompt for Image Studio. Video adds Visual style (the existing film
styles). Audio is unchanged.

Audit fixes, 10 November 2026 (I11–I13): the picture prompt on Story Generation is
only the picture description, with no speaker labels. Story Characters for a
picture starts empty with “No characters needed for a picture.” and
“+ Add a person” (`.story-cast-empty`, spacing only); added people are named
Person 1, Person 2. The Image style fills the existing Visual style control in
Additional Controls. With Upload a Photo, the photo is added to the image library
on the way to Story Generation and becomes the first reference, so Qwen Image Edit
is selected and the photo is the starting point.
Episodes and voices (owner reports 2026-11-09): for a series with chapters or
episodes, Screen Play and Generation use one episode at a time without its
heading line; Start next episode / chapter opens the next one with the same cast
(at Story Characters). A heading line at the start of a turn is a title, not a
speaker. Each character gets a voice that matches their gender (from the voice
names: feminine / masculine) and no voice is reused in one story while the model
has enough; otherwise a note says some characters share a voice. A voice picked
by hand is kept.

Screen Play lines and sounds (owner request 2026-11-09): for audio, Story Screen
Play opens on Lines and sounds (Edit as text keeps the plain script). Each line
shows who speaks (with their voice) and how (Delivery: Normal, Whisper, Happy…,
from the audio direction emotions), and + Sound adds a Sound Effect, Ambience or
Background Music at that line with a volume. ✦ Suggest delivery and sounds asks AI
for both. Delivery is saved as the line's manual performance and sounds as the
audio draft's Sound Design, so Story Generation records them; missing sounds are
made at generation time.

Real-run fixes (2026-11-09): a video's Visual style is added to the suggested
avatar and its prompt; Story Publishing's status lists only this story's uploads
("Nothing from this story has been uploaded yet."); Audio Studio's "Your newly
generated recording will appear here." hides once the recording is saved.

Genres per Story type (owner-approved I14, 2026-11-09): Genre / Topic in Details
and on the Story Script ribbon lists only the genres that fit the Story type
(Stories: Comedy … Science Fiction, History, Other; Podcast/Interview: Comedy,
History, Biography, Business, Science & Technology, Sports, Nature, Other; News:
Business, Science & Technology, Sports, Nature, History, Other; Documentary:
History, Biography, Nature, Science & Technology, Sports, Business, Other;
Lesson/Training/Presentation: Science & Technology, History, Nature, Business,
Biography, Sports, Other; Advertisement: Comedy, Drama, Business, Science &
Technology, Sports, Nature, Other; Music / Ambient and Other: all). Changing the
type clears a genre that no longer fits; a saved genre is otherwise kept.

Voices, second pass (real run 2026-11-09): unknown genders alternate feminine and
masculine; if the story's audio model has too few voices in the language, the
model with the most voices that the worker can run is used. Starter characters
(Host/Guest, Narrator) get voices the same way. Changing a character's Audio model
picks a fitting, unused voice from it; models the worker can't run are marked
"(not on this worker)". The Characters summary names characters that share a
voice. Screen Play shows each character's own model and voice.

Voice quality (owner report 2026-11-09): each language uses the best-sounding model
the workers can run (English: Kokoro, VoxCPM2, Indic Parler, Chatterbox, Simple
Audio Model; Urdu: Indic Parler, Simple Audio Model; Telugu: IndicF5, Indic
Parler, Simple Audio Model). New audio drafts start on the ready CPU worker with
the most models, and when the selected worker lacks a character's model, Generate names
the ready CPU worker that has them (compute never switches machines on its own).

Audio Library labels (owner-approved 2026-11-09): Add labels offers one-click
suggested labels (Podcasts, Documentaries, Interviews, News Audio, Storybooks,
Lessons, Advertisements, Music) and says "Labels are optional."; saving with no
label saves only the name (needs the backend update).

Automatic flow, first part (owner-approved mock 2026-11-09): for audio, Story
Characters opens on a short cast list: each character with the voice picked for
them, Hear (makes a sample on demand) and Change, which opens the full editor
(with ← Back to cast list). The narrator row has Narration style (Expressive
storyteller, Rich and measured, Clear and warm, Bright and brisk, Intimate and
quiet; default from Story type), sent to delivery suggestions and generation. An
audio character is ready once it has a voice; samples are optional (video still
needs avatars). Story Screen Play suggests delivery and sounds once on arrival,
keeping anything set by hand. Generate With AI writes the way people speak for
each Story type.

Image styles (owner request 2026-11-10, image-styles.js): each Image style is
written first in the picture prompt as a detailed description, with the other
looks sent as things to avoid, so the chosen style always wins (checked on
Serverless with Qwen-Image 2512). AI picture descriptions name no art style and
include expressions. A picture repeats each person's look from Characters
("keep exactly as described"); a person's avatar is drawn in the same Image
style and used as the reference. No new controls.

Image style picker (owner-approved mock 2026-11-10): Story Details → Image
style lists 50 styles (image-styles.js) without a long list: one dropdown that
opens on Popular (8), 2–3 suggestions for the audience, a search box and seven
groups (Popular, Illustration, Painting, 3D and craft, Photo, Digital and retro,
Cultural). The chosen style's one-line hint shows under the field. Story
Generation → Additional Controls uses the same list (Change / No style) instead
of a free-text Visual style box for pictures, so every picture prompt is bound
to a described style. The open panel is a box directly below the field, 800 × 520 (owner-approved
mock 2026-11-11); it stays attached to the field and the page scrolls to fit.
The groups and the list scroll on their own.
Layout only; options reuse .story-choice-option sizes.

Screen Play script rules (owner request 2026-11-10): a paragraph without a name
continues the same speaker (only the first paragraph needs one); text in
[square brackets] is a direction sent to the voice model separately and never
spoken; [Sound: …] on its own line is a background sound; parentheses in spoken
words become a pause. The storage server refuses any line whose spoken words
still contain a bracket. While you type, Lines and sounds appears as soon as
the script is valid; the text view stays open.

Automatic episodes (owner-approved mock 2026-11-09, story-auto.js): for a
recurring story, Schedule shows an Automatic episodes box under the schedule.
Make the pilot episode saves the workflow with automatic episodes on and makes
episode 1 on the connected A100 or B200 (disabled with the reason when no GPU or
voice model is ready; CPU is never used). The pilot shows progress stages, then
the recording, the checks in plain words (✓ passed, ✗ failed, “not checked”
when a check could not run), any question with two samples to pick from, and
Tell us what to change (plain words; Apply and remake). Sounds good, approve the
series applies the Before each episode publishes choice and starts the schedule;
then each episode is listed with its status, the same change box and Publish
when it waits for an OK. Layout only; sizes come from the roster.

## Story Generation: progress, fixes and Publish — 10 November 2026

Owner-approved mocks (Design canvas "Ecco Story Generation Mocks"). Generate on
Story Screen Play opens Story Generation and starts the story's audio, image or
video generation once. The tab shows one overall bar (the sum of every worker's
progress), a clip or passage map, stats, one row per worker or task, and an
Activity log. A failure opens the shared error popup with the cause, a list of
next steps and one action. When the result is ready the tab becomes review:
video frames can be selected and redrawn in place, audio words can be given a
pronunciation or new wording and regenerated, images can be redrawn from
themselves. Download and one Publish button replace the old Finish your story
panel. Model Settings is a side panel holding the studio form for the media
type. New roster variants: Generation overall percent, Generation frame tile,
Generation image tile. Code: story-generation.js and story-generation.css.
