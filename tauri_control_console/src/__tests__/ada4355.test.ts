import { describe, expect, it } from "vitest";
import {
  DEFAULT_PD_CURRENT_OFFSET_MICROAMP,
  adcCodeToInputCurrentMicroamp,
  adcCodeToVoltage,
  inputCurrentMicroampToAdcCode,
  voltageToAdcCode,
} from "../utils/ada4355";

describe("ADA4355 current conversion", () => {
  it("maps unsigned ADC code to the assumed +/-1 V ADC input range", () => {
    expect(adcCodeToVoltage(0)).toBeCloseTo(-1, 6);
    expect(adcCodeToVoltage(0xffff)).toBeCloseTo(1, 6);
  });

  it("round trips the 0 uA bias point for a 2 kohm transimpedance", () => {
    const code = inputCurrentMicroampToAdcCode(0, 2000);
    expect(adcCodeToInputCurrentMicroamp(code, 2000)).toBeCloseTo(0, 2);
  });

  it("uses the ADA4355 inverse transfer direction", () => {
    expect(adcCodeToInputCurrentMicroamp(voltageToAdcCode(-0.825), 2000)).toBeCloseTo(825, 1);
    expect(adcCodeToInputCurrentMicroamp(voltageToAdcCode(1), 2000)).toBeCloseTo(-87.5, 1);
  });

  it("subtracts the configured dark-current offset and keeps the reverse mapping aligned", () => {
    expect(DEFAULT_PD_CURRENT_OFFSET_MICROAMP).toBe(519);

    const darkCode = inputCurrentMicroampToAdcCode(0, 2000, DEFAULT_PD_CURRENT_OFFSET_MICROAMP);
    expect(adcCodeToInputCurrentMicroamp(darkCode, 2000, DEFAULT_PD_CURRENT_OFFSET_MICROAMP)).toBeCloseTo(0, 2);
    expect(adcCodeToInputCurrentMicroamp(0xffff, 2000, DEFAULT_PD_CURRENT_OFFSET_MICROAMP)).toBeCloseTo(-606.5, 1);
  });
});
