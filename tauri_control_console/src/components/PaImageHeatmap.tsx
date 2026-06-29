import { memo, useEffect, useRef, type MouseEvent } from "react";

export type PaImageHeatmapProps = {
  width: number;
  height: number;
  values: Array<number | null>;
  counts: number[];
  active?: boolean;
  axisLabels?: PaImageAxisLabels;
  umPerCount?: number;
  selectedPixel?: PaImagePixel | null;
  zoom?: PaImageZoomDomain | null;
  roi?: PaImageZoomDomain | null;
  roiAspectRatio?: PaImageRoiAspectRatio;
  colormap?: PaImageColormap;
  enhancement?: PaImageEnhancement;
  mask?: boolean[] | null;
  onPixelSelect?: (pixel: PaImagePixel) => void;
  onZoom?: (zoom: PaImageZoomDomain) => void;
  onResetZoom?: () => void;
  onRoiChange?: (roi: PaImageZoomDomain | null) => void;
  onLayout?: (layout: PaImageRenderedLayout) => void;
};

export type PaImagePixel = { x: number; y: number };
export type PaImageZoomDomain = { xStart: number; xEnd: number; yStart: number; yEnd: number };
export type PaImageAxisLabels = { xStart?: number | null; xEnd?: number | null; yStart?: number | null; yEnd?: number | null };
export type PaImageRoiAspectRatio = "free" | "1:1" | "4:3" | "16:9";
export type PaImageColormap = "emerald" | "viridis" | "magma" | "turbo" | "gray";
export type PaImageEnhancement = "percentile" | "minmax" | "sqrt" | "log";
export type PaImageDragKind = "create" | "move" | "resizeStart" | "resizeEnd" | "click";
export type PaImageDisplayRange = { low: number; high: number; finiteCount: number };
export type PaImageRenderedLayout = {
  cssWidth: number;
  cssHeight: number;
  x0: number;
  y0: number;
  gridWidth: number;
  gridHeight: number;
};
type CanvasPoint = { x: number; y: number };
export type PaImageDragRectangle = { left: number; top: number; width: number; height: number };
type DragState = {
  start: CanvasPoint;
  kind: PaImageDragKind;
  startPixel: PaImagePixel | null;
  initialRoi?: PaImageZoomDomain | null;
  layout: ReturnType<typeof resolvePaImageHeatmapLayout>;
  rectLeft: number;
  rectTop: number;
};
export type CachedHeatmapRender = {
  baseCanvas: HTMLCanvasElement;
  layout: ReturnType<typeof resolvePaImageHeatmapLayout>;
  scale: number;
};

type HeatmapLayoutInput = {
  cssWidth: number;
  cssHeight: number;
  width: number;
  height: number;
  axisLabels?: PaImageAxisLabels;
  umPerCount?: number;
  zoom?: PaImageZoomDomain | null;
};

type HeatmapCanvasSizeInput = {
  rectWidth: number;
  rectHeight: number;
  devicePixelRatio: number;
};

type HeatmapCanvasBackingStoreTarget = {
  width: number;
  height: number;
};

const EMPTY_PA_IMAGE_VALUES: Array<number | null> = [];
const EMPTY_PA_IMAGE_COUNTS: number[] = [];

export function paImageValuesOrEmpty(values: Array<number | null> | undefined | null): Array<number | null> {
  return values ?? EMPTY_PA_IMAGE_VALUES;
}

export function paImageCountsOrEmpty(counts: number[] | undefined | null): number[] {
  return counts ?? EMPTY_PA_IMAGE_COUNTS;
}

export function resolvePaImageCanvasSize({ rectWidth, rectHeight, devicePixelRatio }: HeatmapCanvasSizeInput) {
  const cssWidth = Math.max(320, rectWidth || 520);
  const cssHeight = Math.max(260, rectHeight || 360);
  const scale = Math.max(1, devicePixelRatio || 1);
  return {
    cssWidth,
    cssHeight,
    backingWidth: Math.max(1, Math.floor(cssWidth * scale)),
    backingHeight: Math.max(1, Math.floor(cssHeight * scale)),
    scale,
  };
}

export function applyPaImageCanvasBackingStore(
  canvas: HeatmapCanvasBackingStoreTarget,
  size: ReturnType<typeof resolvePaImageCanvasSize>,
) {
  canvas.width = size.backingWidth;
  canvas.height = size.backingHeight;
}

export function copyPaImageBaseToCache(sourceCanvas: HTMLCanvasElement, cacheCanvas: HTMLCanvasElement): boolean {
  const cacheContext = cacheCanvas.getContext("2d");
  if (!cacheContext) return false;
  cacheCanvas.width = sourceCanvas.width;
  cacheCanvas.height = sourceCanvas.height;
  cacheContext.setTransform(1, 0, 0, 1, 0, 0);
  cacheContext.clearRect(0, 0, cacheCanvas.width, cacheCanvas.height);
  cacheContext.drawImage(sourceCanvas, 0, 0);
  return true;
}

function finiteAxisNumber(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function sameOptionalNumber(a: number | null | undefined, b: number | null | undefined): boolean {
  return a === b || (!finiteAxisNumber(a) && !finiteAxisNumber(b));
}

function sameAxisLabels(a: PaImageAxisLabels | null | undefined, b: PaImageAxisLabels | null | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    sameOptionalNumber(a.xStart, b.xStart) &&
    sameOptionalNumber(a.xEnd, b.xEnd) &&
    sameOptionalNumber(a.yStart, b.yStart) &&
    sameOptionalNumber(a.yEnd, b.yEnd)
  );
}

function samePixel(a: PaImagePixel | null | undefined, b: PaImagePixel | null | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.x === b.x && a.y === b.y;
}

function sameDomain(a: PaImageZoomDomain | null | undefined, b: PaImageZoomDomain | null | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.xStart === b.xStart && a.xEnd === b.xEnd && a.yStart === b.yStart && a.yEnd === b.yEnd;
}

export function arePaImageHeatmapPropsEqual(prev: PaImageHeatmapProps, next: PaImageHeatmapProps): boolean {
  return (
    prev.width === next.width &&
    prev.height === next.height &&
    prev.values === next.values &&
    prev.counts === next.counts &&
    prev.active === next.active &&
    prev.umPerCount === next.umPerCount &&
    prev.roiAspectRatio === next.roiAspectRatio &&
    prev.colormap === next.colormap &&
    prev.enhancement === next.enhancement &&
    prev.mask === next.mask &&
    sameAxisLabels(prev.axisLabels, next.axisLabels) &&
    samePixel(prev.selectedPixel, next.selectedPixel) &&
    sameDomain(prev.zoom, next.zoom) &&
    sameDomain(prev.roi, next.roi) &&
    prev.onPixelSelect === next.onPixelSelect &&
    prev.onZoom === next.onZoom &&
    prev.onResetZoom === next.onResetZoom &&
    prev.onRoiChange === next.onRoiChange &&
    prev.onLayout === next.onLayout
  );
}

function axisStepCounts(start: number | null | undefined, end: number | null | undefined, points: number): number | null {
  if (!finiteAxisNumber(start) || !finiteAxisNumber(end) || points <= 1) return null;
  const step = Math.abs((end - start) / (points - 1));
  return step > 0 && Number.isFinite(step) ? step : null;
}

function physicalCellCounts(width: number, height: number, axisLabels?: PaImageAxisLabels): { x: number; y: number } {
  const safeWidth = Math.max(1, Math.floor(width));
  const safeHeight = Math.max(1, Math.floor(height));
  const xStep = axisStepCounts(axisLabels?.xStart, axisLabels?.xEnd, safeWidth);
  const yStep = axisStepCounts(axisLabels?.yStart, axisLabels?.yEnd, safeHeight);
  return {
    x: xStep ?? yStep ?? 1,
    y: yStep ?? xStep ?? 1,
  };
}

export function resolvePaImageHeatmapLayout({ cssWidth, cssHeight, width, height, axisLabels, zoom }: HeatmapLayoutInput) {
  const marginLeft = 54;
  const marginTop = 28;
  const marginRight = 38;
  const marginBottom = 40;
  const plotWidth = Math.max(1, cssWidth - marginLeft - marginRight);
  const plotHeight = Math.max(1, cssHeight - marginTop - marginBottom);
  const safeWidth = Math.max(1, Math.floor(width));
  const safeHeight = Math.max(1, Math.floor(height));
  const domain = visibleDomain(safeWidth, safeHeight, zoom);
  const visibleWidth = Math.max(1, domain.xEnd - domain.xStart + 1);
  const visibleHeight = Math.max(1, domain.yEnd - domain.yStart + 1);
  const cellCounts = physicalCellCounts(safeWidth, safeHeight, axisLabels);
  const physicalWidth = Math.max(1e-9, visibleWidth * cellCounts.x);
  const physicalHeight = Math.max(1e-9, visibleHeight * cellCounts.y);
  const screenPerCount = Math.max(0.01, Math.min(plotWidth / physicalWidth, plotHeight / physicalHeight));
  const gridWidth = screenPerCount * physicalWidth;
  const gridHeight = screenPerCount * physicalHeight;
  const cell = gridWidth / visibleWidth;
  const x0 = marginLeft + Math.max(0, (plotWidth - gridWidth) / 2);
  const y0 = marginTop + Math.max(0, (plotHeight - gridHeight) / 2);
  return {
    cell,
    cellHeight: gridHeight / visibleHeight,
    cellWidth: gridWidth / visibleWidth,
    gridHeight,
    gridWidth,
    marginBottom,
    marginLeft,
    marginRight,
    marginTop,
    physicalHeight,
    physicalWidth,
    plotHeight,
    plotWidth,
    safeHeight,
    safeWidth,
    x0,
    y0,
  };
}

export function resolvePaImageAxisTextLayout(layout: ReturnType<typeof resolvePaImageHeatmapLayout>) {
  return {
    xTitle: { x: layout.x0 + layout.gridWidth / 2, y: layout.y0 + layout.gridHeight + 24 },
    yTitle: { x: layout.x0 - 42, y: layout.y0 + layout.gridHeight / 2 },
    yStart: { x: layout.x0 - 14, y: layout.y0 + layout.gridHeight },
    yEnd: { x: layout.x0 - 14, y: layout.y0 },
  };
}

function visibleDomain(width: number, height: number, zoom?: PaImageZoomDomain | null): PaImageZoomDomain {
  const safeWidth = Math.max(1, Math.floor(width));
  const safeHeight = Math.max(1, Math.floor(height));
  if (!zoom) return { xStart: 0, xEnd: safeWidth - 1, yStart: 0, yEnd: safeHeight - 1 };
  return {
    xStart: Math.max(0, Math.min(safeWidth - 1, Math.floor(Math.min(zoom.xStart, zoom.xEnd)))),
    xEnd: Math.max(0, Math.min(safeWidth - 1, Math.floor(Math.max(zoom.xStart, zoom.xEnd)))),
    yStart: Math.max(0, Math.min(safeHeight - 1, Math.floor(Math.min(zoom.yStart, zoom.yEnd)))),
    yEnd: Math.max(0, Math.min(safeHeight - 1, Math.floor(Math.max(zoom.yStart, zoom.yEnd)))),
  };
}

export function normalizePaImageZoomDomain(domain: PaImageZoomDomain, width: number, height: number): PaImageZoomDomain {
  const normalized = visibleDomain(width, height, domain);
  return {
    ...normalized,
    xEnd: Math.max(normalized.xStart, normalized.xEnd),
    yEnd: Math.max(normalized.yStart, normalized.yEnd),
  };
}

export function resolvePaImagePixelFromCanvasPoint({
  canvasX,
  canvasY,
  layout,
  zoom,
}: {
  canvasX: number;
  canvasY: number;
  layout: ReturnType<typeof resolvePaImageHeatmapLayout>;
  zoom?: PaImageZoomDomain | null;
}): PaImagePixel | null {
  if (canvasX < layout.x0 || canvasX > layout.x0 + layout.gridWidth || canvasY < layout.y0 || canvasY > layout.y0 + layout.gridHeight) {
    return null;
  }
  const domain = visibleDomain(layout.safeWidth, layout.safeHeight, zoom);
  const visibleWidth = Math.max(1, domain.xEnd - domain.xStart + 1);
  const visibleHeight = Math.max(1, domain.yEnd - domain.yStart + 1);
  const xUnit = Math.max(0, Math.min(0.999999, (canvasX - layout.x0) / Math.max(1, layout.gridWidth)));
  const yUnit = Math.max(0, Math.min(0.999999, (canvasY - layout.y0) / Math.max(1, layout.gridHeight)));
  const yFromTop = Math.floor(yUnit * visibleHeight);
  return {
    x: domain.xStart + Math.floor(xUnit * visibleWidth),
    y: domain.yEnd - yFromTop,
  };
}

export function resolvePaImageCanvasPointFromClient({
  clientX,
  clientY,
  rectLeft,
  rectTop,
}: {
  clientX: number;
  clientY: number;
  rectLeft: number;
  rectTop: number;
}): CanvasPoint {
  return {
    x: clientX - rectLeft,
    y: clientY - rectTop,
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function resolvePaImageDragRectangle({
  start,
  end,
  layout,
}: {
  start: CanvasPoint;
  end: CanvasPoint;
  layout: ReturnType<typeof resolvePaImageHeatmapLayout>;
}): PaImageDragRectangle | null {
  if (
    start.x < layout.x0 ||
    start.x > layout.x0 + layout.gridWidth ||
    start.y < layout.y0 ||
    start.y > layout.y0 + layout.gridHeight
  ) {
    return null;
  }
  const startX = clamp(start.x, layout.x0, layout.x0 + layout.gridWidth);
  const startY = clamp(start.y, layout.y0, layout.y0 + layout.gridHeight);
  const endX = clamp(end.x, layout.x0, layout.x0 + layout.gridWidth);
  const endY = clamp(end.y, layout.y0, layout.y0 + layout.gridHeight);
  const left = Math.min(startX, endX);
  const top = Math.min(startY, endY);
  return {
    left,
    top,
    width: Math.abs(endX - startX),
    height: Math.abs(endY - startY),
  };
}

function aspectRatioValue(aspectRatio: PaImageRoiAspectRatio | undefined): number | null {
  if (aspectRatio === "1:1") return 1;
  if (aspectRatio === "4:3") return 4 / 3;
  if (aspectRatio === "16:9") return 16 / 9;
  return null;
}

export function shouldDrawPaImageDragPreview(dragKind: PaImageDragKind): boolean {
  return dragKind === "create";
}

export function shouldPreviewPaImageRoiDrag(dragKind: PaImageDragKind): boolean {
  return dragKind === "move" || dragKind === "resizeStart" || dragKind === "resizeEnd";
}

export function dispatchPaImageCreatedDomain(
  domain: PaImageZoomDomain,
  callbacks: Pick<PaImageHeatmapProps, "onRoiChange" | "onZoom">,
) {
  if (callbacks.onRoiChange) {
    callbacks.onRoiChange(domain);
    return;
  }
  callbacks.onZoom?.(domain);
}

function drawPaImageDragPreviewOverlay(
  ctx: CanvasRenderingContext2D,
  dragPreview: { start: CanvasPoint; end: CanvasPoint; kind: PaImageDragKind } | null,
  layout: ReturnType<typeof resolvePaImageHeatmapLayout>,
  roiAspectRatio: PaImageRoiAspectRatio,
) {
  if (!dragPreview || !shouldDrawPaImageDragPreview(dragPreview.kind)) return;
  const dragRectangle = resolvePaImageConstrainedDragRectangle({
    start: dragPreview.start,
    end: dragPreview.end,
    layout,
    aspectRatio: roiAspectRatio,
  });
  const distance = Math.hypot(dragPreview.end.x - dragPreview.start.x, dragPreview.end.y - dragPreview.start.y);
  if (!dragRectangle || distance <= 5) return;
  ctx.save();
  ctx.fillStyle = "rgba(37, 99, 235, 0.14)";
  ctx.strokeStyle = "#2563eb";
  ctx.lineWidth = 1.5;
  ctx.setLineDash([6, 4]);
  ctx.fillRect(dragRectangle.left, dragRectangle.top, dragRectangle.width, dragRectangle.height);
  ctx.strokeRect(dragRectangle.left + 0.5, dragRectangle.top + 0.5, Math.max(0, dragRectangle.width - 1), Math.max(0, dragRectangle.height - 1));
  ctx.restore();
}

function drawPaImageRoiOverlay(
  ctx: CanvasRenderingContext2D,
  roi: PaImageZoomDomain | null | undefined,
  layout: ReturnType<typeof resolvePaImageHeatmapLayout>,
  zoom?: PaImageZoomDomain | null,
) {
  const roiRectangle = roi ? resolvePaImageDomainRectangle({ domain: roi, layout, zoom }) : null;
  if (!roiRectangle) return;
  ctx.save();
  ctx.fillStyle = "rgba(37, 99, 235, 0.12)";
  ctx.strokeStyle = "#2563eb";
  ctx.lineWidth = 2;
  ctx.setLineDash([7, 4]);
  ctx.fillRect(roiRectangle.left, roiRectangle.top, roiRectangle.width, roiRectangle.height);
  ctx.strokeRect(roiRectangle.left + 0.5, roiRectangle.top + 0.5, Math.max(0, roiRectangle.width - 1), Math.max(0, roiRectangle.height - 1));
  ctx.setLineDash([]);
  const handleRadius = 5;
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "#1d4ed8";
  ctx.lineWidth = 2;
  const handles = [
    { x: roiRectangle.left, y: roiRectangle.top },
    { x: roiRectangle.left + roiRectangle.width, y: roiRectangle.top + roiRectangle.height },
  ];
  for (const handle of handles) {
    ctx.beginPath();
    ctx.arc(handle.x, handle.y, handleRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

function drawPaImageSelectedPixelOverlay(
  ctx: CanvasRenderingContext2D,
  selectedPixel: PaImagePixel | null | undefined,
  layout: ReturnType<typeof resolvePaImageHeatmapLayout>,
  zoom?: PaImageZoomDomain | null,
) {
  const selectedRectangle = resolvePaImageSelectedPixelRectangle({ selectedPixel, layout, zoom });
  if (!selectedRectangle) return;
  ctx.save();
  ctx.strokeStyle = "#ef4444";
  ctx.lineWidth = 2;
  ctx.strokeRect(
    selectedRectangle.left + 0.5,
    selectedRectangle.top + 0.5,
    Math.max(2, selectedRectangle.width - 1),
    Math.max(2, selectedRectangle.height - 1),
  );
  ctx.restore();
}

export function drawPaImageInteractiveOverlays(
  canvas: HTMLCanvasElement,
  cached: CachedHeatmapRender,
  options: {
    dragPreview?: { start: CanvasPoint; end: CanvasPoint; kind: PaImageDragKind } | null;
    roiPreview?: PaImageZoomDomain | null;
    roi?: PaImageZoomDomain | null;
    selectedPixel?: PaImagePixel | null;
    zoom?: PaImageZoomDomain | null;
    roiAspectRatio?: PaImageRoiAspectRatio;
  } = {},
): boolean {
  const ctx = canvas.getContext("2d");
  if (!ctx) return false;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(cached.baseCanvas, 0, 0);
  ctx.setTransform(cached.scale, 0, 0, cached.scale, 0, 0);
  drawPaImageRoiOverlay(ctx, options.roiPreview ?? options.roi ?? null, cached.layout, options.zoom);
  drawPaImageSelectedPixelOverlay(ctx, options.selectedPixel, cached.layout, options.zoom);
  drawPaImageDragPreviewOverlay(ctx, options.dragPreview ?? null, cached.layout, options.roiAspectRatio ?? "free");
  return true;
}

export function resolvePaImageConstrainedDragRectangle({
  start,
  end,
  layout,
  aspectRatio,
}: {
  start: CanvasPoint;
  end: CanvasPoint;
  layout: ReturnType<typeof resolvePaImageHeatmapLayout>;
  aspectRatio?: PaImageRoiAspectRatio;
}): PaImageDragRectangle | null {
  if (
    start.x < layout.x0 ||
    start.x > layout.x0 + layout.gridWidth ||
    start.y < layout.y0 ||
    start.y > layout.y0 + layout.gridHeight
  ) {
    return null;
  }
  const ratio = aspectRatioValue(aspectRatio);
  if (!ratio) {
    return resolvePaImageDragRectangle({ start, end, layout });
  }

  const directionX = end.x >= start.x ? 1 : -1;
  const directionY = end.y >= start.y ? 1 : -1;
  const maxWidth = directionX > 0 ? layout.x0 + layout.gridWidth - start.x : start.x - layout.x0;
  const maxHeight = directionY > 0 ? layout.y0 + layout.gridHeight - start.y : start.y - layout.y0;
  const requestedWidth = Math.min(Math.abs(end.x - start.x), maxWidth);
  const requestedHeight = Math.min(Math.abs(end.y - start.y), maxHeight);
  let width = requestedWidth;
  let height = width / ratio;
  if (height > requestedHeight) {
    height = requestedHeight;
    width = height * ratio;
  }
  if (width > maxWidth) {
    width = maxWidth;
    height = width / ratio;
  }
  if (height > maxHeight) {
    height = maxHeight;
    width = height * ratio;
  }
  const endX = start.x + directionX * width;
  const endY = start.y + directionY * height;
  return resolvePaImageDragRectangle({ start, end: { x: endX, y: endY }, layout });
}

export function resolvePaImageDomainRectangle({
  domain,
  layout,
  zoom,
}: {
  domain: PaImageZoomDomain;
  layout: ReturnType<typeof resolvePaImageHeatmapLayout>;
  zoom?: PaImageZoomDomain | null;
}): PaImageDragRectangle | null {
  const visible = visibleDomain(layout.safeWidth, layout.safeHeight, zoom);
  const xStart = Math.max(visible.xStart, Math.min(domain.xStart, domain.xEnd));
  const xEnd = Math.min(visible.xEnd, Math.max(domain.xStart, domain.xEnd));
  const yStart = Math.max(visible.yStart, Math.min(domain.yStart, domain.yEnd));
  const yEnd = Math.min(visible.yEnd, Math.max(domain.yStart, domain.yEnd));
  if (xStart > xEnd || yStart > yEnd) return null;
  const topLeft = resolvePaImageCellRectangle({ x: xStart, y: yEnd, layout, zoom });
  const bottomRight = resolvePaImageCellRectangle({ x: xEnd, y: yStart, layout, zoom });
  return {
    left: topLeft.left,
    top: topLeft.top,
    width: bottomRight.left + bottomRight.width - topLeft.left,
    height: bottomRight.top + bottomRight.height - topLeft.top,
  };
}

export function resolvePaImageCellRectangle({
  x,
  y,
  layout,
  zoom,
}: {
  x: number;
  y: number;
  layout: ReturnType<typeof resolvePaImageHeatmapLayout>;
  zoom?: PaImageZoomDomain | null;
}) {
  const domain = visibleDomain(layout.safeWidth, layout.safeHeight, zoom);
  const visibleWidth = Math.max(1, domain.xEnd - domain.xStart + 1);
  const visibleHeight = Math.max(1, domain.yEnd - domain.yStart + 1);
  const drawCellWidth = layout.gridWidth / visibleWidth;
  const drawCellHeight = layout.gridHeight / visibleHeight;
  const visibleX = x - domain.xStart;
  const visibleY = domain.yEnd - y;
  const left = layout.x0 + visibleX * drawCellWidth;
  const top = layout.y0 + visibleY * drawCellHeight;
  const right = x === domain.xEnd ? layout.x0 + layout.gridWidth : layout.x0 + (visibleX + 1) * drawCellWidth;
  const bottom = y === domain.yStart ? layout.y0 + layout.gridHeight : layout.y0 + (visibleY + 1) * drawCellHeight;
  return {
    left,
    top,
    width: right - left,
    height: bottom - top,
  };
}

export function resolvePaImageSelectedPixelRectangle({
  selectedPixel,
  layout,
  zoom,
}: {
  selectedPixel?: PaImagePixel | null;
  layout: ReturnType<typeof resolvePaImageHeatmapLayout>;
  zoom?: PaImageZoomDomain | null;
}) {
  if (!selectedPixel) return null;
  const domain = visibleDomain(layout.safeWidth, layout.safeHeight, zoom);
  if (
    selectedPixel.x < domain.xStart ||
    selectedPixel.x > domain.xEnd ||
    selectedPixel.y < domain.yStart ||
    selectedPixel.y > domain.yEnd
  ) {
    return null;
  }
  return resolvePaImageCellRectangle({ x: selectedPixel.x, y: selectedPixel.y, layout, zoom });
}

function interpolateColor(stops: Array<[number, number, number]>, value: number): [number, number, number] {
  const v = Math.max(0, Math.min(1, value));
  const scaled = v * (stops.length - 1);
  const index = Math.max(0, Math.min(stops.length - 2, Math.floor(scaled)));
  const local = scaled - index;
  const start = stops[index];
  const end = stops[index + 1];
  return [
    Math.round(start[0] + (end[0] - start[0]) * local),
    Math.round(start[1] + (end[1] - start[1]) * local),
    Math.round(start[2] + (end[2] - start[2]) * local),
  ];
}

export function paImageColorRgbForUnit(value: number, colormap: PaImageColormap = "emerald"): [number, number, number] {
  const v = Math.max(0, Math.min(1, value));
  if (colormap === "gray") {
    const level = Math.round(255 * v);
    return [level, level, level];
  }
  if (colormap === "viridis") {
    return interpolateColor(
      [
        [68, 1, 84],
        [59, 82, 139],
        [33, 145, 140],
        [94, 201, 98],
        [253, 231, 37],
      ],
      v,
    );
  }
  if (colormap === "magma") {
    return interpolateColor(
      [
        [0, 0, 4],
        [80, 18, 123],
        [182, 54, 121],
        [251, 136, 97],
        [252, 253, 191],
      ],
      v,
    );
  }
  if (colormap === "turbo") {
    return interpolateColor(
      [
        [48, 18, 59],
        [49, 110, 221],
        [28, 189, 178],
        [144, 214, 67],
        [254, 191, 42],
        [221, 50, 32],
      ],
      v,
    );
  }
  const r = Math.round(20 + (215 * Math.max(0, v - 0.45)) / 0.55);
  const g = Math.round(90 + 150 * (1 - Math.abs(v - 0.55)));
  const b = Math.round(140 * (1 - v));
  return [r, g, b];
}

function partitionNumbers(values: number[], left: number, right: number, pivotIndex: number): number {
  const pivotValue = values[pivotIndex];
  [values[pivotIndex], values[right]] = [values[right], values[pivotIndex]];
  let storeIndex = left;
  for (let index = left; index < right; index += 1) {
    if (values[index] < pivotValue) {
      [values[storeIndex], values[index]] = [values[index], values[storeIndex]];
      storeIndex += 1;
    }
  }
  [values[right], values[storeIndex]] = [values[storeIndex], values[right]];
  return storeIndex;
}

function selectKthNumber(values: number[], kth: number): number {
  if (values.length === 0) return 0;
  let left = 0;
  let right = values.length - 1;
  const target = Math.max(0, Math.min(values.length - 1, kth));
  while (left < right) {
    const pivotIndex = Math.floor((left + right) / 2);
    const nextPivotIndex = partitionNumbers(values, left, right, pivotIndex);
    if (target === nextPivotIndex) return values[target];
    if (target < nextPivotIndex) right = nextPivotIndex - 1;
    else left = nextPivotIndex + 1;
  }
  return values[left];
}

export function paImagePercentileRange(
  values: Array<number | null>,
  lowUnit = 0.01,
  highUnit = 0.99,
): { low: number; high: number; finiteCount: number } {
  const finiteValues: number[] = [];
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (typeof value === "number" && Number.isFinite(value)) finiteValues.push(value);
  }
  if (finiteValues.length === 0) return { low: 0, high: 0, finiteCount: 0 };
  const lowIndex = Math.max(0, Math.min(finiteValues.length - 1, Math.round(lowUnit * (finiteValues.length - 1))));
  const highIndex = Math.max(0, Math.min(finiteValues.length - 1, Math.round(highUnit * (finiteValues.length - 1))));
  const low = selectKthNumber(finiteValues, Math.min(lowIndex, highIndex));
  const high = selectKthNumber(finiteValues, Math.max(lowIndex, highIndex));
  return { low, high, finiteCount: finiteValues.length };
}

function paImagePercentileRangeForDomain({
  values,
  counts,
  width,
  domain,
  lowUnit = 0.01,
  highUnit = 0.99,
}: {
  values: Array<number | null>;
  counts?: number[];
  width: number;
  domain: PaImageZoomDomain;
  lowUnit?: number;
  highUnit?: number;
}): { low: number; high: number; finiteCount: number } {
  const finiteValues: number[] = [];
  for (let y = domain.yStart; y <= domain.yEnd; y += 1) {
    const rowOffset = y * width;
    for (let x = domain.xStart; x <= domain.xEnd; x += 1) {
      const index = rowOffset + x;
      if (counts && (counts[index] ?? 0) <= 0) continue;
      const value = values[rowOffset + x];
      if (typeof value === "number" && Number.isFinite(value)) finiteValues.push(value);
    }
  }
  if (finiteValues.length === 0) return { low: 0, high: 0, finiteCount: 0 };
  const lowIndex = Math.max(0, Math.min(finiteValues.length - 1, Math.round(lowUnit * (finiteValues.length - 1))));
  const highIndex = Math.max(0, Math.min(finiteValues.length - 1, Math.round(highUnit * (finiteValues.length - 1))));
  const low = selectKthNumber(finiteValues, Math.min(lowIndex, highIndex));
  const high = selectKthNumber(finiteValues, Math.max(lowIndex, highIndex));
  return { low, high, finiteCount: finiteValues.length };
}

export function paImageDisplayRange(
  values: Array<number | null>,
  counts: number[],
  zoom: PaImageZoomDomain | null | undefined,
  width: number,
  height: number,
  enhancement: PaImageEnhancement = "percentile",
): PaImageDisplayRange {
  const safeWidth = Math.max(1, Math.floor(width));
  const safeHeight = Math.max(1, Math.floor(height));
  const domain = visibleDomain(safeWidth, safeHeight, zoom);
  const useMinMax = enhancement === "minmax";
  return paImagePercentileRangeForDomain({
    values,
    counts,
    width: safeWidth,
    domain,
    lowUnit: useMinMax ? 0 : 0.01,
    highUnit: useMinMax ? 1 : 0.99,
  });
}

export function paImageEnhancedUnit(
  value: number,
  range: PaImageDisplayRange,
  enhancement: PaImageEnhancement = "percentile",
): number {
  const span = Math.max(1e-12, range.high - range.low);
  const normalized = Math.max(0, Math.min(1, (value - range.low) / span));
  if (enhancement === "sqrt") return Math.sqrt(normalized);
  if (enhancement === "log") return Math.log1p(normalized * 9) / Math.log(10);
  return normalized;
}

function compactDistanceNumber(value: number): string {
  if (!Number.isFinite(value)) return "--";
  const abs = Math.abs(value);
  const digits = abs >= 100 ? 2 : abs >= 10 ? 3 : 4;
  const rounded = Math.round(value * 10 ** digits) / 10 ** digits;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded).replace(/0+$/, "").replace(/\.$/, "");
}

export function formatPaImageDistanceUm(valueUm: number): string {
  if (!Number.isFinite(valueUm)) return "--";
  const abs = Math.abs(valueUm);
  if (abs > 0 && abs < 1) return `${compactDistanceNumber(valueUm * 1000)} nm`;
  if (abs >= 1000) return `${compactDistanceNumber(valueUm / 1000)} mm`;
  return `${compactDistanceNumber(valueUm)} um`;
}

function coordForIndex(start: number | null | undefined, end: number | null | undefined, index: number, maxIndex: number): number | null {
  if (typeof start !== "number" || typeof end !== "number" || !Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (maxIndex <= 0) return start;
  return start + ((end - start) * index) / maxIndex;
}

export function resolvePaImageAxisDistanceLabel({
  start,
  end,
  index,
  maxIndex,
  umPerCount,
}: {
  start: number | null | undefined;
  end: number | null | undefined;
  index: number;
  maxIndex: number;
  umPerCount: number;
}): string {
  const countValue = coordForIndex(start, end, index, maxIndex);
  if (countValue === null || !finiteAxisNumber(start)) return "--";
  const safeUmPerCount = Number.isFinite(umPerCount) && umPerCount > 0 ? umPerCount : 1;
  return formatPaImageDistanceUm(Math.abs(countValue - start) * safeUmPerCount);
}

export type PaImageRaster = {
  width: number;
  height: number;
  finiteCount: number;
  pixels: Uint8ClampedArray;
  sourceIndices?: number[];
};

export function buildPaImageRaster({
  width,
  height,
  values,
  counts,
  zoom,
  colormap = "emerald",
  enhancement = "percentile",
  mask,
  includeSourceIndices = false,
}: {
  width: number;
  height: number;
  values: Array<number | null>;
  counts: number[];
  zoom?: PaImageZoomDomain | null;
  colormap?: PaImageColormap;
  enhancement?: PaImageEnhancement;
  mask?: boolean[] | null;
  includeSourceIndices?: boolean;
}): PaImageRaster {
  const safeWidth = Math.max(1, Math.floor(width));
  const safeHeight = Math.max(1, Math.floor(height));
  const domain = visibleDomain(safeWidth, safeHeight, zoom);
  const rasterWidth = Math.max(1, domain.xEnd - domain.xStart + 1);
  const rasterHeight = Math.max(1, domain.yEnd - domain.yStart + 1);
  const range = paImageDisplayRange(values, counts, zoom, safeWidth, safeHeight, enhancement);
  const pixels = new Uint8ClampedArray(rasterWidth * rasterHeight * 4);
  const sourceIndices = includeSourceIndices ? [] as number[] : undefined;
  let write = 0;
  for (let row = 0; row < rasterHeight; row += 1) {
    const y = domain.yEnd - row;
    for (let col = 0; col < rasterWidth; col += 1) {
      const x = domain.xStart + col;
      const index = y * safeWidth + x;
      sourceIndices?.push(index);
      const value = values[index];
      const count = counts[index] ?? 0;
      const valid = typeof value === "number" && Number.isFinite(value) && count > 0;
      const maskedOut = valid && mask && !mask[index];
      const [r, g, b] = valid && !maskedOut
        ? paImageColorRgbForUnit(paImageEnhancedUnit(value, range, enhancement), colormap)
        : maskedOut
          ? [226, 232, 240]
          : [229, 231, 235];
      pixels[write] = r;
      pixels[write + 1] = g;
      pixels[write + 2] = b;
      pixels[write + 3] = 255;
      write += 4;
    }
  }

  const raster: PaImageRaster = {
    width: rasterWidth,
    height: rasterHeight,
    finiteCount: range.finiteCount,
    pixels,
  };
  if (sourceIndices) raster.sourceIndices = sourceIndices;
  return raster;
}

function PaImageHeatmap({
  width,
  height,
  values,
  counts,
  active = true,
  axisLabels,
  umPerCount = 1,
  selectedPixel,
  zoom,
  roi,
  roiAspectRatio = "free",
  colormap = "emerald",
  enhancement = "percentile",
  mask,
  onPixelSelect,
  onZoom,
  onResetZoom,
  onRoiChange,
  onLayout,
}: PaImageHeatmapProps) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const rasterCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const baseCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const dragStateRef = useRef<DragState | null>(null);
  const cachedRenderRef = useRef<CachedHeatmapRender | null>(null);
  const pendingDragPreviewRef = useRef<{ start: CanvasPoint; end: CanvasPoint; kind: PaImageDragKind } | null>(null);
  const dragPreviewAnimationFrame = useRef<number | null>(null);
  const pendingRoiPreviewRef = useRef<PaImageZoomDomain | null>(null);
  const roiPreviewAnimationFrame = useRef<number | null>(null);

  const redrawInteractiveOverlays = (
    dragPreview: { start: CanvasPoint; end: CanvasPoint; kind: PaImageDragKind } | null,
    roiPreview: PaImageZoomDomain | null,
  ) => {
    const canvas = ref.current;
    const cached = cachedRenderRef.current;
    if (!canvas || !cached) return false;
    return drawPaImageInteractiveOverlays(canvas, cached, {
      dragPreview,
      roiPreview,
      roi,
      selectedPixel,
      zoom,
      roiAspectRatio,
    });
  };

  useEffect(
    () => () => {
      if (dragPreviewAnimationFrame.current !== null) {
        window.cancelAnimationFrame(dragPreviewAnimationFrame.current);
        dragPreviewAnimationFrame.current = null;
      }
      if (roiPreviewAnimationFrame.current !== null) {
        window.cancelAnimationFrame(roiPreviewAnimationFrame.current);
        roiPreviewAnimationFrame.current = null;
      }
    },
    [],
  );

  const scheduleDragPreview = (nextPreview: { start: CanvasPoint; end: CanvasPoint; kind: PaImageDragKind } | null) => {
    pendingDragPreviewRef.current = nextPreview;
    if (dragPreviewAnimationFrame.current !== null) return;
    dragPreviewAnimationFrame.current = window.requestAnimationFrame(() => {
      dragPreviewAnimationFrame.current = null;
      redrawInteractiveOverlays(pendingDragPreviewRef.current, pendingRoiPreviewRef.current);
    });
  };

  const clearDragPreview = () => {
    pendingDragPreviewRef.current = null;
    if (dragPreviewAnimationFrame.current !== null) {
      window.cancelAnimationFrame(dragPreviewAnimationFrame.current);
      dragPreviewAnimationFrame.current = null;
    }
    redrawInteractiveOverlays(null, pendingRoiPreviewRef.current);
  };

  const scheduleRoiPreview = (nextPreview: PaImageZoomDomain | null) => {
    pendingRoiPreviewRef.current = nextPreview;
    if (roiPreviewAnimationFrame.current !== null) return;
    roiPreviewAnimationFrame.current = window.requestAnimationFrame(() => {
      roiPreviewAnimationFrame.current = null;
      redrawInteractiveOverlays(pendingDragPreviewRef.current, pendingRoiPreviewRef.current);
    });
  };

  const clearRoiPreview = () => {
    pendingRoiPreviewRef.current = null;
    if (roiPreviewAnimationFrame.current !== null) {
      window.cancelAnimationFrame(roiPreviewAnimationFrame.current);
      roiPreviewAnimationFrame.current = null;
    }
    redrawInteractiveOverlays(pendingDragPreviewRef.current, null);
  };

  const clearDragOverlays = () => {
    clearDragPreview();
    clearRoiPreview();
  };

  useEffect(() => {
    if (!active) return;
    const canvas = ref.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const canvasSize = resolvePaImageCanvasSize({
      rectWidth: rect.width,
      rectHeight: rect.height,
      devicePixelRatio: window.devicePixelRatio || 1,
    });
    const { cssHeight, cssWidth, scale } = canvasSize;
    applyPaImageCanvasBackingStore(canvas, canvasSize);

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.clearRect(0, 0, cssWidth, cssHeight);
    ctx.fillStyle = "#f8fafc";
    ctx.fillRect(0, 0, cssWidth, cssHeight);

    const layout = resolvePaImageHeatmapLayout({
      cssWidth,
      cssHeight,
      width,
      height,
      axisLabels,
      umPerCount,
      zoom,
    });
    const { gridHeight, gridWidth, safeHeight, safeWidth, x0, y0 } = layout;
    onLayout?.({ cssWidth, cssHeight, x0, y0, gridWidth, gridHeight });
    const domain = visibleDomain(safeWidth, safeHeight, zoom);
    const raster = buildPaImageRaster({ width: safeWidth, height: safeHeight, values, counts, zoom, colormap, enhancement, mask });
    const rasterCanvas = rasterCanvasRef.current ?? document.createElement("canvas");
    rasterCanvasRef.current = rasterCanvas;
    rasterCanvas.width = raster.width;
    rasterCanvas.height = raster.height;
    const rasterCtx = rasterCanvas.getContext("2d");
    if (rasterCtx) {
      const imageData = rasterCtx.createImageData(raster.width, raster.height);
      imageData.data.set(raster.pixels);
      rasterCtx.putImageData(imageData, 0, 0);
      ctx.save();
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(rasterCanvas, x0, y0, gridWidth, gridHeight);
      ctx.restore();
    }

    ctx.strokeStyle = "#d5dfeb";
    ctx.lineWidth = 1;
    ctx.strokeRect(x0 - 0.5, y0 - 0.5, gridWidth + 1, gridHeight + 1);

    ctx.fillStyle = "#475569";
    ctx.font = "12px Segoe UI, sans-serif";
    const axisTextLayout = resolvePaImageAxisTextLayout(layout);
    ctx.textAlign = "center";
    ctx.fillText(
      resolvePaImageAxisDistanceLabel({
        start: axisLabels?.xStart,
        end: axisLabels?.xEnd,
        index: domain.xStart,
        maxIndex: safeWidth - 1,
        umPerCount,
      }),
      x0,
      y0 - 9,
    );
    ctx.fillText(
      resolvePaImageAxisDistanceLabel({
        start: axisLabels?.xStart,
        end: axisLabels?.xEnd,
        index: domain.xEnd,
        maxIndex: safeWidth - 1,
        umPerCount,
      }),
      x0 + gridWidth,
      y0 - 9,
    );
    ctx.fillText("X", axisTextLayout.xTitle.x, axisTextLayout.xTitle.y);
    ctx.save();
    ctx.translate(axisTextLayout.yTitle.x, axisTextLayout.yTitle.y);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText("Y", 0, 0);
    ctx.restore();
    ctx.save();
    ctx.translate(axisTextLayout.yStart.x, axisTextLayout.yStart.y);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = "left";
    ctx.fillText(
      resolvePaImageAxisDistanceLabel({
        start: axisLabels?.yStart,
        end: axisLabels?.yEnd,
        index: domain.yStart,
        maxIndex: safeHeight - 1,
        umPerCount,
      }),
      0,
      0,
    );
    ctx.restore();
    ctx.save();
    ctx.translate(axisTextLayout.yEnd.x, axisTextLayout.yEnd.y);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = "right";
    ctx.fillText(
      resolvePaImageAxisDistanceLabel({
        start: axisLabels?.yStart,
        end: axisLabels?.yEnd,
        index: domain.yEnd,
        maxIndex: safeHeight - 1,
        umPerCount,
      }),
      0,
      0,
    );
    ctx.restore();

    if (raster.finiteCount === 0) {
      ctx.fillStyle = "#64748b";
      ctx.textAlign = "center";
      ctx.fillText("No PA image values", x0 + gridWidth / 2, y0 + gridHeight / 2);
    }

    const baseCanvas = baseCanvasRef.current ?? document.createElement("canvas");
    baseCanvasRef.current = baseCanvas;
    if (copyPaImageBaseToCache(canvas, baseCanvas)) {
      cachedRenderRef.current = {
        baseCanvas,
        layout,
        scale,
      };
    }
  }, [
    active,
    axisLabels?.xEnd,
    axisLabels?.xStart,
    axisLabels?.yEnd,
    axisLabels?.yStart,
    counts,
    height,
    colormap,
    enhancement,
    mask,
    onLayout,
    umPerCount,
    values,
    width,
    zoom,
  ]);

  useEffect(() => {
    if (!active) return;
    redrawInteractiveOverlays(null, null);
  }, [active, roi, roiAspectRatio, selectedPixel, zoom]);

  const canvasPoint = (event: MouseEvent<HTMLCanvasElement>, dragState?: Pick<DragState, "rectLeft" | "rectTop"> | null) => {
    if (dragState) {
      return resolvePaImageCanvasPointFromClient({
        clientX: event.clientX,
        clientY: event.clientY,
        rectLeft: dragState.rectLeft,
        rectTop: dragState.rectTop,
      });
    }
    const canvas = ref.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return resolvePaImageCanvasPointFromClient({
      clientX: event.clientX,
      clientY: event.clientY,
      rectLeft: rect.left,
      rectTop: rect.top,
    });
  };

  const layoutForCanvasRect = (rect: Pick<DOMRect, "width" | "height">) =>
    resolvePaImageHeatmapLayout({
      cssWidth: Math.max(320, rect.width || 520),
      cssHeight: Math.max(260, rect.height || 360),
      width,
      height,
      axisLabels,
      umPerCount,
      zoom,
    });

  const dragGeometryForCanvas = () => {
    const canvas = ref.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return {
      layout: layoutForCanvasRect(rect),
      rectLeft: rect.left,
      rectTop: rect.top,
    };
  };

  const domainFromCanvasRectangle = (
    start: CanvasPoint,
    end: CanvasPoint,
    layout: ReturnType<typeof resolvePaImageHeatmapLayout>,
  ): PaImageZoomDomain | null => {
    const rectangle = resolvePaImageConstrainedDragRectangle({ start, end, layout, aspectRatio: roiAspectRatio });
    if (!rectangle || rectangle.width < 1 || rectangle.height < 1) return null;
    const firstPixel = resolvePaImagePixelFromCanvasPoint({ canvasX: rectangle.left, canvasY: rectangle.top, layout, zoom });
    const lastPixel = resolvePaImagePixelFromCanvasPoint({
      canvasX: rectangle.left + rectangle.width - 0.1,
      canvasY: rectangle.top + rectangle.height - 0.1,
      layout,
      zoom,
    });
    if (!firstPixel || !lastPixel) return null;
    return normalizePaImageZoomDomain(
      {
        xStart: Math.min(firstPixel.x, lastPixel.x),
        xEnd: Math.max(firstPixel.x, lastPixel.x),
        yStart: Math.min(firstPixel.y, lastPixel.y),
        yEnd: Math.max(firstPixel.y, lastPixel.y),
      },
      width,
      height,
    );
  };

  const roiHitKind = (
    point: CanvasPoint,
    layout: ReturnType<typeof resolvePaImageHeatmapLayout>,
  ): DragState["kind"] | null => {
    if (!roi) return null;
    const rectangle = resolvePaImageDomainRectangle({ domain: roi, layout, zoom });
    if (!rectangle) return null;
    const near = (x: number, y: number) => Math.hypot(point.x - x, point.y - y) <= 11;
    if (near(rectangle.left, rectangle.top)) return "resizeStart";
    if (near(rectangle.left + rectangle.width, rectangle.top + rectangle.height)) return "resizeEnd";
    if (
      point.x >= rectangle.left &&
      point.x <= rectangle.left + rectangle.width &&
      point.y >= rectangle.top &&
      point.y <= rectangle.top + rectangle.height
    ) {
      return "move";
    }
    return null;
  };

  const shiftRoiByPixels = (initialRoi: PaImageZoomDomain, startPixel: PaImagePixel, endPixel: PaImagePixel) => {
    const dx = endPixel.x - startPixel.x;
    const dy = endPixel.y - startPixel.y;
    const widthPixels = Math.abs(initialRoi.xEnd - initialRoi.xStart);
    const heightPixels = Math.abs(initialRoi.yEnd - initialRoi.yStart);
    const minX = Math.max(0, Math.min(width - 1 - widthPixels, Math.min(initialRoi.xStart, initialRoi.xEnd) + dx));
    const minY = Math.max(0, Math.min(height - 1 - heightPixels, Math.min(initialRoi.yStart, initialRoi.yEnd) + dy));
    return normalizePaImageZoomDomain(
      {
        xStart: minX,
        xEnd: minX + widthPixels,
        yStart: minY,
        yEnd: minY + heightPixels,
      },
      width,
      height,
    );
  };

  const roiForDragState = (
    dragState: DragState,
    end: CanvasPoint,
    layout: ReturnType<typeof resolvePaImageHeatmapLayout>,
    endPixel: PaImagePixel,
  ): PaImageZoomDomain | null => {
    if (!dragState.initialRoi || !dragState.startPixel || !shouldPreviewPaImageRoiDrag(dragState.kind)) return null;
    if (dragState.kind === "move") {
      return shiftRoiByPixels(dragState.initialRoi, dragState.startPixel, endPixel);
    }
    const rectangle = resolvePaImageDomainRectangle({ domain: dragState.initialRoi, layout, zoom });
    if (!rectangle) return null;
    if (dragState.kind === "resizeStart") {
      return domainFromCanvasRectangle({ x: rectangle.left + rectangle.width, y: rectangle.top + rectangle.height }, end, layout);
    }
    if (dragState.kind === "resizeEnd") {
      return domainFromCanvasRectangle({ x: rectangle.left, y: rectangle.top }, end, layout);
    }
    return null;
  };

  const handleMouseDown = (event: MouseEvent<HTMLCanvasElement>) => {
    if (event.button !== 0) return;
    const geometry = dragGeometryForCanvas();
    const point = canvasPoint(event, geometry);
    if (!point || !geometry) {
      dragStateRef.current = null;
      clearDragOverlays();
      return;
    }
    const { layout } = geometry;
    const startPixel = resolvePaImagePixelFromCanvasPoint({ canvasX: point.x, canvasY: point.y, layout, zoom });
    const kind = roiHitKind(point, layout) ?? "create";
    dragStateRef.current = {
      start: point,
      kind,
      startPixel,
      initialRoi: roi,
      layout,
      rectLeft: geometry.rectLeft,
      rectTop: geometry.rectTop,
    };
    scheduleDragPreview(shouldDrawPaImageDragPreview(kind) ? { start: point, end: point, kind } : null);
    clearRoiPreview();
  };

  const handleMouseMove = (event: MouseEvent<HTMLCanvasElement>) => {
    const dragState = dragStateRef.current;
    if (!dragState) return;
    const end = canvasPoint(event, dragState);
    if (!end) return;
    if (dragState.kind === "click") return;
    scheduleDragPreview(
      shouldDrawPaImageDragPreview(dragState.kind)
        ? { start: dragState.start, end, kind: dragState.kind }
        : null,
    );
    const layout = dragState.layout;
    const endPixel = layout ? resolvePaImagePixelFromCanvasPoint({ canvasX: end.x, canvasY: end.y, layout, zoom }) : null;
    if (!layout || !endPixel) return;
    if (shouldPreviewPaImageRoiDrag(dragState.kind)) {
      scheduleRoiPreview(roiForDragState(dragState, end, layout, endPixel));
    }
  };

  const handleMouseUp = (event: MouseEvent<HTMLCanvasElement>) => {
    if (event.button !== 0) return;
    const dragState = dragStateRef.current;
    dragStateRef.current = null;
    clearDragOverlays();
    const end = canvasPoint(event, dragState);
    const layout = dragState?.layout;
    if (!dragState || !end || !layout) return;
    const start = dragState.start;
    const startPixel = dragState.startPixel;
    const endPixel = resolvePaImagePixelFromCanvasPoint({ canvasX: end.x, canvasY: end.y, layout, zoom });
    if (!startPixel || !endPixel) return;
    const distance = Math.hypot(end.x - start.x, end.y - start.y);
    if (distance <= 5) {
      onPixelSelect?.(endPixel);
      return;
    }
    if (dragState.kind === "create") {
      const nextRoi = domainFromCanvasRectangle(start, end, layout);
      if (nextRoi) {
        dispatchPaImageCreatedDomain(nextRoi, { onRoiChange, onZoom });
      }
    } else if (shouldPreviewPaImageRoiDrag(dragState.kind)) {
      const nextRoi = roiForDragState(dragState, end, layout, endPixel);
      if (nextRoi) onRoiChange?.(nextRoi);
    }
  };

  const handleContextMenu = (event: MouseEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    dragStateRef.current = null;
    clearDragOverlays();
    onResetZoom?.();
  };

  return (
    <canvas
      ref={ref}
      className="pa-image-heatmap"
      aria-label="PA image heatmap"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onContextMenu={handleContextMenu}
    />
  );
}

export default memo(PaImageHeatmap, arePaImageHeatmapPropsEqual);
