import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadText, samplesCsv, spectrumCsv } from "../utils/csv";
import { adcCodeToInputCurrentMicroamp } from "../utils/ada4355";
import type { Spectrum } from "../api/types";

describe("CSV helpers", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

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

  it("applies a photodiode zero ADC code to exported currents", () => {
    const zeroAdcCode = 29620;
    const expectedCurrent = adcCodeToInputCurrentMicroamp(0xffff, 2000, zeroAdcCode).toFixed(6);

    expect(samplesCsv([0xffff], 1_000_000, 2000, zeroAdcCode)).toBe(
      "index,time_us,adc_code,pd_current_uA\n" +
        `0,0.000000,65535,${expectedCurrent}\n`,
    );
  });

  it("downloads text through an attached link and revokes the object URL after click", () => {
    vi.useFakeTimers();
    const click = vi.fn();
    const link = { href: "", download: "", style: { display: "" }, click };
    const appended: unknown[] = [];
    const removed: unknown[] = [];
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("document", {
      createElement: (tag: string) => {
        expect(tag).toBe("a");
        return link;
      },
      body: {
        appendChild: (node: unknown) => appended.push(node),
        removeChild: (node: unknown) => removed.push(node),
      },
    });
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:download"),
      revokeObjectURL,
    });

    downloadText("manual.md", "# Manual", "text/markdown;charset=utf-8");

    expect(link.href).toBe("blob:download");
    expect(link.download).toBe("manual.md");
    expect(link.style.display).toBe("none");
    expect(appended).toEqual([link]);
    expect(click).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).not.toHaveBeenCalled();

    vi.runAllTimers();

    expect(revokeObjectURL).toHaveBeenCalledWith("blob:download");
    expect(removed).toEqual([link]);
  });
});
