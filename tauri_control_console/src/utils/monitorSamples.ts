import type { StatusEvent, SystemStatus } from "../api/types";
import { classifyLaserStatus, type LaserOutputMode } from "./laser";

export type MonitorSample = {
  t: number;
  laserMode?: LaserOutputMode;
  temp?: number;
  tempMeasured?: number;
  target?: number;
  error?: number;
  dac?: number;
  tecRaw?: number;
  pd?: number;
  pdMin?: number;
  pdMax?: number;
  lockTarget?: number;
  lockError?: number;
  lockOutputCh1?: number;
  serverTimestamp?: number;
};

export type MonitorRecordingWindow = {
  startIndex: number;
  endIndex: number;
};

export type MonitorDisplayMode = Extract<LaserOutputMode, "static" | "scan" | "lock">;

export type MonitorModeWindow = MonitorRecordingWindow & {
  mode: MonitorDisplayMode;
};

export type MonitorRecordingInterval = {
  startedAt: number | null;
  finishedAt?: number | null;
};

export const MONITOR_SAMPLE_HISTORY_LIMIT = 180000;
const MONITOR_SAMPLE_EXACT_TRIM_LIMIT = 64;
const MONITOR_SAMPLE_MAX_TRIM_CHUNK = 4096;

export function statusToMonitorSample(timestamp: number, status: SystemStatus, serverTimestamp?: number): MonitorSample {
  const tec = status.tec;
  const ada = status.ada4355;
  const lock = status.laser?.lock;
  const sample: MonitorSample = {
    t: timestamp,
    laserMode: classifyLaserStatus(status.laser).mode,
    temp: tec.temperature_filtered_celsius ?? tec.temp_filtered_c,
    tempMeasured: tec.temperature_measured_celsius ?? tec.temp_measured_c,
    target: tec.target_celsius ?? tec.target_c,
    error: tec.error_celsius ?? tec.error_c,
    dac: tec.active_dac_code,
    tecRaw: tec.adc_raw_ch0,
    pd: ada.monitor_avg,
    pdMin: ada.monitor_min,
    pdMax: ada.monitor_max,
    lockTarget: lock?.target_adc,
    lockError: lock?.error,
    lockOutputCh1: lock?.output_ch1_internal,
  };
  if (typeof serverTimestamp === "number" && Number.isFinite(serverTimestamp)) {
    sample.serverTimestamp = serverTimestamp;
  }
  return sample;
}

export function statusEventToMonitorSample(event: StatusEvent, receivedAt: number): MonitorSample {
  return statusToMonitorSample(receivedAt, event.status, event.timestamp);
}

export function appendBoundedMonitorSample(
  samples: MonitorSample[],
  sample: MonitorSample,
  limit = MONITOR_SAMPLE_HISTORY_LIMIT,
): MonitorSample[] {
  const safeLimit = Math.max(1, limit);
  if (samples.length >= safeLimit) {
    const trimCount = Math.max(samples.length - safeLimit + 1, monitorSampleTrimCount(safeLimit));
    return [...samples.slice(Math.min(samples.length, trimCount)), sample];
  }
  return [...samples, sample];
}

function monitorSampleTrimCount(limit: number): number {
  if (limit <= MONITOR_SAMPLE_EXACT_TRIM_LIMIT) return 1;
  return Math.max(1, Math.min(MONITOR_SAMPLE_MAX_TRIM_CHUNK, Math.floor(limit * 0.05)));
}

export function pushBoundedMonitorSample(
  samples: MonitorSample[],
  sample: MonitorSample,
  limit = MONITOR_SAMPLE_HISTORY_LIMIT,
): MonitorSample[] {
  const safeLimit = Math.max(1, limit);
  samples.push(sample);
  if (samples.length > safeLimit) {
    const excess = samples.length - safeLimit;
    samples.splice(0, Math.max(excess, monitorSampleTrimCount(safeLimit)));
  }
  return samples;
}

function monitorDisplayMode(mode: LaserOutputMode | undefined): MonitorDisplayMode | undefined {
  return mode === "static" || mode === "scan" || mode === "lock" ? mode : undefined;
}

export function monitorModeWindows(samples: MonitorSample[]): MonitorModeWindow[] {
  const windows: MonitorModeWindow[] = [];
  let currentMode: MonitorDisplayMode | undefined;
  let startIndex = -1;

  const finishWindow = (endIndex: number) => {
    if (currentMode && startIndex >= 0 && endIndex >= startIndex) {
      windows.push({ startIndex, endIndex, mode: currentMode });
    }
  };

  samples.forEach((sample, index) => {
    const mode = monitorDisplayMode(sample.laserMode);
    if (!mode) {
      finishWindow(index - 1);
      currentMode = undefined;
      startIndex = -1;
      return;
    }
    if (mode !== currentMode) {
      finishWindow(index - 1);
      currentMode = mode;
      startIndex = index;
    }
  });

  finishWindow(samples.length - 1);
  return windows;
}

export function monitorRecordingWindow(
  samples: MonitorSample[],
  startedAt: number | null,
  finishedAt?: number | null,
): MonitorRecordingWindow | undefined {
  if (typeof startedAt !== "number" || !Number.isFinite(startedAt) || samples.length === 0) return undefined;
  const hasFinishedAt = typeof finishedAt === "number" && Number.isFinite(finishedAt);
  if (hasFinishedAt && finishedAt < startedAt) return undefined;

  const startIndex = samples.findIndex((sample) => typeof sample.t === "number" && Number.isFinite(sample.t) && sample.t >= startedAt);
  if (startIndex < 0) return undefined;

  if (!hasFinishedAt) {
    return { startIndex, endIndex: samples.length - 1 };
  }

  let endIndex = -1;
  for (let index = samples.length - 1; index >= 0; index -= 1) {
    const sampleTime = samples[index].t;
    if (typeof sampleTime === "number" && Number.isFinite(sampleTime) && sampleTime <= finishedAt) {
      endIndex = index;
      break;
    }
  }

  if (endIndex < startIndex) return undefined;
  return { startIndex, endIndex };
}

export function monitorRecordingWindows(
  samples: MonitorSample[],
  intervals: MonitorRecordingInterval[],
): MonitorRecordingWindow[] {
  return intervals.reduce<MonitorRecordingWindow[]>((windows, interval) => {
    const window = monitorRecordingWindow(samples, interval.startedAt, interval.finishedAt);
    if (window) windows.push(window);
    return windows;
  }, []);
}
