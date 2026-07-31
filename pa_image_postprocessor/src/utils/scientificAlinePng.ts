import { invoke } from "@tauri-apps/api/core";
import type { PlotXDomain } from "../components/PlotCanvas";

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

export function scientificAlinePngDefaultFilename(sourcePath: string, frameIndex: number): string {
  const name = sourcePath.split(/[\\/]/).filter(Boolean).pop() ?? "";
  const stem = name.replace(/\.[^.]+$/, "");
  const safeStem = stem.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "") || "pa";
  return `${safeStem}_frame_${Math.max(0, Math.floor(frameIndex))}_aline_scientific.png`;
}

export async function scientificAlinePngBytes(request: ScientificAlinePlotInput): Promise<Uint8Array> {
  const bytes = await invoke<number[]>("pa_classical_render_scientific_aline", { request });
  return Uint8Array.from(bytes);
}