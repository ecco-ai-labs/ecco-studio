# Storybook journey acceptance

Status on 2026-10-24: implementation prepared; **not ready for a completion notice**.
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

- Focused interface tests: 37 passed (guided journey, source selection, sound
  planning/attachment, final-script exact replacement, character controls and
  existing video handoff).
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
- Last recorded runtime activation is the CPU update in README, source
  `3f692c86f6356727fcfe9c316f0717e5570bae5a`. New sound adapter and durable story
  preparation still require runtime deployment.
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
