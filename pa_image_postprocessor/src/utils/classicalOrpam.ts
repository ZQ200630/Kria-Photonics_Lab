export type ClassicalPipelineConfig = {
  medianBaselineEnabled: boolean;
  bandpassEnabled: boolean;
  hilbertEnvelopeEnabled: boolean;
};

export type ClassicalOrpamConfig = {
  sampleIntervalNs: number;
  sampleStartIndex: number;
  sampleEndTrim: number;
  baselineStartNs: number;
  baselineEndNs: number;
  processingStartNs: number;
  processingEndNs: number;
  outputStartNs: number;
  outputEndNs: number;
  bandpassLowHz: number;
  bandpassHighHz: number;
  filterOrder: number;
  soundSpeedMS: number;
  t0S: number;
  relativeDepth: boolean;
  tzOhm: number;
  vfs: number;
  zeroAdcCode: number;
  chunkRows: number;
  saveFilteredRf: boolean;
  umPerCount: number;
  pipeline: ClassicalPipelineConfig;
};

export type ClassicalConfigPreview = {
  validSampleCount: number;
  sourceStartIndex: number;
  sourceEndIndex: number;
  outputSampleCount: number;
  samplingRateHz: number;
  nyquistHz: number;
  depthSampleSpacingUm: number;
  depthStartUm: number;
  depthEndUm: number;
  shapeYxz: [number, number, number];
  envelopeBytes: number;
  filteredRfBytes: number;
};

export type ClassicalConfigValidation = {
  preview: ClassicalConfigPreview | null;
  errors: string[];
};

export const DEFAULT_CLASSICAL_ORPAM_CONFIG: ClassicalOrpamConfig = {
  sampleIntervalNs: 8,
  sampleStartIndex: 10,
  sampleEndTrim: 50,
  baselineStartNs: 248,
  baselineEndNs: 1104,
  processingStartNs: 0,
  processingEndNs: 8000,
  outputStartNs: 1544,
  outputEndNs: 5088,
  bandpassLowHz: 500_000,
  bandpassHighHz: 25_000_000,
  filterOrder: 4,
  soundSpeedMS: 1500,
  t0S: 0,
  relativeDepth: true,
  tzOhm: 2000,
  vfs: 1,
  zeroAdcCode: 27034,
  chunkRows: 8,
  saveFilteredRf: false,
  umPerCount: 0.1325,
  pipeline: {
    medianBaselineEnabled: true,
    bandpassEnabled: true,
    hilbertEnvelopeEnabled: true,
  },
};

function finitePositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function windowIndices(
  label: string,
  startNs: number,
  endNs: number,
  intervalNs: number,
  validSampleCount: number,
  errors: string[],
): [number, number] | null {
  if (!Number.isFinite(startNs) || !Number.isFinite(endNs) || startNs < 0 || endNs <= startNs) {
    errors.push(`${label} window must be finite, non-negative and increasing.`);
    return null;
  }
  const start = Math.ceil(startNs / intervalNs);
  const end = Math.ceil(endNs / intervalNs);
  if (start >= end || end > validSampleCount) {
    errors.push(`${label} window maps to [${start},${end}) outside valid trace [0,${validSampleCount}).`);
    return null;
  }
  return [start, end];
}

export function validateClassicalOrpamConfig(
  config: ClassicalOrpamConfig,
  sampleCount: number,
  width: number,
  height: number,
): ClassicalConfigValidation {
  const errors: string[] = [];
  if (!finitePositive(config.sampleIntervalNs)) errors.push("Sample interval must be finite and positive.");
  const safeSampleCount = Math.max(0, Math.floor(sampleCount));
  const sampleStartIndex = Math.floor(config.sampleStartIndex);
  const sampleEndTrim = Math.floor(config.sampleEndTrim);
  if (sampleStartIndex < 0 || sampleStartIndex >= safeSampleCount) {
    errors.push("Sample start index must be inside the source waveform.");
  }
  if (sampleEndTrim < 0 || sampleEndTrim >= safeSampleCount - Math.max(0, sampleStartIndex)) {
    errors.push("End trim leaves an empty valid trace.");
  }
  if (!finitePositive(config.tzOhm)) errors.push("Transimpedance must be finite and positive.");
  if (!Number.isFinite(config.vfs) || !Number.isFinite(config.zeroAdcCode)) {
    errors.push("VFS and zero ADC code must be finite.");
  }
  if (!finitePositive(config.soundSpeedMS)) errors.push("Sound speed must be finite and positive.");
  if (!Number.isFinite(config.t0S)) errors.push("t0 must be finite.");
  if (!finitePositive(config.umPerCount)) errors.push("X/Y calibration must be finite and positive.");
  if (!Number.isInteger(config.chunkRows) || config.chunkRows < 1) errors.push("Chunk rows must be at least 1.");
  if (!Number.isInteger(width) || width < 1 || !Number.isInteger(height) || height < 1) {
    errors.push("A validated non-empty X/Y grid is required.");
  }
  if (errors.length > 0 || !finitePositive(config.sampleIntervalNs)) return { preview: null, errors };

  const sourceEndIndex = safeSampleCount - sampleEndTrim;
  const validSampleCount = sourceEndIndex - sampleStartIndex;
  const baseline = windowIndices(
    "Baseline",
    config.baselineStartNs,
    config.baselineEndNs,
    config.sampleIntervalNs,
    validSampleCount,
    errors,
  );
  const processing = windowIndices(
    "Processing",
    config.processingStartNs,
    config.processingEndNs,
    config.sampleIntervalNs,
    validSampleCount,
    errors,
  );
  const output = windowIndices(
    "Output",
    config.outputStartNs,
    config.outputEndNs,
    config.sampleIntervalNs,
    validSampleCount,
    errors,
  );
  void baseline;
  const samplingRateHz = 1e9 / config.sampleIntervalNs;
  const nyquistHz = samplingRateHz / 2;
  if (config.pipeline.bandpassEnabled) {
    if (!Number.isInteger(config.filterOrder) || config.filterOrder < 1) {
      errors.push("Butterworth order must be at least 1.");
    }
    if (
      !finitePositive(config.bandpassLowHz) ||
      !finitePositive(config.bandpassHighHz) ||
      config.bandpassHighHz <= config.bandpassLowHz ||
      config.bandpassHighHz >= nyquistHz
    ) {
      errors.push(`Band-pass must satisfy 0 < low < high < Nyquist (${nyquistHz.toLocaleString()} Hz).`);
    }
  }
  if (processing && output && (output[0] < processing[0] || output[1] > processing[1])) {
    errors.push("Output window must be contained in the processing window.");
  }
  if (errors.length > 0 || !output) return { preview: null, errors };

  const outputSampleCount = output[1] - output[0];
  const depthSampleSpacingUm = config.soundSpeedMS * config.sampleIntervalNs * 1e-3;
  const depthAt = (index: number) => config.soundSpeedMS * (index * config.sampleIntervalNs * 1e-9 - config.t0S) * 1e6;
  const firstDepth = depthAt(output[0]);
  const coordinate = (index: number) => depthAt(index) - (config.relativeDepth ? firstDepth : 0);
  const voxelCount = width * height * outputSampleCount;
  const envelopeBytes = voxelCount * 4;
  return {
    preview: {
      validSampleCount,
      sourceStartIndex: sampleStartIndex,
      sourceEndIndex,
      outputSampleCount,
      samplingRateHz,
      nyquistHz,
      depthSampleSpacingUm,
      depthStartUm: coordinate(output[0]),
      depthEndUm: coordinate(output[1] - 1),
      shapeYxz: [height, width, outputSampleCount],
      envelopeBytes,
      filteredRfBytes: config.saveFilteredRf ? envelopeBytes : 0,
    },
    errors,
  };
}

function numberAt(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function configFromAdjacentMetadata(
  base: ClassicalOrpamConfig,
  metadata: unknown,
): { config: ClassicalOrpamConfig; source: string } {
  if (!metadata || typeof metadata !== "object") return { config: base, source: "application default" };
  const record = metadata as Record<string, unknown>;
  const processing = record.processing && typeof record.processing === "object"
    ? record.processing as Record<string, unknown>
    : {};
  const calibration = record.calibration && typeof record.calibration === "object"
    ? record.calibration as Record<string, unknown>
    : {};
  return {
    config: {
      ...base,
      sampleIntervalNs: numberAt(processing.sampleIntervalNs, base.sampleIntervalNs),
      sampleStartIndex: numberAt(processing.sampleStartIndex, base.sampleStartIndex),
      sampleEndTrim: numberAt(processing.sampleEndTrim, base.sampleEndTrim),
      baselineStartNs: numberAt(processing.baselineStartNs, base.baselineStartNs),
      baselineEndNs: numberAt(processing.baselineEndNs, base.baselineEndNs),
      outputStartNs: numberAt(processing.ptpStartNs, base.outputStartNs),
      outputEndNs: numberAt(processing.ptpEndNs, base.outputEndNs),
      tzOhm: numberAt(processing.tzOhm, base.tzOhm),
      vfs: numberAt(processing.vfs, base.vfs),
      zeroAdcCode: numberAt(processing.zeroAdcCode, base.zeroAdcCode),
      umPerCount: numberAt(calibration.um_per_count, base.umPerCount),
    },
    source: "adjacent metadata.json",
  };
}

export function classicalDisplayValues(
  values: Array<number | null>,
  scale: "linear" | "db",
  dynamicRangeDb: number,
): Array<number | null> {
  if (scale === "linear") return values;
  const finite = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value > 0);
  const peak = finite.length > 0 ? Math.max(...finite) : 0;
  const floor = -Math.max(1, Number.isFinite(dynamicRangeDb) ? dynamicRangeDb : 40);
  return values.map((value) => {
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || peak <= 0) return floor;
    return Math.max(floor, 20 * Math.log10(value / peak));
  });
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "--";
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GiB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${Math.round(bytes)} B`;
}
