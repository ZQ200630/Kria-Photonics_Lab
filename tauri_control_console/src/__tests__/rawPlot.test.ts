import { describe, expect, it } from "vitest";
import {
  downsampleEnvelope,
  normalizeIndexRange,
  paddedRangeForValues,
  rawVisibleCurrentValues,
  saturationWindowsForRawSamples,
} from "../utils/rawPlot";

describe("raw plot helpers", () => {
  it("normalizes selected source index ranges", () => {
    expect(normalizeIndexRange(8, 2, 10)).toEqual({ startIndex: 2, endIndex: 8 });
    expect(normalizeIndexRange(-5, 20, 10)).toEqual({ startIndex: 0, endIndex: 9 });
    expect(normalizeIndexRange(4, 4, 10)).toEqual({ startIndex: 4, endIndex: 4 });
  });

  it("keeps all values when under the display limit", () => {
    expect(downsampleEnvelope([10, 20, 30], 8, 5)).toEqual([
      { xIndex: 5, value: 10 },
      { xIndex: 6, value: 20 },
      { xIndex: 7, value: 30 },
    ]);
  });

  it("preserves bucket minima and maxima when downsampling", () => {
    const points = downsampleEnvelope([1, 9, 2, 8, 3, 7, 4, 6], 4, 100);

    expect(points).toEqual([
      { xIndex: 100, value: 1 },
      { xIndex: 101, value: 9 },
      { xIndex: 104, value: 3 },
      { xIndex: 105, value: 7 },
    ]);
  });

  it("computes padded y range from selected visible values", () => {
    expect(paddedRangeForValues([10, 20, 30], 0.1)).toEqual({ min: 8, max: 32 });
    expect(paddedRangeForValues([12, 12], 0.1)).toEqual({ min: 11, max: 13 });
  });

  it("computes padded y range for large raw buffers without spreading every sample", () => {
    const values = Array.from({ length: 200_000 }, (_, index) => (index === 50_000 ? -10 : index === 150_000 ? 40 : 2));

    expect(paddedRangeForValues(values, 0.1)).toEqual({ min: -15, max: 45 });
  });

  it("converts only selected raw ADC samples into current values", () => {
    const values = rawVisibleCurrentValues([0, 32768, 65535], { startIndex: 1, endIndex: 2 }, 10000, 0);

    expect(values).toHaveLength(2);
    expect(values[0]).not.toBe(values[1]);
  });

  it("groups saturated raw ADC samples into source-index windows", () => {
    expect(saturationWindowsForRawSamples([100, 0x8dd3, 0x8dd6, 100, 29300], { startIndex: 0, endIndex: 4 })).toEqual([
      { startIndex: 1, endIndex: 2, color: "rgba(239, 68, 68, 0.16)", borderColor: "rgba(220, 38, 38, 0.65)" },
    ]);
  });
});
