#!/usr/bin/env bash
# Start generation services on an already provisioned RunPod with the shared volume.
# Does not change Jupyter authentication or expose new ports.
set -euo pipefail
: "${RUNPOD_POD_ID:?RUNPOD_POD_ID is required}"
exec 9>/tmp/ecco-generation-start.lock
flock -n 9 || exit 0
base=/workspace/ecco-runtime
logs="$base/pods/$RUNPOD_POD_ID"
mkdir -p "$logs"
if [[ ! -x /opt/ecco-runtime-venv/bin/python ]]; then
  expected=$(cat "$base/runtime.sha256")
  printf '%s  %s\n' "$expected" "$base/runtime.tar" | sha256sum -c -
  tar -xf "$base/runtime.tar" -C /opt
fi
export PATH="/opt/ecco-runtime-venv/bin:$PATH"
nohup bash /workspace/ecco-audio/start_worker.sh >> "$logs/audio.log" 2>&1 &
nohup bash /workspace/ecco-video/longcat/start_longcat.sh >> "$logs/longcat.log" 2>&1 &
(
  while true; do
    python /workspace/ecco-gpu-relay/gpu_relay.py || true
    sleep 5
  done
) >> "$logs/relay.log" 2>&1 &
while true; do
  python "$base/supervisor.py" --workers-only >> "$logs/supervisor.log" 2>&1 || true
  sleep 5
done
