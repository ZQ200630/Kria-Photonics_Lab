import { describe, expect, it } from "vitest";
import {
  DEFAULT_CLASSICAL_ORPAM_CONFIG,
  classicalDisplayValues,
  configFromAdjacentMetadata,
  validateClassicalOrpamConfig,
} from "../utils/classicalOrpam";
import { rustClassicalConfig } from "../utils/classicalOrpamTauri";

describe("classical OR-PAM workflow", () => {
  it("resolves the CarbonfiberH2 valid trace, output samples and one-way depth", () => {
    const validation = validateClassicalOrpamConfig(DEFAULT_CLASSICAL_ORPAM_CONFIG, 2032, 400, 400);

    expect(validation.errors).toEqual([]);
    expect(validation.preview).toMatchObject({
      sourceStartIndex: 10,
      sourceEndIndex: 1982,
      validSampleCount: 1972,
      outputSampleCount: 443,
      shapeYxz: [400, 400, 443],
      depthSampleSpacingUm: 12,
      depthStartUm: 0,
      depthEndUm: 5304,
      envelopeBytes: 283_520_000,
    });
  });

  it("rejects a workflow whose output window extends beyond processing", () => {
    const validation = validateClassicalOrpamConfig(
      { ...DEFAULT_CLASSICAL_ORPAM_CONFIG, processingEndNs: 3000 },
      2032,
      400,
      400,
    );

    expect(validation.preview).toBeNull();
    expect(validation.errors.join(" ")).toContain("contained in the processing window");
  });

  it("loads capture-specific settings from adjacent metadata without auto-retuning the band", () => {
    const loaded = configFromAdjacentMetadata(DEFAULT_CLASSICAL_ORPAM_CONFIG, {
      processing: {
        sampleIntervalNs: 8,
        sampleStartIndex: 10,
        sampleEndTrim: 50,
        baselineStartNs: 248,
        baselineEndNs: 1104,
        ptpStartNs: 1544,
        ptpEndNs: 5088,
        tzOhm: 2000,
        vfs: 1,
        zeroAdcCode: 27034,
      },
      calibration: { um_per_count: 0.1325 },
    });

    expect(loaded.source).toBe("adjacent metadata.json");
    expect(loaded.config.outputStartNs).toBe(1544);
    expect(loaded.config.outputEndNs).toBe(5088);
    expect(loaded.config.bandpassLowHz).toBe(500_000);
    expect(loaded.config.bandpassHighHz).toBe(25_000_000);
    expect(loaded.config.umPerCount).toBe(0.1325);
  });

  it("maps the visible pipeline to Rust without hiding enable flags", () => {
    expect(rustClassicalConfig(DEFAULT_CLASSICAL_ORPAM_CONFIG)).toMatchObject({
      sample_interval_ns: 8,
      baseline_start_ns: 248,
      processing_end_ns: 8000,
      output_start_ns: 1544,
      bandpass_low_hz: 500_000,
      sound_speed_m_s: 1500,
      relative_depth: true,
      pipeline: {
        median_baseline_enabled: true,
        bandpass_enabled: true,
        hilbert_envelope_enabled: true,
      },
    });
  });

  it("applies dB conversion only to display values", () => {
    const source = [1, 0.1, 0.001, null];
    const display = classicalDisplayValues(source, "db", 40);

    expect(source).toEqual([1, 0.1, 0.001, null]);
    expect(display[0]).toBeCloseTo(0);
    expect(display[1]).toBeCloseTo(-20);
    expect(display[2]).toBe(-40);
    expect(display[3]).toBe(-40);
  });
});
