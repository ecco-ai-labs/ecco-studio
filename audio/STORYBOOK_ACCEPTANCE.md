# Storybook journey acceptance

Status on 2026-10-24: interface and runtime adapter deployed; **not ready for a completion notice**.
Source checks, Pages publication, runtime activation and audible quality are
separate gates. Never infer one from another.

## Fixed test source and adaptation

Use the user's attached Andrew Lang Arabian Nights PDF (255 physical pages).
Chapter 1 means The Story of the Merchant and the Genius. It begins at its
heading on physical PDF page 8 and ends on page 12 after the genius agrees to
hear the first old man's story. Exclude the next heading, The Story of the First
Old Man and of the Hind, and its contents. Pages 8–11 miss the ending; taking
all of page 12 includes another story. The source was extracted locally and the
start/end pages visually inspected. No private PDF is committed here.

Test an everyday-Hindi storytelling adaptation for children 9–12, with clearly
distinguished characters, natural dialogue, restrained suspense and supporting
sound. Preserve the merchant's journey, threat, promise/year at home, return,
three elders and the final bargain. Do not invent the following story's rescue.
Review the frame narrative explicitly rather than accidentally merging speakers.

## Acceptance matrix

| User step | Prepared implementation / local evidence | Live acceptance remaining |
| --- | --- | --- |
| Upload on main and AI page | Shared PDF picker; AI upload always visible | Upload this PDF on both deployed screens |
| Chapter/pages/manual selection | Exact anchors; boundary verification; progress/error feedback; focused tests pass | AI selects exact page 8–12 excerpt; page/manual paths compared |
| Identify/name all characters | Editable cast, count and properties; identity-preserving handoff | Compare real AI cast with the selected source |
| Audience/language/style dialogue | Audience categories, Tone presets, spoken editorial pass | Check full plot, everyday Hindi and entertaining dialogue |
| Selected-text improvement | Guided Script and Final Script; instruction field, repeated refinement and exact-range Apply | Exercise word, sentence and paragraph; surrounding text unchanged |
| Named suggested sounds | AI cue suggestion after final draft; editable unique names | Review cue relevance and timing against the actual script |
| Save Story → Audio | Authenticated durable preparation, cast and cue storage; route tests pass | Save, reopen, refresh; all prepared values retained |
| Model and character voices | Existing model catalog and per-character delivery controls retained | Preview and choose distinct suitable voices; verify selected worker controls |
| Generate or choose sound files | New authenticated sound queue/worker; library picker; attachment after durable completion | Install/qualify real sound models, generate new effects/music and replay saved files |
| Final Script tab | Manual edits, AI generation and exact-range improvements | Inspect deployed layout, keyboard focus and nested dismissal |
| Submit mixed recording | Existing voice/mixer path, version gates, gain/fades/ducking | Generate the full chapter with all requested cues |
| Progress tab | Actual job state, spinner and errors; no simulated percentages | Watch genuine queued/inference/mixing/completed states |
| Review tab | Only current new recording | Play, download and replay after refresh; verify complete ending |
| Quality | No subjective quality claim from unit tests | Listen to the full mix; correct pronunciation, clipping, gaps, voice confusion, excessive music or weak dialogue; rerun as needed |

## Evidence and blockers

- Focused interface tests: 38 passed (guided journey, source selection, sound
  planning/attachment, final-script exact replacement, character controls and
  existing video handoff and fresh unsaved-story audio isolation).
- Audio job tests: 19 passed, including validation, verified-compute routing and
  durable generated-sound asset finalization. Some inherited baseline tests repeat.
- Two focused authenticated storage-route/story-persistence tests passed.
- UI inventory freshness check passed. These are local tests, including mocked AI
  and sound inference; they are not a real authenticated journey.
- The old Story Format suite's test harness omitted `document.currentScript`,
  so the existing Desk script crashed before assertions. The harness now supplies
  script URLs and always cleans up failed-test windows. Against both the exact
  current main revision `b52feae0489176c452478ca9c08c8d0b519dac5d` and this update,
  13 tests pass and the same 7 old navigation/entry/workflow assertions fail.
  No production appearance was altered to satisfy those legacy assertions.
  This is recorded baseline debt, not a fully green regression suite.
- All 6 deployment guard/rollback tests pass. Deployment is pinned to the
  reviewed source revision, checks for idle services and retains source backups.
- Live pre-update UI accepted the attached 255-page PDF and extracted physical
  pages 8–12 (10,242 characters). That page-range result correctly includes all
  of page 12, demonstrating why exact chapter bounds are required. It was closed
  without applying or saving another chapter's text.
- The broader storage suite has unrelated folder/trash failures in this local
  snapshot. No full-suite-green claim is made.
- Runtime activation at 23:00:48 UTC deployed source
  `a9fc138de19f51f8954300e99bec4f8e15f21f69`, including the sound adapter and
  durable story preparation. All 24 destination checksums match; API health and
  a fresh CPU heartbeat pass. Sound-generation capability is version 1 with an
  empty verified-model list. The exact backup/result path is in README.
- Pages run 40140910982 succeeded for 99789a5143bc0cb792df4066b59d02dd60ad0e6c.
  Deployed UI checks confirmed Tone presets, both PDF upload surfaces, visible
  chapter connection errors and nested dismissal returning focus to Upload.
  Final Script, Progress and Review tab labels and arrow-key switching were
  also verified in the deployed UI. A live unsaved-audio contamination bug was
  found and fixed using per-story
  local draft IDs; the new regression test also checks prior-draft recovery.
- Test browser currently shows Storage and AI disconnected. User-assisted secure
  sign-in is required. Do not recover access keys from files/processes or bypass
  the previously rejected sign-in flow.
- No new sound model has passed real inference qualification. No full Chapter 1
  mixed recording has been produced or listened to for this acceptance run.
- Scheduled soundtracks remain separately pending. Do not label all historical
  audio requests complete when the first storybook journey passes.

Record exact source commit, Pages run, runtime checksums/capabilities, job/asset
IDs, output duration/checksum, replay-after-refresh result and listening findings
before marking this journey complete or sending its one-time readiness notice.

## Preparation recovery checks — 24 October 2026, 6:10 PM Pacific

UI commit `4c100125818b5d4a7d813b680c8018fc1526f620` deployed successfully
in Pages run [40149226484](https://github.com/ecco-ai-labs/ecco-studio/actions/runs/40149226484)
at 01:05:45 UTC on 25 October (6:05:45 PM Pacific on 24 October). The UI registry
run passed. No runtime activation or paid generation was performed in this check.

- 44 focused local tests passed, including the explicit requested/returned turn
  decision, preservation after a failed retry, stale-cast rejection, draft resume,
  nested minimize/resume and existing source/script controls. AI is mocked in
  these tests; the turn decision still needs authenticated live AI acceptance.
- The live browser uploaded the actual 255-page PDF on the main Story page and
  separately inside Generate with AI. Main-page selection of physical pages 8–12
  returned 10,242 characters, including the start of Chapter 2 as expected for a
  whole-page range. No whole-page selection was submitted for narration.
- Main Save Draft persisted the PDF and selection in IndexedDB. Minimize → Story
  Library → Resume restored the exact selected text. After a full browser refresh,
  Existing Story → Audiobook → the named test draft → Upload → Resume Saved
  Selection restored the same PDF and all 10,242 selected characters exactly.
- Manual selection narrowed this to 8,174 characters: the Chapter 1 heading through
  the genius's agreement, excluding the next story heading. Apply carried that
  bounded excerpt into the main form and Generate with AI.
- The AI upload's nested source picker saved successfully; minimizing and resuming
  the entire parent/child stack preserved the exact bounded excerpt. Apply returned
  to its parent. The preparation, source PDF and English adaptation brief were saved.
- Read Source and Continue displayed the missing Storage/AI connections explicitly.
  Open Connections minimized the prepared chapter and opened Connections without
  closing the draft. Chapter lookup also reported the same missing connection;
  this is error-path evidence, not successful AI boundary detection.
- The public storage health endpoint was reachable from the live browser and
  returned `ok: true`. Authenticated storage access has not passed in this session;
  that health response does not diagnose the user's intermittent network error.

The test draft is titled **Arabian Nights — Chapter 1 acceptance**. Storage and AI
are still disconnected in the test browser. Secure user-assisted sign-in is the
immediate blocker. New sound-model qualification, distinct voice selection,
authenticated full-chapter mixing, replay after refresh and actual listening are
still pending. There is no completed Chapter 1 recording to announce. The separate
21-voice request (7 male, 7 female and 7 child voices) and scheduled soundtracks are
not satisfied by this UI change.
