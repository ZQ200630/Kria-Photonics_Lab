# Project Release Milestone And Handoff

Date: 2026-06-29
Project: Butterfly Laser Driver / Kria Photonics Lab
Repository: `https://github.com/ZQ200630/Kria-Photonics_Lab.git`
Workspace: `/home/qian/Portable_System_Project/Butterfly_Laser_Driver`

This milestone records the state after the large synchronization, PA imaging,
ADA raw capture, data storage, documentation, packaging, and GitHub publication
work. It is intended to let the next Codex session restore the full working
context without relying on chat history.

## Executive Summary

The workspace now contains an integrated control and acquisition stack for a
Kria K26 based photonics lab system:

- Python board-side server for TEC, laser current, ADA4355, spectrum/lock, and
  PA imaging control.
- Tauri 2 desktop GUI for Linux, Windows, and macOS.
- Versioned board payload files for PL loading and runtime reset.
- PA imaging TCP/data pipeline integrated into the server and GUI.
- Cross-platform data-root based saving and offline data viewers.
- Generated user documentation and Python analysis examples downloadable from
  the GUI.
- GitHub Actions release workflow for cross-platform packaging.
- Published GitHub repository and `v0.1.0` tag.

The last published release baseline is:

```text
origin/main -> 7c359451c27ed96e50c57ef5f8d9b5e348fc3aa4
v0.1.0      -> 7c359451c27ed96e50c57ef5f8d9b5e348fc3aa4
```

If this document is committed after that release, use `git log --decorate -5`
as the authoritative source for the exact later documentation milestone commit.

## How This Milestone Was Reached

### 1. Workspace Restoration And Windows Sync

The workspace was restored under:

```text
/home/qian/Portable_System_Project/Butterfly_Laser_Driver
```

The earlier Windows edits were synchronized using the provided patch:

```text
codex_linux_sync_20260625_101001.patch
```

The Tauri GUI and board server were then repeatedly launched and tested against
the hardware board at:

```text
HTTP API: http://192.168.8.236:8080
PA TCP:   192.168.8.236:9090
```

### 2. ADA4355 Raw Capture Expansion

The raw ADC path was separated from the older shared BRAM control path so raw
capture could grow beyond the former 16384-point limit.

The implemented target behavior is:

- Raw ADC capture length can be set up to 512K samples.
- Raw data has its own buffer path.
- Raw data is packed as two 16-bit samples per 32-bit word on the server side.
- Raw LP shift is independent from the live/spectrum LP shift.
- Live/spectrum LP shift is controlled from the Lock view.
- Raw capture can enable independent glitch rejection and low-pass filtering.

Important code:

```text
butterfly_laser_control.py
butterfly_laser_server.py
tauri_control_console/src/components/AdaPanel.tsx
tauri_control_console/src/utils/ada4355.ts
tauri_control_console/src/utils/rawPlot.ts
tests/test_ada4355_raw_buffer.py
```

### 3. ADA4355 Current Conversion And Analog Settings

The GUI was changed to use signed ADC code display for ADA-related plots and
exports, because the observed behavior around zero light and saturation matches
the ADA4355 inverse transfer function more naturally when interpreted as a
signed code.

Current behavior:

- GUI displays signed ADC code for ADA monitor/spectrum/raw views.
- `PD Zero ADC Code` defines the displayed 0 uA point.
- A one-click calibration captures raw ADC data and averages it into the zero
  ADC code field.
- ADA gain and low-pass settings live under ADA settings, not global settings.
- Supported gain values are 2 kOhm, 20 kOhm, and 200 kOhm.
- Supported low-pass choices are 1 MHz and 100 MHz.
- Saturation and zero-code behavior are handled in the GUI display logic.

Important context from lab observations:

- Laser off produced GUI ADC codes around 28800 to 29630 depending on gain.
- Higher optical signal reduced signed code in one range and wrapped through the
  signed representation in saturated cases.
- Around 36300 in the GUI corresponds to the negative voltage/current saturation
  side described by the ADA4355 transfer diagram.

### 4. Monitor, Lock, And Spectrum UI Ownership

The old Overview concept was simplified into Monitor. Monitor is intended to be
the first page and contains the always-on lab status:

- Temperature Monitor.
- PD Monitor.

Spectrum data is not always present, so it is handled in Lock/Spectrum views
where acquisition is expected.

Lock-specific adjustments:

- Live/Spectrum LP Shift moved to Lock and is labeled simply LP Shift.
- Gain and zero ADC readouts were removed from the lock toolbar.
- Direct Lock and Board Match Lock remain separate methods.
- Board Match Lock lets PL find the live matching crossing rather than trusting
  a possibly stale GUI marker.
- Plot labels, legends, and right-side monitor text were reduced to avoid
  overlaps.

### 5. PA Imaging Server Integration

The original PA user-space application:

```text
/home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/project-spec/meta-user/recipes-apps/axis-capture-app/files/axis-capture-app.c
```

was used as the reference for integrating PA acquisition into the Python server
instead of saving only board-local files.

The implemented architecture:

```text
axi_pam_image_acq_0
  -> frame_capture_axis
  -> ADI AXI DMA
  -> axis-capture-superblock kernel module
  -> /dev/axis_capture0
  -> pa_imaging_capture.py
  -> butterfly_laser_server.py
  -> TCP listener on port 9090
  -> Tauri local receiver / parser / preview
```

Key server endpoints include:

```text
GET  /api/pa/status
GET  /api/pa/diagnostics
POST /api/pa/start
POST /api/pa/point/start
POST /api/pa/stop
POST /api/pa/disconnect
GET  /api/pa/scheduler/status
POST /api/pa/scheduler/config
POST /api/pa/scheduler/command
POST /api/pa/scheduler/manual-position
POST /api/pa/scheduler/pulse
POST /api/pa/scheduler/waveform
```

The waveform endpoint exists at the server/scheduler layer, but the GUI
waveform tab is intentionally hidden for now.

Important files:

```text
pa_imaging_capture.py
butterfly_laser_server.py
tauri_control_console/src/components/PaImagingPanel.tsx
tauri_control_console/src/components/PaImageViewer.tsx
tauri_control_console/src/components/PaSeriesViewer.tsx
tauri_control_console/src/utils/paImaging.ts
tauri_control_console/src/utils/paImage.ts
tauri_control_console/src/utils/paImageTauri.ts
tauri_control_console/src-tauri/src/pa_image.rs
tauri_control_console/src-tauri/src/pa_stream.rs
```

### 6. PA Timing And Scan Settings

The PA timing configuration was moved out of the main PA Imaging page into a
dedicated Timing page. Time parameters are shown as human-readable ns/us/ms
values and converted back to 100 MHz clock counts.

Timing model:

- `gap_time` is the frame/pixel period.
- Repetition rate and gap time are linked.
- `galvo_settle_time`, `ld_trigger_time`, `ld_time`, and
  `adc_trigger_time` are configured in real time units.
- Required minimum gap is calculated from settle time and the larger of laser
  and ADC capture end times, with an additional ADC-end buffer.
- The timing diagram displays the relative position of pixel/frame start,
  galvo settle, laser trigger/emission, ADC trigger/window, required total, and
  frame period.

Preferred defaults:

```text
repetition rate:       3 kHz
galvo_settle_time:     10 us
ld_trigger_time:       2 us
ld_time:               4 us
adc_trigger_time:      1 us
ADC window:            2048 samples at 125 MHz
scan mode:             Serpentine
default scan range:    4000 counts
default scan points:   400
calibration:           4000 counts = 530 um
```

Scan settings support two editing modes:

- start, end, points
- center, range, points

The scan preview uses physical units, not just pixel indices.

### 7. PA Capture Stability

Several stability issues were diagnosed around missing frames, DMA timing, and
abort/reset behavior.

Observed and addressed points:

- Early captures returned too many frames for small scans until PL/server
  trigger behavior was corrected.
- Long captures originally lost frames, for example about 622k received out of
  640k expected.
- After driver/server/scheduler changes, a later long capture completed without
  visible dropped frames according to the user.
- Additional counters and diagnostics were added around acquisition health,
  accepted blocks, waits, faults, callbacks, rearm counts, gaps, and completed
  frames.
- Abort & Park was added as the primary safe operator action.
- Stop/disconnect paths call scheduler abort/park best-effort and attempt to
  stop PA service threads with join timeouts.

Important caution:

Resetting PL while the server is actively using `/dev/mem` or capture devices
can still be hazardous. Stop capture and abort/park before PL reloads.

### 8. PA Image Preview, Canvas, ROI, And Fine Scan

The PA Imaging page evolved into a two-column workflow:

- Left: PA Image Preview.
- Right: PA Scheduler and active mode controls.

The current image interaction model:

- Drag on the image to define ROI.
- Click a pixel to set Point Capture and Manual Control coordinates.
- Zoom To ROI changes the displayed view.
- Reset Zoom returns to the full view.
- Apply ROI To Scan converts the ROI into the next scan geometry.
- Set Canvas stores the current image as a persistent reference image.
- Show Current and Show Canvas switch between current capture and reference
  canvas.
- Canvas can guide fine scans by drawing/selecting a region.
- If ROI was applied from canvas, returning to canvas keeps the linked ROI
  visible.

Design intent:

- Canvas is a global navigation reference from a coarse scan.
- Fine scan uses a selected canvas region and smaller step/resolution.
- Current image can change without destroying canvas.

### 9. PA Image Viewer And Series Viewer

Offline PA Image Viewer:

- Opens legacy PA `.bin` files.
- Builds image from frames using current ROI/baseline settings.
- Fast Build is enabled by default.
- Build progress is displayed.
- Frame Trace supports zoom, PTP ROI selection, and baseline selection.
- Save ROI Defaults stores ROI/baseline defaults for future live/offline work.
- Image display supports:
  - Magma default colormap.
  - Other colormaps.
  - Enhancement modes.
  - Colorbar.
  - ROI zoom.
  - Pixel click to load the corresponding frame trace.
  - Find Similar mask based on selected pixel PTP.
- When a similarity mask is active, selecting pixels outside the mask is
  blocked.

PA Series Viewer:

- Intended for point-capture data.
- Uses a two-column layout:
  - left: frame trace
  - right: PTP timeline and statistics
- Clicking a timeline point selects the corresponding frame without changing the
  current zoom.
- Statistics include average, variance, standard deviation, and frame count.

### 10. Cross-Platform Data Storage

The GUI now has a global Data Root configured in Settings. Saved data uses
cross-platform path handling in Tauri/Rust and avoids mixing files and folders
at the same directory level.

Data type directories:

```text
ada_raw/
idle_spectrum/
lock_spectrum_pair/
monitor_data/
pa_image/
pa_point_capture/
settings_export/
spectrum_recording/
spectrum_snapshot/
```

Each data type contains date directories:

```text
YYYYMMDD/
```

Each date directory contains record directories:

```text
name_1/
name_2/
...
```

A record directory contains files only, for example:

```text
metadata.json
data.csv
capture.bin
```

Important storage files:

```text
tauri_control_console/src-tauri/src/storage.rs
tauri_control_console/src/utils/storage.ts
tauri_control_console/src/components/SettingsPanel.tsx
```

Settings also provides downloads:

- Data Manual PDF.
- Python Examples ZIP.

The generated Python examples describe how to parse:

- PA legacy `.bin` files.
- PA point series.
- ADA raw CSV.
- Spectrum CSV.
- Metadata JSON.
- Basic REST API workflows.

### 11. Board Payload And Upload Scripts

Release board payload files are versioned under:

```text
board_payload/
```

Current contents:

```text
design_top.bin
pl.dtbo
axis-capture-superblock.ko
reset_all.sh
README.md
```

`upload_pl.sh` uploads the versioned payload plus Python server files.

`upload_debug.sh` keeps the old Linux absolute paths for rapid debug uploads
from the local Vivado/PetaLinux workspace. This is useful because generated
`.bit`, `.bin`, `.dtbo`, and `.ko` paths differ across machines and toolchains.

Default upload target:

```text
root@192.168.8.236:/run/media/sdb1/PL/
```

Override with:

```bash
./upload_pl.sh root@192.168.8.236:/run/media/sdb1/PL/
PL_UPLOAD_TARGET=root@192.168.8.236:/run/media/sdb1/PL/ ./upload_pl.sh
```

Board reset/load command:

```bash
cd /run/media/sdb1/PL
./reset_all.sh
```

The reset script reloads PL, applies device tree overlay, removes the existing
axis-capture-superblock module if needed, inserts the versioned `.ko`, starts
DAC streams, and configures ADA defaults.

### 12. Packaging And GitHub Publication

The root README was generated to describe the project, usage, quick start,
data, REST API, packaging, and troubleshooting.

Packaging documentation:

```text
docs/PACKAGING.md
```

Release workflow:

```text
.github/workflows/tauri-release.yml
```

The workflow builds:

```text
Linux x86_64
Windows x86_64
macOS x86_64
macOS arm64
```

Expected package types:

```text
Linux:   .deb, .rpm, .AppImage
Windows: .msi, .exe
macOS:   .dmg, .app
```

The user manually pushed the repository from their own terminal after this
Codex terminal failed to use GitHub authentication.

Remote verification showed:

```text
refs/heads/main    7c359451c27ed96e50c57ef5f8d9b5e348fc3aa4
refs/tags/v0.1.0   7c359451c27ed96e50c57ef5f8d9b5e348fc3aa4
```

## Current Git And Workspace Rules

Do:

- Treat `origin/main` and local Git history as authoritative.
- Keep `WORK_SESSION_HANDOFF.md` updated after major changes.
- Use `milestones/` for durable hardware/session snapshots.
- Use `git status -sb --ignored` to distinguish real changes from ignored
  generated files.
- Use `apply_patch` for manual edits.
- Run focused tests before claiming completion.

Do not:

- Delete backup files unless the user explicitly asks.
- Track local backup files or Vivado temporary logs.
- Run `git clean -fdx`.
- Revert user changes with `git reset --hard` or `git checkout --`.
- Expose the HTTP API outside the trusted lab network.

Ignored but expected local artifacts include:

```text
tauri_control_console/node_modules/
tauri_control_console/dist/
tauri_control_console/src-tauri/target/
release_artifacts/
vivado*.log
vivado*.jou
xsim.dir/
xvlog.*
local backup files
```

## Hardware Addresses And Runtime Defaults

Primary addresses documented in the manual:

```text
AD4170 TEC controller base:       0xA0000000
ADA4355 capture controller base:  0xA0100000
Laser current controller base:    0xA0120000
ADA4355 spectrum buffer 0:        0xA01C0000
ADA4355 spectrum buffer 1:        0xA01D0000
```

Server arguments include:

```text
--host 0.0.0.0
--port 8080
--pa-tcp-port 9090
--pa-capture-dev /dev/axis_capture0
```

Important board paths:

```text
/dev/axis_capture0
/sys/bus/platform/devices/ada4355-gpio-ctrl/gain_ohms
/sys/bus/platform/devices/ada4355-gpio-ctrl/low_pass_enabled
```

## PA Legacy Binary Format

The saved PA image and point-capture files use the legacy stream format.

Each superblock starts with a 32-byte little-endian header:

```text
uint64 block_id
uint32 used_bytes
uint32 frame_count
uint64 first_frame_id
uint64 last_frame_id
```

The payload contains repeated frames. Each frame starts with a 16-byte
little-endian header:

```text
uint64 frame_id
uint32 data_bytes
uint32 reserved
```

Each frame payload starts with a 32-byte PA metadata block:

```text
uint32 reserved
uint32 global_shot_idx
uint16 y_points
uint16 x_points
uint16 frame_number
uint16 frame_idx
uint16 y_idx
uint16 x_idx
int16  current_y
int16  current_x
uint32 task_id
uint32 magic
```

The remainder is signed int16 ADC samples. The GUI normally displays the first
2000 useful samples and ignores the tail buffer region when appropriate.

## Verification History

Verification performed before the `v0.1.0` publication included:

- Tauri/Vitest frontend tests passed.
- Frontend build passed.
- Tauri Rust `cargo check` passed.
- Upload/reset scripts passed `bash -n`.
- Python `pytest` was not available in the environment during one earlier
  check, so Python unit tests were not fully run through pytest at that time.

Fresh verification for this documentation milestone:

```text
npm test -- --run: 36 test files passed, 273 tests passed
npm run build: TypeScript and Vite production build passed
cargo check: finished successfully for tauri_control_console/src-tauri
python3 -m py_compile: server/control Python files compiled successfully
bash -n: upload and reset scripts passed shell syntax checks
git diff --check: no whitespace errors in the changed files
```

Recommended commands to re-run before future release work:

```bash
cd tauri_control_console
npm test -- --run
npm run build
cd src-tauri
cargo check
cd ../..
python3 -m py_compile butterfly_laser_control.py butterfly_laser_server.py butterfly_laser_server_tauri.py pa_imaging_capture.py
bash -n upload_pl.sh upload_debug.sh board_payload/reset_all.sh script/reset_all.sh
```

## Recovery Checklist For Next Session

1. Read this file and `WORK_SESSION_HANDOFF.md`.
2. Run:

```bash
cd /home/qian/Portable_System_Project/Butterfly_Laser_Driver
git status -sb
git log --oneline --decorate -5
git remote -v
```

3. If testing with the board, upload and reset:

```bash
./upload_pl.sh
ssh root@192.168.8.236
cd /run/media/sdb1/PL
./reset_all.sh
```

4. Start the server on the board:

```bash
sudo python3 butterfly_laser_server.py --host 0.0.0.0 --port 8080
```

5. Start the GUI on the host:

```bash
./start_tauri_control_console.sh
```

6. Confirm Monitor shows temperature and PD data.
7. Confirm ADA raw capture still reads plausible signed ADC codes.
8. Confirm PA Scan Capture can run a small 10 x 10 x 1 capture before any long
   experiment.
9. Confirm Abort & Park returns to the expected safe state before changing PL.

## Known Open Follow-Ups

- Confirm GitHub Actions release assets for `v0.1.0`.
- Decide whether to add LICENSE.
- Add code signing for Windows/macOS if this becomes public or shared widely.
- Continue long-run PA stability testing after any HDL or kernel-module change.
- If PL reset safety remains a concern, add a stricter server-side "PL reload
  guard" mode that unmaps memory and closes capture devices before reset.
- If new saved data types are added, update storage type lists, data manual,
  Python examples, tests, and Settings downloads together.
