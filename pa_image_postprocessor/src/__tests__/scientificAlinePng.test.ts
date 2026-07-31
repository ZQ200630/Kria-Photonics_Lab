import { afterEach, describe, expect, it, vi } from "vitest";
import {
  scientificAlinePngBytes,
  scientificAlinePngDefaultFilename,
} from "../utils/scientificAlinePng";

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

describe("scientific A-line PNG export", () => {
  afterEach(() => invokeMock.mockReset());

  it("delegates scientific rendering to the Python/Matplotlib Tauri command", async () => {
    invokeMock.mockResolvedValue([0x89, 0x50, 0x4e, 0x47]);
    const request = {
      timeNs: [0, 1000, 2000, 3000],
      visibleDomain: { startIndex: 1, endIndex: 2 },
      frameIndex: 42,
      series: [
        { label: "Raw current", color: "#0F4D92", values: [-1, 2, -3, 4] },
        { label: "Filtered RF", color: "#9A4D8E", values: [10, 20], xOffset: 1 },
      ],
    };

    const bytes = await scientificAlinePngBytes(request);

    expect(Array.from(bytes)).toEqual([0x89, 0x50, 0x4e, 0x47]);
    expect(invokeMock).toHaveBeenCalledWith("pa_classical_render_scientific_aline", { request });
  });

  it("derives a safe frame-specific filename", () => {
    expect(scientificAlinePngDefaultFilename("/data/sample scan/legacy.bin", 135484))
      .toBe("legacy_frame_135484_aline_scientific.png");
  });
});