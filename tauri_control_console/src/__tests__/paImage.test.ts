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
    expect(DEFAULT_PA_IMAGE_PROCESSING.tzOhm).toBe(2000);
    expect(DEFAULT_PA_IMAGE_PROCESSING.vfs).toBe(1);
  });

  it("maps selected source indices to a ns processing window after sample slicing", () => {
    expect(timeNsForSampleIndex(10, 10, 8)).toBe(0);
    expect(timeNsForSampleIndex(30, 10, 8)).toBe(160);
    expect(indexRangeToNsWindow(30, 20, 10, 8)).toEqual({ startNs: 80, endNs: 160 });
  });
});
