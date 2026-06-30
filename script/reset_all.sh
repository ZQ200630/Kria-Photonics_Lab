#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
AXIS_CAPTURE_MODULE="axis_capture_superblock"
AXIS_CAPTURE_KO="${SCRIPT_DIR}/axis-capture-superblock.ko"
TAURI_SERVER="${SCRIPT_DIR}/butterfly_laser_server_tauri.py"
TAURI_SERVER_LOG="${SCRIPT_DIR}/butterfly_laser_server_tauri.log"

cd "${SCRIPT_DIR}"

find_port_pids() {
  local port="$1"

  if command -v fuser >/dev/null 2>&1; then
    fuser -n tcp "${port}" 2>/dev/null | tr ' ' '\n' || true
  fi

  if command -v lsof >/dev/null 2>&1; then
    lsof -tiTCP:"${port}" -sTCP:LISTEN 2>/dev/null || true
  fi

  if command -v ss >/dev/null 2>&1; then
    ss -H -ltnp 2>/dev/null \
      | awk -v suffix=":${port}" '$4 ~ suffix "$" { print $0 }' \
      | sed -n 's/.*pid=\([0-9][0-9]*\).*/\1/p' || true
  fi

  if command -v netstat >/dev/null 2>&1; then
    netstat -ltnp 2>/dev/null \
      | awk -v suffix=":${port}" '$4 ~ suffix "$" { print $7 }' \
      | sed -n 's/^\([0-9][0-9]*\)\/.*/\1/p' || true
  fi

  return 0
}

find_server_pids() {
  if command -v pgrep >/dev/null 2>&1; then
    pgrep -f 'butterfly_laser_server(_tauri)?\.py' 2>/dev/null || true
  fi
  return 0
}

collect_server_pids() {
  {
    find_port_pids 8080
    find_port_pids 9090
    find_server_pids
  } | awk '/^[0-9]+$/ && !seen[$0]++ { print }'
}

terminate_pids() {
  local label="$1"
  shift
  local pids=("$@")

  if [[ "${#pids[@]}" -eq 0 ]]; then
    echo "No existing ${label} process found."
    return 0
  fi

  echo "Stopping existing ${label} process(es): ${pids[*]}"
  kill "${pids[@]}" 2>/dev/null || true

  local attempt pid
  for attempt in {1..25}; do
    local alive=()
    for pid in "${pids[@]}"; do
      if kill -0 "${pid}" 2>/dev/null; then
        alive+=("${pid}")
      fi
    done
    if [[ "${#alive[@]}" -eq 0 ]]; then
      echo "Stopped ${label} process(es)."
      return 0
    fi
    sleep 0.2
  done

  echo "Force killing ${label} process(es): ${alive[*]}"
  kill -9 "${alive[@]}" 2>/dev/null || true
}

stop_existing_servers() {
  local pids=()
  local pid

  while IFS= read -r pid; do
    if [[ -n "${pid}" ]]; then
      pids+=("${pid}")
    fi
  done < <(collect_server_pids)

  terminate_pids "HTTP 8080 / TCP 9090 server" "${pids[@]}"

  pids=()
  while IFS= read -r pid; do
    if [[ -n "${pid}" ]]; then
      pids+=("${pid}")
    fi
  done < <(collect_server_pids)

  if [[ "${#pids[@]}" -ne 0 ]]; then
    echo "Server process(es) still running after cleanup: ${pids[*]}" >&2
    exit 1
  fi

  echo "Confirmed no server is listening on HTTP 8080 or TCP 9090."
}

unload_axis_capture_superblock() {
  if grep -q "^${AXIS_CAPTURE_MODULE}[[:space:]]" /proc/modules; then
    echo "Removing existing ${AXIS_CAPTURE_MODULE}"
    rmmod "${AXIS_CAPTURE_MODULE}"
  fi
}

load_axis_capture_superblock() {
  if [[ ! -f "${AXIS_CAPTURE_KO}" ]]; then
    echo "Missing file: ${AXIS_CAPTURE_KO}" >&2
    exit 1
  fi
  unload_axis_capture_superblock
  echo "Loading ${AXIS_CAPTURE_KO}"
  insmod "${AXIS_CAPTURE_KO}"
}

start_tauri_server() {
  if [[ ! -f "${TAURI_SERVER}" ]]; then
    echo "Missing file: ${TAURI_SERVER}" >&2
    exit 1
  fi

  echo "Starting Butterfly Tauri server in background..."
  nohup python "${TAURI_SERVER}" --host 0.0.0.0 --port 8080 --pa-tcp-port 9090 > "${TAURI_SERVER_LOG}" 2>&1 &
  local server_pid="$!"
  echo "Butterfly Tauri server started with PID ${server_pid}; log: ${TAURI_SERVER_LOG}"
}

stop_existing_servers
unload_axis_capture_superblock
fpgautil -R
fpgautil -b design_top.bin
fpgautil -o pl.dtbo
load_axis_capture_superblock
echo -5/+5V > /sys/bus/iio/devices/iio:device2/output_range
echo 1 > /sys/bus/iio/devices/iio:device2/buffer0/out_voltage0_en
echo 1 > /sys/bus/iio/devices/iio:device2/buffer0/out_voltage1_en
echo 1 > /sys/bus/iio/devices/iio:device2/buffer0/enable
echo start_stream > /sys/bus/iio/devices/iio:device2/stream_status
echo 0/2.5V > /sys/bus/iio/devices/iio:device1/output_range
echo 1 > /sys/bus/iio/devices/iio:device1/buffer0/out_voltage0_en
echo 1 > /sys/bus/iio/devices/iio:device1/buffer0/out_voltage1_en
echo 1 > /sys/bus/iio/devices/iio:device1/buffer0/enable
echo start_stream > /sys/bus/iio/devices/iio:device1/stream_status
echo 2000 > /sys/bus/platform/devices/ada4355-gpio-ctrl/gain_ohms
echo 0 > /sys/bus/platform/devices/ada4355-gpio-ctrl/low_pass_enabled
start_tauri_server
