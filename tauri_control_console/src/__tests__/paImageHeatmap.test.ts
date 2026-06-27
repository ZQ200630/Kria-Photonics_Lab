import { describe, expect, it } from "vitest";
import { resolvePaImageHeatmapLayout } from "../components/PaImageHeatmap";

describe("PA image heatmap layout", () => {
  it("uses fractional cell sizes so large images fit inside the plot area", () => {
    const layout = resolvePaImageHeatmapLayout({
      cssWidth: 520,
      cssHeight: 360,
      width: 1000,
      height: 1000,
    });

    expect(layout.cell).toBeLessThan(1);
    expect(layout.gridWidth).toBeLessThanOrEqual(layout.plotWidth);
    expect(layout.gridHeight).toBeLessThanOrEqual(layout.plotHeight);
  });
});
