import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import AdaPanel from "../components/AdaPanel";
import type { ApiClient } from "../api/client";
import type { AppState } from "../state/store";

const state: AppState = {
  backendUrl: "http://127.0.0.1:8080",
  connected: true,
  stale: false,
  lastStatus: {
    tec: {},
    laser: {},
    ada4355: {
      monitor_rate_hz: 100000,
      monitor_avg: 25000,
      monitor_min: 24800,
      monitor_max: 25200,
      monitor_counter: 8,
      total_frame_counter: 4,
      read_points_written: 16384,
      filter: {
        lp_shift: 13,
        raw_lp_shift: 9,
        glitch_threshold: 3000,
        raw_use_filtered: false,
      },
      raw: { length: 524288, decim: 1, capacity_samples: 524288, storage: "packed_u16_le" },
    },
  },
  lastSpectrum: null,
  selectedLockPoint: null,
  commandLog: [],
  trend: [],
};

const client = {} as ApiClient;
const command = async (_label: string, action: () => Promise<unknown>) => {
  await action();
};

describe("AdaPanel layout", () => {
  it("uses the always-on ADA workflow and exposes raw capture saving", () => {
    const html = renderToStaticMarkup(<AdaPanel state={state} client={client} command={command} />);

    expect(html).toContain("Update Parameters");
    expect(html).toContain("Spectrum/Monitor LP Shift");
    expect(html).toContain("Raw LP Shift");
    expect(html).toContain("Raw Filter");
    expect(html).toContain("Raw Name");
    expect(html).toContain("524288");
    expect(html).toContain("Capture Raw ADC");
    expect(html).toContain("Save Raw");
    expect(html).not.toContain("Start ADA");
    expect(html).not.toContain("Stop ADA");
    expect(html).not.toContain("Clear ADA");
    expect(html).not.toContain("Set Monitor Rate");
    expect(html).not.toContain("Apply Filter");
    expect(html).not.toContain("Export Raw CSV");
  });
});
