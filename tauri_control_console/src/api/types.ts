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

export type AdaFilterStatus = {
  [key: string]: unknown;
  control?: number;
  control_hex?: string;
  enabled?: boolean;
  glitch_reject?: boolean;
  raw_use_filtered?: boolean;
  raw_glitch_reject?: boolean;
  spectrum_use_filtered?: boolean;
  monitor_use_filtered?: boolean;
  glitch_threshold?: number;
  lp_shift?: number;
  raw_lp_shift?: number;
  filtered_adc_last?: number;
  raw_filtered_adc_last?: number;
  glitch_reject_counter?: number;
};

export type AdaRawStatus = {
  [key: string]: unknown;
  control?: number;
  status?: number;
  status_hex?: string;
  length?: number;
  decim?: number;
  write_count?: number;
  capacity_samples?: number;
  buffer_words?: number;
  storage?: string;
};

export type AdaAnalogConfig = {
  available: boolean;
  gain_ohms: number | null;
  low_pass_enabled: boolean | null;
  low_pass_label: string | null;
  allowed_gain_ohms?: number[];
  allowed_low_pass?: Array<{ label: string; enabled: boolean }>;
  sysfs_dir?: string;
  error?: string;
};

export type AdaAnalogConfigUpdate = {
  gain_ohms?: number;
  low_pass_enabled?: boolean;
};

export type AdaStatus = {
  status_hex?: string;
  status_flags?: string[];
  monitor_avg?: number;
  monitor_min?: number;
  monitor_max?: number;
  monitor_counter?: number;
  relative_intensity_code?: number;
  total_frame_counter?: number;
  read_frame_counter?: number;
  read_buffer_id?: number;
  read_points_written?: number;
  sample_delay?: number;
  sample_window?: number;
  max_points?: number;
  frame_decim_n?: number;
  monitor_rate_hz?: number;
  monitor_decim_n?: number;
  filter?: AdaFilterStatus;
  raw?: AdaRawStatus;
};

export type SystemStatus = {
  tec: TecStatus;
  laser: LaserStatus;
  ada4355: AdaStatus;
  pa?: PaCaptureStatus;
  pa_scheduler?: PaSchedulerStatus;
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
  storage?: string;
  word_count?: number;
  raw_status?: number;
  raw_status_hex?: string;
  raw_write_count?: number;
  decim?: number;
};

export type PaCaptureParams = {
  x_start?: number;
  x_step?: number;
  x_points?: number;
  y_start?: number;
  y_step?: number;
  y_points?: number;
  frame_number?: number;
  task_id?: number;
  gap_time?: number;
  galvo_settle_time?: number;
  ld_trigger_time?: number;
  adc_trigger_time?: number;
  ld_time?: number;
  scan_mode?: number;
  return_mode?: number;
};

export type PaPointCaptureConfig = {
  manual_x: number;
  manual_y: number;
  period_cycles: number;
  shot_limit: number;
  pulse_enabled: boolean;
  capture_enabled: boolean;
  ld_delay_cycles: number;
  ld_width_cycles: number;
  adc_delay_cycles: number;
  adc_width_cycles: number;
};

export type PaSchedulerConfig = {
  mode: number;
  control?: number;
  period_cycles?: number;
  manual_x?: number;
  manual_y?: number;
  shot_limit?: number;
  pulse_phase_cycles?: number;
  ld_delay_cycles?: number;
  ld_width_cycles?: number;
  adc_delay_cycles?: number;
  adc_width_cycles?: number;
  waveform_control?: number;
  waveform_x_min?: number;
  waveform_x_max?: number;
  waveform_y_min?: number;
  waveform_y_max?: number;
  waveform_x_step?: number;
  waveform_y_step?: number;
};

export type PaSchedulerStatus = {
  available?: boolean;
  version?: number;
  mode?: number;
  mode_name?: string;
  fsm_state?: number;
  active?: boolean;
  capture_required?: boolean;
  capture_enabled?: boolean;
  running_without_capture?: boolean;
  parked?: boolean;
  stop_pending?: boolean;
  abort_observed?: boolean;
  fault_latched?: boolean;
  current_x?: number;
  current_y?: number;
  x_idx?: number;
  y_idx?: number;
  x_index?: number;
  y_index?: number;
  current_frame?: number;
  shot_count?: number;
  capture_count?: number;
  pixel_count?: number;
  command_count?: number;
  last_command?: number;
  stop_count?: number;
  park_count?: number;
  manual_update_count?: number;
  waveform_cycle_count?: number;
  fault_detail?: number;
  control_snapshot?: number;
  period_active?: number;
  last_error?: string;
  last_config?: PaSchedulerConfig | null;
  error?: string;
  raw?: Record<string, unknown>;
};

export type PaStreamDiagnosticIssue = {
  message: string;
  block_id?: number | null;
  frame_id?: number | null;
};

export type PaStreamDiagnostics = {
  records_checked?: number;
  data_records_checked?: number;
  blocks_checked?: number;
  frames_checked?: number;
  metadata_frames_checked?: number;
  record_sequence_gaps?: number;
  block_id_gaps?: number;
  frame_id_gaps?: number;
  global_shot_gaps?: number;
  frame_count_mismatches?: number;
  malformed_blocks?: number;
  malformed_frames?: number;
  metadata_parse_errors?: number;
  first_sequence?: number | null;
  last_sequence?: number | null;
  first_block_id?: number | null;
  last_block_id?: number | null;
  first_frame_id?: number | null;
  last_frame_id?: number | null;
  first_global_shot_idx?: number | null;
  last_global_shot_idx?: number | null;
  issues?: PaStreamDiagnosticIssue[];
};

export type PaAxisCaptureStatus = {
  running?: boolean;
  stop_requested?: boolean;
  removing?: boolean;
  frame_bytes?: number;
  superblock_bytes?: number;
  active_dma_count?: number;
  done_count?: number;
  ready_block_count?: number;
  free_block_count?: number;
  completed_frames?: number;
  aggregated_frames?: number;
  completed_blocks?: number;
  dropped_frames?: number;
  dropped_blocks?: number;
  draining_done?: boolean;
  submit_count?: number;
  callback_count?: number;
  rearm_count?: number;
  done_q_high_watermark?: number;
  ready_block_high_watermark?: number;
  free_block_low_watermark?: number;
  active_dma_low_watermark?: number;
  active_dma_zero_events?: number;
  done_q_overflow_count?: number;
  aggregate_fail_count?: number;
  rearm_fail_count?: number;
  abort_count?: number;
  copy_to_user_fault_count?: number;
};

export type PaPlCounters = {
  error?: string;
  status?: number;
  fault_code?: number;
  accepted_trigger_count?: number;
  rejected_trigger_busy_count?: number;
  busy_hold_events?: number;
  busy_hold_cycles?: number;
  busy_hold_max_cycles?: number;
  axis_tready_low_cycles?: number;
  axis_stall_events?: number;
  axis_stall_max_cycles?: number;
  fifo_overflow_count?: number;
  capture_done_count?: number;
  tx_done_count?: number;
};

export type PaCaptureStatus = {
  connected: boolean;
  running: boolean;
  stop_requested?: boolean;
  last_error: string;
  blocks_sent?: number;
  frames_sent?: number;
  bytes_sent?: number;
  expected_frames?: number;
  end_reason?: string;
  diagnostics?: PaStreamDiagnostics;
  last_block?: {
    block_id?: number;
    used_bytes?: number;
    frame_count?: number;
    first_frame_id?: number;
    last_frame_id?: number;
  } | null;
  axis_status_initial?: PaAxisCaptureStatus | null;
  axis_status_before_stop?: PaAxisCaptureStatus | null;
  axis_status_after_stop?: PaAxisCaptureStatus | null;
  axis_status_after_drain?: PaAxisCaptureStatus | null;
  axis_status_end?: PaAxisCaptureStatus | null;
  pl_counters?: PaPlCounters | null;
  pl_counters_initial?: PaPlCounters | null;
  pl_counters_latest?: PaPlCounters | null;
  pl_counters_end?: PaPlCounters | null;
  blocks_received?: number;
  frames_received?: number;
  output_path?: string;
  worker_alive?: boolean;
  client_peer?: string;
  client_local?: string;
  client_connected_at?: number;
  last_client_peer?: string;
  last_client_local?: string;
  last_client_disconnected_at?: number;
  connection_count?: number;
  rejected_connection_count?: number;
};

export type PaServiceResponse = {
  pa: PaCaptureStatus;
};

export type PaTcpListenerStatus = {
  host: string;
  port: number;
  listening: boolean;
  thread_started?: boolean;
  thread_alive?: boolean;
  accept_count?: number;
  last_client_addr?: string;
  last_accept_time?: number;
  last_error?: string;
};

export type PaDiagnostics = {
  ok: true;
  timestamp: number;
  pa: PaCaptureStatus;
  tcp_listener: PaTcpListenerStatus | null;
};

export type StatusEvent = { timestamp: number; status: SystemStatus };
export type SpectrumEvent = { timestamp: number; spectrum: Spectrum };
export type FaultEvent = { timestamp: number; signature: unknown[]; status: SystemStatus };
export type HeartbeatEvent = { timestamp: number };
