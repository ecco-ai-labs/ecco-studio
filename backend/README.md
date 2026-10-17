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
  external accounts, or expose the original backend's static file routes.
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

