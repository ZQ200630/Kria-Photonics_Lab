import type { PaCaptureParams } from "../api/types";

export const PAM_TIMING_CLOCK_HZ = 100_000_000;
export const PAM_TIMING_TICK_NS = 10;
export const PAM_ADC_CAPTURE_SAMPLES = 2048;
export const PAM_ADC_SAMPLE_NS = 8;
export const PAM_ADC_CAPTURE_COUNTS = Math.ceil((PAM_ADC_CAPTURE_SAMPLES * PAM_ADC_SAMPLE_NS) / PAM_TIMING_TICK_NS);
export const PAM_ADC_POST_BUFFER_COUNTS = 300;
export const PAM_GALVO_SETTLE_MIN_COUNTS = 500;
export const PAM_LASER_EMISSION_DELAY_COUNTS = 100;
export const DEFAULT_SCAN_SCALE_COUNTS = 4000;
export const DEFAULT_SCAN_SCALE_UM = 530;
export const PA_SCAN_DEFAULTS_STORAGE_KEY = "paScanDefaults";

export type DurationUnit = "ns" | "us" | "ms" | "s";
export type RateUnit = "Hz" | "kHz" | "MHz";

export type UnitDisplay<TUnit extends string> = {
  value: string;
  unit: TUnit;
};

export type PamTimingCounts = Required<
  Pick<PaCaptureParams, "gap_time" | "galvo_settle_time" | "ld_trigger_time" | "adc_trigger_time" | "ld_time">
>;

export type PamTimingField = keyof PamTimingCounts | "repetition_rate";
export type PamTimingRequirement = Pick<
  PamTimingCounts,
  "galvo_settle_time" | "ld_trigger_time" | "adc_trigger_time" | "ld_time"
>;

const DURATION_UNIT_NS: Record<DurationUnit, number> = {
  ns: 1,
  us: 1_000,
  ms: 1_000_000,
  s: 1_000_000_000,
};

const RATE_UNIT_HZ: Record<RateUnit, number> = {
  Hz: 1,
  kHz: 1_000,
  MHz: 1_000_000,
};

function positiveInteger(value: unknown): number {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) && Number.isInteger(numericValue) && numericValue > 0 ? numericValue : 1;
}

function finiteNumber(value: unknown, fallback = 0): number {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : fallback;
}

function nonNegativeInteger(value: unknown): number {
  return Math.max(0, Math.round(finiteNumber(value, 0)));
}

function positiveCount(value: unknown): number {
  return Math.max(1, Math.round(finiteNumber(value, 1)));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function formatDisplayNumber(value: number): string {
  if (!Number.isFinite(value)) return "0";
  const rounded = Math.round(value * 1_000_000) / 1_000_000;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded).replace(/0+$/, "").replace(/\.$/, "");
}

export function expectedFramesFromParams(params: PaCaptureParams): number {
  return positiveInteger(params.x_points) * positiveInteger(params.y_points) * positiveInteger(params.frame_number);
}

export function estimatedCaptureCountsFromParams(params: PaCaptureParams): number {
  return positiveCount(params.gap_time) * expectedFramesFromParams(params);
}

export function estimatedCaptureSecondsFromParams(params: PaCaptureParams): number {
  return estimatedCaptureCountsFromParams(params) / PAM_TIMING_CLOCK_HZ;
}

export function captureTimeSecondsForServerStart(_params: PaCaptureParams): number {
  return 0;
}

export type CaptureProgressInput = {
  processedFrames: number;
  expectedFrames: number;
  elapsedMs: number;
  plannedSeconds: number;
};

export type CaptureProgressSnapshot = {
  processedFrames: number;
  expectedFrames: number;
  percent: number;
  elapsedSeconds: number;
  remainingSeconds: number;
  frameRate: number;
  complete: boolean;
};

export type PaLivePreviewRefreshInput = {
  running: boolean;
  processedFrames: number;
  lastSnapshotFrameCount: number;
  pixelCount: number;
  requestInFlight?: boolean;
};

export type CaptureProgressVisibilityInput = {
  dismissed: boolean;
  serverRunning: boolean;
  processedFrames: number;
  receiverFrames: number;
};

export type PaImagePixelLike = { x: number; y: number };
export type PaImageZoomLike = { xStart: number; xEnd: number; yStart: number; yEnd: number };
export type PaImageAxisLabelsLike = { xStart?: number | null; xEnd?: number | null; yStart?: number | null; yEnd?: number | null };
export type PaPreviewSourceLike = "current" | "canvas";
export type PaPreviewRoiPurposeLike = "manual" | "fineScan" | null;
export type PaZoomCommitState = {
  zoom: PaImageZoomLike;
  roi: null;
  roiSource: null;
  roiPurpose: null;
};
export type PaImagePixelToScanPointInput = {
  pixel: PaImagePixelLike;
  width: number;
  height: number;
  axisLabels?: PaImageAxisLabelsLike;
};
export type PaImageZoomToScanRangeInput = {
  zoom: PaImageZoomLike;
  width: number;
  height: number;
  axisLabels?: PaImageAxisLabelsLike;
};
export type PaCanvasRoiFromScanParamsInput = {
  params: Pick<PaCaptureParams, "x_start" | "x_step" | "x_points" | "y_start" | "y_step" | "y_points">;
  width: number;
  height: number;
  axisLabels?: PaImageAxisLabelsLike;
};
export type PaCanvasRoiFromScanParamsResult =
  | { status: "inside"; roi: PaImageZoomLike }
  | { status: "outside"; roi: null };
export type PaPreviewSourceAfterScanCompleteInput = {
  currentSource: PaPreviewSourceLike;
  roiPurpose: PaPreviewRoiPurposeLike;
  complete: boolean;
};
export type PaFineScanParamsFromImageRoiInput = Omit<PaImageZoomToScanRangeInput, "zoom"> & {
  roi: PaImageZoomLike;
  stepCounts: unknown;
  baseParams?: Pick<PaCaptureParams, "frame_number" | "scan_mode" | "return_mode">;
};
export type PaScanDefaults = Required<
  Pick<
    PaCaptureParams,
    "x_start" | "x_step" | "x_points" | "y_start" | "y_step" | "y_points" | "frame_number" | "scan_mode" | "return_mode"
  >
>;
export type PaScanDefaultsStorage = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
};

export function captureProgressSnapshot(input: CaptureProgressInput): CaptureProgressSnapshot {
  const processedFrames = nonNegativeInteger(input.processedFrames);
  const expectedFrames = nonNegativeInteger(input.expectedFrames);
  const elapsedSeconds = Math.max(0, finiteNumber(input.elapsedMs, 0) / 1000);
  const plannedSeconds = Math.max(0, finiteNumber(input.plannedSeconds, 0));
  const percent = expectedFrames > 0 ? clamp((processedFrames / expectedFrames) * 100, 0, 100) : 0;
  const frameRate = processedFrames > 0 && elapsedSeconds > 0 ? processedFrames / elapsedSeconds : 0;
  const remainingFrames = Math.max(0, expectedFrames - processedFrames);
  const remainingSeconds =
    remainingFrames === 0
      ? 0
      : frameRate > 0
        ? remainingFrames / frameRate
        : Math.max(0, plannedSeconds - elapsedSeconds);

  return {
    processedFrames,
    expectedFrames,
    percent,
    elapsedSeconds,
    remainingSeconds,
    frameRate,
    complete: expectedFrames > 0 && processedFrames >= expectedFrames,
  };
}

export function shouldShowCaptureProgress(input: CaptureProgressVisibilityInput): boolean {
  if (input.dismissed) return false;
  return Boolean(
    input.serverRunning ||
      nonNegativeInteger(input.processedFrames) > 0 ||
      nonNegativeInteger(input.receiverFrames) > 0,
  );
}

export function paLivePreviewIntervalMs(pixelCount: unknown): number {
  const safePixelCount = nonNegativeInteger(pixelCount);
  if (safePixelCount <= 10_000) return 600;
  if (safePixelCount <= 250_000) return 1500;
  return 3000;
}

export function paLivePreviewMinFrameDelta(pixelCount: unknown): number {
  const safePixelCount = nonNegativeInteger(pixelCount);
  if (safePixelCount <= 10_000) return 32;
  if (safePixelCount <= 250_000) return 512;
  return 4096;
}

export function shouldRefreshPaLivePreview(input: PaLivePreviewRefreshInput): boolean {
  if (!input.running || input.requestInFlight) return false;
  const processedFrames = nonNegativeInteger(input.processedFrames);
  if (processedFrames <= 0) return false;
  const lastSnapshotFrameCount = nonNegativeInteger(input.lastSnapshotFrameCount);
  if (lastSnapshotFrameCount <= 0) return true;
  return processedFrames - lastSnapshotFrameCount >= paLivePreviewMinFrameDelta(input.pixelCount);
}

export function runPaLivePreviewUpdate(
  update: () => void,
  scheduler: (update: () => void) => void = (scheduledUpdate) => scheduledUpdate(),
) {
  scheduler(update);
}

function finiteAxis(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function imageIndexToAxisCount(start: unknown, end: unknown, index: unknown, maxIndex: unknown): number {
  const safeMaxIndex = Math.max(0, Math.round(finiteAxis(maxIndex, 0)));
  const safeIndex = Math.max(0, Math.min(safeMaxIndex, Math.round(finiteAxis(index, 0))));
  const safeStart = finiteAxis(start, 0);
  const safeEnd = finiteAxis(end, safeStart);
  if (safeMaxIndex <= 0) return Math.round(safeStart);
  return Math.round(safeStart + ((safeEnd - safeStart) * safeIndex) / safeMaxIndex);
}

function axisIndexFromCount(start: unknown, end: unknown, count: unknown, maxIndex: unknown): number | null {
  const safeMaxIndex = Math.max(0, Math.round(finiteAxis(maxIndex, 0)));
  const safeStart = finiteAxis(start, Number.NaN);
  const safeEnd = finiteAxis(end, Number.NaN);
  const safeCount = finiteAxis(count, Number.NaN);
  if (!Number.isFinite(safeStart) || !Number.isFinite(safeEnd) || !Number.isFinite(safeCount)) return null;
  if (safeMaxIndex <= 0 || safeStart === safeEnd) return 0;
  return Math.round(((safeCount - safeStart) / (safeEnd - safeStart)) * safeMaxIndex);
}

function countRangeInside(axisStart: unknown, axisEnd: unknown, rangeStart: unknown, rangeEnd: unknown): boolean {
  const safeAxisStart = finiteAxis(axisStart, Number.NaN);
  const safeAxisEnd = finiteAxis(axisEnd, Number.NaN);
  const safeRangeStart = finiteAxis(rangeStart, Number.NaN);
  const safeRangeEnd = finiteAxis(rangeEnd, Number.NaN);
  if (![safeAxisStart, safeAxisEnd, safeRangeStart, safeRangeEnd].every(Number.isFinite)) return false;
  const axisMin = Math.min(safeAxisStart, safeAxisEnd);
  const axisMax = Math.max(safeAxisStart, safeAxisEnd);
  const rangeMin = Math.min(safeRangeStart, safeRangeEnd);
  const rangeMax = Math.max(safeRangeStart, safeRangeEnd);
  return rangeMin >= axisMin && rangeMax <= axisMax;
}

export function paImagePixelToScanPoint(input: PaImagePixelToScanPointInput): { x: number; y: number } {
  const width = Math.max(1, Math.round(finiteNumber(input.width, 1)));
  const height = Math.max(1, Math.round(finiteNumber(input.height, 1)));
  return {
    x: imageIndexToAxisCount(input.axisLabels?.xStart, input.axisLabels?.xEnd, input.pixel.x, width - 1),
    y: imageIndexToAxisCount(input.axisLabels?.yStart, input.axisLabels?.yEnd, input.pixel.y, height - 1),
  };
}

export function paImageZoomToScanRange(input: PaImageZoomToScanRangeInput) {
  const width = Math.max(1, Math.round(finiteNumber(input.width, 1)));
  const height = Math.max(1, Math.round(finiteNumber(input.height, 1)));
  const xFirst = Math.min(input.zoom.xStart, input.zoom.xEnd);
  const xLast = Math.max(input.zoom.xStart, input.zoom.xEnd);
  const yFirst = Math.min(input.zoom.yStart, input.zoom.yEnd);
  const yLast = Math.max(input.zoom.yStart, input.zoom.yEnd);
  const start = paImagePixelToScanPoint({
    pixel: { x: xFirst, y: yFirst },
    width,
    height,
    axisLabels: input.axisLabels,
  });
  const end = paImagePixelToScanPoint({
    pixel: { x: xLast, y: yLast },
    width,
    height,
    axisLabels: input.axisLabels,
  });
  return {
    xStart: Math.min(start.x, end.x),
    xEnd: Math.max(start.x, end.x),
    yStart: Math.min(start.y, end.y),
    yEnd: Math.max(start.y, end.y),
    xCenter: Math.round((start.x + end.x) / 2),
    yCenter: Math.round((start.y + end.y) / 2),
    xRange: Math.abs(end.x - start.x),
    yRange: Math.abs(end.y - start.y),
  };
}

export function paZoomCommitStateFromRoi(roi: PaImageZoomLike | null | undefined): PaZoomCommitState | null {
  if (!roi) return null;
  return {
    zoom: { xStart: roi.xStart, xEnd: roi.xEnd, yStart: roi.yStart, yEnd: roi.yEnd },
    roi: null,
    roiSource: null,
    roiPurpose: null,
  };
}

export function paCanvasRoiFromScanParams(input: PaCanvasRoiFromScanParamsInput): PaCanvasRoiFromScanParamsResult {
  const width = Math.max(1, Math.round(finiteNumber(input.width, 1)));
  const height = Math.max(1, Math.round(finiteNumber(input.height, 1)));
  const xStartCount = finiteNumber(input.params.x_start, 0);
  const xEndCount = axisEndFromStartStep(input.params.x_start, input.params.x_step, input.params.x_points);
  const yStartCount = finiteNumber(input.params.y_start, 0);
  const yEndCount = axisEndFromStartStep(input.params.y_start, input.params.y_step, input.params.y_points);
  if (
    !countRangeInside(input.axisLabels?.xStart, input.axisLabels?.xEnd, xStartCount, xEndCount) ||
    !countRangeInside(input.axisLabels?.yStart, input.axisLabels?.yEnd, yStartCount, yEndCount)
  ) {
    return { status: "outside", roi: null };
  }
  const x0 = axisIndexFromCount(input.axisLabels?.xStart, input.axisLabels?.xEnd, xStartCount, width - 1);
  const x1 = axisIndexFromCount(input.axisLabels?.xStart, input.axisLabels?.xEnd, xEndCount, width - 1);
  const y0 = axisIndexFromCount(input.axisLabels?.yStart, input.axisLabels?.yEnd, yStartCount, height - 1);
  const y1 = axisIndexFromCount(input.axisLabels?.yStart, input.axisLabels?.yEnd, yEndCount, height - 1);
  if (x0 === null || x1 === null || y0 === null || y1 === null) {
    return { status: "outside", roi: null };
  }
  return {
    status: "inside",
    roi: {
      xStart: Math.max(0, Math.min(width - 1, Math.min(x0, x1))),
      xEnd: Math.max(0, Math.min(width - 1, Math.max(x0, x1))),
      yStart: Math.max(0, Math.min(height - 1, Math.min(y0, y1))),
      yEnd: Math.max(0, Math.min(height - 1, Math.max(y0, y1))),
    },
  };
}

export function paPreviewSourceAfterScanComplete(input: PaPreviewSourceAfterScanCompleteInput): PaPreviewSourceLike {
  if (input.complete && input.roiPurpose === "fineScan") return "current";
  return input.currentSource;
}

function scanAxisFromRange(start: number, end: number, stepCounts: unknown): { start: number; step: number; points: number } {
  const safeStart = Math.round(Math.min(start, end));
  const safeEnd = Math.round(Math.max(start, end));
  const range = Math.max(0, safeEnd - safeStart);
  if (range <= 0) {
    return { start: safeStart, step: 0, points: 1 };
  }
  const step = Math.max(1, Math.round(Math.abs(finiteNumber(stepCounts, 1))));
  return {
    start: safeStart,
    step,
    points: Math.max(2, Math.ceil(range / step) + 1),
  };
}

export function paFineScanParamsFromImageRoi(input: PaFineScanParamsFromImageRoiInput): PaScanDefaults {
  const range = paImageZoomToScanRange({ ...input, zoom: input.roi });
  const x = scanAxisFromRange(range.xStart, range.xEnd, input.stepCounts);
  const y = scanAxisFromRange(range.yStart, range.yEnd, input.stepCounts);
  return {
    x_start: x.start,
    x_step: x.step,
    x_points: x.points,
    y_start: y.start,
    y_step: y.step,
    y_points: y.points,
    frame_number: positiveInteger(input.baseParams?.frame_number),
    scan_mode: Math.round(finiteNumber(input.baseParams?.scan_mode, 1)),
    return_mode: Math.round(finiteNumber(input.baseParams?.return_mode, 0)),
  };
}

export function paScanDefaultsFromParams(params: PaCaptureParams): PaScanDefaults {
  return {
    x_start: Math.round(finiteNumber(params.x_start, 0)),
    x_step: Math.round(finiteNumber(params.x_step, 0)),
    x_points: positiveInteger(params.x_points),
    y_start: Math.round(finiteNumber(params.y_start, 0)),
    y_step: Math.round(finiteNumber(params.y_step, 0)),
    y_points: positiveInteger(params.y_points),
    frame_number: positiveInteger(params.frame_number),
    scan_mode: Math.round(finiteNumber(params.scan_mode, 1)),
    return_mode: Math.round(finiteNumber(params.return_mode, 0)),
  };
}

export function scanParamsWithDefaults(params: PaCaptureParams, defaults: PaScanDefaults): PaCaptureParams {
  return {
    ...params,
    ...defaults,
  };
}

function browserScanDefaultsStorage(): PaScanDefaultsStorage | undefined {
  if (typeof localStorage === "undefined") return undefined;
  return localStorage;
}

export function savePaScanDefaults(defaults: PaScanDefaults, storage: PaScanDefaultsStorage | undefined = browserScanDefaultsStorage()) {
  storage?.setItem(PA_SCAN_DEFAULTS_STORAGE_KEY, JSON.stringify(defaults));
}

export function loadPaScanDefaults(
  base: PaScanDefaults,
  storage: PaScanDefaultsStorage | undefined = browserScanDefaultsStorage(),
): PaScanDefaults {
  if (!storage) return base;
  const raw = storage.getItem(PA_SCAN_DEFAULTS_STORAGE_KEY);
  if (!raw) return base;
  try {
    return paScanDefaultsFromParams({
      ...base,
      ...(JSON.parse(raw) as Partial<PaScanDefaults>),
    });
  } catch {
    return base;
  }
}

export function axisEndFromStartStep(start: unknown, step: unknown, points: unknown): number {
  return finiteNumber(start, 0) + finiteNumber(step, 0) * (positiveInteger(points) - 1);
}

export function axisCenterFromStartStep(start: unknown, step: unknown, points: unknown): number {
  return (finiteNumber(start, 0) + axisEndFromStartStep(start, step, points)) / 2;
}

export function axisRangeFromStartStep(start: unknown, step: unknown, points: unknown): number {
  return axisEndFromStartStep(start, step, points) - finiteNumber(start, 0);
}

export function axisStartStepFromEndpoints(start: unknown, end: unknown, points: unknown): { start: number; step: number } {
  const safePoints = positiveInteger(points);
  const safeStart = Math.round(finiteNumber(start, 0));
  if (safePoints <= 1) {
    return { start: safeStart, step: 0 };
  }
  return {
    start: safeStart,
    step: Math.round((finiteNumber(end, safeStart) - safeStart) / (safePoints - 1)),
  };
}

export function axisStartStepFromCenterRange(center: unknown, range: unknown, points: unknown): { start: number; step: number } {
  const safePoints = positiveInteger(points);
  const safeCenter = finiteNumber(center, 0);
  if (safePoints <= 1) {
    return { start: Math.round(safeCenter), step: 0 };
  }
  const step = Math.round(finiteNumber(range, 0) / (safePoints - 1));
  return {
    start: Math.round(safeCenter - (step * (safePoints - 1)) / 2),
    step,
  };
}

export function scanUmPerCountFromCalibration(counts: unknown, um: unknown): number {
  const safeCounts = Math.max(1, Math.abs(finiteNumber(counts, DEFAULT_SCAN_SCALE_COUNTS)));
  return Math.abs(finiteNumber(um, DEFAULT_SCAN_SCALE_UM)) / safeCounts;
}

export function scanResolutionUmFromStep(step: unknown, umPerCount: unknown): number {
  return Math.abs(finiteNumber(step, 0)) * Math.max(0, finiteNumber(umPerCount, 0));
}

export function durationDisplayFromCounts(counts: number): UnitDisplay<DurationUnit> {
  const totalNs = Math.max(0, Math.round(finiteNumber(counts, 0))) * PAM_TIMING_TICK_NS;
  const units: DurationUnit[] = ["s", "ms", "us", "ns"];
  const unit = units.find((candidate) => totalNs / DURATION_UNIT_NS[candidate] >= 1) ?? "ns";
  return {
    value: formatDisplayNumber(totalNs / DURATION_UNIT_NS[unit]),
    unit,
  };
}

export function countsFromDurationDisplay(value: string, unit: DurationUnit): number {
  const durationNs = finiteNumber(value, 0) * DURATION_UNIT_NS[unit];
  return Math.max(0, Math.round(durationNs / PAM_TIMING_TICK_NS));
}

export function rateDisplayFromGapCounts(gapCounts: number): UnitDisplay<RateUnit> {
  const safeGapCounts = positiveCount(gapCounts);
  const hz = PAM_TIMING_CLOCK_HZ / safeGapCounts;
  const units: RateUnit[] = ["MHz", "kHz", "Hz"];
  const unit = units.find((candidate) => hz / RATE_UNIT_HZ[candidate] >= 1) ?? "Hz";
  return {
    value: formatDisplayNumber(hz / RATE_UNIT_HZ[unit]),
    unit,
  };
}

export function countsFromRateDisplay(value: string, unit: RateUnit): number {
  const hz = finiteNumber(value, 0) * RATE_UNIT_HZ[unit];
  if (hz <= 0) return 1;
  return Math.max(1, Math.round(PAM_TIMING_CLOCK_HZ / hz));
}

export function laserEndCounts(timing: PamTimingRequirement): number {
  return (
    nonNegativeInteger(timing.galvo_settle_time) +
    nonNegativeInteger(timing.ld_trigger_time) +
    positiveCount(timing.ld_time)
  );
}

export function adcCaptureEndCounts(timing: PamTimingRequirement): number {
  return (
    nonNegativeInteger(timing.galvo_settle_time) +
    nonNegativeInteger(timing.adc_trigger_time) +
    PAM_ADC_CAPTURE_COUNTS
  );
}

export function requiredGapCounts(timing: PamTimingRequirement): number {
  return Math.max(1, laserEndCounts(timing), adcCaptureEndCounts(timing) + PAM_ADC_POST_BUFFER_COUNTS);
}

export function timingDetailEndCounts(timing: PamTimingCounts): number {
  const eventEnd = requiredGapCounts(timing);
  const fullFrameEnd = positiveCount(timing.gap_time);
  if (fullFrameEnd <= eventEnd * 2) {
    return fullFrameEnd;
  }
  return Math.max(eventEnd + 1, Math.ceil(eventEnd * 1.1));
}

export function constrainedTimingCounts(timing: PamTimingCounts, changedField?: PamTimingField): PamTimingCounts {
  const next: PamTimingCounts = {
    gap_time: positiveCount(timing.gap_time),
    galvo_settle_time: Math.max(PAM_GALVO_SETTLE_MIN_COUNTS, nonNegativeInteger(timing.galvo_settle_time)),
    ld_trigger_time: nonNegativeInteger(timing.ld_trigger_time),
    adc_trigger_time: nonNegativeInteger(timing.adc_trigger_time),
    ld_time: positiveCount(timing.ld_time),
  };

  if (changedField === "gap_time" || changedField === "repetition_rate") {
    next.gap_time = Math.max(next.gap_time, requiredGapCounts(next));
  }

  const minimumEventBudget = Math.max(1, PAM_ADC_CAPTURE_COUNTS + PAM_ADC_POST_BUFFER_COUNTS);
  next.gap_time = Math.max(next.gap_time, PAM_GALVO_SETTLE_MIN_COUNTS + minimumEventBudget);
  next.galvo_settle_time = clamp(
    next.galvo_settle_time,
    PAM_GALVO_SETTLE_MIN_COUNTS,
    Math.max(PAM_GALVO_SETTLE_MIN_COUNTS, next.gap_time - minimumEventBudget),
  );
  const eventBudget = Math.max(0, next.gap_time - next.galvo_settle_time);
  next.ld_time = clamp(next.ld_time, 1, Math.max(1, eventBudget));
  next.ld_trigger_time = clamp(next.ld_trigger_time, 0, Math.max(0, eventBudget - next.ld_time));
  next.adc_trigger_time = clamp(next.adc_trigger_time, 0, Math.max(0, eventBudget - PAM_ADC_CAPTURE_COUNTS - PAM_ADC_POST_BUFFER_COUNTS));
  next.gap_time = Math.max(next.gap_time, requiredGapCounts(next));

  return next;
}

export function scanModeInfo(mode: unknown): { value: 0 | 1; label: string; detail: string } {
  const value = Number(mode) === 1 ? 1 : 0;
  return value === 1
    ? {
        value,
        label: "Serpentine",
        detail: "Alternate rows.",
      }
    : {
        value,
        label: "Flyback",
        detail: "Return each row.",
      };
}

export function returnModeInfo(mode: unknown): { value: 0 | 1; label: string; detail: string } {
  const value = Number(mode) === 1 ? 1 : 0;
  return value === 1
    ? {
        value,
        label: "Start",
        detail: "Park at x_start / y_start.",
      }
    : {
        value,
        label: "Center",
        detail: "Park at the scan center.",
      };
}
