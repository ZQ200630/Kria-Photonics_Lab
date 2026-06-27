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
};

export function signedAdcCodeToCurrentMicroamp(code: number, tzOhm = 2000, vfs = 1): number {
  const signed = Math.max(-32768, Math.min(32767, Math.round(code)));
  const vAdc = (signed / 32768) * vfs;
  return ((0.825 - vAdc) / Math.max(1, tzOhm)) * 1_000_000;
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
