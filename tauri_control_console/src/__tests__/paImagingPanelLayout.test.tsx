import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ApiClient } from "../api/client";
import PaImagingPanel from "../components/PaImagingPanel";
import type { AppState } from "../state/store";

const state: AppState = {
  backendUrl: "http://127.0.0.1:8080",
  connected: true,
  stale: false,
  lastStatus: {
    tec: {},
    laser: {},
    ada4355: {},
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

const styles = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

describe("PA Imaging panel layout", () => {
  it("keeps advanced timing and scan controls behind a secondary view", () => {
    const html = renderToStaticMarkup(<PaImagingPanel state={state} client={client} command={command} />);

    expect(html).toContain("PA Scheduler");
    expect(html).toContain("Timing");
    expect(html).toContain("Expected Frames");
    expect(html).toContain("Estimated Capture Time");
    expect(html).not.toContain("Capture Time (s, 0=infinite)");
    expect(html).not.toContain("Max Blocks");
    expect(html).not.toContain("blocks");
    expect(html).not.toContain("TCP Host");
    expect(html).not.toContain("TCP Port");
    expect(html).not.toContain("gap_time");
    expect(html).not.toContain("galvo_settle_time");
    expect(html).not.toContain("ld_trigger_time");
    expect(html).not.toContain("adc_trigger_time");
    expect(html).toContain("Scan Settings");
    expect(html).not.toContain("scan_mode");
    expect(html).not.toContain("Scan Grid");
    expect(html).not.toContain("X Axis");
    expect(html).not.toContain("Y Axis");
    expect(html).not.toContain("Scan Preview");
    expect(html).not.toContain("Serpentine");
    expect(html).not.toContain("End");
    expect(html).not.toContain("Resolution");
    expect(html).not.toContain("x_start");
    expect(html).not.toContain("y_start");
    expect(html).not.toContain("frame_number");
    expect(html).not.toContain("task_id");
    expect(html).not.toContain("Task ID");
  });

  it("renders PA scheduler mode tabs and abort park action", () => {
    const html = renderToStaticMarkup(<PaImagingPanel state={state} client={client} command={command} />);

    expect(html).toContain("PA Scheduler");
    expect(html).toContain("Scan Capture");
    expect(html).not.toContain("Auto Scan Capture");
    expect(html).toContain("Point Capture");
    expect(html).toContain("Manual Control");
    expect(html).not.toContain("Waveform");
    expect(html).toContain("Diagnostics");
    expect(html).toContain("Abort &amp; Park");
    expect(html).toContain("Stops capture and parks");
  });

  it("uses a top toolbar and a two-column PA imaging workbench", () => {
    const html = renderToStaticMarkup(<PaImagingPanel state={state} client={client} command={command} />);

    expect(html).toContain('class="pa-imaging-toolbar"');
    expect(html).toContain('class="pa-imaging-workbench"');
    expect(html).toContain('class="pa-state-indicator');
    expect(html).toContain("PA State");
    expect(html).toContain("PA Image Preview");
    expect(html).toContain("Timing");
    expect(html).toContain("Scan Settings");
    expect(html).toContain("PA Image Viewer");
    expect(html).toContain("Diagnostics");
    expect(html).not.toContain('class="pa-imaging-run-actions"');
    expect(html).not.toContain('class="pa-status-strip"');
    expect(html).not.toContain('class="pa-status-tile"');
    expect(html).not.toContain('class="pa-preview-status');
    expect(html).not.toContain(">Start</button>");
    expect(html).not.toContain(">Stop</button>");
    expect(html).not.toContain(">Disconnect</button>");
    expect(html.indexOf("Timing")).toBeLessThan(html.indexOf("PA Image Preview"));
    expect(html.indexOf("PA Image Viewer")).toBeLessThan(html.indexOf("PA Image Preview"));
    expect(html.indexOf("PA Series Viewer")).toBeLessThan(html.indexOf("PA Image Viewer"));
    expect(html.indexOf("PA Image Viewer")).toBeLessThan(html.indexOf("Timing"));
    expect(html.indexOf("PA Image Preview")).toBeLessThan(html.indexOf("PA Scheduler"));
    expect(html.indexOf("PA Scheduler")).toBeLessThan(html.indexOf("Scan Settings"));
    expect(html).not.toContain("Output File");
    expect(html).toContain('class="pa-preview-main-actions"');
    expect(html).not.toContain('class="pa-preview-save-footer"');
    expect(html).toContain("pa-scheduler-save-panel");
    expect(html).toContain("Save Name");
    expect(html).toContain(">Current</span>");
    expect(html).toContain(">Canvas</span>");
    expect(html).toContain(">Save</button>");
    expect(html).not.toContain("Save Current");
    expect(html).not.toContain("Save Canvas");
    expect(html).not.toContain("Save Current + Canvas");
  });

  it("keeps the live preview column shrinkable so it cannot overlap the scheduler", () => {
    expect(styles).toMatch(
      /\.pa-imaging-workbench\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1\.08fr\)\s+minmax\(360px,\s*0\.92fr\)/s,
    );
    expect(styles).toMatch(/\.pa-imaging-workbench\s*>\s*\*\s*\{[^}]*min-width:\s*0/s);
    expect(styles).toMatch(/\.pa-imaging-setup-actions\s*\{[^}]*margin-left:\s*auto/s);
    expect(styles).toMatch(/\.pa-imaging-setup-actions\s*\{[^}]*justify-content:\s*flex-end/s);
    expect(styles).toMatch(
      /\.pa-preview-toolstrip\s*\{[^}]*grid-template-columns:\s*minmax\(96px,\s*0\.8fr\)\s+minmax\(88px,\s*0\.7fr\)\s+repeat\(3,\s*minmax\(108px,\s*1fr\)\)/s,
    );
    expect(styles).toMatch(/\.pa-live-image-preview\s+\.pa-image-heatmap\s*\{[^}]*max-width:\s*100%/s);
  });

  it("keeps detailed PA link diagnostics inside the diagnostics tab", () => {
    const mainHtml = renderToStaticMarkup(<PaImagingPanel state={state} client={client} command={command} />);

    expect(mainHtml).not.toContain("Capture Link");
    expect(mainHtml).not.toContain("TCP Listener");

    const diagnosticsHtml = renderToStaticMarkup(
      <PaImagingPanel state={state} client={client} command={command} initialSchedulerTab="diagnostics" />,
    );

    expect(diagnosticsHtml).toContain("Capture Link");
    expect(diagnosticsHtml).toContain("Receiver");
    expect(diagnosticsHtml).toContain("TCP Listener");
    expect(diagnosticsHtml).toContain("Health");
    expect(diagnosticsHtml).toContain('class="pa-diagnostics-grid"');
    expect(diagnosticsHtml).toContain('class="pa-diagnostic-card');
    expect(diagnosticsHtml).not.toContain('class="diagnostic-grid"');
  });

  it("shows completed capture as idle instead of running", () => {
    const completedState: AppState = {
      ...state,
      lastStatus: {
        tec: {},
        laser: {},
        ada4355: {},
        pa: {
          connected: true,
          running: true,
          last_error: "",
          frames_sent: 20_000,
          expected_frames: 20_000,
        },
      },
    };
    const html = renderToStaticMarkup(<PaImagingPanel state={completedState} client={client} command={command} />);

    expect(html).toContain('class="pa-state-indicator complete"');
    expect(html).toContain("<strong>Idle</strong>");
    expect(html).toContain('class="pa-capture-progress active complete"');
    expect(html).not.toContain("<strong>Running</strong>");
    expect(html).not.toContain("<strong>complete</strong>");
  });

  it("keeps connected but inactive PA links as idle in the main state", () => {
    const connectedState: AppState = {
      ...state,
      lastStatus: {
        tec: {},
        laser: {},
        ada4355: {},
        pa: {
          connected: true,
          running: false,
          last_error: "",
          frames_sent: 0,
          expected_frames: 0,
        },
      },
    };
    const html = renderToStaticMarkup(<PaImagingPanel state={connectedState} client={client} command={command} />);

    expect(html).toContain('class="pa-state-indicator idle"');
    expect(html).toContain("<strong>Idle</strong>");
    expect(html).not.toContain("<strong>Ready</strong>");
  });

  it("shows that scan capture is driven by current scan and timing settings", () => {
    const html = renderToStaticMarkup(<PaImagingPanel state={state} client={client} command={command} />);

    expect(html).toContain("Start Scan Capture");
    expect(html).toContain("current scan");
    expect(html).toContain("timing settings");
  });

  it("scopes PA image save controls to scan capture only", () => {
    const scanHtml = renderToStaticMarkup(<PaImagingPanel state={state} client={client} command={command} />);
    const pointHtml = renderToStaticMarkup(
      <PaImagingPanel state={state} client={client} command={command} initialSchedulerTab="point" />,
    );
    const manualHtml = renderToStaticMarkup(
      <PaImagingPanel state={state} client={client} command={command} initialSchedulerTab="manual" />,
    );
    const diagnosticsHtml = renderToStaticMarkup(
      <PaImagingPanel state={state} client={client} command={command} initialSchedulerTab="diagnostics" />,
    );

    expect(scanHtml).toContain("pa-scheduler-save-panel");
    expect(scanHtml).toContain("Save Image");

    for (const html of [pointHtml, manualHtml, diagnosticsHtml]) {
      expect(html).not.toContain("pa-scheduler-save-panel");
      expect(html).not.toContain("Save Image");
    }
    expect(pointHtml).toContain("Save Point Series");
    expect(pointHtml).toContain("Save Name");
    expect(manualHtml).not.toContain("Save Name");
    expect(diagnosticsHtml).not.toContain("Save Name");
  });

  it("renders live PA image preview status and throttling details", () => {
    const html = renderToStaticMarkup(<PaImagingPanel state={state} client={client} command={command} />);

    expect(html).toContain("Live image pending");
    expect(html).toContain("Set Canvas");
    expect(html).not.toContain("Set Current As Canvas");
    expect(html).toContain("Canvas not set");
    expect(html).toContain('aria-label="PA preview source"');
    expect(html).toContain(">Current</button>");
    expect(html).toContain(">Canvas</button>");
    expect(html).not.toContain("Show Current");
    expect(html).not.toContain("Show Canvas");
    expect(html).toContain("Aspect");
    expect(html).toContain("Fine Step");
    expect(html).toContain("Zoom To ROI");
    expect(html).toContain("Apply ROI To Scan");
    expect(html).not.toContain("PA image interaction mode");
    expect(html).not.toContain("Fine Scan</button>");
    expect(html).toContain("Click canvas to set Point/Manual target");
    expect(html).toContain("Uses current ROI settings");
    expect(html).toContain("refresh /");
  });

  it("locks other scheduler motion modes while scan capture is running", () => {
    const runningState: AppState = {
      ...state,
      lastStatus: {
        tec: {},
        laser: {},
        ada4355: {},
        pa: {
          connected: true,
          running: true,
          last_error: "",
          frames_sent: 12_000,
          expected_frames: 20_000,
        },
      },
    };
    const html = renderToStaticMarkup(<PaImagingPanel state={runningState} client={client} command={command} />);

    expect(html).toMatch(/<button[^>]*>Scan Capture<\/button>/);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Point Capture<\/button>/);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Manual Control<\/button>/);
    expect(html).not.toContain(">Waveform</button>");
    expect(html).toMatch(/<button[^>]*>Diagnostics<\/button>/);
    expect(html).toContain("Abort &amp; Park");
  });

  it("locks scan and manual modes while point capture is running", () => {
    const runningState: AppState = {
      ...state,
      lastStatus: {
        tec: {},
        laser: {},
        ada4355: {},
        pa: {
          connected: true,
          running: true,
          last_error: "",
          frames_sent: 120,
          expected_frames: 500,
        },
        pa_scheduler: {
          mode_name: "continuous_point_capture",
        },
      },
    };
    const html = renderToStaticMarkup(
      <PaImagingPanel state={runningState} client={client} command={command} initialSchedulerTab="point" />,
    );

    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Scan Capture<\/button>/);
    expect(html).toMatch(/<button[^>]*>Point Capture<\/button>/);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Manual Control<\/button>/);
    expect(html).toMatch(/<button[^>]*>Diagnostics<\/button>/);
    expect(html).toContain("Abort &amp; Park");
  });

  it("explains that manual control does not require capture", () => {
    const html = renderToStaticMarkup(
      <PaImagingPanel state={state} client={client} command={command} initialSchedulerTab="manual" />,
    );

    expect(html).toContain("Capture chain not required");
    expect(html).toContain("AXIS");
    expect(html).toContain("TCP");
    expect(html).toContain("Manual X");
    expect(html).toContain("Manual Y");
    expect(html).toContain("Update Position");
    expect(html).toContain("Pulse On");
    expect(html).not.toContain("Single Pulse");
    expect(html).not.toContain("Pulse Enable");
    expect(html).not.toContain("Apply Position");
  });

  it("lets point capture update position while the capture mode stays active", () => {
    const html = renderToStaticMarkup(
      <PaImagingPanel state={state} client={client} command={command} initialSchedulerTab="point" />,
    );

    expect(html).toContain("Start Capture");
    expect(html).not.toContain("Start Point Capture");
    expect(html).toContain("Update Position");
    expect(html).toContain("Pulse Repetition Rate");
    expect(html).not.toContain("Pulse Enable");
    expect(html).not.toContain("Capture Enable");
    expect(html).toContain("Save Point Series");
    expect(html).not.toContain(">Stop</button>");
  });

  it("shows unbounded point capture progress when Shots is zero", () => {
    const runningState: AppState = {
      ...state,
      lastStatus: {
        tec: {},
        laser: {},
        ada4355: {},
        pa: {
          connected: true,
          running: true,
          last_error: "",
          frames_sent: 1234,
          expected_frames: 0,
        },
      },
    };
    const html = renderToStaticMarkup(
      <PaImagingPanel state={runningState} client={client} command={command} initialSchedulerTab="point" />,
    );

    expect(html).toContain('class="pa-capture-progress active unbounded"');
    expect(html).toContain("Unlimited");
    expect(html).toContain("Frames 1234");
  });

  it("keeps PA image viewer controls behind a secondary view", () => {
    const mainHtml = renderToStaticMarkup(<PaImagingPanel state={state} client={client} command={command} tzOhm={2000} />);

    expect(mainHtml).toContain("PA Image Viewer");
    expect(mainHtml).not.toContain("Open Legacy Bin");
    expect(mainHtml).not.toContain("Frame Trace");

    const viewerHtml = renderToStaticMarkup(<PaImagingPanel state={state} client={client} command={command} tzOhm={2000} initialView="image" />);

    expect(viewerHtml).toContain("PA Image Viewer");
    expect(viewerHtml).toContain("Open Legacy Bin");
    expect(viewerHtml).toContain("Frame Trace");
    expect(viewerHtml).toContain("Back");
  });

  it("keeps scan mode out of the timing view", () => {
    const html = renderToStaticMarkup(<PaImagingPanel state={state} client={client} command={command} initialView="timing" />);

    expect(html).toContain("Timing Parameters");
    expect(html).not.toContain("scan_mode");
    expect(html).not.toContain("Flyback");
    expect(html).not.toContain("Serpentine");
  });

  it("puts scan axis controls, mode, and preview in the scan settings view", () => {
    const html = renderToStaticMarkup(<PaImagingPanel state={state} client={client} command={command} initialView="scan" />);

    expect(html).toContain("PA Scan Settings");
    expect(html).toContain("X Axis");
    expect(html).toContain("Y Axis");
    expect(html).toContain("Scan Preview");
    expect(html).toContain("Serpentine");
    expect(html).toContain("Flyback");
    expect(html).toContain("Expected Frames");
    expect(html).toContain("Estimated Capture Time");
    expect(html).toContain("Range");
    expect(html).toContain("Resolution");
    expect(html).toContain("Calibration Counts");
    expect(html).toContain("To Default");
    expect(html).toContain("Save Default");
    expect(html).toContain('value="4000"');
    expect(html).toContain('value="400"');
    expect(html).toContain('value="160000"');
    expect(html.indexOf("Serpentine")).toBeLessThan(html.indexOf("Flyback"));
    expect(html).toContain('class="method-pill active">Serpentine');
    expect(html.indexOf("Scan Mode")).toBeLessThan(html.indexOf("Frames"));
    expect(html.indexOf("Frames")).toBeLessThan(html.indexOf("Expected Frames"));
    expect(html.indexOf("Expected Frames")).toBeLessThan(html.indexOf("Estimated Capture Time"));
    expect(html.indexOf("Estimated Capture Time")).toBeLessThan(html.indexOf("X Axis"));
    expect(html.indexOf("X Axis")).toBeLessThan(html.indexOf("Y Axis"));
    expect(html.indexOf("Y Axis")).toBeLessThan(html.indexOf("Scan Preview"));
    expect(html.indexOf("Resolution")).toBeLessThan(html.indexOf("Calibration Counts"));
    expect(html).not.toContain("Task ID");
    expect(html).not.toContain("task_id");
  });

  it("renders the default 400 x 400 scan preview as a multi-point path", () => {
    const html = renderToStaticMarkup(<PaImagingPanel state={state} client={client} command={command} initialView="scan" />);

    expect(html).toContain("400 x 400");
    expect(html).toContain('class="scan-preview-dot"');
    expect(html).toContain('class="scan-preview-path"');
    expect(html).not.toContain('class="scan-preview-return"');
  });

  it("keeps timing summary values together below the diagram", () => {
    const html = renderToStaticMarkup(<PaImagingPanel state={state} client={client} command={command} initialView="timing" />);

    expect(html).not.toContain('class="readouts"');
    expect(html).toContain("Frame period");
    expect(html).toContain("Required gap");
    expect(html).toContain("ADC window");
    expect(html).toContain("Clock");
  });

  it("marks laser emission without labeling the settle window", () => {
    const html = renderToStaticMarkup(<PaImagingPanel state={state} client={client} command={command} initialView="timing" />);

    expect(html).toContain("Laser emission +1 us");
    expect(html).not.toContain("Settle 10 us");
  });

  it("uses the requested PA timing defaults", () => {
    const html = renderToStaticMarkup(<PaImagingPanel state={state} client={client} command={command} initialView="timing" />);

    expect(html).toContain("333.33 us");
    expect(html).toContain("3.00003 kHz");
    expect(html).toContain("galvo_settle_time");
    expect(html).toContain("ld_trigger_time");
    expect(html).toContain("ld_time");
    expect(html).toContain("adc_trigger_time");
    expect(html).toContain('value="10"');
    expect(html).toContain('value="2"');
    expect(html).toContain('value="4"');
    expect(html).toContain('value="1"');
  });
});
