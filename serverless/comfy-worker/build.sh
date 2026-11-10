#!/usr/bin/env bash
# Shared Docker build steps for the ComfyUI workers. Usage: build.sh images|video
set -euo pipefail
group="$1"
apt-get update && apt-get install -y --no-install-recommends git ffmpeg libgl1 libglib2.0-0 ca-certificates
rm -rf /var/lib/apt/lists/*

# Same ComfyUI version as the pods (recorded in the manifest by publish_weights.py).
base=$(grep -v '^#' /opt/ecco/weights-url.txt | grep -m1 . | tr -d '[:space:]')
commit=$(python -c "import json,urllib.request;print(json.load(urllib.request.urlopen('$base/manifest.json')).get('comfy_commit') or '')")
git clone https://github.com/comfyanonymous/ComfyUI /comfyui
if [[ -n "$commit" ]]; then git -C /comfyui checkout "$commit"; fi
pip install --no-cache-dir -r /comfyui/requirements.txt runpod boto3
if [[ "$group" == images ]]; then
  pip install --no-cache-dir "diffusers>=0.36" transformers accelerate
fi

# Bake the weights into the image so any data center can run it.
python /opt/ecco/download_weights.py "$group" /weights
rm -rf /comfyui/models && ln -s /weights/comfy /comfyui/models
mkdir -p /comfyui/input /comfyui/output
