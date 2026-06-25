import { describe, expect, it } from "vitest";
import { samplesCsv, spectrumCsv } from "../utils/csv";
import { adcCodeToInputCurrentMicroamp } from "../utils/ada4355";
import type { Spectrum } from "../api/types";

describe("CSV helpers", () => {
  it("exports raw ADC samples with photodiode current", () => {
    expect(samplesCsv([0xffff, 0xfffd], 1_000_000)).toBe(
      "index,time_us,adc_code,pd_current_uA\n" +
        `0,0.000000,65535,${adcCodeToInputCurrentMicroamp(0xffff, 2000).toFixed(6)}\n` +
        `1,1.000000,65533,${adcCodeToInputCurrentMicroamp(0xfffd, 2000).toFixed(6)}\n`,
    );
  });

  it("exports spectrum points with raw ADC code and photodiode current", () => {
    const spectrum: Spectrum = {
      buffer_id: 0,
      frame_counter: 1,
      slow_index: 0,
      count: 1,
      duration_ms: 0,
      dt_us_per_point: 0,
      points: [0xfffe],
    };
    expect(spectrumCsv(spectrum)).toBe(
      "index,time_ms,adc_code,pd_current_uA,relative_intensity\n" +
        `0,0.000000,65534,${adcCodeToInputCurrentMicroamp(0xfffe, 2000).toFixed(6)},1\n`,
    );
  });

  it("applies a photodiode current offset to exported currents", () => {
    const expectedCurrent = (adcCodeToInputCurrentMicroamp(0xffff, 2000) - 519).toFixed(6);

    expect(samplesCsv([0xffff], 1_000_000, 2000, 519)).toBe(
      "index,time_us,adc_code,pd_current_uA\n" +
        `0,0.000000,65535,${expectedCurrent}\n`,
    );
  });
});
