export const DEFAULT_TZ_OHM = 2000;
export const DEFAULT_PD_CURRENT_OFFSET_MICROAMP = 519;
export const ADA4355_ZERO_CURRENT_ADC_VOLTAGE = 0.825;
export const ADA4355_ADC_FULL_SCALE_VOLTAGE = 1.0;

export function normalizeTzOhm(tzOhm: number | undefined): number {
  return typeof tzOhm === "number" && Number.isFinite(tzOhm) && tzOhm > 0 ? tzOhm : DEFAULT_TZ_OHM;
}

export function normalizePdCurrentOffsetMicroamp(offsetMicroamp: number | undefined): number {
  return typeof offsetMicroamp === "number" && Number.isFinite(offsetMicroamp) ? offsetMicroamp : DEFAULT_PD_CURRENT_OFFSET_MICROAMP;
}

export function adcCodeToVoltage(code: number): number {
  const clamped = Math.max(0, Math.min(0xffff, Math.round(code)));
  return (clamped / 0xffff) * (2 * ADA4355_ADC_FULL_SCALE_VOLTAGE) - ADA4355_ADC_FULL_SCALE_VOLTAGE;
}

export function voltageToAdcCode(voltage: number): number {
  const clamped = Math.max(-ADA4355_ADC_FULL_SCALE_VOLTAGE, Math.min(ADA4355_ADC_FULL_SCALE_VOLTAGE, voltage));
  return Math.round(((clamped + ADA4355_ADC_FULL_SCALE_VOLTAGE) / (2 * ADA4355_ADC_FULL_SCALE_VOLTAGE)) * 0xffff);
}

export function adcCodeToInputCurrentMicroamp(code: number, tzOhm = DEFAULT_TZ_OHM, currentOffsetMicroamp = 0): number {
  const tz = normalizeTzOhm(tzOhm);
  return ((ADA4355_ZERO_CURRENT_ADC_VOLTAGE - adcCodeToVoltage(code)) / tz) * 1_000_000 - currentOffsetMicroamp;
}

export function inputCurrentMicroampToAdcCode(currentMicroamp: number, tzOhm = DEFAULT_TZ_OHM, currentOffsetMicroamp = 0): number {
  const tz = normalizeTzOhm(tzOhm);
  const rawCurrentMicroamp = currentMicroamp + currentOffsetMicroamp;
  const voltage = ADA4355_ZERO_CURRENT_ADC_VOLTAGE - (rawCurrentMicroamp / 1_000_000) * tz;
  return voltageToAdcCode(voltage);
}

export function formatMicroamp(value: number): string {
  if (!Number.isFinite(value)) return "--";
  if (Math.abs(value) >= 100) return value.toFixed(0);
  if (Math.abs(value) >= 10) return value.toFixed(1);
  return value.toFixed(2);
}
