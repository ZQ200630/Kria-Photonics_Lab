# PA Scheduler Modes Design

Date: 2026-06-28

## Context

`axi_pam_image_acq` is currently a mostly fixed auto-scan scheduler. The
server writes scan parameters through AXI-Lite, raises `start`, and the HDL
walks through X/Y pixels, waits for galvo settling, emits laser and ADC
triggers, and generates metadata for the PA frame stream.

The current register window already has 64 32-bit registers from `0x00` to
`0xFC`. The legacy auto-scan configuration uses `0x00` to `0x3C`, and debug
readback starts at `0x80`. This leaves `0x40` to `0x7C` available for new
scheduler configuration while keeping existing server and UI compatibility.

The user wants this IP to become the central PA experiment scheduler, not only
an auto image scan controller. Pure galvo/laser-control modes must work even
when `axis_capture_superblock`, TCP receiver, or host storage are not running.
Because HDL rebuilds are expensive, this iteration should provision the bottom
layer broadly enough that future experiment modes can usually be added in
server/Tauri without changing the bitstream again.

## Goals

- Preserve the existing auto-scan capture behavior and legacy register map.
- Add explicit scheduler modes with common command, status, fault, and counter
  semantics.
- Add enough AXI fields for server/Tauri to know the active mode, current
  state, current galvo position, current indices, counters, capture gating, and
  fault reason.
- Support capture modes that coordinate with `overall_busy_pl` and non-capture
  modes that ignore the capture chain.
- Support manual galvo hold, continuous point capture, manual laser pulse
  without capture, and basic generated galvo waveforms in HDL.
- Keep the external BD wiring stable: same `galvo_x`, `galvo_y`,
  `laser_trigger`, `adc_trigger`, `meta_data`, `meta_valid`, and status via
  AXI-Lite.
- Design server and Tauri around one shared PA scheduler abstraction instead
  of mode-specific one-off endpoints.

## Non-Goals

- Do not change `frame_capture_axis` payload format or the legacy PA frame
  binary format in this scheduler change.
- Do not redesign the DMA/superblock buffering model here.
- Do not add a BRAM/URAM arbitrary waveform table in this iteration. The HDL
  will support reusable generated waveforms: hold, ramp, triangle, and square
  step. A true arbitrary waveform playback engine would be a separate memory
  interface decision.

## Recommended Architecture

Implement `axi_pam_image_acq` as a PA scheduler with clear internal engines:

- `register_bank`: AXI-Lite registers, read-only status muxes, write-one-pulse
  command decoding, and legacy register compatibility.
- `mode_controller`: the top scheduler FSM. It selects auto scan, continuous
  point, manual hold, manual pulse, or waveform behavior.
- `galvo_engine`: owns `galvo_x` and `galvo_y`. It can hold manual coordinates,
  follow the existing scan path, or generate simple waveforms.
- `pulse_engine`: owns virtual frame/pulse timing, laser delay/width, optional
  ADC trigger delay/width, period counting, and shot limits.
- `capture_gate`: emits ADC trigger and metadata only when capture is enabled.
  It respects downstream busy only in capture modes.
- `fault_counter_bank`: latches faults and exposes counters for rejected
  commands, downstream stalls, timeouts, accepted shots, completed frames,
  manual updates, waveform cycles, stops, and parks.

The implementation can be one Verilog file or multiple small modules. The
behavioral boundary above matters more than physical file layout.

## Scheduler Modes

Mode values are stable API values:

| Mode | Name | Capture chain required | Behavior |
| --- | --- | --- | --- |
| `0` | `IDLE` | No | Park/hold outputs, no triggers. |
| `1` | `AUTO_SCAN_CAPTURE` | Yes | Existing X/Y/frame image scan with metadata and ADC trigger. |
| `2` | `CONTINUOUS_POINT_CAPTURE` | Yes | Hold manual X/Y, repeatedly trigger laser and ADC at a configurable period, stream frames until stopped or shot limit reached. Manual X/Y updates are applied at a frame boundary. |
| `3` | `MANUAL_GALVO_HOLD` | No | Apply manual X/Y and emit no laser/ADC trigger. |
| `4` | `MANUAL_PULSE_NO_CAPTURE` | No | Hold manual X/Y and emit laser pulses, either single-shot or periodic. No ADC trigger or metadata. |
| `5` | `GALVO_WAVEFORM_NO_CAPTURE` | No | Generate galvo hold/ramp/triangle/square movement and optional laser pulses. No ADC trigger or metadata. |
| `6` | `GALVO_WAVEFORM_CAPTURE` | Yes | Same waveform engine with ADC trigger and metadata enabled. The server may hide this initially, but the HDL path should exist. |
| `7` | `RESERVED_EXTERNAL_TRIGGER_CAPTURE` | Yes | Reserved value. Reads as supported only if implemented later. |

The key design rule is that capture is an explicit capability of a mode, not a
global assumption. Non-capture modes must keep working while the host receiver
is disconnected.

## Command Semantics

New modes use a write-one-pulse command register. The legacy `start` register
at `0x00` remains supported for old auto-scan code:

- Writing `1` to legacy `0x00[0]` maps to `START` with mode
  `AUTO_SCAN_CAPTURE`.
- Writing `0` to legacy `0x00[0]` maps to `ABORT_AND_PARK` for the active
  legacy-compatible scan.

New command bits:

- bit `0`, `START`: latch relevant config and enter the selected mode.
- bit `1`, `STOP`: graceful stop. Do not start a new pulse/frame. Finish the current
  safe boundary, then park.
- bit `2`, `ABORT_AND_PARK`: immediately force `laser_trigger=0`, `adc_trigger=0`,
  `meta_valid=0`, stop the FSM, and park.
- bit `3`, `CLEAR_FAULT`: clear latched fault and per-run counters that are marked
  clearable.
- bit `4`, `APPLY_MANUAL`: apply manual X/Y immediately in idle/manual modes, or at the
  next frame boundary in continuous capture.
- bit `5`, `SINGLE_PULSE`: emit one laser pulse using manual X/Y and configured pulse
  timing without entering a continuous loop.
- bit `6`, `SOFT_RESET_FSM`: reset internal scheduler state while preserving writable
  configuration registers.

`ABORT_AND_PARK` is the command used by Tauri's global emergency/stop action
before server resets PL or reloads the overlay.

## Register Map

Legacy registers remain unchanged:

| Offset | Meaning |
| --- | --- |
| `0x00` | Legacy start level. |
| `0x04` to `0x3C` | Existing auto-scan fields: X/Y start/step/points, frame number, task id, gap, settle, LD delay, ADC delay, LD width, scan mode, return mode. |

New scheduler writable registers:

| Offset | Name | Meaning |
| --- | --- | --- |
| `0x40` | `SCHED_MODE` | Mode value from the mode table. |
| `0x44` | `SCHED_COMMAND` | Write-one-pulse command bits. Reads as zero. |
| `0x48` | `SCHED_CONTROL` | Flags: `ld_enable`, `adc_enable`, `capture_enable`, `respect_downstream_busy`, `loop_enable`, `manual_live_update`, `park_mode`. |
| `0x4C` | `SCHED_PERIOD_CYCLES` | Period between virtual pulses/frames in scheduler clock cycles. `0` coerces to `1`. |
| `0x50` | `MANUAL_X` | Signed 16-bit manual X, sign-extended on readback. |
| `0x54` | `MANUAL_Y` | Signed 16-bit manual Y, sign-extended on readback. |
| `0x58` | `SHOT_LIMIT` | `0` means run until stopped. Nonzero stops after this many accepted scheduler shots. |
| `0x5C` | `PULSE_PHASE_CYCLES` | Optional phase offset before a periodic pulse slot starts. |
| `0x60` | `LD_DELAY_CYCLES` | Laser trigger delay inside one pulse slot. |
| `0x64` | `LD_WIDTH_CYCLES` | Laser trigger width. |
| `0x68` | `ADC_DELAY_CYCLES` | ADC trigger delay inside one pulse slot. |
| `0x6C` | `ADC_WIDTH_CYCLES` | ADC trigger width. Default `1`; current downstream only needs a pulse. |
| `0x70` | `WAVEFORM_CONTROL` | Per-axis waveform shape and enable bits. |
| `0x74` | `WAVEFORM_X_RANGE` | Packed signed 16-bit `{x_max, x_min}`. |
| `0x78` | `WAVEFORM_Y_RANGE` | Packed signed 16-bit `{y_max, y_min}`. |
| `0x7C` | `WAVEFORM_STEP_XY` | Packed signed 16-bit `{y_step, x_step}` per waveform tick. |

Existing debug registers from `0x80` to `0xB4` keep their current meaning.
Extended read-only status uses the remaining window:

| Offset | Name | Meaning |
| --- | --- | --- |
| `0xB8` | `SCHED_VERSION` | Version and capability bits. |
| `0xBC` | `SCHED_STATE` | Active mode, FSM state, and high-level flags. |
| `0xC0` | `CURRENT_XY` | Packed signed 16-bit `{y, x}`. |
| `0xC4` | `CURRENT_INDEX_XY` | Packed `{y_idx, x_idx}` for scan modes. |
| `0xC8` | `CURRENT_FRAME` | Current frame/shot index inside the active pixel or continuous run. |
| `0xCC` | `SCHED_SHOT_COUNT` | Accepted scheduler shots since last clear/start. |
| `0xD0` | `SCHED_CAPTURE_COUNT` | ADC/meta capture trigger count. |
| `0xD4` | `SCHED_PIXEL_COUNT` | Pixel start count in scan modes. |
| `0xD8` | `SCHED_COMMAND_COUNT` | Accepted command count. |
| `0xDC` | `SCHED_LAST_COMMAND` | Last accepted command bit index/value. |
| `0xE0` | `SCHED_STOP_COUNT` | Graceful stop and abort count. |
| `0xE4` | `SCHED_PARK_COUNT` | Number of times outputs were parked. |
| `0xE8` | `SCHED_MANUAL_UPDATE_COUNT` | Applied manual coordinate updates. |
| `0xEC` | `SCHED_WAVEFORM_CYCLE_COUNT` | Completed waveform cycles. |
| `0xF0` | `SCHED_FAULT_DETAIL` | Additional detail for the latched fault code. |
| `0xF4` | `SCHED_CONTROL_SNAPSHOT` | Latched control flags for the active run. |
| `0xF8` | `SCHED_PERIOD_ACTIVE` | Latched period used by the active run. |
| `0xFC` | `SCHED_RESERVED` | Reserved read-only zero for now. |

`SCHED_CONTROL` bit fields:

- bit `0`: `ld_enable`.
- bit `1`: `adc_enable`.
- bit `2`: `capture_enable`; when clear, no `adc_trigger` or `meta_valid` is
  emitted even if the pulse engine is running.
- bit `3`: `respect_downstream_busy`; capture modes set this by default.
- bit `4`: `loop_enable`; when clear, `SHOT_LIMIT=0` behaves as one shot
  rather than infinite run.
- bit `5`: `manual_live_update`; apply manual X/Y updates at the next safe
  boundary without requiring a stop/start.
- bits `9:8`: `park_mode`; `0=center`, `1=scan_start`, `2=manual_xy`,
  `3=hold_last`.
- all other bits are reserved and must be written as zero by the server.

`WAVEFORM_CONTROL` bit fields:

- bits `3:0`: X waveform shape: `0=hold`, `1=ramp`, `2=triangle`, `3=square`.
- bits `7:4`: Y waveform shape with the same encoding.
- bit `8`: enable X waveform. If clear, X holds `MANUAL_X`.
- bit `9`: enable Y waveform. If clear, Y holds `MANUAL_Y`.
- bit `10`: reset waveform phase on `START`.
- all other bits are reserved and must be written as zero.

`SCHED_STATE` bit fields:

- bits `3:0`: active mode.
- bits `7:4`: internal FSM state.
- bit `8`: scheduler active.
- bit `9`: capture required by active mode.
- bit `10`: capture enabled.
- bit `11`: running without capture.
- bit `12`: parked.
- bit `13`: graceful stop pending.
- bit `14`: abort observed.
- bit `15`: fault latched.
- bits `31:16`: reserved for future flags.

## Status and Faults

The existing `DBG_STATUS` bit positions that server code already uses must stay
compatible:

- bit `0`: fault latched.
- bit `1`: scheduler busy.
- bit `2`: waiting on downstream busy.
- bit `4`: timeout/fault seen.
- bit `5`: downstream `overall_busy_pl`.

Additional high bits can indicate capture enabled, LD enabled, ADC enabled,
manual mode, waveform mode, parked, and running without capture.

Fault codes:

- `0`: no fault.
- `1`: downstream busy timeout in a capture mode.
- `2`: illegal mode or unsupported capability.
- `3`: invalid configuration, for example zero period after coercion would
  overflow timing.
- `4`: command rejected because the mode cannot accept it while busy.
- `5`: coordinate arithmetic overflow/clamp event.
- `6`: capture was requested with downstream busy already stuck long enough to
  exceed the configured wait timeout.

Faults are latched until `CLEAR_FAULT`. Non-capture modes must not fault only
because `overall_busy_pl` is high.

## Mode Behavior Details

### Auto Scan Capture

This is the current image scan path. It samples legacy registers on start,
walks X/Y/frame loops, emits `pixel_start_pulse`, `frame_start_pulse`,
`laser_trigger`, `adc_trigger`, `meta_valid`, and existing metadata. It
respects downstream busy by default and faults on configured busy timeout.
Completion parks to the configured return position.

### Continuous Point Capture

The server sets manual X/Y, period, LD delay/width, ADC delay/width, optional
shot limit, and enables capture. The scheduler holds galvo at manual X/Y and
emits repeated pulse slots. At the ADC trigger point it emits metadata with the
active mode, manual coordinates, and continuous shot index. Manual coordinate
updates are applied at a frame boundary so a single captured frame is not split
between two positions.

Metadata keeps the existing 256-bit layout. For non-scan capture modes,
`current_x/current_y` carry the actual galvo coordinates, `x_idx/y_idx` are
zero, `frame_idx` is the low 16 bits of the continuous shot index,
`frame_number` is the low 16 bits of `SHOT_LIMIT` or zero for infinite runs,
and `global_shot_idx` remains the full 32-bit shot counter. This preserves the
legacy parser while giving the server enough information to label point or
waveform captures.

### Manual Galvo Hold

This mode applies manual X/Y without depending on capture hardware. It may
report `active` but not `busy` in the capture sense. It is safe to use while
TCP is disconnected.

### Manual Pulse No Capture

This mode uses manual X/Y and pulse timing to emit laser pulses without ADC
trigger or metadata. It supports `SINGLE_PULSE`, finite `SHOT_LIMIT`, and
continuous looping. It ignores downstream busy.

### Waveform Modes

The waveform engine updates galvo outputs from range/step/period registers.
Supported per-axis shapes are hold, ramp, triangle, and square step. A waveform
mode can run without capture or, through `GALVO_WAVEFORM_CAPTURE`, with ADC
trigger and metadata. The server may initially expose only no-capture waveform
control, but the capture-capable HDL path should be present.

## Server Design

Add a shared PA scheduler layer:

- `PamSchedulerRegisters`: register constants, signed packing/unpacking, and
  capability/status decoding.
- `PamSchedulerController`: low-level AXI read/write and command helper.
- `PaSchedulerService`: mode-aware orchestration, validation, status polling,
  and stop/abort sequencing.
- `PaCaptureService`: existing TCP/superblock streaming path, called only by
  modes that require capture.

New endpoints:

- `GET /api/pa/scheduler/status`
- `POST /api/pa/scheduler/config`
- `POST /api/pa/scheduler/command`
- `POST /api/pa/scheduler/manual-position`
- `POST /api/pa/scheduler/pulse`
- `POST /api/pa/scheduler/waveform`

Compatibility endpoints stay:

- `POST /api/pa/start` configures `AUTO_SCAN_CAPTURE`, ensures receiver/TCP is
  ready, then starts capture.
- `POST /api/pa/stop` issues `ABORT_AND_PARK`, drains/stops the capture worker,
  and returns scheduler + stream diagnostics.

Server validation rules:

- Capture modes require receiver readiness and superblock driver readiness
  before start.
- Non-capture modes must not require receiver readiness.
- Stop/reset paths always command HDL abort/park before unloading drivers or
  reprogramming PL.
- Status responses include both scheduler status and capture-chain status, but
  clearly mark capture-chain status as not required for non-capture modes.

## Tauri Design

Replace the PA capture-only mental model with a PA Scheduler panel:

- A top status band shows active mode, scheduler state, current X/Y, LD/ADC
  enabled state, capture required/connected state, fault summary, and counters.
- A global `Abort & Park` control is always visible.
- Mode tabs:
  - `Auto Scan Capture`: current scan settings, timing, return position,
    estimated frames/time, progress, TCP/capture readiness.
  - `Point Capture`: manual X/Y, repetition rate, pulse timing, optional shot
    limit, live frame preview/progress.
  - `Manual Control`: galvo hold and single/continuous LD pulse without capture.
  - `Waveform`: generated galvo waveform settings and optional LD pulse.
  - `Diagnostics`: raw registers, counters, faults, command log, capture-chain
    status.

Only tabs/modes that require capture should show TCP receiver readiness as a
blocking condition. Manual control should visibly say capture is not required,
instead of showing a disconnected receiver as an error.

## Verification Plan

HDL tests:

- Legacy auto scan still emits the same pulse order, metadata, and completion
  behavior for a small 2D scan.
- Legacy start high/low still maps to start/abort.
- Continuous point capture emits repeated ADC/meta shots, applies manual X/Y at
  a frame boundary, and obeys shot limit.
- Manual galvo hold updates X/Y without laser/ADC/meta and ignores
  `overall_busy_pl`.
- Manual pulse no capture emits LD pulses and no ADC/meta while
  `overall_busy_pl` is stuck high.
- Capture modes hold on downstream busy and fault after timeout.
- Abort immediately deasserts laser/ADC/meta and parks.

Server tests:

- Register packing/unpacking for all new signed and packed fields.
- Compatibility `/api/pa/start` writes legacy scan fields and new scheduler
  mode consistently.
- Non-capture endpoints do not start TCP receiver and do not reject because the
  receiver is disconnected.
- Capture endpoints reject cleanly when receiver/superblock is not ready.
- Stop-all and reset helper paths issue abort/park before driver/PL reset.

Tauri tests:

- Mode tabs show and hide capture-chain readiness correctly.
- Manual control can send position, single pulse, continuous pulse, stop, and
  abort commands.
- Auto scan still computes expected frames/time and return position.
- Diagnostics renders scheduler counters and fault codes.

## Implementation Notes

- Update canonical IP files under `IPs/ip_repo/axi_pam_image_acq_1_0/hdl` and
  synchronize generated `ipshared` copies only after the canonical HDL passes
  syntax simulation.
- Keep `C_S00_AXI_ADDR_WIDTH = 8`; do not expand the AXI address width unless
  this register map proves insufficient.
- Prefer write-one-pulse command decoding for new controls to avoid ambiguous
  level-sensitive starts.
- Keep the old `PamCaptureParams` path as a compatibility wrapper while adding
  new scheduler-specific dataclasses.
- Generated waveform shapes should be simple fixed-point integer logic. Do not
  introduce trigonometric LUTs unless a later experiment explicitly requires
  sine/circular galvo motion.
