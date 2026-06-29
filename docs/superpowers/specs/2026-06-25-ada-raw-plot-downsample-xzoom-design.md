# ADA Raw Plot Downsample And X Zoom Design

Date: 2026-06-25

## Goal

Make the ADA Raw ADC plot responsive when captures contain many points, while preserving the full raw data for saving/export. Add X-only zoom interaction for the raw plot.

This applies only to the ADA raw data plot in `AdaPanel`. Spectrum and Lock spectrum plots are out of scope.

## Requirements

- Keep `raw.samples` in memory at full resolution.
- Keep raw CSV/export behavior full resolution.
- Downsample only the displayed series when the visible raw range contains many samples.
- Use envelope-style downsampling so narrow peaks and dips remain visible.
- Support left-button drag on the raw plot to select an X range and zoom into it.
- Support right-click on the raw plot to return to the previous zoom range; if no previous range exists, return to the full range.
- Do not zoom Y by dragging.
- After every X zoom, compute Y range from the full-resolution samples inside the selected X range, using 10 percent margin below the visible minimum and above the visible maximum.
- Keep existing raw Y manual controls available for the full-range view.
- While an X zoom is active, the raw plot uses the zoom range's computed Y range so the selected data fills the plot vertically.
- After right-click restore returns to the full range, the raw plot returns to the existing Auto Raw Y/manual Y behavior.

## Approach

Add display-only helpers for raw plotting:

- `normalizeIndexRange(start, end, count)` clamps and orders selected indices.
- `rawRangeToCurrentValues(samples, range, tzOhm, offset)` converts only the visible raw samples to current units for Y range calculation.
- `downsampleEnvelope(values, maxPoints)` returns bucket min/max points when `values.length > maxPoints`; otherwise it returns all points with their original source indices.

The display series passed to `PlotCanvas` will contain `{ xIndex, value }` points instead of assuming every plotted point is one adjacent source index. `PlotCanvas` can keep the existing simple `values` prop for current callers, and add an optional plotted-points path for ADA raw.

## Interaction

`AdaPanel` owns:

- `rawZoomRange`: current visible source-sample index range, or full range when unset.
- `rawZoomHistory`: previous ranges for right-click restore.
- `rawSelection`: temporary drag start/end while the user is selecting a range.

Raw plot behavior:

- Left pointer down inside plot starts a selection.
- Pointer move updates a translucent selection window.
- Left pointer up normalizes the selected source index range. If it spans at least two samples, push the previous visible range to history and set the new zoom range.
- Right-click prevents the browser context menu and pops `rawZoomHistory`. If history is empty, clear zoom to full range.

The selection is X-only. Pointer Y is ignored except for staying inside the canvas.

## Rendering

For the raw plot:

- The visible source range is sliced from full raw samples.
- Visible samples are converted to input current only for the selected range.
- Y range is computed from that visible full-resolution current data with a 10 percent margin.
- The computed zoom Y range overrides the manual Y controls only while a zoomed X range is active.
- The plotted series is downsampled after Y range calculation, preserving original source X indices.
- X label shows the visible range and total count.

For non-raw plots:

- Existing `PlotCanvas` behavior remains unchanged.

## Testing

Add unit tests for:

- Envelope downsampling preserves min and max values from each bucket.
- Downsampling returns original points when under the threshold.
- Index range normalization clamps and orders source indices.
- Y range margin calculation uses the selected full-resolution range.
- X coordinate/index helpers map pointer selections to source indices when a custom X domain is used.

Add a focused Ada panel/render test only if the helper tests do not cover the interaction state cleanly.

## Non-Goals

- No server-side decimation changes.
- No changes to raw capture length, raw storage, or CSV format.
- No Y-axis drag zoom.
- No changes to Spectrum or Lock plots.
