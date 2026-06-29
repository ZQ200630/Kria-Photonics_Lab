#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
TARGET="${1:-${PL_UPLOAD_TARGET:-root@192.168.8.236:/run/media/sdb1/PL/}}"

SOURCES=(
  "${REPO_ROOT}/board_payload/design_top.bin"
  "${REPO_ROOT}/board_payload/pl.dtbo"
  "${REPO_ROOT}/board_payload/axis-capture-superblock.ko"
  "${REPO_ROOT}/board_payload/reset_all.sh"
  "${REPO_ROOT}/butterfly_laser_control.py"
  "${REPO_ROOT}/butterfly_laser_server.py"
  "${REPO_ROOT}/butterfly_laser_server_tauri.py"
  "${REPO_ROOT}/pa_imaging_capture.py"
)

for source in "${SOURCES[@]}"; do
  if [[ ! -f "$source" ]]; then
    echo "Missing file: $source" >&2
    exit 1
  fi
done

echo "Uploading ${#SOURCES[@]} files to ${TARGET}"
scp -p "${SOURCES[@]}" "${TARGET}"
echo "Upload complete."
