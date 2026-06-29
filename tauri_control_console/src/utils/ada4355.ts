export const DEFAULT_TZ_OHM = 2000;
export const ADA4355_ZERO_CURRENT_ADC_VOLTAGE = 0.825;
export const ADA4355_ADC_FULL_SCALE_VOLTAGE = 1.0;
export const DEFAULT_PD_ZERO_ADC_CODE = Math.round((ADA4355_ZERO_CURRENT_ADC_VOLTAGE / ADA4355_ADC_FULL_SCALE_VOLTAGE) * 0x8000);
export const ADA4355_SATURATION_SIGNED_CODE = 29300;
export const ADA4355_SATURATION_CODE_TOLERANCE = 128;
export const ADA_FILTER_RAW_USE_FILTERED = 1 << 2;
export const ADA_FILTER_RAW_GLITCH_REJECT = 1 << 5;
export type AdaSaturationState = "negative";

type AdaFilterReadback = {
  control?: unknown;
  raw_use_filtered?: unknown;
  raw_glitch_reject?: unknown;
};

export type AdaFilterPayload = {
  control?: number;
  threshold?: number;
  lp_shift?: number;
  raw_lp_shift?: number;
  enable?: boolean;
  glitch_reject?: boolean;
  raw_glitch_reject?: boolean;
  raw_filtered?: boolean;
  spectrum_filtered?: boolean;
  monitor_filtered?: boolean;
};

export function adaRawCaptureFilterPayload({
  threshold,
  rawLpShift,
  rawGlitchEnabled,
  rawFilterEnabled,
}: {
  threshold: number;
  rawLpShift: number;
  rawGlitchEnabled: boolean;
  rawFilterEnabled: boolean;
}): AdaFilterPayload {
  return {
    threshold,
    raw_lp_shift: rawLpShift,
    enable: true,
    glitch_reject: false,
    raw_glitch_reject: rawGlitchEnabled,
    raw_filtered: rawFilterEnabled,
  };
}

export function adaLiveSpectrumLpFilterPayload(lpShift: number): AdaFilterPayload {
  const normalized = Number.isFinite(lpShift) ? lpShift : 0;
  return {
    lp_shift: Math.max(0, Math.floor(normalized)),
    enable: true,
    glitch_reject: false,
    spectrum_filtered: true,
    monitor_filtered: true,
  };
}

export function normalizeTzOhm(tzOhm: number | undefined): number {
  return typeof tzOhm === "number" && Number.isFinite(tzOhm) && tzOhm > 0 ? tzOhm : DEFAULT_TZ_OHM;
}

export function normalizePdZeroAdcCode(zeroAdcCode: number | undefined): number {
  return typeof zeroAdcCode === "number" && Number.isFinite(zeroAdcCode)
    ? Math.max(-0x8000, Math.min(0x7fff, Math.round(zeroAdcCode)))
    : DEFAULT_PD_ZERO_ADC_CODE;
}

function filterControlBitReadback(filter: AdaFilterReadback | undefined, bit: number): boolean | undefined {
  return typeof filter?.control === "number" ? Boolean(filter.control & bit) : undefined;
}

export function adaRawFilterReadback(filter: AdaFilterReadback | undefined): boolean | undefined {
  if (typeof filter?.raw_use_filtered === "boolean") return filter.raw_use_filtered;
  return filterControlBitReadback(filter, ADA_FILTER_RAW_USE_FILTERED);
}

export function adaRawMedianReadback(filter: AdaFilterReadback | undefined): boolean | undefined {
  if (typeof filter?.raw_glitch_reject === "boolean") return filter.raw_glitch_reject;
  return filterControlBitReadback(filter, ADA_FILTER_RAW_GLITCH_REJECT);
}

export function adcCodeToSignedCode(code: number): number {
  const raw = Math.max(0, Math.min(0xffff, Math.round(code))) & 0xffff;
  return raw >= 0x8000 ? raw - 0x10000 : raw;
}

export function averageSignedAdcCode(samples: number[]): number | undefined {
  if (samples.length === 0) return undefined;
  let sum = 0;
  let count = 0;
  samples.forEach((sample) => {
    if (!Number.isFinite(sample)) return;
    sum += adcCodeToSignedCode(sample);
    count += 1;
  });
  return count > 0 ? Math.round(sum / count) : undefined;
}

export function signedAdcCodeToRawCode(code: number): number {
  const signed = Math.max(-0x8000, Math.min(0x7fff, Math.round(code)));
  return signed < 0 ? signed + 0x10000 : signed;
}

export function adcCodeToVoltage(code: number): number {
  return (adcCodeToSignedCode(code) / 0x8000) * ADA4355_ADC_FULL_SCALE_VOLTAGE;
}

export function signedAdcCodeToVoltage(code: number): number {
  const signed = Math.max(-0x8000, Math.min(0x7fff, Math.round(code)));
  return (signed / 0x8000) * ADA4355_ADC_FULL_SCALE_VOLTAGE;
}

export function voltageToAdcCode(voltage: number): number {
  const clamped = Math.max(-ADA4355_ADC_FULL_SCALE_VOLTAGE, Math.min(ADA4355_ADC_FULL_SCALE_VOLTAGE, voltage));
  const signed = Math.max(-0x8000, Math.min(0x7fff, Math.round((clamped / ADA4355_ADC_FULL_SCALE_VOLTAGE) * 0x8000)));
  return signedAdcCodeToRawCode(signed);
}

export function adcCodeToInputCurrentMicroamp(code: number, tzOhm = DEFAULT_TZ_OHM, zeroAdcCode = DEFAULT_PD_ZERO_ADC_CODE): number {
  const tz = normalizeTzOhm(tzOhm);
  return ((signedAdcCodeToVoltage(normalizePdZeroAdcCode(zeroAdcCode)) - adcCodeToVoltage(code)) / tz) * 1_000_000;
}

export function inputCurrentMicroampToAdcCode(currentMicroamp: number, tzOhm = DEFAULT_TZ_OHM, zeroAdcCode = DEFAULT_PD_ZERO_ADC_CODE): number {
  const tz = normalizeTzOhm(tzOhm);
  const voltage = signedAdcCodeToVoltage(normalizePdZeroAdcCode(zeroAdcCode)) - (currentMicroamp / 1_000_000) * tz;
  return voltageToAdcCode(voltage);
}

export function inputCurrentMicroampToSignedAdcCode(
  currentMicroamp: number,
  tzOhm = DEFAULT_TZ_OHM,
  zeroAdcCode = DEFAULT_PD_ZERO_ADC_CODE,
): number {
  return adcCodeToSignedCode(inputCurrentMicroampToAdcCode(currentMicroamp, tzOhm, zeroAdcCode));
}

export function adaSaturationState(code: number, threshold = ADA4355_SATURATION_SIGNED_CODE): AdaSaturationState | undefined {
  const signed = adcCodeToSignedCode(code);
  const limit = Math.max(1, Math.min(0x8000, Math.round(threshold - ADA4355_SATURATION_CODE_TOLERANCE)));
  if (signed <= -limit) return "negative";
  return undefined;
}

export function formatAdcCodeSigned(code: number): string {
  return String(adcCodeToSignedCode(code));
}

export function formatAdcCodeDetail(code: number): string {
  const raw = Math.max(0, Math.min(0xffff, Math.round(code))) & 0xffff;
  return `raw ${raw} / 0x${raw.toString(16).toUpperCase().padStart(4, "0")}`;
}

export function formatAdaSaturation(state: AdaSaturationState | undefined): string {
  if (state === "negative") return "negative rail";
  return "linear";
}

export function formatMicroamp(value: number): string {
  if (!Number.isFinite(value)) return "--";
  if (Math.abs(value) >= 100) return value.toFixed(0);
  if (Math.abs(value) >= 10) return value.toFixed(1);
  return value.toFixed(2);
}
