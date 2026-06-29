import { DEFAULT_PD_ZERO_ADC_CODE, DEFAULT_TZ_OHM, adcCodeToInputCurrentMicroamp } from "./ada4355";
import type { MonitorSample } from "./monitorSamples";

export type RecordingSpectrumFrame = {
  values: number[];
  count: number;
  durationMs?: number;
  frameCounter?: number;
};

export type RecordingTrendSample = MonitorSample;

export type ExperimentFile = {
  path: string;
  contents: string;
};

function finiteNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function csvNumber(value: unknown, digits = 6): string {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(digits) : "";
}

function laserModeLabel(mode: MonitorSample["laserMode"]): string {
  if (mode === "static") return "Static";
  if (mode === "scan") return "Scan";
  if (mode === "lock") return "Locking";
  if (mode === "off") return "Off";
  if (mode === "fault") return "Fault";
  return "";
}

function adcFromRelative(relative: number): number {
  return Math.max(0, Math.min(0xffff, Math.round(0xffff - relative)));
}

export function ch1CurrentMilliamp(code: number): number {
  return (Math.max(0, Math.min(0xffff, code)) * 10.0) / 65535.0;
}

function pdCurrentMicroamp(adcCode: number, tzOhm: number, zeroAdcCode: number): number {
  return adcCodeToInputCurrentMicroamp(adcCode, tzOhm, zeroAdcCode);
}

export function codeAtIndex(index: number, count: number, startCode: number, stopCode: number): number {
  if (count <= 1) return Math.round(startCode);
  const fraction = Math.max(0, Math.min(1, index / (count - 1)));
  return Math.round(startCode + (stopCode - startCode) * fraction);
}

export function spectrumFrameCsv(
  frame: RecordingSpectrumFrame,
  startCode: number,
  stopCode: number,
  tzOhm = DEFAULT_TZ_OHM,
  zeroAdcCode = DEFAULT_PD_ZERO_ADC_CODE,
): string {
  const lines = ["ch1_current_mA,pd_current_uA,ch1_code,adc_count,relative_intensity,index,time_ms"];
  const count = Math.max(1, frame.count || frame.values.length);
  const durationMs = finiteNumber(frame.durationMs, 0);
  const dtMs = count > 1 ? durationMs / (count - 1) : 0;
  frame.values.forEach((relative, index) => {
    const code = codeAtIndex(index, count, startCode, stopCode);
    const adc = adcFromRelative(relative);
    lines.push(
      [
        ch1CurrentMilliamp(code).toFixed(6),
        pdCurrentMicroamp(adc, tzOhm, zeroAdcCode).toFixed(6),
        code,
        adc,
        Math.round(relative),
        index,
        (index * dtMs).toFixed(6),
      ].join(","),
    );
  });
  return `${lines.join("\n")}\n`;
}

export function spectrumFramesCsv(
  frames: RecordingSpectrumFrame[],
  startCode: number,
  stopCode: number,
  tzOhm = DEFAULT_TZ_OHM,
  zeroAdcCode = DEFAULT_PD_ZERO_ADC_CODE,
): string {
  const lines = ["ch1_current_mA,pd_current_uA,record_index,frame_counter,index,time_ms,ch1_code,adc_count,relative_intensity"];
  frames.forEach((frame, recordIndex) => {
    const count = Math.max(1, frame.count || frame.values.length);
    const durationMs = finiteNumber(frame.durationMs, 0);
    const dtMs = count > 1 ? durationMs / (count - 1) : 0;
    frame.values.forEach((relative, index) => {
      const code = codeAtIndex(index, count, startCode, stopCode);
      const adc = adcFromRelative(relative);
      lines.push(
        [
          ch1CurrentMilliamp(code).toFixed(6),
          pdCurrentMicroamp(adc, tzOhm, zeroAdcCode).toFixed(6),
          recordIndex,
          frame.frameCounter ?? "",
          index,
          (index * dtMs).toFixed(6),
          code,
          adc,
          Math.round(relative),
        ].join(","),
      );
    });
  });
  return `${lines.join("\n")}\n`;
}

export function lockSweepPartialCsv(
  frame: RecordingSpectrumFrame,
  startCode: number,
  stopCode: number,
  maxIndex: number,
  referenceOffset = 0,
  tzOhm = DEFAULT_TZ_OHM,
  zeroAdcCode = DEFAULT_PD_ZERO_ADC_CODE,
): string {
  const lines = ["ch1_current_mA,pd_current_uA,ch1_code,adc_count,relative_intensity,current_index,reference_index,time_ms"];
  const count = Math.max(1, frame.count || frame.values.length);
  const durationMs = finiteNumber(frame.durationMs, 0);
  const dtMs = count > 1 ? durationMs / (count - 1) : 0;
  const limit = Math.max(0, Math.min(frame.values.length - 1, Math.round(maxIndex)));
  for (let index = 0; index <= limit; index += 1) {
    const relative = frame.values[index];
    const code = codeAtIndex(index, count, startCode, stopCode);
    const adc = adcFromRelative(relative);
    lines.push(
      [
        ch1CurrentMilliamp(code).toFixed(6),
        pdCurrentMicroamp(adc, tzOhm, zeroAdcCode).toFixed(6),
        code,
        adc,
        Math.round(relative),
        index,
        index + referenceOffset,
        (index * dtMs).toFixed(6),
      ].join(","),
    );
  }
  return `${lines.join("\n")}\n`;
}

export function trendWindow(samples: RecordingTrendSample[], lockTime: number, preSeconds: number, postSeconds: number): RecordingTrendSample[] {
  const start = lockTime - Math.max(0, finiteNumber(preSeconds, 0));
  const end = lockTime + Math.max(0, finiteNumber(postSeconds, 0));
  return samples.filter((sample) => sample.t >= start && sample.t <= end);
}

export function preLockPdValues(samples: RecordingTrendSample[], lockTime: number, preSeconds: number): number[] {
  return trendWindow(samples, lockTime, preSeconds, 0)
    .map((sample) => sample.pd)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
}

export function monitorCsv(samples: RecordingTrendSample[], lockTime: number, tzOhm = DEFAULT_TZ_OHM, zeroAdcCode = DEFAULT_PD_ZERO_ADC_CODE): string {
  const lines = ["relative_time_s,timestamp_s,laser_mode,pd_adc,pd_current_uA,temp_filtered_c,temp_measured_c,temp_target_c,temp_error_c,tec_dac_code,tec_raw_adc"];
  samples.forEach((sample) => {
    const pd = typeof sample.pd === "number" && Number.isFinite(sample.pd) ? sample.pd : undefined;
    lines.push(
      [
        (sample.t - lockTime).toFixed(6),
        sample.t.toFixed(6),
        laserModeLabel(sample.laserMode),
        pd ?? "",
        pd === undefined ? "" : pdCurrentMicroamp(pd, tzOhm, zeroAdcCode).toFixed(6),
        csvNumber(sample.temp),
        csvNumber(sample.tempMeasured),
        csvNumber(sample.target),
        csvNumber(sample.error),
        sample.dac ?? "",
        sample.tecRaw ?? "",
      ].join(","),
    );
  });
  return `${lines.join("\n")}\n`;
}

export function lockStatusCsv(samples: RecordingTrendSample[], lockTime: number, tzOhm = DEFAULT_TZ_OHM, zeroAdcCode = DEFAULT_PD_ZERO_ADC_CODE): string {
  const lines = ["relative_time_s,timestamp_s,target_adc,lock_error,output_ch1_code,pd_adc,pd_current_uA"];
  samples.forEach((sample) => {
    const pd = typeof sample.pd === "number" && Number.isFinite(sample.pd) ? sample.pd : undefined;
    lines.push(
      [
        (sample.t - lockTime).toFixed(6),
        sample.t.toFixed(6),
        sample.lockTarget ?? "",
        sample.lockError ?? "",
        sample.lockOutputCh1 ?? "",
        pd ?? "",
        pd === undefined ? "" : pdCurrentMicroamp(pd, tzOhm, zeroAdcCode).toFixed(6),
      ].join(","),
    );
  });
  return `${lines.join("\n")}\n`;
}

export function safeRunName(name: string, fallback = "lock_experiment"): string {
  const cleaned = name
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return cleaned || fallback;
}
