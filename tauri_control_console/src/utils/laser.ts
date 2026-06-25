import type { LaserLockStatus, LaserStatus } from "../api/types";

export const LASER_SCAN_CLOCK_HZ = 10_000_000;

export type LaserOutputMode = "off" | "static" | "scan" | "lock" | "fault";
export type LaserStatusLevel = "off" | "ok" | "warn" | "fault";

export type LaserStatusSummary = {
  mode: LaserOutputMode;
  level: LaserStatusLevel;
  label: string;
  detail: string;
};

export type LaserEditableMode = "static" | "scan" | "lock";

export function laserModeEditability(mode: LaserEditableMode, hardwareMode?: LaserOutputMode) {
  if (hardwareMode === "lock") {
    return {
      staticEditable: false,
      scanEditable: false,
      timingEditable: false,
    };
  }
  return {
    staticEditable: mode === "static",
    scanEditable: mode === "scan",
    timingEditable: mode === "scan",
  };
}

function u16Code(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.max(0, Math.min(0xffff, Math.round(value)));
}

export function lockStopStaticCh1Code(
  lock: Pick<LaserLockStatus, "output_ch1_internal" | "bias_ch1_internal"> | undefined,
  fallbackCh1: number,
): number {
  return u16Code(lock?.output_ch1_internal) ?? u16Code(lock?.bias_ch1_internal) ?? u16Code(fallbackCh1) ?? 0;
}

export function classifyLaserStatus(laser?: Pick<LaserStatus, "status_flags" | "fault_flags">): LaserStatusSummary {
  const flags = new Set(laser?.status_flags ?? []);
  const faultFlags = laser?.fault_flags ?? [];

  if (flags.has("fault_latched") || flags.has("error") || faultFlags.length > 0) {
    return { mode: "fault", level: "fault", label: "Fault", detail: "Laser fault latched" };
  }

  if (flags.has("lock_active")) {
    return { mode: "lock", level: "ok", label: "Locking", detail: "Side-fringe lock active" };
  }

  if (flags.has("scan_active") || flags.has("frame_active")) {
    return { mode: "scan", level: "warn", label: "Scanning", detail: "Fine scan active" };
  }

  if (flags.has("laser_enable")) {
    return { mode: "static", level: "ok", label: "Static", detail: "Static current output" };
  }

  return { mode: "off", level: "off", label: "Off", detail: "Laser output disabled" };
}

export function scanPointCount(start: number, stop: number, step: number): number {
  if (!Number.isFinite(start) || !Number.isFinite(stop) || !Number.isFinite(step)) return 0;
  const absStep = Math.abs(Math.trunc(step));
  if (absStep <= 0) return 0;
  return Math.floor(Math.abs(stop - start) / absStep) + 1;
}

export function scanFrequencyHz({
  start,
  stop,
  step,
  dwell,
  settle,
}: {
  start: number;
  stop: number;
  step: number;
  dwell: number;
  settle: number;
}): number | undefined {
  const points = scanPointCount(start, stop, step);
  const ticksPerPoint = Math.max(0, Math.trunc(dwell)) + Math.max(0, Math.trunc(settle));
  if (points <= 0 || ticksPerPoint <= 0) return undefined;
  return LASER_SCAN_CLOCK_HZ / (points * ticksPerPoint);
}

export function scanTicksForFrequency({
  start,
  stop,
  step,
  frequencyHz,
}: {
  start: number;
  stop: number;
  step: number;
  frequencyHz: number;
}): number {
  const points = scanPointCount(start, stop, step);
  const frequency = Number.isFinite(frequencyHz) ? frequencyHz : 0;
  if (points <= 0 || frequency <= 0) return 1;
  return Math.max(1, Math.round(LASER_SCAN_CLOCK_HZ / (points * frequency * 2)));
}
