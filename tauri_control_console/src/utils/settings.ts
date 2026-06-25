import type { SystemStatus } from "../api/types";

export type SettingsObject = Record<string, any>;
export type SettingRow = { key: string; value: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function parseSettingsFileContents(contents: string): SettingsObject {
  const parsed = JSON.parse(contents) as unknown;
  if (!isRecord(parsed)) {
    throw new Error("settings JSON must be an object");
  }

  const candidate = isRecord(parsed.settings) ? parsed.settings : parsed;
  if (!isRecord(candidate)) {
    throw new Error("settings JSON must contain an object");
  }
  return cloneSettings(candidate);
}

function cloneSettings(settings: Record<string, unknown>): SettingsObject {
  return JSON.parse(JSON.stringify(settings ?? {}));
}

function section(parent: SettingsObject, key: string): SettingsObject {
  if (!parent[key] || typeof parent[key] !== "object" || Array.isArray(parent[key])) {
    parent[key] = {};
  }
  return parent[key];
}

function numberText(value: unknown, digits = 8): string | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  if (Number.isInteger(value)) return String(value);
  return String(Number(value.toFixed(digits)));
}

function assignText(target: SettingsObject, key: string, value: unknown, digits?: number) {
  const text = numberText(value, digits);
  if (text !== undefined) target[key] = text;
}

function assignBool(target: SettingsObject, key: string, value: unknown) {
  if (typeof value === "boolean") target[key] = value;
}

function hexOrText(hexValue: unknown, value: unknown): string | undefined {
  if (typeof hexValue === "string" && hexValue.length > 0) return hexValue;
  return numberText(value);
}

export function settingsFromStatus(existing: Record<string, unknown>, status: SystemStatus): SettingsObject {
  const settings = cloneSettings(existing);

  const tec = section(settings, "tec");
  const tecPid = section(tec, "pid");
  const tecProtection = section(tec, "protection");
  const tecRamp = section(tec, "ramp");

  const target = status.tec.ramp?.active ? status.tec.ramp?.target_celsius : status.tec.target_celsius;
  assignText(tec, "target_celsius", target, 4);
  assignText(tec, "manual_dac", status.tec.manual_dac_code);
  assignText(tecPid, "kp", status.tec.pid?.kp, 8);
  assignText(tecPid, "ki", status.tec.pid?.ki, 8);
  assignText(tecPid, "kd", status.tec.pid?.kd, 8);
  assignText(tecPid, "integral_limit", status.tec.pid?.integral_limit);
  assignText(tecPid, "max_step", status.tec.pid?.max_step);
  assignText(tecPid, "dac_bias", status.tec.dac_bias);
  assignText(tecPid, "dac_min", status.tec.dac_min);
  assignText(tecPid, "dac_max", status.tec.dac_max);
  assignText(tecPid, "dac_safe", status.tec.dac_safe);
  assignText(tecProtection, "temp_min_celsius", status.tec.temp_min_celsius, 4);
  assignText(tecProtection, "temp_max_celsius", status.tec.temp_max_celsius, 4);
  assignText(tecProtection, "alpha", status.tec.temp_alpha);
  assignText(tecProtection, "rdy_timeout", status.tec.rdy_timeout);
  assignText(tecProtection, "spi_clk_div", status.tec.spi_clk_div);
  assignBool(tecRamp, "enabled", status.tec.ramp?.enabled);
  assignText(tecRamp, "rate_c_per_s", status.tec.ramp?.rate_c_per_s, 6);
  assignText(tecRamp, "interval_ms", status.tec.ramp?.interval_ms);

  const laser = section(settings, "laser");
  const laserStatic = section(laser, "static");
  const laserScan = section(laser, "fine_scan");
  const laserLock = section(laser, "lock");
  const laserProtection = section(laser, "protection");

  assignText(laserStatic, "ch0", status.laser.static_setpoint?.ch0_internal);
  assignText(laserStatic, "ch1", status.laser.static_setpoint?.ch1_internal);
  assignText(laserScan, "ch0", status.laser.fine_scan_setpoint?.ch0_internal);
  assignText(laserScan, "start", status.laser.fine_scan_setpoint?.ch1_start_internal);
  assignText(laserScan, "stop", status.laser.fine_scan_setpoint?.ch1_stop_internal);
  assignText(laserScan, "step", status.laser.fine_scan_setpoint?.ch1_step_internal);
  assignText(laserScan, "dwell", status.laser.fine_scan_setpoint?.dwell_ticks);
  assignText(laserScan, "settle", status.laser.fine_scan_setpoint?.settle_ticks);
  assignText(laserScan, "frames", status.laser.fine_scan_setpoint?.frames);
  assignBool(laserScan, "continuous", status.laser.fine_scan_setpoint?.continuous);

  assignText(laserProtection, "ch0_min", status.laser.safety?.ch0_min);
  assignText(laserProtection, "ch0_max", status.laser.safety?.ch0_max);
  assignText(laserProtection, "ch1_min", status.laser.safety?.ch1_min);
  assignText(laserProtection, "ch1_max", status.laser.safety?.ch1_max);
  assignText(laserProtection, "ch0_soft_step", status.laser.safety?.ch0_soft_step);
  assignText(laserProtection, "ch1_soft_step", status.laser.safety?.ch1_soft_step);
  assignText(laserProtection, "ramp_interval", status.laser.safety?.ramp_interval);
  assignText(laserProtection, "dac_timeout", status.laser.safety?.dac_timeout);
  assignText(laserProtection, "watchdog_timeout", status.laser.safety?.watchdog_timeout);
  assignText(laserProtection, "enable_delay", status.laser.safety?.enable_delay);
  assignText(laserProtection, "current_limit", status.laser.safety?.current_limit);
  assignText(laserProtection, "ch0_gain", status.laser.safety?.ch0_gain);
  assignText(laserProtection, "ch1_gain", status.laser.safety?.ch1_gain);
  assignText(laserProtection, "current_offset", status.laser.safety?.current_offset);

  assignText(laserLock, "ch0", status.laser.fine_scan_setpoint?.ch0_internal ?? status.laser.static_setpoint?.ch0_internal);
  assignText(laserLock, "target_adc", status.laser.lock?.target_adc);
  assignText(laserLock, "bias_ch1", status.laser.lock?.bias_ch1_internal);
  assignText(laserLock, "ch1_min", status.laser.lock?.ch1_min_internal);
  assignText(laserLock, "ch1_max", status.laser.lock?.ch1_max_internal);
  if (typeof status.laser.lock?.ch1_min_internal === "number" && typeof status.laser.lock?.ch1_max_internal === "number") {
    assignText(laserLock, "range_halfspan", Math.round((status.laser.lock.ch1_max_internal - status.laser.lock.ch1_min_internal) / 2));
  }
  assignText(laserLock, "kp", status.laser.lock?.kp, 8);
  assignText(laserLock, "ki", status.laser.lock?.ki, 8);
  assignBool(laserLock, "polarity_invert", status.laser.lock?.polarity_invert);
  assignText(laserLock, "integral_limit", status.laser.lock?.integral_limit);
  assignText(laserLock, "max_step", status.laser.lock?.max_step);
  assignText(laserLock, "locked_threshold", status.laser.lock?.locked_threshold);
  assignText(laserLock, "loss_threshold", status.laser.lock?.loss_threshold);

  const ada = section(settings, "ada4355");
  assignText(ada, "monitor_rate_hz", status.ada4355.monitor_rate_hz, 3);
  assignText(ada, "sample_delay", status.ada4355.sample_delay);
  assignText(ada, "sample_window", status.ada4355.sample_window);
  assignText(ada, "max_points", status.ada4355.max_points);
  assignText(ada, "spectrum_points", status.ada4355.max_points);
  assignText(ada, "raw_length", status.ada4355.raw?.length);
  assignText(ada, "raw_decim", status.ada4355.raw?.decim);
  assignText(ada, "frame_decim", status.ada4355.frame_decim_n);
  const filterControl = hexOrText(status.ada4355.filter?.control_hex, status.ada4355.filter?.control);
  if (filterControl !== undefined) ada.filter_control = filterControl;
  assignText(ada, "glitch_threshold", status.ada4355.filter?.glitch_threshold);
  assignText(ada, "lp_shift", status.ada4355.filter?.lp_shift);

  return settings;
}

function valueText(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value === null) return "null";
  return JSON.stringify(value);
}

export function flattenSettings(settings: Record<string, unknown>): SettingRow[] {
  const rows: SettingRow[] = [];

  const walk = (prefix: string, value: unknown) => {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      for (const key of Object.keys(value as Record<string, unknown>).sort()) {
        walk(prefix ? `${prefix}.${key}` : key, (value as Record<string, unknown>)[key]);
      }
      return;
    }
    rows.push({ key: prefix, value: valueText(value) });
  };

  walk("", settings);
  return rows.filter((row) => row.key.length > 0).sort((a, b) => a.key.localeCompare(b.key));
}
