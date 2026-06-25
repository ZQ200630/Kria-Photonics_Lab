import type { Spectrum } from "../api/types";
import { DEFAULT_TZ_OHM, adcCodeToInputCurrentMicroamp } from "./ada4355";

export type SpectrumRecordRow = {
  recordIndex: number;
  frameCounter: number;
  pointIndex: number;
  timeMs: number;
  relativeIntensity: number;
  rawAdc: number;
  pdCurrentMicroamp: number;
};

export type RecordedSpectrumFrame = {
  recordIndex: number;
  frameCounter: number;
  rows: SpectrumRecordRow[];
};

export type SpectrumRecordingState = {
  frames: RecordedSpectrumFrame[];
  lastFrameCounter?: number;
  lastAcceptedAtMs?: number;
};

export type AppendSpectrumOptions = {
  nowMs: number;
  minIntervalMs: number;
  tzOhm?: number;
  currentOffsetMicroamp?: number;
};

export function createSpectrumRecordRows(
  spectrum: Spectrum,
  recordIndex: number,
  tzOhm = DEFAULT_TZ_OHM,
  currentOffsetMicroamp = 0,
): SpectrumRecordRow[] {
  const dtMs = spectrum.count > 1 ? spectrum.duration_ms / (spectrum.count - 1) : 0;
  return spectrum.points.map((word, pointIndex) => {
    const rawAdc = word & 0xffff;
    return {
      recordIndex,
      frameCounter: spectrum.frame_counter,
      pointIndex,
      timeMs: pointIndex * dtMs,
      relativeIntensity: Math.max(0, 0xffff - rawAdc),
      rawAdc,
      pdCurrentMicroamp: adcCodeToInputCurrentMicroamp(rawAdc, tzOhm, currentOffsetMicroamp),
    };
  });
}

export function appendSpectrumFrame(
  state: SpectrumRecordingState,
  spectrum: Spectrum,
  options: AppendSpectrumOptions,
): SpectrumRecordingState {
  if (state.lastFrameCounter === spectrum.frame_counter) return state;

  if (
    typeof state.lastAcceptedAtMs === "number" &&
    options.minIntervalMs > 0 &&
    options.nowMs - state.lastAcceptedAtMs < options.minIntervalMs
  ) {
    return state;
  }

  const recordIndex = state.frames.length;
  return {
    frames: [
      ...state.frames,
      {
        recordIndex,
        frameCounter: spectrum.frame_counter,
        rows: createSpectrumRecordRows(spectrum, recordIndex, options.tzOhm, options.currentOffsetMicroamp),
      },
    ],
    lastFrameCounter: spectrum.frame_counter,
    lastAcceptedAtMs: options.nowMs,
  };
}

export function recordedSpectrumCsv(frames: RecordedSpectrumFrame[]): string {
  const lines = ["record_index,frame_counter,point_index,time_ms,relative_intensity,raw_adc,pd_current_uA"];
  frames.forEach((frame) => {
    frame.rows.forEach((row) => {
      lines.push(
        [
          row.recordIndex,
          row.frameCounter,
          row.pointIndex,
          row.timeMs.toFixed(6),
          row.relativeIntensity,
          row.rawAdc,
          row.pdCurrentMicroamp.toFixed(6),
        ].join(","),
      );
    });
  });
  return `${lines.join("\n")}\n`;
}
