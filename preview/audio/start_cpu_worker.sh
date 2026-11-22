#!/usr/bin/env bash
set -euo pipefail
cd /workspace/ecco-audio
exec 8>"launch-cpu-${RUNPOD_POD_ID:-local}.lock"
flock -n 8 || exit 0
if ! test -f /opt/ecco-audio-cpu/.installed; then
  test -f cpu-runtime.tar.gz || exit 1
  tar -xzf cpu-runtime.tar.gz -C /opt
fi
export ECCO_AUDIO_DEVICE=cpu CUDA_VISIBLE_DEVICES=''
export HF_HOME=/workspace/ecco-audio/hf-cache HF_HUB_OFFLINE=1
export TORCH_HOME=/workspace/ecco-audio/torch-cache
unset PYTHONPATH
while true; do
  python3.12 queue_worker.py || true
  sleep 5
done
