#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$PROJECT_ROOT/tauri_control_console"
LOG_FILE="/tmp/butterfly_tauri_dev_current.log"
PID_FILE="/tmp/butterfly_tauri_dev_current.pid"

if [[ ! -d "$PROJECT_DIR" ]]; then
  echo "Project folder not found: $PROJECT_DIR" >&2
  exit 1
fi

if [[ -f "$PID_FILE" ]]; then
  existing_pid="$(cat "$PID_FILE")"
  if [[ -n "$existing_pid" ]] && kill -0 "$existing_pid" 2>/dev/null; then
    echo "Tauri dev process is already running (PID: $existing_pid)."
    echo "If you want to restart, stop it first: kill $existing_pid or rm $PID_FILE."
    exit 0
  fi
fi

cd "$PROJECT_DIR"

echo "Starting Butterfly Tauri control console..."

nohup env \
  -u PKG_CONFIG_SYSROOT_DIR \
  -u CC -u CXX -u AR -u AS -u LD -u STRIP -u RANLIB -u OBJCOPY -u OBJDUMP -u READELF \
  -u CFLAGS -u CXXFLAGS -u LDFLAGS \
  PKG_CONFIG_PATH=/usr/lib/x86_64-linux-gnu/pkgconfig:/usr/share/pkgconfig:/usr/lib/pkgconfig \
  PKG_CONFIG_LIBDIR=/usr/lib/x86_64-linux-gnu/pkgconfig:/usr/share/pkgconfig:/usr/lib/pkgconfig \
  PATH=/home/qian/.local/nodejs/bin:/home/qian/.cargo/bin:$PATH \
  npm run tauri dev > "$LOG_FILE" 2>&1 < /dev/null &

TAURI_PID=$!
echo "$TAURI_PID" > "$PID_FILE"

echo "Started PID: $TAURI_PID"
echo "Log: $LOG_FILE"
echo "Open: http://127.0.0.1:1420/"
