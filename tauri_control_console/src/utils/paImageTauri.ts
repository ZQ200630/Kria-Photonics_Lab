import { invoke } from "@tauri-apps/api/core";
import type { PaImageProcessing, PaSeverity } from "./paImage";

export type PaParseIssue = {
  severity: PaSeverity;
  message: string;
  block_id: number | null;
  frame_id: number | null;
};

export type PaFrameMetadata = {
  reserved: number;
  global_shot_idx: number;
  y_points: number;
  x_points: number;
  frame_number: number;
  frame_idx: number;
  y_idx: number;
  x_idx: number;
  current_y: number;
  current_x: number;
  task_id: number;
};

export type PaFileSummary = {
  path: string;
  file_size: number;
  block_count: number;
  frame_count: number;
  bad_frame_count: number;
  block_id_gaps: number;
  frame_id_gaps: number;
  global_shot_gaps: number;
  frame_count_mismatches: number;
  first_block_id: number | null;
  last_block_id: number | null;
  first_frame_id: number | null;
  last_frame_id: number | null;
  first_global_shot_idx: number | null;
  last_global_shot_idx: number | null;
  detected_x_points: number | null;
  detected_y_points: number | null;
  detected_frame_number: number | null;
  detected_sample_count_min: number;
  detected_sample_count_max: number;
  severity: PaSeverity;
  issues: PaParseIssue[];
};

export type PaFrameTrace = {
  path: string;
  frame_index: number;
  frame_id: number;
  metadata: PaFrameMetadata | null;
  time_ns: number[];
  samples: number[];
  current_ua: number[];
};

export type PaImageBuildResult = {
  path: string;
  width: number;
  height: number;
  values: Array<number | null>;
  counts: number[];
  pixel_frame_indices: Array<number | null>;
  x_start: number | null;
  x_end: number | null;
  y_start: number | null;
  y_end: number | null;
  pixel_count: number;
  frame_count: number;
  bad_frame_count: number;
  severity: PaSeverity;
  issues: PaParseIssue[];
};

export type PaSeriesPoint = {
  frame_index: number;
  frame_id: number;
  global_shot_idx: number | null;
  current_x: number | null;
  current_y: number | null;
  ptp: number | null;
};

export type PaSeriesBuildResult = {
  path: string;
  frame_count: number;
  bad_frame_count: number;
  ptp_average: number | null;
  ptp_variance: number | null;
  ptp_std: number | null;
  ptp_min: number | null;
  ptp_max: number | null;
  points: PaSeriesPoint[];
  severity: PaSeverity;
  issues: PaParseIssue[];
};

export type PaImageBuildProgressEvent = {
  requestId: string;
  sourceFrameCount: number;
  totalSourceFrameCount?: number | null;
  elapsedMs: number;
  image?: PaImageBuildResult | null;
};

export function rustProcessingConfig(config: PaImageProcessing) {
  return {
    sample_interval_ns: config.sampleIntervalNs,
    sample_start_index: config.sampleStartIndex,
    sample_end_trim: config.sampleEndTrim,
    baseline_start_ns: config.baselineStartNs,
    baseline_end_ns: config.baselineEndNs,
    ptp_start_ns: config.ptpStartNs,
    ptp_end_ns: config.ptpEndNs,
    tz_ohm: config.tzOhm,
    vfs: config.vfs,
    zero_adc_code: config.zeroAdcCode,
  };
}

export const pickPaImageFile = () => invoke<string | null>("pa_image_pick_file");
export const scanPaImageFile = (path: string) => invoke<PaFileSummary>("pa_image_scan_path", { path });
export const readPaFrameTrace = (path: string, frameIndex: number, tzOhm: number, vfs: number, zeroAdcCode: number) =>
  invoke<PaFrameTrace>("pa_image_read_frame_path", { path, frameIndex, tzOhm, vfs, zeroAdcCode });
export const buildPaImage = (path: string, config: PaImageProcessing) =>
  invoke<PaImageBuildResult>("pa_image_build_path", { path, config: rustProcessingConfig(config) });
export const buildPaSeries = (path: string, config: PaImageProcessing) =>
  invoke<PaSeriesBuildResult>("pa_series_build_path", { path, config: rustProcessingConfig(config) });
export const buildPaImageRange = (path: string, config: PaImageProcessing, startFrameIndex: number, maxFrames: number) =>
  invoke<PaImageBuildResult>("pa_image_build_range_path", {
    path,
    config: rustProcessingConfig(config),
    startFrameIndex,
    maxFrames,
  });
export const buildPaImageStreamed = (
  path: string,
  config: PaImageProcessing,
  requestId: string,
  emitEverySourceFrames = 512,
  emitImageEverySourceFrames = 8192,
) =>
  invoke<PaImageBuildResult>("pa_image_build_path_streamed", {
    path,
    config: rustProcessingConfig(config),
    requestId,
    emitEverySourceFrames,
    emitImageEverySourceFrames,
  });
export const cancelPaImageBuild = (requestId: string) => invoke<void>("pa_image_cancel_build", { requestId });
export const setPaLiveImageProcessing = (config: PaImageProcessing) =>
  invoke<PaImageBuildResult>("pa_receiver_set_image_processing", { config: rustProcessingConfig(config) });
export const readPaLiveImage = () => invoke<PaImageBuildResult>("pa_receiver_live_image");
