import { describe, expect, it } from "vitest";
import {
  DEFAULT_PD_ZERO_ADC_CODE,
  adaLiveSpectrumLpFilterPayload,
  adaRawCaptureFilterPayload,
  adaRawFilterReadback,
  adaRawMedianReadback,
  adaSaturationState,
  adcCodeToSignedCode,
  adcCodeToInputCurrentMicroamp,
  adcCodeToVoltage,
  averageSignedAdcCode,
  formatAdcCodeDetail,
  formatAdcCodeSigned,
  inputCurrentMicroampToAdcCode,
  inputCurrentMicroampToSignedAdcCode,
  normalizePdZeroAdcCode,
  voltageToAdcCode,
} from "../utils/ada4355";

describe("ADA4355 current conversion", () => {
  it("maps raw ADC code as signed int16 to the assumed +/-1 V ADC input range", () => {
    expect(adcCodeToSignedCode(0)).toBe(0);
    expect(adcCodeToSignedCode(0x7fff)).toBe(32767);
    expect(adcCodeToSignedCode(0x8000)).toBe(-32768);
    expect(adcCodeToSignedCode(0xffff)).toBe(-1);
    expect(adcCodeToVoltage(0)).toBeCloseTo(0, 6);
    expect(adcCodeToVoltage(0x8000)).toBeCloseTo(-1, 6);
    expect(adcCodeToVoltage(0x7fff)).toBeCloseTo(1, 4);
  });

  it("round trips the 0 uA bias point for a 2 kohm transimpedance", () => {
    const code = inputCurrentMicroampToAdcCode(0, 2000);
    expect(adcCodeToInputCurrentMicroamp(code, 2000)).toBeCloseTo(0, 1);
  });

  it("uses the ADA4355 inverse transfer direction", () => {
    expect(adcCodeToInputCurrentMicroamp(voltageToAdcCode(-0.825), 2000)).toBeCloseTo(825, 1);
    expect(adcCodeToInputCurrentMicroamp(voltageToAdcCode(1), 2000)).toBeCloseTo(-87.5, 1);
  });

  it("defaults the zero-current reference to the ADA4355 0.825 V code", () => {
    expect(DEFAULT_PD_ZERO_ADC_CODE).toBe(27034);
    expect(adcCodeToInputCurrentMicroamp(DEFAULT_PD_ZERO_ADC_CODE, 2000)).toBeCloseTo(0, 1);
  });

  it("uses the configured zero ADC code before transimpedance scaling", () => {
    const measuredDarkCode = 29620;
    expect(normalizePdZeroAdcCode(measuredDarkCode)).toBe(measuredDarkCode);
    expect(adcCodeToInputCurrentMicroamp(measuredDarkCode, 2000, measuredDarkCode)).toBeCloseTo(0, 6);
    expect(adcCodeToInputCurrentMicroamp(measuredDarkCode, 20000, measuredDarkCode)).toBeCloseTo(0, 6);
    expect(inputCurrentMicroampToAdcCode(0, 2000, measuredDarkCode)).toBe(measuredDarkCode);
    expect(inputCurrentMicroampToAdcCode(0, 20000, measuredDarkCode)).toBe(measuredDarkCode);
  });

  it("formats raw ADC codes with signed value first and raw detail preserved", () => {
    expect(formatAdcCodeSigned(0x8dd3)).toBe("-29229");
    expect(formatAdcCodeDetail(0x8dd3)).toBe("raw 36307 / 0x8DD3");
    expect(formatAdcCodeSigned(29620)).toBe("29620");
    expect(formatAdcCodeDetail(29620)).toBe("raw 29620 / 0x73B4");
  });

  it("formats current-derived axis ticks as signed ADC codes", () => {
    expect(inputCurrentMicroampToSignedAdcCode(0, 2000)).toBeGreaterThan(0);
    expect(inputCurrentMicroampToSignedAdcCode(85.85, 20000)).toBeLessThan(0);
  });

  it("averages raw ADC samples in signed-code space for zero calibration", () => {
    expect(averageSignedAdcCode([29619, 29620, 29621])).toBe(29620);
    expect(averageSignedAdcCode([0x8dd3, 0x8dd5])).toBe(-29228);
    expect(averageSignedAdcCode([])).toBeUndefined();
  });

  it("marks only the negative empirical current rail at about -29300 signed codes", () => {
    expect(adaSaturationState(0x8dd3)).toBe("negative");
    expect(adaSaturationState(0x8dd6)).toBe("negative");
    expect(adaSaturationState(29300)).toBeUndefined();
    expect(adaSaturationState(29620)).toBeUndefined();
    expect(adaSaturationState(29171)).toBeUndefined();
  });

  it("decodes raw filter and median readback from FILTER_CONTROL when explicit fields are absent", () => {
    expect(adaRawFilterReadback({ control: 0x3d })).toBe(true);
    expect(adaRawMedianReadback({ control: 0x3d })).toBe(true);
    expect(adaRawFilterReadback({ control: 0x19 })).toBe(false);
    expect(adaRawMedianReadback({ control: 0x19 })).toBe(false);
  });

  it("prefers explicit raw filter and median fields over FILTER_CONTROL compatibility bits", () => {
    expect(adaRawFilterReadback({ raw_use_filtered: false, control: 0x3d })).toBe(false);
    expect(adaRawMedianReadback({ raw_glitch_reject: false, control: 0x3d })).toBe(false);
  });

  it("keeps raw capture filter updates decoupled from monitor, spectrum, and global glitch source bits", () => {
    const payload = adaRawCaptureFilterPayload({
      threshold: 3000,
      rawLpShift: 13,
      rawGlitchEnabled: true,
      rawFilterEnabled: false,
    });

    expect(payload).toEqual({
      threshold: 3000,
      raw_lp_shift: 13,
      enable: true,
      glitch_reject: false,
      raw_glitch_reject: true,
      raw_filtered: false,
    });
    expect(payload).not.toHaveProperty("spectrum_filtered");
    expect(payload).not.toHaveProperty("monitor_filtered");
  });

  it("explicit live spectrum LP updates enable monitor and spectrum filtered source bits", () => {
    const payload = adaLiveSpectrumLpFilterPayload(13.8);

    expect(payload).toEqual({
      lp_shift: 13,
      enable: true,
      glitch_reject: false,
      spectrum_filtered: true,
      monitor_filtered: true,
    });
  });
});
