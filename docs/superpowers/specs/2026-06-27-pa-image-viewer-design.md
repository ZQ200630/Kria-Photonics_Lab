# PA Image Viewer Design

## Goal

Add a PA Imaging secondary page for reading stored PA capture files, selecting a per-frame PTP ROI interactively, building a PTP image, and previewing live captures while they are being received.

The final saved capture file must be Python-compatible legacy `.bin`:

```text
[32-byte block header]
  [16-byte frame header][32-byte META][2048 int16 samples]
  ...
[32-byte block header]
  ...
```

The TCP transport may keep using the internal `PAI1` record format, but the receiver must write a legacy-compatible `.bin` for long-term storage.

## Existing File Format

The legacy parser expects a stream of AXIS capture blocks:

- Block header: little-endian `<QIIQQ>`, 32 bytes.
  - `block_id`
  - `used_bytes`
  - `frame_count`
  - `first_frame_id`
  - `last_frame_id`
- Frame header: little-endian `<QII>`, 16 bytes.
  - `frame_id`
  - `data_bytes`
  - `reserved`
- Frame payload:
  - 32-byte metadata.
  - remaining bytes as little-endian signed int16 ADC samples.

Metadata is 32 bytes and uses magic `0x4D455441` (`META`). The fields are:

- `reserved`: u32
- `global_shot_idx`: u32
- `y_points`: u16
- `x_points`: u16
- `frame_number`: u16
- `frame_idx`: u16
- `y_idx`: u16
- `x_idx`: u16
- `current_y`: i16
- `current_x`: i16
- `task_id`: u32
- `magic`: u32

The current Python image path converts samples to ADA4355 input current and computes PTP from a selected time window.

## Secondary Page

Add a PA Imaging secondary page named `PA Image Viewer`.

The main PA Imaging capture page should stay focused on acquisition controls. It gets a button that opens this secondary page. The secondary page contains the offline file parser, the frame viewer, the PTP ROI controls, and the PA image preview.

The page has three functional areas:

1. Source and processing controls.
2. PA image heatmap.
3. Selected frame raw trace with ROI selection.

The selected frame raw trace should reuse the interaction pattern from the ADA raw plot:

- left drag selects an X range.
- right click returns to the previous zoom.
- Y range auto-fits the visible trace.
- selecting a PTP ROI is separate from zoom and is shown as a highlighted window.

## Offline Flow

1. User opens `PA Image Viewer`.
2. User picks a legacy `.bin` file.
3. Tauri scans the file on the Rust side without loading the whole file into frontend memory.
4. The scan reports:
   - file size
   - block count
   - frame count
   - detected `x_points`, `y_points`, `frame_number`
   - metadata coverage
   - bad frame count
   - missing pixel/frame count when metadata is sufficient
   - severity: `ok`, `warning`, or `error`
5. User may inspect a representative frame or choose a specific frame.
6. The frame trace is displayed in current units with a time axis.
7. User selects the PTP ROI interactively.
8. The selected ROI is saved as the current PA processing ROI and used for later image builds until the user changes it.
9. User clicks Build Image.
10. Tauri streams through the file, calculates PTP per frame, averages repeated measurements for the same pixel, and returns a 2D matrix plus diagnostics.

Default processing parameters:

- sample interval: 8 ns
- sample type: little-endian signed int16
- sample slice: skip first 10 samples and last 50 samples
- baseline window: 0.1 us to 0.4 us
- PTP ROI: user-selected, default 1.6 us to 2.4 us only as an initial value
- ADA4355 conversion: `current_uA = (0.825 - code / 32768 * vfs) / tz_ohm * 1e6`
- default `vfs`: 1.0 V
- default `tz_ohm`: current global ADA setting

## Live Flow

The server may continue sending `PAI1` TCP records. The Tauri receiver should:

1. Receive each `PAI1` record.
2. For DATA records, reconstruct and append the legacy block header plus payload to the saved `.bin`.
3. Parse each frame from the DATA payload.
4. Compute PTP using the current ROI.
5. Update an in-memory image accumulator.
6. Send throttled UI updates to the frontend.

The live image is a preview. If the ROI is later changed, the user can rebuild the final image from the saved legacy `.bin`.

## Image Calculation

For each valid frame:

1. Parse metadata and samples.
2. Convert ADC code to current in microamps.
3. Subtract the average baseline current over the baseline window.
4. Compute PTP in the selected ROI: `max(corrected_roi) - min(corrected_roi)`.
5. Add the value to the accumulator at `(y_idx, x_idx)`.
6. Store count per pixel.

At display time:

- image pixel value is the mean of accumulated PTP values.
- missing pixels are displayed with an empty/neutral color.
- duplicated pixels are averaged and count is reported.
- hover shows `x_idx`, `y_idx`, `current_x`, `current_y`, PTP, and count.

The first image view should support percentile contrast, using 1% to 99% as the default. Log, gamma, row background correction, and S-curve enhancement can be added after the base viewer works.

## Error Handling

Severity levels:

- `ok`: headers and metadata are consistent enough for normal plotting.
- `warning`: plotting can continue, but diagnostics should be visible.
- `error`: parsing is not reliable enough to build an image.

Warnings that should not stop plotting:

- partial final block
- short or missing frame payload for a small number of frames
- metadata magic failure for a small number of frames
- missing pixels
- repeated pixels or uneven repeat counts
- frame count mismatch between block header and parsed frames

Errors that should stop plotting:

- file is neither legacy `.bin` nor a recoverable `PAI1` stream
- block headers cannot be aligned
- most frame metadata cannot be parsed
- payload lengths make frame boundaries unrecoverable
- image dimensions cannot be inferred and were not provided by the user

Every warning and error should include counts and enough context to debug the first few offending block/frame ids.

## Architecture

Rust/Tauri responsibilities:

- open file dialog for PA `.bin`
- scan large files in streaming mode
- parse legacy blocks and frames
- optionally recover old `PAI1` files if needed
- reconstruct legacy `.bin` while receiving TCP
- compute PTP image matrices without sending raw 2GB data to frontend
- expose commands for file scan, frame extraction, image build, and current live image status

Frontend responsibilities:

- add `PA Image Viewer` secondary page under PA Imaging
- display source diagnostics and severity
- display selected frame raw trace
- support zoom and ROI selection
- show PA image heatmap and basic contrast controls
- show progress while scanning/building
- keep acquisition controls separate from image review controls

Shared processing model:

- one ROI/config object is used by both offline build and live preview
- offline rebuild is the source of truth for final results
- live preview is throttled and can lag behind acquisition to keep UI responsive

## Testing

Add TypeScript tests for frontend utilities and layout:

- image viewer entry appears as a secondary PA page.
- ROI selection state is independent of raw trace zoom.
- processing defaults match the Python scripts.

Add Rust tests for parser behavior:

- parses one valid legacy block and frame.
- rejects invalid block alignment as an error.
- treats a short final frame as a warning.
- reconstructs a legacy block from a `PAI1` DATA record.
- computes PTP from a known synthetic waveform and ROI.

Add integration-style tests where practical:

- saved receiver output is legacy-compatible.
- offline image build averages repeated frames per pixel.
- missing frames produce warnings and NaN/missing pixels rather than a hard failure.
