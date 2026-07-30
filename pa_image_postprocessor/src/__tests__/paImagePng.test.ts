import { describe, expect, it } from "vitest";
import { paImagePngDefaultFilename, paImagePngExportDimensions } from "../utils/paImagePng";

describe("PA image PNG export", () => {
  it("derives a safe PNG filename from the opened legacy PA binary", () => {
    expect(paImagePngDefaultFilename("/data/runs/sample scan/legacy.bin")).toBe("legacy_pa_image.png");
    expect(paImagePngDefaultFilename("")).toBe("pa_image.png");
  });

  it("exports the currently visible zoomed and rotated image dimensions", () => {
    expect(paImagePngExportDimensions({
      width: 10,
      height: 8,
      zoom: { xStart: 2, xEnd: 6, yStart: 1, yEnd: 4 },
      rotation: 0,
    })).toEqual({ width: 5, height: 4 });

    expect(paImagePngExportDimensions({
      width: 10,
      height: 8,
      zoom: { xStart: 2, xEnd: 6, yStart: 1, yEnd: 4 },
      rotation: 90,
    })).toEqual({ width: 4, height: 5 });
  });
});
