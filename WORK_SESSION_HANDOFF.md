# Butterfly Laser Driver Work Session Handoff

Date: 2026-06-24
Branch: `feature/live-marker-tracking`
Project root: `/home/qian/Portable_System_Project/Butterfly_Laser_Driver`
Tauri GUI root: `/home/qian/Portable_System_Project/Butterfly_Laser_Driver/tauri_control_console`

## Current State

This workspace is intentionally left uncommitted and dirty. Do not reset or clean it on the next session.

For Windows/Codex continuation, also read:

```text
WINDOWS_CODEX_TAURI_GUI_AND_SERVER_GUIDE.md
```

The active work is the Butterfly Laser Driver control stack:

- Python board control/server:
  - `butterfly_laser_control.py`
  - `butterfly_laser_server.py`
  - `butterfly_laser_server_tauri.py`
  - legacy web panel: `butterfly_laser_panel.html`
- Modern Tauri GUI:
  - `tauri_control_console/src/App.tsx`
  - `tauri_control_console/src/components/*`
  - `tauri_control_console/src/utils/*`
- HDL/control context:
  - AD4170 TEC controller at `0xA0000000`
  - ADA4355 capture block at `0xA0100000`
  - ADA4355 Analog HDL core at `0xA0090000`
  - Laser current controller / lock registers around `0xA0120000`
  - Spectrum BRAM windows previously mapped around `0xA01C0000` and `0xA01D0000`

## Last Completed GUI Fixes

The latest requested fixes were:

1. Save both ADC code and converted photodiode current in exported data.
2. Fix PD monitor not refreshing in Lock view.
3. Fix incorrect Mode display when switching from ADA view back to Lock view.

Implemented state:

- CSV exports now include both raw ADC code and converted current.
  - Raw ADC CSV columns: `index,time_us,adc_code,pd_current_uA`
  - Spectrum CSV columns: `index,time_ms,adc_code,pd_current_uA,relative_intensity`
  - Recorded spectrum CSV columns include `raw_adc,pd_current_uA`
  - Lock recording CSV files include `adc_count,pd_current_uA`
- Lock recording metadata includes `ada4355_tz_ohm`.
- `Tz Ohm` is shared across Spectrum, ADA, and Lock views through `App.tsx`.
- Default `Tz Ohm` is `2000`.
- ADA4355 current conversion is centralized in `tauri_control_console/src/utils/ada4355.ts`.
- Lock page PD monitor now uses live `state.trend` samples instead of frozen pre-lock data.
- ADA page PD monitor now shows `monitor_counter` so refresh can be diagnosed.
- Tab changes now call `refreshStatus()`, so switching ADA -> Lock forces a server readback and avoids stale Mode.

## ADA4355 Conversion Assumption

Current plotting/export conversion uses:

```text
ADC code -> Vadc approximately -1 V to +1 V
Iin = (0.825 V - Vadc) / Tz
default Tz = 2000 ohm
```

This matches the ADA4355 inverse transfer-function model used during the session. If the analog front-end polarity or ADC scaling is later proven different, update only `src/utils/ada4355.ts` first.

## Lock Workflow Snapshot

The current Lock page supports two lock methods:

- Direct Lock:
  - Click the highlighted green marker.
  - GUI computes marker ADC target, CH1 bias code, and polarity.
  - It immediately posts `/api/laser/lock-start`.
- Board Match Lock:
  - Click the highlighted green marker.
  - GUI uploads marker/template/search window/polarity.
  - PL continues scanning and enters lock only when it finds a matching crossing.

Important UI behavior:

- Only the closest crossing inside the board search window should become green/selectable.
- Baseline/lock level is adjusted by the right-side handle only, to avoid accidental movement while clicking markers.
- Lock acquisition view overlays the previous full spectrum and the partial/current lock sweep.
- After lock, left plot freezes the acquisition spectra and right plot shows live PD monitor.
- Stop Locking holds the laser at the current static point.

## Settings / Persistence

The intended behavior is:

- PL reset defaults should stay conservative.
- Server startup initializes parameter registers from a local settings file if present.
- If no local settings file exists, server uses built-in defaults and creates the file.
- GUI can:
  - Save current parameters to the server settings file.
  - Load a local settings file.
  - Export a settings file through the file picker.
- Laser controls should be disabled if TEC is off.
- Server-side protection should also prevent enabling laser when TEC is off.

Check `tauri_control_console/src/utils/settings.ts`, `SettingsPanel.tsx`, and `butterfly_laser_server_tauri.py` before changing this behavior.

## Current User-Preferred Defaults

TEC:

- `Kp = 1`
- `Ki = 0.003`
- `Kd = 0`
- `Integral Limit = 300000`
- `Protection Temp Min = 20 C`
- `Temp Max = 40 C`
- `DAC Min = 1800`
- `DAC Max = 2150`

Laser:

- `Safety CH0 Max = 40000`
- `Safety CH1 Max = 40000`
- No CH1 min requirement in GUI.

Lock:

- `Kp = 0.5`
- `Ki = 0.01` was earlier used, then user requested updated defaults:
  - `CH1 Range Halfspan = 5000`
  - `Max Step = 3`
  - `Integral Limit = 500000`
  - `Locked Threshold = 1000`
  - `Loss Threshold = 10000`
  - `Board Search Halfspan = 1000`
- The exact active defaults should be confirmed in `butterfly_laser_server_tauri.py` and Settings GUI before any release.

## Data Recording Requirements

For optical experiments the user wants raw data preserved.

When `Record Lock Data` is enabled, each locking event should record as much as practical:

- Full previous/reference spectrum.
- Current/lock-sweep partial spectrum.
- Selected target marker position.
- Actual board-matched lock position if available.
- Lock target ADC.
- CH1 code and CH1 current in mA.
- ADC count and PD current in uA.
- Pre-lock and post-lock PD monitor samples.
- Temperature raw/status trend.
- Metadata including timestamp, run name, Tz Ohm, scan codes, thresholds, polarity, and lock method.

The helper plotting script is:

- `plot_lock_recording.py`

Use it to inspect saved experiment bundles under `Butterfly_Laser_Data`.

## Latest Verification

Run from:

```bash
cd /home/qian/Portable_System_Project/Butterfly_Laser_Driver/tauri_control_console
```

Fresh verification completed:

```bash
PATH=/home/qian/.local/nodejs/bin:$PATH npm test
```

Result:

```text
Test Files  16 passed (16)
Tests       64 passed (64)
```

Fresh build completed:

```bash
PATH=/home/qian/.local/nodejs/bin:$PATH npm run build
```

Result:

```text
tsc && vite build passed
59 modules transformed
```

## How To Resume Next Time

1. Check current branch and dirty files:

```bash
cd /home/qian/Portable_System_Project/Butterfly_Laser_Driver
git branch --show-current
git status --short
```

2. If using the board server, start it on the K26 board from the deployed project directory:

```bash
python butterfly_laser_server_tauri.py --host 0.0.0.0 --port 8080
```

Default GUI/backend address used in this project:

```text
http://192.168.8.236:8080
```

3. Start the Tauri GUI on the host:

```bash
cd /home/qian/Portable_System_Project/Butterfly_Laser_Driver/tauri_control_console
env -u PKG_CONFIG_PATH -u PKG_CONFIG_SYSROOT_DIR -u PKG_CONFIG_LIBDIR \
  -u CC -u CXX -u AR -u AS -u LD -u STRIP -u RANLIB -u OBJCOPY -u OBJDUMP -u READELF \
  -u CFLAGS -u CXXFLAGS -u LDFLAGS \
  PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/home/qian/.local/nodejs/bin:/home/qian/.cargo/bin \
  npm run tauri dev
```

If port `1420` is already in use, find the old process first:

```bash
ss -ltnp | grep :1420
ps -ef | grep butterfly_laser_control_console
ps -ef | grep "npm run tauri"
```

Then terminate only the stale GUI/dev processes.

4. If the GUI looks stale after code changes, refresh the Tauri window first. If it still does not update, restart Tauri.

## Files Most Relevant To The Latest Request

- `tauri_control_console/src/App.tsx`
  - Shared `Tz Ohm`
  - SSE throttling
  - periodic status sync
  - tab-change `refreshStatus()`
- `tauri_control_console/src/components/LockPanel.tsx`
  - Lock workflow
  - marker click behavior
  - PD monitor plot
  - lock recording bundle
- `tauri_control_console/src/components/AdaPanel.tsx`
  - ADA monitor display
  - raw ADC capture/export
- `tauri_control_console/src/components/SpectrumPanel.tsx`
  - current-based spectrum display/export
- `tauri_control_console/src/utils/ada4355.ts`
  - ADA4355 ADC/current conversion
- `tauri_control_console/src/utils/csv.ts`
  - raw/spectrum CSV export
- `tauri_control_console/src/utils/lockRecording.ts`
  - lock experiment CSV export
- `tauri_control_console/src/utils/spectrumRecording.ts`
  - continuous spectrum recording CSV
- `tauri_control_console/src/utils/lockSpectrum.ts`
  - crossing detection, polarity inference, search window, sliding match
- `butterfly_laser_server_tauri.py`
  - backend API, defaults, settings persistence, hardware writes

## Important Cautions

- Do not reset the worktree unless the user explicitly asks.
- Several files are untracked but required for the current GUI/tests.
- Direct Lock currently depends on GUI freshness and can lock to an older displayed spectrum point.
- Board Match Lock exists to reduce that problem by letting PL re-find a matching live crossing.
- If PD monitor freezes again, first check `monitor_counter` in ADA view and server status payload before changing UI code.
- If Mode display is wrong after switching tabs, check whether `/api/status` is returning the actual laser mode and whether `App.tsx` tab refresh is firing.
