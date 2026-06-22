import { describe, expect, it } from "vitest";
import {
  findLevelCrossings,
  inferPolarityInvertForMarker,
  nudgeNumberText,
  relativeIntensityToRawAdc,
  scanCodeAtSpectrumIndex,
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

  it("infers polarity from raw ADC slope at the marker", () => {
    const risingRelative = { index: 1.5, leftIndex: 1, rightIndex: 2, value: 15 };
    const fallingRelative = { index: 1.5, leftIndex: 1, rightIndex: 2, value: 15 };

    expect(inferPolarityInvertForMarker([0, 10, 20, 30], risingRelative, 20000, 30000)).toBe(true);
    expect(inferPolarityInvertForMarker([30, 20, 10, 0], fallingRelative, 20000, 30000)).toBe(false);
    expect(inferPolarityInvertForMarker([0, 10, 20, 30], risingRelative, 30000, 20000)).toBe(false);
  });
});
