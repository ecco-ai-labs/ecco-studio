#!/usr/bin/env bash
# Pack each voice environment on the global volume into one archive, once.
#
# Serverless audio workers cannot execute files on the volume, so every new worker must make
# the voice environment it needs local before speaking. Copying a venv file by file from the
# network volume (tens of thousands of small files) took 15+ minutes and looked like a hang
# ("Loading speech models", 11 Nov 2026). Unpacking one archive is a single sequential read.
#
# Run on a pod with the global volume attached (it is mounted at /workspace-global when
# /workspace is taken). Safe to re-run: an environment is re-packed only when it changed.
#
#   bash serverless/pack_audio_venvs.sh                # pack every *-venv
#   bash serverless/pack_audio_venvs.sh chatterbox     # pack one
#   bash serverless/pack_audio_venvs.sh --dry-run
set -euo pipefail

ROOT="${ECCO_GLOBAL_AUDIO:-}"
if [[ -z "$ROOT" ]]; then
  for candidate in /workspace-global/ecco-audio /runpod-volume/ecco-audio; do
    [[ -d "$candidate" ]] && ROOT="$candidate" && break
  done
fi
[[ -n "$ROOT" && -d "$ROOT" ]] || { echo "Global volume ecco-audio folder not found; set ECCO_GLOBAL_AUDIO." >&2; exit 1; }

DRY=0; ONLY=()
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY=1 ;;
    *) ONLY+=("${arg%-venv}-venv") ;;
  esac
done

shopt -s nullglob
for venv in "$ROOT"/*-venv; do
  name="$(basename "$venv")"
  [[ -f "$venv/pyvenv.cfg" ]] || continue
  if (( ${#ONLY[@]} )) && [[ ! " ${ONLY[*]} " == *" $name "* ]]; then continue; fi
  archive="$ROOT/$name.tar"
  stamp="$(find "$venv" -newer "$archive" -print -quit 2>/dev/null || true)"
  if [[ -f "$archive" && -f "$archive.sha256" && -z "$stamp" ]]; then
    echo "up to date  $name"
    continue
  fi
  size="$(du -sh "$venv" | cut -f1)"
  if (( DRY )); then echo "would pack  $name ($size)"; continue; fi
  echo "packing     $name ($size) ..."
  start=$SECONDS
  tar -cf "$archive.partial" -C "$ROOT" "$name"
  sha256sum "$archive.partial" | awk '{print $1}' > "$archive.sha256.partial"
  mv "$archive.partial" "$archive"
  mv "$archive.sha256.partial" "$archive.sha256"
  echo "packed      $name in $((SECONDS - start)) s -> $(du -h "$archive" | cut -f1)"
done
