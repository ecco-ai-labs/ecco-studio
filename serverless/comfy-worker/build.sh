#!/usr/bin/env bash
# Shared Docker build steps for the ComfyUI workers. Usage: build.sh images|video
# The default models are baked into the image (bake.sh); the rest are read from the global volume.
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
# Files baked into the image (bake.sh, /models-baked) are searched first (is_default puts them at
# the front of ComfyUI's search list); everything else still loads from the volume.
cat > /comfyui/extra_model_paths.yaml <<'EOF'
ecco_baked:
  base_path: /models-baked
  is_default: true
  diffusion_models: diffusion_models
  text_encoders: text_encoders
  vae: vae
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
