# PA Image Viewer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a PA Imaging secondary page that saves captures as Python-compatible legacy `.bin`, parses stored files, lets the user inspect raw frames and select a PTP ROI, builds a PTP image, and shows a live preview during TCP capture.

**Architecture:** Rust/Tauri owns all large-file parsing, legacy file reconstruction, PTP calculation, and live accumulation so 600MB-3GB captures are not copied into React. React owns controls, frame-trace interaction, heatmap drawing, and progress/status display. Offline image rebuild is the source of truth; live image is a throttled preview that uses the same processing configuration.

**Tech Stack:** Rust 2021 with Tauri 2 commands, React 18, TypeScript, Vitest, existing canvas plotting utilities, no new npm dependencies.

---

## File Structure

- Create `tauri_control_console/src-tauri/src/pa_image.rs`: legacy bin parser, metadata decoder, frame extraction, PTP image builder, severity diagnostics, synthetic test-file helpers.
- Modify `tauri_control_console/src-tauri/src/main.rs`: register PA image commands and route file dialogs.
- Modify `tauri_control_console/src-tauri/src/pa_stream.rs`: write receiver output as legacy `.bin` and feed live image accumulator.
- Create `tauri_control_console/src/utils/paImage.ts`: frontend processing defaults, signed ADA4355 conversion helpers, ROI/index helpers, and display formatting.
- Create `tauri_control_console/src/utils/paImageTauri.ts`: typed wrappers around PA image Tauri commands.
- Create `tauri_control_console/src/components/PaImageViewer.tsx`: secondary page UI for source summary, frame trace, ROI selection, and heatmap.
- Create `tauri_control_console/src/components/PaImageHeatmap.tsx`: canvas heatmap renderer with hover readout and percentile contrast.
- Modify `tauri_control_console/src/components/PaImagingPanel.tsx`: add `image` secondary view and entry button.
- Modify `tauri_control_console/src/App.tsx`: pass `tzOhm` into `PaImagingPanel`.
- Modify `tauri_control_console/src/styles.css`: PA image viewer layout, heatmap, trace controls, severity badges.
- Add tests:
  - `tauri_control_console/src/__tests__/paImage.test.ts`
  - `tauri_control_console/src/__tests__/paImageViewerLayout.test.tsx`
  - Rust unit tests inside `pa_image.rs` and `pa_stream.rs`.

## Task 1: Rust Legacy Parser And PTP Core

**Files:**
- Create: `tauri_control_console/src-tauri/src/pa_image.rs`

- [ ] **Step 1: Write failing Rust parser tests**

Add a `#[cfg(test)] mod tests` in `pa_image.rs` with these tests:

```rust
#[test]
fn parses_little_endian_metadata_magic_and_indices() {
    let mut raw = [0u8; 32];
    raw[4..8].copy_from_slice(&7u32.to_le_bytes());
    raw[8..10].copy_from_slice(&5u16.to_le_bytes());
    raw[10..12].copy_from_slice(&4u16.to_le_bytes());
    raw[12..14].copy_from_slice(&3u16.to_le_bytes());
    raw[14..16].copy_from_slice(&2u16.to_le_bytes());
    raw[16..18].copy_from_slice(&1u16.to_le_bytes());
    raw[18..20].copy_from_slice(&9u16.to_le_bytes());
    raw[20..22].copy_from_slice(&(-120i16).to_le_bytes());
    raw[22..24].copy_from_slice(&(320i16).to_le_bytes());
    raw[24..28].copy_from_slice(&11u32.to_le_bytes());
    raw[28..32].copy_from_slice(&PA_META_MAGIC.to_le_bytes());

    let meta = parse_metadata(&raw).expect("metadata parses");

    assert_eq!(meta.global_shot_idx, 7);
    assert_eq!(meta.y_points, 5);
    assert_eq!(meta.x_points, 4);
    assert_eq!(meta.frame_number, 3);
    assert_eq!(meta.frame_idx, 2);
    assert_eq!(meta.y_idx, 1);
    assert_eq!(meta.x_idx, 9);
    assert_eq!(meta.current_y, -120);
    assert_eq!(meta.current_x, 320);
    assert_eq!(meta.task_id, 11);
}

#[test]
fn computes_ptp_after_baseline_subtraction_from_signed_codes() {
    let samples = vec![0i16, 0, 0, -32768, 32767, 0];
    let config = PaImageProcessingConfig {
        sample_interval_ns: 8.0,
        sample_start_index: 0,
        sample_end_trim: 0,
        baseline_start_ns: 0.0,
        baseline_end_ns: 16.0,
        ptp_start_ns: 24.0,
        ptp_end_ns: 40.0,
        tz_ohm: 2000.0,
        vfs: 1.0,
    };

    let result = compute_frame_ptp(&samples, &config).expect("ptp");

    assert!(result > 999.0);
    assert!(result < 1001.0);
}

#[test]
fn scans_synthetic_legacy_file_without_hardcoding_sample_count() {
    let path = write_synthetic_legacy_file("pa_scan_sample_count", 2, 6);

    let summary = scan_legacy_file(&path).expect("scan");

    assert_eq!(summary.severity, PaSeverity::Ok);
    assert_eq!(summary.frame_count, 2);
    assert_eq!(summary.detected_sample_count_min, 6);
    assert_eq!(summary.detected_sample_count_max, 6);
}
```

- [ ] **Step 2: Run Rust tests and verify they fail**

Run:

```bash
cd /home/qian/Portable_System_Project/Butterfly_Laser_Driver/tauri_control_console/src-tauri
cargo test pa_image::tests -- --nocapture
```

Expected: compile failure because `pa_image.rs`, `parse_metadata`, `compute_frame_ptp`, `PaImageProcessingConfig`, `scan_legacy_file`, and `write_synthetic_legacy_file` do not exist yet.

- [ ] **Step 3: Implement parser types and functions**

Create `pa_image.rs` with these public interfaces and behavior:

```rust
pub const PA_META_MAGIC: u32 = 0x4D45_5441;
pub const AXIS_BLOCK_HEADER_BYTES: usize = 32;
pub const AXIS_FRAME_HEADER_BYTES: usize = 16;
pub const PA_METADATA_BYTES: usize = 32;

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PaSeverity {
    Ok,
    Warning,
    Error,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct PaParseIssue {
    pub severity: PaSeverity,
    pub message: String,
    pub block_id: Option<u64>,
    pub frame_id: Option<u64>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct PaFrameMetadata {
    pub reserved: u32,
    pub global_shot_idx: u32,
    pub y_points: u16,
    pub x_points: u16,
    pub frame_number: u16,
    pub frame_idx: u16,
    pub y_idx: u16,
    pub x_idx: u16,
    pub current_y: i16,
    pub current_x: i16,
    pub task_id: u32,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct PaFileSummary {
    pub path: String,
    pub file_size: u64,
    pub block_count: u64,
    pub frame_count: u64,
    pub bad_frame_count: u64,
    pub detected_x_points: Option<u16>,
    pub detected_y_points: Option<u16>,
    pub detected_frame_number: Option<u16>,
    pub detected_sample_count_min: usize,
    pub detected_sample_count_max: usize,
    pub severity: PaSeverity,
    pub issues: Vec<PaParseIssue>,
}

#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
pub struct PaImageProcessingConfig {
    pub sample_interval_ns: f64,
    pub sample_start_index: usize,
    pub sample_end_trim: usize,
    pub baseline_start_ns: f64,
    pub baseline_end_ns: f64,
    pub ptp_start_ns: f64,
    pub ptp_end_ns: f64,
    pub tz_ohm: f64,
    pub vfs: f64,
}
```

Use little-endian decoding for block and frame headers. Parse samples with `i16::from_le_bytes`. Compute sample count as `(frame_header.data_bytes as usize - PA_METADATA_BYTES) / 2` after validating the payload is at least 32 bytes. Convert signed sample code using the Python formula:

```rust
pub fn signed_code_to_current_ua(code: i16, tz_ohm: f64, vfs: f64) -> f64 {
    let v_adc = (code as f64) / 32768.0 * vfs;
    ((0.825 - v_adc) / tz_ohm) * 1_000_000.0
}
```

For `compute_frame_ptp`, first apply `sample_start_index` and `sample_end_trim`, then treat the sliced trace as time zero. Baseline is the mean current in `[baseline_start_ns, baseline_end_ns]`. PTP is `max(corrected_roi) - min(corrected_roi)` for `[ptp_start_ns, ptp_end_ns]`.

- [ ] **Step 4: Run Rust parser tests and verify they pass**

Run:

```bash
cd /home/qian/Portable_System_Project/Butterfly_Laser_Driver/tauri_control_console/src-tauri
cargo test pa_image::tests -- --nocapture
```

Expected: all `pa_image::tests` pass.

- [ ] **Step 5: Commit parser core**

Run:

```bash
cd /home/qian/Portable_System_Project/Butterfly_Laser_Driver
git add tauri_control_console/src-tauri/src/pa_image.rs
git commit -m "Add PA legacy parser core"
```

## Task 2: Offline Tauri Commands

**Files:**
- Modify: `tauri_control_console/src-tauri/src/main.rs`
- Modify: `tauri_control_console/src-tauri/src/pa_image.rs`

- [ ] **Step 1: Write failing command-level Rust tests**

Add tests in `main.rs` or `pa_image.rs` that call path-based functions directly:

```rust
#[test]
fn builds_image_from_synthetic_repeated_pixels() {
    let path = pa_image::write_synthetic_grid_file("pa_build_image", 2, 2, 2);
    let config = pa_image::PaImageProcessingConfig::default_for_tz(2000.0);

    let image = pa_image::build_image_from_legacy_file(&path, &config).expect("image");

    assert_eq!(image.width, 2);
    assert_eq!(image.height, 2);
    assert_eq!(image.pixel_count, 4);
    assert_eq!(image.frame_count, 8);
    assert_eq!(image.counts, vec![2, 2, 2, 2]);
}

#[test]
fn extracts_one_frame_trace_with_time_axis() {
    let path = pa_image::write_synthetic_legacy_file("pa_frame_trace", 1, 5);

    let trace = pa_image::read_frame_trace_from_legacy_file(&path, 0, 2000.0).expect("trace");

    assert_eq!(trace.samples.len(), 5);
    assert_eq!(trace.time_ns, vec![0.0, 8.0, 16.0, 24.0, 32.0]);
    assert_eq!(trace.frame_index, 0);
}
```

- [ ] **Step 2: Run command tests and verify they fail**

Run:

```bash
cd /home/qian/Portable_System_Project/Butterfly_Laser_Driver/tauri_control_console/src-tauri
cargo test builds_image_from_synthetic_repeated_pixels extracts_one_frame_trace_with_time_axis -- --nocapture
```

Expected: compile failure because `build_image_from_legacy_file`, `read_frame_trace_from_legacy_file`, and synthetic grid helper do not exist yet.

- [ ] **Step 3: Add image and trace return types**

Add these serializable result types in `pa_image.rs`:

```rust
#[derive(Debug, Clone, serde::Serialize)]
pub struct PaFrameTrace {
    pub path: String,
    pub frame_index: u64,
    pub frame_id: u64,
    pub metadata: Option<PaFrameMetadata>,
    pub time_ns: Vec<f64>,
    pub samples: Vec<i16>,
    pub current_ua: Vec<f64>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct PaImageBuildResult {
    pub path: String,
    pub width: usize,
    pub height: usize,
    pub values: Vec<Option<f64>>,
    pub counts: Vec<u32>,
    pub pixel_count: u64,
    pub frame_count: u64,
    pub bad_frame_count: u64,
    pub severity: PaSeverity,
    pub issues: Vec<PaParseIssue>,
}
```

Use row-major `values[y * width + x]`. Store missing pixels as `None` so frontend can render a neutral color. Average repeated pixels by keeping sum and count arrays, then produce `Some(sum / count)`.

- [ ] **Step 4: Add Tauri commands**

In `main.rs`, add `mod pa_image;` and register these commands:

```rust
#[tauri::command]
fn pa_image_pick_file() -> Result<Option<String>, String> {
    let default_dir = default_data_dir()?;
    let Some(path) = rfd::FileDialog::new()
        .set_directory(&default_dir)
        .add_filter("PA legacy bin", &["bin"])
        .pick_file()
    else {
        return Ok(None);
    };
    Ok(Some(path.display().to_string()))
}

#[tauri::command]
fn pa_image_scan_path(path: String) -> Result<pa_image::PaFileSummary, String> {
    pa_image::scan_legacy_file(std::path::Path::new(&path)).map_err(|err| err.to_string())
}

#[tauri::command]
fn pa_image_read_frame_path(path: String, frame_index: u64, tz_ohm: f64) -> Result<pa_image::PaFrameTrace, String> {
    pa_image::read_frame_trace_from_legacy_file(std::path::Path::new(&path), frame_index, tz_ohm)
        .map_err(|err| err.to_string())
}

#[tauri::command]
fn pa_image_build_path(
    path: String,
    config: pa_image::PaImageProcessingConfig,
) -> Result<pa_image::PaImageBuildResult, String> {
    pa_image::build_image_from_legacy_file(std::path::Path::new(&path), &config).map_err(|err| err.to_string())
}
```

Add these names to `tauri::generate_handler!`.

- [ ] **Step 5: Run Rust command tests and cargo check**

Run:

```bash
cd /home/qian/Portable_System_Project/Butterfly_Laser_Driver/tauri_control_console/src-tauri
cargo test pa_image -- --nocapture
cargo check
```

Expected: tests pass and `cargo check` exits 0.

- [ ] **Step 6: Commit offline commands**

Run:

```bash
cd /home/qian/Portable_System_Project/Butterfly_Laser_Driver
git add tauri_control_console/src-tauri/src/main.rs tauri_control_console/src-tauri/src/pa_image.rs
git commit -m "Add PA image offline commands"
```

## Task 3: Save Receiver Output As Legacy Bin

**Files:**
- Modify: `tauri_control_console/src-tauri/src/pa_stream.rs`
- Modify: `tauri_control_console/src-tauri/src/pa_image.rs`

- [ ] **Step 1: Write failing receiver format test**

Add this test in `pa_stream.rs` tests:

```rust
#[test]
fn writes_data_record_payload_as_legacy_block() {
    let mut out = Vec::<u8>::new();
    let payload = vec![1u8, 2, 3, 4];
    write_legacy_block_record(&mut out, 9, payload.len() as u64, 2, 100, 101, &payload)
        .expect("legacy write");

    assert_eq!(out.len(), 36);
    assert_eq!(u64::from_le_bytes(out[0..8].try_into().unwrap()), 9);
    assert_eq!(u32::from_le_bytes(out[8..12].try_into().unwrap()), 4);
    assert_eq!(u32::from_le_bytes(out[12..16].try_into().unwrap()), 2);
    assert_eq!(u64::from_le_bytes(out[16..24].try_into().unwrap()), 100);
    assert_eq!(u64::from_le_bytes(out[24..32].try_into().unwrap()), 101);
    assert_eq!(&out[32..36], &[1, 2, 3, 4]);
}
```

- [ ] **Step 2: Run receiver format test and verify it fails**

Run:

```bash
cd /home/qian/Portable_System_Project/Butterfly_Laser_Driver/tauri_control_console/src-tauri
cargo test writes_data_record_payload_as_legacy_block -- --nocapture
```

Expected: compile failure because `write_legacy_block_record` does not exist.

- [ ] **Step 3: Implement legacy DATA writing**

Add helper in `pa_stream.rs`:

```rust
fn write_legacy_block_record<W: Write>(
    output: &mut W,
    block_id: u64,
    used_bytes: u64,
    frame_count: u32,
    first_frame_id: u64,
    last_frame_id: u64,
    payload: &[u8],
) -> io::Result<()> {
    let used = u32::try_from(used_bytes)
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidData, "PA block payload exceeds u32 used_bytes"))?;
    output.write_all(&block_id.to_le_bytes())?;
    output.write_all(&used.to_le_bytes())?;
    output.write_all(&frame_count.to_le_bytes())?;
    output.write_all(&first_frame_id.to_le_bytes())?;
    output.write_all(&last_frame_id.to_le_bytes())?;
    output.write_all(payload)?;
    Ok(())
}
```

In `run_receiver_loop`, keep reading every `PAI1` record from TCP, but write only `record_type == 2` DATA records to the output file. For DATA records, write the reconstructed legacy block header using:

- `block_id` from header bytes `36..44`
- `used_bytes` from `payload_bytes`
- `frame_count` from header bytes `44..48`
- `first_frame_id` from header bytes `52..60`
- `last_frame_id` from header bytes `60..68`
- payload bytes exactly as received

Do not write metadata, status, end, or error records into the saved `.bin`.

- [ ] **Step 4: Verify receiver format test and parser compatibility**

Run:

```bash
cd /home/qian/Portable_System_Project/Butterfly_Laser_Driver/tauri_control_console/src-tauri
cargo test writes_data_record_payload_as_legacy_block -- --nocapture
cargo test pa_image::tests -- --nocapture
```

Expected: tests pass.

- [ ] **Step 5: Commit legacy receiver output**

Run:

```bash
cd /home/qian/Portable_System_Project/Butterfly_Laser_Driver
git add tauri_control_console/src-tauri/src/pa_stream.rs tauri_control_console/src-tauri/src/pa_image.rs
git commit -m "Save PA receiver output as legacy bin"
```

## Task 4: Frontend PA Image Utilities And Tauri Wrappers

**Files:**
- Create: `tauri_control_console/src/utils/paImage.ts`
- Create: `tauri_control_console/src/utils/paImageTauri.ts`
- Create: `tauri_control_console/src/__tests__/paImage.test.ts`

- [ ] **Step 1: Write failing TypeScript utility tests**

Create `paImage.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  DEFAULT_PA_IMAGE_PROCESSING,
  indexRangeToNsWindow,
  signedAdcCodeToCurrentMicroamp,
  timeNsForSampleIndex,
} from "../utils/paImage";

describe("PA image utilities", () => {
  it("matches the Python ADA4355 signed-code conversion", () => {
    expect(signedAdcCodeToCurrentMicroamp(0, 2000, 1)).toBeCloseTo(412.5, 6);
    expect(signedAdcCodeToCurrentMicroamp(32767, 2000, 1)).toBeCloseTo(-87.484741, 5);
    expect(signedAdcCodeToCurrentMicroamp(-32768, 2000, 1)).toBeCloseTo(912.5, 6);
  });

  it("keeps processing defaults aligned with the Python workflow", () => {
    expect(DEFAULT_PA_IMAGE_PROCESSING.sampleIntervalNs).toBe(8);
    expect(DEFAULT_PA_IMAGE_PROCESSING.sampleStartIndex).toBe(10);
    expect(DEFAULT_PA_IMAGE_PROCESSING.sampleEndTrim).toBe(50);
    expect(DEFAULT_PA_IMAGE_PROCESSING.baselineStartNs).toBe(100);
    expect(DEFAULT_PA_IMAGE_PROCESSING.baselineEndNs).toBe(400);
    expect(DEFAULT_PA_IMAGE_PROCESSING.ptpStartNs).toBe(1600);
    expect(DEFAULT_PA_IMAGE_PROCESSING.ptpEndNs).toBe(2400);
  });

  it("maps selected source indices to a ns processing window after sample slicing", () => {
    expect(timeNsForSampleIndex(10, 10, 8)).toBe(0);
    expect(timeNsForSampleIndex(30, 10, 8)).toBe(160);
    expect(indexRangeToNsWindow(30, 20, 10, 8)).toEqual({ startNs: 80, endNs: 160 });
  });
});
```

- [ ] **Step 2: Run TypeScript test and verify it fails**

Run:

```bash
cd /home/qian/Portable_System_Project/Butterfly_Laser_Driver/tauri_control_console
PATH=/home/qian/.local/nodejs/bin:$PATH npm test -- --run src/__tests__/paImage.test.ts
```

Expected: compile failure because `utils/paImage.ts` does not exist.

- [ ] **Step 3: Implement frontend utility module**

Create `utils/paImage.ts` with:

```ts
export type PaSeverity = "ok" | "warning" | "error";

export type PaImageProcessing = {
  sampleIntervalNs: number;
  sampleStartIndex: number;
  sampleEndTrim: number;
  baselineStartNs: number;
  baselineEndNs: number;
  ptpStartNs: number;
  ptpEndNs: number;
  tzOhm: number;
  vfs: number;
};

export const DEFAULT_PA_IMAGE_PROCESSING: PaImageProcessing = {
  sampleIntervalNs: 8,
  sampleStartIndex: 10,
  sampleEndTrim: 50,
  baselineStartNs: 100,
  baselineEndNs: 400,
  ptpStartNs: 1600,
  ptpEndNs: 2400,
  tzOhm: 2000,
  vfs: 1,
};

export function signedAdcCodeToCurrentMicroamp(code: number, tzOhm = 2000, vfs = 1): number {
  const signed = Math.max(-32768, Math.min(32767, Math.round(code)));
  const vAdc = (signed / 32768) * vfs;
  return ((0.825 - vAdc) / Math.max(1, tzOhm)) * 1_000_000;
}

export function timeNsForSampleIndex(sourceIndex: number, sampleStartIndex: number, sampleIntervalNs: number): number {
  return Math.max(0, Math.round(sourceIndex - sampleStartIndex)) * sampleIntervalNs;
}

export function indexRangeToNsWindow(
  startIndex: number,
  endIndex: number,
  sampleStartIndex: number,
  sampleIntervalNs: number,
): { startNs: number; endNs: number } {
  const first = Math.min(startIndex, endIndex);
  const last = Math.max(startIndex, endIndex);
  return {
    startNs: timeNsForSampleIndex(first, sampleStartIndex, sampleIntervalNs),
    endNs: timeNsForSampleIndex(last, sampleStartIndex, sampleIntervalNs),
  };
}
```

- [ ] **Step 4: Implement typed Tauri wrappers**

Create `utils/paImageTauri.ts`:

```ts
import { invoke } from "@tauri-apps/api/core";
import type { PaImageProcessing, PaSeverity } from "./paImage";

export type PaFileSummary = {
  path: string;
  file_size: number;
  block_count: number;
  frame_count: number;
  bad_frame_count: number;
  detected_x_points?: number;
  detected_y_points?: number;
  detected_frame_number?: number;
  detected_sample_count_min: number;
  detected_sample_count_max: number;
  severity: PaSeverity;
  issues: Array<{ severity: PaSeverity; message: string; block_id?: number; frame_id?: number }>;
};

export type PaFrameTrace = {
  path: string;
  frame_index: number;
  frame_id: number;
  metadata?: Record<string, number>;
  time_ns: number[];
  samples: number[];
  current_ua: number[];
};

export type PaImageBuildResult = {
  path: string;
  width: number;
  height: number;
  values: Array<number | null>;
  counts: number[];
  pixel_count: number;
  frame_count: number;
  bad_frame_count: number;
  severity: PaSeverity;
  issues: Array<{ severity: PaSeverity; message: string; block_id?: number; frame_id?: number }>;
};

export function rustProcessingConfig(config: PaImageProcessing) {
  return {
    sample_interval_ns: config.sampleIntervalNs,
    sample_start_index: config.sampleStartIndex,
    sample_end_trim: config.sampleEndTrim,
    baseline_start_ns: config.baselineStartNs,
    baseline_end_ns: config.baselineEndNs,
    ptp_start_ns: config.ptpStartNs,
    ptp_end_ns: config.ptpEndNs,
    tz_ohm: config.tzOhm,
    vfs: config.vfs,
  };
}

export const pickPaImageFile = () => invoke<string | null>("pa_image_pick_file");
export const scanPaImageFile = (path: string) => invoke<PaFileSummary>("pa_image_scan_path", { path });
export const readPaFrameTrace = (path: string, frameIndex: number, tzOhm: number) =>
  invoke<PaFrameTrace>("pa_image_read_frame_path", { path, frameIndex, tzOhm });
export const buildPaImage = (path: string, config: PaImageProcessing) =>
  invoke<PaImageBuildResult>("pa_image_build_path", { path, config: rustProcessingConfig(config) });
```

- [ ] **Step 5: Verify frontend utility tests**

Run:

```bash
cd /home/qian/Portable_System_Project/Butterfly_Laser_Driver/tauri_control_console
PATH=/home/qian/.local/nodejs/bin:$PATH npm test -- --run src/__tests__/paImage.test.ts
```

Expected: test file passes.

- [ ] **Step 6: Commit frontend utilities**

Run:

```bash
cd /home/qian/Portable_System_Project/Butterfly_Laser_Driver
git add tauri_control_console/src/utils/paImage.ts tauri_control_console/src/utils/paImageTauri.ts tauri_control_console/src/__tests__/paImage.test.ts
git commit -m "Add PA image frontend utilities"
```

## Task 5: PA Image Viewer UI

**Files:**
- Create: `tauri_control_console/src/components/PaImageHeatmap.tsx`
- Create: `tauri_control_console/src/components/PaImageViewer.tsx`
- Create: `tauri_control_console/src/__tests__/paImageViewerLayout.test.tsx`
- Modify: `tauri_control_console/src/styles.css`

- [ ] **Step 1: Write failing viewer layout test**

Create `paImageViewerLayout.test.tsx`:

```tsx
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import PaImageViewer from "../components/PaImageViewer";

describe("PA Image Viewer layout", () => {
  it("renders source controls, ROI controls, trace, and image preview", () => {
    const html = renderToStaticMarkup(<PaImageViewer active tzOhm={2000} onBack={() => undefined} />);

    expect(html).toContain("PA Image Viewer");
    expect(html).toContain("Open Legacy Bin");
    expect(html).toContain("Build Image");
    expect(html).toContain("PTP ROI");
    expect(html).toContain("Frame Trace");
    expect(html).toContain("PA Image");
    expect(html).toContain("Zoom");
    expect(html).toContain("Set ROI");
  });
});
```

- [ ] **Step 2: Run layout test and verify it fails**

Run:

```bash
cd /home/qian/Portable_System_Project/Butterfly_Laser_Driver/tauri_control_console
PATH=/home/qian/.local/nodejs/bin:$PATH npm test -- --run src/__tests__/paImageViewerLayout.test.tsx
```

Expected: compile failure because `PaImageViewer` does not exist.

- [ ] **Step 3: Implement heatmap canvas**

Create `PaImageHeatmap.tsx` with props:

```ts
type Props = {
  width: number;
  height: number;
  values: Array<number | null>;
  counts: number[];
  active?: boolean;
};
```

Render a `<canvas aria-label="PA image heatmap">`. In `useEffect`, draw row-major values. Compute finite value percentiles at 1% and 99% by sorting finite values. Missing values get `#e5e7eb`. Use a blue-green-yellow palette with restrained contrast:

```ts
function colorForUnit(value: number): string {
  const v = Math.max(0, Math.min(1, value));
  const r = Math.round(20 + 215 * Math.max(0, v - 0.45) / 0.55);
  const g = Math.round(90 + 150 * (1 - Math.abs(v - 0.55)));
  const b = Math.round(140 * (1 - v));
  return `rgb(${r}, ${g}, ${b})`;
}
```

Keep pixel cells square when possible and leave a small axis margin for labels.

- [ ] **Step 4: Implement viewer component**

Create `PaImageViewer.tsx` with:

- `Open Legacy Bin` button using `pickPaImageFile()` then `scanPaImageFile(path)`.
- `Frame Index` input and `Load Frame` button using `readPaFrameTrace`.
- `Frame Trace` using existing `PlotCanvas`.
- A segmented mode control: `Zoom` and `Set ROI`.
- In `Zoom` mode, `PlotCanvas.onSelectionComplete` updates trace zoom range.
- In `Set ROI` mode, `PlotCanvas.onSelectionComplete` converts selected sample indices with `indexRangeToNsWindow` and updates `ptpStartNs/ptpEndNs`.
- Right click on trace calls `restoreTraceZoom`.
- `Build Image` button using `buildPaImage`.
- `PaImageHeatmap` for image result.
- Severity readout using classes `severity-ok`, `severity-warning`, `severity-error`.

Use `current_ua` as the displayed trace series and `time_ns` only for hover/readout text in the first version. Keep x-axis label as sample index so it can reuse `PlotCanvas` without changing its coordinate model.

- [ ] **Step 5: Add styles**

Add CSS classes:

```css
.pa-image-viewer {
  display: grid;
  gap: 12px;
}

.pa-image-workbench {
  display: grid;
  grid-template-columns: minmax(360px, 0.85fr) minmax(460px, 1fr);
  gap: 14px;
  align-items: start;
}

.pa-image-panel {
  border: 1px solid #d5dfeb;
  border-radius: 8px;
  background: #ffffff;
  padding: 12px;
}

.pa-image-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: end;
}

.pa-image-heatmap {
  width: 100%;
  min-height: 360px;
  border: 1px solid #d5dfeb;
  border-radius: 6px;
  background: #f8fafc;
}

.severity-ok {
  color: #15803d;
}

.severity-warning {
  color: #b45309;
}

.severity-error {
  color: #b91c1c;
}
```

- [ ] **Step 6: Verify viewer layout test**

Run:

```bash
cd /home/qian/Portable_System_Project/Butterfly_Laser_Driver/tauri_control_console
PATH=/home/qian/.local/nodejs/bin:$PATH npm test -- --run src/__tests__/paImageViewerLayout.test.tsx
```

Expected: test passes.

- [ ] **Step 7: Commit viewer UI**

Run:

```bash
cd /home/qian/Portable_System_Project/Butterfly_Laser_Driver
git add tauri_control_console/src/components/PaImageViewer.tsx tauri_control_console/src/components/PaImageHeatmap.tsx tauri_control_console/src/__tests__/paImageViewerLayout.test.tsx tauri_control_console/src/styles.css
git commit -m "Add PA image viewer UI"
```

## Task 6: Integrate Viewer As PA Imaging Secondary Page

**Files:**
- Modify: `tauri_control_console/src/components/PaImagingPanel.tsx`
- Modify: `tauri_control_console/src/App.tsx`
- Modify: `tauri_control_console/src/__tests__/paImagingPanelLayout.test.tsx`

- [ ] **Step 1: Write failing integration layout test**

Add this test to `paImagingPanelLayout.test.tsx`:

```tsx
it("keeps PA image viewer behind a secondary PA Imaging page", () => {
  const mainHtml = renderToStaticMarkup(<PaImagingPanel state={state} client={client} command={command} tzOhm={2000} />);

  expect(mainHtml).toContain("PA Image Viewer");
  expect(mainHtml).not.toContain("Open Legacy Bin");
  expect(mainHtml).not.toContain("Frame Trace");

  const viewerHtml = renderToStaticMarkup(
    <PaImagingPanel state={state} client={client} command={command} tzOhm={2000} initialView="image" />,
  );

  expect(viewerHtml).toContain("PA Image Viewer");
  expect(viewerHtml).toContain("Open Legacy Bin");
  expect(viewerHtml).toContain("Frame Trace");
  expect(viewerHtml).toContain("Back");
});
```

- [ ] **Step 2: Run integration layout test and verify it fails**

Run:

```bash
cd /home/qian/Portable_System_Project/Butterfly_Laser_Driver/tauri_control_console
PATH=/home/qian/.local/nodejs/bin:$PATH npm test -- --run src/__tests__/paImagingPanelLayout.test.tsx
```

Expected: TypeScript failure because `initialView="image"` is not assignable.

- [ ] **Step 3: Integrate component**

In `PaImagingPanel.tsx`:

- Import `PaImageViewer`.
- Change `type PaPanelView = "capture" | "timing" | "scan";` to:

```ts
type PaPanelView = "capture" | "timing" | "scan" | "image";
```

- Destructure `tzOhm = 2000` from props.
- Add:

```tsx
if (panelView === "image") {
  return <PaImageViewer active={active} tzOhm={tzOhm} onBack={() => setPanelView("capture")} />;
}
```

- Add a main capture page button near `Timing & Scan` and `Scan Settings`:

```tsx
<button type="button" className="command" onClick={() => setPanelView("image")}>
  PA Image Viewer
</button>
```

In `App.tsx`, pass `tzOhm={tzOhm}` to the PA Imaging tab:

```tsx
<PaImagingPanel state={state} client={client} command={command} active={tab === "PA Imaging"} tzOhm={tzOhm} />
```

- [ ] **Step 4: Verify layout tests**

Run:

```bash
cd /home/qian/Portable_System_Project/Butterfly_Laser_Driver/tauri_control_console
PATH=/home/qian/.local/nodejs/bin:$PATH npm test -- --run src/__tests__/paImagingPanelLayout.test.tsx src/__tests__/paImageViewerLayout.test.tsx
```

Expected: both test files pass.

- [ ] **Step 5: Commit integration**

Run:

```bash
cd /home/qian/Portable_System_Project/Butterfly_Laser_Driver
git add tauri_control_console/src/components/PaImagingPanel.tsx tauri_control_console/src/App.tsx tauri_control_console/src/__tests__/paImagingPanelLayout.test.tsx
git commit -m "Integrate PA image viewer page"
```

## Task 7: Live Image Preview Accumulator

**Files:**
- Modify: `tauri_control_console/src-tauri/src/pa_stream.rs`
- Modify: `tauri_control_console/src-tauri/src/pa_image.rs`
- Modify: `tauri_control_console/src-tauri/src/main.rs`
- Modify: `tauri_control_console/src/utils/paImageTauri.ts`
- Modify: `tauri_control_console/src/components/PaImageViewer.tsx`

- [ ] **Step 1: Write failing Rust live accumulator test**

Add test in `pa_stream.rs`:

```rust
#[test]
fn live_accumulator_updates_from_one_data_payload() {
    let accumulator = PaLiveImageAccumulator::new();
    let payload = pa_image::synthetic_block_payload_for_grid(2, 1, 1);
    let config = pa_image::PaImageProcessingConfig::default_for_tz(2000.0);

    accumulator.set_processing(config);
    accumulator.ingest_legacy_block_payload(&payload).expect("ingest");
    let image = accumulator.snapshot();

    assert_eq!(image.width, 2);
    assert_eq!(image.height, 1);
    assert_eq!(image.frame_count, 2);
    assert_eq!(image.counts, vec![1, 1]);
}
```

- [ ] **Step 2: Run live accumulator test and verify it fails**

Run:

```bash
cd /home/qian/Portable_System_Project/Butterfly_Laser_Driver/tauri_control_console/src-tauri
cargo test live_accumulator_updates_from_one_data_payload -- --nocapture
```

Expected: compile failure because `PaLiveImageAccumulator` does not exist.

- [ ] **Step 3: Implement live accumulator and commands**

Add a `PaLiveImageAccumulator` wrapper around the same sum/count image builder used by offline build. It must support:

```rust
impl PaLiveImageAccumulator {
    pub fn new() -> Self;
    pub fn reset(&self);
    pub fn set_processing(&self, config: pa_image::PaImageProcessingConfig);
    pub fn ingest_legacy_block_payload(&self, payload: &[u8]) -> Result<(), String>;
    pub fn snapshot(&self) -> pa_image::PaImageBuildResult;
}
```

Store the accumulator inside `PaTcpReceiver`. In `run_receiver_loop`, after a DATA payload is read and written to legacy output, call `ingest_legacy_block_payload(&payload)`.

Add Tauri commands:

```rust
#[tauri::command]
pub fn pa_receiver_set_image_processing(
    config: pa_image::PaImageProcessingConfig,
    receiver: tauri::State<'_, PaTcpReceiver>,
) -> Result<PaReceiverStatus, String> {
    receiver.set_image_processing(config);
    Ok(receiver.status())
}

#[tauri::command]
pub fn pa_receiver_live_image(
    receiver: tauri::State<'_, PaTcpReceiver>,
) -> Result<pa_image::PaImageBuildResult, String> {
    Ok(receiver.live_image())
}
```

Register both commands in `main.rs`.

- [ ] **Step 4: Add frontend live wrappers and polling**

In `paImageTauri.ts`, add:

```ts
export const setPaLiveImageProcessing = (config: PaImageProcessing) =>
  invoke("pa_receiver_set_image_processing", { config: rustProcessingConfig(config) });

export const readPaLiveImage = () => invoke<PaImageBuildResult>("pa_receiver_live_image");
```

In `PaImageViewer.tsx`, add a `Live Preview` button. When active, poll `readPaLiveImage()` every 500 ms while the viewer is active. Before starting PA capture in `PaImagingPanel`, call `setPaLiveImageProcessing(currentProcessing)` only if the viewer has saved a processing config; otherwise use defaults.

- [ ] **Step 5: Verify live accumulator**

Run:

```bash
cd /home/qian/Portable_System_Project/Butterfly_Laser_Driver/tauri_control_console/src-tauri
cargo test live_accumulator_updates_from_one_data_payload -- --nocapture
cargo check
cd /home/qian/Portable_System_Project/Butterfly_Laser_Driver/tauri_control_console
PATH=/home/qian/.local/nodejs/bin:$PATH npm test -- --run src/__tests__/paImage.test.ts src/__tests__/paImageViewerLayout.test.tsx
```

Expected: Rust and TypeScript tests pass.

- [ ] **Step 6: Commit live preview**

Run:

```bash
cd /home/qian/Portable_System_Project/Butterfly_Laser_Driver
git add tauri_control_console/src-tauri/src/pa_stream.rs tauri_control_console/src-tauri/src/pa_image.rs tauri_control_console/src-tauri/src/main.rs tauri_control_console/src/utils/paImageTauri.ts tauri_control_console/src/components/PaImageViewer.tsx
git commit -m "Add PA live image preview"
```

## Task 8: Full Verification

**Files:**
- Read: all files changed by Tasks 1-7

- [ ] **Step 1: Run full frontend tests**

Run:

```bash
cd /home/qian/Portable_System_Project/Butterfly_Laser_Driver/tauri_control_console
PATH=/home/qian/.local/nodejs/bin:$PATH npm test -- --run
```

Expected: all Vitest files pass.

- [ ] **Step 2: Run frontend build**

Run:

```bash
cd /home/qian/Portable_System_Project/Butterfly_Laser_Driver/tauri_control_console
PATH=/home/qian/.local/nodejs/bin:$PATH npm run build
```

Expected: `tsc && vite build` exits 0.

- [ ] **Step 3: Run Rust tests and cargo check**

Run:

```bash
cd /home/qian/Portable_System_Project/Butterfly_Laser_Driver/tauri_control_console/src-tauri
cargo test -- --nocapture
cargo check
```

Expected: Rust tests pass and `cargo check` exits 0.

- [ ] **Step 4: Manual compatibility smoke test with an existing file**

Use a small or representative existing file:

```bash
cd /home/qian/Portable_System_Project/Butterfly_Laser_Driver/tauri_control_console/src-tauri
cargo test scans_existing_pa_sample_file -- --nocapture
```

Add `scans_existing_pa_sample_file` only when `/media/qian/Data/CodeX/PA_Image_Processing/data/20260508/01-Butterfly_70p_Step_05_Pixel_800.bin` exists. The test should scan the first block, assert severity is not `error`, assert `detected_x_points == Some(400)`, `detected_y_points == Some(400)`, and `detected_sample_count_min == 2032`.

- [ ] **Step 5: Confirm no uncommitted task changes remain**

Run:

```bash
cd /home/qian/Portable_System_Project/Butterfly_Laser_Driver
git status --short
```

Expected: no uncommitted files from the PA image viewer tasks. If Step 1, Step 2, or Step 3 exposed a defect, return to the task that introduced the defect, apply the fix there, rerun that task's verification command, and use that task's commit command.

## Self-Review

Spec coverage:

- Legacy output: Task 3.
- Offline scan: Tasks 1 and 2.
- Frame trace display and zoom/ROI selection: Tasks 4, 5, and 6.
- PTP ROI persistence within viewer state: Task 5.
- Image build and repeated-pixel averaging: Tasks 1 and 2.
- Warning/error diagnostics: Tasks 1 and 2.
- Live preview during TCP transfer: Task 7.
- Tests and full verification: Task 8.

Type consistency:

- Rust command names in Task 2 match frontend wrapper names in Task 4.
- `PaImageProcessingConfig` snake_case fields match `rustProcessingConfig`.
- `PaImageBuildResult` row-major `values` and `counts` are consumed by `PaImageHeatmap`.
- `PaPanelView` includes `"image"` before the layout test uses `initialView="image"`.

Scope:

- The first complete user-visible workflow is offline file scan, trace ROI selection, and image build.
- Live preview is implemented after offline parsing because it reuses the same parser and accumulator.
