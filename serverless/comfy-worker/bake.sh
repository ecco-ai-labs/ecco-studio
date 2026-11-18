#!/usr/bin/env bash
# Build-time only: download one model file from Hugging Face into the image, so a cold worker
# loads it from local disk instead of the global volume. Usage:
#   bake.sh <hf repo> <path in repo> <ComfyUI model folder> [sha256]
# Files land in /models-baked/<folder>/<file name>; build.sh lists /models-baked first, so ComfyUI
# uses the baked copy and falls back to the volume for every model that is not baked.
set -euo pipefail
repo="$1" path="$2" folder="$3" want="${4:-}"
name="$(basename "$path")"
dest="/models-baked/$folder"
mkdir -p "$dest" /tmp/bake
HF_HUB_OFFLINE=0 HF_HUB_DISABLE_PROGRESS_BARS=1 \
  hf download "$repo" "$path" --local-dir /tmp/bake
mv "/tmp/bake/$path" "$dest/$name"
rm -rf /tmp/bake /root/.cache/huggingface
if [[ -n "$want" ]]; then
  got="$(sha256sum "$dest/$name" | cut -d' ' -f1)"
  [[ "$got" == "$want" ]] || { echo "checksum mismatch for $name: $got" >&2; exit 1; }
fi
echo "baked $folder/$name ($(du -h "$dest/$name" | cut -f1))"
