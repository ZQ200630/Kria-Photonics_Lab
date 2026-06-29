# Butterfly Laser Control

Butterfly Laser Control is the control and acquisition stack for a Kria K26
based butterfly laser, TEC, ADA4355 photodiode monitor, spectrum capture, and
photoacoustic imaging setup.

The project combines:

- A Python hardware server that runs on the board and talks to PL registers,
  DMA capture devices, sysfs controls, and board-local files.
- A Tauri 2 desktop console for Linux, Windows, and macOS.
- Board payload files for loading the current PL image, device tree overlay,
  AXIS capture kernel module, and reset script.
- Analysis and documentation utilities for saved PA image, PA series, ADA raw,
  monitor, and spectrum data.

This software is intended for a trusted lab network. It exposes direct hardware
control endpoints and does not implement authentication.

## System Overview

```text
Host computer
  Tauri desktop GUI
    |
    | HTTP/SSE REST API on port 8080
    | PA TCP stream on port 9090
    v
Kria K26 Linux PS
  butterfly_laser_server.py
  butterfly_laser_control.py
  pa_imaging_capture.py
    |
    | AXI-Lite, /dev/mem, /dev/axis_capture0, sysfs
    v
FPGA/PL + analog front end
  AD4170 TEC controller
  AD3552R laser current control
  ADA4355 monitor/spectrum/raw capture
  PA scan scheduler and AXIS frame capture
```

The PL handles time-critical behavior such as TEC control, laser scan timing,
ADA4355 capture, lock logic, and PA image acquisition. The Python server
configures hardware and exposes a higher-level API. The Tauri app provides the
operator interface, live plots, data saving, and offline viewers.

## Features

- TEC temperature initialization, open-loop control, closed-loop PID, limits,
  ramping, and live temperature monitor.
- Laser current control, scan setup, spectrum-based lock, direct lock, and
  board-matched lock workflows.
- ADA4355 configuration for transimpedance gain, low-pass mode, zero ADC code,
  raw ADC capture, glitch/LP filtering, and rolling PD monitor.
- Spectrum monitor and saved spectrum/lock data workflows.
- PA imaging scheduler with scan capture, point capture, manual control,
  abort-and-park behavior, ROI/canvas guided fine scan, live image preview, and
  offline image/series viewers.
- Cross-platform data root management and generated analysis examples.
- Board upload scripts for reproducible release payloads and local debug
  payloads.
- GitHub Actions workflow for Linux, Windows, and macOS Tauri release builds.

## Repository Layout

```text
.
├── butterfly_laser_control.py          # Low-level AXI/sysfs hardware access
├── butterfly_laser_server.py           # Main HTTP JSON/SSE server for the board
├── butterfly_laser_server_tauri.py     # Tauri-oriented compatibility server
├── pa_imaging_capture.py               # PA scheduler, capture, parsing helpers
├── upload_pl.sh                        # Upload versioned board_payload files
├── upload_debug.sh                     # Upload live toolchain outputs on this Linux workstation
├── board_payload/                      # Versioned PL/runtime files for releases
├── tauri_control_console/              # Tauri 2 + React + TypeScript desktop app
├── tests/                              # Python server/control tests
├── docs/                               # Packaging notes and design records
├── tools/                              # Vivado warning/timing helper scripts
└── milestones/                         # Hardware/debug milestone snapshots
```

## Requirements

### Board

- Xilinx Kria K26 based Linux system.
- Current PL image and device tree overlay from `board_payload/`.
- Python 3.
- Root access for `/dev/mem`, `fpgautil`, kernel module loading, and sysfs
  hardware controls.
- Expected board-side paths/devices include:
  - `/dev/axis_capture0`
  - `/sys/bus/platform/devices/ada4355-gpio-ctrl`
  - ADI IIO DAC paths used by `reset_all.sh`

### Host Development Machine

- Node.js 20 or compatible.
- Rust stable toolchain.
- Tauri Linux dependencies when building on Linux.
- Network access to the board, defaulting to:

```text
HTTP API: http://192.168.8.236:8080
PA TCP:   192.168.8.236:9090
```

## Quick Start

### 1. Upload the board payload

From the repository root:

```bash
./upload_pl.sh
```

The default target is:

```text
root@192.168.8.236:/run/media/sdb1/PL/
```

Override it with an argument or environment variable:

```bash
./upload_pl.sh root@192.168.8.236:/run/media/sdb1/PL/
PL_UPLOAD_TARGET=root@192.168.8.236:/run/media/sdb1/PL/ ./upload_pl.sh
```

For local Linux development, `upload_debug.sh` uploads live Vivado/PetaLinux
outputs from their original absolute paths instead of the versioned
`board_payload/` copies:

```bash
./upload_debug.sh
```

### 2. Reset/load PL on the board

On the board:

```bash
cd /run/media/sdb1/PL
./reset_all.sh
```

This reloads PL, applies `pl.dtbo`, reloads `axis-capture-superblock.ko`, starts
the DAC streams, and configures the ADA4355 GPIO control defaults.

### 3. Start the board server

On the board:

```bash
cd /run/media/sdb1/PL
sudo python3 butterfly_laser_server.py --host 0.0.0.0 --port 8080
```

The Tauri-compatible wrapper is also available:

```bash
sudo python3 butterfly_laser_server_tauri.py --host 0.0.0.0 --port 8080
```

The main server exposes the integrated PA imaging, ADA, TEC, laser, lock,
settings, and data APIs.

### 4. Start the Tauri console

On the host:

```bash
./start_tauri_control_console.sh
```

Or manually:

```bash
cd tauri_control_console
npm install
npm run tauri dev
```

The GUI defaults to the board backend at `http://192.168.8.236:8080`. The
backend URL can be changed in the app settings when needed.

## Normal Operation

Typical experiment flow:

1. Load/reset PL with `reset_all.sh`.
2. Start the board server.
3. Open the Tauri console.
4. Confirm the Monitor page shows temperature and PD monitor data.
5. Configure ADA gain/low-pass/zero ADC code under ADA settings.
6. Start TEC and wait for a stable target temperature.
7. Use Lock/Spectrum tools for optical alignment and locking.
8. Use PA Imaging for scan capture, point capture, canvas-guided fine scan, and
   offline image/series analysis.
9. Save data through the GUI. Files are organized under the global data root.

## Data and Analysis

The GUI stores data under a global data root configured in Settings. Data types
are separated into subfolders and date-based directories. PA image acquisition
uses temporary current/canvas slots for live work and explicit save actions for
long-term storage.

Settings also provides downloadable documentation and Python examples:

- Data Manual PDF.
- Python Examples ZIP with readers for PA image, PA series, ADA raw CSV,
  spectrum CSV, and REST API usage.

For detailed register-level documentation, see:

```text
BUTTERFLY_LASER_DRIVER_MANUAL.md
```

## REST API

The board server exposes a trusted-lab REST API. Examples:

```bash
curl http://192.168.8.236:8080/api/status
curl http://192.168.8.236:8080/api/settings
curl -X POST http://192.168.8.236:8080/api/stop-all
curl -X POST http://192.168.8.236:8080/api/pa/scheduler/abort
```

The API is intentionally low-friction for lab automation and does not include
authentication. Do not expose it outside the lab network.

## Development

Run frontend tests:

```bash
cd tauri_control_console
npm test -- --run
```

Build the frontend:

```bash
npm run build
```

Check the Tauri Rust backend:

```bash
cd tauri_control_console/src-tauri
cargo check
```

Run Python syntax checks:

```bash
python3 -m py_compile \
  butterfly_laser_control.py \
  butterfly_laser_server.py \
  butterfly_laser_server_tauri.py \
  pa_imaging_capture.py
```

## Packaging

Local Linux packaging:

```bash
cd tauri_control_console
npm run tauri build
```

Cross-platform release builds are defined in:

```text
.github/workflows/tauri-release.yml
```

Pushing a tag such as `v0.1.0` builds Linux, Windows, macOS x86_64, and macOS
arm64 packages and publishes them as GitHub Release assets.

For more details, see:

```text
docs/PACKAGING.md
```

## Safety Notes

- This project controls laser current, TEC output, PL timing, and analog
  acquisition hardware.
- Confirm hardware interlocks, current limits, optical safety controls, and TEC
  limits before enabling output.
- Use `Abort & Park`, `Stop`, or `/api/stop-all` before changing PL or resetting
  the board during an experiment.
- The HTTP API has no authentication and should only be used on a trusted lab
  network.

## Troubleshooting

If the GUI cannot connect:

```bash
curl http://192.168.8.236:8080/api/status
```

If the board server reports missing PA capture device, verify:

```bash
ls -l /dev/axis_capture0
lsmod | grep axis_capture
```

If PA capture or reset behavior is stale after a PL reload, rerun:

```bash
cd /run/media/sdb1/PL
./reset_all.sh
```

If a release build fails on Linux AppImage runtime download, use the GitHub
Actions release workflow or follow the local runtime workaround in
`docs/PACKAGING.md`.

## License

No license file is currently included. Treat this repository as private/internal
unless a license is added.
