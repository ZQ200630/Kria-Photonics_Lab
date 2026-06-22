import { describe, expect, it } from "vitest";
import {
  canvasYToValue,
  findHoveredCrossingIndex,
  indexFromCanvasX,
  isThresholdHandleHit,
  plotXFromIndex,
  resolvePlotRange,
  thresholdHandleX,
  valueToCanvasY,
} from "../components/PlotCanvas";

describe("indexFromCanvasX", () => {
  it("maps left edge to first point and right edge to last point", () => {
    expect(indexFromCanvasX(0, 100, 10)).toBe(0);
    expect(indexFromCanvasX(100, 100, 10)).toBe(9);
  });

  it("clamps out-of-range clicks", () => {
    expect(indexFromCanvasX(-50, 100, 10)).toBe(0);
    expect(indexFromCanvasX(150, 100, 10)).toBe(9);
  });

  it("uses manual y axis range when valid", () => {
    expect(resolvePlotRange([10, 20, 30], { min: 0, max: 100 })).toEqual({ min: 0, max: 100 });
  });

  it("falls back to auto scale for invalid manual y axis range", () => {
    expect(resolvePlotRange([10, 20, 30], { min: 100, max: 0 })).toEqual({ min: 10, max: 30 });
    expect(resolvePlotRange([10, 20, 30], { min: Number.NaN, max: 100 })).toEqual({ min: 10, max: 30 });
  });

  it("maps values and canvas y coordinates through the same plot area", () => {
    const range = { min: 100, max: 200 };
    expect(valueToCanvasY(200, range, 300)).toBeCloseTo(24);
    expect(valueToCanvasY(100, range, 300)).toBeCloseTo(270);
    expect(canvasYToValue(24, range, 300)).toBeCloseTo(200);
    expect(canvasYToValue(270, range, 300)).toBeCloseTo(100);
  });

  it("detects the crossing marker touched by the pointer", () => {
    const crossings = [
      { index: 2, leftIndex: 1, rightIndex: 2, value: 100 },
      { index: 6, leftIndex: 5, rightIndex: 6, value: 100 },
    ];
    const markerX = plotXFromIndex(2, 240, 10);
    expect(findHoveredCrossingIndex(crossings, markerX + 3, 103, 240, 10, 100, 12)).toBe(0);
    expect(findHoveredCrossingIndex(crossings, markerX + 40, 103, 240, 10, 100, 12)).toBeUndefined();
  });

  it("limits threshold dragging to the right-side handle", () => {
    const width = 240;
    const y = 100;
    expect(isThresholdHandleHit(thresholdHandleX(width), y + 2, width, y, 14)).toBe(true);
    expect(isThresholdHandleHit(120, y + 2, width, y, 14)).toBe(false);
    expect(isThresholdHandleHit(thresholdHandleX(width), y + 30, width, y, 14)).toBe(false);
  });
});
