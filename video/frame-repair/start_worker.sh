#!/usr/bin/env bash
set -euo pipefail
base=/workspace/ecco-video/frame-repair
if [[ ! -x "$base/venv/bin/python" || ! -f "$base/model/model_index.json" ]]; then
  echo 'VACE repair runtime is not installed. Run install_runtime.sh explicitly.'
  exit 0
fi
exec "$base/venv/bin/python" "$base/worker.py"
