# Tauri 2 Butterfly Laser Control Console Design

Date: 2026-06-20

## Decision

Use **Scheme B**:

- Keep the current legacy web stack intact:
  - `butterfly_laser_control.py`
  - `butterfly_laser_server.py`
  - `butterfly_laser_panel.html`
  - `legacy_web_gui_2026-06-20/`
- Add a new Tauri-oriented Python server:
  - `butterfly_laser_server_tauri.py`
- Add a new Tauri 2 desktop GUI:
  - `tauri_control_console/`

The Tauri GUI runs on a PC and connects to the K26 board over the network. The default backend URL is:

```text
http://192.168.8.236:8080
```

The PL remains responsible for all high-speed and safety-critical behavior. The GUI configures, monitors, and sends explicit control commands only.

## Architecture

```text
PC / laptop
  Tauri 2 GUI
    HTTP commands  --------------------+
    SSE telemetry stream  <------------+
                                        |
K26 board                               |
  butterfly_laser_server_tauri.py       |
    HTTP API                            |
    /api/events SSE                     |
    uses butterfly_laser_control.py     |
                                        |
  PL AXI IPs                            |
    AD4170 TEC control                  |
    ADA4355 capture / spectrum          |
    Laser current control / lock        |
```

## Scope

### In Scope

- Modern desktop GUI for Windows and Linux.
- Reuse existing Python register-control layer.
- New SSE endpoint for real-time updates.
- Control and monitor:
  - TEC temperature loop.
  - TEC PID and protection parameters.
  - Laser static output.
  - Fine scan.
  - ADA4355 photodiode monitor.
  - Spectrum display and CSV export.
  - Raw ADC snapshot display and CSV export.
  - Side-fringe locking.
  - Settings save/load/apply.
  - Raw register debug access.
- Preserve current browser GUI as a fallback.

### Out of Scope for First Version

- Rewriting direct `/dev/mem` hardware access in Rust.
- Removing or replacing the existing Python server.
- Authentication/user management.
- Network discovery of multiple boards.
- Hard real-time control from the GUI.

## Backend Design

### File

```text
butterfly_laser_server_tauri.py
```

This server should import and reuse:

```python
from butterfly_laser_control import ButterflyLaserSystem
```

It should keep the existing HTTP endpoints compatible where practical, while adding:

```text
GET /api/events
```

### HTTP Commands

HTTP remains responsible for command/response operations:

- `/api/status`
- `/api/settings`
- `/api/registers`
- `/api/read`
- `/api/tec/start`
- `/api/tec/target`
- `/api/tec/open-loop`
- `/api/tec/pid`
- `/api/tec/protection`
- `/api/tec/stop`
- `/api/tec/clear-fault`
- `/api/laser/static`
- `/api/laser/on`
- `/api/laser/off`
- `/api/laser/static-setpoint`
- `/api/laser/fine-scan`
- `/api/laser/stop-scan`
- `/api/laser/stop`
- `/api/laser/lock-start`
- `/api/laser/lock-hold`
- `/api/laser/lock-clear`
- `/api/laser/protection`
- `/api/laser/estop`
- `/api/laser/clear-fault`
- `/api/ada/start`
- `/api/ada/status`
- `/api/ada/spectrum`
- `/api/ada/raw`
- `/api/ada/stop`
- `/api/ada/clear`
- `/api/ada/monitor-rate`
- `/api/ada/capture-config`
- `/api/ada/filter`
- `/api/ada/raw-capture`
- `/api/settings/apply`
- `/api/write`
- `/api/stop-all`

### SSE Events

The SSE stream sends newline-delimited events using `text/event-stream`.

Recommended event types:

```text
status
spectrum
raw
fault
heartbeat
```

#### `status`

Rate: default 10 Hz.

Payload:

```json
{
  "timestamp": 1782000000.0,
  "status": {
    "tec": {},
    "laser": {},
    "ada4355": {}
  }
}
```

The `status` object should use the same structure currently returned by `/api/status`.

#### `spectrum`

Sent only when the latest spectrum frame changes.

Detection key:

```text
frame_counter + buffer_id + count
```

Payload:

```json
{
  "timestamp": 1782000000.0,
  "spectrum": {}
}
```

The `spectrum` object should use the same structure currently returned by `/api/ada/spectrum`.

#### `raw`

Sent when a raw snapshot capture completes through the HTTP command path. First version can also return raw data directly through the command response; SSE raw event is optional if command response is sufficient.

#### `fault`

Sent immediately when fault summary changes. This can be implemented by comparing the previous status bitfields against the current status bitfields during the status polling loop.

#### `heartbeat`

Rate: every 2 seconds if no other event is sent.

Payload:

```json
{
  "timestamp": 1782000000.0
}
```

### Backend Concurrency

- Keep one shared `ButterflyLaserSystem`.
- Keep a server-level lock for hardware access.
- SSE clients must not block control commands.
- Slow spectrum reads should be bounded by requested max points.
- On exceptions inside SSE loop, send an `error` event if possible and close the stream cleanly.

## Tauri GUI Design

### Directory

```text
tauri_control_console/
```

### Suggested Stack

- Tauri 2.
- TypeScript.
- React + Vite.
- Canvas-based custom plots for first version.

Reasoning:

- React/TypeScript gives maintainable UI state and typed API models.
- Canvas plots avoid a large plotting dependency in first version.
- The existing HTML already proves the plotting requirements are not beyond custom canvas.

### App Sections

#### Overview

Purpose: read-only system health and fast actions.

Content:

- Connection state.
- Backend URL.
- TEC temperature, target, error.
- TEC status and fault bits.
- Laser output mode.
- Laser actual/target currents.
- PD monitor ADC code.
- Latest spectrum frame summary.
- Lock status.
- Emergency stop button.
- Quick TEC target and laser static setpoint.

#### TEC

Purpose: configure and monitor TEC loop.

Content:

- Start closed loop.
- Set target.
- Open-loop DAC mode.
- Stop TEC.
- Clear TEC fault.
- PID parameters:
  - KP
  - KI
  - KD
  - Integral Limit
  - Max Step
  - DAC Bias/Min/Max/Safe
- Protection:
  - Temp Min
  - Temp Max
  - Filter Alpha
  - RDY Timeout
  - SPI Clock Div
- Live temperature trend.

#### Laser

Purpose: control laser output and scan.

Content:

- Laser On.
- Laser Off.
- Emergency Stop.
- Clear fault.
- Static setpoint:
  - CH0 static code
  - CH1 static code
- Fine scan:
  - CH0 code
  - CH1 start/stop/step
  - dwell ticks
  - settle ticks
  - frames
  - continuous scan
  - start scan
  - stop scan / hold start
- Protection:
  - CH0 min/max
  - CH1 min/max
  - soft step
  - ramp interval
  - DAC timeout
  - watchdog timeout
  - enable delay
  - current limit

#### Spectrum

Purpose: inspect live photodiode spectrum and choose lock point.

Content:

- Live spectrum plot.
- Relative intensity only by default.
- X-axis:
  - index
  - time
  - CH0 current
  - CH1 current start/stop
- Click point to populate lock target:
  - target ADC
  - CH1 bias
  - polarity estimate from local slope
- Export spectrum CSV.
- Raw ADC snapshot plot and CSV export.

#### Side-Fringe Lock

Purpose: configure and start laser lock.

Content:

- Target ADC code.
- CH0 coarse code.
- CH1 bias code.
- CH1 range half-span.
- CH1 min/max lock range.
- KP default `0.5`.
- KI default `0.01`.
- Max Step default `10`.
- Polarity invert.
- Locked threshold.
- Loss threshold.
- Locked count.
- Loss count.
- Start Lock.
- Hold Current.
- Clear Lock Lost.

The GUI should show that the lock loop is PL-driven. It should not imply that the desktop app is closing the loop.

#### Settings

Purpose: persistent profiles.

Content:

- Current settings file path returned by server.
- Load settings.
- Save settings.
- Apply saved settings.
- Export settings JSON.
- Import settings JSON in a later version.

#### Debug

Purpose: low-level diagnostics.

Content:

- Raw register read/write:
  - block: `tec`, `laser`, `ada`
  - offset
  - value
- Dump registers.
- Last JSON event view.
- Last command response view.

## Frontend Data Flow

```text
App startup:
  Load saved backend URL from local storage.
  Connect EventSource to /api/events.
  Fetch /api/settings once.
  Populate fields from settings.

SSE status event:
  Update read-only cards.
  Append trend samples.
  Update fault banners.

SSE spectrum event:
  Replace latest spectrum data.
  Redraw spectrum.

Command button:
  Validate form values.
  POST command to backend.
  Show command result.
  Let SSE update the live readback.
```

## Safety UX

- Emergency Stop should be always visible.
- Laser On/Scan/Lock should require valid protection ranges.
- Lock start should show current target ADC, bias, and range before sending.
- Fault state should be visually obvious and persistent until cleared.
- Stop/hold actions should use clear labels:
  - `Laser Off`
  - `Emergency Stop`
  - `Stop Scan / Hold Start`
  - `Hold Current`

## Error Handling

Frontend:

- If EventSource disconnects, show disconnected state and retry automatically.
- If HTTP command fails, show error response verbatim in command log.
- If backend URL changes, close existing EventSource and reconnect.
- Keep last good status visible but mark it stale after timeout.

Backend:

- Return JSON errors for bad HTTP commands.
- SSE loop should continue after transient read errors where possible.
- Fatal exceptions in SSE should emit an `error` event before closing.

## Testing And Verification

### Python

- Unit tests for settings migration and default values.
- Syntax check:

```sh
python3 -m py_compile butterfly_laser_control.py butterfly_laser_server_tauri.py
```

### Tauri Frontend

- TypeScript build.
- UI smoke test with a mocked SSE stream.
- API client unit tests using fixture payloads from current `/api/status`.

### Hardware Smoke Test

On the board:

```sh
python3 butterfly_laser_server_tauri.py --host 0.0.0.0 --port 8080
```

From PC:

- Connect GUI to `http://192.168.8.236:8080`.
- Verify live status events.
- Verify TEC start/target.
- Verify laser static output.
- Verify fine scan and live spectrum update.
- Verify click-to-lock fills lock fields.
- Verify lock start/hold/clear.
- Verify emergency stop.

## Environment Requirements

Current development environment does not have:

```text
node
npm
cargo
rustc
```

Before implementation/building Tauri:

- Install Node.js LTS.
- Install Rust stable.
- Install Tauri 2 prerequisites.
- Install Tauri CLI or use project-local npm scripts.

## Open Implementation Notes

- Use `EventSource` first; do not use WebSocket in version 1.
- Keep control commands over HTTP.
- Keep `butterfly_laser_server.py` and `butterfly_laser_panel.html` unchanged.
- Put all new GUI work under `tauri_control_console/`.
- Put new server work in `butterfly_laser_server_tauri.py`.
