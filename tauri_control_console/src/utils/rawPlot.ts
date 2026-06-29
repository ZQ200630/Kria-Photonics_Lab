import { adaSaturationState, adcCodeToInputCurrentMicroamp, type AdaSaturationState } from "./ada4355";

export type SourceIndexRange = {
  startIndex: number;
  endIndex: number;
};

export type PlotPoint = {
  xIndex: number;
  value: number;
};

export type SaturationWindow = SourceIndexRange & {
  color: string;
  borderColor: string;
};

const SATURATION_STYLE: Record<AdaSaturationState, { color: string; borderColor: string }> = {
  negative: { color: "rgba(239, 68, 68, 0.16)", borderColor: "rgba(220, 38, 38, 0.65)" },
};

export function normalizeIndexRange(startIndex: number, endIndex: number, count: number): SourceIndexRange {
  const maxIndex = Math.max(0, count - 1);
  const first = Math.max(0, Math.min(maxIndex, Math.round(Math.min(startIndex, endIndex))));
  const last = Math.max(0, Math.min(maxIndex, Math.round(Math.max(startIndex, endIndex))));
  return { startIndex: first, endIndex: last };
}

export function saturationWindowsForRawSamples(samples: number[], range?: SourceIndexRange): SaturationWindow[] {
  if (samples.length === 0) return [];
  const normalized = range ? normalizeIndexRange(range.startIndex, range.endIndex, samples.length) : { startIndex: 0, endIndex: samples.length - 1 };
  const windows: SaturationWindow[] = [];
  let activeState: AdaSaturationState | undefined;
  let activeStart = -1;

  const closeWindow = (endIndex: number) => {
    if (!activeState || activeStart < 0) return;
    const style = SATURATION_STYLE[activeState];
    windows.push({ startIndex: activeStart, endIndex, ...style });
    activeState = undefined;
    activeStart = -1;
  };

  for (let index = normalized.startIndex; index <= normalized.endIndex; index += 1) {
    const state = adaSaturationState(samples[index] & 0xffff);
    if (state === activeState) continue;
    closeWindow(index - 1);
    if (state) {
      activeState = state;
      activeStart = index;
    }
  }
  closeWindow(normalized.endIndex);
  return windows;
}

export function rawVisibleCurrentValues(
  samples: number[],
  range: SourceIndexRange,
  tzOhm: number,
  zeroAdcCode: number,
): number[] {
  if (samples.length === 0) return [];
  const normalized = normalizeIndexRange(range.startIndex, range.endIndex, samples.length);
  const values: number[] = [];
  for (let index = normalized.startIndex; index <= normalized.endIndex; index += 1) {
    values.push(adcCodeToInputCurrentMicroamp(samples[index] & 0xffff, tzOhm, zeroAdcCode));
  }
  return values;
}

export function paddedRangeForValues(values: number[], marginFraction = 0.1): { min: number; max: number } | undefined {
  let min = Infinity;
  let max = -Infinity;
  let finiteCount = 0;
  for (const value of values) {
    if (!Number.isFinite(value)) continue;
    finiteCount += 1;
    if (value < min) min = value;
    if (value > max) max = value;
  }
  if (finiteCount === 0) return undefined;
  const margin = max > min ? (max - min) * marginFraction : 1;
  return { min: min - margin, max: max + margin };
}

export function downsampleEnvelope(values: number[], maxPoints: number, startIndex = 0): PlotPoint[] {
  const limit = Math.max(1, Math.floor(maxPoints));
  if (values.length <= limit) {
    return values.map((value, index) => ({ xIndex: startIndex + index, value }));
  }

  const bucketCount = Math.max(1, Math.floor(limit / 2));
  const bucketSize = values.length / bucketCount;
  const points: PlotPoint[] = [];

  for (let bucket = 0; bucket < bucketCount; bucket += 1) {
    const bucketStart = Math.floor(bucket * bucketSize);
    const bucketEnd = Math.min(values.length, Math.floor((bucket + 1) * bucketSize));
    if (bucketEnd <= bucketStart) continue;

    let minIndex = bucketStart;
    let maxIndex = bucketStart;
    for (let index = bucketStart + 1; index < bucketEnd; index += 1) {
      if (values[index] < values[minIndex]) minIndex = index;
      if (values[index] > values[maxIndex]) maxIndex = index;
    }

    const ordered = minIndex <= maxIndex ? [minIndex, maxIndex] : [maxIndex, minIndex];
    ordered.forEach((index) => {
      const last = points[points.length - 1];
      const point = { xIndex: startIndex + index, value: values[index] };
      if (!last || last.xIndex !== point.xIndex || last.value !== point.value) points.push(point);
    });
  }

  return points;
}
