# Butterfly Laser Driver Work Session Handoff

Date: 2026-06-29
Project root: `/home/qian/Portable_System_Project/Butterfly_Laser_Driver`
GitHub repository: `https://github.com/ZQ200630/Kria-Photonics_Lab.git`
Current local branch: `feature/live-marker-tracking`
Published branch: `origin/main`
Release tag already published: `v0.1.0`

This file is the first file to read when resuming the workspace. It replaces the
older 2026-06-24 handoff, which described only the early lock/ADA work. The
current workspace is now a packaged, GitHub-published control stack that
contains the Python board server, the Tauri desktop console, board payload
files, upload scripts, documentation, and release automation.

## Current Milestone

The detailed milestone record for this state is:

```text
milestones/project_release_20260629_handoff/README.md
```

Read that file for the full history, component map, current feature set,
commands, known cautions, and next-session checklist.

## Authoritative Current State

- The repository has been published to GitHub.
- `origin/main` points at the packaged release commit that includes:
  - server code
  - Tauri GUI
  - board upload scripts
  - `board_payload/`
  - generated packaging workflow
  - project README
- `v0.1.0` points at the same packaged release commit and is present on GitHub.
- The local worktree may contain ignored build products, Vivado logs, backup
  files, node modules, and release artifacts. They are intentionally ignored.
- Do not run destructive cleanup such as `git reset --hard`, `git clean -fdx`,
  or deleting ignored Vivado/build artifacts unless the user explicitly asks.

## Project Purpose

This project controls and acquires data from a Kria K26 based photonics lab
system:

- TEC temperature control through AD4170 PL logic.
- Butterfly laser current control and spectrum-based lock workflows.
- ADA4355 photodiode monitor, spectrum capture, raw ADC capture, gain and
  low-pass configuration.
- Photoacoustic imaging scan capture, point capture, manual positioning, live
  image preview, offline image/series analysis, and saved data management.
- Cross-platform Tauri GUI for Linux, Windows, and macOS.

The board server exposes a trusted-lab HTTP/SSE REST API on port 8080 and a PA
TCP stream on port 9090.

## Important Paths

Repository root:

```text
/home/qian/Portable_System_Project/Butterfly_Laser_Driver
```

Tauri app:

```text
tauri_control_console/
```

Board runtime files included in Git:

```text
board_payload/design_top.bin
board_payload/pl.dtbo
board_payload/axis-capture-superblock.ko
board_payload/reset_all.sh
```

Main board-side Python files:

```text
butterfly_laser_control.py
butterfly_laser_server.py
butterfly_laser_server_tauri.py
pa_imaging_capture.py
```

Primary Tauri UI files:

```text
tauri_control_console/src/App.tsx
tauri_control_console/src/components/MonitorPanel.tsx
tauri_control_console/src/components/AdaPanel.tsx
tauri_control_console/src/components/LockPanel.tsx
tauri_control_console/src/components/PaImagingPanel.tsx
tauri_control_console/src/components/PaImageViewer.tsx
tauri_control_console/src/components/PaSeriesViewer.tsx
tauri_control_console/src/components/PaImageHeatmap.tsx
tauri_control_console/src/components/PlotCanvas.tsx
```

Data and parsing helpers:

```text
tauri_control_console/src/utils/storage.ts
tauri_control_console/src/utils/dataDocumentation.ts
tauri_control_console/src/utils/paImage.ts
tauri_control_console/src/utils/paImageTauri.ts
tauri_control_console/src/utils/paImaging.ts
tauri_control_console/src/utils/paScheduler.ts
tauri_control_console/src/utils/ada4355.ts
tauri_control_console/src-tauri/src/storage.rs
tauri_control_console/src-tauri/src/pa_image.rs
tauri_control_console/src-tauri/src/pa_stream.rs
```

## Normal Resume Commands

Check repository state:

```bash
cd /home/qian/Portable_System_Project/Butterfly_Laser_Driver
git status -sb
git log --oneline --decorate -5
```

Upload versioned board payload to the K26 board:

```bash
./upload_pl.sh
```

Upload live local Vivado/PetaLinux outputs for debug:

```bash
./upload_debug.sh
```

On the board:

```bash
cd /run/media/sdb1/PL
./reset_all.sh
sudo python3 butterfly_laser_server.py --host 0.0.0.0 --port 8080
```

On the host:

```bash
./start_tauri_control_console.sh
```

Manual Tauri development startup:

```bash
cd tauri_control_console
npm install
npm run tauri dev
```

## Key Current Behaviors

Monitor:

- Overview has been simplified into Monitor.
- Monitor is intended to show Temperature Monitor and PD Monitor as the main
  first-page live status.
- Temperature polling starts at app startup, not only after enabling TEC.
- PD Monitor has a rolling sample cap.

ADA:

- ADA settings own PD current offset/zero ADC code, transimpedance gain, and
  low-pass mode.
- Supported ADA transimpedance settings include 2 kOhm, 20 kOhm, and 200 kOhm.
- Supported ADA low-pass choices are 1 MHz and 100 MHz.
- Raw ADC capture supports the expanded raw buffer path up to 512K samples.
- Raw data has independent raw LP shift.
- Live/spectrum LP shift is separate and is controlled from Lock.
- Raw capture supports median-style glitch rejection and LP filtering.
- PD current conversion uses signed ADC code representation in the GUI.
- `PD Zero ADC Code` can be calibrated by capturing a raw frame and averaging.

Lock:

- Lock contains Direct Lock and Board Match Lock.
- Live/Spectrum LP Shift is shortened to LP Shift in the lock controls.
- Lock plots were adjusted for less label overlap.
- Gain/zero ADC readouts were removed from the lock toolbar.
- Lock data save paths now use the global data root.

PA Imaging:

- The former standalone PA user-space app logic has been integrated into the
  server through `pa_imaging_capture.py`.
- The server owns a TCP listener on port 9090.
- The GUI has Scan Capture, Point Capture, Manual Control, and Diagnostics.
- Waveform UI is intentionally hidden/unused for now.
- Scan Capture can be aborted with Abort & Park.
- Abort should park the scheduler and clear/reset preview/progress state in the
  UI.
- Running Scan Capture disables Point Capture and Manual Control.
- Running Point Capture disables Scan Capture and Manual Control.
- Return position can be configured, currently focused on center/start style
  parking behavior.
- Timing settings use real time units and derive counts at 100 MHz.
- Default timing preferences:
  - gap derived from 3 kHz repetition rate
  - galvo settle time 10 us
  - ld trigger time 2 us
  - ld time 4 us
  - adc trigger time 1 us
- Scan settings support start/end/points and center/range/points editing.
- Default scan preference is range 4000 counts and 400 points.
- Calibration default is 4000 counts = 530 um.
- Scan mode default is Serpentine.
- Scan preview and image displays use physical units derived from count
  calibration.
- PA Image Preview supports canvas/current modes, ROI drawing, zoom to ROI,
  applying ROI to scan, and canvas-guided fine scan.
- Canvas is a persistent reference image for navigation; current image can be
  set as canvas.
- Image Viewer supports fast build by default, zoom, pixel selection, frame
  trace display, ROI/baseline selection, colorbar, colormap selection, image
  enhancement, and similar-PTP mask generation.
- When a similarity mask is active, pixel selection is constrained to pixels
  inside the mask.
- PA Series Viewer displays point-capture series as a time axis, with frame
  trace on the left and PTP timeline/statistics on the right.

Data storage:

- Settings owns a global Data Root.
- Saved data is separated by data type and date.
- Parent directories do not mix files and folders.
- PA image current/canvas temporary files live in a temp area.
- Explicit save actions copy current/canvas/point data to the global data root.
- Settings provides downloadable Data Manual PDF and Python Examples ZIP.

Packaging:

- `README.md` documents project usage.
- `docs/PACKAGING.md` documents local and CI packaging.
- `.github/workflows/tauri-release.yml` builds Linux, Windows, macOS x86_64,
  and macOS arm64 packages.
- Tag pushes create GitHub Release assets.

## Verification Commands To Re-run Before Future Release Work

Frontend tests:

```bash
cd tauri_control_console
npm test -- --run
```

Frontend build:

```bash
cd tauri_control_console
npm run build
```

Rust/Tauri backend check:

```bash
cd tauri_control_console/src-tauri
cargo check
```

Python syntax check:

```bash
python3 -m py_compile \
  butterfly_laser_control.py \
  butterfly_laser_server.py \
  butterfly_laser_server_tauri.py \
  pa_imaging_capture.py
```

Script syntax check:

```bash
bash -n upload_pl.sh upload_debug.sh board_payload/reset_all.sh script/reset_all.sh
```

## Known Cautions

- The HTTP API is unauthenticated and should stay on a trusted lab network.
- Resetting PL while the server is actively touching mapped hardware can still
  be risky. Stop capture and use Abort & Park or `/api/stop-all` before PL
  reloads.
- This Codex terminal previously did not have GitHub credentials available;
  the user manually pushed successfully from their own terminal. If a future
  push fails with GitHub authentication errors, use the user's terminal or
  refresh `gh auth login`.
- Ignored backup files remain locally by design but are not uploaded to GitHub.
- If GitHub Actions release packaging fails, inspect the tag workflow first;
  local Linux builds already worked during packaging, but Windows/macOS builds
  depend on GitHub-hosted runners.

## Next Useful Tasks

- Watch the GitHub Actions run for `v0.1.0` and confirm release assets are
  produced.
- Decide whether to add a LICENSE file before making the repository public.
- Add code signing if Windows/macOS installers need smoother installation.
- Continue hardware-side robustness testing around PL reset, PA abort, and
  long captures.
- If adding new saved data types, extend the global data root type list,
  Settings downloads/manual, and Python examples together.
