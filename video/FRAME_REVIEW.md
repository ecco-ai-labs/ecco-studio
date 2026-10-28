# Clips & Frames

Video Studio → Review → Open frame editor. The same editor is available from the
Video AI menu and Generate with AI. Choose an existing video from the active story
or open a local MP4. The editor does not start inference or provision compute.

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

AI repair requests contain target IDs plus ten context frames on either side of
each range. They are prepared requests only: no VACE worker is deployed by this
change. Automatic next-clip generation is not implied. Ending direction and boundary
controls are for review/planning of existing footage.

CPU export needs `backend/frame_editor.py` and the narrow routes in storage_api.py.
GET /api/frame-editor/status advertises availability, POST /api/frame-editor/export
accepts a source asset and edit decisions, and GET /api/frame-editor/jobs/<id>
reports progress. Existing workspace authentication applies. Only same-story,
nondeleted videos are accepted. Exports are idempotent, serial, limited to 120s,
1920px per dimension and 12 MB output, and require ffmpeg/ffprobe. All temporary
frames are removed after processing. The GPU remains off.

## Checks

- `node --test clip-frame-model.test.cjs`
- `NODE_PATH=/tmp/ecco-frame-tests/node_modules node --test clip-frame-review.test.cjs`
- `PYTHONPATH=backend python -m unittest test_frame_editor test_storage_api`
- `python scripts/ui_inventory.py --check`

The local DOM fixtures test selection, cuts, reinsertion, persistence, context,
boundary changes and zero inference submissions. FFmpeg tests check actual frame
count, audio timing, replacement pixels and preservation of the original file.
Live UI inspection is still required for layout and real media decoding.

Export decoding uses local temporary storage, with bounded retries for transient shared-volume database writes. Temporary frames are removed after export.
