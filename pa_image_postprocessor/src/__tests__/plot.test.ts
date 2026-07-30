import { describe, expect, it } from "vitest";
import {
  canvasYToValue,
  copyPlotBaseToCache,
  drawPlotInteractiveOverlays,
  downsamplePlotPointsForPixels,
  downsampleValueSeriesForPixels,
  findHoveredCrossingIndex,
  indexFromCanvasX,
  indexFromCanvasXDomain,
  intersectPlotDomainWindow,
  isThresholdHandleHit,
  layoutPlotTextLabels,
  plotCrossingsOrEmpty,
  plotDomainWindowsOrEmpty,
  plotHighlightWindowsOrEmpty,
  plotIndexFromClientX,
  plotLocalPointFromClient,
  plotValueFromClientY,
  plotOverlaysOrEmpty,
  plotVerticalMarkersOrEmpty,
  resolvePlotDomainWindowRect,
  plotXFromIndex,
  resolvePlotRange,
  resolvePlotRangeForPlot,
  shouldCompletePlotSelection,
  shouldTrackPlotHoverIndex,
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

  it("maps canvas x into a custom source index domain", () => {
    expect(indexFromCanvasXDomain(0, 100, { startIndex: 100, endIndex: 200 })).toBe(100);
    expect(indexFromCanvasXDomain(50, 100, { startIndex: 100, endIndex: 200 })).toBe(150);
    expect(indexFromCanvasXDomain(100, 100, { startIndex: 100, endIndex: 200 })).toBe(200);
  });

  it("maps drag client x from cached plot geometry", () => {
    expect(
      plotIndexFromClientX({
        clientX: 243,
        geometry: {
          rectLeft: 100,
          rectWidth: 300,
          domain: { startIndex: 1000, endIndex: 2000 },
        },
      }),
    ).toBe(1500);
  });

  it("maps hover client coordinates from cached plot geometry", () => {
    expect(
      plotLocalPointFromClient({
        clientX: 250,
        clientY: 180,
        geometry: {
          rectLeft: 100,
          rectTop: 40,
          rectWidth: 420,
        },
      }),
    ).toEqual({ x: 150, y: 140 });
  });

  it("clamps custom source index domain selections", () => {
    expect(indexFromCanvasXDomain(-10, 100, { startIndex: 100, endIndex: 200 })).toBe(100);
    expect(indexFromCanvasXDomain(120, 100, { startIndex: 100, endIndex: 200 })).toBe(200);
  });

  it("clips selection windows to the visible plot domain", () => {
    expect(intersectPlotDomainWindow({ startIndex: 0, endIndex: 20 }, { startIndex: 40, endIndex: 80 })).toBeUndefined();
    expect(intersectPlotDomainWindow({ startIndex: 70, endIndex: 90 }, { startIndex: 40, endIndex: 80 })).toEqual({
      startIndex: 70,
      endIndex: 80,
    });
    expect(intersectPlotDomainWindow({ startIndex: 90, endIndex: 70 }, { startIndex: 40, endIndex: 80 })).toEqual({
      startIndex: 70,
      endIndex: 80,
    });
  });

  it("resolves clipped plot domain windows to canvas rectangles", () => {
    const rect = resolvePlotDomainWindowRect({ startIndex: 70, endIndex: 90 }, { startIndex: 40, endIndex: 80 }, 420, 300);
    expect(rect?.left).toBeCloseTo(268.5);
    expect(rect?.top).toBe(24);
    expect(rect?.width).toBeCloseTo(65.5);
    expect(rect?.height).toBe(246);
    expect(resolvePlotDomainWindowRect({ startIndex: 0, endIndex: 20 }, { startIndex: 40, endIndex: 80 }, 420, 300)).toBeUndefined();
  });

  it("uses manual y axis range when valid", () => {
    expect(resolvePlotRange([10, 20, 30], { min: 0, max: 100 })).toEqual({ min: 0, max: 100 });
  });

  it("falls back to auto scale for invalid manual y axis range", () => {
    expect(resolvePlotRange([10, 20, 30], { min: 100, max: 0 })).toEqual({ min: 10, max: 30 });
    expect(resolvePlotRange([10, 20, 30], { min: Number.NaN, max: 100 })).toEqual({ min: 10, max: 30 });
  });

  it("resolves large plot ranges without spreading every sample as a function argument", () => {
    const values = Array.from({ length: 200_000 }, (_, index) => (index === 123_456 ? -20 : index === 180_000 ? 80 : 5));

    expect(resolvePlotRange(values)).toEqual({ min: -20, max: 80 });
  });

  it("resolves point-series plot ranges without allocating a mapped value array", () => {
    const values = [999, 999, 999];
    const points = [
      { xIndex: 10, value: 4 },
      { xIndex: 20, value: -12 },
      { xIndex: 30, value: 7 },
    ];

    expect(resolvePlotRangeForPlot(values, points)).toEqual({ min: -12, max: 7 });
    expect(resolvePlotRangeForPlot(values, points, { min: -1, max: 1 })).toEqual({ min: -1, max: 1 });
  });

  it("resolves value plot ranges from only the visible x domain", () => {
    const values = new Proxy(
      { length: 1_000_000 },
      {
        get(target, prop) {
          if (prop === "length") return target.length;
          const index = typeof prop === "string" ? Number(prop) : Number.NaN;
          if (!Number.isInteger(index)) return undefined;
          if (index < 999_900 || index > 999_999) {
            throw new Error(`range read outside visible domain: ${String(prop)}`);
          }
          return index === 999_950 ? 30 : -5;
        },
      },
    ) as unknown as number[];

    expect(resolvePlotRangeForPlot(values, undefined, undefined, { startIndex: 999_900, endIndex: 999_999 })).toEqual({
      min: -5,
      max: 30,
    });
  });

  it("maps values and canvas y coordinates through the same plot area", () => {
    const range = { min: 100, max: 200 };
    expect(valueToCanvasY(200, range, 300)).toBeCloseTo(24);
    expect(valueToCanvasY(100, range, 300)).toBeCloseTo(270);
    expect(canvasYToValue(24, range, 300)).toBeCloseTo(200);
    expect(canvasYToValue(270, range, 300)).toBeCloseTo(100);
  });

  it("maps threshold drag client y from cached plot geometry", () => {
    expect(
      plotValueFromClientY({
        clientY: 150,
        geometry: {
          rectTop: 50,
          height: 300,
          range: { min: 0, max: 100 },
        },
      }),
    ).toBeCloseTo(canvasYToValue(100, { min: 0, max: 100 }, 300));
  });

  it("detects the crossing marker touched by the pointer", () => {
    const crossings = [
      { index: 2, leftIndex: 1, rightIndex: 2, value: 100 },
      { index: 6, leftIndex: 5, rightIndex: 6, value: 100 },
    ];
    const width = 420;
    const markerX = plotXFromIndex(2, width, 10);
    expect(findHoveredCrossingIndex(crossings, markerX + 3, 103, width, 10, 100, 12)).toBe(0);
    expect(findHoveredCrossingIndex(crossings, markerX + 40, 103, width, 10, 100, 12)).toBeUndefined();
  });

  it("limits hover marker selection to the search window and chooses the nearest crossing", () => {
    const crossings = [
      { index: 2, leftIndex: 1, rightIndex: 2, value: 100 },
      { index: 6, leftIndex: 5, rightIndex: 6, value: 100 },
      { index: 8, leftIndex: 7, rightIndex: 8, value: 100 },
    ];
    const nearOutsideWindowX = plotXFromIndex(2, 240, 10);
    expect(
      findHoveredCrossingIndex(crossings, nearOutsideWindowX, 100, 240, 10, 100, 12, {
        searchCenterIndex: 7,
        searchHalfspan: 1.5,
      }),
    ).toBe(1);
    expect(
      findHoveredCrossingIndex(crossings, nearOutsideWindowX, 100, 240, 10, 100, 12, {
        searchCenterIndex: 4,
        searchHalfspan: 0.5,
      }),
    ).toBeUndefined();
  });

  it("limits threshold dragging to the right-side handle", () => {
    const width = 240;
    const y = 100;
    expect(isThresholdHandleHit(thresholdHandleX(width), y + 2, width, y, 14)).toBe(true);
    expect(isThresholdHandleHit(120, y + 2, width, y, 14)).toBe(false);
    expect(isThresholdHandleHit(thresholdHandleX(width), y + 30, width, y, 14)).toBe(false);
  });

  it("does not treat a click as a plot zoom selection", () => {
    expect(shouldCompletePlotSelection({ x: 100, y: 80 }, { x: 102, y: 82 })).toBe(false);
    expect(shouldCompletePlotSelection({ x: 100, y: 80 }, { x: 118, y: 82 })).toBe(true);
  });

  it("allows dense timeline plots to ignore small click jitter", () => {
    expect(shouldCompletePlotSelection({ x: 100, y: 80 }, { x: 108, y: 83 }, 14)).toBe(false);
    expect(shouldCompletePlotSelection({ x: 100, y: 80 }, { x: 118, y: 83 }, 14)).toBe(true);
  });

  it("tracks plot hover index only when a visible search window needs it", () => {
    expect(shouldTrackPlotHoverIndex(undefined)).toBe(false);
    expect(shouldTrackPlotHoverIndex(0)).toBe(false);
    expect(shouldTrackPlotHoverIndex(Number.NaN)).toBe(false);
    expect(shouldTrackPlotHoverIndex(8)).toBe(true);
  });

  it("reuses stable empty arrays for omitted plot decorations", () => {
    expect(plotOverlaysOrEmpty(undefined)).toBe(plotOverlaysOrEmpty(undefined));
    expect(plotVerticalMarkersOrEmpty(undefined)).toBe(plotVerticalMarkersOrEmpty(undefined));
    expect(plotHighlightWindowsOrEmpty(undefined)).toBe(plotHighlightWindowsOrEmpty(undefined));
    expect(plotDomainWindowsOrEmpty(undefined)).toBe(plotDomainWindowsOrEmpty(undefined));
    expect(plotCrossingsOrEmpty(undefined)).toBe(plotCrossingsOrEmpty(undefined));

    const overlays = [{ values: [1], color: "#000" }];
    expect(plotOverlaysOrEmpty(overlays)).toBe(overlays);
  });

  it("downsamples dense point series to a per-pixel envelope inside the visible domain", () => {
    const points = Array.from({ length: 1000 }, (_, index) => ({
      xIndex: index,
      value: index % 50 === 0 ? 1000 : index % 7,
    }));

    const decimated = downsamplePlotPointsForPixels(points, { startIndex: 100, endIndex: 899 }, 80);

    expect(decimated.length).toBeLessThanOrEqual(80 * 4);
    expect(decimated.every((point) => point.xIndex >= 100 && point.xIndex <= 899)).toBe(true);
    expect(decimated.some((point) => point.value === 1000)).toBe(true);
  });

  it("downsamples dense value series to a per-pixel envelope while preserving spikes", () => {
    const values = Array.from({ length: 2000 }, (_, index) => (index === 1234 ? 5000 : index % 13));

    const decimated = downsampleValueSeriesForPixels(values, 100);

    expect(decimated.length).toBeLessThanOrEqual(100 * 4);
    expect(decimated[0]).toEqual({ xIndex: 0, value: 0 });
    expect(decimated.some((point) => point.xIndex === 1234 && point.value === 5000)).toBe(true);
  });

  it("does not read value samples outside the visible index window", () => {
    const values = new Proxy(
      { length: 1_000_000 },
      {
        get(target, prop) {
          if (prop === "length") return target.length;
          const index = typeof prop === "string" ? Number(prop) : Number.NaN;
          if (!Number.isInteger(index)) return undefined;
          if (index < 999_900 || index > 999_999) {
            throw new Error(`read outside visible window: ${String(prop)}`);
          }
          return index === 999_950 ? 10_000 : index % 17;
        },
      },
    ) as unknown as number[];

    const decimated = downsampleValueSeriesForPixels(values, 20, {
      visibleStartIndex: 999_900,
      visibleEndIndex: 999_999,
    });

    expect(decimated.every((point) => point.xIndex >= 999_900 && point.xIndex <= 999_999)).toBe(true);
    expect(decimated.some((point) => point.xIndex === 999_950 && point.value === 10_000)).toBe(true);
  });

  it("stacks nearby plot text labels and clamps labels inside the plot", () => {
    const placements = layoutPlotTextLabels(
      [
        { x: 100, text: "locked 224085", color: "#16a34a" },
        { x: 104, text: "selected 224080", color: "#f59e0b" },
        { x: 395, text: "right edge", color: "#64748b" },
      ],
      72,
      400,
      36,
      (text) => text.length * 7,
    );

    expect(placements[0].y).not.toBe(placements[1].y);
    expect(placements[2].x + placements[2].width).toBeLessThanOrEqual(400);
  });

  it("caches the static plot render with canvas drawImage instead of pixel readback", () => {
    const calls: unknown[][] = [];
    const sourceCanvas = { width: 640, height: 360 } as HTMLCanvasElement;
    const cacheContext = {
      setTransform: (...args: unknown[]) => calls.push(["setTransform", ...args]),
      clearRect: (...args: unknown[]) => calls.push(["clearRect", ...args]),
      drawImage: (...args: unknown[]) => calls.push(["drawImage", ...args]),
    };
    const cacheCanvas = {
      width: 0,
      height: 0,
      getContext: (kind: string) => (kind === "2d" ? cacheContext : null),
    } as unknown as HTMLCanvasElement;

    expect(copyPlotBaseToCache(sourceCanvas, cacheCanvas)).toBe(true);

    expect(cacheCanvas.width).toBe(640);
    expect(cacheCanvas.height).toBe(360);
    expect(calls).toEqual([
      ["setTransform", 1, 0, 0, 1, 0, 0],
      ["clearRect", 0, 0, 640, 360],
      ["drawImage", sourceCanvas, 0, 0],
    ]);
  });

  it("draws plot hover overlays from the cached base canvas", () => {
    const calls: unknown[][] = [];
    const context = {
      setTransform: (...args: unknown[]) => calls.push(["setTransform", ...args]),
      clearRect: (...args: unknown[]) => calls.push(["clearRect", ...args]),
      drawImage: (...args: unknown[]) => calls.push(["drawImage", ...args]),
      save: () => calls.push(["save"]),
      restore: () => calls.push(["restore"]),
      fillRect: (...args: unknown[]) => calls.push(["fillRect", ...args]),
      beginPath: () => calls.push(["beginPath"]),
      moveTo: (...args: unknown[]) => calls.push(["moveTo", ...args]),
      lineTo: (...args: unknown[]) => calls.push(["lineTo", ...args]),
      stroke: () => calls.push(["stroke"]),
      arc: (...args: unknown[]) => calls.push(["arc", ...args]),
      fill: () => calls.push(["fill"]),
      setLineDash: (...args: unknown[]) => calls.push(["setLineDash", ...args]),
      set fillStyle(value: string) {
        calls.push(["fillStyle", value]);
      },
      set strokeStyle(value: string) {
        calls.push(["strokeStyle", value]);
      },
      set lineWidth(value: number) {
        calls.push(["lineWidth", value]);
      },
    };
    const canvas = {
      width: 640,
      height: 360,
      getContext: (kind: string) => (kind === "2d" ? context : null),
    } as unknown as HTMLCanvasElement;
    const baseCanvas = { width: 640, height: 360 } as HTMLCanvasElement;

    expect(
      drawPlotInteractiveOverlays(canvas, {
        baseCanvas,
        scale: 1,
        cssWidth: 640,
        cssHeight: 360,
        plotDomain: { startIndex: 0, endIndex: 999 },
        range: { min: 0, max: 100 },
        valuesLength: 1000,
      }, {
        hoveredPlotIndex: 500,
        searchWindowHalfspan: 10,
      }),
    ).toBe(true);

    expect(calls[0]).toEqual(["setTransform", 1, 0, 0, 1, 0, 0]);
    expect(calls).toContainEqual(["drawImage", baseCanvas, 0, 0]);
    expect(calls.some((call) => call[0] === "fillRect")).toBe(true);
  });
});
