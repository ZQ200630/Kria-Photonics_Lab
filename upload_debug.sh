#!/usr/bin/env bash
set -euo pipefail

TARGET="${1:-${PL_UPLOAD_TARGET:-root@192.168.8.236:/run/media/sdb1/PL/}}"

# Debug uploader for this Linux workstation. It intentionally uses the live
# Vivado/PetaLinux output paths so newly generated PL/kernel artifacts can be
# tested without first copying them into board_payload/.
SOURCES=(
  "/home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/hardware/xilinx-k26-som-2023.2/xilinx-k26-som-2023.2.runs/impl_margin_perf_explore/design_top.bin"
  "/home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/pl_related/pl.dtbo"
  "/home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/project-spec/meta-user/recipes-modules/axis-capture-superblock/files/axis-capture-superblock.ko"
  "/home/qian/Portable_System_Project/Butterfly_Laser_Driver/script/reset_all.sh"
  "/home/qian/Portable_System_Project/Butterfly_Laser_Driver/butterfly_laser_control.py"
  "/home/qian/Portable_System_Project/Butterfly_Laser_Driver/butterfly_laser_server.py"
  "/home/qian/Portable_System_Project/Butterfly_Laser_Driver/butterfly_laser_server_tauri.py"
  "/home/qian/Portable_System_Project/Butterfly_Laser_Driver/pa_imaging_capture.py"
)

for source in "${SOURCES[@]}"; do
  if [[ ! -f "$source" ]]; then
    echo "Missing file: $source" >&2
    exit 1
  fi
done

echo "Uploading debug artifacts from live toolchain paths to ${TARGET}"
scp -p "${SOURCES[@]}" "${TARGET}"
echo "Upload complete."
