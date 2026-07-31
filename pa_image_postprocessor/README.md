# PA Image Post-Processor

Standalone Tauri desktop software for offline PA image reconstruction and
post-processing. It is extracted from the Butterfly Laser Control console's
PA Image Viewer and contains no board control, acquisition, laser, TEC, or
network backend code.

## Features

- Open and validate legacy PA `.bin` files.
- Inspect any frame trace and configure PTP/baseline ROIs.
- Reconstruct images with progress reporting and cancellation.
- Apply colormaps, display enhancement, rotation, zoom, and similar-pixel masks.
- Export the current processed view as PNG.

## Development

```powershell
npm ci
npm test
npm run build
npm run tauri:dev
```

The Vite development server listens on `http://127.0.0.1:1421`.

## Classical 3D OR-PAM

The original PTP 2D workflow remains available. The added classical workflow performs:

```text
validated legacy frames
→ metadata placement
→ valid source slice
→ per-A-line median baseline
→ Butterworth SOS zero-phase band-pass
→ Hilbert envelope
→ output crop
→ one-way time-to-depth conversion
```

Click a PTP/MAP/C-scan pixel to load its processed A-line. Use `XZ B-scan`,
`YZ B-scan`, or `XY C-scan` to inspect the saved linear volume. Pipeline stages
are visible and can be enabled or disabled independently; the physically
conventional complete workflow is enabled by default.

`Run + Save Numerical` writes a new output directory without overwriting a
completed run:

- `envelope_linear.npy`: little-endian float32, C-order `[y,x,z]`
- optional `filtered_rf.npy`: little-endian float32 `[y,x,z]`
- `x_um.npy`, `y_um.npy`, `z_um.npy`: float64 coordinates
- `resolved_config.json`
- `reconstruction_metadata.json`
- `qc/representative_raw_alines.png`
- `qc/representative_filtered_alines.png`
- `qc/representative_envelopes.png`
- `qc/signal_and_noise_spectrum.png`
- `qc/map_xy_linear.png`, `qc/map_xy_db.png`
- `qc/bscan_xz.png`, `qc/bscan_yz.png`, `qc/cscan_xy.png`

Metadata also records per-pixel frame counts, missing/duplicate/invalid data
statistics, enabled processing stages, the duplicate-frame policy, and the
Pearson correlation between the classical envelope MAP and the matching PTP
reference values. Correlation is diagnostic only; parameters are never tuned
to maximize it automatically.

## Scientific A-line figures

`Save Scientific PNG` delegates drawing to Python/Matplotlib rather than
capturing the GUI canvas. The export uses a white 8 × 4 inch canvas at 300 DPI,
Nature-style spines and palette, 22 pt bold axis labels, an 11 pt legend above
the data region, and calibrated `Time (µs)` / `Current (µA)` axes. The selected
curves and current visible zoom range are preserved.

The renderer requires Python with Matplotlib. Set `PA_IMAGE_PYTHON` to a Python
executable when it is not discoverable automatically.
The saved volume remains linear. Colormap, percentile enhancement and dB
dynamic range affect display only. Depth uses `z = c × (t - t0)` with no
factor of `1/2`; until `t0` is calibrated, use relative-depth mode.
