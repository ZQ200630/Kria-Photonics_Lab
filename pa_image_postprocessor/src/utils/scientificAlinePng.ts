import type { PlotXDomain } from "../components/PlotCanvas";

export const SCIENTIFIC_ALINE_PNG_WIDTH = 2400;
export const SCIENTIFIC_ALINE_PNG_HEIGHT = 1500;

export type ScientificAlineSeriesInput = {
  label: string;
  color: string;
  values: number[];
  xOffset?: number;
};

export type ScientificAlinePlotInput = {
  timeNs: number[];
  series: ScientificAlineSeriesInput[];
  visibleDomain?: PlotXDomain;
  frameIndex: number;
};

export type ScientificAlinePlotSpec = {
  width: number;
  height: number;
  xLabel: "Time (µs)";
  yLabel: "Current (µA)";
  xRangeUs: { min: number; max: number };
  yRangeUa: { min: number; max: number };
  frameIndex: number;
  series: Array<{
    label: string;
    color: string;
    points: Array<{ xUs: number; yUa: number }>;
  }>;
};

function clampedDomain(count: number, domain?: PlotXDomain): PlotXDomain {
  const last = Math.max(0, count - 1);
  if (!domain) return { startIndex: 0, endIndex: last };
  const start = Math.max(0, Math.min(last, Math.round(Math.min(domain.startIndex, domain.endIndex))));
  const end = Math.max(0, Math.min(last, Math.round(Math.max(domain.startIndex, domain.endIndex))));
  return { startIndex: start, endIndex: end };
}

export function buildScientificAlinePlotSpec({
  timeNs,
  series,
  visibleDomain,
  frameIndex,
}: ScientificAlinePlotInput): ScientificAlinePlotSpec {
  if (timeNs.length === 0) throw new Error("A-line time axis is empty");
  const domain = clampedDomain(timeNs.length, visibleDomain);
  const plottedSeries = series.map((source) => {
    const offset = Math.max(0, Math.floor(source.xOffset ?? 0));
    const start = Math.max(domain.startIndex, offset);
    const end = Math.min(domain.endIndex, offset + source.values.length - 1);
    const points: Array<{ xUs: number; yUa: number }> = [];
    for (let index = start; index <= end; index += 1) {
      const xUs = timeNs[index] / 1000;
      const yUa = source.values[index - offset];
      if (Number.isFinite(xUs) && Number.isFinite(yUa)) points.push({ xUs, yUa });
    }
    return { label: source.label, color: source.color, points };
  }).filter((source) => source.points.length > 0);
  if (plottedSeries.length === 0) throw new Error("No visible A-line series to export");

  const xStartUs = timeNs[domain.startIndex] / 1000;
  const xEndUs = timeNs[domain.endIndex] / 1000;
  const xMin = Math.min(xStartUs, xEndUs);
  const xMax = Math.max(xStartUs, xEndUs);
  let yMin = 0;
  let yMax = 0;
  plottedSeries.forEach((source) => source.points.forEach((point) => {
    yMin = Math.min(yMin, point.yUa);
    yMax = Math.max(yMax, point.yUa);
  }));
  const ySpan = yMax - yMin || Math.max(1, Math.abs(yMin), Math.abs(yMax));
  const yPadding = ySpan * 0.06;

  return {
    width: SCIENTIFIC_ALINE_PNG_WIDTH,
    height: SCIENTIFIC_ALINE_PNG_HEIGHT,
    xLabel: "Time (µs)",
    yLabel: "Current (µA)",
    xRangeUs: { min: xMin, max: xMax },
    yRangeUa: { min: yMin - yPadding, max: yMax + yPadding },
    frameIndex,
    series: plottedSeries,
  };
}

export function scientificAlinePngDefaultFilename(sourcePath: string, frameIndex: number): string {
  const name = sourcePath.split(/[\\/]/).filter(Boolean).pop() ?? "";
  const stem = name.replace(/\.[^.]+$/, "");
  const safeStem = stem.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "") || "pa";
  return `${safeStem}_frame_${Math.max(0, Math.floor(frameIndex))}_aline_scientific.png`;
}

function ticks(min: number, max: number, divisions: number): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
  if (max === min) return [min];
  return Array.from({ length: divisions + 1 }, (_, index) => min + ((max - min) * index) / divisions);
}

function tickText(value: number): string {
  const magnitude = Math.abs(value);
  if ((magnitude > 0 && magnitude < 0.001) || magnitude >= 10_000) return value.toExponential(2);
  const digits = magnitude >= 100 ? 1 : magnitude >= 10 ? 2 : 3;
  return value.toFixed(digits).replace(/\.?0+$/, "");
}

function canvasToPngBytes(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("Scientific PNG export failed"));
        return;
      }
      blob.arrayBuffer()
        .then((buffer) => resolve(new Uint8Array(buffer)))
        .catch(reject);
    }, "image/png");
  });
}

export async function scientificAlinePngBytes(input: ScientificAlinePlotInput): Promise<Uint8Array> {
  if (typeof document === "undefined") throw new Error("Scientific PNG export requires a browser canvas");
  const spec = buildScientificAlinePlotSpec(input);
  const canvas = document.createElement("canvas");
  canvas.width = spec.width;
  canvas.height = spec.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Scientific PNG canvas is not available");

  const margin = { left: 220, right: 90, top: 190, bottom: 190 };
  const plotWidth = spec.width - margin.left - margin.right;
  const plotHeight = spec.height - margin.top - margin.bottom;
  const xSpan = spec.xRangeUs.max - spec.xRangeUs.min || 1;
  const ySpan = spec.yRangeUa.max - spec.yRangeUa.min || 1;
  const toX = (value: number) => margin.left + ((value - spec.xRangeUs.min) / xSpan) * plotWidth;
  const toY = (value: number) => margin.top + (1 - (value - spec.yRangeUa.min) / ySpan) * plotHeight;

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, spec.width, spec.height);
  ctx.font = "700 46px Arial, sans-serif";
  ctx.fillStyle = "#111827";
  ctx.textAlign = "left";
  ctx.fillText("Processed PA A-line", margin.left, 68);
  ctx.font = "30px Arial, sans-serif";
  ctx.fillStyle = "#4b5563";
  ctx.fillText(`Source frame ${spec.frameIndex}`, margin.left, 116);

  ctx.font = "30px Arial, sans-serif";
  ctx.lineWidth = 2;
  ticks(spec.yRangeUa.min, spec.yRangeUa.max, 6).forEach((value) => {
    const y = toY(value);
    ctx.strokeStyle = "#d1d5db";
    ctx.beginPath();
    ctx.moveTo(margin.left, y);
    ctx.lineTo(margin.left + plotWidth, y);
    ctx.stroke();
    ctx.fillStyle = "#111827";
    ctx.textAlign = "right";
    ctx.fillText(tickText(value), margin.left - 24, y + 10);
  });
  ticks(spec.xRangeUs.min, spec.xRangeUs.max, 6).forEach((value) => {
    const x = toX(value);
    ctx.strokeStyle = "#e5e7eb";
    ctx.beginPath();
    ctx.moveTo(x, margin.top);
    ctx.lineTo(x, margin.top + plotHeight);
    ctx.stroke();
    ctx.fillStyle = "#111827";
    ctx.textAlign = "center";
    ctx.fillText(tickText(value), x, margin.top + plotHeight + 52);
  });

  ctx.strokeStyle = "#111827";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(margin.left, margin.top);
  ctx.lineTo(margin.left, margin.top + plotHeight);
  ctx.lineTo(margin.left + plotWidth, margin.top + plotHeight);
  ctx.stroke();

  ctx.save();
  ctx.beginPath();
  ctx.rect(margin.left, margin.top, plotWidth, plotHeight);
  ctx.clip();
  spec.series.forEach((source) => {
    ctx.strokeStyle = source.color;
    ctx.lineWidth = 4;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.beginPath();
    source.points.forEach((point, index) => {
      const x = toX(point.xUs);
      const y = toY(point.yUa);
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  });
  ctx.restore();

  let legendX = margin.left;
  const legendY = 156;
  ctx.font = "30px Arial, sans-serif";
  spec.series.forEach((source) => {
    ctx.strokeStyle = source.color;
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(legendX, legendY - 10);
    ctx.lineTo(legendX + 56, legendY - 10);
    ctx.stroke();
    ctx.fillStyle = "#111827";
    ctx.textAlign = "left";
    ctx.fillText(source.label, legendX + 72, legendY);
    legendX += 100 + ctx.measureText(source.label).width;
  });

  ctx.fillStyle = "#111827";
  ctx.font = "36px Arial, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(spec.xLabel, margin.left + plotWidth / 2, spec.height - 56);
  ctx.save();
  ctx.translate(60, margin.top + plotHeight / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText(spec.yLabel, 0, 0);
  ctx.restore();

  return canvasToPngBytes(canvas);
}
