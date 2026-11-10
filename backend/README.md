# GPU-independent workspace storage

Source of truth: this GitHub repository. Run the storage API on the CPU-only
`ecco-storage-api` pod (`vowmjru85f2gzo`), with existing network volume
`b3qo8lps92` mounted at `/workspace`. The GitHub Pages UI remains at its canonical URL.

## Runtime

- Python 3.10+; Pillow for image upload and edits; ffprobe for video and audio upload.
- Existing database `/workspace/ecco-studio-data/studio.sqlite`. Startup refuses
  to manufacture an empty replacement if the mount or database is missing.
- Private access key: `/workspace/ecco-storage-private/access.key`, minimum
  32 characters, directory mode 0700 and file mode 0600. Never commit the key.
- `ECCO_STORAGE_BIND=0.0.0.0 ECCO_STORAGE_PORT=8888 python3.11 backend/storage_api.py`
- `/healthz` contains no private data. Every data request requires Bearer auth.
- Only the GitHub Pages origin is allowed by CORS. CORS is not authentication.
- This service does not initialize/reconcile GPU jobs, start inference, sync to
  external accounts automatically, or expose the original backend's static file routes.
- The access key must be provisioned privately before starting the service.

The original mutation code is retained in `migration/legacy` for schema compatibility.
Ecco Desk's `/api/desk` uses verified Google identity with separate, explicit
staff roles; it does not grant access to workspace/media/GPU routes. See
[`desk/README.md`](../desk/README.md) for team setup and deployment details.

Its generation dispatcher is inaccessible through the storage API allowlist.
The CPU service and GPU should not independently edit the same logical record at
once; SQLite handles database locking, but existing records do not have optimistic
concurrency versions. A follow-up should consolidate all mutations here.

## Validation

`python3.11 -m unittest discover -s backend -p 'test_*.py' -v`

Tests use a temporary database: unauthorized and wrong-origin requests are denied;
media ranges work; label writes persist; path escape is denied; generation requests
are rejected. Production data is not changed by these tests.

Audio uses the same authenticated CPU API: `audio/upload`, `audio/folders`, and
`audio/labels`. WAV, MP3, M4A, OGG and FLAC uploads are limited to 12 MB and
validated with ffprobe; uploaded bytes are preserved in `audio-prod`. Audio labels
use `audio_folder` records, independently of image labels, with the same recoverable
Trash workflow. Deploy `audio_library.py` beside `storage_api.py` and refresh
`migration/legacy/trash_manager.py` before restarting the CPU storage process.

## OpenAI across Studio

Deploy `openai_assistant.py` and `scene_planner.py` beside `storage_api.py` on the
same CPU service. In the UI open **Connections & Storage → Connect to OpenAI**.
The workspace owner supplies their own OpenAI project API key with Responses API
permission, model access and API billing. Ecco cannot issue an OpenAI key.
Connection performs a small billable inference test before saving the key.

The single **Enable AI across Studio** control applies to story, scene planning,
image, storyboard, audio, video review, character and publishing prompt assistance.
AI refines editable prompts before the next action; approved video shots receive a
read-only review. Questions or failures stop that action and preserve the draft.
The review dialog provides original/revised text and restoration while the fields
remain unchanged. Selected text and image references are sent to OpenAI; requests
use `store: false`. The API key is never sent to the GPU or returned to the UI.

The verified key and shared preference live in
`/workspace/ecco-storage-private/openai.json` (0600, outside served assets).
`ECCO_OPENAI_CONFIG_FILE` may override this private path. Never commit or serve
this file. Disconnect clears the saved key; disabling AI retains the connection.
All `/api/ai/*` endpoints use the existing workspace Bearer authentication and
origin checks. Scene planning uses the same key/model/control, with no separate
`OPENAI_API_KEY` or `ECCO_STORY_MODEL` setup. No GPU is needed for prompt assistance.

## YouTube channel authorization

YouTube connection and explicitly confirmed uploads run on this CPU service,
independently of GPU availability. Google identity sign-in does not grant access
to this shared workspace or its channel: all YouTube POST routes still require
the private workspace Bearer key and existing origin checks.

Deploy `youtube_connection.py` beside `storage_api.py`, plus the updated
`migration/legacy/studio.py`. Install `backend/requirements-youtube.txt` using
the storage service's Python environment, then restart that service when its
CPU jobs are idle. GitHub Pages deployment alone does not update the RunPod API.

In Google Cloud project **ECCO AI Labs**, enable **YouTube Data API v3** and use
the existing Web OAuth client
`219292517219-tngp5k9kso8jvk4ps6oqee45l0j97p78.apps.googleusercontent.com`.
Add this exact authorized redirect URI:

`https://vowmjru85f2gzo-8888.proxy.runpod.net/api/youtube/callback`

Store the Web client JSON privately at
`/workspace/ecco-storage-private/youtube-client.json`, with directory mode 0700
and file mode 0600, outside the repo and served assets. Include the exact callback
in its `web.redirect_uris` list. `YOUTUBE_CLIENT_SECRET_FILE` may override the
path. `ECCO_YOUTUBE_REDIRECT_URI` overrides the callback only when the new HTTPS
URL is registered in that client; it must end in `/api/youtube/callback`.
Never place the client secret or refresh token in GitHub or the browser UI.

First-time setup can also use Studio: connect the private workspace storage,
open **Connections → YouTube → Connect**, select the downloaded
Google Web OAuth client JSON, then click **Install configuration**. The file is
sent directly to the CPU service through authenticated `POST /api/youtube/configure`
(32 KB maximum). The service validates the existing client ID and Google's
OAuth endpoints and uses only its configured callback URL; no uploaded redirect
URL or file path is followed. Google still validates that the callback is registered
when consent begins. The imported client configuration is encrypted with the same
private Fernet key as the connection and installed atomically with 0600 permissions.
The endpoint refuses to replace an existing configuration or saved connection.
It returns availability only, never the secret. No configuration is stored in
browser storage, the asset library, or GitHub. Existing plaintext client files
remain supported. Back up both encrypted files and their key privately.
After installation, click **Connect** beside YouTube in Connections to grant consent.

The consent flow requests only `youtube.readonly` and `youtube.upload`, uses
short-lived single-use state and PKCE, and verifies the authenticated account
owns the channel selected during Google authorization before saving anything.
The private workspace retains one verified channel grant. Reconnecting replaces it only after successful authorization. Google identity sign-in alone cannot enumerate or authorize every Brand Account. This does not provision isolated workspaces for public users. While the Google app is in Testing,
the channel owner's Google account must be on its test-user list. YouTube
scopes may require Google's verification before wider production use; the
basic Google sign-in audience can still allow any Google account.

Verified channel metadata and OAuth credentials are encrypted with Fernet and saved atomically to
`/workspace/ecco-storage-private/youtube-connection.json` (0600), overridable
with `ECCO_YOUTUBE_TOKEN_FILE`. The encryption key is created with 0600 permissions
at `/workspace/ecco-storage-private/youtube-encryption.key` (`ECCO_YOUTUBE_KEY_FILE`
may override it). Back up the encrypted token and key privately. Only sanitized
channel metadata reaches Studio. Existing plaintext connections remain readable
and are encrypted on their next credential save. Disconnect removes the local grant and cancels pending consent callbacks; it does not delete videos or
revoke other Google applications.

Uploads must include the channel ID shown in the review form. It is checked
before queueing and again when the worker starts. A channel switch clears UI
confirmation and cannot redirect a queued upload. Schedule uploads as private
with a future UTC `publish_at`; YouTube handles the eventual release.
The callback deliberately bypasses workspace Bearer auth (Google redirects
cannot carry that header), but cannot exchange a code without the pending
owner-initiated state. Callback URLs and provider exceptions are never logged.
The callback has no scripts or external resources. Closing its result tab
returns the owner to the unchanged Studio form, whose channel selector updates
from the authenticated storage state poll.

Validation: `PYTHONPATH=backend python3 -m unittest test_youtube_connection test_storage_api -v`.
These tests use fake OAuth credentials and mocked Google APIs; they do not
authorize a real channel or upload videos. Live completion requires the owner
to grant Google's consent and the backend to verify the channel ID.

Backend tests mock OpenAI and use temporary private configuration/database files.
UI regression tests: install `jsdom@26.1.0` in a temporary test environment, then
run `NODE_PATH=<test-environment>/node_modules node --test ai-assistant.test.cjs`.
Live OpenAI output can only be verified after the owner connects their actual key.



Playlist deployment: update `backend/youtube_connection.py`, `backend/storage_api.py`
and `migration/legacy/studio.py` on the CPU service, then restart only when CPU
jobs are idle. No new dependencies or token-file migration are needed. Status
advertises `youtube_playlists_available` and `youtube_playlist_write`; the UI
keeps existing video uploads available before this update is running.

Authenticated `GET /api/youtube/playlists` lists the connected channel's playlists
with pagination and owner filtering. **Connections → Enable playlists** requests
`youtube.force-ssl` in addition to the existing read/upload scopes. The original
grant remains intact if the user denies this upgrade. Playlist creation and adding
an upload to a playlist require this additional scope. Authenticated
`POST /api/youtube/playlists` requires a matching channel ID, title, visibility
(private by default), and explicit confirmation.

Optional `playlist_id` on `/api/youtube/publish` is verified as owned by the same
channel before queueing and again at worker start. Only the actual uploaded video
ID is inserted. A failed playlist insertion preserves the completed video upload
and reports an unconfirmed playlist addition; it must not cause a duplicate upload.

Other social-platform connection rows remain unavailable; their publishing tabs
do not initiate uploads. Every platform's video chooser can open the existing
Video or Audio Library in multi-select mode. Confirmed video batches call the existing
single-video upload endpoint once per item; accepted and uncertain submissions
are not automatically retried. Audio selections remain visible but cannot be sent
to YouTube until converted to video. Opening/selecting library items does not
upload, convert media or start compute.

Publishing feedback: `publishing-status.js` records a bounded, credential-free
browser history before submission, retains the returned upload job ID and reconciles
it with authenticated workspace jobs/assets. This provides Activity and Debugging
entries even when a request fails before job creation, and reports worker errors
through the shared Errors log. Status uses actual worker progress and returned
YouTube ID/visibility; queued is not treated as uploaded. Older successful upload
assets recover their result/link; an unmatched reserved asset remains explicitly
unknown. This UI change requires no API restart and never retries an upload.

## Audio schedules: news, podcasts, series and storybooks

Deploy `audio_workflows.py` with the updated `storage_api.py` and `audio_jobs.py`
to the **existing CPU storage service**, alongside its existing dependencies.
Restart that service when current AI requests and audio runs are idle. This is a
backend deployment: the GitHub Pages UI deployment does not update the service.
No new pod, volume, public listener, API key or GPU installation is required.

The runner starts with the service (`ECCO_AUDIO_SCHEDULER_ENABLED=0` disables it),
but no definition is active until the authenticated owner selects Enable Schedule.
Its status is advertised as `config.audio_workflows.available`; the UI disables
scheduling controls if the deployed API does not advertise this capability.

Authenticated routes:
- `POST /api/audio/workflows/save`: validate and persist a paused definition.
- `POST /api/audio/workflows/control`: `run` with a unique request_id, `enable`, or `pause`.
- `GET /api/audio/workflows/status`: availability, definitions and run history.

Save payload (`POST /api/audio/workflows/save`), beyond the schedule fields
(`name`, `timezone`, `time`, `start_date`, `repeat`, `end_mode`, `end_date`, `run_count`):
- `source_mode`: `news`, `podcast`, `series` or `chapters`.
- News: `prompt` (topic, ≤12,000), `lookback` (hours, 1–168), `count` (stories/turns, 1–20).
  Each run researches fresh cited news.
- Podcast: `prompt` or `audio_snapshot.script_brief.source_text`; a fresh script each run.
- Series (open-ended, written fresh each run): `series_about` (≤2,000), `series_changes`
  (≤2,000, e.g. "One bird each week. Do not repeat a bird."), `series_plan` (≤100 topics,
  each ≤200), `no_repeat` (bool, default true). A run takes the next plan topic not in
  `used_topics`; when the plan is used up it asks AI for a new topic and rejects a repeat.
  Completed runs append their topic to `used_topics` (kept when the definition is saved
  again without it). `output_title` may use `{topic}`.
- Chapters: `chapters` (texts), `next_chapter`, `total_chapters`.
- Characters: `audio_snapshot.speakers[]`. A speaker with `per_episode: true` (a weekly
  guest) needs no `id` or `voice`; it keeps `name`, `language`, `emotion`. Each run picks a
  voice of that language that the fixed speakers don't use, rotating by episode, and records
  it on the run as `episode_voices`.

Definitions and run checkpoints use the existing SQLite records table. No schema
migration or secret is stored in a definition. The existing private OpenAI config
and shared AI enable control are reused. Source documents are copied as extracted
text in the audio snapshot; only the selected source and character directions are
sent for writing. News runs perform fresh cited research on each occurrence.

Schedules support daily, weekdays and weekly runs in IST, Pacific or UTC, with an
end date or total successful-run limit. Nonexistent DST slots are skipped and
repeated DST hours run once. Downtime does not cause a backlog burst: at most one
missed occurrence is resumed, then the next future slot is selected. Run limits
include successful Run Now tests. Book chapters advance only after audio is saved,
and stop after the final chapter. A run retains the settings saved at its start.
Pause stops future runs; a run already in progress may finish.

A process file lock serializes execution. Deterministic run/job identities and
checkpoint reconciliation prevent duplicate audio when the service restarts. An
interrupted AI call pauses with an error rather than silently spending on a retry.
Invalid AI output never reaches synthesis. Compute unavailability follows Wait or
Skip; no GPU is provisioned and CPU/A100/B200 never silently substitute for one
another. Failed runs pause the schedule for review. Audio and requested labels
are saved through the existing validated audio pipeline. Publishing is separate.

Current audio limits remain 4,000 spoken characters and 20 segments per recording;
use short book chapters/sections for the initial acceptance run. Keep the CPU
workspace service and selected audio worker running for unattended schedules.

Validation: `PYTHONPATH=backend python3 -m unittest test_audio_workflows test_audio_jobs test_storage_api -v`.
The tests use fake AI responses, temporary storage and synthetic worker status.
Live acceptance still requires three playable outputs in Audio Library and an
observed scheduled run with the browser closed; unit tests do not prove that.

Session health checks preserve open Desk conversations and unsent ticket drafts when the verified Google subject is unchanged. Account changes and revoked sessions still clear the previous user’s work.

### Deploying series schedules (2026-11-09)

`scripts/deploy_series_workflows.py` ships `backend/audio_workflows.py` (news,
podcast, series and chapters modes; per-episode characters) and
`backend/audio_library.py` (optional Audio Library labels) from commit 07f7761 with the same hash-checked, idle-only, roll-back-on-failure steps as
`deploy_audio_delivery.py`. `prepare` first checks that the pod already runs the
same `audio_jobs.py`, `news_research.py` and `openai_assistant.py`; if not, it stops and lists them, and `--with-deps` ships
them from the same commit. On the CPU pod, when no audio is running:

```
cd /workspace
for f in deploy_audio_delivery.py deploy_series_workflows.py; do curl -fsSLO https://raw.githubusercontent.com/ecco-ai-labs/ecco-studio/main/scripts/$f; done
API=$(pgrep -f storage_api.py | head -1); WORKER=$(pgrep -f queue_worker.py | head -1)
python3 deploy_series_workflows.py prepare --api-pid $API --worker-pid $WORKER
python3 deploy_series_workflows.py activate <directory printed after PREPARED>
```

Pass the same `--with-deps` to both steps if prepare asked for it.

## Automatic episodes (auto series)

An automatic episode goes from a chapter, a series topic, news research or a story's text
to a checked recording with a distinct voice per character, without the user choosing
voices, feelings or sounds. It is used for a one-time story's pilot and for every run of
a workflow saved with `auto: true`. Code: `backend/auto_series.py`; listen-back worker:
`audio/listen_worker.py`. Workflows without `auto` behave exactly as before.

**Phases** (saved after each; a restart resumes): `source` (scheduled runs: chapter text,
series topic or news research) → `cast` (AI: characters with gender, age group,
personality, voice brief, sample sentence, 2–4 feelings, `unusual`) → `voices` (match to
the series cast by id, name or alias; each new character gets one designed-voice job,
VoxCPM2 or Indic Parler-TTS by language; a brief too similar to an existing one gets a
contrasting trait; an `unusual` character gets two candidate samples) → `script` (AI
`audio_plan`; Podcast, Interview, News and Casual Conversation are rewritten as people
speak, Documentary/Educational are written for listening, stories keep the author's words
split by speaker) → `delivery` (AI `audio_directed_script`: per-line emotion, English
direction, pause 0–2 s; text must come back unchanged or delivery is skipped) → `sounds`
(AI cues, at most `max_cues`; each named sound is generated once with MOSS SoundEffect or
ACE-Step and reused by name across the series) → `assets` (waits for those jobs;
questions) → `record` (one `/api/audio/generate`-shaped request: `voice: "ref:<id>"`, or a
`palette` + `delivery` when the character has saved feeling clips in the same story;
`direction` for VoxCPM2; `speed` from a "slow"/"quick" direction or a saved
rule; `pause_before`; `soundtrack` with `sound_design_version: 1`) → `recording` → `check`
→ `listen` → done.

Feeling clips are not designed: the design models here make a new timbre each time, so a
designed "angry" clip would sound like another person. Feelings are carried by delivery
and direction; saved clips with an emotion (from `/api/audio/voices/create`) are used as
the palette. Automatic episodes need Chatterbox, IndicF5 or VoxCPM2 and an A100 or B200;
CPU is refused. Every AI call marks the episode in flight; if the service stops during the
call the episode errors ("No paid retry was made"). AI busy (429), four queued audio jobs
(429) or a missing worker/model (503) wait and show the reason in `progress`.

**Checks** (`checks.<name>.status`: `passed`, `failed`, `partial`, `skipped`; anything that
could not run is `skipped`, never `passed`):
- `distinct_voices` — each speaking character has a different clip (descriptions that are
  very similar are listed). Acoustic similarity is not measured.
- `gender_age` — the character's gender and age group against the words of its voice
  brief (not the audio). Voices from recordings without a brief are not checked (`partial`
  or `skipped`).
- `listen_back` — Whisper large-v3-turbo transcript vs. the script; `score` = share of
  script words heard in order, pass ≥ 0.8, `missing` = up to 5 missed passages. Runs as a
  queue job (`task: "listen"`) on a GPU worker advertising `listen_version: 1` (IndicF5
  environment present and Whisper weights cached by `prepare_reference_voices.py`).
  Skipped when no such worker is live, the job fails, or it takes over 30 minutes.
- `loudness` — FFmpeg `loudnorm` integrated loudness must be −26…−10 LUFS, and
  `silencedetect` (−45 dB) must find no silence longer than max(4 s, longest planned pause
  + 2 s). Skipped when FFmpeg is missing.
- `sounds`, `delivery` — whether sound design and AI delivery were used.

**Status:** `working` (with `phase`, `progress`), `question` (waiting for an answer),
`made` (finished pilot, or a story episode), `held` (scheduled episode waiting for
`publish`: the workflow's `review_before_publish` is true — the default — or a check
failed, `held_reason` says which), `published` (scheduled episode, review off, no failed
check; or published by hand), `error` (`error` says why). Published is a status on the
episode only; nothing is posted anywhere.

**Workflow fields** (`/api/audio/workflows/save`): `auto: true`, `review_before_publish`
(bool, default true; stored for every workflow), `auto_options: {language, audience?,
conversational? (default from genre), sounds? (true), listen_back? (true), max_cues? (0–6,
default 4)}`, `audio_snapshot: {model, compute, genre, worker_id?, speed?, pitch?, pause?,
script_brief?}`. Speakers are not needed and are not saved. Runs (`Run Now`, schedule)
create the episode `uuid5(URL, "ecco-auto-episode:" + run_id)`; the run shows
`waiting` + "Waiting for your answer: …" while a question is open and finishes `done`
when the episode is made, held or published (chapters, series topics and labels advance
as before).

**The series cast** is one record per story (or per workflow without a story); a
workflow with `source_story_id` shares its story's cast, so a story pilot and its
schedule use the same voices. Returning characters keep their voice; one-off characters
become `recurring` when they appear again.

All routes need the usual `Authorization: Bearer` key, except the signed recording link.
Errors are `{error}` with 400 (invalid input), 404 (unknown episode), 409 (wrong state),
429 (busy), 503 (scheduler or worker missing).

| Route | Body | Returns |
|---|---|---|
| `POST /api/audio/auto/pilot` | Story: `story_id`, `text` (1–20,000), `title?` (≤160), `brief?` (≤4,000), `audio_snapshot: {model, compute, genre, …}`, `auto_options` (as above). Workflow: `workflow_id`, `request_id` (UUID, for idempotency). | `{series, episode, episode_id}`; for a workflow `{series, episode: null, run_id, episode_id}` (the scheduler starts it within 15 s). 409 if this series already has an episode `working` or `question`; 429 beyond 3 active automatic episodes. |
| `POST /api/audio/auto/episodes` | `story_id` or `workflow_id` | `{series, episodes: [note]}` |
| `POST /api/audio/auto/change` | `episode_id`, or (`story_id`\|`workflow_id`) + `episode` (number; latest if omitted); `instruction` (1–1,000, plain words) | `{episode: note, changes: [{type, character?, summary}], remake_from: "assets"\|"record", series}`; the episode is remade in the background. 409 while `working`. |
| `POST /api/audio/auto/answer` | `episode_id` (or owner + `episode`), `question_id`, `option` (index) | `{episode: note, series}`; the chosen sample becomes the character's voice. 409 if already answered. |
| `POST /api/audio/auto/approve` | `workflow_id` | `{series, workflow: {id, status, next_run, review_before_publish}}`; needs a finished pilot (409), then enables the schedule (same rules as `control` `enable`). |
| `POST /api/audio/auto/publish` | `episode_id` (or owner + `episode`) | `{episode: note}`; only `made` or `held`. |
| `GET /api/audio/auto/listen-input/<asset id>?expires=&sig=` | — (HMAC, 6 h; only episode recordings) | the WAV, for listen-back workers |

**Note** (one per episode):
```
{id, episode, title, status, phase, progress, error, held_reason, version,
 new_voices: [name], returning: [name],
 checks: {distinct_voices, gender_age, listen_back, loudness, sounds, delivery: {status, detail, …}},
 questions: [{id, text, options: [{label, sample_ref}], answer: null | index}],
 changes: [{instruction, applied: [{type, summary}], at, version}],
 asset_id, story_id, workflow_id, published_at, created, updated}
```
`sample_ref` is a voice reference asset id (play it like any audio asset). `listen_back`
adds `score`, `model`, `missing`; `loudness` adds `lufs`, `long_silences`.

**Series:** `{id, story_id, workflow_id, approved, instructions: [{text, episode, at}],
cast: [{id, name, role, gender, age_group, personality, voice_description, voice_ref,
palette, feelings, recurring, episodes}]}`.

**Plain-words changes.** AI turns the instruction into: `voice` (new brief → the old clip
moves to `voice_history`, a new voice is designed and used from now on), `delivery`
(speed 0.75–1.5, direction, pause; for named lines it applies to this episode only,
otherwise it is saved as a rule for that character or everyone), `sound` (remove, quieter
−6 dB, louder +4 dB; a cue index applies to this episode, `music`/`ambience`/`effect`/`all`
is saved as a rule), `script` (replace one line's words in this episode). The
instruction is saved on the series and given to the AI in every later episode's cast,
script, delivery and sound steps.

### Deploying (one combined deploy, 2026-11-09)

`scripts/deploy_auto_series.py` replaces running `deploy_series_workflows.py` and
`deploy_voice_references.py` separately: it ships every storage API and audio worker
file for series schedules, optional labels, character voice references and automatic
episodes from commit 69cc552 with the same hash-checked, idle-only,
roll-back-on-failure steps, and also refuses while an automatic episode is `working`.
On the storage API pod, when no audio is running:

```
cd /workspace
for f in deploy_audio_delivery.py deploy_auto_series.py; do curl -fsSLO https://raw.githubusercontent.com/ecco-ai-labs/ecco-studio/main/scripts/$f; done
API=$(pgrep -f storage_api.py | head -1); WORKER=$(pgrep -f queue_worker.py | head -1)
python3 deploy_auto_series.py prepare --api-pid $API --worker-pid $WORKER
python3 deploy_auto_series.py activate <directory printed after PREPARED>
```

If prepare lists modules that differ, pass `--with-deps` to both steps (it never ships
`migration/legacy/studio.py`; if that one differs, update it first). GPU workers on other
pods design the voices, record and listen back: they need the `audio/` files from the same
commit (`queue_worker.py`, `listen_worker.py`, `voice_refs.py`, `audio_schema.py`, …) and
then advertise `voice_refs_version: 1` and, with Whisper cached, `listen_version: 1`.
Optionally set `ECCO_STORAGE_PUBLIC_URL=https://…` so job payloads carry full links.

## Character voice references (2026-11-09)

A character can speak with a saved clip instead of a catalog voice: a trimmed upload or
browser recording, or a designed voice. Each clip is an audio asset with a
`voice_reference` block, stored under `audio-voices/` as mono 24 kHz WAV (3–30 s).
All routes need the usual `Authorization: Bearer` key, except the signed clip link.

| Route | Body | Returns |
|---|---|---|
| `POST /api/audio/voices/create` | `asset_id` (an uploaded audio asset), `character` (1–80), `character_id?` (≤64), `emotion?` (palette name, `^[a-z][a-z0-9-]{0,31}$`, default `default`), `language?`, `transcript?` (≤600; what the clip says — required before IndicF5 uses it), `start?`/`end?` (seconds), `clean?` (FFmpeg `highpass=f=80,afftdn=nf=-25,loudnorm=I=-20:TP=-2:LRA=11`), `source?` (`upload`\|`recording`), `consent: true` (required), `story_id?` | the reference |
| `POST /api/audio/voices/list` | `story_id?`, `character?`, `character_id?` | `{references: [...]}` |
| `POST /api/audio/voices/update` | `asset_id`, any of `transcript`, `emotion`, `character`, `character_id` | the reference |
| `POST /api/audio/voices/design` | `model` (`voxcpm2`\|`indic-parler`), `character`, `character_id?`, `emotion?`, `language`, `text` (sample sentence, becomes the transcript), `description` (≤1200, e.g. "An old woman, warm and slow, smiling"), `compute`, `worker_id?`, `story_id?` | an audio job; when it finishes the job gains `voice_reference_id` and the clip is saved as a `designed` reference |
| `GET /api/voice-refs/<id>?expires=&sig=` | — (HMAC-signed, 6 h) | the WAV, for workers |

A reference: `{id, title, story_id, duration, sha256, created, character, character_id,
emotion, language, transcript, source, consent, cleaned, trimmed_start, trimmed_end,
source_asset_id}`. Errors: missing consent ("Confirm you have permission to use this
person’s voice."), range outside 3–30 s, a design model that is not installed (the usual
"selected worker must support every character model" 503), IndicF5 use without a
transcript ("Type what the … clip says before using it with IndicF5."), and a worker
without `voice_refs_version: 1` ("Update the selected audio worker before using saved
character voices.").

**Using clips in `/api/audio/generate`.** A line may set `voice: "ref:<asset id>"`, or
`palette: {"default": id, "warm": id, "whispering": id, …}` with `delivery` (the line's
feeling). The palette picks the matching clip, then a near match (`whisper` →
`whispering`/`hushed`/`suspenseful`, `happy` → `warm`/`laughing`/`excited`, `fear` →
`scared`/`suspenseful`, `sad` → `tender`, `angry` → `sulky`), then `default`. Only
Chatterbox, IndicF5 and VoxCPM2 accept clips.

**Self-contained job payload.** After validation the coordinator adds, for each clip,
`voice_refs: {<asset id>: {sha256, transcript, language, emotion, character, path,
expires, url?}}`. `path` is the signed `/api/voice-refs/...` link; `url` is the full link
when `ECCO_STORAGE_PUBLIC_URL` (https) is set on the storage API. The queued
`request.json` is the whole job: a stateless handler can call the existing worker
(`synthesize(validate(payload), output, runtime)`) unchanged. `audio/voice_refs.py`
finds each clip next to the job (the pod path; the coordinator copies `voice-ref-<id>.wav`
there), else in a cache keyed by sha256 (`ECCO_VOICE_CACHE` or the temp folder), else
downloads `url` (or `ECCO_STORAGE_PUBLIC_URL` + `path`), and checks the sha256 every time.
Idempotent resubmits compare the request without the short-lived link fields.

### Deploying character voice references

`scripts/deploy_voice_references.py` ships the storage API and audio worker files changed
in c43bf39 (same guarded steps as the other deploy scripts). On the storage API pod, when no
audio is running:

```
cd /workspace
for f in deploy_audio_delivery.py deploy_voice_references.py; do curl -fsSLO https://raw.githubusercontent.com/ecco-ai-labs/ecco-studio/main/scripts/$f; done
API=$(pgrep -f storage_api.py | head -1); WORKER=$(pgrep -f queue_worker.py | head -1)
python3 deploy_voice_references.py prepare --api-pid $API --worker-pid $WORKER
python3 deploy_voice_references.py activate <directory printed after PREPARED>
```

If prepare lists modules that differ, pass `--with-deps` to both steps (it never ships
`migration/legacy/studio.py`; if that one differs, update it first). Optionally set
`ECCO_STORAGE_PUBLIC_URL=https://…` for the storage API so job payloads carry full clip
URLs for workers that are not on this pod. Workers on other pods need the changed
`audio/` files from the same commit (they advertise `voice_refs_version: 1`).
