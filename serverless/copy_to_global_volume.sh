#!/usr/bin/env bash
# One-time copy of the generation models from the network volume to the global volume.
# Run on a pod with the network volume at /workspace and the global volume at /workspace-global:
#   bash serverless/copy_to_global_volume.sh            # copy
#   bash serverless/copy_to_global_volume.sh --dry-run  # list what would be copied
# Safe to re-run: rsync only copies what changed.
set -euo pipefail
src=${ECCO_SOURCE:-/workspace}
dst=${ECCO_GLOBAL:-/workspace-global}
[[ -d "$src/ComfyUI/models" ]] || { echo "Network volume not found at $src"; exit 1; }
[[ -d "$dst" ]] || { echo "Global volume not found at $dst"; exit 1; }
# The global volume does not support setting folder times or permission bits.
opts=(-a --info=progress2 --no-perms --no-owner --no-group --omit-dir-times "$@")
mkdir -p "$dst/ComfyUI" "$dst/ecco-models" "$dst/ecco-video/longcat"
# ComfyUI models (image + video), skipping files that are not model weights.
rsync "${opts[@]}" --exclude '*.tmp' --exclude 'put_*_here' "$src/ComfyUI/models" "$dst/ComfyUI/"
rsync "${opts[@]}" "$src/ecco-models/z-image" "$dst/ecco-models/"
for part in source weights runner.py; do
  rsync "${opts[@]}" "$src/ecco-video/longcat/$part" "$dst/ecco-video/longcat/"
done
echo "ComfyUI commit on the pods: $(git -c safe.directory="$src/ComfyUI" -C "$src/ComfyUI" rev-parse HEAD 2>/dev/null || echo unknown)"
du -sh "$dst/ComfyUI/models" "$dst/ecco-models/z-image" "$dst/ecco-video/longcat"
echo "Copy complete."
