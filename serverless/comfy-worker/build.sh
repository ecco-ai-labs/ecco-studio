#!/usr/bin/env bash
# Shared Docker build steps for the ComfyUI workers. Usage: build.sh images|video
# Models are NOT in the image: workers read them from the global volume at /runpod-volume.
set -euo pipefail
group="$1"
apt-get update && apt-get install -y --no-install-recommends git ffmpeg libgl1 libglib2.0-0 ca-certificates
rm -rf /var/lib/apt/lists/*

git clone https://github.com/comfyanonymous/ComfyUI /comfyui
if [[ -n "${COMFY_COMMIT:-}" ]]; then git -C /comfyui checkout "$COMFY_COMMIT"; fi
pip install --no-cache-dir -r /comfyui/requirements.txt runpod boto3
if [[ "$group" == images ]]; then
  pip install --no-cache-dir "diffusers>=0.36" transformers accelerate
fi

# Model folders come from the volume copy of the pods' ComfyUI/models.
cat > /comfyui/extra_model_paths.yaml <<'EOF'
ecco_volume:
  base_path: /runpod-volume/ComfyUI/models
  checkpoints: checkpoints
  diffusion_models: |
    diffusion_models
    unet
  text_encoders: |
    text_encoders
    clip
  vae: vae
  loras: loras
  clip_vision: clip_vision
  upscale_models: upscale_models
EOF
mkdir -p /comfyui/input /comfyui/output
