import { describe, expect, it } from "vitest";
import {
  applyPaImageCanvasBackingStore,
  arePaImageHeatmapPropsEqual,
  buildPaImageRaster,
  copyPaImageBaseToCache,
  drawPaImageInteractiveOverlays,
  paImageCountsOrEmpty,
  paImageValuesOrEmpty,
  paImageEnhancedUnit,
  paImageDisplayRange,
  formatPaImageDistanceUm,
  paImageColorRgbForUnit,
  paImagePercentileRange,
  resolvePaImageAxisDistanceLabel,
  resolvePaImageAxisTextLayout,
  resolvePaImageCellRectangle,
  resolvePaImageConstrainedDragRectangle,
  resolvePaImageCanvasPointFromClient,
  resolvePaImageDragRectangle,
  resolvePaImageCanvasSize,
  resolvePaImageHeatmapLayout,
  resolvePaImagePixelFromCanvasPoint,
  resolvePaImageSelectedPixelRectangle,
  dispatchPaImageCreatedDomain,
  shouldDrawPaImageDragPreview,
  shouldPreviewPaImageRoiDrag,
} from "../components/PaImageHeatmap";

describe("PA image heatmap layout", () => {
  it("uses fractional cell sizes so large images fit inside the plot area", () => {
    const layout = resolvePaImageHeatmapLayout({
      cssWidth: 520,
      cssHeight: 360,
      width: 1000,
      height: 1000,
    });

    expect(layout.cell).toBeLessThan(1);
    expect(layout.gridWidth).toBeLessThanOrEqual(layout.plotWidth);
    expect(layout.gridHeight).toBeLessThanOrEqual(layout.plotHeight);
  });

  it("keeps CSS display size separate from high-DPI backing store size", () => {
    const size = resolvePaImageCanvasSize({
      rectWidth: 520,
      rectHeight: 430,
      devicePixelRatio: 2,
    });

    expect(size.cssWidth).toBe(520);
    expect(size.cssHeight).toBe(430);
    expect(size.backingWidth).toBe(1040);
    expect(size.backingHeight).toBe(860);
  });

  it("does not write inline display dimensions when updating the canvas backing store", () => {
    const canvas = {
      width: 0,
      height: 0,
      style: { width: "", height: "" },
    };

    applyPaImageCanvasBackingStore(canvas, {
      cssWidth: 520,
      cssHeight: 430,
      backingWidth: 1040,
      backingHeight: 860,
      scale: 2,
    });

    expect(canvas.width).toBe(1040);
    expect(canvas.height).toBe(860);
    expect(canvas.style.width).toBe("");
    expect(canvas.style.height).toBe("");
  });

  it("maps canvas coordinates to image pixels inside the current zoom domain", () => {
    const layout = resolvePaImageHeatmapLayout({
      cssWidth: 520,
      cssHeight: 360,
      width: 10,
      height: 10,
    });

    expect(
      resolvePaImagePixelFromCanvasPoint({
        canvasX: layout.x0 + layout.gridWidth * 0.25,
        canvasY: layout.y0 + layout.gridHeight * 0.5,
        layout,
        zoom: { xStart: 2, xEnd: 5, yStart: 4, yEnd: 7 },
      }),
    ).toEqual({ x: 3, y: 5 });
  });

  it("maps drag client coordinates from a cached rect without reading layout again", () => {
    expect(
      resolvePaImageCanvasPointFromClient({
        clientX: 240,
        clientY: 180,
        rectLeft: 100,
        rectTop: 50,
      }),
    ).toEqual({ x: 140, y: 130 });
  });

  it("maps the bottom of the plotted image to the y start pixel", () => {
    const layout = resolvePaImageHeatmapLayout({
      cssWidth: 520,
      cssHeight: 360,
      width: 10,
      height: 10,
      axisLabels: { xStart: 0, xEnd: 9, yStart: 0, yEnd: 9 },
    });

    expect(
      resolvePaImagePixelFromCanvasPoint({
        canvasX: layout.x0 + layout.gridWidth * 0.5,
        canvasY: layout.y0 + layout.gridHeight - 1,
        layout,
      }),
    ).toEqual({ x: 5, y: 0 });
  });

  it("draws the y end row as one cell instead of a full-height column", () => {
    const layout = resolvePaImageHeatmapLayout({
      cssWidth: 520,
      cssHeight: 360,
      width: 10,
      height: 10,
      axisLabels: { xStart: 0, xEnd: 9, yStart: 0, yEnd: 9 },
    });

    const topRow = resolvePaImageCellRectangle({ x: 0, y: 9, layout });
    const bottomRow = resolvePaImageCellRectangle({ x: 0, y: 0, layout });

    expect(topRow.top).toBeCloseTo(layout.y0);
    expect(topRow.height).toBeCloseTo(layout.cellHeight);
    expect(bottomRow.top + bottomRow.height).toBeCloseTo(layout.y0 + layout.gridHeight);
    expect(bottomRow.height).toBeCloseTo(layout.cellHeight);
  });

  it("resolves selected pixel rectangles only when the pixel is visible", () => {
    const layout = resolvePaImageHeatmapLayout({
      cssWidth: 520,
      cssHeight: 360,
      width: 10,
      height: 10,
    });

    expect(resolvePaImageSelectedPixelRectangle({ selectedPixel: { x: 3, y: 5 }, layout, zoom: { xStart: 2, xEnd: 5, yStart: 4, yEnd: 7 } }))
      .toEqual(resolvePaImageCellRectangle({ x: 3, y: 5, layout, zoom: { xStart: 2, xEnd: 5, yStart: 4, yEnd: 7 } }));
    expect(resolvePaImageSelectedPixelRectangle({ selectedPixel: { x: 7, y: 5 }, layout, zoom: { xStart: 2, xEnd: 5, yStart: 4, yEnd: 7 } }))
      .toBeNull();
  });

  it("resolves a bounded drag rectangle inside the image grid", () => {
    const layout = resolvePaImageHeatmapLayout({
      cssWidth: 520,
      cssHeight: 360,
      width: 10,
      height: 10,
    });

    expect(
      resolvePaImageDragRectangle({
        start: { x: layout.x0 + 100, y: layout.y0 + 40 },
        end: { x: layout.x0 + 20, y: layout.y0 + 180 },
        layout,
      }),
    ).toEqual({
      left: layout.x0 + 20,
      top: layout.y0 + 40,
      width: 80,
      height: 140,
    });

    expect(
      resolvePaImageDragRectangle({
        start: { x: layout.x0 - 10, y: layout.y0 + 40 },
        end: { x: layout.x0 + 20, y: layout.y0 + 180 },
        layout,
      }),
    ).toBeNull();
  });

  it("constrains ROI drag rectangles to a requested aspect ratio", () => {
    const layout = resolvePaImageHeatmapLayout({
      cssWidth: 520,
      cssHeight: 360,
      width: 10,
      height: 10,
    });

    const square = resolvePaImageConstrainedDragRectangle({
      start: { x: layout.x0 + 20, y: layout.y0 + 40 },
      end: { x: layout.x0 + 140, y: layout.y0 + 190 },
      layout,
      aspectRatio: "1:1",
    });

    expect(square).toMatchObject({
      left: layout.x0 + 20,
      top: layout.y0 + 40,
    });
    expect(square?.width).toBeCloseTo(square?.height ?? 0);
  });

  it("keeps constrained ROI rectangles inside the plotted image", () => {
    const layout = resolvePaImageHeatmapLayout({
      cssWidth: 520,
      cssHeight: 360,
      width: 10,
      height: 10,
    });

    const rectangle = resolvePaImageConstrainedDragRectangle({
      start: { x: layout.x0 + layout.gridWidth - 20, y: layout.y0 + layout.gridHeight - 20 },
      end: { x: layout.x0 + layout.gridWidth + 100, y: layout.y0 + layout.gridHeight + 100 },
      layout,
      aspectRatio: "4:3",
    });

    expect(rectangle).not.toBeNull();
    expect((rectangle?.left ?? 0) + (rectangle?.width ?? 0)).toBeLessThanOrEqual(layout.x0 + layout.gridWidth);
    expect((rectangle?.top ?? 0) + (rectangle?.height ?? 0)).toBeLessThanOrEqual(layout.y0 + layout.gridHeight);
  });

  it("draws the transient drag preview only while creating a new ROI", () => {
    expect(shouldDrawPaImageDragPreview("create")).toBe(true);
    expect(shouldDrawPaImageDragPreview("move")).toBe(false);
    expect(shouldDrawPaImageDragPreview("resizeStart")).toBe(false);
    expect(shouldDrawPaImageDragPreview("resizeEnd")).toBe(false);
    expect(shouldDrawPaImageDragPreview("click")).toBe(false);
  });

  it("previews ROI move and resize locally instead of committing parent ROI during every drag frame", () => {
    expect(shouldPreviewPaImageRoiDrag("create")).toBe(false);
    expect(shouldPreviewPaImageRoiDrag("move")).toBe(true);
    expect(shouldPreviewPaImageRoiDrag("resizeStart")).toBe(true);
    expect(shouldPreviewPaImageRoiDrag("resizeEnd")).toBe(true);
    expect(shouldPreviewPaImageRoiDrag("click")).toBe(false);
  });

  it("falls back to image zoom when a drag-created domain has no ROI handler", () => {
    const calls: string[] = [];
    dispatchPaImageCreatedDomain(
      { xStart: 1, xEnd: 4, yStart: 2, yEnd: 6 },
      {
        onZoom: () => calls.push("zoom"),
      },
    );

    expect(calls).toEqual(["zoom"]);
  });

  it("formats PA image axis labels as physical distance", () => {
    expect(
      resolvePaImageAxisDistanceLabel({
        start: 0,
        end: 1995,
        index: 399,
        maxIndex: 399,
        umPerCount: 0.1325,
      }),
    ).toBe("264.34 um");
    expect(formatPaImageDistanceUm(0.125)).toBe("125 nm");
    expect(formatPaImageDistanceUm(1250)).toBe("1.25 mm");
  });

  it("sizes the image grid from physical scan dimensions instead of matrix dimensions", () => {
    const layout = resolvePaImageHeatmapLayout({
      cssWidth: 640,
      cssHeight: 360,
      width: 100,
      height: 100,
      axisLabels: { xStart: 0, xEnd: 198, yStart: 0, yEnd: 99 },
      umPerCount: 1,
    });

    expect(layout.gridWidth / layout.gridHeight).toBeCloseTo(2, 1);
  });

  it("formats axis labels as relative physical distance within the visible image", () => {
    expect(
      resolvePaImageAxisDistanceLabel({
        start: 1000,
        end: 1990,
        index: 99,
        maxIndex: 99,
        umPerCount: 0.1325,
      }),
    ).toBe("131.18 um");
  });

  it("anchors axis titles and y ticks to the image grid instead of the canvas edge", () => {
    const layout = resolvePaImageHeatmapLayout({
      cssWidth: 640,
      cssHeight: 360,
      width: 100,
      height: 100,
    });
    const textLayout = resolvePaImageAxisTextLayout(layout);

    expect(textLayout.xTitle.x).toBeCloseTo(layout.x0 + layout.gridWidth / 2);
    expect(textLayout.xTitle.y).toBeCloseTo(layout.y0 + layout.gridHeight + 24);
    expect(textLayout.yTitle.x).toBeCloseTo(layout.x0 - 42);
    expect(textLayout.yTitle.y).toBeCloseTo(layout.y0 + layout.gridHeight / 2);
    expect(textLayout.yStart.x).toBeCloseTo(layout.x0 - 14);
    expect(textLayout.yEnd.x).toBeCloseTo(layout.x0 - 14);
  });

  it("builds a compact visible raster for heatmap drawing instead of requiring per-cell canvas fills", () => {
    const raster = buildPaImageRaster({
      width: 2,
      height: 2,
      values: [0, 50, 100, null],
      counts: [1, 1, 1, 0],
      zoom: null,
    });

    expect(raster.width).toBe(2);
    expect(raster.height).toBe(2);
    expect(raster.finiteCount).toBe(3);
    expect(Array.from(raster.pixels.slice(0, 4))).toEqual([...paImageColorRgbForUnit(1), 255]);
    expect(Array.from(raster.pixels.slice(4, 8))).toEqual([229, 231, 235, 255]);
    expect(Array.from(raster.pixels.slice(8, 12))).toEqual([...paImageColorRgbForUnit(0), 255]);
    expect(raster.sourceIndices).toBeUndefined();
  });

  it("supports selectable colormap and enhancement for PA image rasters", () => {
    expect(paImageColorRgbForUnit(0.5, "gray")).toEqual([128, 128, 128]);
    expect(paImageEnhancedUnit(25, { low: 0, high: 100, finiteCount: 3 }, "sqrt")).toBeCloseTo(0.5);
    expect(paImageDisplayRange([0, 10, 100], [1, 1, 1], null, 3, 1, "minmax")).toEqual({
      low: 0,
      high: 100,
      finiteCount: 3,
    });
  });

  it("dims PA image pixels outside the current similarity mask", () => {
    const raster = buildPaImageRaster({
      width: 2,
      height: 2,
      values: [0, 50, 100, 150],
      counts: [1, 1, 1, 1],
      zoom: null,
      colormap: "gray",
      enhancement: "minmax",
      mask: [true, false, true, false],
      includeSourceIndices: true,
    });

    expect(raster.sourceIndices).toEqual([2, 3, 0, 1]);
    expect(Array.from(raster.pixels.slice(0, 4))).toEqual([...paImageColorRgbForUnit(100 / 150, "gray"), 255]);
    expect(Array.from(raster.pixels.slice(4, 8))).toEqual([226, 232, 240, 255]);
    expect(Array.from(raster.pixels.slice(8, 12))).toEqual([...paImageColorRgbForUnit(0, "gray"), 255]);
    expect(Array.from(raster.pixels.slice(12, 16))).toEqual([226, 232, 240, 255]);
  });

  it("computes exact PA image percentile range without requiring a full sorted array", () => {
    const values = [50, null, 2, 100, Number.NaN, 1, 80, 5, 20, 40, 60, 70, 90, 30, 10];

    expect(paImagePercentileRange(values, 0.01, 0.99)).toEqual({ low: 1, high: 100, finiteCount: 13 });
    expect(paImagePercentileRange(values, 0.25, 0.75)).toEqual({ low: 10, high: 70, finiteCount: 13 });
  });

  it("builds only the zoomed PA image domain for heatmap rasterization", () => {
    const raster = buildPaImageRaster({
      width: 4,
      height: 4,
      values: Array.from({ length: 16 }, (_, index) => index),
      counts: Array.from({ length: 16 }, () => 1),
      zoom: { xStart: 1, xEnd: 2, yStart: 1, yEnd: 2 },
      includeSourceIndices: true,
    });

    expect(raster.width).toBe(2);
    expect(raster.height).toBe(2);
    expect(raster.sourceIndices).toEqual([9, 10, 5, 6]);
  });

  it("computes PA image raster scaling from only the zoomed domain", () => {
    const width = 1000;
    const height = 1000;
    const zoom = { xStart: 990, xEnd: 999, yStart: 990, yEnd: 999 };
    const values = new Proxy(
      { length: width * height },
      {
        get(target, prop) {
          if (prop === "length") return target.length;
          const index = typeof prop === "string" ? Number(prop) : Number.NaN;
          if (!Number.isInteger(index)) return undefined;
          const x = index % width;
          const y = Math.floor(index / width);
          if (x < zoom.xStart || x > zoom.xEnd || y < zoom.yStart || y > zoom.yEnd) {
            throw new Error(`read outside zoomed image domain: ${String(prop)}`);
          }
          return x === 995 && y === 995 ? 5000 : x + y;
        },
      },
    ) as unknown as Array<number | null>;
    const counts = new Proxy(
      { length: width * height },
      {
        get(target, prop) {
          if (prop === "length") return target.length;
          const index = typeof prop === "string" ? Number(prop) : Number.NaN;
          if (!Number.isInteger(index)) return undefined;
          const x = index % width;
          const y = Math.floor(index / width);
          if (x < zoom.xStart || x > zoom.xEnd || y < zoom.yStart || y > zoom.yEnd) {
            throw new Error(`count read outside zoomed image domain: ${String(prop)}`);
          }
          return 1;
        },
      },
    ) as unknown as number[];

    const raster = buildPaImageRaster({ width, height, values, counts, zoom });

    expect(raster.width).toBe(10);
    expect(raster.height).toBe(10);
    expect(raster.pixels).toHaveLength(10 * 10 * 4);
  });

  it("reuses stable empty arrays for omitted PA image values and counts", () => {
    expect(paImageValuesOrEmpty(undefined)).toBe(paImageValuesOrEmpty(undefined));
    expect(paImageCountsOrEmpty(undefined)).toBe(paImageCountsOrEmpty(undefined));

    const values = [1, null, 2];
    const counts = [1, 0, 1];
    expect(paImageValuesOrEmpty(values)).toBe(values);
    expect(paImageCountsOrEmpty(counts)).toBe(counts);
  });

  it("treats equivalent heatmap visual props as equal for React memo skipping", () => {
    const values = [1, 2, 3, 4];
    const counts = [1, 1, 1, 1];
    const onResetZoom = () => undefined;
    const baseProps = {
      width: 2,
      height: 2,
      values,
      counts,
      active: true,
      axisLabels: { xStart: 0, xEnd: 10, yStart: -5, yEnd: 5 },
      umPerCount: 0.1325,
      selectedPixel: { x: 1, y: 1 },
      zoom: { xStart: 0, xEnd: 1, yStart: 0, yEnd: 1 },
      roi: { xStart: 0, xEnd: 1, yStart: 0, yEnd: 1 },
      roiAspectRatio: "free" as const,
      onResetZoom,
    };

    expect(
      arePaImageHeatmapPropsEqual(baseProps, {
        ...baseProps,
        axisLabels: { xStart: 0, xEnd: 10, yStart: -5, yEnd: 5 },
        selectedPixel: { x: 1, y: 1 },
        zoom: { xStart: 0, xEnd: 1, yStart: 0, yEnd: 1 },
        roi: { xStart: 0, xEnd: 1, yStart: 0, yEnd: 1 },
      }),
    ).toBe(true);

    expect(arePaImageHeatmapPropsEqual(baseProps, { ...baseProps, values: values.slice() })).toBe(false);
    expect(arePaImageHeatmapPropsEqual(baseProps, { ...baseProps, zoom: { xStart: 0, xEnd: 0, yStart: 0, yEnd: 1 } })).toBe(false);
    expect(arePaImageHeatmapPropsEqual(baseProps, { ...baseProps, onResetZoom: () => undefined })).toBe(false);
  });

  it("caches the static PA image render with canvas drawImage instead of pixel readback", () => {
    const calls: unknown[][] = [];
    const sourceCanvas = { width: 640, height: 480 } as HTMLCanvasElement;
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

    expect(copyPaImageBaseToCache(sourceCanvas, cacheCanvas)).toBe(true);

    expect(cacheCanvas.width).toBe(640);
    expect(cacheCanvas.height).toBe(480);
    expect(calls).toEqual([
      ["setTransform", 1, 0, 0, 1, 0, 0],
      ["clearRect", 0, 0, 640, 480],
      ["drawImage", sourceCanvas, 0, 0],
    ]);
  });

  it("restores the cached PA image base when redrawing interactive overlays", () => {
    const calls: unknown[][] = [];
    const baseCanvas = { width: 640, height: 480 } as HTMLCanvasElement;
    const context = {
      setTransform: (...args: unknown[]) => calls.push(["setTransform", ...args]),
      clearRect: (...args: unknown[]) => calls.push(["clearRect", ...args]),
      drawImage: (...args: unknown[]) => calls.push(["drawImage", ...args]),
    };
    const canvas = {
      width: 640,
      height: 480,
      getContext: (kind: string) => (kind === "2d" ? context : null),
    } as unknown as HTMLCanvasElement;
    const layout = resolvePaImageHeatmapLayout({
      cssWidth: 520,
      cssHeight: 360,
      width: 10,
      height: 10,
    });

    expect(
      drawPaImageInteractiveOverlays(canvas, {
        baseCanvas,
        layout,
        scale: 2,
      }),
    ).toBe(true);

    expect(calls).toEqual([
      ["setTransform", 1, 0, 0, 1, 0, 0],
      ["clearRect", 0, 0, 640, 480],
      ["drawImage", baseCanvas, 0, 0],
      ["setTransform", 2, 0, 0, 2, 0, 0],
    ]);
  });
});
