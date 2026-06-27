import { useEffect, useRef } from "react";

type Props = {
  width: number;
  height: number;
  values: Array<number | null>;
  counts: number[];
  active?: boolean;
};

function colorForUnit(value: number): string {
  const v = Math.max(0, Math.min(1, value));
  const r = Math.round(20 + (215 * Math.max(0, v - 0.45)) / 0.55);
  const g = Math.round(90 + 150 * (1 - Math.abs(v - 0.55)));
  const b = Math.round(140 * (1 - v));
  return `rgb(${r}, ${g}, ${b})`;
}

function percentile(sorted: number[], unit: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.max(0, Math.min(sorted.length - 1, Math.round(unit * (sorted.length - 1))));
  return sorted[index];
}

export default function PaImageHeatmap({ width, height, values, counts, active = true }: Props) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!active) return;
    const canvas = ref.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const cssWidth = Math.max(320, rect.width || 520);
    const cssHeight = Math.max(260, rect.height || 360);
    const scale = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(cssWidth * scale));
    canvas.height = Math.max(1, Math.floor(cssHeight * scale));

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.clearRect(0, 0, cssWidth, cssHeight);
    ctx.fillStyle = "#f8fafc";
    ctx.fillRect(0, 0, cssWidth, cssHeight);

    const marginLeft = 38;
    const marginTop = 18;
    const marginRight = 14;
    const marginBottom = 34;
    const plotWidth = Math.max(1, cssWidth - marginLeft - marginRight);
    const plotHeight = Math.max(1, cssHeight - marginTop - marginBottom);
    const safeWidth = Math.max(1, Math.floor(width));
    const safeHeight = Math.max(1, Math.floor(height));
    const cell = Math.max(1, Math.floor(Math.min(plotWidth / safeWidth, plotHeight / safeHeight)));
    const gridWidth = cell * safeWidth;
    const gridHeight = cell * safeHeight;
    const x0 = marginLeft + Math.max(0, (plotWidth - gridWidth) / 2);
    const y0 = marginTop + Math.max(0, (plotHeight - gridHeight) / 2);
    const finiteValues = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value)).sort((a, b) => a - b);
    const low = percentile(finiteValues, 0.01);
    const high = percentile(finiteValues, 0.99);
    const span = Math.max(1e-12, high - low);

    ctx.strokeStyle = "#d5dfeb";
    ctx.lineWidth = 1;
    ctx.strokeRect(x0 - 0.5, y0 - 0.5, gridWidth + 1, gridHeight + 1);

    for (let y = 0; y < safeHeight; y += 1) {
      for (let x = 0; x < safeWidth; x += 1) {
        const index = y * safeWidth + x;
        const value = values[index];
        const count = counts[index] ?? 0;
        if (typeof value === "number" && Number.isFinite(value) && count > 0) {
          ctx.fillStyle = colorForUnit((value - low) / span);
        } else {
          ctx.fillStyle = "#e5e7eb";
        }
        ctx.fillRect(x0 + x * cell, y0 + y * cell, cell, cell);
      }
    }

    ctx.fillStyle = "#475569";
    ctx.font = "12px Segoe UI, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("X", x0 + gridWidth / 2, cssHeight - 10);
    ctx.save();
    ctx.translate(12, y0 + gridHeight / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText("Y", 0, 0);
    ctx.restore();

    if (finiteValues.length === 0) {
      ctx.fillStyle = "#64748b";
      ctx.textAlign = "center";
      ctx.fillText("No PA image values", x0 + gridWidth / 2, y0 + gridHeight / 2);
    }
  }, [active, counts, height, values, width]);

  return <canvas ref={ref} className="pa-image-heatmap" aria-label="PA image heatmap" />;
}
