#!/usr/bin/env bash
set -eu
mkdir -p /workspace/ecco-audio/queue
exec 8>"/workspace/ecco-audio/launch-${RUNPOD_POD_ID:-local}.lock"
flock -n 8 || exit 0
export PYTHONPATH=/workspace/ecco-audio/deps
export TORCH_HOME=/workspace/ecco-audio/torch-cache
while true; do
  /opt/ecco-runtime-venv/bin/python /workspace/ecco-audio/queue_worker.py || true
  sleep 5
done
