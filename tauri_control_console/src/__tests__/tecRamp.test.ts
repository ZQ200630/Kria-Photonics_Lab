import { describe, expect, it } from "vitest";
import { makeTecRampPayload, rampEnabledInput } from "../utils/tecRamp";

describe("TEC ramp helpers", () => {
  it("builds a ramp target payload from GUI text fields", () => {
    expect(makeTecRampPayload("32.5", "yes", "0.05", "200")).toEqual({
      celsius: 32.5,
      enabled: true,
      rate_c_per_s: 0.05,
      interval_ms: 200,
    });
  });

  it("formats boolean ramp readback for a synced select", () => {
    expect(rampEnabledInput(true)).toBe("yes");
    expect(rampEnabledInput(false)).toBe("no");
    expect(rampEnabledInput(undefined)).toBeUndefined();
  });
});
