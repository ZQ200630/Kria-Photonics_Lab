export type LevelCrossing = {
  index: number;
  leftIndex: number;
  rightIndex: number;
  value: number;
};

export type PlotRange = {
  min: number;
  max: number;
};

export type SlidingFrameMatch = {
  shift: number;
  score: number;
  compared: number;
};

type SlidingFrameMatchOptions = {
  maxSamples?: number;
};

type NudgeOptions = {
  min?: number;
  max?: number;
  digits?: number;
};

function clamp(value: number, min?: number, max?: number): number {
  let next = value;
  if (typeof min === "number" && Number.isFinite(min)) next = Math.max(min, next);
  if (typeof max === "number" && Number.isFinite(max)) next = Math.min(max, next);
  return next;
}

export function findLevelCrossings(values: number[], level: number): LevelCrossing[] {
  if (!Number.isFinite(level) || values.length === 0) return [];

  const crossings: LevelCrossing[] = [];
  const add = (index: number, leftIndex: number, rightIndex: number) => {
    const previous = crossings[crossings.length - 1];
    if (previous && Math.abs(previous.index - index) < 1e-9) return;
    crossings.push({ index, leftIndex, rightIndex, value: level });
  };

  for (let i = 0; i < values.length - 1; i += 1) {
    const a = values[i] - level;
    const b = values[i + 1] - level;
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;

    if (a === 0) add(i, i, i);
    if (a === 0 && b === 0) continue;
    if (a === 0 || b === 0) {
      if (b === 0) add(i + 1, i + 1, i + 1);
      continue;
    }
    if ((a < 0 && b > 0) || (a > 0 && b < 0)) {
      const fraction = Math.abs(a) / (Math.abs(a) + Math.abs(b));
      add(i + fraction, i, i + 1);
    }
  }

  const last = values[values.length - 1] - level;
  if (last === 0) add(values.length - 1, values.length - 1, values.length - 1);
  return crossings;
}

export function nudgeNumberText(valueText: string, stepText: string, direction: number, options: NudgeOptions = {}): string {
  const current = Number(valueText);
  const step = Math.abs(Number(stepText));
  const delta = Number.isFinite(step) ? step * Math.sign(direction || 0) : 0;
  const base = Number.isFinite(current) ? current : 0;
  const next = clamp(base + delta, options.min, options.max);

  if (typeof options.digits === "number" && Number.isFinite(options.digits)) {
    return next.toFixed(Math.max(0, Math.trunc(options.digits)));
  }
  return String(next);
}

export function relativeIntensityToRawAdc(relativeIntensity: number): number {
  const relative = Number.isFinite(relativeIntensity) ? relativeIntensity : 0;
  return Math.round(clamp(0xffff - relative, 0, 0xffff));
}

export function scanCodeAtSpectrumIndex(index: number, count: number, startCode: number, stopCode: number): number {
  const safeCount = Number.isFinite(count) ? Math.max(1, Math.round(count)) : 1;
  const fraction = safeCount <= 1 ? 0 : clamp(index / (safeCount - 1), 0, 1);
  const start = Number.isFinite(startCode) ? startCode : 0;
  const stop = Number.isFinite(stopCode) ? stopCode : start;
  return Math.round(clamp(start + (stop - start) * fraction, 0, 0xffff));
}

export function scanIndexAtCode(code: number, count: number, startCode: number, stopCode: number): number {
  const safeCount = Number.isFinite(count) ? Math.max(1, Math.round(count)) : 1;
  if (safeCount <= 1 || startCode === stopCode) return 0;
  const fraction = clamp((code - startCode) / (stopCode - startCode), 0, 1);
  return Math.round(fraction * (safeCount - 1));
}

export function searchHalfspanToIndexSpan(halfspanCode: number, startCode: number, stopCode: number, count: number): number {
  const safeCount = Number.isFinite(count) ? Math.max(1, Math.round(count)) : 1;
  const codeSpan = Math.abs(stopCode - startCode);
  const halfspan = Math.abs(Number.isFinite(halfspanCode) ? halfspanCode : 0);
  if (safeCount <= 1 || codeSpan <= 0 || halfspan <= 0) return 0;
  return Math.round((halfspan / codeSpan) * (safeCount - 1));
}

export function paddedRangeForSeries(series: number[][], marginFraction = 0.1): PlotRange {
  const values = series.flat().filter((value) => Number.isFinite(value));
  if (values.length === 0) return { min: 0, max: 1 };
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max > min ? max - min : Math.max(1, Math.abs(max));
  const margin = span * Math.max(0, marginFraction);
  return { min: min - margin, max: max + margin };
}

export function normalizeLevelForSeries(level: number | undefined, values: number[]): number | undefined {
  const finiteValues = values.filter((value) => Number.isFinite(value));
  if (finiteValues.length === 0) return level;
  const min = Math.min(...finiteValues);
  const max = Math.max(...finiteValues);
  const midpoint = (min + max) / 2;
  if (typeof level !== "number" || !Number.isFinite(level)) return midpoint;
  if (level < min || level > max) return midpoint;
  return level;
}

function pearsonScore(reference: number[], current: number[], shift: number, maxSamples: number): { score: number; compared: number } {
  let compared = 0;
  let sumA = 0;
  let sumB = 0;
  let sumAA = 0;
  let sumBB = 0;
  let sumAB = 0;

  const stride = Math.max(1, Math.ceil(current.length / Math.max(1, maxSamples)));
  for (let index = 0; index < current.length; index += stride) {
    const b = current[index];
    const referenceIndex = index + shift;
    if (referenceIndex < 0 || referenceIndex >= reference.length) continue;
    const a = reference[referenceIndex];
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    compared += 1;
    sumA += a;
    sumB += b;
    sumAA += a * a;
    sumBB += b * b;
    sumAB += a * b;
  }

  if (compared < 3) return { score: -Infinity, compared };
  const numerator = compared * sumAB - sumA * sumB;
  const denomA = compared * sumAA - sumA * sumA;
  const denomB = compared * sumBB - sumB * sumB;
  const denominator = Math.sqrt(Math.max(0, denomA) * Math.max(0, denomB));
  if (denominator <= 0) return { score: -Infinity, compared };
  return { score: numerator / denominator, compared };
}

export function estimateSlidingFrameMatch(
  reference: number[],
  current: number[],
  maxShift = 512,
  options: SlidingFrameMatchOptions = {},
): SlidingFrameMatch {
  const boundedShift = Math.max(0, Math.round(Math.abs(maxShift)));
  const maxSamples = Math.max(16, Math.round(options.maxSamples ?? 768));
  let best: SlidingFrameMatch = { shift: 0, score: -Infinity, compared: 0 };

  for (let shift = -boundedShift; shift <= boundedShift; shift += 1) {
    const result = pearsonScore(reference, current, shift, maxSamples);
    if (result.score > best.score || (result.score === best.score && result.compared > best.compared)) {
      best = { shift, score: result.score, compared: result.compared };
    }
  }

  if (!Number.isFinite(best.score)) return { shift: 0, score: 0, compared: 0 };
  return best;
}

export function inferPolarityInvertForMarker(values: number[], crossing: LevelCrossing, startCode: number, stopCode: number): boolean {
  if (values.length < 2 || startCode === stopCode) return false;

  let left = crossing.leftIndex;
  let right = crossing.rightIndex;
  if (left === right) {
    left = Math.max(0, Math.floor(crossing.index) - 1);
    right = Math.min(values.length - 1, Math.ceil(crossing.index) + 1);
  }
  left = Math.max(0, Math.min(values.length - 1, left));
  right = Math.max(0, Math.min(values.length - 1, right));
  if (left === right) return false;

  const leftRaw = relativeIntensityToRawAdc(values[left]);
  const rightRaw = relativeIntensityToRawAdc(values[right]);
  const leftCode = scanCodeAtSpectrumIndex(left, values.length, startCode, stopCode);
  const rightCode = scanCodeAtSpectrumIndex(right, values.length, startCode, stopCode);
  const rawDelta = rightRaw - leftRaw;
  const codeDelta = rightCode - leftCode;
  if (codeDelta === 0 || rawDelta === 0) return false;

  return rawDelta * codeDelta < 0;
}
