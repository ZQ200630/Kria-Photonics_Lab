import { describe, expect, it } from "vitest";
import type { Spectrum } from "../api/types";
import { appendSpectrumFrame, recordedSpectrumCsv } from "../utils/spectrumRecording";

function makeSpectrum(frame: number, points = [0xfffe, 0x8000]): Spectrum {
  return {
    buffer_id: frame % 2,
    frame_counter: frame,
    slow_index: 0,
    count: points.length,
    duration_ms: 1,
    dt_us_per_point: points.length > 1 ? 1000 / (points.length - 1) : 0,
    points,
  };
}

describe("spectrum recording helpers", () => {
  it("records rows with frame and point metadata", () => {
    const state = appendSpectrumFrame({ frames: [], lastFrameCounter: undefined, lastAcceptedAtMs: undefined }, makeSpectrum(7), {
      nowMs: 100,
      minIntervalMs: 0,
    });

    expect(state.frames).toHaveLength(1);
    expect(state.frames[0].rows).toEqual([
      { recordIndex: 0, frameCounter: 7, pointIndex: 0, timeMs: 0, relativeIntensity: 1, rawAdc: 0xfffe },
      { recordIndex: 0, frameCounter: 7, pointIndex: 1, timeMs: 1, relativeIntensity: 32767, rawAdc: 0x8000 },
    ]);
  });

  it("skips duplicate frames and frames faster than the requested refresh interval", () => {
    let state = appendSpectrumFrame({ frames: [], lastFrameCounter: undefined, lastAcceptedAtMs: undefined }, makeSpectrum(1), {
      nowMs: 100,
      minIntervalMs: 50,
    });
    state = appendSpectrumFrame(state, makeSpectrum(1), { nowMs: 200, minIntervalMs: 50 });
    state = appendSpectrumFrame(state, makeSpectrum(2), { nowMs: 120, minIntervalMs: 50 });
    state = appendSpectrumFrame(state, makeSpectrum(3), { nowMs: 151, minIntervalMs: 50 });

    expect(state.frames.map((frame) => frame.frameCounter)).toEqual([1, 3]);
  });

  it("exports one CSV containing all recorded frames", () => {
    let state = appendSpectrumFrame({ frames: [], lastFrameCounter: undefined, lastAcceptedAtMs: undefined }, makeSpectrum(1, [0xffff]), {
      nowMs: 0,
      minIntervalMs: 0,
    });
    state = appendSpectrumFrame(state, makeSpectrum(2, [0xfffd]), { nowMs: 1, minIntervalMs: 0 });

    expect(recordedSpectrumCsv(state.frames)).toBe(
      "record_index,frame_counter,point_index,time_ms,relative_intensity,raw_adc\n" +
        "0,1,0,0.000000,0,65535\n" +
        "1,2,0,0.000000,2,65533\n",
    );
  });
});
