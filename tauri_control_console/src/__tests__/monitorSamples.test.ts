import { describe, expect, it } from "vitest";
import {
  appendBoundedMonitorSample,
  monitorModeWindows,
  monitorRecordingWindow,
  monitorRecordingWindows,
  statusEventToMonitorSample,
  statusToMonitorSample,
} from "../utils/monitorSamples";
import type { SystemStatus } from "../api/types";

describe("monitor sample helpers", () => {
  it("converts status events into combined PD and temperature monitor samples", () => {
    const status: SystemStatus = {
      tec: {
        temperature_filtered_celsius: 31.2,
        temperature_measured_celsius: 31.25,
        target_celsius: 31.5,
        error_celsius: 0.3,
        active_dac_code: 2048,
        adc_raw_ch0: 12345,
      },
      laser: {
        status_flags: ["laser_enable", "lock_active"],
        lock: {
          target_adc: 42000,
          error: -12,
          output_ch1_internal: 26001,
        },
      },
      ada4355: {
        monitor_avg: 19157,
        monitor_min: 19140,
        monitor_max: 19180,
      },
    };

    expect(statusToMonitorSample(10.02, status)).toEqual({
      t: 10.02,
      temp: 31.2,
      tempMeasured: 31.25,
      target: 31.5,
      error: 0.3,
      dac: 2048,
      tecRaw: 12345,
      pd: 19157,
      pdMin: 19140,
      pdMax: 19180,
      lockTarget: 42000,
      lockError: -12,
      lockOutputCh1: 26001,
      laserMode: "lock",
    });
  });

  it("stores the laser output mode on each monitor sample", () => {
    const base: SystemStatus = { tec: {}, laser: {}, ada4355: { monitor_avg: 19000 } };

    expect(statusToMonitorSample(1, { ...base, laser: { status_flags: ["laser_enable"] } })).toMatchObject({ laserMode: "static" });
    expect(statusToMonitorSample(2, { ...base, laser: { status_flags: ["laser_enable", "scan_active"] } })).toMatchObject({
      laserMode: "scan",
    });
    expect(statusToMonitorSample(3, { ...base, laser: { status_flags: ["laser_enable", "lock_active"] } })).toMatchObject({
      laserMode: "lock",
    });
  });

  it("keeps a bounded 50 Hz monitor history without mutating the existing array", () => {
    const existing = [{ t: 0 }, { t: 0.02 }];
    const next = appendBoundedMonitorSample(existing, { t: 0.04 }, 2);

    expect(next).toEqual([{ t: 0.02 }, { t: 0.04 }]);
    expect(existing).toEqual([{ t: 0 }, { t: 0.02 }]);
  });

  it("uses the PC receipt time for SSE monitor filtering when the board clock differs", () => {
    const status: SystemStatus = { tec: {}, laser: {}, ada4355: { monitor_avg: 18966 } };

    expect(statusEventToMonitorSample({ timestamp: 1668192872, status }, 1782356342)).toMatchObject({
      t: 1782356342,
      serverTimestamp: 1668192872,
      pd: 18966,
    });
  });

  it("returns the sample index window that is actively being recorded", () => {
    const samples = [{ t: 10, pd: 1 }, { t: 10.02, pd: 2 }, { t: 10.04, pd: 3 }, { t: 10.06, pd: 4 }];

    expect(monitorRecordingWindow(samples, null)).toBeUndefined();
    expect(monitorRecordingWindow(samples, 10.03)).toEqual({ startIndex: 2, endIndex: 3 });
    expect(monitorRecordingWindow(samples, 11)).toBeUndefined();
  });

  it("keeps a completed recording window aligned as visible monitor samples scroll", () => {
    const samples = [
      { t: 10, pd: 1 },
      { t: 10.02, pd: 2 },
      { t: 10.04, pd: 3 },
      { t: 10.06, pd: 4 },
    ];

    expect(monitorRecordingWindow(samples, 10.01, 10.05)).toEqual({ startIndex: 1, endIndex: 2 });
    expect(monitorRecordingWindow(samples.slice(1), 10.01, 10.05)).toEqual({ startIndex: 0, endIndex: 1 });
    expect(monitorRecordingWindow(samples.slice(3), 10.01, 10.05)).toBeUndefined();
  });

  it("returns every visible completed recording window for multiple monitor runs", () => {
    const samples = [
      { t: 10, pd: 1 },
      { t: 10.02, pd: 2 },
      { t: 10.04, pd: 3 },
      { t: 10.06, pd: 4 },
      { t: 10.08, pd: 5 },
      { t: 10.1, pd: 6 },
      { t: 10.12, pd: 7 },
    ];

    expect(
      monitorRecordingWindows(samples, [
        { startedAt: 9, finishedAt: 9.5 },
        { startedAt: 10.01, finishedAt: 10.05 },
        { startedAt: 10.07, finishedAt: 10.11 },
      ]),
    ).toEqual([
      { startIndex: 1, endIndex: 2 },
      { startIndex: 4, endIndex: 5 },
    ]);
  });

  it("groups visible monitor samples into laser mode windows", () => {
    expect(
      monitorModeWindows([
        { t: 1, pd: 1, laserMode: "static" },
        { t: 2, pd: 2, laserMode: "static" },
        { t: 3, pd: 3, laserMode: "scan" },
        { t: 4, pd: 4, laserMode: "lock" },
        { t: 5, pd: 5, laserMode: "lock" },
        { t: 6, pd: 6, laserMode: "off" },
        { t: 7, pd: 7, laserMode: "scan" },
      ]),
    ).toEqual([
      { startIndex: 0, endIndex: 1, mode: "static" },
      { startIndex: 2, endIndex: 2, mode: "scan" },
      { startIndex: 3, endIndex: 4, mode: "lock" },
      { startIndex: 6, endIndex: 6, mode: "scan" },
    ]);
  });
});
