import { invoke } from "@tauri-apps/api/core";
import type { PaFrameMetadata, PaParseIssue } from "./paImageTauri";
import type { ClassicalOrpamConfig } from "./classicalOrpam";

export type ResolvedClassicalOrpamConfig = {
  sample_count: number;
  source_start_index: number;
  source_end_index: number;
  valid_sample_count: number;
  baseline_start_index: number;
  baseline_end_index: number;
  processing_start_index: number;
  processing_end_index: number;
  output_start_index: number;
  output_end_index: number;
  output_sample_count: number;
  sampling_rate_hz: number;
  nyquist_hz: number;
  depth_sample_spacing_um: number;
  depth_start_um: number;
  depth_end_um: number;
  envelope_bytes: number;
  filtered_rf_bytes: number;
  axis_order: string;
  depth_equation: string;
  depth_calibration: string;
};

export type ClassicalOrpamDiagnostics = {
  source_frame_count: number;
  valid_frame_count: number;
  invalid_frame_count: number;
  missing_pixel_count: number;
  duplicate_pixel_count: number;
  all_zero_aline_count: number;
  raw_adc_min_clip_count: number;
  raw_adc_max_clip_count: number;
  nan_or_inf_count: number;
  map_ptp_pearson_correlation: number | null;
  warning_count: number;
  issues: PaParseIssue[];
};

export type ClassicalOrpamResult = {
  request_id: string;
  input_path: string;
  output_directory: string;
  shape_yxz: [number, number, number];
  envelope_path: string;
  filtered_rf_path: string | null;
  x_um_path: string;
  y_um_path: string;
  z_um_path: string;
  x_um: number[];
  y_um: number[];
  z_um: number[];
  metadata_path: string;
  resolved_config_path: string;
  npy_data_offset: number;
  map_values: Array<number | null>;
  pixel_frame_indices: Array<number | null>;
  pixel_counts: number[];
  qc_files: string[];
  x_start_um: number;
  x_end_um: number;
  y_start_um: number;
  y_end_um: number;
  z_start_um: number;
  z_end_um: number;
  product_kind: string;
  resolved: ResolvedClassicalOrpamConfig;
  diagnostics: ClassicalOrpamDiagnostics;
};

export type ClassicalOrpamProgressEvent = {
  requestId: string;
  sourceFrameCount: number;
  validFrameCount: number;
  completedRows: number;
  totalRows: number;
  elapsedMs: number;
  estimatedRemainingMs: number | null;
  stage: "parsing" | "processing" | "writing" | "qc";
  warningCount: number;
};

export type ClassicalAlineMetrics = {
  median_baseline_ua: number;
  baseline_noise_mad_ua: number;
  baseline_noise_rms_ua: number;
  positive_peak_ua: number;
  negative_peak_ua: number;
  output_ptp_ua: number;
  envelope_peak_ua: number;
  peak_valid_index: number;
  peak_time_ns: number;
  peak_depth_um: number;
  clipped_low_count: number;
  clipped_high_count: number;
};

export type ClassicalAlineView = {
  path: string;
  frame_index: number;
  frame_id: number;
  metadata: PaFrameMetadata | null;
  valid_time_ns: number[];
  raw_current_ua: number[];
  baseline_corrected_ua: number[];
  processing_offset: number;
  filtered_rf_ua: number[];
  envelope_ua: number[];
  output_offset: number;
  output_envelope_ua: number[];
  z_um: number[];
  metrics: ClassicalAlineMetrics;
  product_kind: string;
};

export type ClassicalVolumeSlice = {
  view: "xz" | "yz" | "xy";
  slice_index: number;
  width: number;
  height: number;
  values: Array<number | null>;
  horizontal_label: string;
  vertical_label: string;
  horizontal_start_um: number;
  horizontal_end_um: number;
  vertical_start_um: number;
  vertical_end_um: number;
};

export function clampClassicalSliceIndex(value: string | number, axisLength: number): number {
  const parsed = Number(value);
  const rounded = Number.isFinite(parsed) ? Math.round(parsed) : 0;
  return Math.max(0, Math.min(Math.max(0, Math.floor(axisLength) - 1), rounded));
}

export function rustClassicalConfig(config: ClassicalOrpamConfig) {
  return {
    sample_interval_ns: config.sampleIntervalNs,
    sample_start_index: Math.floor(config.sampleStartIndex),
    sample_end_trim: Math.floor(config.sampleEndTrim),
    baseline_start_ns: config.baselineStartNs,
    baseline_end_ns: config.baselineEndNs,
    processing_start_ns: config.processingStartNs,
    processing_end_ns: config.processingEndNs,
    output_start_ns: config.outputStartNs,
    output_end_ns: config.outputEndNs,
    bandpass_low_hz: config.bandpassLowHz,
    bandpass_high_hz: config.bandpassHighHz,
    filter_order: Math.floor(config.filterOrder),
    sound_speed_m_s: config.soundSpeedMS,
    t0_s: config.t0S,
    relative_depth: config.relativeDepth,
    tz_ohm: config.tzOhm,
    vfs: config.vfs,
    zero_adc_code: config.zeroAdcCode,
    chunk_rows: Math.floor(config.chunkRows),
    save_filtered_rf: config.saveFilteredRf,
    um_per_count: config.umPerCount,
    pipeline: {
      median_baseline_enabled: config.pipeline.medianBaselineEnabled,
      bandpass_enabled: config.pipeline.bandpassEnabled,
      hilbert_envelope_enabled: config.pipeline.hilbertEnvelopeEnabled,
    },
  };
}

export const pickClassicalOutputDirectory = () =>
  invoke<string | null>("pa_classical_pick_output_directory");

export const loadAdjacentPaMetadata = (path: string) =>
  invoke<unknown | null>("pa_classical_load_adjacent_metadata", { path });

export const loadClassicalPixelTraces = (
  path: string,
  frameIndex: number,
  config: ClassicalOrpamConfig,
) =>
  invoke<ClassicalAlineView>("pa_classical_load_pixel_traces", {
    path,
    frameIndex,
    config: rustClassicalConfig(config),
  });

export const reconstructClassicalOrpam = (
  path: string,
  outputDirectory: string,
  config: ClassicalOrpamConfig,
  requestId: string,
) =>
  invoke<ClassicalOrpamResult>("pa_classical_reconstruct_path_streamed", {
    path,
    outputDirectory,
    config: rustClassicalConfig(config),
    requestId,
  });

export const cancelClassicalOrpam = (requestId: string) =>
  invoke<void>("pa_classical_cancel_reconstruction", { requestId });

export const loadClassicalVolumeSlice = (
  result: ClassicalOrpamResult,
  view: "xz" | "yz" | "xy",
  sliceIndex: number,
) =>
  invoke<ClassicalVolumeSlice>("pa_classical_load_volume_slice", {
    envelopePath: result.envelope_path,
    dataOffset: result.npy_data_offset,
    shapeYxz: result.shape_yxz,
    view,
    sliceIndex,
    xRangeUm: [result.x_start_um, result.x_end_um],
    yRangeUm: [result.y_start_um, result.y_end_um],
    zRangeUm: [result.z_start_um, result.z_end_um],
  });
