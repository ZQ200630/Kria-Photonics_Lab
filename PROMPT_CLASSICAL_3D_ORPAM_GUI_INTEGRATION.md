# Implementation Prompt: Add physically correct classical 3D OR-PAM reconstruction to the PA Image Viewer

## Role

You are implementing a production-quality classical single-focus OR-PAM reconstruction workflow in the existing Tauri + React PA Image Post-Processor.

Target the standalone application first:

```text
E:\Codex_Data\Kria_Software\Kria-Photonics_Lab\pa_image_postprocessor
```

The control-console repository contains a second copy of the PA viewer. Do not edit both copies simultaneously during the first implementation. Complete and verify the standalone post-processor first, then port the tested modules deliberately or extract genuinely shared code.

The implementation must preserve the existing 2D PTP viewer while adding a separate classical 3D Hilbert-envelope reconstruction mode.

---

## 1. Goal

Starting from a legacy `legacy.bin` acquisition containing one time-domain PA A-line per lateral scan coordinate, implement:

```text
validated legacy frame stream
→ frame metadata and i16 waveform extraction
→ placement by metadata (y_idx, x_idx)
→ valid trace selection
→ per-A-line median baseline subtraction
→ zero-phase Butterworth band-pass filtering
→ Hilbert analytic-signal magnitude
→ crop to the configured output time window
→ one-way time-to-depth conversion
→ linear float32 [y, x, z] volume
→ MAP, B-scan, C-scan and selected-pixel A-line views
→ reproducible numerical output and metadata
```

This is the conventional single-focus OR-PAM baseline. It is direct A-line stacking, not a tomographic or model-based inversion.

The user must be able to:

1. open and validate a legacy PA binary;
2. inspect a raw A-line;
3. choose baseline, processing and output windows;
4. choose a fixed band-pass and sound speed;
5. run or cancel the reconstruction;
6. inspect the reconstructed 3D volume through MAP, XZ, YZ and XY views;
7. click an image position and inspect raw, baseline-corrected, filtered and envelope traces;
8. save the linear numerical volume, coordinates, resolved settings, diagnostics and PNG views.

---

## 2. Inspect the existing implementation before changing code

Read these files completely before implementation:

```text
pa_image_postprocessor/src-tauri/src/pa_image.rs
pa_image_postprocessor/src-tauri/src/main.rs
pa_image_postprocessor/src/utils/paImage.ts
pa_image_postprocessor/src/utils/paImageTauri.ts
pa_image_postprocessor/src/components/PaImageViewer.tsx
pa_image_postprocessor/src/__tests__/paImage.test.ts
pa_image_postprocessor/src/__tests__/paImageViewerLayout.test.tsx
pa_image_postprocessor/src-tauri/Cargo.toml
pa_image_postprocessor/package.json
```

Reuse the working legacy parser, progress/cancellation pattern, coordinate placement, error reporting and UI conventions. Do not replace a verified parser with a new flat binary reader.

Run the existing tests before making changes:

```powershell
cd E:\Codex_Data\Kria_Software\Kria-Photonics_Lab\pa_image_postprocessor
npm test
npm run build
cargo test --manifest-path src-tauri\Cargo.toml
```

Record the baseline results.

---

## 3. Hard legacy-file data contract

### 3.1 Never treat `legacy.bin` as a flat waveform array

For the 2026-07-06 CarbonfiberH2 files, the verified structure is:

```text
legacy.bin
├── axis block 0
│   ├── 32-byte AxisBlockHeader
│   ├── frame 0
│   │   ├── 16-byte AxisFrameHeader
│   │   └── payload
│   │       ├── 32-byte PA metadata
│   │       └── 2032 little-endian i16 waveform samples
│   ├── frame 1
│   └── ...
├── axis block 1
└── ...
```

The existing Rust constants are authoritative:

```rust
AXIS_BLOCK_HEADER_BYTES = 32
AXIS_FRAME_HEADER_BYTES = 16
PA_METADATA_BYTES = 32
PA_META_MAGIC = 0x4D455441
```

For a normal CarbonfiberH2 capture, the current reader reports:

```text
block count:       20
frame count:       160000
grid:              400 × 400
waveform samples:  2032 per frame
```

Do not infer “2056 samples” from total file size. That incorrect number is obtained when an implementation accidentally treats the 16-byte frame header and 32-byte PA metadata as 24 additional `u16` waveform values.

Do not use or reproduce any parser based on:

```text
memmap(offset=640, shape=[160000,2056])
```

That layout is physically wrong.

### 3.2 Reuse metadata-based placement

Parse every valid frame using the existing stream visitor and `parse_metadata`. Place each processed A-line using:

```text
pixel_index = y_idx * width + x_idx
```

Do not reconstruct image order from frame order. Do not manually reverse alternating rows when valid `x_idx` and `y_idx` metadata are available. Metadata placement already handles serpentine scanning and is safer than parity-based assumptions.

Validate:

- block and frame sizes;
- metadata magic;
- `x_points` and `y_points`;
- `x_idx < x_points`;
- `y_idx < y_points`;
- consistent sample count;
- frame, block and global-shot continuity;
- duplicate or missing pixels;
- odd trailing sample bytes;
- waveform length after trimming.

Warnings must remain visible in the GUI and saved metadata.

### 3.3 Source indices, trimmed indices and time

Use distinct terms:

```text
source sample index n:
    index in the decoded 2032-sample waveform

valid trace index m:
    index after sampleStartIndex and sampleEndTrim

n = sampleStartIndex + m
t_m = m * sampleIntervalNs
```

For the current metadata:

```text
sampleIntervalNs = 8
sampleStartIndex = 10
sampleEndTrim = 50
```

For a 2032-sample legacy waveform, the effective source slice is:

```text
[10, 2032 - 50) = [10, 1982)
```

and contains 1972 samples.

Do not confuse:

- the 2032 samples physically present in each legacy frame;
- a 2048-sample hardware transmit-buffer contract from another acquisition format;
- a 2000-sample display limit;
- the 1972 samples left after the legacy metadata start/trim settings.

If a future source format truly contains a 2048-sample ADC buffer with `[0,2000)` valid, implement it as a separate source adapter. Do not force that contract onto the current 2032-sample legacy payload.

Time-window fields in the GUI are relative to valid-trace time unless the UI explicitly labels otherwise. Convert a half-open time window `[t_start,t_stop)` to valid-trace indices consistently, then add `sampleStartIndex` only when addressing the decoded source array.

---

## 4. Preserve the existing PTP image as a separate product

The existing 2D image is:

```text
PTP(x,y) = max(signal gate) - min(signal gate)
```

It is useful and must remain available as a `PTP 2D` mode.

Do not call the 2D PTP image a 3D reconstruction. Do not use PTP values as depth samples. Do not expand a PTP image along z to manufacture a volume.

The new primary 3D product is:

```text
V_env[y,x,z] = abs(Hilbert(filtered A-line))
```

The GUI should clearly distinguish:

```text
PTP 2D
Classical 3D envelope
```

PTP may be used as an independent QC comparison with the depth-direction MAP:

```text
MAP_xy(x,y) = max_z V_env(y,x,z)
```

but one must not silently replace the other.

---

## 5. Physically correct A-line processing

### 5.1 Decode and units

Decode waveform bytes as little-endian `i16`, exactly as the existing reader does.

For display in microamps, reuse the existing linear conversion:

```text
v_zero = zeroAdcCode / 32768 * VFS
v_adc  = code / 32768 * VFS
I_uA   = (v_zero - v_adc) / tzOhm * 1e6
```

The DSP may operate either in signed ADC-code units or microamps, provided:

- the choice is explicit;
- the saved metadata records the unit;
- the same linear scale is applied to every A-line;
- no per-A-line scaling or normalization is introduced.

For GUI consistency, prefer microamps for displayed traces and the saved envelope. Use `float32` for reconstructed numerical arrays.

### 5.2 Valid trace

From every decoded waveform:

```text
s_valid = samples[sampleStartIndex : sampleCount - sampleEndTrim]
```

Reject settings that leave an empty trace.

Do not make “display first 2000 samples” part of the physical processing. Display limits and processing limits are different concepts.

### 5.3 Median baseline subtraction

Use a configured signal-free half-open interval:

```text
baseline = median(s_valid[baselineStart:baselineStop])
s0[m] = s_valid[m] - baseline
```

Subtract the scalar baseline from the complete valid trace before filtering.

Do not:

- subtract the mean of the complete A-line;
- divide by the A-line maximum;
- divide by the A-line RMS;
- normalize each A-line independently;
- normalize each image row, B-scan or depth slice.

Relative amplitudes between lateral positions must remain intact.

### 5.4 Zero-phase band-pass

Implement a configurable Butterworth band-pass:

```text
0 < lowCutHz < highCutHz < samplingRateHz / 2
filterOrder is a positive integer
```

Use second-order sections and forward-backward zero-phase filtering equivalent to SciPy:

```python
sos = scipy.signal.butter(
    order,
    [low_hz, high_hz],
    btype="bandpass",
    fs=fs_hz,
    output="sos",
)
filtered = scipy.signal.sosfiltfilt(sos, signal, axis=-1)
```

Filtering must operate only along each A-line time axis. It must never run across x or y.

If the Rust implementation uses another numerical library, create fixed golden fixtures from SciPy and prove numerical agreement. Do not claim “zero phase” based only on visual similarity.

The processing interval must be wider than the final output interval. Filter and Hilbert transforms run on the processing interval; only afterward is the output interval retained.

### 5.5 Hilbert envelope

Construct the analytic signal along time:

```text
analytic(t) = filtered(t) + i * H{filtered(t)}
envelope(t) = abs(analytic(t))
```

Requirements:

- Hilbert operates along the time axis only;
- it runs before final output cropping;
- the envelope remains linear;
- do not square it unless a separately named intensity product is requested;
- do not log-compress the saved volume.

If implemented with an FFT, handle even and odd lengths correctly and add tests against `scipy.signal.hilbert`.

### 5.6 Output window

Use two distinct windows:

```text
processing window: wider interval used by filtering and Hilbert
output window:     final retained interval
```

Require:

```text
output window ⊂ processing window ⊆ valid trace
```

Use half-open intervals everywhere.

Do not silently clamp invalid windows. Return an actionable error.

### 5.7 One-way time-to-depth conversion

For PA, depth is one-way acoustic time of flight:

```text
z = c * (t - t0)
```

There is no factor of `1/2`.

For retained valid-trace sample index `m`:

```text
t_m = m / fs
z_m = c * (m / fs - t0)
```

If the user selects relative depth:

```text
z_relative = z - z[0]
```

This changes only coordinate labels, not signal samples.

The GUI and metadata must say:

```text
Δz = c / fs is axial sample spacing, not axial resolution.
```

Until `t0` is calibrated experimentally, label z as relative depth and do not imply that zero is the sample surface.

---

## 6. CarbonfiberH2 dataset preset

Add an explicit selectable preset named, for example:

```text
CarbonfiberH2 2026-07-06 (legacy 125 MHz)
```

Populate it from the adjacent `metadata.json` when available, but show the resolved values and let the user confirm them before reconstruction.

Recommended starting values:

```text
sample interval:       8 ns
sampling rate:         125 MHz
sample start index:    10
sample end trim:       50
baseline:              248-1104 ns
PA/output gate:        1544-5088 ns
transimpedance:        2000 ohm
VFS:                   1 V
zero ADC code:         27034
band-pass:             0.5-25 MHz
filter order:          4
sound speed:           1500 m/s (assumption)
t0:                    unknown
depth mode:            relative
x/y calibration:       0.1325 µm per galvo count
```

These are dataset-specific starting values, not universal defaults.

The existing screenshot defaults of `PTP 1600-2400 ns` and `baseline 100-400 ns` must not silently override values loaded from the capture metadata. Display the source of every preset:

```text
application default
adjacent metadata.json
user modified
saved run configuration
```

The measured CarbonfiberH2 signal spectrum is concentrated near a few MHz. Existing analysis found approximately:

```text
spectral peak:                    3.48 MHz
5-95% excess-signal energy:      1.34-7.81 MHz
detectable signal-over-noise:    0.55-26.67 MHz
```

Therefore `0.5-25 MHz` is a defensible initial band, but the UI must treat it as a fixed user-visible parameter, not auto-retune it behind the scenes.

---

## 7. Module architecture

Keep DSP and binary parsing out of React.

Create one deep reconstruction module behind a small interface. A reasonable Rust layout is:

```text
src-tauri/src/
├── pa_image.rs                    # existing legacy parser and 2D PTP path
├── classical_orpam.rs             # new DSP and volume pipeline
├── npy.rs                         # only if a small tested NPY writer is needed
└── main.rs                        # thin Tauri command adapters
```

Suggested domain types:

```rust
struct ClassicalOrpamConfig {
    sample_interval_ns: f64,
    sample_start_index: usize,
    sample_end_trim: usize,
    baseline_start_ns: f64,
    baseline_end_ns: f64,
    processing_start_ns: f64,
    processing_end_ns: f64,
    output_start_ns: f64,
    output_end_ns: f64,
    bandpass_low_hz: f64,
    bandpass_high_hz: f64,
    filter_order: usize,
    sound_speed_m_s: f64,
    t0_s: f64,
    relative_depth: bool,
    tz_ohm: f64,
    vfs: f64,
    zero_adc_code: f64,
    chunk_rows: usize,
}

struct ClassicalOrpamRequest {
    input_path: PathBuf,
    output_directory: PathBuf,
    config: ClassicalOrpamConfig,
    request_id: String,
}

struct ClassicalOrpamResult {
    output_directory: PathBuf,
    shape_yxz: [usize; 3],
    x_um_path: PathBuf,
    y_um_path: PathBuf,
    z_um_path: PathBuf,
    envelope_path: PathBuf,
    metadata_path: PathBuf,
    diagnostics: ClassicalOrpamDiagnostics,
}
```

The core module interface should be callable from Rust tests without Tauri:

```rust
fn reconstruct_classical_orpam<F, C>(
    request: &ClassicalOrpamRequest,
    on_progress: F,
    is_cancelled: C,
) -> Result<ClassicalOrpamResult, ClassicalOrpamError>
```

Do not expose filter internals, FFT buffers or frame-parser details to React.

### Tauri command adapters

Follow the existing job pattern:

```text
pa_classical_reconstruct_path_streamed
pa_classical_cancel_reconstruction
pa_classical_load_map
pa_classical_load_bscan
pa_classical_load_cscan
pa_classical_load_pixel_traces
```

Use `spawn_blocking` for reconstruction. Emit progress events containing small summaries, not the entire 3D volume.

Suggested progress payload:

```text
requestId
sourceFrameCount
validFrameCount
completedRows
totalRows
elapsedMs
estimatedRemainingMs
stage: parsing | processing | writing | qc
warningCount
```

---

## 8. Large-volume and IPC requirements

A `400 × 400 × 444` float32 envelope is about 284 MB. Do not serialize it into one Tauri JSON response and do not hold multiple full-volume copies in memory.

Requirements:

1. Stream legacy frames using the existing visitor.
2. Process complete A-lines; never chunk along time.
3. Chunk over lateral rows or a bounded frame batch.
4. Write the output incrementally.
5. Keep the output convention fixed as `[y,x,z]`.
6. Use reusable per-worker buffers for corrected RF, filtered RF, FFT data and envelope.
7. Send only the requested MAP/slice/trace to React.
8. Cancellation must stop at bounded intervals and leave an explicitly named `.partial` output.
9. Never publish a partial reconstruction as complete.
10. Refuse to overwrite an existing completed output unless the user explicitly chooses a new directory.

Preferred numerical outputs:

```text
envelope_linear.npy     float32 [Ny,Nx,Nz], required
filtered_rf.npy         float32 [Ny,Nx,Nz], optional
x_um.npy                float64 [Nx]
y_um.npy                float64 [Ny]
z_um.npy                float64 [Nz]
reconstruction_metadata.json
resolved_config.json or resolved_config.yaml
```

If writing NPY directly in Rust, test the header and shape by loading the files with NumPy. Do not invent a custom undocumented binary format.

### Duplicate frames

The current dataset has one frame per pixel. Still handle counts explicitly.

If several frames map to the same pixel:

- process each A-line independently;
- average linear envelopes by default;
- only average signed RF when trigger phase stability is established;
- record the count per pixel;
- expose missing and duplicate pixels in diagnostics.

---

## 9. GUI design

Preserve the current visual language. Add a reconstruction-mode switch near the image controls:

```text
[ PTP 2D ] [ Classical 3D ]
```

### 9.1 Source panel

Keep:

- Open Legacy Bin
- frame index and Load Frame
- file summary
- block/frame continuity
- grid dimensions
- detected sample-count range

Add:

- adjacent metadata status;
- source-format summary;
- explicit valid source sample range;
- warning when sample count differs between frames;
- warning that a flat 2056-sample interpretation is invalid.

### 9.2 A-line panel

Show selectable overlays:

```text
raw current
baseline-corrected
filtered signed RF
Hilbert envelope
baseline window
processing window
output window
```

Controls:

- zoom;
- baseline-window selection;
- processing-window selection;
- output-window selection;
- reset from metadata;
- save as local preset.

Metrics:

- median baseline;
- baseline noise MAD/RMS;
- positive and negative peaks;
- PTP in output gate;
- envelope peak;
- peak sample/time;
- relative depth;
- saturation/clipping flags.

The chart must state whether time is source time or valid-trace time.

### 9.3 Reconstruction settings panel

Add visible inputs:

```text
sample interval / sampling rate
sample start index
sample end trim
baseline start/stop
processing start/stop
output start/stop
band-pass low/high
Butterworth order
sound speed
t0
relative/absolute depth mode
transimpedance
VFS
zero ADC code
chunk rows
save filtered RF
output directory
```

Show derived values before Run:

```text
effective valid samples
Ny × Nx × Nz
Nyquist frequency
one-way depth sample spacing
depth range
estimated envelope bytes
estimated optional filtered-RF bytes
```

Disable Run when validation fails. Display the exact reason next to the relevant field.

### 9.4 Volume viewer

Provide tabs:

```text
XY MAP
XZ B-scan
YZ B-scan
XY C-scan
3D overview (optional, not required for first delivery)
```

Controls:

- y index for XZ;
- x index for YZ;
- z index/depth for C-scan;
- linear/dB display;
- display dynamic range;
- colormap;
- rotation for display only;
- coordinate readout;
- selected pixel.

The numerical volume stays linear. Percentile enhancement, normalization, rotation and colormaps apply only to the displayed raster.

When the user clicks the MAP or C-scan:

- load the corresponding raw A-line from the original file;
- load or compute its filtered RF and envelope;
- synchronize x/y/z cursors across views;
- show its source frame index and metadata.

### 9.5 Progress and cancellation

Reuse the current progress style:

- stage;
- processed frames/rows;
- percentage;
- throughput;
- elapsed time;
- estimated remaining time;
- Cancel button.

Ignore stale progress events by request ID. If settings change during a run, mark the result stale and require a new run rather than relabeling old data with new parameters.

### 9.6 Save/export

Separate:

```text
Save Numerical Reconstruction
Save Current View PNG
Export Run Metadata
```

PNG export is not a substitute for saving the volume.

---

## 10. Diagnostics and metadata

Save:

- source filename and size;
- block/frame layout;
- sample-count range;
- input metadata and metadata magic validation;
- x/y dimensions and coordinates;
- sample interval and sampling rate;
- sample start and end trim;
- baseline, processing and output windows;
- filter type, order and cutoffs;
- sound speed and `t0`;
- one-way depth equation;
- relative-depth flag;
- data units;
- output shape and axis order;
- per-pixel frame counts;
- missing/duplicate pixel counts;
- invalid-frame count;
- all-zero A-line count;
- raw ADC min/max clipping counts;
- NaN/Inf counts;
- processing timestamp;
- application version and Git commit when available.

Generate QC products:

```text
qc/
├── representative_raw_alines.png
├── representative_filtered_alines.png
├── representative_envelopes.png
├── signal_and_noise_spectrum.png
├── map_xy_linear.png
├── map_xy_db.png
├── bscan_xz.png
├── bscan_yz.png
└── cscan_xy.png
```

For CarbonfiberH2, compare the 3D envelope MAP against the existing PTP image and report Pearson correlation as a diagnostic. Do not optimize parameters to maximize that correlation automatically.

---

## 11. Strict exclusions

Do not silently add:

- SAFT;
- delay-and-sum;
- backprojection;
- time reversal;
- model-based inversion;
- deconvolution;
- Gaussian, median or TV smoothing;
- learned denoising;
- vesselness filtering;
- surface flattening;
- motion correction;
- per-A-line normalization;
- per-B-scan normalization;
- per-depth-slice normalization;
- logarithmic compression of saved numerical data;
- adaptive threshold cleanup;
- fake interpolation along z;
- multi-focus fusion.

These may become separately named future modes, but they must not alter the classical baseline.

---

## 12. Test-first implementation

Use vertical TDD slices at public seams.

### 12.1 Legacy parsing fixture

Create a synthetic legacy file containing:

- at least two blocks;
- 32-byte block headers;
- 16-byte frame headers;
- 32-byte PA metadata with valid magic;
- known 2032-sample i16 waveforms;
- a small 2 × 3 metadata-addressed grid;
- deliberately serpentine frame order.

Verify:

- sample data excludes every header and metadata byte;
- detected sample count is exactly 2032;
- placement follows `x_idx,y_idx`, not frame order;
- invalid magic and short frames produce actionable errors.

This test must fail for a flat `offset=640, shape=[frames,2056]` parser.

### 12.2 Window mapping

Verify:

```text
sampleStartIndex = 10
sampleEndTrim = 50
sampleCount = 2032
valid source range = [10,1982)
```

Verify time-to-source-index conversion and half-open semantics.

### 12.3 Baseline

Use A-lines with different DC offsets and pulse amplitudes. Verify:

- baseline-window median is approximately zero after subtraction;
- a 1:2 input pulse-amplitude ratio remains approximately 1:2.

### 12.4 Zero-phase filter

Use a Gaussian-windowed sinusoid at a known sample. Compare the Rust output with a SciPy golden fixture and verify no systematic peak shift.

### 12.5 Hilbert envelope

Use a modulated Gaussian with a known envelope. Compare away from boundaries with a SciPy fixture.

### 12.6 Depth

For a pulse at valid index `m`, verify:

```text
z = c * (m/fs - t0)
```

Explicitly assert that the result is not divided by two.

### 12.7 Volume construction

Generate multiple synthetic absorbers at known x, y, depth and amplitudes. Verify:

- output shape is `[Ny,Nx,Nz]`;
- peaks are at the expected coordinates;
- relative amplitudes are preserved;
- metadata placement works under serpentine frame order;
- chunked and unchunked outputs agree.

### 12.8 Output files

Load the saved `.npy` files with NumPy and verify:

- shape;
- dtype;
- axis order;
- coordinate lengths;
- finite values;
- linear amplitude;
- metadata consistency.

### 12.9 GUI tests

Add Vitest coverage for:

- mode switching without destroying the existing PTP view;
- invalid parameters disabling Run;
- metadata preset loading;
- progress events scoped by request ID;
- cancellation;
- stale settings/results;
- MAP/B-scan/C-scan selector synchronization;
- selected-pixel trace loading;
- numerical save versus PNG save;
- dB/percentile settings affecting display only.

### 12.10 Real-data smoke test

Provide an opt-in, non-CI command using:

```text
E:\Codex_Data\3D_PAM\share\data\20260706\CarbonfiberH2_1\legacy.bin
```

Verify:

- 20 blocks;
- 160000 frames;
- 400 × 400 grid;
- 2032 waveform samples per frame;
- no header/metadata samples in A-lines;
- successful output creation;
- finite `[400,400,Nz]` envelope;
- visible carbon-fiber structure in MAP;
- saved diagnostics and QC.

Do not commit the raw file or large reconstructed volumes.

---

## 13. Acceptance criteria

The work is complete only when:

1. the existing 2D PTP workflow still passes its tests;
2. `legacy.bin` is parsed through the verified block/frame/metadata reader;
3. no header or metadata word enters an A-line;
4. frame placement uses `x_idx,y_idx`;
5. baseline subtraction is per A-line and uses the median;
6. filtering is Butterworth SOS and zero phase;
7. Hilbert operates only along time;
8. the saved envelope is linear float32 `[y,x,z]`;
9. depth uses one-way propagation with no `/2`;
10. output depth coordinates retain the correct time indices;
11. no per-A-line or per-slice normalization is applied;
12. large volumes are not sent whole through Tauri JSON IPC;
13. progress, cancellation and stale-request handling work;
14. numerical outputs and metadata are saved;
15. MAP, XZ, YZ, C-scan and selected-pixel traces work;
16. Rust, TypeScript, build and integration tests pass;
17. the real CarbonfiberH2 smoke test reports 2032 waveform samples, not 2056;
18. the implementation clearly labels uncalibrated `t0` depth as relative.

---

## 14. Required final report

After implementation, report:

1. files created and modified;
2. the final module interfaces;
3. the exact legacy frame layout used;
4. the exact A-line processing order;
5. the GUI workflow;
6. memory and IPC strategy;
7. numerical output files and axis order;
8. test commands and complete results;
9. real-data smoke-test results;
10. unresolved assumptions;
11. whether `t0`, sound speed and absolute absorption are calibrated;
12. screenshots of PTP 2D, envelope MAP, XZ, YZ, C-scan and selected-pixel traces.

Do not claim completion until the tests and real-data smoke test have actually been executed and inspected.
