import { describe, expect, it } from "vitest";
import {
  DEFAULT_PA_IMAGE_PROCESSING,
  indexRangeToNsWindow,
  signedAdcCodeToCurrentMicroamp,
  timeNsForSampleIndex,
} from "../utils/paImage";
import { rustProcessingConfig, type PaFileSummary, type PaFrameTrace } from "../utils/paImageTauri";

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
    expect(DEFAULT_PA_IMAGE_PROCESSING.tzOhm).toBe(2000);
    expect(DEFAULT_PA_IMAGE_PROCESSING.vfs).toBe(1);
  });

  it("maps selected source indices to a ns processing window after sample slicing", () => {
    expect(timeNsForSampleIndex(10, 10, 8)).toBe(0);
    expect(timeNsForSampleIndex(30, 10, 8)).toBe(160);
    expect(indexRangeToNsWindow(30, 20, 10, 8)).toEqual({ startNs: 80, endNs: 160 });
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
    });
  });

  it("models Rust Option fields as nullable values", () => {
    const summary: PaFileSummary = {
      path: "/tmp/test.bin",
      file_size: 0,
      block_count: 0,
      frame_count: 0,
      bad_frame_count: 0,
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
});
