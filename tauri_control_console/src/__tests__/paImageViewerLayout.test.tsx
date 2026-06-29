import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import PaImageViewer, {
  canSelectPaImagePixel,
  paImageColorbarPlacementStyle,
  paBuildProgressWidthStyle,
  paImageBuildProgressFromEvent,
  paImageSnapshotIntervalFrames,
  isPaImageRequestCurrent,
  processingPatchForTraceSelection,
  shouldClearPaImageForProcessingChange,
  shouldClearPaTraceForProcessingChange,
} from "../components/PaImageViewer";
import { DEFAULT_PA_IMAGE_PROCESSING } from "../utils/paImage";

const styles = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

function cssRuleBlock(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return styles.match(new RegExp(`${escaped}\\s*\\{(?<block>[^}]*)\\}`, "s"))?.groups?.block ?? "";
}

describe("PA Image Viewer layout", () => {
  it("renders source controls, ROI controls, trace, and image preview", () => {
    const html = renderToStaticMarkup(
      <PaImageViewer
        active
        tzOhm={2000}
        umPerCount={0.1325}
        scanAxisLabels={{ xStart: 0, xEnd: 1995, yStart: -1000, yEnd: 1000 }}
        onBack={() => undefined}
      />,
    );

    expect(html).toContain("PA Image Viewer");
    expect(html).toContain("Open Legacy Bin");
    expect(html).toContain("Build Image");
    expect(html).toContain("PTP ROI");
    expect(html).toContain("Frame Trace");
    expect(html).toContain("PA Image");
    expect(html).not.toContain("Live Preview");
    expect(html).toContain("Zoom");
    expect(html).toContain("PTP ROI");
    expect(html).toContain("Baseline");
    expect(html).toContain("Save ROI Defaults");
    expect(html).toContain("checked=\"\"");
    expect(html).toContain("Fast Build");
    expect(html).toContain("Cancel");
    expect(html).toContain("Colormap");
    expect(html).toContain('<option value="magma" selected="">Magma</option>');
    expect(html).toContain("Enhance");
    expect(html).toContain("Find Similar");
    expect(html).toContain("Clear Mask");
    expect(html).toContain("PA image color scale");
    expect(html).not.toContain(">Colorbar<");
    expect(html).not.toContain("Download Manual");
    expect(html).not.toContain("Download Python Scripts");
    expect(html).toContain("X 0 um to 264.34 um");
    expect(html).toContain("Y 0 um to 265 um");
    expect(html).toContain("height:390px");
  });

  it("keeps the PA image workbench balanced and attaches the colorbar to the image", () => {
    expect(styles).toMatch(/\.pa-image-workbench\s*\{[^}]*align-items:\s*stretch/s);
    expect(styles).toMatch(/\.pa-image-heatmap-with-colorbar\s*\{[^}]*position:\s*relative/s);
    expect(styles).toMatch(/\.pa-image-colorbar\s*\{[^}]*position:\s*absolute/s);
    expect(styles).not.toMatch(/\.pa-image-heatmap-with-colorbar\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+52px/s);
  });

  it("renders the PA image colorbar without an outer box", () => {
    const colorbarStyle = cssRuleBlock(".pa-image-colorbar");

    expect(colorbarStyle).toContain("background: transparent");
    expect(colorbarStyle).toContain("border: 0");
    expect(colorbarStyle).toContain("box-shadow: none");
  });

  it("places the PA image colorbar next to the rendered image grid", () => {
    expect(paImageColorbarPlacementStyle(null)).toEqual(undefined);
    expect(
      paImageColorbarPlacementStyle({
        cssWidth: 680,
        x0: 208,
        y0: 30,
        gridWidth: 292,
        gridHeight: 292,
      }),
    ).toEqual({ left: "510px", top: "30px", height: "292px", right: "auto", bottom: "auto" });
  });

  it("marks processed outputs stale when processing parameters change", () => {
    expect(shouldClearPaImageForProcessingChange("ptpStartNs")).toBe(true);
    expect(shouldClearPaImageForProcessingChange("sampleStartIndex")).toBe(true);
    expect(shouldClearPaTraceForProcessingChange("tzOhm")).toBe(true);
    expect(shouldClearPaTraceForProcessingChange("vfs")).toBe(true);
    expect(shouldClearPaTraceForProcessingChange("ptpStartNs")).toBe(false);
  });

  it("rejects async PA image results from an older processing generation", () => {
    expect(isPaImageRequestCurrent(4, 4)).toBe(true);
    expect(isPaImageRequestCurrent(4, 5)).toBe(false);
  });

  it("maps trace selections to PTP or baseline processing windows", () => {
    expect(processingPatchForTraceSelection("ptp", { startIndex: 30, endIndex: 20 }, DEFAULT_PA_IMAGE_PROCESSING)).toEqual({
      ptpStartNs: 80,
      ptpEndNs: 160,
    });
    expect(processingPatchForTraceSelection("baseline", { startIndex: 60, endIndex: 40 }, DEFAULT_PA_IMAGE_PROCESSING)).toEqual({
      baselineStartNs: 240,
      baselineEndNs: 400,
    });
    expect(processingPatchForTraceSelection("zoom", { startIndex: 60, endIndex: 40 }, DEFAULT_PA_IMAGE_PROCESSING)).toEqual({});
  });

  it("computes PA image build progress with elapsed rate and remaining time", () => {
    const progress = paImageBuildProgressFromEvent(
      { requestId: "build-1", sourceFrameCount: 250, elapsedMs: 5000, image: null },
      1000,
    );

    expect(progress.percent).toBe(25);
    expect(progress.frameRate).toBe(50);
    expect(progress.elapsedSeconds).toBe(5);
    expect(progress.remainingSeconds).toBe(15);
  });

  it("prefers backend-reported total source frames for streamed build progress", () => {
    const progress = paImageBuildProgressFromEvent(
      { requestId: "build-2", sourceFrameCount: 250, totalSourceFrameCount: 2000, elapsedMs: 5000, image: null },
      1000,
    );

    expect(progress.totalFrames).toBe(2000);
    expect(progress.percent).toBe(12.5);
    expect(progress.remainingSeconds).toBe(35);
  });

  it("uses one clamped percent for PA image build progress text and fill width", () => {
    const progress = paImageBuildProgressFromEvent(
      { requestId: "build-3", sourceFrameCount: 2500, totalSourceFrameCount: 2000, elapsedMs: 5000, image: null },
      1000,
    );

    expect(progress.percent).toBe(100);
    expect(progress.sourceFrameCount).toBe(2000);
    expect(paBuildProgressWidthStyle(progress)).toEqual({ width: "100%" });
  });

  it("limits selected PA image pixels to the current mask when one is active", () => {
    expect(canSelectPaImagePixel({ x: 1, y: 0 }, 3, null)).toBe(true);
    expect(canSelectPaImagePixel({ x: 1, y: 0 }, 3, [true, false, true, true, true, true])).toBe(false);
    expect(canSelectPaImagePixel({ x: 2, y: 0 }, 3, [true, false, true, true, true, true])).toBe(true);
  });

  it("uses adaptive image snapshot intervals and disables snapshots for fast build", () => {
    expect(paImageSnapshotIntervalFrames(0, false)).toBe(8192);
    expect(paImageSnapshotIntervalFrames(156_917, false)).toBe(8192);
    expect(paImageSnapshotIntervalFrames(1_000_000, false)).toBe(41984);
    expect(paImageSnapshotIntervalFrames(1_000_000, true)).toBe(0);
  });
});
