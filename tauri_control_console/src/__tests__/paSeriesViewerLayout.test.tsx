import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import PaSeriesViewer from "../components/PaSeriesViewer";

describe("PA Series Viewer layout", () => {
  it("renders point capture series controls, statistics, timeline, and trace ROI tools", () => {
    const html = renderToStaticMarkup(<PaSeriesViewer active tzOhm={2000} zeroAdcCode={29623} onBack={() => undefined} />);

    expect(html).toContain("PA Series Viewer");
    expect(html).toContain('class="pa-series-workbench"');
    expect(html).toContain('class="pa-series-left"');
    expect(html).toContain('class="pa-series-right"');
    expect(html).toContain("Open Legacy Bin");
    expect(html).toContain("Build Series");
    expect(html).toContain("PTP Timeline");
    expect(html).toContain("Frame Trace");
    expect(html.indexOf("Frame Trace")).toBeLessThan(html.indexOf("PTP Timeline"));
    expect(html).toContain("PTP average");
    expect(html).toContain("PTP variance");
    expect(html).toContain("PTP std");
    expect(html.indexOf('aria-label="PA point capture PTP timeline"')).toBeLessThan(html.indexOf("PTP average"));
    expect(html).toContain('class="pa-series-stats"');
    expect(html).toContain("Zoom");
    expect(html).toContain("PTP ROI");
    expect(html).toContain("Baseline");
    expect(html).toContain("Save ROI Defaults");
  });
});
