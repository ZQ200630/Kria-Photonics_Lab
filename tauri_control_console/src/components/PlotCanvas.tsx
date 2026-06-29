import { useEffect, useRef, useState } from "react";
import type { LevelCrossing } from "../utils/lockSpectrum";

const PLOT_LEFT = 72;
const PLOT_RIGHT_PADDING = 86;
const PLOT_TOP = 24;
const PLOT_BOTTOM_PADDING = 54;
const PLOT_SELECTION_MIN_PIXELS = 5;

type CanvasPoint = {
  x: number;
  y: number;
};

export type CachedPlotRender = {
  baseCanvas: HTMLCanvasElement;
  scale: number;
  cssWidth: number;
  cssHeight: number;
  plotDomain: PlotXDomain;
  range: PlotRange;
  valuesLength: number;
};

export type PlotDragGeometry = {
  rectLeft: number;
  rectWidth: number;
  domain: PlotXDomain;
};

export type PlotPointerGeometry = {
  rectLeft: number;
  rectTop: number;
  rectWidth: number;
};

export type PlotThresholdDragGeometry = {
  rectTop: number;
  height: number;
  range: PlotRange;
};

export function indexFromCanvasX(x: number, width: number, count: number): number {
  if (count <= 1 || width <= 0) return 0;
  const ratio = Math.max(0, Math.min(1, x / width));
  return Math.max(0, Math.min(count - 1, Math.round(ratio * (count - 1))));
}

export type PlotXDomain = {
  startIndex: number;
  endIndex: number;
};

export type PlotPoint = {
  xIndex: number;
  value: number;
};

export type PlotDomainWindow = {
  startIndex: number;
  endIndex: number;
  color?: string;
  borderColor?: string;
};

export type PlotOverlay = {
  values: number[];
  color: string;
  label?: string;
  lineWidth?: number;
  alpha?: number;
  xOffset?: number;
  maxIndex?: number;
};

export type PlotVerticalMarker = {
  index: number;
  color: string;
  label?: string;
};

export type PlotHighlightWindow = {
  startIndex: number;
  endIndex: number;
  color?: string;
  borderColor?: string;
};

const EMPTY_PLOT_OVERLAYS: PlotOverlay[] = [];
const EMPTY_PLOT_VERTICAL_MARKERS: PlotVerticalMarker[] = [];
const EMPTY_PLOT_HIGHLIGHT_WINDOWS: PlotHighlightWindow[] = [];
const EMPTY_PLOT_DOMAIN_WINDOWS: PlotDomainWindow[] = [];
const EMPTY_PLOT_CROSSINGS: LevelCrossing[] = [];

export function plotOverlaysOrEmpty(overlays: PlotOverlay[] | undefined): PlotOverlay[] {
  return overlays ?? EMPTY_PLOT_OVERLAYS;
}

export function plotVerticalMarkersOrEmpty(markers: PlotVerticalMarker[] | undefined): PlotVerticalMarker[] {
  return markers ?? EMPTY_PLOT_VERTICAL_MARKERS;
}

export function plotHighlightWindowsOrEmpty(windows: PlotHighlightWindow[] | undefined): PlotHighlightWindow[] {
  return windows ?? EMPTY_PLOT_HIGHLIGHT_WINDOWS;
}

export function plotDomainWindowsOrEmpty(windows: PlotDomainWindow[] | undefined): PlotDomainWindow[] {
  return windows ?? EMPTY_PLOT_DOMAIN_WINDOWS;
}

export function plotCrossingsOrEmpty(crossings: LevelCrossing[] | undefined): LevelCrossing[] {
  return crossings ?? EMPTY_PLOT_CROSSINGS;
}

export function intersectPlotDomainWindow(window: PlotXDomain, domain: PlotXDomain): PlotXDomain | undefined {
  const windowStart = Math.min(window.startIndex, window.endIndex);
  const windowEnd = Math.max(window.startIndex, window.endIndex);
  const domainStart = Math.min(domain.startIndex, domain.endIndex);
  const domainEnd = Math.max(domain.startIndex, domain.endIndex);
  const startIndex = Math.max(windowStart, domainStart);
  const endIndex = Math.min(windowEnd, domainEnd);
  return endIndex >= startIndex ? { startIndex, endIndex } : undefined;
}

export function copyPlotBaseToCache(sourceCanvas: HTMLCanvasElement, cacheCanvas: HTMLCanvasElement): boolean {
  const cacheContext = cacheCanvas.getContext("2d");
  if (!cacheContext) return false;
  cacheCanvas.width = sourceCanvas.width;
  cacheCanvas.height = sourceCanvas.height;
  cacheContext.setTransform(1, 0, 0, 1, 0, 0);
  cacheContext.clearRect(0, 0, cacheCanvas.width, cacheCanvas.height);
  cacheContext.drawImage(sourceCanvas, 0, 0);
  return true;
}

type PlotPointBin = {
  first?: PlotPoint;
  last?: PlotPoint;
  min?: PlotPoint;
  max?: PlotPoint;
};

function samePlotPoint(a: PlotPoint | undefined, b: PlotPoint | undefined): boolean {
  return Boolean(a && b && a.xIndex === b.xIndex && a.value === b.value);
}

export function downsamplePlotPointsForPixels(points: PlotPoint[], domain: PlotXDomain, pixelWidth: number): PlotPoint[] {
  const domainStart = Math.min(domain.startIndex, domain.endIndex);
  const domainEnd = Math.max(domain.startIndex, domain.endIndex);
  const binCount = Math.max(1, Math.floor(pixelWidth));
  if (points.length <= binCount * 4) {
    return points.filter(
      (point) =>
        point.xIndex >= domainStart &&
        point.xIndex <= domainEnd &&
        typeof point.value === "number" &&
        Number.isFinite(point.value),
    );
  }

  const bins: PlotPointBin[] = Array.from({ length: binCount }, () => ({}));
  const span = Math.max(1, domainEnd - domainStart);
  points.forEach((point) => {
    if (
      point.xIndex < domainStart ||
      point.xIndex > domainEnd ||
      typeof point.value !== "number" ||
      !Number.isFinite(point.value)
    ) {
      return;
    }
    const binIndex = Math.max(0, Math.min(binCount - 1, Math.floor(((point.xIndex - domainStart) / span) * binCount)));
    const bin = bins[binIndex];
    if (!bin.first) bin.first = point;
    bin.last = point;
    if (!bin.min || point.value < bin.min.value) bin.min = point;
    if (!bin.max || point.value > bin.max.value) bin.max = point;
  });

  const result: PlotPoint[] = [];
  bins.forEach((bin) => {
    const candidates = [bin.first, bin.min, bin.max, bin.last].filter((point): point is PlotPoint => Boolean(point));
    candidates
      .sort((a, b) => a.xIndex - b.xIndex || a.value - b.value)
      .forEach((point) => {
        if (!samePlotPoint(result[result.length - 1], point)) result.push(point);
      });
  });
  return result;
}

export function downsampleValueSeriesForPixels(
  values: number[],
  pixelWidth: number,
  options: {
    xOffset?: number;
    maxIndex?: number;
    visibleStartIndex?: number;
    visibleEndIndex?: number;
  } = {},
): PlotPoint[] {
  const xOffset = options.xOffset ?? 0;
  const limit = typeof options.maxIndex === "number" && Number.isFinite(options.maxIndex) ? Math.max(0, Math.min(values.length - 1, options.maxIndex)) : values.length - 1;
  const visibleStart = typeof options.visibleStartIndex === "number" && Number.isFinite(options.visibleStartIndex) ? options.visibleStartIndex : -Infinity;
  const visibleEnd = typeof options.visibleEndIndex === "number" && Number.isFinite(options.visibleEndIndex) ? options.visibleEndIndex : Infinity;
  const rawStartIndex = Math.max(0, Number.isFinite(visibleStart) ? Math.ceil(visibleStart - xOffset) : 0);
  const rawEndIndex = Math.min(limit, Number.isFinite(visibleEnd) ? Math.floor(visibleEnd - xOffset) : limit);
  if (rawEndIndex < rawStartIndex) return [];

  const binCount = Math.max(1, Math.floor(pixelWidth));
  const rawVisibleCount = rawEndIndex - rawStartIndex + 1;
  if (rawVisibleCount <= binCount * 4) {
    const visible: PlotPoint[] = [];
    for (let index = rawStartIndex; index <= rawEndIndex; index += 1) {
      const value = values[index];
      const xIndex = index + xOffset;
      if (xIndex < visibleStart || xIndex > visibleEnd || typeof value !== "number" || !Number.isFinite(value)) continue;
      visible.push({ xIndex, value });
    }
    return visible;
  }

  const domainStart = Number.isFinite(visibleStart) ? visibleStart : rawStartIndex + xOffset;
  const domainEnd = Number.isFinite(visibleEnd) ? visibleEnd : rawEndIndex + xOffset;
  const span = Math.max(1, domainEnd - domainStart);
  const bins: PlotPointBin[] = Array.from({ length: binCount }, () => ({}));
  for (let index = rawStartIndex; index <= rawEndIndex; index += 1) {
    const value = values[index];
    const xIndex = index + xOffset;
    if (xIndex < visibleStart || xIndex > visibleEnd || typeof value !== "number" || !Number.isFinite(value)) continue;
    const point = { xIndex, value };
    const binIndex = Math.max(0, Math.min(binCount - 1, Math.floor(((point.xIndex - domainStart) / span) * binCount)));
    const bin = bins[binIndex];
    if (!bin.first) bin.first = point;
    bin.last = point;
    if (!bin.min || point.value < bin.min.value) bin.min = point;
    if (!bin.max || point.value > bin.max.value) bin.max = point;
  }

  const result: PlotPoint[] = [];
  bins.forEach((bin) => {
    const candidates = [bin.first, bin.min, bin.max, bin.last].filter((point): point is PlotPoint => Boolean(point));
    candidates
      .sort((a, b) => a.xIndex - b.xIndex || a.value - b.value)
      .forEach((point) => {
        if (!samePlotPoint(result[result.length - 1], point)) result.push(point);
      });
  });
  return result;
}

export function indexFromCanvasXDomain(x: number, width: number, domain: PlotXDomain): number {
  if (width <= 0) return Math.round(domain.startIndex);
  const ratio = Math.max(0, Math.min(1, x / width));
  return Math.round(domain.startIndex + ratio * (domain.endIndex - domain.startIndex));
}

export function plotIndexFromClientX({ clientX, geometry }: { clientX: number; geometry: PlotDragGeometry }): number {
  const localX = clientX - geometry.rectLeft - PLOT_LEFT;
  const plotWidth = geometry.rectWidth - PLOT_LEFT - PLOT_RIGHT_PADDING;
  return indexFromCanvasXDomain(localX, plotWidth, geometry.domain);
}

export function plotLocalPointFromClient({
  clientX,
  clientY,
  geometry,
}: {
  clientX: number;
  clientY: number;
  geometry: PlotPointerGeometry;
}): CanvasPoint {
  return {
    x: clientX - geometry.rectLeft,
    y: clientY - geometry.rectTop,
  };
}

export function plotValueFromClientY({
  clientY,
  geometry,
}: {
  clientY: number;
  geometry: PlotThresholdDragGeometry;
}): number {
  return canvasYToValue(clientY - geometry.rectTop, geometry.range, geometry.height);
}

export function shouldTrackPlotHoverIndex(searchWindowHalfspan: number | undefined): boolean {
  return typeof searchWindowHalfspan === "number" && Number.isFinite(searchWindowHalfspan) && searchWindowHalfspan > 0;
}

export type PlotRange = {
  min: number;
  max: number;
};

function manualPlotRange(manualRange?: Partial<PlotRange>): PlotRange | null {
  if (
    manualRange &&
    typeof manualRange.min === "number" &&
    typeof manualRange.max === "number" &&
    Number.isFinite(manualRange.min) &&
    Number.isFinite(manualRange.max) &&
    manualRange.max > manualRange.min
  ) {
    return { min: manualRange.min, max: manualRange.max };
  }
  return null;
}

function autoRangeFromMinMax(min: number, max: number, finiteCount: number): PlotRange {
  const autoMin = finiteCount > 0 ? min : 0;
  const autoMax = finiteCount > 0 ? max : 1;
  const autoRange = autoMax > autoMin ? { min: autoMin, max: autoMax } : { min: autoMin, max: autoMin + 1 };
  return autoRange;
}

function resolvePlotRangeInDomain(values: number[], domain?: PlotXDomain): PlotRange {
  const startIndex = domain ? Math.max(0, Math.ceil(Math.min(domain.startIndex, domain.endIndex))) : 0;
  const endIndex = domain
    ? Math.min(values.length - 1, Math.floor(Math.max(domain.startIndex, domain.endIndex)))
    : values.length - 1;
  if (endIndex < startIndex) return autoRangeFromMinMax(Infinity, -Infinity, 0);

  let min = Infinity;
  let max = -Infinity;
  let finiteCount = 0;
  for (let index = startIndex; index <= endIndex; index += 1) {
    const value = values[index];
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    finiteCount += 1;
    if (value < min) min = value;
    if (value > max) max = value;
  }
  return autoRangeFromMinMax(min, max, finiteCount);
}

export function resolvePlotRange(values: number[], manualRange?: Partial<PlotRange>, domain?: PlotXDomain): PlotRange {
  const manual = manualPlotRange(manualRange);
  if (manual) return manual;
  return resolvePlotRangeInDomain(values, domain);
}

export function resolvePlotRangeForPlot(
  values: number[],
  points?: PlotPoint[],
  manualRange?: Partial<PlotRange>,
  domain?: PlotXDomain,
): PlotRange {
  const manual = manualPlotRange(manualRange);
  if (manual) return manual;
  if (!points) return resolvePlotRange(values, undefined, domain);

  const domainStart = domain ? Math.min(domain.startIndex, domain.endIndex) : -Infinity;
  const domainEnd = domain ? Math.max(domain.startIndex, domain.endIndex) : Infinity;
  let min = Infinity;
  let max = -Infinity;
  let finiteCount = 0;
  for (const point of points) {
    if (point.xIndex < domainStart || point.xIndex > domainEnd) continue;
    const value = point.value;
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    finiteCount += 1;
    if (value < min) min = value;
    if (value > max) max = value;
  }
  return autoRangeFromMinMax(min, max, finiteCount);
}

export function valueToCanvasY(value: number, range: PlotRange, height: number): number {
  const span = Math.max(1, range.max - range.min);
  return PLOT_TOP + (height - PLOT_BOTTOM_PADDING) * (1 - (value - range.min) / span);
}

export function canvasYToValue(y: number, range: PlotRange, height: number): number {
  const span = Math.max(1, range.max - range.min);
  const plotHeight = Math.max(1, height - PLOT_BOTTOM_PADDING);
  const clampedY = Math.max(PLOT_TOP, Math.min(PLOT_TOP + plotHeight, y));
  return range.max - ((clampedY - PLOT_TOP) / plotHeight) * span;
}

export function plotXFromIndex(index: number, width: number, count: number): number {
  if (count <= 1 || width <= 0) return PLOT_LEFT;
  return PLOT_LEFT + ((width - PLOT_LEFT - PLOT_RIGHT_PADDING) * index) / Math.max(1, count - 1);
}

function plotXFromDomainIndex(index: number, width: number, domain: PlotXDomain): number {
  const plotWidth = Math.max(1, width - PLOT_LEFT - PLOT_RIGHT_PADDING);
  const span = Math.max(1, domain.endIndex - domain.startIndex);
  const ratio = Math.max(0, Math.min(1, (index - domain.startIndex) / span));
  return PLOT_LEFT + plotWidth * ratio;
}

export type PlotDomainWindowRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export function resolvePlotDomainWindowRect(
  window: PlotDomainWindow,
  domain: PlotXDomain,
  canvasWidth: number,
  canvasHeight: number,
): PlotDomainWindowRect | undefined {
  if (!Number.isFinite(window.startIndex) || !Number.isFinite(window.endIndex)) return undefined;
  const clippedWindow = intersectPlotDomainWindow(window, domain);
  if (!clippedWindow) return undefined;
  const leftX = plotXFromDomainIndex(clippedWindow.startIndex, canvasWidth, domain);
  const rightX = plotXFromDomainIndex(clippedWindow.endIndex, canvasWidth, domain);
  return {
    left: leftX,
    top: PLOT_TOP,
    width: Math.max(2, rightX - leftX),
    height: canvasHeight - PLOT_BOTTOM_PADDING,
  };
}

export function findHoveredCrossingIndex(
  crossings: LevelCrossing[],
  x: number,
  y: number,
  width: number,
  count: number,
  markerY: number,
  radius: number,
  options: {
    searchCenterIndex?: number;
    searchHalfspan?: number;
  } = {},
): number | undefined {
  let bestIndex: number | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  const hasSearchWindow =
    typeof options.searchCenterIndex === "number" &&
    Number.isFinite(options.searchCenterIndex) &&
    typeof options.searchHalfspan === "number" &&
    Number.isFinite(options.searchHalfspan) &&
    options.searchHalfspan > 0;
  const searchMin = hasSearchWindow ? (options.searchCenterIndex as number) - (options.searchHalfspan as number) : -Infinity;
  const searchMax = hasSearchWindow ? (options.searchCenterIndex as number) + (options.searchHalfspan as number) : Infinity;
  crossings.forEach((crossing, index) => {
    if (crossing.index < searchMin || crossing.index > searchMax) return;
    const markerX = plotXFromIndex(crossing.index, width, count);
    const distance = hasSearchWindow ? Math.abs(x - markerX) : Math.hypot(x - markerX, y - markerY);
    if ((hasSearchWindow || distance <= radius) && distance < bestDistance) {
      bestIndex = index;
      bestDistance = distance;
    }
  });
  return bestIndex;
}

export function thresholdHandleX(width: number): number {
  return Math.max(PLOT_LEFT, width - PLOT_RIGHT_PADDING);
}

export function isThresholdHandleHit(x: number, y: number, width: number, thresholdY: number, radius: number): boolean {
  return Math.hypot(x - thresholdHandleX(width), y - thresholdY) <= radius;
}

export function shouldCompletePlotSelection(
  start: CanvasPoint | undefined,
  end: CanvasPoint | undefined,
  minPixels = PLOT_SELECTION_MIN_PIXELS,
): boolean {
  if (!start || !end) return false;
  return Math.hypot(end.x - start.x, end.y - start.y) > Math.max(0, minPixels);
}

export type PlotTextLabelInput = {
  x: number;
  text: string;
  color?: string;
};

export type PlotTextLabelPlacement = PlotTextLabelInput & {
  x: number;
  y: number;
  row: number;
  width: number;
};

export function layoutPlotTextLabels(
  labels: PlotTextLabelInput[],
  plotLeft: number,
  plotRight: number,
  topY: number,
  measureText: (text: string) => number,
  options: { rowHeight?: number; maxRows?: number; gap?: number; xOffset?: number } = {},
): PlotTextLabelPlacement[] {
  const rowHeight = options.rowHeight ?? 13;
  const maxRows = Math.max(1, options.maxRows ?? 4);
  const gap = options.gap ?? 6;
  const xOffset = options.xOffset ?? 6;
  const rows: Array<Array<{ left: number; right: number }>> = Array.from({ length: maxRows }, () => []);
  return labels.map((label) => {
    const width = Math.max(1, measureText(label.text));
    const maxLeft = Math.max(plotLeft, plotRight - width);
    const left = Math.max(plotLeft, Math.min(maxLeft, label.x + xOffset));
    const right = left + width;
    const row = rows.findIndex((placed) => !placed.some((slot) => left < slot.right + gap && right > slot.left - gap));
    const selectedRow = row >= 0 ? row : maxRows - 1;
    rows[selectedRow].push({ left, right });
    return {
      ...label,
      x: left,
      y: topY + selectedRow * rowHeight,
      row: selectedRow,
      width,
    };
  });
}

function drawHaloText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string) {
  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineWidth = 4;
  ctx.strokeStyle = "rgba(255, 255, 255, 0.92)";
  ctx.strokeText(text, x, y);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
  ctx.restore();
}

function drawPlotDomainWindowOverlay(
  ctx: CanvasRenderingContext2D,
  window: PlotDomainWindow,
  domain: PlotXDomain,
  canvasWidth: number,
  canvasHeight: number,
) {
  const rect = resolvePlotDomainWindowRect(window, domain, canvasWidth, canvasHeight);
  if (!rect) return;
  const leftX = rect.left;
  const rightX = rect.left + rect.width;
  ctx.fillStyle = window.color ?? "rgba(37, 99, 235, 0.14)";
  ctx.fillRect(rect.left, rect.top, rect.width, rect.height);
  ctx.strokeStyle = window.borderColor ?? "rgba(37, 99, 235, 0.55)";
  ctx.lineWidth = 1;
  ctx.setLineDash([5, 4]);
  ctx.beginPath();
  ctx.moveTo(leftX, rect.top);
  ctx.lineTo(leftX, rect.top + rect.height);
  ctx.moveTo(rightX, rect.top);
  ctx.lineTo(rightX, rect.top + rect.height);
  ctx.stroke();
  ctx.setLineDash([]);
}

export function drawPlotInteractiveOverlays(
  canvas: HTMLCanvasElement,
  cached: CachedPlotRender,
  options: {
    hoveredPlotIndex?: number;
    searchWindowHalfspan?: number;
    threshold?: number;
    hoveredCrossing?: number;
    hoveredThresholdHandle?: boolean;
    thresholdEditable?: boolean;
    crossings?: LevelCrossing[];
  } = {},
): boolean {
  const ctx = canvas.getContext("2d");
  if (!ctx) return false;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(cached.baseCanvas, 0, 0);
  ctx.setTransform(cached.scale, 0, 0, cached.scale, 0, 0);

  if (
    shouldTrackPlotHoverIndex(options.searchWindowHalfspan) &&
    options.hoveredPlotIndex !== undefined &&
    cached.valuesLength > 1
  ) {
    const halfspan = options.searchWindowHalfspan as number;
    const leftIndex = Math.max(0, options.hoveredPlotIndex - halfspan);
    const rightIndex = Math.min(cached.valuesLength - 1, options.hoveredPlotIndex + halfspan);
    const leftX = plotXFromIndex(leftIndex, cached.cssWidth, cached.valuesLength);
    const rightX = plotXFromIndex(rightIndex, cached.cssWidth, cached.valuesLength);
    ctx.fillStyle = "rgba(34, 197, 94, 0.13)";
    ctx.fillRect(leftX, PLOT_TOP, Math.max(1, rightX - leftX), cached.cssHeight - PLOT_BOTTOM_PADDING);
    ctx.strokeStyle = "rgba(22, 163, 74, 0.45)";
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(leftX, PLOT_TOP);
    ctx.lineTo(leftX, cached.cssHeight - PLOT_BOTTOM_PADDING);
    ctx.moveTo(rightX, PLOT_TOP);
    ctx.lineTo(rightX, cached.cssHeight - PLOT_BOTTOM_PADDING);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  if (typeof options.threshold !== "number" || !Number.isFinite(options.threshold)) return true;
  const thresholdY = valueToCanvasY(options.threshold, cached.range, cached.cssHeight);
  const crossings = options.crossings ?? EMPTY_PLOT_CROSSINGS;
  if (options.hoveredCrossing !== undefined) {
    const crossing = crossings[options.hoveredCrossing];
    if (crossing) {
      const x = plotXFromIndex(crossing.index, cached.cssWidth, cached.valuesLength);
      const radius = 11;
      const innerGap = 5;
      const tickLength = 18;
      ctx.strokeStyle = "#16a34a";
      ctx.lineWidth = 2.75;
      ctx.beginPath();
      ctx.arc(x, thresholdY, radius, 0, Math.PI * 2);
      ctx.moveTo(x - tickLength, thresholdY);
      ctx.lineTo(x - innerGap, thresholdY);
      ctx.moveTo(x + innerGap, thresholdY);
      ctx.lineTo(x + tickLength, thresholdY);
      ctx.moveTo(x, thresholdY - tickLength);
      ctx.lineTo(x, thresholdY - innerGap);
      ctx.moveTo(x, thresholdY + innerGap);
      ctx.lineTo(x, thresholdY + tickLength);
      ctx.stroke();
    }
  }

  if (options.thresholdEditable && options.hoveredThresholdHandle) {
    const handleX = thresholdHandleX(cached.cssWidth);
    const handleRadius = 11;
    ctx.fillStyle = "#ffffff";
    ctx.strokeStyle = "#16a34a";
    ctx.lineWidth = 2.75;
    ctx.beginPath();
    ctx.arc(handleX, thresholdY, handleRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(handleX, thresholdY - handleRadius - 6);
    ctx.lineTo(handleX, thresholdY - 3);
    ctx.moveTo(handleX, thresholdY + 3);
    ctx.lineTo(handleX, thresholdY + handleRadius + 6);
    ctx.moveTo(handleX - 4, thresholdY - handleRadius - 2);
    ctx.lineTo(handleX, thresholdY - handleRadius - 6);
    ctx.lineTo(handleX + 4, thresholdY - handleRadius - 2);
    ctx.moveTo(handleX - 4, thresholdY + handleRadius + 2);
    ctx.lineTo(handleX, thresholdY + handleRadius + 6);
    ctx.lineTo(handleX + 4, thresholdY + handleRadius + 2);
    ctx.stroke();
  }
  return true;
}

type Props = {
  values: number[];
  points?: PlotPoint[];
  xDomain?: PlotXDomain;
  color?: string;
  label?: string;
  xLabel?: string;
  title?: string;
  ariaLabel?: string;
  height?: number;
  yRange?: Partial<PlotRange>;
  overlays?: PlotOverlay[];
  verticalMarkers?: PlotVerticalMarker[];
  highlightWindows?: PlotHighlightWindow[];
  searchWindowHalfspan?: number;
  onPickIndex?: (index: number) => void;
  onSelectionComplete?: (startIndex: number, endIndex: number) => void;
  onResetZoom?: () => void;
  selectionWindow?: {
    startIndex: number;
    endIndex: number;
    color?: string;
    borderColor?: string;
  };
  selectionMinPixels?: number;
  domainWindows?: PlotDomainWindow[];
  threshold?: number;
  onThresholdChange?: (value: number) => void;
  crossings?: LevelCrossing[];
  onCrossingClick?: (crossing: LevelCrossing, crossingIndex: number) => void;
  yTickFormatter?: (value: number) => string;
  rightTickFormatter?: (value: number) => string;
  rightAxisLabel?: string;
  thresholdFormatter?: (value: number) => string;
  active?: boolean;
};

export default function PlotCanvas({
  values,
  points,
  xDomain,
  color = "#7c3aed",
  label,
  xLabel,
  title,
  ariaLabel,
  height = 360,
  yRange,
  overlays,
  verticalMarkers,
  highlightWindows,
  searchWindowHalfspan,
  onPickIndex,
  onSelectionComplete,
  onResetZoom,
  selectionWindow,
  selectionMinPixels = PLOT_SELECTION_MIN_PIXELS,
  domainWindows,
  threshold,
  onThresholdChange,
  crossings,
  onCrossingClick,
  yTickFormatter,
  rightTickFormatter,
  rightAxisLabel,
  thresholdFormatter,
  active = true,
}: Props) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const baseCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const cachedRenderRef = useRef<CachedPlotRender | null>(null);
  const draggingThreshold = useRef(false);
  const selectingX = useRef(false);
  const selectionStartIndex = useRef<number | undefined>(undefined);
  const selectionStartPoint = useRef<CanvasPoint | undefined>(undefined);
  const selectionGeometry = useRef<PlotDragGeometry | undefined>(undefined);
  const pointerGeometry = useRef<PlotPointerGeometry | undefined>(undefined);
  const thresholdGeometry = useRef<PlotThresholdDragGeometry | undefined>(undefined);
  const pendingSelectionWindow = useRef<{ startIndex: number; endIndex: number } | undefined>(undefined);
  const selectionAnimationFrame = useRef<number | null>(null);
  const [hoveredCrossing, setHoveredCrossing] = useState<number | undefined>(undefined);
  const [hoveredThresholdHandle, setHoveredThresholdHandle] = useState(false);
  const [hoveredPlotIndex, setHoveredPlotIndex] = useState<number | undefined>(undefined);
  const plotDomain = xDomain ?? { startIndex: 0, endIndex: Math.max(0, values.length - 1) };
  const stableOverlays = plotOverlaysOrEmpty(overlays);
  const stableVerticalMarkers = plotVerticalMarkersOrEmpty(verticalMarkers);
  const stableHighlightWindows = plotHighlightWindowsOrEmpty(highlightWindows);
  const stableDomainWindows = plotDomainWindowsOrEmpty(domainWindows);
  const stableCrossings = plotCrossingsOrEmpty(crossings);

  useEffect(
    () => () => {
      if (selectionAnimationFrame.current !== null) {
        window.cancelAnimationFrame(selectionAnimationFrame.current);
        selectionAnimationFrame.current = null;
      }
    },
    [],
  );

  const restoreCachedPlot = () => {
    const canvas = ref.current;
    const cached = cachedRenderRef.current;
    if (!canvas || !cached) return false;
    const ctx = canvas.getContext("2d");
    if (!ctx) return false;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(cached.baseCanvas, 0, 0);
    return true;
  };

  const drawImperativeSelectionWindow = (nextWindow: { startIndex: number; endIndex: number } | undefined) => {
    if (!restoreCachedPlot() || !nextWindow) return;
    const canvas = ref.current;
    const cached = cachedRenderRef.current;
    if (!canvas || !cached) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(cached.scale, 0, 0, cached.scale, 0, 0);
    drawPlotDomainWindowOverlay(ctx, nextWindow, cached.plotDomain, cached.cssWidth, cached.cssHeight);
  };

  const scheduleLocalSelectionWindow = (nextWindow: { startIndex: number; endIndex: number }) => {
    pendingSelectionWindow.current = nextWindow;
    if (selectionAnimationFrame.current !== null) return;
    selectionAnimationFrame.current = window.requestAnimationFrame(() => {
      selectionAnimationFrame.current = null;
      drawImperativeSelectionWindow(pendingSelectionWindow.current);
    });
  };

  const clearLocalSelectionWindow = () => {
    pendingSelectionWindow.current = undefined;
    if (selectionAnimationFrame.current !== null) {
      window.cancelAnimationFrame(selectionAnimationFrame.current);
      selectionAnimationFrame.current = null;
    }
    restoreCachedPlot();
  };

  useEffect(() => {
    if (!active) return;
    const canvas = ref.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    pointerGeometry.current = {
      rectLeft: rect.left,
      rectTop: rect.top,
      rectWidth: rect.width,
    };
    const scale = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(rect.width * scale));
    canvas.height = Math.max(1, Math.floor(height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.clearRect(0, 0, rect.width, height);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, rect.width, height);
    const range = resolvePlotRangeForPlot(values, points, yRange, plotDomain);
    ctx.strokeStyle = "#e2e8f0";
    ctx.lineWidth = 1;
    ctx.font = "12px Segoe UI, sans-serif";
    for (let i = 0; i <= 5; i += 1) {
      const y = PLOT_TOP + ((height - PLOT_BOTTOM_PADDING) * i) / 5;
      const tickValue = range.max - ((range.max - range.min) * i) / 5;
      ctx.beginPath();
      ctx.moveTo(PLOT_LEFT, y);
      ctx.lineTo(rect.width - PLOT_RIGHT_PADDING, y);
      ctx.stroke();
      ctx.fillStyle = "#5b708f";
      ctx.textAlign = "left";
      ctx.fillText(yTickFormatter ? yTickFormatter(tickValue) : String(Math.round(tickValue)), 8, y + 4);
      if (rightTickFormatter) {
        ctx.fillText(rightTickFormatter(tickValue), rect.width - PLOT_RIGHT_PADDING + 10, y + 4);
      }
    }
    const drawSeries = (series: number[], seriesColor: string, lineWidth = 2, alpha = 1, xOffset = 0, maxIndex?: number) => {
      if (series.length === 0) return;
      const plotWidth = Math.max(1, rect.width - PLOT_LEFT - PLOT_RIGHT_PADDING);
      const drawableSeries = downsampleValueSeriesForPixels(series, plotWidth, {
        xOffset,
        maxIndex,
        visibleStartIndex: 0,
        visibleEndIndex: values.length - 1,
      });
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = seriesColor;
      ctx.lineWidth = lineWidth;
      ctx.beginPath();
      let hasPoint = false;
      drawableSeries.forEach((point) => {
        const y = valueToCanvasY(point.value, range, height);
        const x = plotXFromIndex(point.xIndex, rect.width, values.length);
        if (!hasPoint) {
          ctx.moveTo(x, y);
          hasPoint = true;
        }
        else ctx.lineTo(x, y);
      });
      if (hasPoint) ctx.stroke();
      ctx.restore();
    };

    const drawPointSeries = (series: PlotPoint[], seriesColor: string, lineWidth = 2, alpha = 1) => {
      if (series.length === 0) return;
      const plotWidth = Math.max(1, rect.width - PLOT_LEFT - PLOT_RIGHT_PADDING);
      const drawableSeries = downsamplePlotPointsForPixels(series, plotDomain, plotWidth);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = seriesColor;
      ctx.lineWidth = lineWidth;
      ctx.beginPath();
      let hasPoint = false;
      drawableSeries.forEach((point) => {
        const y = valueToCanvasY(point.value, range, height);
        const x = plotXFromDomainIndex(point.xIndex, rect.width, plotDomain);
        if (!hasPoint) {
          ctx.moveTo(x, y);
          hasPoint = true;
        } else {
          ctx.lineTo(x, y);
        }
      });
      if (hasPoint) ctx.stroke();
      ctx.restore();
    };

    const drawDomainWindow = (window: PlotDomainWindow) => drawPlotDomainWindowOverlay(ctx, window, plotDomain, rect.width, height);

    stableHighlightWindows.forEach((highlight) => {
      if (values.length === 0 || !Number.isFinite(highlight.startIndex) || !Number.isFinite(highlight.endIndex)) return;
      const startIndex = Math.max(0, Math.min(values.length - 1, Math.round(Math.min(highlight.startIndex, highlight.endIndex))));
      const endIndex = Math.max(0, Math.min(values.length - 1, Math.round(Math.max(highlight.startIndex, highlight.endIndex))));
      const leftX = plotXFromIndex(startIndex, rect.width, values.length);
      const rightX = plotXFromIndex(endIndex, rect.width, values.length);
      const width = Math.max(2, rightX - leftX);
      ctx.fillStyle = highlight.color ?? "rgba(239, 68, 68, 0.16)";
      ctx.fillRect(leftX, PLOT_TOP, width, height - PLOT_BOTTOM_PADDING);
      ctx.strokeStyle = highlight.borderColor ?? "rgba(220, 38, 38, 0.55)";
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(leftX, PLOT_TOP);
      ctx.lineTo(leftX, height - PLOT_BOTTOM_PADDING);
      ctx.moveTo(rightX, PLOT_TOP);
      ctx.lineTo(rightX, height - PLOT_BOTTOM_PADDING);
      ctx.stroke();
      ctx.setLineDash([]);
    });

    stableOverlays.forEach((overlay) => {
      drawSeries(overlay.values, overlay.color, overlay.lineWidth ?? 2, overlay.alpha ?? 1, overlay.xOffset ?? 0, overlay.maxIndex);
    });

    stableDomainWindows.forEach((window) => drawDomainWindow(window));
    if (selectionWindow) drawDomainWindow(selectionWindow);

    if (points) {
      drawPointSeries(points, color, 2);
    } else if (values.length > 0) {
      drawSeries(values, color, 2);
    }

    const markerLabels: PlotTextLabelInput[] = [];
    stableVerticalMarkers.forEach((marker) => {
      if (!Number.isFinite(marker.index)) return;
      const x = plotXFromIndex(Math.max(0, Math.min(values.length - 1, marker.index)), rect.width, values.length);
      ctx.strokeStyle = marker.color;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.moveTo(x, PLOT_TOP);
      ctx.lineTo(x, height - PLOT_BOTTOM_PADDING);
      ctx.stroke();
      ctx.setLineDash([]);
      if (marker.label) markerLabels.push({ x, text: marker.label, color: marker.color });
    });
    if (markerLabels.length > 0) {
      ctx.font = "700 11px Segoe UI, sans-serif";
      ctx.textAlign = "left";
      const placements = layoutPlotTextLabels(
        markerLabels,
        PLOT_LEFT + 4,
        rect.width - PLOT_RIGHT_PADDING - 4,
        PLOT_TOP + 16,
        (text) => ctx.measureText(text).width,
      );
      placements.forEach((placement) => {
        drawHaloText(ctx, placement.text, placement.x, placement.y, placement.color ?? "#334155");
      });
    }
    if (typeof threshold === "number" && Number.isFinite(threshold)) {
      const thresholdY = valueToCanvasY(threshold, range, height);
      ctx.strokeStyle = "#f43f5e";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([8, 5]);
      ctx.beginPath();
      ctx.moveTo(PLOT_LEFT, thresholdY);
      ctx.lineTo(rect.width - PLOT_RIGHT_PADDING, thresholdY);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "#be123c";
      ctx.font = "700 11px Segoe UI, sans-serif";
      ctx.textAlign = "left";
      const thresholdLabel = `lock level ${thresholdFormatter ? thresholdFormatter(threshold) : Math.round(threshold)}`;
      const thresholdLabelY = Math.max(PLOT_TOP + 16, Math.min(height - PLOT_BOTTOM_PADDING - 8, thresholdY - 8));
      drawHaloText(ctx, thresholdLabel, PLOT_LEFT + 8, thresholdLabelY, "#be123c");

      stableCrossings.forEach((crossing, index) => {
        const x = plotXFromIndex(crossing.index, rect.width, values.length);
        const y = thresholdY;
        const radius = 7;
        const innerGap = 4;
        const tickLength = 12;
        ctx.strokeStyle = "#f43f5e";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.moveTo(x - tickLength, y);
        ctx.lineTo(x - innerGap, y);
        ctx.moveTo(x + innerGap, y);
        ctx.lineTo(x + tickLength, y);
        ctx.moveTo(x, y - tickLength);
        ctx.lineTo(x, y - innerGap);
        ctx.moveTo(x, y + innerGap);
        ctx.lineTo(x, y + tickLength);
        ctx.stroke();
      });

      if (onThresholdChange) {
        const handleX = thresholdHandleX(rect.width);
        const handleRadius = 8;
        ctx.fillStyle = "#ffffff";
        ctx.strokeStyle = "#be123c";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(handleX, thresholdY, handleRadius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(handleX, thresholdY - handleRadius - 6);
        ctx.lineTo(handleX, thresholdY - 3);
        ctx.moveTo(handleX, thresholdY + 3);
        ctx.lineTo(handleX, thresholdY + handleRadius + 6);
        ctx.moveTo(handleX - 4, thresholdY - handleRadius - 2);
        ctx.lineTo(handleX, thresholdY - handleRadius - 6);
        ctx.lineTo(handleX + 4, thresholdY - handleRadius - 2);
        ctx.moveTo(handleX - 4, thresholdY + handleRadius + 2);
        ctx.lineTo(handleX, thresholdY + handleRadius + 6);
        ctx.lineTo(handleX + 4, thresholdY + handleRadius + 2);
        ctx.stroke();
      }
    }
    ctx.fillStyle = "#475569";
    ctx.font = "700 12px Segoe UI, sans-serif";
    ctx.textAlign = "left";
    const legendItems = [
      ...(label ? [{ label, color }] : []),
      ...stableOverlays.filter((overlay) => overlay.label).map((overlay) => ({ label: overlay.label as string, color: overlay.color })),
    ];
    let legendX = PLOT_LEFT;
    const legendY = 18;
    const legendLimit = rect.width - PLOT_RIGHT_PADDING - 12;
    legendItems.forEach((item) => {
      const labelWidth = ctx.measureText(item.label).width;
      if (legendX + labelWidth + 28 > legendLimit) return;
      ctx.strokeStyle = item.color;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(legendX, legendY - 4);
      ctx.lineTo(legendX + 14, legendY - 4);
      ctx.stroke();
      ctx.fillStyle = "#475569";
      ctx.fillText(item.label, legendX + 20, legendY);
      legendX += labelWidth + 44;
    });
    if (rightAxisLabel) {
      ctx.fillStyle = "#64748b";
      ctx.textAlign = "right";
      ctx.fillText(rightAxisLabel, rect.width - 8, 18);
      ctx.textAlign = "left";
    }
    ctx.font = "12px Segoe UI, sans-serif";
    ctx.fillStyle = "#64748b";
    if (xLabel) ctx.fillText(xLabel, PLOT_LEFT, height - 8);

    const baseCanvas = baseCanvasRef.current ?? document.createElement("canvas");
    baseCanvasRef.current = baseCanvas;
    if (copyPlotBaseToCache(canvas, baseCanvas)) {
      cachedRenderRef.current = {
        baseCanvas,
        scale,
        cssWidth: rect.width,
        cssHeight: height,
        plotDomain,
        range,
        valuesLength: values.length,
      };
    }
  }, [
    values,
    points,
    xDomain,
    color,
    label,
    xLabel,
    title,
    ariaLabel,
    height,
    yRange,
    stableOverlays,
    stableVerticalMarkers,
    stableHighlightWindows,
    selectionWindow,
    stableDomainWindows,
    searchWindowHalfspan,
    threshold,
    stableCrossings,
    yTickFormatter,
    rightTickFormatter,
    rightAxisLabel,
    thresholdFormatter,
    active,
  ]);

  useEffect(() => {
    if (!active) return;
    const canvas = ref.current;
    const cached = cachedRenderRef.current;
    if (!canvas || !cached) return;
    drawPlotInteractiveOverlays(canvas, cached, {
      hoveredPlotIndex,
      searchWindowHalfspan,
      threshold,
      hoveredCrossing,
      hoveredThresholdHandle,
      thresholdEditable: Boolean(onThresholdChange),
      crossings: stableCrossings,
    });
  }, [
    active,
    hoveredCrossing,
    hoveredPlotIndex,
    hoveredThresholdHandle,
    onThresholdChange,
    searchWindowHalfspan,
    stableCrossings,
    threshold,
  ]);

  const updateThresholdFromPointer = (
    event: React.PointerEvent<HTMLCanvasElement>,
    geometry = thresholdGeometry.current,
  ) => {
    if (!onThresholdChange) return;
    if (geometry) {
      onThresholdChange(plotValueFromClientY({ clientY: event.clientY, geometry }));
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const range = resolvePlotRangeForPlot(values, points, yRange, plotDomain);
    onThresholdChange(canvasYToValue(event.clientY - rect.top, range, height));
  };

  const plotDragGeometryFromCanvas = (canvas: HTMLCanvasElement): PlotDragGeometry => {
    const rect = canvas.getBoundingClientRect();
    return {
      rectLeft: rect.left,
      rectWidth: rect.width,
      domain: plotDomain,
    };
  };

  const plotPointerGeometryFromCanvas = (canvas: HTMLCanvasElement): PlotPointerGeometry => {
    const rect = canvas.getBoundingClientRect();
    return {
      rectLeft: rect.left,
      rectTop: rect.top,
      rectWidth: rect.width,
    };
  };

  const indexFromPointer = (event: React.PointerEvent<HTMLCanvasElement>, geometry = selectionGeometry.current) => {
    if (geometry) {
      return plotIndexFromClientX({ clientX: event.clientX, geometry });
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const localX = event.clientX - rect.left - PLOT_LEFT;
    const plotWidth = rect.width - PLOT_LEFT - PLOT_RIGHT_PADDING;
    return indexFromCanvasXDomain(localX, plotWidth, plotDomain);
  };

  return (
    <canvas
      ref={ref}
      className="plot"
      title={title}
      aria-label={ariaLabel}
      style={{
        height,
        cursor:
          draggingThreshold.current || hoveredThresholdHandle
            ? "ns-resize"
            : onSelectionComplete
              ? "crosshair"
              : hoveredCrossing !== undefined
                ? "pointer"
                : undefined,
      }}
      onPointerEnter={(event) => {
        pointerGeometry.current = plotPointerGeometryFromCanvas(event.currentTarget);
      }}
      onPointerDown={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        pointerGeometry.current = {
          rectLeft: rect.left,
          rectTop: rect.top,
          rectWidth: rect.width,
        };
        if (onThresholdChange && typeof threshold === "number" && Number.isFinite(threshold)) {
          const range = resolvePlotRangeForPlot(values, points, yRange, plotDomain);
          const thresholdY = valueToCanvasY(threshold, range, height);
          if (isThresholdHandleHit(event.clientX - rect.left, event.clientY - rect.top, rect.width, thresholdY, 16)) {
            const nextThresholdGeometry = {
              rectTop: rect.top,
              height,
              range,
            };
            thresholdGeometry.current = nextThresholdGeometry;
            draggingThreshold.current = true;
            event.currentTarget.setPointerCapture(event.pointerId);
            updateThresholdFromPointer(event, nextThresholdGeometry);
            return;
          }
        }

        if (event.button !== 0 || !onSelectionComplete) return;
        const nextGeometry = plotDragGeometryFromCanvas(event.currentTarget);
        selectionGeometry.current = nextGeometry;
        const nextIndex = indexFromPointer(event, nextGeometry);
        selectingX.current = true;
        selectionStartIndex.current = nextIndex;
        selectionStartPoint.current = { x: event.clientX, y: event.clientY };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (draggingThreshold.current) {
          updateThresholdFromPointer(event);
          return;
        }
        if (selectingX.current && selectionStartIndex.current !== undefined) {
          if (!shouldCompletePlotSelection(selectionStartPoint.current, { x: event.clientX, y: event.clientY }, selectionMinPixels)) {
            clearLocalSelectionWindow();
            return;
          }
          scheduleLocalSelectionWindow({
            startIndex: selectionStartIndex.current,
            endIndex: indexFromPointer(event),
          });
          return;
        }
        const geometry = pointerGeometry.current ?? plotPointerGeometryFromCanvas(event.currentTarget);
        pointerGeometry.current = geometry;
        const localPoint = plotLocalPointFromClient({ clientX: event.clientX, clientY: event.clientY, geometry });
        const localX = localPoint.x - PLOT_LEFT;
        const plotWidth = geometry.rectWidth - PLOT_LEFT - PLOT_RIGHT_PADDING;
        const nextPlotIndex = indexFromCanvasX(localX, plotWidth, values.length);
        if (shouldTrackPlotHoverIndex(searchWindowHalfspan)) {
          if (nextPlotIndex !== hoveredPlotIndex) setHoveredPlotIndex(nextPlotIndex);
        } else if (hoveredPlotIndex !== undefined) {
          setHoveredPlotIndex(undefined);
        }
        if (typeof threshold !== "number" || !Number.isFinite(threshold)) {
          if (hoveredCrossing !== undefined) setHoveredCrossing(undefined);
          if (hoveredThresholdHandle) setHoveredThresholdHandle(false);
          return;
        }
        const range = cachedRenderRef.current?.range ?? resolvePlotRangeForPlot(values, points, yRange, plotDomain);
        const thresholdY = valueToCanvasY(threshold, range, height);
        const nextHandleHovered = isThresholdHandleHit(localPoint.x, localPoint.y, geometry.rectWidth, thresholdY, 16);
        if (nextHandleHovered !== hoveredThresholdHandle) setHoveredThresholdHandle(nextHandleHovered);
        if (stableCrossings.length === 0) {
          if (hoveredCrossing !== undefined) setHoveredCrossing(undefined);
          return;
        }
        const nextHovered = findHoveredCrossingIndex(
          stableCrossings,
          localPoint.x,
          localPoint.y,
          geometry.rectWidth,
          values.length,
          thresholdY,
          16,
          {
            searchCenterIndex: nextPlotIndex,
            searchHalfspan: searchWindowHalfspan,
          },
        );
        if (nextHovered !== hoveredCrossing) setHoveredCrossing(nextHovered);
      }}
      onPointerUp={(event) => {
        if (
          selectingX.current &&
          selectionStartIndex.current !== undefined &&
          shouldCompletePlotSelection(selectionStartPoint.current, { x: event.clientX, y: event.clientY }, selectionMinPixels)
        ) {
          onSelectionComplete?.(selectionStartIndex.current, indexFromPointer(event));
        }
        selectingX.current = false;
        selectionStartIndex.current = undefined;
        selectionStartPoint.current = undefined;
        selectionGeometry.current = undefined;
        pointerGeometry.current = undefined;
        thresholdGeometry.current = undefined;
        clearLocalSelectionWindow();
        draggingThreshold.current = false;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
      }}
      onPointerCancel={() => {
        selectingX.current = false;
        selectionStartIndex.current = undefined;
        selectionStartPoint.current = undefined;
        selectionGeometry.current = undefined;
        pointerGeometry.current = undefined;
        thresholdGeometry.current = undefined;
        clearLocalSelectionWindow();
        draggingThreshold.current = false;
        setHoveredCrossing(undefined);
        setHoveredThresholdHandle(false);
        setHoveredPlotIndex(undefined);
      }}
      onPointerLeave={() => {
        selectingX.current = false;
        selectionStartIndex.current = undefined;
        selectionStartPoint.current = undefined;
        selectionGeometry.current = undefined;
        pointerGeometry.current = undefined;
        thresholdGeometry.current = undefined;
        clearLocalSelectionWindow();
        draggingThreshold.current = false;
        setHoveredCrossing(undefined);
        setHoveredThresholdHandle(false);
        setHoveredPlotIndex(undefined);
      }}
      onClick={(event) => {
        if (onCrossingClick && hoveredCrossing !== undefined && !hoveredThresholdHandle) {
          onCrossingClick(stableCrossings[hoveredCrossing], hoveredCrossing);
          return;
        }
        if (onThresholdChange) return;
        const rect = event.currentTarget.getBoundingClientRect();
        const localX = event.clientX - rect.left - PLOT_LEFT;
        const plotWidth = rect.width - PLOT_LEFT - PLOT_RIGHT_PADDING;
        onPickIndex?.(
          xDomain
            ? indexFromCanvasXDomain(localX, plotWidth, xDomain)
            : indexFromCanvasX(localX, plotWidth, values.length),
        );
      }}
      onContextMenu={(event) => {
        if (!onResetZoom) return;
        event.preventDefault();
        onResetZoom();
      }}
    />
  );
}
