export type ApiOk<T> = T & { ok: true };
export type ApiError = { ok: false; error: string };

export type TecStatus = {
  status_hex?: string;
  status_flags?: string[];
  main_error_status?: number;
  main_error_status_hex?: string;
  error_flags?: string[];
  current_state?: number;
  sample_counter?: number;
  adc_raw_ch0?: number;
  temperature_measured_celsius?: number;
  temperature_filtered_celsius?: number;
  target_celsius?: number;
  error_celsius?: number;
  temp_measured_c?: number;
  temp_filtered_c?: number;
  target_c?: number;
  error_c?: number;
  temp_min_celsius?: number;
  temp_max_celsius?: number;
  temp_alpha?: number;
  rdy_timeout?: number;
  spi_clk_div?: number;
  active_dac_code?: number;
  manual_dac_code?: number;
  dac_min?: number;
  dac_max?: number;
  dac_bias?: number;
  dac_safe?: number;
  pid?: {
    kp?: number;
    ki?: number;
    kd?: number;
    integral_limit?: number;
    max_step?: number;
    p_term?: number;
    i_term?: number;
    d_term?: number;
    integral?: number;
    output_code?: number;
  };
  ramp?: {
    active?: boolean;
    enabled?: boolean;
    target_celsius?: number | null;
    current_celsius?: number | null;
    rate_c_per_s?: number;
    interval_ms?: number;
    last_update_time?: number | null;
  };
};

export type LaserActual = {
  ch0_internal?: number;
  ch1_internal?: number;
  ch0_current_mA?: number;
  ch1_current_mA?: number;
};

export type LaserFineScanSetpoint = {
  ch0_internal?: number;
  ch1_start_internal?: number;
  ch1_stop_internal?: number;
  ch1_step_internal?: number;
  dwell_ticks?: number;
  settle_ticks?: number;
  frames?: number;
  continuous?: boolean;
  ch0_current_mA?: number;
  ch1_start_current_mA?: number;
  ch1_stop_current_mA?: number;
};

export type LaserSafety = {
  ch0_min?: number;
  ch0_max?: number;
  ch1_min?: number;
  ch1_max?: number;
  ch0_soft_step?: number;
  ch1_soft_step?: number;
  ramp_interval?: number;
  dac_timeout?: number;
  watchdog_timeout?: number;
  enable_delay?: number;
  current_limit?: number;
  ch0_gain?: number;
  ch1_gain?: number;
  current_offset?: number;
};

export type LaserLockStatus = {
  target_adc?: number;
  polarity_invert?: boolean;
  bias_ch1_internal?: number;
  bias_ch1_current_mA?: number;
  ch1_min_internal?: number;
  ch1_max_internal?: number;
  kp?: number;
  ki?: number;
  max_step?: number;
  integral_limit?: number;
  locked_threshold?: number;
  loss_threshold?: number;
  status_hex?: string;
  status_flags?: string[];
  error?: number;
  integral?: number;
  output_ch1_internal?: number;
  output_ch1_current_mA?: number;
  loss_counter?: number;
  locked_counter?: number;
};

export type LaserAcquireStatus = {
  supported?: boolean;
  enabled?: boolean;
  active?: boolean;
  matched?: boolean;
  cancelled?: boolean;
  search_min?: number;
  search_max?: number;
  threshold?: number;
  status_hex?: string;
  match_code?: number;
  match_adc?: number;
  match_error?: number;
};

export type LaserStatus = {
  version?: number;
  version_hex?: string;
  control?: number;
  control_hex?: string;
  status_hex?: string;
  status_flags?: string[];
  fault_status_hex?: string;
  fault_flags?: string[];
  actual?: LaserActual;
  target?: LaserActual;
  static_setpoint?: LaserActual;
  fine_scan_setpoint?: LaserFineScanSetpoint;
  safety?: LaserSafety;
  lock?: LaserLockStatus;
  acquire?: LaserAcquireStatus;
  last_fb_adc?: number;
};

export type AdaStatus = {
  status_hex?: string;
  status_flags?: string[];
  monitor_avg?: number;
  monitor_min?: number;
  monitor_max?: number;
  relative_intensity_code?: number;
  total_frame_counter?: number;
  read_frame_counter?: number;
  read_buffer_id?: number;
  read_points_written?: number;
  monitor_rate_hz?: number;
  monitor_decim_n?: number;
  filter?: Record<string, unknown>;
  raw?: Record<string, unknown>;
};

export type SystemStatus = {
  tec: TecStatus;
  laser: LaserStatus;
  ada4355: AdaStatus;
};

export type Spectrum = {
  buffer_id: number;
  frame_counter: number;
  slow_index: number;
  count: number;
  duration_ms: number;
  dt_us_per_point: number;
  points: number[];
};

export type RawCapture = {
  count: number;
  samples: number[];
  raw_status?: number;
  raw_status_hex?: string;
  raw_write_count?: number;
  decim?: number;
};

export type StatusEvent = { timestamp: number; status: SystemStatus };
export type SpectrumEvent = { timestamp: number; spectrum: Spectrum };
export type FaultEvent = { timestamp: number; signature: unknown[]; status: SystemStatus };
export type HeartbeatEvent = { timestamp: number };
