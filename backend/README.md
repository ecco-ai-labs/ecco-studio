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
to this shared workspace or its channel: both YouTube POST routes still require
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
open Publishing, click **Connect YouTube securely**, select the downloaded
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
The private workspace can retain multiple separately authorized channels. Connections → YouTube → Add channel opens Google account/channel selection and preserves existing grants. Each grant is keyed by its verified channel ID; Publishing lists only connected channels. Google identity sign-in alone cannot enumerate or authorize every Brand Account. This does not provision isolated workspaces for public users. While the Google app is in Testing,
the channel owner's Google account must be on its test-user list. YouTube
scopes may require Google's verification before wider production use; the
basic Google sign-in audience can still allow any Google account.

Verified channel metadata and OAuth credentials are encrypted with Fernet and saved atomically to
`/workspace/ecco-storage-private/youtube-connection.json` (0600), overridable
with `ECCO_YOUTUBE_TOKEN_FILE`. The encryption key is created with 0600 permissions
at `/workspace/ecco-storage-private/youtube-encryption.key` (`ECCO_YOUTUBE_KEY_FILE`
may override it). Back up the encrypted token and key privately. Only sanitized
channel metadata reaches Studio. Existing plaintext connections remain readable
and are encrypted on their next credential save. Disconnect removes the selected local grant and cancels pending consent callbacks; it does not delete videos or
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



Multiple-channel deployment: update `backend/youtube_connection.py` and `backend/storage_api.py` on the CPU service and restart only when CPU jobs are idle. Status advertises `youtube_multi_channel: true` and sanitized `youtube_channels`. The UI falls back to the original single-channel behavior until this backend update is running. Version 1 token files remain readable and migrate atomically to an encrypted version 2 connections list on the next save. Per-channel disconnect takes `channel_id`; the legacy empty-body disconnect still removes all grants. No new scopes or dependencies.

Channel creation is a handoff to YouTube’s official channel list, followed by Add channel; the Data API has no channel-create method. Other social-platform connection rows remain unavailable; their publishing tabs do not initiate uploads.
