#!/bin/bash
# Storage pod boot: start everything that lives outside the storage API, after any pod restart.
#
# Run in the background by /workspace/ecco-storage-app/scripts/start-storage-persistent.sh (the pod's
# start command, PID 1) before it starts its storage API loop. Safe to run again at any time: every
# step checks first and leaves running services alone.
#
#  1. Download caches on the big shared volume, not the 5 GB container disk.
#  2. Audio CPU worker: /workspace/ecco-audio/start_cpu_worker.sh (it restores /opt/ecco-audio-cpu from
#     /workspace/ecco-audio/cpu-runtime.tar.gz when the container disk was reset).
#  3. Serverless bridge: run-serverless-bridge.sh (endpoint IDs from serverless-bridge.env; the RunPod key
#     is the one RunPod gives the pod, RUNPOD_API_KEY, inherited from PID 1).
#
# --check reports what would happen and changes nothing.
set -u
HERE=/workspace/ecco-runtime/storage-pod
LOG=/workspace/ecco-storage-private/boot.log
CHECK=0
[ "${1:-}" = "--check" ] && CHECK=1
say() { echo "$(date -u +%FT%TZ) $*"; }
[ "$CHECK" = 1 ] || exec >>"$LOG" 2>&1
label=""; [ "$CHECK" = 1 ] && label=" (check only)"
say "boot${label} start"

# 1. Caches
if [ "$CHECK" = 1 ]; then
  say "would use /workspace/ecco-cache/pip for pip downloads"
else
  mkdir -p /workspace/ecco-cache/pip /root/.config/pip
  printf '[global]\ncache-dir = /workspace/ecco-cache/pip\n' > /root/.config/pip/pip.conf
fi

# 2. Audio CPU worker
if pgrep -f start_cpu_worker.sh >/dev/null; then
  say "audio CPU worker: already running"
elif [ ! -f /workspace/ecco-audio/start_cpu_worker.sh ]; then
  say "audio CPU worker: start_cpu_worker.sh missing - NOT started"
elif [ ! -f /opt/ecco-audio-cpu/.installed ] && [ ! -f /workspace/ecco-audio/cpu-runtime.tar.gz ]; then
  say "audio CPU worker: runtime and cpu-runtime.tar.gz both missing - NOT started"
elif [ "$CHECK" = 1 ]; then
  say "audio CPU worker: would start (runtime $( [ -f /opt/ecco-audio-cpu/.installed ] && echo present || echo 'restored from cpu-runtime.tar.gz'))"
else
  (cd /workspace/ecco-audio && setsid nohup bash start_cpu_worker.sh >>/workspace/ecco-audio/cpu-worker.log 2>&1 </dev/null &)
  say "audio CPU worker: started"
fi

# 3. Serverless bridge
if pgrep -f serverless_studio.py >/dev/null; then
  say "serverless bridge: already running"
elif [ ! -s "$HERE/serverless-bridge.env" ] || [ ! -f /workspace/ecco-serverless/repo-main/serverless/serverless_studio.py ]; then
  say "serverless bridge: settings or code missing - NOT started"
elif [ -z "${RUNPOD_API_KEY:-}" ]; then
  say "serverless bridge: RUNPOD_API_KEY not set on this pod - NOT started"
elif [ "$CHECK" = 1 ]; then
  say "serverless bridge: would start"
else
  setsid nohup bash "$HERE/run-serverless-bridge.sh" </dev/null >/dev/null 2>&1 &
  say "serverless bridge: started"
fi
say "boot done"
