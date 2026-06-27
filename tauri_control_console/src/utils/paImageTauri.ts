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
  pixel_count: number;
  frame_count: number;
  bad_frame_count: number;
  severity: PaSeverity;
  issues: PaParseIssue[];
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
  };
}

export const pickPaImageFile = () => invoke<string | null>("pa_image_pick_file");
export const scanPaImageFile = (path: string) => invoke<PaFileSummary>("pa_image_scan_path", { path });
export const readPaFrameTrace = (path: string, frameIndex: number, tzOhm: number) =>
  invoke<PaFrameTrace>("pa_image_read_frame_path", { path, frameIndex, tzOhm });
export const buildPaImage = (path: string, config: PaImageProcessing) =>
  invoke<PaImageBuildResult>("pa_image_build_path", { path, config: rustProcessingConfig(config) });
