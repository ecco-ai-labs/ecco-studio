#!/usr/bin/env bash
# Persistent RunPod CMD: bash -c 'ln -sf /workspace/ecco-runtime/gpu-post-start.sh /post_start.sh; exec /start.sh'
# Preserve the image's Jupyter authentication and port configuration.
set -euo pipefail
: "${RUNPOD_POD_ID:?RUNPOD_POD_ID is required}"
logs="/workspace/ecco-runtime/pods/$RUNPOD_POD_ID"
mkdir -p "$logs"
printf '%s pod=%s event=generation_start_requested\n' "$(date -u +%FT%TZ)" "$RUNPOD_POD_ID" >> "$logs/startup.log"
nohup bash /workspace/ecco-runtime/start-gpu-services.sh >> "$logs/startup.log" 2>&1 < /dev/null &
