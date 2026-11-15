#!/bin/bash
# Keeps the Serverless bridge (serverless/serverless_studio.py) running on the storage pod, restarting it
# 5 s after it exits, like start-storage-persistent.sh does for the storage API.
# Settings: serverless-bridge.env next to this script (endpoint IDs only, KEY=value). The RunPod key is the
# pod's own RUNPOD_API_KEY, inherited from the environment.
set -euo pipefail
HERE=/workspace/ecco-runtime/storage-pod
exec 9>/tmp/ecco-serverless-bridge.lock
flock -n 9 || exit 0
cd /workspace/ecco-serverless
set -a
. "$HERE/serverless-bridge.env"
set +a
while true; do
  python3.12 -u repo-main/serverless/serverless_studio.py >>/workspace/ecco-serverless/launcher-serverless.log 2>&1 || true
  sleep 5
done
