#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
AXIS_CAPTURE_MODULE="axis_capture_superblock"
AXIS_CAPTURE_KO="${SCRIPT_DIR}/axis-capture-superblock.ko"

cd "${SCRIPT_DIR}"

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
