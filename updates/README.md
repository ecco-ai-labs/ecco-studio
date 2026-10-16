# Studio workspace update — 2026-10-16

This package updates the **GPU-hosted Studio**, which is separate from the GitHub Pages GPU picker. Publishing this directory does not install it on a running pod.

Changes:
- Image library starts collapsed with a + sign. Expanded view shows − label names and indented −− image names. Create new label appears last and opens a small name dialog; new labels append at the bottom. Upload remains available outside the collapsed tree. Story library also starts collapsed.
- Images use multiple folder labels without copying or moving their original files. Generated images, previews, and edited copies offer label selection.
- Compact Billing, Account, and Activity dropdowns retain the existing controls and handlers.
- Upload PNG, JPEG, or WebP images, then choose library labels or edit first. Uploaded images become normal Studio assets; edited copies use the existing editor.

Uploads retain the normal authenticated, same-origin CSRF-protected API. The upload route alone accepts larger requests. Images are decoded, limited to 12 MB / 20 megapixels, and normalized to PNG with orientation applied; original metadata and original encoding are not retained. Animated files are rejected. Uploading itself does not use GPU inference.

## Installation

Copy this directory to the GPU's persistent storage, then run using the Studio Python environment (which must have Pillow installed):

```sh
/opt/ecco-runtime-venv/bin/python /path/to/updates/install.py --target /workspace/ecco-studio
```

The installer checks expected source anchors, compiles the Python changes, preserves other application code, and creates a timestamped backup inside the target. Unsupported versions are rejected before changes are written. Once active Studio work finishes, restart **the Studio service only** using the existing supervisor and reload the browser. A GPU stop/start is unnecessary. Do not restart ComfyUI during a generation.

Rollback: restore `studio.py`, `studio.html`, and `library-ui.js` from the reported backup and restart Studio. Uploaded asset records and files are unaffected.

## Verification and release status

Run `python updates/test_update.py` and `node --check updates/workspace-ui.js` from the repository root. Eleven tests cover successful import, JPEG normalization, invalid files, pixel limit, failed-save cleanup, unsupported format, repeat installation, and unsupported server protection, hardware identification, and failed/empty hardware probes. The patch was also applied and Python-compiled against the saved Studio source.

**Installed on the running B200 on October 16, 2026.** Browser verified library expansion, label and upload dialogs, Story Library, compact menus, storyboard deletion controls, Trash restore and Empty Trash controls, and the B200 video selector. Existing user items were not permanently deleted during verification. Run an acceptance check after installation: upload → labels → folder; upload → edit → save copy → labels; add folder/story and verify ordering; collapse/reopen libraries; verify all three ribbon menus.

## Accelerator identity

The private Studio state includes locally detected accelerator names from `nvidia-smi`, refreshed every 15 seconds. The header and video form display the connected hardware. Failed checks report Unverified rather than claiming a pod is offline. This does not enumerate other RunPod machines or prove their power state. The legacy video selector and dispatcher are corrected by `fix_gpu_routing.py`: they show and route to the detected local accelerator. Run this script after the main installer when the legacy GPU dispatcher is installed.

## Trash
Current storyboard drafts and saved revisions support recoverable deletion alongside existing stories and images. Trash lists deleted items across stories and offers restore plus confirmed Empty Trash. Empty Trash removes local media and detaches references from retained storyboards and characters; it does not erase external copies or backups. Five additional tests in `test_trash.py` check deletion/restore, confirmation, live-record protection, active-job protection, and reference cleanup.
