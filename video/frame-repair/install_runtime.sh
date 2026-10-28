#!/usr/bin/env bash
# Run explicitly once on the existing shared volume. No GPU is started.
set -euo pipefail
base=/workspace/ecco-video/frame-repair
mkdir -p "$base"
${PYTHON_BIN:-python3} -c "import sys; assert sys.version_info >= (3,10), 'Use Python 3.10 or newer'"
${PYTHON_BIN:-python3} -m venv "$base/venv"
"$base/venv/bin/python" -m pip install 'torch==2.6.0' 'torchvision==0.21.0' 'diffusers==0.36.0' 'transformers==4.51.3' 'accelerate==1.7.0' 'sentencepiece==0.2.0' 'safetensors==0.5.3' 'Pillow==11.2.1'
"$base/venv/bin/python" -c "from huggingface_hub import snapshot_download; snapshot_download('Wan-AI/Wan2.1-VACE-1.3B-diffusers', local_dir='/workspace/ecco-video/frame-repair/model')"
"$base/venv/bin/python" -c "from diffusers import WanVACEPipeline, AutoencoderKLWan; print('Repair imports verified')"
