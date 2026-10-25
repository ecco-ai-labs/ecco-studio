# Storybook journey acceptance

Status on 2026-10-25: a full Chapter 1 mixed recording is saved and replayed after refresh. Its initial mix required administrative recovery after an FFmpeg compatibility failure. **Not ready for a blanket completion notice or listening-quality claim.**
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

| User step | Recorded live evidence | Remaining / limits |
| --- | --- | --- |
| Upload on main and AI page | Original 255-page PDF used; deployed upload controls and real AI-page re-upload verified | All entry/selection variants are not independently accepted end to end |
| Chapter/pages/manual selection | AI returns the reviewed 8,174-character Chapter 1; physical page range 8–12 comparison recorded | Accumulated manual excerpts and their cross-browser persistence still need complete acceptance |
| Identify/name characters | Ten named speaking roles carried into the actual complete generation | Full automatic source-count acceptance and expanded voice catalog remain open |
| Audience/language/style | Everyday Hindi adaptation for children 9–12; reviewed plot and frame exchanges preserved | Audible pronunciation, acting and audience appeal need listening |
| Selected-text improvement | Real word, sentence and paragraph Apply; explicit instructions, Improve Again, exact-range comparison and refresh persistence passed | No subjective spoken-quality assertion |
| Named sound cues | Eight named cues, phrase timing, levels, fades, loops and ducking saved | Sound relevance and audible balance need listening |
| Save Story → Audio | Saved Story, browser draft and generated asset exist; full audio retrieved after refresh | Latest Audio edits were not proven to round-trip through saved Story preparation in another browser |
| Model and character voices | Chatterbox and selected CPU used; ten voice/pitch/speed combinations verified in request | These are not 21 distinct voice identities; all speech models not tested in this full run |
| New or existing sound files | Six new CPU model outputs; actual library assignment and derived ambience upload | Automatic loudness balancing is not implemented; this run used an explicit production adjustment |
| Final Script | 44 displayed passages; 49 submitted phrase-boundary segments have identical normalized text hash | No words lost by cue splitting |
| Submit combined recording | Actual combined request rendered; complete mixed output saved by normal finalizer after guarded recovery | Initial UI run failed at mixing; fresh uninterrupted success remains unproven |
| Progress | Actual worker counts observed from 0 through 44 of 49; all 49 confirmed complete before mix | Original failed mix remains recorded in recovery audit |
| Review and persistence | Audio Library playback after refresh, full download/hash and end-of-file playback passed | Recovery was reviewed in Audio Library; uninterrupted right-side Review handoff still needs acceptance |
| Quality | Valid full WAV/MP3, signal levels, duration, hashes and zero clipped PCM samples checked | Actual listening unavailable here; do not claim superior or sale-ready quality |

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
- The latest checkpoint below supersedes the initial empty sound-model list.
  No full Chapter 1 mixed recording has yet been produced or listened to.
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


## Full Chapter 1 voice checkpoint — 2026-10-25 UTC

- CPU-only UI generation completed job `5e28aad5540a47a181c6fc5ee0892931` on `0g6485yvcjldmo`. All 44 requested passages have timing entries; final entry: 254.6255–257.602625 seconds. The 43 dialogue turns plus opening preserve the reviewed Chapter 1 plot and frame-story exchanges. No next-chapter resolution is added.
- Saved under Audio Library → Storybooks as **Arabian Nights — Chapter 1 · Voice performance**. Browser refresh, authenticated retrieval and advancing playback passed. The 257.602625-second WAV is 24 kHz mono, 12,364,970 bytes, SHA-256 `144ad5f16490f2d00da639f316d0c585d3c9e9835882f438063b5a4c06cd0838`. Objective RMS is −18.22 dBFS with zero fully clipped PCM samples. These measurements do not establish perceived quality.
- The same story reopened with the complete script and ten character assignments retained. The sound plan retains eight named cues. The voice pass deliberately has sound design disabled while real sound files are being generated.
- Worker source `dd36c342bd36464bc5b8f6d4cb13c70b87c023d5` was activated on both CPUs; backup/result `/workspace/ecco-audio-update-1792900809778004095/`. Actual live counters reached 43 of 44 and then Audio saved. The interrupted previous job `afec87d254b84e6f806055bca3332cf8` is recorded as failed, not successful.
- Real PDF upload and chapter lookup exposed an omitted interior page in verification evidence. Fix `d1d0baa74138032a0f3106b7c6816a618229fb86` passed Pages 40160941366, UI Registry and eight focused tests. A live retest after refresh returned the reviewed 8,174-character Chapter 1 selection on physical pages 8–12 and preserved existing main-script content when nested dialogs were dismissed.
- ACE-Step 1.5 has generated a real 10-second instrumental CPU qualification recording; model revision `19671f406d603126926c1b7e2adc169acbcade22`, source `ca1e85fe9430179831e6bc6be790c332190a3866`. MOSS weights revision `e35df4d82fbe87fcd5d14e5d100e349c0c3c076d` is downloaded; qualification is still running at this checkpoint.
- Three authenticated UI music jobs were submitted: Story Invitation `0074d0685fab4867a3655a3de090129e`, Year Farewell `1e42bac40a4e4931929100a18d5e6363`, Mercy Offered `cb9d310b97834829be76af55acbfb969`. Completion, cue attachment and replay are not claimed here.
- Sound packages/weights use temporary RAM-backed paths on the 64 GB CPU because the shared network volume reached quota during installation. Native libraries stay on an executable filesystem; no mount security flags were changed. This is not a durable post-replacement installation.
- Remaining: real effect/ambience generation, all cue assignments, full mixed recording and refresh/replay; comprehensive selected-word/sentence/paragraph acceptance; broader workflow persistence; actual listening and voice distinction. The catalog does not provide 21 distinct male/female/child voice identities. Scheduled soundtracks remain separately pending. No GPU was used.


## Full Chapter 1 recording — 25 October 2026

**The full CPU-generated mixed recording is saved and playable. This is not a blanket journey-completion or subjective quality claim.**

- Audio Library → **Storybooks** → **Arabian Nights — Chapter 1 · Full story with music & effects**. Job `e6acc0ee462d465088f2b4c2498298af`; generated asset `dc5ffadfd5e5d96c903b666c8e4bcfc9`.
- 259.841958 seconds (about 4:20), stereo 48 kHz PCM, 49,889,734 bytes. SHA-256 `5a74ac9c0049c660d3d95545a5d574b8e21a56ea6f3941d79527ee7d7295f2c8`. All 49 rendered speech segments and eight sound cues are included. Six distinct new sound files were generated on the same CPU; one derived spring file was level-balanced and uploaded through the UI.
- The job used Chatterbox on `smiling_sapphire_mandrill` / `0g6485yvcjldmo`, CPU only. The live Progress tab showed real completed-passage counters. Displayed and submitted script text match after whitespace normalization. Character voice/pitch/speed settings and all six sound-asset snapshot hashes were verified in the accepted request.
- The first final mix **failed** because this pod had FFmpeg 4.2.7, which rejected `adelay:all`. Installing the pinned `imageio-ffmpeg==0.6.0` package supplied FFmpeg 7.0.2; `/usr/local/bin/ffmpeg` now selects it on this CPU. A real full mixer rerun succeeded. Guarded helper `4e215537d7d2b9f099ba75de462f9771e0d54116` recovered this one failed job using its retained complete speech. The normal storage finalizer then copied, hashed and saved the generated asset. The failed status, original speech and request remain in the recovery audit directory; no success was claimed before a real mix existed.
- Recovery audit: `queue/e6acc0ee462d465088f2b4c2498298af/mix-recovery-1792906641121670014/`. Five recovery guard tests passed (valid promotion, mixer failure, truncated output, wrong CPU, changed request). This was an administrative recovery, **not an uninterrupted first-attempt UI success**.
- After a full browser refresh the authenticated library retrieved the recording. Playback advanced through 36.85 seconds without a media error, then a separate end check reached `ended=true` at 259.841958 seconds. The Storybooks label was saved through the normal UI. The downloaded WAV hash matches the worker and saved asset; measured RMS −21.26 dBFS, peak −1.87 dBFS, zero clipped PCM samples.
- A full-length 192 kbps MP3 export was also produced with 1 dB additional headroom: 259.872 seconds, 6,237,634 bytes, SHA-256 `cddaea8dc4dd1135572b25f0fd2cbeabd9c19cae0426268748c73f7ae9b2eee1`. An incomplete intermediate export was detected and replaced before delivery; the retained version is the verified full-length file.
- **Remaining:** actual listening review and voice/mix quality acceptance; a fresh uninterrupted mixed-generation run after the dependency repair; complete cross-browser persistence and all source-selection variants; durable post-pod-replacement sound/mixer installation. The requested 21 distinct male/female/child voice identities and separately scheduled soundtracks are not complete. Do not disable the readiness watch or claim Amazon-sale quality from playback, waveform checks or source tests.


## Sound assets and refinement verification — 2026-10-25 UTC

- Both ACE-Step 1.5 and MOSS SoundEffect v2 passed actual CPU WAV qualification on worker `0g6485yvcjldmo`; neither qualification is a subjective listening review. MOSS source `934d6826b084c46a0d033402174d5f8ac4ed2519`, model `e35df4d82fbe87fcd5d14e5d100e349c0c3c076d`; ACE source `ca1e85fe9430179831e6bc6be790c332190a3866`, model `19671f406d603126926c1b7e2adc169acbcade22`.
- Real authenticated UI music requests completed: Story Invitation `0074d0685fab4867a3655a3de090129e` (asset `6c0b36ad76c36b43af88e1ea977146b1`, 20s); Year Farewell `1e42bac40a4e4931929100a18d5e6363` (asset `0b0c61d8c429276296f398cbac38402f`, 18s); Mercy Offered `cb9d310b97834829be76af55acbfb969` (asset `797f76b126dba64eb11cf027b305a7d3`, 10s). All three downloaded with readyState 4 and no browser media error. Their SHA-256 values are `876125578607d1c98d2e9a89a96ea89790ca21e14fab6bb6e1dd96dd43ce2e4f`, `018050962ec0d9a1ec9d5aa962b2c833ab8e43c7fadba58613edaa667d9da8db`, and `4e98aac8bef3d33d885b7e4d7a160526158142fbba899482870423560a8db27c` respectively.
- Shaded Spring job `2b5d3c10c7154e6d8c47df9083438991`, asset `be79ffd8bae0597d5c30ff43aad483e3`, generated a 15-second 48 kHz mono file, SHA-256 `d57fdaa8af370a3444cd4008953b8a974ea18594be6ef53ba3815561cba0c294`. Its measured RMS was -42.16 dBFS, so a derived copy was level-balanced with CPU FFmpeg loudnorm (I=-24, TP=-3, LRA=7) and uploaded through Sound Design → Upload Audio. That derived asset is `93a693a704714f559a53949caf1ab586`, SHA-256 `cd66cfcff48e433aa1abcffa8dfe0558d03f05c88b660e41fa05e654edd2082d`; both spring cues use this copy. This level-balancing was an explicit production operation, not an automatic UI feature or another model generation.
- First Genie job `428e9bc2df0c4be68d51c8a3c2173107`, asset `83a7dd41da0069aed031c4f02b7ea1d7`, generated a 3-second 48 kHz mono effect, SHA-256 `b11504384c48b5925230a0031d32a61de55eb3e87dbf285da7329e6e26ef37d8`. This actual generated effect is assigned to First Genie and Gathering Smoke, preserving their different named timings.
- Final Script real-AI acceptance exercised a selected word with Improve Again, a selected sentence, and a selected paragraph. Each Apply changed only the selected range, verified against all 44 fields. Minimize → Connection options → Resume retained the selected original, instructions and candidate replacement. A full browser refresh and explicit story selection retained all three edits (44 passages / 3,596 spoken characters).
- The concurrent sound-job UI exposed a redraw defect: completing one cue removed sibling progress controls and their pollers. Fix `7f96ad0340f6abbe12c58f195aa07c81b4b361ae` refreshes asset choices without replacing sibling controls. Seven focused tests passed; Pages run 40162570982 and UI Registry 40162571435 succeeded. The refreshed live page includes the fix. The focused concurrent regression uses controlled promises; a new pair of live concurrent completions has not been separately repeated.
- Current soundtrack levels were set in the existing UI: music -14 dB, balanced spring ambience -8 dB, Jinn effects -8 dB. Existing fades, phrase timing, loops and speech ducking remain enabled. No unrelated UI changes or GPU activation were made.

- Desert Journey Wind job `cbf5fd8e3984405f872cd7f4bca40850`, asset `0a27eede4af380d736528ee9c2aa7bea`, completed with a 15-second 48 kHz mono WAV. SHA-256 `fa11b9cdf72e00020f1fd9d48b906bffe28e736f1ac34ec40f96197da5c9a25a`, measured RMS -18.44 dBFS, peak -0.89 dBFS, zero clipped PCM samples. Browser metadata loaded with readyState 4 and no error. Its existing UI gain was set to -16 dB. All eight named cues now have assigned assets; the full mix was submitted from the normal Generate audio button using Chatterbox and the explicitly selected 16 vCPU / 64 GB CPU.

- Final mixed job ID: `e6acc0ee462d465088f2b4c2498298af`. The accepted request has 49 segments (the 44 displayed passages split at five phrase cue boundaries), eight cues, six verified asset snapshots, model `chatterbox`, compute `cpu`, worker `0g6485yvcjldmo`. Whitespace-normalized displayed and submitted speech have the same SHA-256 `24bbdee801ab5642f9431a1f0695e169f989637922f88bf76dae3173f5e85a17`; no words were lost when phrase timing split passages. The request retains all ten distinct voice/pitch/speed combinations, including Jinn mar_m/-4/0.9 and Dinarzade pan_f2/+2/1.1. These are delivery combinations, not ten independent voice identities.
