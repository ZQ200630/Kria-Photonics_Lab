import { describe, expect, it } from "vitest";
import { classifyTecStatus, isTecRunning, temperatureStats } from "../utils/tec";

describe("TEC helpers", () => {
  it("treats closed_loop and tec_enabled flags as TEC on", () => {
    expect(isTecRunning(["run"])).toBe(false);
    expect(isTecRunning(["closed_loop"])).toBe(true);
    expect(isTecRunning(["tec_enabled"])).toBe(true);
  });

  it("treats missing or unrelated flags as TEC off", () => {
    expect(isTecRunning(undefined)).toBe(false);
    expect(isTecRunning([])).toBe(false);
    expect(isTecRunning(["id_check_pass"])).toBe(false);
    expect(isTecRunning(["run", "id_check_pass", "adc_sample_valid", "temperature_valid"])).toBe(false);
  });

  it("classifies TEC status for overview indicator colors", () => {
    expect(classifyTecStatus({ status_flags: [] }).level).toBe("off");
    expect(classifyTecStatus({ status_flags: ["run", "adc_sample_valid", "temperature_valid", "id_check_pass"] }).level).toBe("off");
    expect(classifyTecStatus({ status_flags: ["run", "closed_loop", "tec_enabled", "adc_sample_valid", "temperature_valid", "id_check_pass"] }).level).toBe("ok");
    expect(classifyTecStatus({ status_flags: ["run", "closed_loop", "id_check_pass"] }).level).toBe("warn");
    expect(classifyTecStatus({ status_flags: ["run", "fault_latched"], main_error_status: 8 }).level).toBe("fault");
  });

  it("does not classify transient SPI busy as a warning by itself", () => {
    expect(classifyTecStatus({ status_flags: ["run", "closed_loop", "tec_enabled", "adc_sample_valid", "temperature_valid", "id_check_pass", "spi_busy"] }).level).toBe("ok");
  });

  it("does not classify historical POR flag as a warning by itself", () => {
    expect(classifyTecStatus({ status_flags: ["run", "closed_loop", "tec_enabled", "adc_sample_valid", "temperature_valid", "id_check_pass", "por_flag_seen"] }).level).toBe("ok");
  });

  it("computes temperature window statistics", () => {
    const stats = temperatureStats([30, 31, 32]);
    expect(stats.count).toBe(3);
    expect(stats.min).toBe(30);
    expect(stats.max).toBe(32);
    expect(stats.peakToPeak).toBe(2);
    expect(stats.rmsNoise).toBeCloseTo(0.81649658, 6);
  });
});
