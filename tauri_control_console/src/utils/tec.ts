import type { TecStatus } from "../api/types";

const TEC_RUNNING_FLAGS = new Set(["closed_loop", "tec_enabled"]);
const TEC_FAULT_FLAGS = new Set(["fault_latched", "spi_error", "rdy_timeout_error", "temperature_range_error"]);
const TEC_WARNING_FLAGS = new Set<string>();

export type TecStatusLevel = "off" | "ok" | "warn" | "fault";

export type TecStatusSummary = {
  level: TecStatusLevel;
  label: string;
  detail: string;
};

export type TemperatureStats = {
  count: number;
  min: number | undefined;
  max: number | undefined;
  peakToPeak: number | undefined;
  rmsNoise: number | undefined;
};

export function isTecRunning(flags?: string[]): boolean {
  return Boolean(flags?.some((flag) => TEC_RUNNING_FLAGS.has(flag)));
}

function parseStatusHex(text?: string): number {
  if (!text) return 0;
  const value = Number.parseInt(text, 16);
  return Number.isFinite(value) ? value : 0;
}

export function classifyTecStatus(tec?: Pick<TecStatus, "status_flags" | "error_flags" | "main_error_status" | "main_error_status_hex">): TecStatusSummary {
  const flags = new Set(tec?.status_flags ?? []);
  const mainError = tec?.main_error_status ?? parseStatusHex(tec?.main_error_status_hex);

  if (mainError !== 0 || (tec?.error_flags?.length ?? 0) > 0 || [...TEC_FAULT_FLAGS].some((flag) => flags.has(flag))) {
    return { level: "fault", label: "Fault", detail: "Fatal TEC fault" };
  }

  if (!isTecRunning(tec?.status_flags)) {
    return { level: "off", label: "Off", detail: "TEC output disabled" };
  }

  if (
    [...TEC_WARNING_FLAGS].some((flag) => flags.has(flag)) ||
    !flags.has("id_check_pass") ||
    !flags.has("adc_sample_valid") ||
    !flags.has("temperature_valid")
  ) {
    return { level: "warn", label: "Warning", detail: "TEC running with non-fatal warning" };
  }

  return { level: "ok", label: "Normal", detail: "TEC loop running" };
}

export function temperatureStats(values: number[]): TemperatureStats {
  const finite = values.filter((value) => Number.isFinite(value));
  if (finite.length === 0) {
    return { count: 0, min: undefined, max: undefined, peakToPeak: undefined, rmsNoise: undefined };
  }
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  const mean = finite.reduce((sum, value) => sum + value, 0) / finite.length;
  const variance = finite.reduce((sum, value) => sum + (value - mean) ** 2, 0) / finite.length;
  return {
    count: finite.length,
    min,
    max,
    peakToPeak: max - min,
    rmsNoise: Math.sqrt(variance),
  };
}
