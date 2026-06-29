import { DEFAULT_PD_ZERO_ADC_CODE } from "./ada4355";
import type { PaImageBuildResult } from "./paImageTauri";

export type PaSeverity = "ok" | "warning" | "error";

export type PaImageProcessing = {
  sampleIntervalNs: number;
  sampleStartIndex: number;
  sampleEndTrim: number;
  baselineStartNs: number;
  baselineEndNs: number;
  ptpStartNs: number;
  ptpEndNs: number;
  tzOhm: number;
  vfs: number;
  zeroAdcCode: number;
};

export const DEFAULT_PA_IMAGE_PROCESSING: PaImageProcessing = {
  sampleIntervalNs: 8,
  sampleStartIndex: 10,
  sampleEndTrim: 50,
  baselineStartNs: 100,
  baselineEndNs: 400,
  ptpStartNs: 1600,
  ptpEndNs: 2400,
  tzOhm: 2000,
  vfs: 1,
  zeroAdcCode: DEFAULT_PD_ZERO_ADC_CODE,
};

export const DEFAULT_PA_TRACE_DISPLAY_SAMPLES = 2000;
export const PA_IMAGE_ROI_STORAGE_KEY = "paImageRoiDefaults";

type PaImageRoiDefaults = Pick<
  PaImageProcessing,
  "baselineEndNs" | "baselineStartNs" | "ptpEndNs" | "ptpStartNs"
>;

type PaImageRoiStorage = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
};

function browserStorage(): PaImageRoiStorage | undefined {
  if (typeof localStorage === "undefined") return undefined;
  return localStorage;
}

function finiteNumber(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function paImageRoiDefaultsFromProcessing(config: PaImageProcessing): PaImageRoiDefaults {
  return {
    baselineStartNs: config.baselineStartNs,
    baselineEndNs: config.baselineEndNs,
    ptpStartNs: config.ptpStartNs,
    ptpEndNs: config.ptpEndNs,
  };
}

export function savePaImageRoiDefaults(config: PaImageProcessing, storage: PaImageRoiStorage | undefined = browserStorage()) {
  storage?.setItem(PA_IMAGE_ROI_STORAGE_KEY, JSON.stringify(paImageRoiDefaultsFromProcessing(config)));
}

export function loadPaImageProcessingDefaults(
  base: PaImageProcessing,
  storage: PaImageRoiStorage | undefined = browserStorage(),
): PaImageProcessing {
  if (!storage) return base;
  const raw = storage.getItem(PA_IMAGE_ROI_STORAGE_KEY);
  if (!raw) return base;
  try {
    const parsed = JSON.parse(raw) as Partial<PaImageRoiDefaults>;
    return {
      ...base,
      baselineStartNs: finiteNumber(parsed.baselineStartNs) ?? base.baselineStartNs,
      baselineEndNs: finiteNumber(parsed.baselineEndNs) ?? base.baselineEndNs,
      ptpStartNs: finiteNumber(parsed.ptpStartNs) ?? base.ptpStartNs,
      ptpEndNs: finiteNumber(parsed.ptpEndNs) ?? base.ptpEndNs,
    };
  } catch {
    return base;
  }
}

export function defaultPaTraceDisplayDomain(sampleCount: number, displaySamples = DEFAULT_PA_TRACE_DISPLAY_SAMPLES) {
  const safeCount = Math.max(0, Math.floor(sampleCount));
  if (safeCount <= 0) return { startIndex: 0, endIndex: 0 };
  const safeDisplaySamples = Math.max(1, Math.floor(displaySamples));
  return {
    startIndex: 0,
    endIndex: Math.min(safeCount, safeDisplaySamples) - 1,
  };
}

export function signedAdcCodeToCurrentMicroamp(code: number, tzOhm = 2000, vfs = 1, zeroAdcCode = DEFAULT_PD_ZERO_ADC_CODE): number {
  const signed = Math.max(-32768, Math.min(32767, Math.round(code)));
  const zero = Math.max(-32768, Math.min(32767, Math.round(zeroAdcCode)));
  const vZero = (zero / 32768) * vfs;
  const vAdc = (signed / 32768) * vfs;
  return ((vZero - vAdc) / Math.max(1, tzOhm)) * 1_000_000;
}

export function timeNsForSampleIndex(
  sourceIndex: number,
  sampleStartIndex: number,
  sampleIntervalNs: number,
): number {
  return Math.max(0, Math.round(sourceIndex - sampleStartIndex)) * sampleIntervalNs;
}

export function indexRangeToNsWindow(
  startIndex: number,
  endIndex: number,
  sampleStartIndex: number,
  sampleIntervalNs: number,
): { startNs: number; endNs: number } {
  const first = Math.min(startIndex, endIndex);
  const last = Math.max(startIndex, endIndex);
  return {
    startNs: timeNsForSampleIndex(first, sampleStartIndex, sampleIntervalNs),
    endNs: timeNsForSampleIndex(last, sampleStartIndex, sampleIntervalNs),
  };
}

export function formatUnknownError(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function maxSeverity(a: PaSeverity, b: PaSeverity): PaSeverity {
  if (a === "error" || b === "error") return "error";
  if (a === "warning" || b === "warning") return "warning";
  return "ok";
}

export function mergePaImageBuildChunk(current: PaImageBuildResult | undefined, chunk: PaImageBuildResult): PaImageBuildResult {
  if (!current || current.width === 0 || current.height === 0 || current.values.length === 0) return chunk;
  if (current.width !== chunk.width || current.height !== chunk.height || current.values.length !== chunk.values.length) return chunk;

  const values = current.values.map((value, index) => {
    const existingCount = current.counts[index] ?? 0;
    const chunkCount = chunk.counts[index] ?? 0;
    const totalCount = existingCount + chunkCount;
    if (totalCount <= 0) return null;
    const existingSum = (value ?? 0) * existingCount;
    const chunkSum = (chunk.values[index] ?? 0) * chunkCount;
    return (existingSum + chunkSum) / totalCount;
  });
  const counts = current.counts.map((count, index) => count + (chunk.counts[index] ?? 0));
  const pixel_frame_indices = current.pixel_frame_indices.map((frameIndex, index) => frameIndex ?? chunk.pixel_frame_indices[index] ?? null);

  return {
    path: current.path || chunk.path,
    width: current.width,
    height: current.height,
    values,
    counts,
    pixel_frame_indices,
    x_start: current.x_start ?? chunk.x_start,
    x_end: current.x_end ?? chunk.x_end,
    y_start: current.y_start ?? chunk.y_start,
    y_end: current.y_end ?? chunk.y_end,
    pixel_count: current.pixel_count || chunk.pixel_count,
    frame_count: current.frame_count + chunk.frame_count,
    bad_frame_count: current.bad_frame_count + chunk.bad_frame_count,
    severity: maxSeverity(current.severity, chunk.severity),
    issues: [...current.issues, ...chunk.issues].slice(0, 50),
  };
}

export function frameIndexForPaImagePixel(image: PaImageBuildResult, pixel: { x: number; y: number }): number | null {
  const x = Math.floor(pixel.x);
  const y = Math.floor(pixel.y);
  if (x < 0 || y < 0 || x >= image.width || y >= image.height) return null;
  const index = y * image.width + x;
  const frameIndex = image.pixel_frame_indices[index];
  return typeof frameIndex === "number" && Number.isFinite(frameIndex) ? frameIndex : null;
}

export type PaSimilarPixelMask = {
  mask: boolean[];
  selectedValue: number;
  tolerancePercent: number;
  toleranceValue: number;
  matchedCount: number;
  finiteCount: number;
};

export function findSimilarPaPixels(
  image: PaImageBuildResult,
  pixel: { x: number; y: number },
  tolerancePercent: number,
): PaSimilarPixelMask | null {
  const x = Math.floor(pixel.x);
  const y = Math.floor(pixel.y);
  if (x < 0 || y < 0 || x >= image.width || y >= image.height) return null;
  const selectedIndex = y * image.width + x;
  const selectedValue = image.values[selectedIndex];
  if (typeof selectedValue !== "number" || !Number.isFinite(selectedValue) || (image.counts[selectedIndex] ?? 0) <= 0) return null;

  let low = Number.POSITIVE_INFINITY;
  let high = Number.NEGATIVE_INFINITY;
  let finiteCount = 0;
  for (let index = 0; index < image.values.length; index += 1) {
    if ((image.counts[index] ?? 0) <= 0) continue;
    const value = image.values[index];
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    low = Math.min(low, value);
    high = Math.max(high, value);
    finiteCount += 1;
  }
  if (finiteCount === 0) return null;

  const span = Math.max(0, high - low);
  const safeTolerancePercent = Math.max(0, Number.isFinite(tolerancePercent) ? tolerancePercent : 0);
  const toleranceValue = span * safeTolerancePercent / 100;
  const mask = image.values.map((value, index) => {
    if ((image.counts[index] ?? 0) <= 0) return false;
    return typeof value === "number" && Number.isFinite(value) && Math.abs(value - selectedValue) <= toleranceValue;
  });
  const matchedCount = mask.reduce((count, included) => count + (included ? 1 : 0), 0);
  return {
    mask,
    selectedValue,
    tolerancePercent: safeTolerancePercent,
    toleranceValue,
    matchedCount,
    finiteCount,
  };
}
