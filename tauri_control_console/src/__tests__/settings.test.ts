import { describe, expect, it } from "vitest";
import { flattenSettings, parseSettingsFileContents, settingsFromStatus } from "../utils/settings";
import type { SystemStatus } from "../api/types";

describe("settingsFromStatus", () => {
  const status: SystemStatus = {
    tec: {
      target_celsius: 31.25,
      temp_min_celsius: 20,
      temp_max_celsius: 40,
      temp_alpha: 65535,
      rdy_timeout: 5000000,
      spi_clk_div: 10,
      manual_dac_code: 2048,
      dac_min: 1800,
      dac_max: 2150,
      dac_bias: 2048,
      dac_safe: 2048,
      pid: { kp: 1, ki: 0.003, kd: 0, integral_limit: 300000, max_step: 10 },
      ramp: { enabled: true, rate_c_per_s: 0.05, interval_ms: 200 },
    },
    laser: {
      static_setpoint: { ch0_internal: 26000, ch1_internal: 0 },
      fine_scan_setpoint: {
        ch0_internal: 26000,
        ch1_start_internal: 20000,
        ch1_stop_internal: 30000,
        ch1_step_internal: 10,
        dwell_ticks: 100,
        settle_ticks: 100,
        frames: 1,
        continuous: true,
      },
      safety: {
        ch0_min: 0,
        ch0_max: 40000,
        ch1_min: 0,
        ch1_max: 40000,
        ch0_soft_step: 8,
        ch1_soft_step: 8,
        ramp_interval: 1000,
        dac_timeout: 1000000,
        watchdog_timeout: 0,
        enable_delay: 0,
        current_limit: 0,
        ch0_gain: 0,
        ch1_gain: 0,
        current_offset: 0,
      },
      lock: {
        target_adc: 42000,
        bias_ch1_internal: 25000,
        ch1_min_internal: 20000,
        ch1_max_internal: 30000,
        kp: 0.5,
        ki: 0.01,
        polarity_invert: false,
        integral_limit: 500000,
        max_step: 3,
        locked_threshold: 1000,
        loss_threshold: 10000,
      },
    },
    ada4355: {
      monitor_rate_hz: 100000,
      sample_delay: 0,
      sample_window: 1024,
      max_points: 16384,
      frame_decim_n: 1000,
      filter: {
        control_hex: "0x00000019",
        glitch_threshold: 3000,
        lp_shift: 13,
      },
      raw: {
        length: 16384,
        decim: 1,
      },
    },
  };

  it("converts current readback into persistent server settings", () => {
    const settings = settingsFromStatus({ settings_schema_version: 5, custom: { keep: true } }, status);

    expect(settings.custom).toEqual({ keep: true });
    expect(settings.tec.pid.kp).toBe("1");
    expect(settings.tec.pid.ki).toBe("0.003");
    expect(settings.tec.protection.temp_min_celsius).toBe("20");
    expect(settings.laser.fine_scan.ch0).toBe("26000");
    expect(settings.laser.protection.ch1_max).toBe("40000");
    expect(settings.laser.lock.range_halfspan).toBe("5000");
    expect(settings.laser.lock.max_step).toBe("3");
    expect(settings.ada4355.filter_control).toBe("0x00000019");
    expect(settings.ada4355.lp_shift).toBe("13");
  });

  it("flattens settings for key-value display", () => {
    const rows = flattenSettings({
      tec: { pid: { kp: "1", ki: "0.003" } },
      laser: { fine_scan: { ch0: "26000" } },
      ada4355: { lp_shift: "13" },
    });

    expect(rows).toEqual([
      { key: "ada4355.lp_shift", value: "13" },
      { key: "laser.fine_scan.ch0", value: "26000" },
      { key: "tec.pid.ki", value: "0.003" },
      { key: "tec.pid.kp", value: "1" },
    ]);
  });

  it("parses local setting files from raw settings or exported server responses", () => {
    expect(parseSettingsFileContents('{"tec":{"pid":{"kp":"1"}}}')).toEqual({ tec: { pid: { kp: "1" } } });
    expect(parseSettingsFileContents('{"ok":true,"path":"/tmp/settings.json","settings":{"laser":{"lock":{"kp":"0.5"}}}}')).toEqual({
      laser: { lock: { kp: "0.5" } },
    });
    expect(() => parseSettingsFileContents("[1,2,3]")).toThrow("settings JSON must be an object");
  });
});
