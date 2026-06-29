import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import LockPanel from "../components/LockPanel";
import type { ApiClient } from "../api/client";
import type { AppState } from "../state/store";

const state: AppState = {
  backendUrl: "http://127.0.0.1:8080",
  connected: true,
  stale: false,
  lastStatus: {
    tec: {
      status_flags: ["closed_loop"],
      target_celsius: 31,
      temp_min_celsius: 20,
      temp_max_celsius: 40,
      ramp: { enabled: true, rate_c_per_s: 0.05, interval_ms: 200 },
    },
    laser: {
      status_flags: ["scan_active"],
      fine_scan_setpoint: {
        ch0_internal: 26000,
        ch1_start_internal: 20000,
        ch1_stop_internal: 30000,
        ch1_step_internal: 10,
        dwell_ticks: 100,
        settle_ticks: 100,
        frames: 1,
      },
      safety: { ch0_min: 0, ch0_max: 40000, ch1_min: 0, ch1_max: 40000 },
      lock: {
        target_adc: 42000,
        bias_ch1_internal: 25000,
        ch1_min_internal: 20000,
        ch1_max_internal: 30000,
      },
      acquire: { supported: true, search_min: 24000, search_max: 26000 },
    },
    ada4355: {},
  },
  lastSpectrum: {
    buffer_id: 0,
    frame_counter: 1,
    slow_index: 0,
    count: 4,
    duration_ms: 3,
    dt_us_per_point: 1000,
    points: [65000, 64000, 63000, 62000],
  },
  selectedLockPoint: null,
  commandLog: [],
  trend: [],
};

const client = {} as ApiClient;
const command = async (_label: string, action: () => Promise<unknown>) => {
  await action();
};

describe("LockPanel layout", () => {
  it("packs spectrum operation controls into two columns and keeps recording under Spectrum View", () => {
    const html = renderToStaticMarkup(<LockPanel state={state} client={client} command={command} />);

    expect(html).toContain('class="operation-grid operation-grid-two-column"');
    expect(html).toContain('class="lock-view-controls lock-spectrum-toolbar"');
    expect(html).toContain("LP Shift");
    expect(html).not.toContain("Gain 2,000 ohm; zero ADC 27034");
    expect(html).not.toContain("Tz Ohm");
    expect(html).toContain('class="lock-method-control lock-method-segmented"');
    expect(html).toContain('class="candidate-counter lock-toolbar-counter"');
    expect(html).toContain('class="recording-controls spectrum-recording-controls lock-data-recorder"');
    expect(html).toContain('<button type="button" class="method-pill active">Board Match Lock</button>');
    expect(html).toContain("<h4>Idle Spectrum</h4>");
    expect(html).toContain("Save Current Spectrum");
    expect(html).toContain("Record Spectra");
    expect(html).toContain("Live PD monitor, latest");
    expect(html).toContain('class="monitor-mode-legend"');
    expect(html).toContain("Static");
    expect(html).toContain("Scan");
    expect(html).toContain("Locking");
    expect(html).toContain("Recorded");
    expect(html).toContain("<h4>Lock Spectrum Pair</h4>");
    expect(html).toContain("Save Lock Spectra");
    expect(html).toContain("<h4>PD + Temperature Monitor</h4>");
    expect(html).toContain("Start Monitor");
    expect(html).toContain("Saves PD and temperature from 50 Hz SSE status");
    expect(html).toContain("<strong>Global Data Root</strong>");
    expect(html).toContain("Stop Locking");
    expect(html).not.toContain("Record Lock Data");

    const spectrumViewIndex = html.indexOf("<h3>Spectrum View</h3>");
    const recordingIndex = html.indexOf("Idle Spectrum");
    const parametersIndex = html.indexOf("<h3>Lock Parameters</h3>");

    expect(spectrumViewIndex).toBeGreaterThan(-1);
    expect(recordingIndex).toBeGreaterThan(spectrumViewIndex);
    expect(recordingIndex).toBeLessThan(parametersIndex);
  });
});
