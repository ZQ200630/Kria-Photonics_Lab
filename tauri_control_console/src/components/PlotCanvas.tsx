import { useEffect, useRef, useState } from "react";
import type { LevelCrossing } from "../utils/lockSpectrum";

const PLOT_LEFT = 72;
const PLOT_RIGHT_PADDING = 86;
const PLOT_TOP = 24;
const PLOT_BOTTOM_PADDING = 54;

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

export function indexFromCanvasXDomain(x: number, width: number, domain: PlotXDomain): number {
  if (width <= 0) return Math.round(domain.startIndex);
  const ratio = Math.max(0, Math.min(1, x / width));
  return Math.round(domain.startIndex + ratio * (domain.endIndex - domain.startIndex));
}

export type PlotRange = {
  min: number;
  max: number;
};

export function resolvePlotRange(values: number[], manualRange?: Partial<PlotRange>): PlotRange {
  const autoMin = values.length > 0 ? Math.min(...values) : 0;
  const autoMax = values.length > 0 ? Math.max(...values) : 1;
  const autoRange = autoMax > autoMin ? { min: autoMin, max: autoMax } : { min: autoMin, max: autoMin + 1 };
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
  return autoRange;
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
  overlays?: Array<{
    values: number[];
    color: string;
    label?: string;
    lineWidth?: number;
    alpha?: number;
    xOffset?: number;
    maxIndex?: number;
  }>;
  verticalMarkers?: Array<{
    index: number;
    color: string;
    label?: string;
  }>;
  highlightWindows?: Array<{
    startIndex: number;
    endIndex: number;
    color?: string;
    borderColor?: string;
  }>;
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
  overlays = [],
  verticalMarkers = [],
  highlightWindows = [],
  searchWindowHalfspan,
  onPickIndex,
  onSelectionComplete,
  onResetZoom,
  selectionWindow,
  threshold,
  onThresholdChange,
  crossings = [],
  onCrossingClick,
  yTickFormatter,
  rightTickFormatter,
  rightAxisLabel,
  thresholdFormatter,
  active = true,
}: Props) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const draggingThreshold = useRef(false);
  const selectingX = useRef(false);
  const selectionStartIndex = useRef<number | undefined>(undefined);
  const [hoveredCrossing, setHoveredCrossing] = useState<number | undefined>(undefined);
  const [hoveredThresholdHandle, setHoveredThresholdHandle] = useState(false);
  const [hoveredPlotIndex, setHoveredPlotIndex] = useState<number | undefined>(undefined);
  const [localSelectionWindow, setLocalSelectionWindow] = useState<{ startIndex: number; endIndex: number } | undefined>(undefined);
  const primaryValues = points ? points.map((point) => point.value) : values;
  const plotDomain = xDomain ?? { startIndex: 0, endIndex: Math.max(0, values.length - 1) };

  useEffect(() => {
    if (!active) return;
    const canvas = ref.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const scale = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(rect.width * scale));
    canvas.height = Math.max(1, Math.floor(height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.clearRect(0, 0, rect.width, height);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, rect.width, height);
    const range = resolvePlotRange(primaryValues, yRange);
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
      ctx.fillStyle = "#64748b";
      ctx.textAlign = "left";
      ctx.fillText(yTickFormatter ? yTickFormatter(tickValue) : String(Math.round(tickValue)), 8, y + 4);
      if (rightTickFormatter) {
        ctx.fillText(rightTickFormatter(tickValue), rect.width - PLOT_RIGHT_PADDING + 10, y + 4);
      }
    }
    const drawSeries = (series: number[], seriesColor: string, lineWidth = 2, alpha = 1, xOffset = 0, maxIndex?: number) => {
      if (series.length === 0) return;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = seriesColor;
      ctx.lineWidth = lineWidth;
      ctx.beginPath();
      let hasPoint = false;
      const limit = typeof maxIndex === "number" && Number.isFinite(maxIndex) ? Math.max(0, Math.min(series.length - 1, maxIndex)) : series.length - 1;
      series.forEach((value, index) => {
        if (index > limit) return;
        const mappedIndex = index + xOffset;
        if (mappedIndex < 0 || mappedIndex > values.length - 1) return;
        const y = valueToCanvasY(value, range, height);
        const x = plotXFromIndex(mappedIndex, rect.width, values.length);
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
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = seriesColor;
      ctx.lineWidth = lineWidth;
      ctx.beginPath();
      let hasPoint = false;
      series.forEach((point) => {
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

    const drawDomainWindow = (window: { startIndex: number; endIndex: number; color?: string; borderColor?: string }) => {
      if (!Number.isFinite(window.startIndex) || !Number.isFinite(window.endIndex)) return;
      const leftIndex = Math.min(window.startIndex, window.endIndex);
      const rightIndex = Math.max(window.startIndex, window.endIndex);
      const leftX = plotXFromDomainIndex(leftIndex, rect.width, plotDomain);
      const rightX = plotXFromDomainIndex(rightIndex, rect.width, plotDomain);
      const windowWidth = Math.max(2, rightX - leftX);
      ctx.fillStyle = window.color ?? "rgba(37, 99, 235, 0.14)";
      ctx.fillRect(leftX, PLOT_TOP, windowWidth, height - PLOT_BOTTOM_PADDING);
      ctx.strokeStyle = window.borderColor ?? "rgba(37, 99, 235, 0.55)";
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(leftX, PLOT_TOP);
      ctx.lineTo(leftX, height - PLOT_BOTTOM_PADDING);
      ctx.moveTo(rightX, PLOT_TOP);
      ctx.lineTo(rightX, height - PLOT_BOTTOM_PADDING);
      ctx.stroke();
      ctx.setLineDash([]);
    };

    highlightWindows.forEach((highlight) => {
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

    if (
      typeof searchWindowHalfspan === "number" &&
      Number.isFinite(searchWindowHalfspan) &&
      searchWindowHalfspan > 0 &&
      hoveredPlotIndex !== undefined &&
      values.length > 1
    ) {
      const leftIndex = Math.max(0, hoveredPlotIndex - searchWindowHalfspan);
      const rightIndex = Math.min(values.length - 1, hoveredPlotIndex + searchWindowHalfspan);
      const leftX = plotXFromIndex(leftIndex, rect.width, values.length);
      const rightX = plotXFromIndex(rightIndex, rect.width, values.length);
      ctx.fillStyle = "rgba(34, 197, 94, 0.13)";
      ctx.fillRect(leftX, PLOT_TOP, Math.max(1, rightX - leftX), height - PLOT_BOTTOM_PADDING);
      ctx.strokeStyle = "rgba(22, 163, 74, 0.45)";
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(leftX, PLOT_TOP);
      ctx.lineTo(leftX, height - PLOT_BOTTOM_PADDING);
      ctx.moveTo(rightX, PLOT_TOP);
      ctx.lineTo(rightX, height - PLOT_BOTTOM_PADDING);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    overlays.forEach((overlay) => {
      drawSeries(overlay.values, overlay.color, overlay.lineWidth ?? 2, overlay.alpha ?? 1, overlay.xOffset ?? 0, overlay.maxIndex);
    });

    const activeSelectionWindow = localSelectionWindow ?? selectionWindow;
    if (activeSelectionWindow) drawDomainWindow(activeSelectionWindow);

    if (points) {
      drawPointSeries(points, color, 2);
    } else if (values.length > 0) {
      drawSeries(values, color, 2);
    }

    verticalMarkers.forEach((marker) => {
      if (!Number.isFinite(marker.index)) return;
      const x = plotXFromIndex(Math.max(0, Math.min(values.length - 1, marker.index)), rect.width, values.length);
      ctx.strokeStyle = marker.color;
      ctx.fillStyle = marker.color;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.moveTo(x, PLOT_TOP);
      ctx.lineTo(x, height - PLOT_BOTTOM_PADDING);
      ctx.stroke();
      ctx.setLineDash([]);
      if (marker.label) ctx.fillText(marker.label, Math.min(rect.width - 180, x + 6), PLOT_TOP + 16);
    });
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
      ctx.fillText(`lock level ${thresholdFormatter ? thresholdFormatter(threshold) : Math.round(threshold)}`, PLOT_LEFT + 8, Math.max(18, thresholdY - 8));

      crossings.forEach((crossing, index) => {
        const x = plotXFromIndex(crossing.index, rect.width, values.length);
        const y = thresholdY;
        const hovered = hoveredCrossing === index;
        const radius = hovered ? 11 : 7;
        const innerGap = hovered ? 5 : 4;
        const tickLength = hovered ? 18 : 12;
        ctx.strokeStyle = hovered ? "#16a34a" : "#f43f5e";
        ctx.lineWidth = hovered ? 2.75 : 1.5;
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
        const handleHovered = hoveredThresholdHandle || draggingThreshold.current;
        const handleRadius = handleHovered ? 11 : 8;
        ctx.fillStyle = "#ffffff";
        ctx.strokeStyle = handleHovered ? "#16a34a" : "#be123c";
        ctx.lineWidth = handleHovered ? 2.75 : 2;
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
    ctx.fillStyle = "#64748b";
    ctx.font = "12px Segoe UI, sans-serif";
    ctx.textAlign = "left";
    if (label) ctx.fillText(label, rect.width - 170, 18);
    if (rightAxisLabel) ctx.fillText(rightAxisLabel, rect.width - PLOT_RIGHT_PADDING + 10, 18);
    overlays.forEach((overlay, index) => {
      if (!overlay.label) return;
      ctx.fillStyle = overlay.color;
      ctx.fillText(overlay.label, rect.width - 170, 34 + index * 14);
    });
    if (xLabel) ctx.fillText(xLabel, PLOT_LEFT, height - 8);
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
    overlays,
    verticalMarkers,
    highlightWindows,
    selectionWindow,
    localSelectionWindow,
    searchWindowHalfspan,
    threshold,
    crossings,
    hoveredCrossing,
    hoveredThresholdHandle,
    hoveredPlotIndex,
    yTickFormatter,
    rightTickFormatter,
    rightAxisLabel,
    thresholdFormatter,
    active,
  ]);

  const updateThresholdFromPointer = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!onThresholdChange) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const range = resolvePlotRange(primaryValues, yRange);
    onThresholdChange(canvasYToValue(event.clientY - rect.top, range, height));
  };

  const indexFromPointer = (event: React.PointerEvent<HTMLCanvasElement>) => {
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
      onPointerDown={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        if (onThresholdChange && typeof threshold === "number" && Number.isFinite(threshold)) {
          const range = resolvePlotRange(primaryValues, yRange);
          const thresholdY = valueToCanvasY(threshold, range, height);
          if (isThresholdHandleHit(event.clientX - rect.left, event.clientY - rect.top, rect.width, thresholdY, 16)) {
            draggingThreshold.current = true;
            event.currentTarget.setPointerCapture(event.pointerId);
            updateThresholdFromPointer(event);
            return;
          }
        }

        if (event.button !== 0 || !onSelectionComplete) return;
        const nextIndex = indexFromPointer(event);
        selectingX.current = true;
        selectionStartIndex.current = nextIndex;
        setLocalSelectionWindow({ startIndex: nextIndex, endIndex: nextIndex });
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (draggingThreshold.current) {
          updateThresholdFromPointer(event);
          return;
        }
        if (selectingX.current && selectionStartIndex.current !== undefined) {
          setLocalSelectionWindow({
            startIndex: selectionStartIndex.current,
            endIndex: indexFromPointer(event),
          });
          return;
        }
        const rect = event.currentTarget.getBoundingClientRect();
        const localX = event.clientX - rect.left - PLOT_LEFT;
        const plotWidth = rect.width - PLOT_LEFT - PLOT_RIGHT_PADDING;
        const nextPlotIndex = indexFromCanvasX(localX, plotWidth, values.length);
        if (nextPlotIndex !== hoveredPlotIndex) setHoveredPlotIndex(nextPlotIndex);
        if (typeof threshold !== "number" || !Number.isFinite(threshold)) {
          if (hoveredCrossing !== undefined) setHoveredCrossing(undefined);
          if (hoveredThresholdHandle) setHoveredThresholdHandle(false);
          return;
        }
        const range = resolvePlotRange(primaryValues, yRange);
        const thresholdY = valueToCanvasY(threshold, range, height);
        const nextHandleHovered = isThresholdHandleHit(event.clientX - rect.left, event.clientY - rect.top, rect.width, thresholdY, 16);
        if (nextHandleHovered !== hoveredThresholdHandle) setHoveredThresholdHandle(nextHandleHovered);
        if (crossings.length === 0) {
          if (hoveredCrossing !== undefined) setHoveredCrossing(undefined);
          return;
        }
        const nextHovered = findHoveredCrossingIndex(
          crossings,
          event.clientX - rect.left,
          event.clientY - rect.top,
          rect.width,
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
        if (selectingX.current && selectionStartIndex.current !== undefined) {
          onSelectionComplete?.(selectionStartIndex.current, indexFromPointer(event));
        }
        selectingX.current = false;
        selectionStartIndex.current = undefined;
        setLocalSelectionWindow(undefined);
        draggingThreshold.current = false;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
      }}
      onPointerCancel={() => {
        selectingX.current = false;
        selectionStartIndex.current = undefined;
        setLocalSelectionWindow(undefined);
        draggingThreshold.current = false;
        setHoveredCrossing(undefined);
        setHoveredThresholdHandle(false);
        setHoveredPlotIndex(undefined);
      }}
      onPointerLeave={() => {
        selectingX.current = false;
        selectionStartIndex.current = undefined;
        setLocalSelectionWindow(undefined);
        draggingThreshold.current = false;
        setHoveredCrossing(undefined);
        setHoveredThresholdHandle(false);
        setHoveredPlotIndex(undefined);
      }}
      onClick={(event) => {
        if (onCrossingClick && hoveredCrossing !== undefined && !hoveredThresholdHandle) {
          onCrossingClick(crossings[hoveredCrossing], hoveredCrossing);
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
