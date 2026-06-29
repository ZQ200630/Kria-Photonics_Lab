import { describe, expect, it } from "vitest";
import type { SystemStatus } from "../api/types";
import { initialState, reducer } from "../state/store";
import type { MonitorSample } from "../utils/monitorSamples";

describe("app state reducer", () => {
  it("does not clone monitor trend history on each status update", () => {
    const existingTrend: MonitorSample[] = [{ t: 1, temp: 31.2, pd: 29600 }];
    const status: SystemStatus = {
      tec: { temperature_filtered_celsius: 31.3 },
      laser: {},
      ada4355: { monitor_avg: 29590 },
    };
    const state = {
      ...initialState("http://127.0.0.1:8080"),
      trend: existingTrend,
    };

    const next = reducer(state, { type: "status", timestamp: 2, status });

    expect(next.lastStatus).toBe(status);
    expect(next.connected).toBe(true);
    expect(next.stale).toBe(false);
    expect(next.trend).toBe(existingTrend);
  });
});
