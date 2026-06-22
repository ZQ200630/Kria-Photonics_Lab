import { parseNumber } from "./format";

export function rampEnabledInput(enabled: boolean | undefined): string | undefined {
  if (enabled === undefined) return undefined;
  return enabled ? "yes" : "no";
}

export function makeTecRampPayload(target: string, enabled: string, rate: string, intervalMs: string) {
  return {
    celsius: Number(target),
    enabled: enabled !== "no",
    rate_c_per_s: Number(rate),
    interval_ms: parseNumber(intervalMs),
  };
}
