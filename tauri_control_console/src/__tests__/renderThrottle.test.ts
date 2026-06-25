import { describe, expect, it } from "vitest";
import { flushLatest } from "../utils/renderThrottle";

describe("render throttle helpers", () => {
  it("coalesces a burst of events to the newest pending value", () => {
    const slot: { current: number | null } = { current: null };

    slot.current = 1;
    slot.current = 2;
    slot.current = 3;

    expect(flushLatest(slot)).toBe(3);
    expect(slot.current).toBeNull();
    expect(flushLatest(slot)).toBeNull();
  });
});
