import { describe, expect, it } from "vitest";
import { classifyLaserStatus, laserModeEditability, scanFrequencyHz, scanTicksForFrequency, scanPointCount } from "../utils/laser";

describe("Laser helpers", () => {
  it("classifies laser output states for overview indicators", () => {
    expect(classifyLaserStatus({ status_flags: [] })).toMatchObject({ level: "off", label: "Off", mode: "off" });
    expect(classifyLaserStatus({ status_flags: ["laser_enable", "output_at_target"] })).toMatchObject({
      level: "ok",
      label: "Static",
      mode: "static",
    });
    expect(classifyLaserStatus({ status_flags: ["laser_enable", "scan_active", "frame_active"] })).toMatchObject({
      level: "warn",
      label: "Scanning",
      mode: "scan",
    });
    expect(classifyLaserStatus({ status_flags: ["laser_enable", "lock_active"] })).toMatchObject({
      level: "ok",
      label: "Locking",
      mode: "lock",
    });
    expect(classifyLaserStatus({ status_flags: ["laser_enable", "fault_latched"], fault_flags: ["ch1_limit"] })).toMatchObject({
      level: "fault",
      label: "Fault",
      mode: "fault",
    });
  });

  it("computes forward scan point count with both endpoints included", () => {
    expect(scanPointCount(20000, 30000, 10)).toBe(1001);
    expect(scanPointCount(30000, 20000, 10)).toBe(1001);
    expect(scanPointCount(20000, 30000, 0)).toBe(0);
  });

  it("computes scan rate from dwell and settle ticks", () => {
    expect(scanFrequencyHz({ start: 20000, stop: 30000, step: 10, dwell: 100, settle: 100 })).toBeCloseTo(49.95005, 5);
  });

  it("computes equal dwell and settle ticks for a requested scan rate", () => {
    expect(scanTicksForFrequency({ start: 20000, stop: 30000, step: 10, frequencyHz: 50 })).toBe(100);
    expect(scanTicksForFrequency({ start: 20000, stop: 30000, step: 10, frequencyHz: 0 })).toBe(1);
  });

  it("disables scan timing edits outside scanning mode", () => {
    expect(laserModeEditability("static")).toEqual({ staticEditable: true, scanEditable: false, timingEditable: false });
    expect(laserModeEditability("scan")).toEqual({ staticEditable: false, scanEditable: true, timingEditable: true });
    expect(laserModeEditability("lock")).toEqual({ staticEditable: false, scanEditable: false, timingEditable: false });
    expect(laserModeEditability("static", "lock")).toEqual({ staticEditable: false, scanEditable: false, timingEditable: false });
    expect(laserModeEditability("scan", "lock")).toEqual({ staticEditable: false, scanEditable: false, timingEditable: false });
  });
});
