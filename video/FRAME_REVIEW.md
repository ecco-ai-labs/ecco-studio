# Clips & Frames

Video Studio → Review → Open frame editor. The same editor is available from the
Video AI menu and Generate with AI. Choose an existing video from the active story
or open a local MP4. Inference starts only with Generate corrected frames. The editor never provisions compute.

## Frame identity and editing

The editor uses a 25 fps review timeline. Native source rates are conformed to this
rate during CPU export; frame IDs refer to that review timeline, not decoder-native
frames. Frames are one-based. Three/four-second review segments contain 75/100
frames, except the final shorter segment. Original source IDs never change.

Click toggles selection; Shift-click adds a range. Numeric input accepts lists and
ranges. Arrow keys move through thumbnails and double-click opens an inspector.
Groups contain 25, 50 or 100 frames. Removed frames stay visible with a strikeout
and can be selected and reinserted. Cuts are edit decisions, not source deletion.
Imported full-frame images preserve duration. Undo and redo retain 30 revisions.

Browser playback is an interactive cut preview; the exported MP4 is validated for
exact frame count and duration. MP4 export cuts the matching source audio intervals.
Replacing images retains audio timing. All accepted exports create a new library
asset; source media is never overwritten. Rendering re-encodes the retained frames.

## Persistence and availability

IndexedDB stores drafts by account, story and source asset ID; local files use a
SHA-256 digest. Source files must be reopened to resume local file drafts. Save edit
reports successful persistence; download edit plan creates a portable JSON record.
The currently selected frame set is transient; accepted edits and history persist.

Play entire clip ignores the current selection. Play selected frames preloads and
shows exactly those source IDs, in order, at 25 fps without audio. Selected removed
frames can still be inspected. Original/Edited chooses which pixels are shown.

Repair selected frames freezes the current edit and selection. Enter the correction,
choose a ready worker and generate. Ten context frames on both sides plus interior
unselected frames condition VACE; white masks identify only the target IDs. Candidate
images remain separate until Reinsert new frames. Acceptance checks source, frame
IDs and the frozen edit revision, restores removed targets and creates one undo step.
Regeneration is a new explicit job; uncertain submissions resume the original ID.
Source/story authorization and a fresh worker heartbeat are checked server-side.

Repair spans are limited to 100 source frames. VACE 1.3B renders 480p candidates;
scaling a candidate back to the source size does not restore source-resolution detail.
No quality guarantee is implied: review character identity, motion and boundaries.
Only target outputs are retained; context outputs are discarded. Accepted frames
use the existing image replacement/export path. Browser drafts retain the candidate.

### Runtime deployment

`scripts/install_frame_repair.py RELEASE BACKEND` installs only reviewed modules
and narrow authenticated routes/startup hooks, with backups. Restart the CPU API.
The worker uses the existing shared volume, requires no public ports or new keys,
and never downloads models at inference time. On compatible Linux Python 3.10+,
explicitly run `video/frame-repair/install_runtime.sh` to install pinned dependencies
and official Wan-AI weights. Start `start_worker.sh` on the selected existing CUDA
GPU. Startup does not install dependencies or start/provision a pod. It only launches
an already-installed worker. The model is loaded per job and unloaded afterward.

GET repair-status reports fresh workers; POST repair submits an idempotent job;
GET repairs/<id> polls; GET repair-candidate/<id> returns only completed target JPEGs.
All routes remain under `/api/frame-editor/` and existing workspace authentication.
Jobs expire after two hours. Restarted in-flight workers fail the old request rather
than silently repeating GPU work. No inference is run by the CPU test fixtures.

CPU export needs `backend/frame_editor.py` and the narrow routes in storage_api.py.
GET /api/frame-editor/status advertises availability, POST /api/frame-editor/export
accepts a source asset and edit decisions, and GET /api/frame-editor/jobs/<id>
reports progress. Existing workspace authentication applies. Only same-story,
nondeleted videos are accepted. Exports are idempotent, serial, limited to 120s,
1920px per dimension and 12 MB output, and require ffmpeg/ffprobe. All temporary
frames are removed after processing. CPU export does not use a GPU.

## Checks

- `node --test clip-frame-model.test.cjs`
- `NODE_PATH=/tmp/ecco-frame-tests/node_modules node --test clip-frame-review.test.cjs`
- `PYTHONPATH=backend python -m unittest test_frame_editor test_frame_repair test_storage_api`
- `python scripts/ui_inventory.py --check`

The local DOM fixtures test selection, cuts, reinsertion, persistence, context,
boundary changes, exact selected-only playback, guarded candidate acceptance and undo. FFmpeg tests check actual frame
count, audio timing, replacement pixels and preservation of the original file.
Live UI inspection is still required for layout and real media decoding.

Export decoding uses local temporary storage, with bounded retries for transient shared-volume database writes. Temporary frames are removed after export.

CPU tests also cover VACE mask/ID mapping, output filtering and candidate-to-MP4
export with a synthetic model result. Actual VACE inference and artistic acceptance
require the installed GPU runtime; passing these tests does not establish either.
