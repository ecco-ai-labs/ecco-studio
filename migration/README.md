# GPU-independent migration — preparation, not production deployment

The permanent frontend remains https://ecco-ai-labs.github.io/ecco-studio/.
All application services, durable metadata and saved media must be independent
of a GPU lifecycle. GPUs receive generation jobs and temporary input copies only.

## Preserved source

`legacy/` contains 25 active source files recovered from the running workspace
on 2026-10-17 UTC. It preserves library, storyboard, object editing, progress,
debugging and animation code missing or newer than the Pages repository.
It is a migration reference, not a deployable independent backend. The old
server relies on authenticated Jupyter and must not be exposed directly.
Logo and bridge files were absent from the downloaded archive; the logo is
already in the repository. The bridge is to be retired, not carried forward.
No media, database, credentials or model weights are included here.

## Required deployment decision

Choose an authorized non-GPU hosting project/account before deploying services.
No project, service account, billing authorization or storage credentials have
been supplied for this migration. Do not invent these or publish an unauthenticated API.

## Implementation boundaries

| Component | Destination / responsibility |
| --- | --- |
| Frontend | GitHub Pages; one build of the complete recovered UI; no RunPod navigation |
| API | CPU service; verifies Google identity and allowed domain/group on every request |
| Metadata | Durable database; user ownership for stories, labels, revisions, jobs and credits |
| Media | Private object storage; access through authorized API or expiring URLs |
| Job service | Durable queue and worker leases, cancellation, retries, idempotency |
| GPU worker | Temporary model execution and scratch files; no authoritative application state |
| Results | Upload and verify durable outputs before marking a job complete |

The current network volume survives GPU shutdown, but the application reads its
SQLite database and media through the GPU process. S3 availability alone does
not remove that dependency. Do not open SQLite directly over an object-store mount.

## Data migration

1. Confirm actual ECCO_DATA; the source default is /workspace/ecco-studio-data.
2. Briefly pause library mutations and generation for a consistent export.
3. Run export_workspace.py with explicit source and a new destination outside it.
   It uses SQLite online backup, preserves record IDs and media paths, and hashes
   copied files. A manifest is written only after all referenced assets pass.
4. Move the private bundle to the chosen backend/storage, preserving IDs and
   assigning an explicitly identified owner to legacy records. Never put it in GitHub.
5. Migrate OAuth/billing secrets separately into a secrets service.
6. Verify every record count and media checksum, then compare library/storyboard UI.
7. Switch Pages to the independent API only after acceptance. Keep originals for rollback.

## Release acceptance

- With all GPUs off: sign in, view all existing media, upload, label, edit stories,
  save/reopen revisions, trash and restore; refresh and sign in again without data loss.
- The browser address never leaves GitHub Pages when selecting or disconnecting a GPU.
- Two users cannot read or modify each other's records, media, jobs or channels.
- A worker interruption cannot mark an unpersisted result complete; retries cannot
  duplicate outputs or charges. Disconnect waits for active jobs or explicitly cancels.
- Verify actual provider stop/release separately from UI disconnect; a running
  rented GPU can still incur charges after a browser disconnect.
- Deployments originate from a pinned GitHub commit with a visible release ID.

Export utility tests use synthetic data only. No production data has been exported,
no GPU stopped, and no production backend or frontend switched by this branch.
