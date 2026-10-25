# Audio Studio — GitHub Pages interface and disposable inference worker

## Automatic sound workflow — authenticated CPU acceptance, 25 October 2026

A fresh main-button run automatically created a missing background music file, retained an existing effect, generated speech and saved the mix without administrative recovery. This is a focused Audio Studio functional test, not full storybook or subjective listening acceptance.

- Pages/UI Registry succeeded for `9430d0d5ea531056244dddc433ea8d428dedd874`, `54254412db4f793f04cc4a0ec99cfa265c402d40`, and `4c0c56283e3ff1266bbe655e2a5da4da5d133486`. Typed mix-setting persistence correction `3dcf8d58f5fe66d68ef098859ce3da9ab44d7395` also passed Pages [40169562974](https://github.com/ecco-ai-labs/ecco-studio/actions/runs/40169562974) and UI Registry. The existing qualified CPU worker handled this test; no runtime was provisioned and no GPU used.
- Story: **Sound cue workflow — CPU acceptance**. Audio Library → **Storybooks** → **CPU acceptance — automatic music and inline sound cues**.
- New music job `6597321774784b19b827227cf2ece82e` completed on CPU `0g6485yvcjldmo`. ACE-Step produced **Homecoming Melody — CPU workflow test**, ten seconds, asset `3dfad854fc9bc013eb39927b1480efcd`, SHA-256 `b436dbaf3fcf8b6a86b3bb2b6e112ba9c2183d7734853a85a246635eff15ef7a`. Main Generate audio created and attached it automatically from the saved description.
- Existing **Desert Journey Wind** asset `0a27eede4af380d736528ee9c2aa7bea` stayed assigned to the second turn and was not regenerated.
- Speech/mix job `41912ece6ad64b07a0282f1dcdba51e8` completed on the same CPU and saved asset `8be5ce32fe8b09cfb5a0dea8a34c89e7`: 21.501896 seconds, SHA-256 `3f085dfc204471089754c3fcf57e58ac1d3a137445098763cbc8af3a424dc6ad`. The exact phrase **The door opened.** split the first turn; the accepted soundtrack starts after that phrase. Two visible turns became three worker speech segments. The UI displayed **Generating Speech: 0 of 3 passages complete**, then **Audio saved**.
- The recording was labeled through the normal UI, retrieved from authenticated Audio Library after a full refresh, and played to `ended=true` at 21.501896 seconds with no media error. New sound assignments and both script turns survived refresh.
- Live checking caught and corrected Add Sound focus, immediate type-dependent settings refresh, and typed volume/fade persistence. The first recording used the default -14 dB / 0.08-second fade instead of the entered mix settings; it must not be used as evidence that those values were respected. Eight focused automatic-sound tests now pass, including persisted input values reaching the submitted soundtrack; the broader earlier focused suite passed 27 checks.
- The corrected live rerun **CPU acceptance — verified mix controls** completed normally as job `298fe34f40f14abab09d8034cc262e5f`, asset `af27e505056cdbba53311cccb7f96645`. It submitted the exact UI values (-24 dB music, -26 dB effect, one-second fades, both ducked), reused both sound files, and saved a 21.262104-second mix, SHA-256 `132ac2616b20540cbd534fa013fd3e0072a71583dee8852fdd94f65d7230eb67`. The Review player reached `ended=true` with no media error. Progress was visually checked at 2 of 3 completed passages. Add Sound opened/focused a new cue; changing Type to Background Music immediately selected ACE-Step and ten seconds; the temporary cue was removed without changing the two tested assignments.
- Scope limits: this short run used model-default English voices. It does not establish distinct-character voice quality, Hindi performance, the full PDF-to-audiobook journey, cross-browser draft synchronization, or durable runtime restoration. A Story flow navigation guard requiring scenes was observed during setup and was not changed in this audio-only update. The requested expanded voice bank and scheduled soundtracks remain pending.

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

## Earlier voice-only checkpoint — 25 October 2026

**Full voice performance saved; final mixed-audiobook acceptance is still pending.**

- Authenticated UI job `5e28aad5540a47a181c6fc5ee0892931` completed on CPU `0g6485yvcjldmo` (`smiling_sapphire_mandrill`). Chatterbox rendered all 44 passages: opening plus 43 dialogue turns, 3,570 spoken characters, ten speaking roles. The final timing entry ends at 257.602625 seconds.
- The file is in Audio Library → Storybooks as **Arabian Nights — Chapter 1 · Voice performance**. It was downloaded, retrieved again after a full browser refresh and played with advancing media time, readyState 4 and no media error. WAV: mono 24 kHz, 12,364,970 bytes; SHA-256 `144ad5f16490f2d00da639f316d0c585d3c9e9835882f438063b5a4c06cd0838`. This voice pass has no soundtrack; do not describe it as the finished mix.
- Worker progress activation from `dd36c342bd36464bc5b8f6d4cb13c70b87c023d5` completed on both CPU workers; backup/result: `/workspace/ecco-audio-update-1792900809778004095/`. The live UI displayed actual completed-passage counters through 43 of 44, then Audio saved. The 80-segment schema had already activated at 03:33:01 UTC from `fd624a3cadd0007f7d39fe1287dff40ed1ea29fc`.
- The original 255-page PDF was uploaded again in Generate with AI. A real chapter lookup exposed missing interior-page evidence in the verifier. Fix `d1d0baa74138032a0f3106b7c6816a618229fb86` includes every intervening page; Pages [40160941366](https://github.com/ecco-ai-labs/ecco-studio/actions/runs/40160941366) and UI Registry passed. After refreshing, Find Chapter with AI successfully returned **The Story of the Merchant and the Genius · PDF pages 8–12 · 8,174 characters**, matching the reviewed source length.
- The earlier full job `afec87d254b84e6f806055bca3332cf8` failed when sound installation exhausted the 300 GB shared volume. Reproducible installation caches were removed; the speech archive was verified and moved to each CPU's local /opt. RAM-cached sound packages and weights restored space. These sound installations are temporary and do not survive pod replacement.
- ACE-Step 1.5 passed real CPU qualification with a 10-second instrumental WAV at `sounds/ace-step-1.5/verification-cpu-1792902055141434979/output.wav`. MOSS qualification is running. The UI has submitted separate opening, farewell and closing music jobs; none is reported complete in this checkpoint.
- Eight named sound cues and their timing, volume, fades and ducking settings remain saved. New effects, finished cue assignments, a full mixed render and its refresh/replay test are pending. Actual listening is **not available in this test environment**; playback and waveform checks do not validate perceived voice/mix quality.
- Scheduled soundtracks and the requested expanded voice catalog remain separately incomplete. No GPU was started or used.

## Release status

CPU instance selection now routes speech, voice previews and new sound requests
to an explicit worker ID. The existing Compute dropdown shows each registered
CPU by name, vCPU/RAM and Ready/Unavailable status. An unavailable selected CPU
stays selected; jobs never silently move to another CPU or GPU. Per-instance
worker locks and per-job claims allow both CPU workers to share the queue.
Worker registration is in `worker-configs/<pod-id>.json`; a fresh version-1
instance-routing heartbeat is required. Sound readiness is per instance and
requires model qualification plus at least 16 GiB RAM. This code update alone
does not qualify the newly provisioned worker or complete the audiobook test.

The storybook integration and new sound-generation adapter described below are
deployed. Real CPU qualification and a recovered full mixed recording are recorded
above; complete journey and listening acceptance remain pending.
They are **not an end-to-end acceptance result**. Follow
[STORYBOOK_ACCEPTANCE.md](STORYBOOK_ACCEPTANCE.md) for deployment and test evidence.

## Two CPU choices — 2026-10-25

Both registered CPU workers are live and selectable: `ecco-storage-api`
(2 vCPU / 8 GB) and `smiling_sapphire_mandrill` (16 vCPU / 64 GB).
Real authenticated Chatterbox previews completed on each explicitly selected
machine and replayed from Audio Library after refresh. The new CPU selection
also survived refresh. No GPU was started or used.

The new CPU's first 4.6785-second preview took 46.0 seconds including loading.
The original CPU's separate preview was 1.518417 seconds. These verify routing,
inference and saved playback; they do not validate audiobook quality.
The delivery planner now uses a strict structured response after a live preview
exposed an intermittent formatting failure. Runtime revisions, job IDs,
checksums and the still-incomplete storybook checklist are recorded in
[STORYBOOK_ACCEPTANCE.md](STORYBOOK_ACCEPTANCE.md).

## Storybook integration — 2026-10-24

Pages deployment [40140910982](https://github.com/ecco-ai-labs/ecco-studio/actions/runs/40140910982)
completed successfully for `99789a5143bc0cb792df4066b59d02dd60ad0e6c` at 23:00 UTC.
At 23:00:48 UTC, the existing CPU coordinator and worker activated source
`a9fc138de19f51f8954300e99bec4f8e15f21f69` using the pinned helper from that release.
All 24 destination checksums matched. `/healthz` returned `ok: true`; the fresh
CPU heartbeat advertised character controls, sound design and sound generation
at version 1, with `sound_models: []`. Backups and result are retained at
`/workspace/ecco-audio-update-1792882823643103665/`. No GPU was started.

Live UI checks verified the Tone dropdown, visible AI upload, attached-PDF
loading, chapter connection errors and nested popup focus return. A fresh-story
check also found old unsaved audio being reused; draft IDs now isolate new
stories while retaining earlier drafts. The complete authenticated chapter
generation and listening review remain pending.

Generate with AI now keeps Upload Paper / Text visible, provides Tone presets,
shows chapter-search progress/errors beside the control, and supports repeated
selected-text improvements before exact-range Apply. Large PDF chapter lookup
filters repeated headers and footers while retaining exact boundary verification.
Reviewed scripts suggest uniquely named sound cues. Save and Continue persists
the reviewed source, cast, dialogue and sound plan in the story and opens Audio.
Audio has Final Script, Progress and Review tabs; no old recordings are shown.

Each sound cue can use an existing Audio Library file or Generate Sound from its
description. MOSS SoundEffect v2 handles effects/ambience; ACE-Step 1.5 handles
instrumental music. Sound jobs use authenticated storage, verified compute-specific
readiness, isolated model environments, real queue progress and the existing
checksum-verified asset finalizer. No runtime is downloaded or provisioned by a
browser selection, and no request falls back to a different compute class.

Deploy the matching `backend/storage_api.py`, `backend/audio_stories.py`,
`backend/audio_jobs.py`, `audio/audio_queue.py`, `audio/queue_worker.py`,
`audio/sound_schema.py`, `audio/sound_worker.py` and their existing speech/mixer
dependencies together. Install models explicitly using `install_sound_models.py
install --model MODEL --compute cpu|a100|b200`; qualify each with its `verify`
command. Only successful real inference adds a model to `sound-ready-COMPUTE.json`.
An installation or heartbeat alone does not prove audible quality. CPU qualification
refuses a container with less than 16 GB RAM to protect the workspace coordinator.

MOSS source and ACE-Step source are pinned in the installer; downloaded model
revisions and dependency versions are recorded. Sources: Apache-2.0
[MOSS SoundEffect v2](https://huggingface.co/OpenMOSS-Team/MOSS-SoundEffect-v2.0)
and MIT [ACE-Step 1.5](https://huggingface.co/ACE-Step/Ace-Step1.5).
New sound-model installation, real sound inference and listening acceptance are
still pending. Scheduled soundtracks remain unsupported; this update does not
remove the explicit scheduling guard.

Live audio generation is connected through the authenticated CPU storage API.
The interface stays on GitHub Pages. Indic-Mio, Chatterbox Multilingual and IndicF5
inference run on the selected CPU or GPU worker; jobs,
scripts, and generated WAV assets persist on the network volume independently.
An English-and-Hindi request passed generation, checksum-verified asset commit,
and authenticated media retrieval on 2026-10-18.

## CPU activation recorded — 2026-10-24

The existing CPU audio worker and storage API were updated at 14:52 PDT
(21:52 UTC), using audio source revision
`3f692c86f6356727fcfe9c316f0717e5570bae5a` and deployment helper
`a8784b4b2c3c7db298a20d032077de1e2886fc99`. No GPU was started.

All 16 destination checksums matched the pinned plan (9 source files, with
shared audio modules installed in both service directories). The restarted API
returned `{"ok": true, "service": "ecco-storage-api", "gpu_required": false}`.
The fresh CPU heartbeat advertised Indic-Mio, Chatterbox and IndicF5 with
`character_controls_version: 1` and `sound_design_version: 1`.
Source backups and the deployment result are retained at
`/workspace/ecco-audio-update-1792878724640331142/`.

This establishes CPU runtime activation and health, not successful new audio
generation. Authenticated end-to-end generation, a saved playable mixed recording,
and listening acceptance for the updated delivery are still pending. Real-book
chapter-boundary and selected-text AI acceptance are also not established by this
deployment. At that activation, generating new sound files and scheduled
soundtracks were unimplemented; only existing Audio Library sounds were supported.
The new source adapter above does not change this recorded runtime evidence.
GPU activation/readiness was not tested.

## Ownership

| Part | Location |
| --- | --- |
| Interface and source | GitHub Pages / this repository |
| Authentication, metadata, job finalization and media access | CPU storage API |
| Durable queue | /workspace/ecco-audio/queue on the shared network volume |
| Saved audio | /workspace/ecco-studio-data/audio-dev, written by the CPU service |
| Model weights and dependencies | /workspace/ecco-audio |
| CPU / GPU workers | queue_worker.py invokes disposable speech inference subprocesses |

Only the CPU service writes authoritative audio metadata. The GPU worker does not
open the Studio database or hold the storage access key. The current service uses
one workspace access key; per-user authorization is not yet implemented.

## Runtime

Deploy backend/audio_jobs.py with storage_api.py and audio/audio_queue.py plus
audio/audio_schema.py on the CPU service. The coordinator validates requests,
limits outstanding jobs to four, verifies WAV metadata/checksums and finalizes
assets with deterministic IDs. Finalization is retry-safe.

On the GPU, deploy audio_worker.py, audio_schema.py, audio_queue.py, queue_worker.py
and start_worker.sh to /workspace/ecco-audio. start_worker.sh uses the existing
/opt/ecco-runtime-venv runtime plus isolated dependencies at /workspace/ecco-audio/deps.
The persistent runtime boot.sh starts it after restoring the Python runtime.
A separate file lock for each compute target serializes its inference; heartbeats expose per-model readiness.
A crashed running job becomes an explicit error on worker restart; queued work is
retained. Models are released after each inference subprocess finishes.
Download snapshots with install_models.py; exact revisions are saved in models/manifest.json.
Completed recordings can be listed, played and downloaded while the GPU is off.

## Application adapter

After authenticated service setup, call `window.EccoAudioStudio.connect(adapter)`.
The adapter must expose `storageIndependentOfGPU: true` and these asynchronous methods:

- `status()`: current compute availability and supported model IDs.
- `list({story_id})`: the authorized user's audio assets (array).
- `generate(request)`: validate ownership and the schema below, durably queue the
  job, return `{id}`. The request explicitly selects CPU, A100, or B200.
- `job(id)`: return `{id,status,error?,progress?}`; `done` means durable output verified.
- `mediaURL(assetId)`: return an authenticated same-origin Blob URL or authorized HTTPS playback URL.
- `download(assetId)`: perform an authenticated WAV download.

Call `disconnect()` on sign-out. This adapter is a wiring contract, not a security
boundary: the application service must enforce authentication and ownership on
every operation, isolate users, and protect storage credentials. Never include
credentials in this public repository, browser-local storage, or a GPU job payload.

Asset fields used by the UI: `id`, `story_id`, `title`, `prompt`, `stage`, `duration`,
`deleted`. Request fields: `compute` (`cpu`, `a100`, or `b200`), `model` (`indic-mio`, `chatterbox`, or `indicf5`), `story_id`, `title`, `lines` (each has
`text`, `language`, `voice`, `emotion`), `speed`, `pitch`, `pause`. Server-side request
validation is in `audio_schema.py`; the service must also validate story ownership.

## Worker

`audio_worker.py` is a command-line inference implementation, not an app server or
database. It loads Indic-Mio and MioCodec from explicitly supplied local model
directories. Its output goes to the private queue directory. The job coordinator
copies the result into independent private media storage, verify bytes/checksum and audio
metadata, and atomically commit the asset before reporting completion. Per-compute locks and deterministic asset IDs prevent duplicate inference and finalization.

Dependencies: Python 3.12+, CUDA PyTorch/torchaudio, `requirements.txt`, and FFmpeg.
The supplied runtime directory must contain `model/` (SPRINGLab/Indic-Mio), `codec/`
(Aratako/MioCodec-25Hz-24kHz), and `presets/en_female.pt`, `presets/en_male.pt` from
Aratako/MioTTS-Inference. Pin and record model snapshot revisions during deployment.
Speaker presets are loaded with PyTorch `weights_only=True`. No remote model code
is enabled. Audio uses the codec's configured sample rate, not a hard-coded 44 kHz.

```sh
python audio_worker.py --request /tmp/audio-job/request.json \
  --runtime /tmp/audio-models --output /tmp/audio-job/output.wav
```

The language dropdown controls valid emotion choices and records language intent;
it does not translate text or guarantee a dialect. Mixed-language input is passed
unchanged. Emotions use model tags; pitch and speed are FFmpeg postprocessing.
Voice cloning from a user reference is not included in this release.

Model: https://huggingface.co/SPRINGLab/Indic-Mio (Apache 2.0).
Codec: https://github.com/Aratako/MioCodec (MIT).
Upstream inference reference: https://github.com/Aratako/MioTTS-Inference (MIT).

## Validation

Run `python -m unittest discover -s audio -p 'test_*.py'` and
`node --check audio-studio.js`. Browser acceptance: open Audio Studio without a GPU;
add/edit Hindi, Urdu and English lines; inspect emotion options; navigate away and
return; confirm drafts survive, compute defaults to CPU, and only the selected live
worker can receive generation or preview jobs. No GPU fallback is permitted. Run
`backend/verify_audio_models_live.py` on the CPU pod to verify new-model generation,
durable asset commit, and authenticated WAV playback before release.


## Additional audio models

`model_catalog.json` is the server catalog; `audio-models.js` contains the same
public UI catalog and is checked against it in tests. Both model menus share it.

| Model ID | Languages | Controls |
| --- | --- | --- |
| indic-mio | 22 Indian languages + English | Existing presets and emotion tags |
| chatterbox | 23 languages, including Hindi and English | Default/reference voice, expressiveness |
| indicf5 | 11 Indian languages, including Hindi, Tamil and Punjabi | Reference voice |

Urdu remains available through Indic-Mio. Chatterbox and IndicF5 are not advertised
as Urdu models. Reference voices are the seven official IndicF5 examples; labels
describe their source voices, not guaranteed output accents. Dialect and delivery
notes guide AI script writing. Pitch, speed and pauses use the same WAV assembly.

`install_extra_models.sh` creates isolated environments while retaining the pod's
CUDA PyTorch version. `extra_worker.py` loads local checkpoints; no model-card code
is executed dynamically. The IndicF5 vocoder is downloaded separately. Run
`prepare_reference_voices.py` once in the IndicF5 environment to fetch the official
examples and transcribe references. The ASR model is only an installation tool.

The queue dispatches only allowlisted model IDs to their own interpreter, removes
the Indic-Mio dependency path, and releases model VRAM after every job. Deploy the
new catalog/schema on both the GPU and CPU coordinator. Back up prior files before
activation. Speech tests and authenticated API generation must pass before release.

On 2026-10-19, authenticated API tests passed for Chatterbox (English and Hindi,
default and reference voices, 5.46 seconds) and IndicF5 (Hindi, Tamil and Punjabi,
three reference voices, 7.57 seconds). Both outputs were saved as mono 24 kHz WAV
assets and retrieved through authenticated media playback. Twelve UI tests and
fifteen schema, dispatch and durable-job tests also passed.


## CPU audio service

The CPU coordinator launches a separate audio worker when the CPU launcher and
validated-model manifest exist. It does not load inference models into the API.
CPU runtimes use PyTorch 2.8 CPU wheels, one inference thread, and lower process
priority. Existing model weights are reused; GPU runtimes are unchanged.

1. Deploy worker sources and `model_catalog.json` to `/workspace/ecco-audio`.
2. Run `bash install_cpu_models.sh` on the CPU pod. It installs isolated model
   environments under `/opt/ecco-audio-cpu` and saves `cpu-runtime.tar.gz` on the
   shared volume for restoration after a pod restart.
3. Run `python3.12 verify_cpu_models.py`. Each successful CPU-only WAV test adds
   that model to `cpu-ready-models.json`; unverified models remain unavailable.
4. Run `bash start_cpu_worker.sh` or restart the updated storage API. The launcher
   uses a per-pod lock, restores the runtime if needed, and supervises the worker.

CPU readiness requires a fresh heartbeat and a verified model ID. Changing compute
never starts or rents a pod and never falls back to another machine. Completed
assets record the compute target and worker pod. Long CPU jobs are slower than
GPU jobs; the existing 30-minute timeout still applies.

On 2026-10-19, all three CPU-only tests passed on the existing two-core, 8 GB
CPU pod: Indic-Mio (4.59 seconds of audio in 39.08 seconds), Chatterbox
(3.63 seconds in 117.65 seconds), and IndicF5 (3.16 seconds in 423.63 seconds).
An authenticated Indic-Mio job completed on the CPU pod in 33.61 seconds, saved
a 4.62-second mono 24 kHz WAV, and passed checksum verification through the
media endpoint. These short-test timings are observations, not latency promises.

## Character delivery update (CPU activation recorded above)

The UI now preserves per-character pitch, speed, pause and Chatterbox expressiveness.
The schema, coordinator, queue and both inference workers must be deployed together
from the same revision. Updated workers advertise `character_controls_version: 1`;
readiness exposes it only when all live workers for that compute target support it.
The UI uses legacy global controls for uniform settings and rejects distinct native
settings on old workers instead of dropping them. This source change does not
activate itself on RunPod. Stop/restart only an idle worker after backing up its files.

Chatterbox uses per-line exaggeration and lower guidance for expressive delivery.
Cross-language reference clips use zero guidance following the upstream recommendation:
https://github.com/resemble-ai/chatterbox#original-chatterbox-tips . Explicit voice
choices remain unchanged; newly assigned Hindi/English characters use the model
default instead of random Kannada/Marathi references. Free-text acting directions
are converted to bounded supported cues, not spoken or passed as an unsupported
model prompt. Indic-Mio uses supported emotion tags; IndicF5 uses its reference
voice and common timing controls. These mappings require listening acceptance;
unit tests do not establish professional voice quality or accent accuracy.

## Sound design update (CPU activation recorded above)

Music and effects use selected Audio Library assets, not a generative sound model.
The UI suggests/reviews cues separately from dialogue and requires explicit files.
An exact trigger phrase splits speech at that point, retaining per-character native
controls and removing only the pause introduced by the split. The common assembler
measures post-DSP durations and `audio_soundtrack.py` mixes on CPU using FFmpeg.
Background beds can loop, fade and duck during speech; effects play once up to
30 seconds. The final PCM stereo WAV is saved through the existing checksum path.

Deploy `audio_soundtrack.py`, `audio_schema.py`, `audio_worker.py`,
`audio_queue.py`, `queue_worker.py`, and `backend/audio_jobs.py` together; also
deploy `backend/audio_workflows.py` for its explicit unsupported-schedule guard.
`extra_worker.py` uses the common assembler. Install no additional speech model
or GPU runtime. Restart only idle workers after checking current jobs. A worker
advertises `sound_design_version=1`; availability requires every live worker for
that compute class to support it. UI publication does not activate this runtime.

The coordinator resolves workspace audio IDs, checks asset type, Trash state and
resolved-path containment, then snapshots at most 64 MB of selected sounds beside
the queued request. Workers verify snapshot checksums, never fetch user URLs, and
show `Mixing music and effects` during assembly. A mix failure marks the job as an
error instead of saving voice-only output as a completed soundtrack. The original
script and sound-cue selections remain editable in the browser.

Run the sound-design UI tests and audio/`test_soundtrack.py` before deployment, then
perform authenticated end-to-end generation and listen to an actual story sample.
Synthetic timing/ducking tests establish the mixer behavior, not artistic quality.
Scheduled generation with sound cues is deliberately rejected until per-run cue
planning is implemented; existing voice-only workflows remain supported.


## Automatic soundtrack preparation — 25 October 2026

Final Script now starts with Spoken script, followed by numbered turns and inline sound cue review. Existing Generate with AI and exact-range Improve with AI dialogs remain unchanged. Each cue can use Audio Library, upload, preview or generate a new sound. Generate audio creates missing sounds serially on the selected compute, saves assignments, then submits the mixed recording. Confirmed jobs resume after interruption; uncertain submissions are not retried automatically. Script changes require timing review. Progress uses real worker completed/total passage counts.

This frontend update uses the already qualified sound-generation and mixing service. It does not install models or activate another worker. Automated UI tests cover ordering, partial retry, interrupted polling, stale drafts, inline assignment and worker-count progress. Focused authenticated CPU acceptance is recorded at the top of this file. Scheduled soundtracks remain separate and pending.

## Prepared: mixed character models and audition samples

Kokoro-82M, VoxCPM2 and Indic Parler-TTS are registered alongside existing models.
Each character can override the recording model and retain its own voice, language,
style, pitch, speed and expressiveness where supported. Listen requests a short
sample and reuses saved assets or resumes an existing confirmed sample job.

Model weights are downloaded once to shared `models/<model>` storage. CPU/GPU
selection belongs to the generation request; each connected machine needs its own
compatible runtime. The new installer currently prepares CPU runtimes and records
immutable model revisions. It does not advertise readiness. Indic Parler may require
the operator to accept the upstream Hugging Face access conditions. No auth bypass
or GPU provisioning is part of installation.

The mixed worker groups passages by model, runs isolated interpreters serially,
restores original order from actual passage boundaries, resamples to 48 kHz, applies
original pauses and mixes the soundtrack once. Each child's delivery DSP runs once.
A failure aborts the recording; no partial or silently substituted voice is saved.
Stop/timeout terminates the complete process group.

Release status: implementation and local checks only. CPU installation, runtime
activation, real inference for new models, authenticated mixed generation, durable
Audio Library retrieval and actual listening acceptance are still required. A green
Pages deployment does not establish any of those. Scheduled soundtracks remain a
separate outstanding item.

The prepared Final Script view also exposes Generation Directions: audience, genre,
tone, narration/language style and character delivery. A bounded `performance_brief`
is preserved in the submitted request and saved recording. VoxCPM2/Indic Parler
consume it in native direction prompts, separate from spoken words. Chatterbox
acting cues use its real expressiveness/pause controls; explicit settings win.
Kokoro has no arbitrary acting-prompt input; no equivalent compliance is claimed.
Audience/tone changes invalidate delivery refinement and voice-sample cache keys.
