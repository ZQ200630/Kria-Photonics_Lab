import { useEffect, useRef, useState } from "react";
import type { LevelCrossing } from "../utils/lockSpectrum";

const PLOT_LEFT = 48;
const PLOT_RIGHT_PADDING = 16;
const PLOT_TOP = 24;
const PLOT_BOTTOM_PADDING = 54;

export function indexFromCanvasX(x: number, width: number, count: number): number {
  if (count <= 1 || width <= 0) return 0;
  const ratio = Math.max(0, Math.min(1, x / width));
  return Math.max(0, Math.min(count - 1, Math.round(ratio * (count - 1))));
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

export function findHoveredCrossingIndex(
  crossings: LevelCrossing[],
  x: number,
  y: number,
  width: number,
  count: number,
  markerY: number,
  radius: number,
): number | undefined {
  let bestIndex: number | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  crossings.forEach((crossing, index) => {
    const markerX = plotXFromIndex(crossing.index, width, count);
    const distance = Math.hypot(x - markerX, y - markerY);
    if (distance <= radius && distance < bestDistance) {
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
  color?: string;
  label?: string;
  xLabel?: string;
  height?: number;
  yRange?: Partial<PlotRange>;
  onPickIndex?: (index: number) => void;
  threshold?: number;
  onThresholdChange?: (value: number) => void;
  crossings?: LevelCrossing[];
  onCrossingClick?: (crossing: LevelCrossing, crossingIndex: number) => void;
};

export default function PlotCanvas({
  values,
  color = "#7c3aed",
  label,
  xLabel,
  height = 360,
  yRange,
  onPickIndex,
  threshold,
  onThresholdChange,
  crossings = [],
  onCrossingClick,
}: Props) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const draggingThreshold = useRef(false);
  const [hoveredCrossing, setHoveredCrossing] = useState<number | undefined>(undefined);
  const [hoveredThresholdHandle, setHoveredThresholdHandle] = useState(false);

  useEffect(() => {
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
    ctx.strokeStyle = "#e2e8f0";
    ctx.lineWidth = 1;
    for (let i = 0; i <= 5; i += 1) {
      const y = PLOT_TOP + ((height - PLOT_BOTTOM_PADDING) * i) / 5;
      ctx.beginPath();
      ctx.moveTo(PLOT_LEFT, y);
      ctx.lineTo(rect.width - PLOT_RIGHT_PADDING, y);
      ctx.stroke();
    }
    const range = resolvePlotRange(values, yRange);
    if (values.length > 0) {
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      values.forEach((value, index) => {
        const x = plotXFromIndex(index, rect.width, values.length);
        const y = valueToCanvasY(value, range, height);
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
      ctx.fillStyle = "#64748b";
      ctx.font = "12px Segoe UI, sans-serif";
      ctx.fillText(String(Math.round(range.max)), 8, 28);
      ctx.fillText(String(Math.round(range.min)), 8, height - 28);
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
      ctx.fillText(`lock level ${Math.round(threshold)}`, PLOT_LEFT + 8, Math.max(18, thresholdY - 8));

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
    ctx.fillStyle = "#64748b";
    ctx.font = "12px Segoe UI, sans-serif";
    if (label) ctx.fillText(label, rect.width - 170, 18);
    if (xLabel) ctx.fillText(xLabel, PLOT_LEFT, height - 8);
  }, [values, color, label, xLabel, height, yRange, threshold, crossings, hoveredCrossing, hoveredThresholdHandle]);

  const updateThresholdFromPointer = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!onThresholdChange) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const range = resolvePlotRange(values, yRange);
    onThresholdChange(canvasYToValue(event.clientY - rect.top, range, height));
  };

  return (
    <canvas
      ref={ref}
      className="plot"
      style={{ height, cursor: draggingThreshold.current || hoveredThresholdHandle ? "ns-resize" : hoveredCrossing !== undefined ? "pointer" : undefined }}
      onPointerDown={(event) => {
        if (!onThresholdChange) return;
        if (typeof threshold !== "number" || !Number.isFinite(threshold)) return;
        const rect = event.currentTarget.getBoundingClientRect();
        const range = resolvePlotRange(values, yRange);
        const thresholdY = valueToCanvasY(threshold, range, height);
        if (!isThresholdHandleHit(event.clientX - rect.left, event.clientY - rect.top, rect.width, thresholdY, 16)) return;
        draggingThreshold.current = true;
        event.currentTarget.setPointerCapture(event.pointerId);
        updateThresholdFromPointer(event);
      }}
      onPointerMove={(event) => {
        if (draggingThreshold.current) {
          updateThresholdFromPointer(event);
          return;
        }
        if (typeof threshold !== "number" || !Number.isFinite(threshold)) {
          if (hoveredCrossing !== undefined) setHoveredCrossing(undefined);
          if (hoveredThresholdHandle) setHoveredThresholdHandle(false);
          return;
        }
        const rect = event.currentTarget.getBoundingClientRect();
        const range = resolvePlotRange(values, yRange);
        const thresholdY = valueToCanvasY(threshold, range, height);
        const nextHandleHovered = isThresholdHandleHit(event.clientX - rect.left, event.clientY - rect.top, rect.width, thresholdY, 16);
        if (nextHandleHovered !== hoveredThresholdHandle) setHoveredThresholdHandle(nextHandleHovered);
        if (crossings.length === 0) {
          if (hoveredCrossing !== undefined) setHoveredCrossing(undefined);
          return;
        }
        const nextHovered = findHoveredCrossingIndex(crossings, event.clientX - rect.left, event.clientY - rect.top, rect.width, values.length, thresholdY, 16);
        if (nextHovered !== hoveredCrossing) setHoveredCrossing(nextHovered);
      }}
      onPointerUp={(event) => {
        draggingThreshold.current = false;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
      }}
      onPointerCancel={() => {
        draggingThreshold.current = false;
        setHoveredCrossing(undefined);
        setHoveredThresholdHandle(false);
      }}
      onPointerLeave={() => {
        draggingThreshold.current = false;
        setHoveredCrossing(undefined);
        setHoveredThresholdHandle(false);
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
        onPickIndex?.(indexFromCanvasX(localX, plotWidth, values.length));
      }}
    />
  );
}
