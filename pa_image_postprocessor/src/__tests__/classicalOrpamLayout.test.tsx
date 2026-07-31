import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import PaImageViewer from "../components/PaImageViewer";

const styles = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

describe("classical OR-PAM GUI integration", () => {
  it("keeps PTP 2D and adds a selectable A-line pipeline below it", () => {
    const html = renderToStaticMarkup(
      <PaImageViewer active tzOhm={2000} zeroAdcCode={27034} umPerCount={0.1325} />,
    );

    expect(html).toContain("PTP ROI");
    expect(html).toContain("Reconstruction mode");
    expect(html).toContain("PTP 2D");
    expect(html).toContain("Classical 3D");
    expect(html).toContain("Build Image");
    expect(html).toContain("Processed A-line");
    expect(html).toContain("A-line processing pipeline");
    expect(html).toContain("1. Median baseline");
    expect(html).toContain("2. Butterworth SOS");
    expect(html).toContain("3. Hilbert envelope");
    expect(html).toContain("Raw current");
    expect(html).toContain("Baseline-corrected");
    expect(html).toContain("Filtered RF");
    expect(html).toContain("Envelope");
    expect(html).toContain("Reconstruction Settings");
    expect(html).toContain("Reset from Metadata");
    expect(html).toContain("Processed A-line selection mode");
    expect(html).toContain("Processing");
    expect(html).toContain("Output");
    expect(html).toContain("Save Preset");
    expect(html).toContain("Save Scientific PNG");
    expect(html).toContain("Time (µs) · Current (µA)");
  });

  it("renders MAP, both B-scans and C-scan with numerical and PNG saves separated", () => {
    const html = renderToStaticMarkup(
      <PaImageViewer active tzOhm={2000} zeroAdcCode={27034} umPerCount={0.1325} />,
    );

    expect(html).toContain("Classical 3D Envelope");
    expect(html).toContain("XY MAP");
    expect(html).toContain("XZ B-scan");
    expect(html).toContain("YZ B-scan");
    expect(html).toContain("XY C-scan");
    expect(html).toContain("X index");
    expect(html).toContain("Y index");
    expect(html).toContain("Z index");
    expect(html).toContain("Rotation");
    expect(html).toContain("90°");
    expect(html).toContain("Run + Save Numerical");
    expect(html).toContain("Save Current View PNG");
    expect(html).toContain("Saved numerical data stays linear");
    expect(html).toContain("PTP ROI");
    expect(html).toContain("Reconstruction mode");
    expect(html).toContain("PTP 2D");
    expect(html).toContain("Classical 3D");
  });

  it("uses a two-column additive layout and collapses the pipeline on narrow screens", () => {
    expect(styles).toMatch(/\.classical-aline-panel,\s*\.classical-volume-panel\s*\{[^}]*grid-column:\s*span 1/s);
    expect(styles).toMatch(/\.classical-pipeline\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto/s);
    expect(styles).toMatch(/@media \(max-width:\s*820px\)[\s\S]*\.classical-pipeline\s*\{[^}]*grid-template-columns:\s*1fr/s);
  });
});
