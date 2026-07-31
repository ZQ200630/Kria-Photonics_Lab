import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildScientificAlinePlotSpec,
  scientificAlinePngBytes,
  scientificAlinePngDefaultFilename,
} from "../utils/scientificAlinePng";

describe("scientific A-line PNG export", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("builds a calibrated time/current plot for the visible range", () => {
    const spec = buildScientificAlinePlotSpec({
      timeNs: [0, 1000, 2000, 3000],
      visibleDomain: { startIndex: 1, endIndex: 2 },
      frameIndex: 42,
      series: [
        { label: "Raw current", color: "#2563eb", values: [-1, 2, -3, 4] },
        { label: "Filtered RF", color: "#7c3aed", values: [10, 20], xOffset: 1 },
      ],
    });

    expect(spec).toMatchObject({
      width: 2400,
      height: 1500,
      xLabel: "Time (µs)",
      yLabel: "Current (µA)",
      xRangeUs: { min: 1, max: 2 },
      frameIndex: 42,
    });
    expect(spec.series[0].points).toEqual([
      { xUs: 1, yUa: 2 },
      { xUs: 2, yUa: -3 },
    ]);
    expect(spec.series[1].points).toEqual([
      { xUs: 1, yUa: 10 },
      { xUs: 2, yUa: 20 },
    ]);
    expect(spec.yRangeUa.min).toBeLessThanOrEqual(0);
    expect(spec.yRangeUa.max).toBeGreaterThan(20);
  });

  it("derives a safe frame-specific filename", () => {
    expect(scientificAlinePngDefaultFilename("/data/sample scan/legacy.bin", 135484))
      .toBe("legacy_frame_135484_aline_scientific.png");
  });

  it("renders a high-resolution PNG with scientific axis labels and legend", async () => {
    const labels: string[] = [];
    const context = new Proxy(
      {
        fillText: (text: string) => labels.push(text),
        measureText: (text: string) => ({ width: text.length * 16 }),
      },
      {
        get: (target, property) => property in target
          ? target[property as keyof typeof target]
          : vi.fn(),
        set: () => true,
      },
    ) as unknown as CanvasRenderingContext2D;
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => context,
      toBlob: (callback: (blob: Blob | null) => void) => callback(new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: "image/png" })),
    } as unknown as HTMLCanvasElement;
    vi.stubGlobal("document", {
      createElement: (tag: string) => {
        expect(tag).toBe("canvas");
        return canvas;
      },
    });

    const bytes = await scientificAlinePngBytes({
      timeNs: [0, 1000, 2000],
      frameIndex: 7,
      series: [{ label: "Raw current", color: "#2563eb", values: [0, 2, -1] }],
    });

    expect([canvas.width, canvas.height]).toEqual([2400, 1500]);
    expect(Array.from(bytes)).toEqual([0x89, 0x50, 0x4e, 0x47]);
    expect(labels).toEqual(expect.arrayContaining([
      "Processed PA A-line",
      "Source frame 7",
      "Raw current",
      "Time (µs)",
      "Current (µA)",
    ]));
  });
});