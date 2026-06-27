import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import PaImageViewer, { shouldClearPaImageForProcessingChange, shouldClearPaTraceForProcessingChange } from "../components/PaImageViewer";

describe("PA Image Viewer layout", () => {
  it("renders source controls, ROI controls, trace, and image preview", () => {
    const html = renderToStaticMarkup(<PaImageViewer active tzOhm={2000} onBack={() => undefined} />);

    expect(html).toContain("PA Image Viewer");
    expect(html).toContain("Open Legacy Bin");
    expect(html).toContain("Build Image");
    expect(html).toContain("PTP ROI");
    expect(html).toContain("Frame Trace");
    expect(html).toContain("PA Image");
    expect(html).toContain("Zoom");
    expect(html).toContain("Set ROI");
  });

  it("marks processed outputs stale when processing parameters change", () => {
    expect(shouldClearPaImageForProcessingChange("ptpStartNs")).toBe(true);
    expect(shouldClearPaImageForProcessingChange("sampleStartIndex")).toBe(true);
    expect(shouldClearPaTraceForProcessingChange("tzOhm")).toBe(true);
    expect(shouldClearPaTraceForProcessingChange("vfs")).toBe(true);
    expect(shouldClearPaTraceForProcessingChange("ptpStartNs")).toBe(false);
  });
});
