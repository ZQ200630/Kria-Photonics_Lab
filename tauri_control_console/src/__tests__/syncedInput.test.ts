import { describe, expect, it } from "vitest";
import { nextSyncedInputState, nextSyncedInputValue } from "../utils/syncedInput";

describe("synced input helper", () => {
  it("uses hardware readback when the field is not being edited", () => {
    expect(nextSyncedInputValue("31.0", "32.5", false)).toBe("32.5");
  });

  it("keeps the user value while the field is being edited", () => {
    expect(nextSyncedInputValue("32.", "31.000", true)).toBe("32.");
  });

  it("keeps the current value when no hardware readback exists", () => {
    expect(nextSyncedInputValue("0x800", undefined, false)).toBe("0x800");
  });

  it("keeps a dirty user value after blur while readback is stale", () => {
    expect(nextSyncedInputState({ value: "32.0", readbackValue: "31.000", editing: false, dirty: true })).toEqual({
      value: "32.0",
      dirty: true,
    });
  });

  it("clears dirty state when readback catches up to the user value", () => {
    expect(nextSyncedInputState({ value: "32.0", readbackValue: "32.000", editing: false, dirty: true })).toEqual({
      value: "32.000",
      dirty: false,
    });
  });
});
