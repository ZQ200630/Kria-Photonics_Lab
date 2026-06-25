# Windows Codex Handoff: Butterfly Laser Tauri GUI And Server Guide

Date: 2026-06-24
Project root on Linux host: `/home/qian/Portable_System_Project/Butterfly_Laser_Driver`
Main GUI folder: `tauri_control_console`
Board/server default URL: `http://192.168.8.236:8080`

This document is the portable handoff file for continuing the Butterfly Laser Driver GUI/server work from Windows Codex. If this folder is copied to Windows, start here.

## What This Folder Contains

The project has three layers:

| Layer | Runs On | Files | Purpose |
|---|---|---|---|
| PL/FPGA bitstream | K26 PL | Vivado-generated bitstream outside this folder | TEC PID, laser current, ADA4355 capture, spectrum BRAM |
| Python hardware server | K26 Linux PS | `butterfly_laser_control.py`, `butterfly_laser_server.py`, `butterfly_laser_server_tauri.py` | `/dev/mem` register access, HTTP API, SSE live status/spectrum |
| Tauri GUI | PC/Windows/Linux | `tauri_control_console/*` | Modern desktop control/monitor GUI |

The Windows machine normally runs only the Tauri GUI. The Python server should run on the K26 board because it accesses `/dev/mem` and FPGA AXI registers.

## Current Branch And Session State

Current active branch when this was written:

```text
feature/live-marker-tracking
```

The working tree is intentionally dirty and contains many accumulated changes. Do not reset it unless the user explicitly asks. Also read:

```text
WORK_SESSION_HANDOFF.md
```

That file records the last live coding session and the latest verified changes.

## Fixed Hardware Addresses

These are fixed by the Vivado address map used during development.

```text
TEC / AD4170 controller:          0xA0000000
ADA4355 capture controller:       0xA0100000
Laser current controller:         0xA0120000
ADA4355 spectrum buffer 0 BRAM:   0xA01C0000
ADA4355 spectrum buffer 1 BRAM:   0xA01D0000
ADA4355 Analog HDL core:          0xA0090000
```

The Tauri GUI does not directly access these addresses. It talks to the board-side Python server.

## Windows Prerequisites

Install these on Windows before running `tauri_control_console`.

1. Git
2. Node.js LTS
3. Rust with MSVC toolchain
4. Microsoft C++ Build Tools with **Desktop development with C++**
5. Microsoft Edge WebView2 Runtime if your Windows installation does not already include it

Official Tauri v2 prerequisite notes:

- Tauri requires Microsoft C++ Build Tools and WebView2 on Windows.
- Tauri v2 docs say WebView2 is already installed on Windows 10 version 1803 and later.
- Tauri requires Rust for development.
- For Tauri on Windows, the Rust default host triple should be MSVC, for example `x86_64-pc-windows-msvc`.
- Node.js LTS is needed because this GUI uses a React/Vite frontend.

Useful PowerShell checks:

```powershell
git --version
node -v
npm -v
rustc -V
cargo -V
rustup show
```

Set Rust to MSVC if needed:

```powershell
rustup default stable-msvc
```

## Windows First Run

Open PowerShell in the copied project folder:

```powershell
cd path\to\Butterfly_Laser_Driver\tauri_control_console
npm ci
npm test
npm run build
npm run tauri dev
```

Expected:

- `npm test` should run Vitest frontend/unit tests.
- `npm run build` should run TypeScript and Vite build.
- `npm run tauri dev` should open the desktop GUI window.

The GUI default backend is:

```text
http://192.168.8.236:8080
```

This is defined in:

```text
tauri_control_console/src/api/client.ts
```

You can also edit the URL in the GUI connection field and click Connect.

## If Tauri Port Is Already In Use On Windows

Tauri dev uses Vite at `127.0.0.1:1420`.

Find the process:

```powershell
netstat -ano | findstr :1420
```

Kill a stale process:

```powershell
taskkill /PID <pid> /F
```

Then rerun:

```powershell
npm run tauri dev
```

## Board Server Start

Run this on the K26 board, in the folder containing the Python files:

```sh
python3 butterfly_laser_server_tauri.py --host 0.0.0.0 --port 8080
```

If root is required for `/dev/mem`, run as root or with appropriate privileges.

Typical board folder used during development:

```text
/run/media/sdb1/PL
```

Stop a stale server:

```sh
ps -ef | grep butterfly_laser_server
kill <pid>
```

If the server reports `Address already in use`, another process is still listening on port `8080`.

## Deploy Server Files To Board

From the PC/Linux host, copy these files to the board folder:

```sh
scp butterfly_laser_control.py butterfly_laser_server.py butterfly_laser_server_tauri.py analog@192.168.8.236:/run/media/sdb1/PL/
```

Then SSH to the board and start the server.

Do not deploy only one Python file after changing APIs. The server imports common logic from `butterfly_laser_control.py` and `butterfly_laser_server.py`.

## Tauri GUI Architecture

Frontend stack:

```text
React 18
TypeScript
Vite
Vitest
Tauri 2
```

Rust/Tauri side:

```text
tauri_control_console/src-tauri/src/main.rs
```

Rust does not control hardware. It only provides native desktop file operations:

- `save_text_file`
- `open_text_file`
- `choose_data_directory`
- `save_experiment_bundle`

Frontend state:

```text
tauri_control_console/src/state/store.ts
```

Main app shell:

```text
tauri_control_console/src/App.tsx
```

HTTP client:

```text
tauri_control_console/src/api/client.ts
```

SSE stream:

```text
tauri_control_console/src/api/events.ts
```

Types:

```text
tauri_control_console/src/api/types.ts
```

## GUI Tabs

### Overview

High-level experiment dashboard. It shows compact TEC, laser, spectrum, and ADA monitor information. It should stay clean and avoid debug-only controls.

### TEC

Controls and monitors the AD4170/TEC loop.

Important design decisions:

- TEC On/Off is a single stateful button.
- Open-loop DAC is treated as debug-level functionality, not normal operation.
- Update Parameters writes target, PID, DAC limits, protection, and ramp configuration.
- TEC Off should still allow temperature monitoring.
- Temperature ramping is supported to avoid overshoot when changing target temperature.
- Laser controls are disabled if TEC is off.

Relevant files:

```text
tauri_control_console/src/components/TecPanel.tsx
tauri_control_console/src/utils/tec.ts
tauri_control_console/src/utils/tecRamp.ts
```

### Laser

Controls laser current mode.

Modes:

- Off
- Static Output
- Scanning
- Locking
- Fault

Important design decisions:

- Static and Scanning are user-selectable.
- Locking is normally entered from the Lock page, not manually selected in Laser details.
- When entering Static, scanning should stop.
- Scanning is continuous by default.
- Scan rate is computed from dwell/settle timing.
- Laser cannot be enabled if TEC is not enabled.

Relevant files:

```text
tauri_control_console/src/components/LaserPanel.tsx
tauri_control_console/src/utils/laser.ts
```

### Lock

Side-fringe locking workflow.

Important functions:

- Start spectrum monitoring: enters laser scan mode.
- Stop monitoring: returns laser to static mode.
- Adjust target temperature and scan parameters from the Lock page.
- Show spectrum in input-current units with ADC code as the right axis.
- Draw a draggable horizontal lock level.
- Generate crossing markers only within the configured search window.
- Highlight the closest crossing inside the search window in green.
- Clicking the highlighted marker starts lock immediately.

Two lock methods:

1. Direct Lock
   - GUI computes target ADC, CH1 bias code, and polarity from the displayed marker.
   - It immediately posts `/api/laser/lock-start`.
   - Fast and simple, but depends on how fresh the displayed spectrum is.

2. Board Match Lock
   - GUI sends marker code window and polarity to PL.
   - PL keeps scanning until it sees a matching live crossing.
   - It switches from scan to lock in hardware, reducing delay-related lock misses.

Relevant files:

```text
tauri_control_console/src/components/LockPanel.tsx
tauri_control_console/src/utils/lockSpectrum.ts
tauri_control_console/src/utils/acquireTemplate.ts
tauri_control_console/src/utils/lockRecording.ts
```

### ADA

Photodiode and ADA4355 monitor/capture page.

Current display behavior:

- PD Monitor shows ADC code, min, max, and `monitor_counter`.
- Spectrum and raw ADC can be plotted in input-current units.
- `Tz Ohm` defaults to `2000`.
- Raw ADC capture supports y-axis limit controls.

Relevant files:

```text
tauri_control_console/src/components/AdaPanel.tsx
tauri_control_console/src/utils/ada4355.ts
tauri_control_console/src/utils/csv.ts
```

### Settings

Settings persistence UI.

Expected behavior:

- Server initializes PL parameters from a local JSON settings file if present.
- If no settings file exists, the server uses built-in defaults and creates one.
- GUI can save current parameters to the server settings file.
- GUI can load a local JSON settings file and send it to the server.
- GUI can export a settings file via native file picker.

Relevant files:

```text
tauri_control_console/src/components/SettingsPanel.tsx
tauri_control_console/src/utils/settings.ts
butterfly_laser_server.py
```

### Debug

Raw register read/write/debug. Use this for low-level validation only.

## Data Flow

Normal live update path:

```text
PL AXI registers
  -> board Python server status/spectrum readers
  -> /api/status and /api/events SSE
  -> Tauri ApiClient / BackendEventStream
  -> App reducer
  -> panels and plots
```

Tauri app throttles rendering:

- Status events are buffered and rendered at a controlled interval.
- Spectrum events are buffered and rendered separately.

This avoids white-screen or lag when SSE update rate is high.

## Server API Summary

Important GET endpoints:

```text
GET /api/status
GET /api/settings
GET /api/registers
GET /api/ada/status
GET /api/ada/spectrum?points=16384&release=true
GET /api/ada/raw?count=N
GET /api/read?block=tec|laser|ada&offset=0xXX
GET /api/events
```

Important POST endpoints:

```text
POST /api/tec/start
POST /api/tec/target
POST /api/tec/ramp-target
POST /api/tec/ramp
POST /api/tec/ramp-stop
POST /api/tec/pid
POST /api/tec/protection
POST /api/tec/stop

POST /api/laser/on
POST /api/laser/off
POST /api/laser/static
POST /api/laser/static-setpoint
POST /api/laser/fine-scan
POST /api/laser/stop-scan
POST /api/laser/lock-start
POST /api/laser/lock-params
POST /api/laser/lock-hold
POST /api/laser/acquire-template
POST /api/laser/acquire-arm
POST /api/laser/acquire-cancel
POST /api/laser/protection

POST /api/ada/start
POST /api/ada/stop
POST /api/ada/monitor-rate
POST /api/ada/capture-config
POST /api/ada/filter
POST /api/ada/raw-capture

POST /api/settings
POST /api/settings/apply
POST /api/write
POST /api/stop-all
```

Tauri SSE server-specific endpoint:

```text
GET /api/events
```

This emits:

```text
status
spectrum
fault
heartbeat
error
```

## Server Defaults

The built-in settings are in:

```text
butterfly_laser_server.py
```

Current important defaults:

TEC:

```text
target_celsius = 31.0
kp = 1
ki = 0.003
kd = 0
integral_limit = 300000
dac_min = 1800
dac_max = 2150
temp_min_celsius = 20.0
temp_max_celsius = 40.0
ramp_enabled = true
ramp_rate_c_per_s = 0.05
```

Laser:

```text
static ch0 = 5000
static ch1 = 0
fine_scan ch0 = 26000
fine_scan start = 20000
fine_scan stop = 30000
fine_scan dwell = 100
fine_scan settle = 100
safety ch0_max = 40000
safety ch1_max = 40000
```

Lock:

```text
target_adc = 42000
bias_ch1 = 25000
range_halfspan = 5000
kp = 0.5
ki = 0.01
integral_limit = 500000
max_step = 3
locked_threshold = 1000
loss_threshold = 10000
```

ADA4355:

```text
monitor_rate_hz = 100000
max_points = 16384
raw_length = 16384
raw_decim = 1
frame_decim = 1000
filter_control = 0x19
glitch_threshold = 3000
lp_shift = 13
```

## ADA4355 Current Conversion

The GUI plots and exports photodiode signal in ADA4355 input current units.

Current assumption:

```text
ADC code -> Vadc approximately -1 V to +1 V
Iin = (0.825 V - Vadc) / Tz
default Tz = 2000 ohm
```

Implementation:

```text
tauri_control_console/src/utils/ada4355.ts
```

If the analog front-end polarity or voltage scaling is corrected later, update that file first. All plots and CSV exports should follow automatically.

## CSV And Experiment Recording

Single exports use native file picker in Tauri.

Default experiment bundle location:

```text
~/Butterfly_Laser_Data
```

On Windows this resolves under the Windows user home directory unless a different directory is selected in the GUI.

Spectrum CSV includes:

```text
index,time_ms,adc_code,pd_current_uA,relative_intensity
```

Raw ADC CSV includes:

```text
index,time_us,adc_code,pd_current_uA
```

Lock recording bundle should preserve:

- Full reference spectrum
- Partial/current lock sweep
- ADC code
- PD current in uA
- CH1 code
- CH1 current in mA
- target marker and actual lock position when available
- pre/post-lock PD monitor trend
- TEC temperature trend
- lock status trend
- metadata JSON

Plot saved lock recordings with:

```sh
python3 plot_lock_recording.py <path-to-lock-event-folder>
```

On Windows:

```powershell
python plot_lock_recording.py path\to\lock-event-folder
```

Install plotting dependencies if needed:

```powershell
pip install matplotlib pandas
```

## Typical Experiment Operation

1. Load the correct PL bitstream on the board.
2. Start the board server:

```sh
python3 butterfly_laser_server_tauri.py --host 0.0.0.0 --port 8080
```

3. Start Tauri GUI on PC:

```powershell
cd path\to\Butterfly_Laser_Driver\tauri_control_console
npm run tauri dev
```

4. Connect to:

```text
http://192.168.8.236:8080
```

5. Turn TEC on and wait for stable temperature.
6. Enable laser static or scan.
7. Use Lock page:
   - Start monitoring/scanning.
   - Adjust target temperature and scan parameters.
   - Choose Direct Lock or Board Match Lock.
   - Drag lock level.
   - Click the green marker.
8. If recording is enabled, inspect data under `Butterfly_Laser_Data`.

## Safety Rules In The Software

Current intended behavior:

- Laser cannot turn on if TEC is off.
- GUI disables laser controls when TEC is off.
- Server also rejects laser enable/start requests if TEC is not enabled.
- Stop TEC also stops laser.
- `Stop All` stops laser and TEC.

Do not rely only on GUI safety for laser protection. Hardware interlocks and current limits remain necessary.

## Development Workflow On Windows

After editing frontend code:

```powershell
cd tauri_control_console
npm test
npm run build
```

For live GUI development:

```powershell
npm run tauri dev
```

If only frontend browser behavior is needed:

```powershell
npm run dev
```

Then open Vite URL in a browser. Browser mode uses download fallbacks instead of native Tauri file dialogs.

Before claiming a fix is complete, run:

```powershell
npm test
npm run build
```

## Python Server Development Notes

The board server is split this way:

```text
butterfly_laser_control.py
  Low-level register classes and CLI helpers.

butterfly_laser_server.py
  Main HTTP API, settings defaults, settings persistence, safety checks.

butterfly_laser_server_tauri.py
  SSE extension for Tauri GUI.
```

If an API payload changes, check all three places:

```text
server endpoint implementation
tauri_control_console/src/api/client.ts
tauri_control_console/src/api/types.ts
component that calls it
```

Useful server smoke checks from a PC:

```powershell
curl http://192.168.8.236:8080/api/status
curl http://192.168.8.236:8080/api/settings
curl "http://192.168.8.236:8080/api/ada/spectrum?points=16&release=true"
```

## Common Problems

### GUI Connect Does Nothing

Check:

```powershell
curl http://192.168.8.236:8080/api/status
```

If that fails:

- server is not running
- board IP changed
- firewall/network issue
- port `8080` blocked or occupied

### Tauri Window Is Blank

Check the dev terminal output first.

Common causes:

- Vite failed to start
- port `1420` is occupied
- TypeScript build error
- stale Tauri process

Run:

```powershell
npm test
npm run build
netstat -ano | findstr :1420
```

### Server Ctrl-C Does Not Stop

The Tauri server has SIGINT/SIGTERM handling. If terminal Ctrl-C still fails, kill the process:

```sh
ps -ef | grep butterfly_laser_server
kill <pid>
```

### PD Monitor Does Not Refresh

Check the ADA panel:

```text
PD Monitor ADC Code
min / max / count
```

If `count` increments but ADC code does not change, the GUI is refreshing and the input is flat or filtered.

If `count` does not increment:

- check PL ADA capture is started
- check server `/api/status`
- check ADA base address and bitstream version

### Mode Is Wrong After Switching Tabs

`App.tsx` now forces `refreshStatus()` on tab changes. If the mode is still wrong:

1. Check `/api/status` directly.
2. Confirm server reports the actual mode.
3. If server is correct but GUI is wrong, inspect `tauri_control_console/src/state/store.ts` and panel mode classification.

### CSV Export Does Nothing

In Tauri mode, CSV export opens a native save dialog. It may appear behind the main window. In browser/Vite mode, it falls back to browser download.

Relevant files:

```text
tauri_control_console/src/utils/saveText.ts
tauri_control_console/src-tauri/src/main.rs
```

## Files To Read First In A New Codex Session

Start with:

```text
WORK_SESSION_HANDOFF.md
WINDOWS_CODEX_TAURI_GUI_AND_SERVER_GUIDE.md
```

Then read these depending on the task:

GUI shell:

```text
tauri_control_console/src/App.tsx
tauri_control_console/src/state/store.ts
tauri_control_console/src/api/client.ts
tauri_control_console/src/api/events.ts
```

Plots:

```text
tauri_control_console/src/components/PlotCanvas.tsx
tauri_control_console/src/utils/lockSpectrum.ts
tauri_control_console/src/utils/ada4355.ts
```

Lock workflow:

```text
tauri_control_console/src/components/LockPanel.tsx
tauri_control_console/src/utils/acquireTemplate.ts
tauri_control_console/src/utils/lockRecording.ts
```

TEC:

```text
tauri_control_console/src/components/TecPanel.tsx
tauri_control_console/src/utils/tec.ts
```

Laser:

```text
tauri_control_console/src/components/LaserPanel.tsx
tauri_control_console/src/utils/laser.ts
```

Server:

```text
butterfly_laser_control.py
butterfly_laser_server.py
butterfly_laser_server_tauri.py
```

## Current Verification Baseline

Last verified on Linux host:

```sh
cd /home/qian/Portable_System_Project/Butterfly_Laser_Driver/tauri_control_console
PATH=/home/qian/.local/nodejs/bin:$PATH npm test
PATH=/home/qian/.local/nodejs/bin:$PATH npm run build
```

Result:

```text
Vitest: 16 files passed, 64 tests passed
Build: tsc && vite build passed
```

On Windows, rerun:

```powershell
npm test
npm run build
```

The first run may take longer because Rust and npm dependencies need to be installed.

## External References

Official Tauri v2 prerequisites:

```text
https://v2.tauri.app/start/prerequisites/
```

Official ADA4355 datasheet used for current-conversion context:

```text
https://www.analog.com/media/en/technical-documentation/data-sheets/ada4355.pdf
```

