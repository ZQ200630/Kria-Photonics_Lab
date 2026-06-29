import { describe, expect, it } from "vitest";
import {
  DEFAULT_PA_IMAGE_PROCESSING,
  DEFAULT_PA_TRACE_DISPLAY_SAMPLES,
  defaultPaTraceDisplayDomain,
  formatUnknownError,
  indexRangeToNsWindow,
  findSimilarPaPixels,
  frameIndexForPaImagePixel,
  loadPaImageProcessingDefaults,
  mergePaImageBuildChunk,
  PA_IMAGE_ROI_STORAGE_KEY,
  savePaImageRoiDefaults,
  signedAdcCodeToCurrentMicroamp,
  timeNsForSampleIndex,
} from "../utils/paImage";
import { rustProcessingConfig, type PaFileSummary, type PaFrameTrace, type PaImageBuildResult } from "../utils/paImageTauri";

describe("PA image utilities", () => {
  function fakeStorage(initial: Record<string, string> = {}) {
    const store = { ...initial };
    return {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, value: string) => {
        store[key] = value;
      },
      removeItem: (key: string) => {
        delete store[key];
      },
      dump: () => ({ ...store }),
    };
  }

  it("matches the Python ADA4355 signed-code conversion", () => {
    expect(signedAdcCodeToCurrentMicroamp(0, 2000, 1)).toBeCloseTo(412.506104, 6);
    expect(signedAdcCodeToCurrentMicroamp(32767, 2000, 1)).toBeCloseTo(-87.478638, 6);
    expect(signedAdcCodeToCurrentMicroamp(-32768, 2000, 1)).toBeCloseTo(912.506104, 6);
  });

  it("applies shared zero ADC code before transimpedance scaling", () => {
    expect(signedAdcCodeToCurrentMicroamp(29620, 2000, 1, 29620)).toBeCloseTo(0, 6);
    expect(signedAdcCodeToCurrentMicroamp(29620, 20000, 1, 29620)).toBeCloseTo(0, 6);
    expect(signedAdcCodeToCurrentMicroamp(0x8dd3 - 0x10000, 20000, 1, 29620)).toBeCloseTo(89.796448, 6);
  });

  it("keeps processing defaults aligned with the Python workflow", () => {
    expect(DEFAULT_PA_IMAGE_PROCESSING.sampleIntervalNs).toBe(8);
    expect(DEFAULT_PA_IMAGE_PROCESSING.sampleStartIndex).toBe(10);
    expect(DEFAULT_PA_IMAGE_PROCESSING.sampleEndTrim).toBe(50);
    expect(DEFAULT_PA_IMAGE_PROCESSING.baselineStartNs).toBe(100);
    expect(DEFAULT_PA_IMAGE_PROCESSING.baselineEndNs).toBe(400);
    expect(DEFAULT_PA_IMAGE_PROCESSING.ptpStartNs).toBe(1600);
    expect(DEFAULT_PA_IMAGE_PROCESSING.ptpEndNs).toBe(2400);
    expect(DEFAULT_PA_IMAGE_PROCESSING.tzOhm).toBe(2000);
    expect(DEFAULT_PA_IMAGE_PROCESSING.vfs).toBe(1);
  });

  it("maps selected source indices to a ns processing window after sample slicing", () => {
    expect(timeNsForSampleIndex(10, 10, 8)).toBe(0);
    expect(timeNsForSampleIndex(30, 10, 8)).toBe(160);
    expect(indexRangeToNsWindow(30, 20, 10, 8)).toEqual({ startNs: 80, endNs: 160 });
  });

  it("defaults PA trace display to the first 2000 samples", () => {
    expect(DEFAULT_PA_TRACE_DISPLAY_SAMPLES).toBe(2000);
    expect(defaultPaTraceDisplayDomain(2048)).toEqual({ startIndex: 0, endIndex: 1999 });
    expect(defaultPaTraceDisplayDomain(1500)).toEqual({ startIndex: 0, endIndex: 1499 });
    expect(defaultPaTraceDisplayDomain(0)).toEqual({ startIndex: 0, endIndex: 0 });
  });

  it("maps frontend processing config to Rust snake_case fields", () => {
    expect(rustProcessingConfig(DEFAULT_PA_IMAGE_PROCESSING)).toEqual({
      sample_interval_ns: 8,
      sample_start_index: 10,
      sample_end_trim: 50,
      baseline_start_ns: 100,
      baseline_end_ns: 400,
      ptp_start_ns: 1600,
      ptp_end_ns: 2400,
      tz_ohm: 2000,
      vfs: 1,
      zero_adc_code: 27034,
    });
  });

  it("models Rust Option fields as nullable values", () => {
    const summary: PaFileSummary = {
      path: "/tmp/test.bin",
      file_size: 0,
      block_count: 0,
      frame_count: 0,
      bad_frame_count: 0,
      block_id_gaps: 0,
      frame_id_gaps: 0,
      global_shot_gaps: 0,
      frame_count_mismatches: 0,
      first_block_id: null,
      last_block_id: null,
      first_frame_id: null,
      last_frame_id: null,
      first_global_shot_idx: null,
      last_global_shot_idx: null,
      detected_x_points: null,
      detected_y_points: null,
      detected_frame_number: null,
      detected_sample_count_min: 0,
      detected_sample_count_max: 0,
      severity: "ok",
      issues: [{ severity: "warning", message: "short frame", block_id: null, frame_id: null }],
    };
    const trace: PaFrameTrace = {
      path: "/tmp/test.bin",
      frame_index: 0,
      frame_id: 0,
      metadata: null,
      time_ns: [],
      samples: [],
      current_ua: [],
    };

    expect(summary.detected_x_points).toBeNull();
    expect(summary.issues[0].block_id).toBeNull();
    expect(trace.metadata).toBeNull();
  });

  it("merges PA image build chunks by weighted pixel counts", () => {
    const first: PaImageBuildResult = {
      path: "/tmp/test.bin",
      width: 2,
      height: 1,
      values: [10, null],
      counts: [1, 0],
      pixel_frame_indices: [0, null],
      x_start: 0,
      x_end: 1,
      y_start: 0,
      y_end: 0,
      pixel_count: 2,
      frame_count: 1,
      bad_frame_count: 0,
      severity: "ok",
      issues: [],
    };
    const second: PaImageBuildResult = {
      path: "/tmp/test.bin",
      width: 2,
      height: 1,
      values: [14, 30],
      counts: [3, 2],
      pixel_frame_indices: [0, 4],
      x_start: 0,
      x_end: 1,
      y_start: 0,
      y_end: 0,
      pixel_count: 2,
      frame_count: 5,
      bad_frame_count: 1,
      severity: "warning",
      issues: [{ severity: "warning", message: "partial frame", block_id: null, frame_id: null }],
    };

    const merged = mergePaImageBuildChunk(first, second);

    expect(merged.values).toEqual([13, 30]);
    expect(merged.counts).toEqual([4, 2]);
    expect(merged.pixel_frame_indices).toEqual([0, 4]);
    expect(merged.frame_count).toBe(6);
    expect(merged.bad_frame_count).toBe(1);
    expect(merged.severity).toBe("warning");
    expect(merged.issues).toHaveLength(1);
  });

  it("returns the representative source frame index for a selected PA image pixel", () => {
    const image: PaImageBuildResult = {
      path: "/tmp/test.bin",
      width: 3,
      height: 2,
      values: [null, null, null, null, null, null],
      counts: [0, 1, 0, 0, 1, 0],
      pixel_frame_indices: [null, 11, null, null, 14, null],
      x_start: 0,
      x_end: 2,
      y_start: 0,
      y_end: 1,
      pixel_count: 6,
      frame_count: 2,
      bad_frame_count: 0,
      severity: "ok",
      issues: [],
    };

    expect(frameIndexForPaImagePixel(image, { x: 1, y: 0 })).toBe(11);
    expect(frameIndexForPaImagePixel(image, { x: 1, y: 1 })).toBe(14);
    expect(frameIndexForPaImagePixel(image, { x: 0, y: 0 })).toBeNull();
    expect(frameIndexForPaImagePixel(image, { x: 3, y: 0 })).toBeNull();
  });

  it("finds pixels with PTP values similar to the selected pixel", () => {
    const image: PaImageBuildResult = {
      path: "/tmp/test.bin",
      width: 3,
      height: 2,
      values: [10, 12, 16, null, 11, 30],
      counts: [1, 1, 1, 0, 2, 1],
      pixel_frame_indices: [0, 1, 2, null, 4, 5],
      x_start: 0,
      x_end: 2,
      y_start: 0,
      y_end: 1,
      pixel_count: 6,
      frame_count: 5,
      bad_frame_count: 0,
      severity: "ok",
      issues: [],
    };

    const result = findSimilarPaPixels(image, { x: 1, y: 0 }, 20);

    expect(result).toMatchObject({
      selectedValue: 12,
      toleranceValue: 4,
      matchedCount: 4,
      finiteCount: 5,
    });
    expect(result.mask).toEqual([true, true, true, false, true, false]);
  });

  it("formats Tauri string rejections as visible error messages", () => {
    expect(formatUnknownError("command not found")).toBe("command not found");
    expect(formatUnknownError(new Error("backend failed"))).toBe("backend failed");
  });

  it("persists only PA image ROI and baseline defaults", () => {
    const storage = fakeStorage();

    savePaImageRoiDefaults(
      {
        ...DEFAULT_PA_IMAGE_PROCESSING,
        baselineStartNs: 120,
        baselineEndNs: 520,
        ptpStartNs: 1800,
        ptpEndNs: 2600,
        tzOhm: 20000,
        zeroAdcCode: 29620,
      },
      storage,
    );

    expect(JSON.parse(storage.dump()[PA_IMAGE_ROI_STORAGE_KEY])).toEqual({
      baselineStartNs: 120,
      baselineEndNs: 520,
      ptpStartNs: 1800,
      ptpEndNs: 2600,
    });
  });

  it("loads saved PA image ROI defaults without overriding live ADA conversion settings", () => {
    const storage = fakeStorage({
      [PA_IMAGE_ROI_STORAGE_KEY]: JSON.stringify({
        baselineStartNs: 120,
        baselineEndNs: 520,
        ptpStartNs: 1800,
        ptpEndNs: 2600,
        tzOhm: 200000,
      }),
    });

    const merged = loadPaImageProcessingDefaults(
      { ...DEFAULT_PA_IMAGE_PROCESSING, tzOhm: 20000, zeroAdcCode: 29620 },
      storage,
    );

    expect(merged.baselineStartNs).toBe(120);
    expect(merged.baselineEndNs).toBe(520);
    expect(merged.ptpStartNs).toBe(1800);
    expect(merged.ptpEndNs).toBe(2600);
    expect(merged.tzOhm).toBe(20000);
    expect(merged.zeroAdcCode).toBe(29620);
  });
});
