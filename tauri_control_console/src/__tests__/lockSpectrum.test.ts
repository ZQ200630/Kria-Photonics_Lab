import { describe, expect, it } from "vitest";
import {
  estimateSlidingFrameMatch,
  findLevelCrossings,
  inferPolarityInvertForMarker,
  nudgeNumberText,
  normalizeLevelForSeries,
  paddedRangeForSeries,
  relativeIntensityToRawAdc,
  scanCodeAtSpectrumIndex,
  scanIndexAtCode,
  searchHalfspanToIndexSpan,
} from "../utils/lockSpectrum";

describe("lock spectrum helpers", () => {
  it("finds fractional crossing positions against a horizontal threshold", () => {
    expect(findLevelCrossings([0, 10, 0], 5).map((item) => item.index)).toEqual([0.5, 1.5]);
  });

  it("does not duplicate exact-threshold vertices", () => {
    expect(findLevelCrossings([0, 5, 10], 5).map((item) => item.index)).toEqual([1]);
  });

  it("nudges numeric text with clamping and fixed digits", () => {
    expect(nudgeNumberText("31.000", "0.050", 1, { min: 20, max: 40, digits: 3 })).toBe("31.050");
    expect(nudgeNumberText("20.000", "0.050", -1, { min: 20, max: 40, digits: 3 })).toBe("20.000");
    expect(nudgeNumberText("26000", "100", 1, { min: 0, max: 65535, digits: 0 })).toBe("26100");
  });

  it("converts plotted relative intensity back to raw ADC target", () => {
    expect(relativeIntensityToRawAdc(1000)).toBe(64535);
    expect(relativeIntensityToRawAdc(-10)).toBe(65535);
    expect(relativeIntensityToRawAdc(70000)).toBe(0);
  });

  it("maps a spectrum marker index to the scanned CH1 code", () => {
    expect(scanCodeAtSpectrumIndex(50, 101, 20000, 30000)).toBe(25000);
    expect(scanCodeAtSpectrumIndex(100, 101, 30000, 20000)).toBe(20000);
    expect(scanCodeAtSpectrumIndex(0, 1, 20000, 30000)).toBe(20000);
  });

  it("maps a scanned CH1 code back to a spectrum index", () => {
    expect(scanIndexAtCode(25000, 101, 20000, 30000)).toBe(50);
    expect(scanIndexAtCode(25000, 101, 30000, 20000)).toBe(50);
    expect(scanIndexAtCode(20000, 1, 20000, 30000)).toBe(0);
  });

  it("converts board search halfspan in code units to a display index span", () => {
    expect(searchHalfspanToIndexSpan(1000, 20000, 30000, 10001)).toBe(1000);
    expect(searchHalfspanToIndexSpan(1000, 30000, 20000, 10001)).toBe(1000);
    expect(searchHalfspanToIndexSpan(1000, 20000, 20000, 10001)).toBe(0);
  });

  it("adds margin around plotted series for stable y limits", () => {
    expect(paddedRangeForSeries([[10, 20], [15, 30]], 0.1)).toEqual({ min: 8, max: 32 });
    expect(paddedRangeForSeries([[5, 5]], 0.1)).toEqual({ min: 4.5, max: 5.5 });
  });

  it("recenters a lock level that is outside the current spectrum range", () => {
    expect(normalizeLevelForSeries(undefined, [10, 20, 30])).toBe(20);
    expect(normalizeLevelForSeries(25, [10, 20, 30])).toBe(25);
    expect(normalizeLevelForSeries(80, [10, 20, 30])).toBe(20);
    expect(normalizeLevelForSeries(-20, [10, 20, 30])).toBe(20);
  });

  it("estimates sliding frame shift for acquisition overlays", () => {
    const reference = [0, 1, 3, 8, 13, 8, 3, 1, 0, 0];
    const current = [3, 8, 13, 8, 3];
    const match = estimateSlidingFrameMatch(reference, current, 4);
    expect(match.shift).toBe(2);
    expect(match.compared).toBe(5);
    expect(match.score).toBeGreaterThan(0.99);
  });

  it("limits sliding frame match samples for responsive UI switching", () => {
    const reference = Array.from({ length: 4096 }, (_, index) => Math.sin(index / 37) * 1000 + Math.sin(index / 11) * 150);
    const current = Array.from({ length: 4096 }, (_, index) => reference[index + 23] ?? 0);
    const match = estimateSlidingFrameMatch(reference, current, 80, { maxSamples: 256 });
    expect(match.shift).toBe(23);
    expect(match.compared).toBeLessThanOrEqual(256);
    expect(match.score).toBeGreaterThan(0.99);
  });

  it("infers polarity from raw ADC slope at the marker", () => {
    const risingRelative = { index: 1.5, leftIndex: 1, rightIndex: 2, value: 15 };
    const fallingRelative = { index: 1.5, leftIndex: 1, rightIndex: 2, value: 15 };

    expect(inferPolarityInvertForMarker([0, 10, 20, 30], risingRelative, 20000, 30000)).toBe(true);
    expect(inferPolarityInvertForMarker([30, 20, 10, 0], fallingRelative, 20000, 30000)).toBe(false);
    expect(inferPolarityInvertForMarker([0, 10, 20, 30], risingRelative, 30000, 20000)).toBe(false);
  });
});
