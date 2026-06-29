# PA Point Capture and Series Viewer Design

## Scope

Point Capture is a one-dimensional PA trace series acquired at a fixed galvo position. It is not a PA image and must not be displayed or saved as a two-dimensional grid. The feature reuses the existing PA TCP stream and legacy block file format so that frame continuity, metadata parsing, and diagnostics stay consistent with Scan Capture.

## User Workflow

Point Capture exposes `Start Capture` and uses the shared `Abort & Park` path for all stop/reset behavior. There is no separate Stop button. The user sets Manual X, Manual Y, Pulse Repetition Rate, Pulse Enable, Capture Enable, and Shots.

`Shots` means the number of pulse slots to acquire at the current point. One shot corresponds to one laser/ADC timing slot and, when capture is enabled, one 2048-sample PA frame. `Shots = 0` means unlimited acquisition until `Abort & Park`.

Capture progress has two states:

- `Shots > 0`: normal bounded progress with frames/shots, elapsed time, remaining time, and frame rate.
- `Shots = 0`: unbounded progress with a distinct color and no percentage; show received frames, elapsed time, and frame rate.

## Storage

Point Capture uses a separate data type:

```text
<DataRoot>/pa_point_capture/YYYYMMDD/<name_index>/
  legacy.bin
  metadata.json
```

The temporary active capture file is:

```text
<DataRoot>/_tmp/pa_point_capture/current/legacy.bin
```

Point Capture has no Canvas/Current pair. It has a Save Name and Save button. The saved metadata records point coordinates, pulse repetition rate, pulse enable state, capture enable state, requested shots, actual frames, ROI/baseline settings, ADA current conversion settings, and continuity diagnostics.

## Data Flow

Starting Point Capture runs the full PA capture chain:

1. Tauri prepares the point temp `legacy.bin`.
2. Tauri starts the local PA TCP receiver and live series accumulator.
3. Tauri calls a point-capture server endpoint with point timing and shot limit.
4. Server opens `/dev/axis_capture0`, starts DMA, configures scheduler mode `Continuous Point Capture`, and starts the scheduler.
5. FPGA emits per-frame metadata and samples.
6. Server streams DATA records.
7. Tauri writes legacy blocks and updates live series preview/statistics.

The server must not use the old Scan Capture start register path for Point Capture. Point Capture starts through scheduler mode 2.

## Metadata

Point Capture reuses the 32-byte per-frame metadata layout, but parser/UI must treat it as a series format:

- Use `global_shot_idx` or legacy `frame_id` for ordering.
- Do not use 16-bit `frame_idx` as a global index; it wraps after 65535.
- `x_points` and `y_points` are expected to be zero in Point Capture and must not be treated as image dimensions.
- `current_x` and `current_y` identify the fixed point position.

## PA Series Viewer

The PA Series Viewer loads `pa_point_capture` records and displays a shot/time axis rather than a two-dimensional image. It shows:

- selected frame trace,
- PTP timeline over shot index or elapsed time,
- average PTP, variance, standard deviation, min/max,
- baseline mean/std,
- frame count and continuity gaps.

The trace view keeps the existing ROI interactions: Zoom, PTP ROI, and Baseline. The viewer can save the chosen ROI/baseline to the shared PA processing settings so future live previews and offline builds use the same parameters.

## Manual Control

Manual Control is for position and pulse testing, not file storage. It contains:

- Manual X and Manual Y,
- Apply Position,
- Pulse Repetition Rate,
- Pulse Enable,
- Single Pulse,
- Continuous Pulse On/Off.

Saving data belongs to Point Capture. Scan Capture remains the two-dimensional image workflow.

## Tests

Tests should cover:

- Point Capture starts receiver/storage before server capture.
- `Shots = 0` renders unbounded progress.
- Point Capture saves to `pa_point_capture` and not `pa_image`.
- Point metadata parsing uses `global_shot_idx`/frame id and tolerates zero image dimensions.
- Series statistics compute PTP average and variance from legacy frames.
- Manual Control pulse controls do not create storage files.
