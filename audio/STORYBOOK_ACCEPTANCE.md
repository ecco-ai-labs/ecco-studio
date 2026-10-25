# Storybook journey acceptance

Status on 2026-10-25: two CPU instances verified for short speech previews; **not ready for a completion notice**.
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
- Storage and AI were subsequently connected by the user. Live authenticated
  source preparation, Story save and short CPU preview requests now work.
  No access keys were recovered and the rejected sign-in flow was not bypassed.
- No new sound model has passed real inference qualification. No full Chapter 1
  mixed recording has been produced or listened to for this acceptance run.
- Scheduled soundtracks remain separately pending. Do not label all historical
  audio requests complete when the first storybook journey passes.

Record exact source commit, Pages run, runtime checksums/capabilities, job/asset
IDs, output duration/checksum, replay-after-refresh result and listening findings
before marking this journey complete or sending its one-time readiness notice.


## Two-CPU live check — 2026-10-25 UTC

- UI source `a30d3c372ad057c1b85e6aaf7af02c7624b637d9`; Pages run
  [40155912862](https://github.com/ecco-ai-labs/ecco-studio/actions/runs/40155912862)
  and UI Registry run 40155913275 succeeded.
- Routing runtime activated at 2026-10-25T02:52:19.269119+00:00 from that source.
  Eleven destination checksums were verified before activation; backup/result:
  `/workspace/ecco-audio-update-1792896695600196314/`.
- Both fresh workers advertise instance routing v1 and appear in the unchanged
  Audio Studio Compute dropdown: `ecco-storage-api` (2 vCPU / 8 GB) and
  `smiling_sapphire_mandrill` (16 vCPU / 64 GB). Each request preserves its
  selected `worker_id`; each completed job records the same `worker_pod`.
- New-CPU Chatterbox preview job `302136bb1c9e4d9ea4d58d549780c1d0`, asset
  `2cd7a5c4ae198d48588e1fcf113a1eb4`: 4.6785 seconds, mono 24 kHz,
  224,612 bytes, SHA-256
  `cb71a1243feafbb38afab9ff543dc3afe085a00e56e324f59d39c3cb5f46eabd`.
  Request-to-WAV time was 46.0 seconds, including model loading.
- Original-CPU Chatterbox preview job `c12502f302774066b30bca12beffba25`:
  1.518417 seconds; SHA-256
  `8989c25626149e37f4f3dc3c4e8a00c565fa3e05293bc643748e61ee4f2ce1ab`.
- Both files were retrieved from Audio Library after a full browser refresh,
  then played with advancing media time and no media error. The selected new
  CPU and the saved story were retained after refresh. These are short voice
  previews, **not the full mixed Chapter 1 audiobook**.
- A real preview exposed intermittent plain narration in the delivery-plan
  response. Source `9e3f04bb9e9c428b1c80d001af67cf2e4d0504d7` adds a strict
  structured schema; the backend-only fix activated at 2026-10-25T03:04:18.975843+00:00.
  Backup/result: `/workspace/ecco-audio-update-1792897457554142293/`.
  The same original-CPU preview then passed through the live UI.
- Checks for this change: 34 worker/backend tests, 39 UI flow tests, 14 AI
  assistant tests and 6 activation/rollback tests passed. These counts do not
  substitute for full mixed-audio acceptance.
- The sound-model installation is in progress on the new CPU. MOSS and ACE-Step
  have not yet passed real inference qualification. No subjective listening
  review is claimed: the test environment cannot provide audio-input perception.
- Still required: automatic exact chapter lookup acceptance, final dialogue and
  distinct-voice review, new effects/music and assignments, full mixed recording,
  final replay and actual listening review. The requested expanded voice catalog
  and separately scheduled soundtracks are also not complete.
