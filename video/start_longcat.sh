#!/bin/bash
set -e
ROOT=/workspace/ecco-video/longcat
mkdir -p "$ROOT/queue"
exec 8>"$ROOT/launch-${RUNPOD_POD_ID:-local}.lock"
flock -n 8 || exit 0
while true; do
  "$ROOT/venv/bin/python" "$ROOT/longcat_jobs.py" || true
  sleep 5
done
