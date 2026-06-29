import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App, {
  resolvePaImagingPanelState,
  resolvePanelState,
  runBackgroundUiUpdate,
  shouldPrimeInitialSpectrum,
  type PaImagingPanelStateCache,
} from "../App";
import type { AppState } from "../state/store";

const storage: Record<string, string> = {};

describe("App tab lifecycle", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage[key] ?? null,
      setItem: (key: string, value: string) => {
        storage[key] = value;
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    Object.keys(storage).forEach((key) => delete storage[key]);
  });

  it("keeps tab panels mounted so local page state survives tab switches", () => {
    const html = renderToStaticMarkup(<App />);

    expect(html).toContain('class="tab-panels"');
    expect(html).toContain('data-tab="Monitor"');
    expect(html).not.toContain('data-tab="Overview"');
    expect(html).toContain('data-tab="Lock"');
    expect(html).toContain('data-tab="ADA"');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain("<h2>Monitor</h2>");
    expect(html).toContain("Temperature Monitor");
    expect(html).toContain("PD Monitor");
    expect(html).not.toContain("Spectrum Monitor");
    expect(html).toContain("retained");
    expect(html).toContain("displayed");
    expect(html).toContain("<h2>Side-Fringe Lock</h2>");
    expect(html).toContain("<h2>Photodiode / ADA4355</h2>");
    expect(html).toContain("PD Zero ADC Code");
    expect(html).toContain("ADA4355 Gain / Tz");
    expect(html).toContain("2 kOhm");
    expect(html).toContain("20 kOhm");
    expect(html).toContain("200 kOhm");
    expect(html).toContain("Analog Low-pass");
    expect(html).toContain("1 MHz");
    expect(html).toContain("100 MHz");
    expect(html).toContain("LP Shift");
    expect(html).not.toContain("Spectrum/Monitor LP Shift");
    expect(html).toContain('value="27034"');
    expect(html).not.toContain("Tz Ohm");
  });

  it("keeps hidden tab props stable by reusing the last state cached for that tab", () => {
    const cache: Partial<Record<"Monitor" | "TEC", { id: string }>> = {};
    const monitorState = { id: "monitor-visible" };
    const latestState = { id: "latest" };

    expect(resolvePanelState("Monitor", "Monitor", monitorState, cache)).toBe(monitorState);
    expect(resolvePanelState("Monitor", "TEC", latestState, cache)).toBe(monitorState);
    expect(resolvePanelState("TEC", "Monitor", latestState, cache)).toBe(latestState);
    expect(resolvePanelState("TEC", "Monitor", { id: "newer" }, cache)).toBe(latestState);
  });

  it("schedules high-rate UI refreshes through a background update scheduler", () => {
    const calls: string[] = [];

    runBackgroundUiUpdate(
      () => calls.push("updated"),
      (update) => {
        calls.push("scheduled");
        update();
      },
    );

    expect(calls).toEqual(["scheduled", "updated"]);
  });

  it("keeps PA Imaging panel state stable across unrelated status updates", () => {
    const cache: PaImagingPanelStateCache = {};
    const baseState: AppState = {
      backendUrl: "http://127.0.0.1:8080",
      connected: true,
      stale: false,
      lastStatus: {
        tec: { sample_counter: 1 },
        laser: {},
        ada4355: {},
        pa: { connected: true, running: false, last_error: "", frames_sent: 100, expected_frames: 100 },
        pa_scheduler: { mode_name: "Idle", current_x: 1, current_y: 2 },
      },
      lastSpectrum: null,
      selectedLockPoint: null,
      commandLog: [],
      trend: [],
    };

    const projected = resolvePaImagingPanelState(baseState, cache);
    const unrelatedUpdate = resolvePaImagingPanelState(
      {
        ...baseState,
        lastStatus: {
          ...baseState.lastStatus!,
          tec: { sample_counter: 2 },
          ada4355: { frame_counter: 99 },
        },
        commandLog: ["status tick"],
      },
      cache,
    );

    expect(unrelatedUpdate).toBe(projected);
    expect(unrelatedUpdate.lastStatus?.tec).toEqual({});
    expect(unrelatedUpdate.commandLog).toEqual([]);
  });

  it("updates PA Imaging panel state when PA progress changes", () => {
    const cache: PaImagingPanelStateCache = {};
    const state: AppState = {
      backendUrl: "http://127.0.0.1:8080",
      connected: true,
      stale: false,
      lastStatus: {
        tec: {},
        laser: {},
        ada4355: {},
        pa: { connected: true, running: true, last_error: "", frames_sent: 100, expected_frames: 1000 },
        pa_scheduler: { mode_name: "Scan", current_x: 1, current_y: 2 },
      },
      lastSpectrum: null,
      selectedLockPoint: null,
      commandLog: [],
      trend: [],
    };

    const before = resolvePaImagingPanelState(state, cache);
    const after = resolvePaImagingPanelState(
      {
        ...state,
        lastStatus: {
          ...state.lastStatus!,
          pa: { ...state.lastStatus!.pa!, frames_sent: 200 },
        },
      },
      cache,
    );

    expect(after).not.toBe(before);
    expect(after.lastStatus?.pa?.frames_sent).toBe(200);
  });

  it("primes one initial spectrum read when connected before SSE spectrum arrives", () => {
    const state: AppState = {
      backendUrl: "http://127.0.0.1:8080",
      connected: true,
      stale: false,
      lastStatus: { tec: {}, laser: {}, ada4355: {} },
      lastSpectrum: null,
      selectedLockPoint: null,
      commandLog: [],
      trend: [],
    };

    expect(shouldPrimeInitialSpectrum(state, false)).toBe(true);
    expect(shouldPrimeInitialSpectrum({ ...state, connected: false }, false)).toBe(false);
    expect(
      shouldPrimeInitialSpectrum(
        {
          ...state,
          lastSpectrum: { buffer_id: 1, frame_counter: 1, slow_index: 0, count: 1, duration_ms: 1, dt_us_per_point: 1, points: [1] },
        },
        false,
      ),
    ).toBe(false);
    expect(shouldPrimeInitialSpectrum(state, true)).toBe(false);
  });

});
