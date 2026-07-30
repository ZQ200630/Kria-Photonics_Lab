use std::collections::HashSet;
use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Instant;

use rustfft::{num_complex::Complex, Fft, FftPlanner};
use sci_rs::signal::filter::design::{
    butter_dyn, DigitalFilter, FilterBandType, FilterOutputType, Sos,
};
use sci_rs::signal::filter::sosfiltfilt_dyn;

use crate::npy::{create_zeroed_f32, read_f32_at, write_f32_at, write_f64_vector, NpyLayout};
use crate::pa_image::{
    parse_metadata, read_frame_trace_from_legacy_file, scan_legacy_file,
    signed_code_to_current_ua, visit_legacy_frames, PaFrameMetadata, PaParseIssue,
    PaSeverity, PA_METADATA_BYTES,
};

#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
pub struct ClassicalOrpamPipeline {
    pub median_baseline_enabled: bool,
    pub bandpass_enabled: bool,
    pub hilbert_envelope_enabled: bool,
}

impl Default for ClassicalOrpamPipeline {
    fn default() -> Self {
        Self {
            median_baseline_enabled: true,
            bandpass_enabled: true,
            hilbert_envelope_enabled: true,
        }
    }
}

#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
pub struct ClassicalOrpamConfig {
    pub sample_interval_ns: f64,
    pub sample_start_index: usize,
    pub sample_end_trim: usize,
    pub baseline_start_ns: f64,
    pub baseline_end_ns: f64,
    pub processing_start_ns: f64,
    pub processing_end_ns: f64,
    pub output_start_ns: f64,
    pub output_end_ns: f64,
    pub bandpass_low_hz: f64,
    pub bandpass_high_hz: f64,
    pub filter_order: usize,
    pub sound_speed_m_s: f64,
    pub t0_s: f64,
    pub relative_depth: bool,
    pub tz_ohm: f64,
    pub vfs: f64,
    pub zero_adc_code: f64,
    pub chunk_rows: usize,
    pub save_filtered_rf: bool,
    pub um_per_count: f64,
    pub pipeline: ClassicalOrpamPipeline,
}

impl Default for ClassicalOrpamConfig {
    fn default() -> Self {
        Self {
            sample_interval_ns: 8.0,
            sample_start_index: 10,
            sample_end_trim: 50,
            baseline_start_ns: 248.0,
            baseline_end_ns: 1104.0,
            processing_start_ns: 0.0,
            processing_end_ns: 8000.0,
            output_start_ns: 1544.0,
            output_end_ns: 5088.0,
            bandpass_low_hz: 500_000.0,
            bandpass_high_hz: 25_000_000.0,
            filter_order: 4,
            sound_speed_m_s: 1500.0,
            t0_s: 0.0,
            relative_depth: true,
            tz_ohm: 2000.0,
            vfs: 1.0,
            zero_adc_code: 27034.0,
            chunk_rows: 8,
            save_filtered_rf: false,
            um_per_count: 0.1325,
            pipeline: ClassicalOrpamPipeline::default(),
        }
    }
}

#[derive(Debug, Clone)]
pub struct ClassicalOrpamRequest {
    pub input_path: PathBuf,
    pub output_directory: PathBuf,
    pub config: ClassicalOrpamConfig,
    pub request_id: String,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct ResolvedClassicalOrpamConfig {
    pub sample_count: usize,
    pub source_start_index: usize,
    pub source_end_index: usize,
    pub valid_sample_count: usize,
    pub baseline_start_index: usize,
    pub baseline_end_index: usize,
    pub processing_start_index: usize,
    pub processing_end_index: usize,
    pub output_start_index: usize,
    pub output_end_index: usize,
    pub output_sample_count: usize,
    pub sampling_rate_hz: f64,
    pub nyquist_hz: f64,
    pub depth_sample_spacing_um: f64,
    pub depth_start_um: f64,
    pub depth_end_um: f64,
    pub envelope_bytes: u64,
    pub filtered_rf_bytes: u64,
    pub axis_order: String,
    pub depth_equation: String,
    pub depth_calibration: String,
    pub config: ClassicalOrpamConfig,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct ClassicalOrpamDiagnostics {
    pub source_frame_count: u64,
    pub valid_frame_count: u64,
    pub invalid_frame_count: u64,
    pub missing_pixel_count: u64,
    pub duplicate_pixel_count: u64,
    pub all_zero_aline_count: u64,
    pub raw_adc_min_clip_count: u64,
    pub raw_adc_max_clip_count: u64,
    pub nan_or_inf_count: u64,
    pub warning_count: usize,
    pub issues: Vec<PaParseIssue>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct ClassicalOrpamResult {
    pub request_id: String,
    pub input_path: String,
    pub output_directory: String,
    pub shape_yxz: [usize; 3],
    pub envelope_path: String,
    pub filtered_rf_path: Option<String>,
    pub x_um_path: String,
    pub y_um_path: String,
    pub z_um_path: String,
    pub metadata_path: String,
    pub resolved_config_path: String,
    pub npy_data_offset: u64,
    pub map_values: Vec<Option<f32>>,
    pub pixel_counts: Vec<u32>,
    pub x_start_um: f64,
    pub x_end_um: f64,
    pub y_start_um: f64,
    pub y_end_um: f64,
    pub z_start_um: f64,
    pub z_end_um: f64,
    pub product_kind: String,
    pub resolved: ResolvedClassicalOrpamConfig,
    pub diagnostics: ClassicalOrpamDiagnostics,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct ClassicalOrpamProgress {
    pub source_frame_count: u64,
    pub valid_frame_count: u64,
    pub completed_rows: usize,
    pub total_rows: usize,
    pub elapsed_ms: u64,
    pub estimated_remaining_ms: Option<u64>,
    pub stage: String,
    pub warning_count: usize,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct ClassicalAlineMetrics {
    pub median_baseline_ua: f64,
    pub baseline_noise_mad_ua: f64,
    pub baseline_noise_rms_ua: f64,
    pub positive_peak_ua: f64,
    pub negative_peak_ua: f64,
    pub output_ptp_ua: f64,
    pub envelope_peak_ua: f64,
    pub peak_valid_index: usize,
    pub peak_time_ns: f64,
    pub peak_depth_um: f64,
    pub clipped_low_count: usize,
    pub clipped_high_count: usize,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct ClassicalAlineView {
    pub path: String,
    pub frame_index: u64,
    pub frame_id: u64,
    pub metadata: Option<PaFrameMetadata>,
    pub valid_time_ns: Vec<f64>,
    pub raw_current_ua: Vec<f64>,
    pub baseline_corrected_ua: Vec<f64>,
    pub processing_offset: usize,
    pub filtered_rf_ua: Vec<f64>,
    pub envelope_ua: Vec<f64>,
    pub output_offset: usize,
    pub output_envelope_ua: Vec<f64>,
    pub z_um: Vec<f64>,
    pub metrics: ClassicalAlineMetrics,
    pub product_kind: String,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct ClassicalVolumeSlice {
    pub view: String,
    pub slice_index: usize,
    pub width: usize,
    pub height: usize,
    pub values: Vec<Option<f32>>,
    pub horizontal_label: String,
    pub vertical_label: String,
    pub horizontal_start_um: f64,
    pub horizontal_end_um: f64,
    pub vertical_start_um: f64,
    pub vertical_end_um: f64,
}

struct AlineProcessor {
    resolved: ResolvedClassicalOrpamConfig,
    sos: Vec<Sos<f64>>,
    fft_forward: Arc<dyn Fft<f64>>,
    fft_inverse: Arc<dyn Fft<f64>>,
}

struct ProcessedAline {
    raw_valid: Vec<f64>,
    corrected_valid: Vec<f64>,
    filtered_processing: Vec<f64>,
    envelope_processing: Vec<f64>,
    output_envelope: Vec<f32>,
    metrics: ClassicalAlineMetrics,
}

fn checked_window(
    label: &str,
    start_ns: f64,
    end_ns: f64,
    interval_ns: f64,
    valid_len: usize,
) -> Result<(usize, usize), String> {
    if !start_ns.is_finite() || !end_ns.is_finite() || start_ns < 0.0 || end_ns <= start_ns {
        return Err(format!("{label} window must be finite, non-negative and increasing"));
    }
    let start = (start_ns / interval_ns).ceil() as usize;
    let end = (end_ns / interval_ns).ceil() as usize;
    if start >= end || end > valid_len {
        return Err(format!(
            "{label} window [{start_ns},{end_ns}) ns maps to [{start},{end}) outside valid trace [0,{valid_len})"
        ));
    }
    Ok((start, end))
}

pub fn resolve_classical_orpam_config(
    config: &ClassicalOrpamConfig,
    sample_count: usize,
    width: usize,
    height: usize,
) -> Result<ResolvedClassicalOrpamConfig, String> {
    if !config.sample_interval_ns.is_finite() || config.sample_interval_ns <= 0.0 {
        return Err("sample interval must be finite and positive".to_string());
    }
    if config.sample_start_index >= sample_count {
        return Err("sample start index must be smaller than source sample count".to_string());
    }
    if config.sample_end_trim >= sample_count.saturating_sub(config.sample_start_index) {
        return Err("sample end trim leaves an empty valid trace".to_string());
    }
    if !config.tz_ohm.is_finite() || config.tz_ohm == 0.0 {
        return Err("transimpedance must be finite and non-zero".to_string());
    }
    if !config.vfs.is_finite() || !config.zero_adc_code.is_finite() {
        return Err("VFS and zero ADC code must be finite".to_string());
    }
    if !config.sound_speed_m_s.is_finite() || config.sound_speed_m_s <= 0.0 {
        return Err("sound speed must be finite and positive".to_string());
    }
    if !config.t0_s.is_finite() {
        return Err("t0 must be finite".to_string());
    }
    if !config.um_per_count.is_finite() || config.um_per_count <= 0.0 {
        return Err("x/y calibration must be finite and positive".to_string());
    }
    if config.chunk_rows == 0 {
        return Err("chunk rows must be at least 1".to_string());
    }

    let sampling_rate_hz = 1.0e9 / config.sample_interval_ns;
    let nyquist_hz = sampling_rate_hz / 2.0;
    if config.pipeline.bandpass_enabled {
        if config.filter_order == 0 {
            return Err("Butterworth order must be at least 1".to_string());
        }
        if !config.bandpass_low_hz.is_finite()
            || !config.bandpass_high_hz.is_finite()
            || config.bandpass_low_hz <= 0.0
            || config.bandpass_high_hz <= config.bandpass_low_hz
            || config.bandpass_high_hz >= nyquist_hz
        {
            return Err(format!(
                "band-pass must satisfy 0 < low < high < Nyquist ({nyquist_hz} Hz)"
            ));
        }
    }

    let source_start_index = config.sample_start_index;
    let source_end_index = sample_count - config.sample_end_trim;
    let valid_sample_count = source_end_index - source_start_index;
    let (baseline_start_index, baseline_end_index) = checked_window(
        "baseline",
        config.baseline_start_ns,
        config.baseline_end_ns,
        config.sample_interval_ns,
        valid_sample_count,
    )?;
    let (processing_start_index, processing_end_index) = checked_window(
        "processing",
        config.processing_start_ns,
        config.processing_end_ns,
        config.sample_interval_ns,
        valid_sample_count,
    )?;
    let (output_start_index, output_end_index) = checked_window(
        "output",
        config.output_start_ns,
        config.output_end_ns,
        config.sample_interval_ns,
        valid_sample_count,
    )?;
    if output_start_index < processing_start_index || output_end_index > processing_end_index {
        return Err("output window must be contained in the processing window".to_string());
    }
    let processing_len = processing_end_index - processing_start_index;
    let section_count = if config.pipeline.bandpass_enabled {
        config.filter_order
    } else {
        0
    };
    let minimum_filter_len = 3 * (2 * section_count + 1) + 1;
    if config.pipeline.bandpass_enabled && processing_len < minimum_filter_len {
        return Err(format!(
            "processing window needs at least {minimum_filter_len} samples for zero-phase SOS padding"
        ));
    }

    let output_sample_count = output_end_index - output_start_index;
    let depth_sample_spacing_um = config.sound_speed_m_s * config.sample_interval_ns * 1.0e-3;
    let absolute_depth = |index: usize| {
        config.sound_speed_m_s
            * (index as f64 * config.sample_interval_ns * 1.0e-9 - config.t0_s)
            * 1.0e6
    };
    let first_depth = absolute_depth(output_start_index);
    let coordinate = |index: usize| {
        let depth = absolute_depth(index);
        if config.relative_depth {
            depth - first_depth
        } else {
            depth
        }
    };
    let depth_start_um = coordinate(output_start_index);
    let depth_end_um = coordinate(output_end_index - 1);
    let voxel_count = (width as u64)
        .checked_mul(height as u64)
        .and_then(|value| value.checked_mul(output_sample_count as u64))
        .ok_or_else(|| "reconstruction volume size overflows".to_string())?;
    let envelope_bytes = voxel_count
        .checked_mul(4)
        .ok_or_else(|| "envelope byte count overflows".to_string())?;
    let filtered_rf_bytes = if config.save_filtered_rf {
        envelope_bytes
    } else {
        0
    };

    Ok(ResolvedClassicalOrpamConfig {
        sample_count,
        source_start_index,
        source_end_index,
        valid_sample_count,
        baseline_start_index,
        baseline_end_index,
        processing_start_index,
        processing_end_index,
        output_start_index,
        output_end_index,
        output_sample_count,
        sampling_rate_hz,
        nyquist_hz,
        depth_sample_spacing_um,
        depth_start_um,
        depth_end_um,
        envelope_bytes,
        filtered_rf_bytes,
        axis_order: "[y,x,z] C-order".to_string(),
        depth_equation: "z = c * (t - t0); one-way PA time of flight; no factor of 1/2".to_string(),
        depth_calibration: if config.relative_depth {
            "relative depth; t0 is not surface-calibrated; delta z is axial sample spacing, not axial resolution".to_string()
        } else {
            "absolute coordinate requested from user t0; delta z is axial sample spacing, not axial resolution".to_string()
        },
        config: config.clone(),
    })
}
fn median(values: &[f64]) -> f64 {
    let mut sorted = values.to_vec();
    sorted.sort_by(f64::total_cmp);
    let middle = sorted.len() / 2;
    if sorted.len() % 2 == 0 {
        (sorted[middle - 1] + sorted[middle]) / 2.0
    } else {
        sorted[middle]
    }
}

fn rms(values: &[f64]) -> f64 {
    if values.is_empty() {
        return 0.0;
    }
    (values.iter().map(|value| value * value).sum::<f64>() / values.len() as f64).sqrt()
}

fn hilbert_envelope(
    values: &[f64],
    forward: &Arc<dyn Fft<f64>>,
    inverse: &Arc<dyn Fft<f64>>,
) -> Vec<f64> {
    let len = values.len();
    let mut spectrum: Vec<Complex<f64>> = values
        .iter()
        .map(|value| Complex::new(*value, 0.0))
        .collect();
    forward.process(&mut spectrum);
    if len % 2 == 0 {
        for bin in spectrum.iter_mut().take(len / 2).skip(1) {
            *bin *= 2.0;
        }
        for bin in spectrum.iter_mut().skip(len / 2 + 1) {
            *bin = Complex::new(0.0, 0.0);
        }
    } else {
        for bin in spectrum.iter_mut().take((len + 1) / 2).skip(1) {
            *bin *= 2.0;
        }
        for bin in spectrum.iter_mut().skip((len + 1) / 2) {
            *bin = Complex::new(0.0, 0.0);
        }
    }
    inverse.process(&mut spectrum);
    let scale = len as f64;
    spectrum.into_iter().map(|value| value.norm() / scale).collect()
}

fn design_bandpass(config: &ResolvedClassicalOrpamConfig) -> Result<Vec<Sos<f64>>, String> {
    if !config.config.pipeline.bandpass_enabled {
        return Ok(Vec::new());
    }
    match butter_dyn::<f64>(
        config.config.filter_order,
        vec![config.config.bandpass_low_hz, config.config.bandpass_high_hz],
        Some(FilterBandType::Bandpass),
        Some(false),
        Some(FilterOutputType::Sos),
        Some(config.sampling_rate_hz),
    ) {
        DigitalFilter::Sos(filter) => Ok(filter.sos),
        _ => Err("Butterworth design did not return second-order sections".to_string()),
    }
}

impl AlineProcessor {
    fn new(resolved: ResolvedClassicalOrpamConfig) -> Result<Self, String> {
        let sos = design_bandpass(&resolved)?;
        let processing_len = resolved.processing_end_index - resolved.processing_start_index;
        let mut planner = FftPlanner::<f64>::new();
        let fft_forward = planner.plan_fft_forward(processing_len);
        let fft_inverse = planner.plan_fft_inverse(processing_len);
        Ok(Self {
            resolved,
            sos,
            fft_forward,
            fft_inverse,
        })
    }

    fn depth_um(&self, valid_index: usize) -> f64 {
        let config = &self.resolved.config;
        let absolute = config.sound_speed_m_s
            * (valid_index as f64 * config.sample_interval_ns * 1.0e-9 - config.t0_s)
            * 1.0e6;
        if config.relative_depth {
            let first = config.sound_speed_m_s
                * (self.resolved.output_start_index as f64
                    * config.sample_interval_ns
                    * 1.0e-9
                    - config.t0_s)
                * 1.0e6;
            absolute - first
        } else {
            absolute
        }
    }

    fn process_codes(&self, samples: &[i16]) -> Result<ProcessedAline, String> {
        if samples.len() != self.resolved.sample_count {
            return Err(format!(
                "A-line has {} samples; expected {}",
                samples.len(), self.resolved.sample_count
            ));
        }
        let config = &self.resolved.config;
        let raw_valid: Vec<f64> = samples
            [self.resolved.source_start_index..self.resolved.source_end_index]
            .iter()
            .map(|code| {
                signed_code_to_current_ua(*code, config.tz_ohm, config.vfs, config.zero_adc_code)
            })
            .collect();
        let baseline_values = &raw_valid
            [self.resolved.baseline_start_index..self.resolved.baseline_end_index];
        let baseline = if config.pipeline.median_baseline_enabled {
            median(baseline_values)
        } else {
            0.0
        };
        let corrected_valid: Vec<f64> = raw_valid.iter().map(|value| value - baseline).collect();
        let processing = &corrected_valid
            [self.resolved.processing_start_index..self.resolved.processing_end_index];
        let filtered_processing = if config.pipeline.bandpass_enabled {
            sosfiltfilt_dyn(processing.iter(), &self.sos)
        } else {
            processing.to_vec()
        };
        let envelope_processing = if config.pipeline.hilbert_envelope_enabled {
            hilbert_envelope(
                &filtered_processing,
                &self.fft_forward,
                &self.fft_inverse,
            )
        } else {
            filtered_processing.iter().map(|value| value.abs()).collect()
        };
        let output_start = self.resolved.output_start_index
            - self.resolved.processing_start_index;
        let output_end = self.resolved.output_end_index
            - self.resolved.processing_start_index;
        let output_envelope: Vec<f32> = envelope_processing[output_start..output_end]
            .iter()
            .map(|value| *value as f32)
            .collect();

        let baseline_corrected: Vec<f64> = baseline_values
            .iter()
            .map(|value| value - baseline)
            .collect();
        let baseline_noise_mad_ua = median(
            &baseline_corrected
                .iter()
                .map(|value| value.abs())
                .collect::<Vec<_>>(),
        );
        let baseline_noise_rms_ua = rms(&baseline_corrected);
        let output_filtered = &filtered_processing[output_start..output_end];
        let positive_peak_ua = output_filtered
            .iter()
            .copied()
            .fold(f64::NEG_INFINITY, f64::max);
        let negative_peak_ua = output_filtered
            .iter()
            .copied()
            .fold(f64::INFINITY, f64::min);
        let output_ptp_ua = positive_peak_ua - negative_peak_ua;
        let (peak_offset, envelope_peak_ua) = output_envelope
            .iter()
            .copied()
            .enumerate()
            .max_by(|left, right| left.1.total_cmp(&right.1))
            .unwrap_or((0, 0.0));
        let peak_valid_index = self.resolved.output_start_index + peak_offset;
        let clipped_low_count = samples.iter().filter(|value| **value == i16::MIN).count();
        let clipped_high_count = samples.iter().filter(|value| **value == i16::MAX).count();
        Ok(ProcessedAline {
            raw_valid,
            corrected_valid,
            filtered_processing,
            envelope_processing,
            output_envelope,
            metrics: ClassicalAlineMetrics {
                median_baseline_ua: baseline,
                baseline_noise_mad_ua,
                baseline_noise_rms_ua,
                positive_peak_ua,
                negative_peak_ua,
                output_ptp_ua,
                envelope_peak_ua: envelope_peak_ua as f64,
                peak_valid_index,
                peak_time_ns: peak_valid_index as f64 * config.sample_interval_ns,
                peak_depth_um: self.depth_um(peak_valid_index),
                clipped_low_count,
                clipped_high_count,
            },
        })
    }
}

fn decode_samples(raw: &[u8]) -> Vec<i16> {
    raw.chunks_exact(2)
        .map(|bytes| i16::from_le_bytes([bytes[0], bytes[1]]))
        .collect()
}

fn product_kind(config: &ClassicalOrpamConfig) -> String {
    if config.pipeline.hilbert_envelope_enabled {
        "hilbert_envelope_linear".to_string()
    } else {
        "absolute_signed_pipeline_output_linear".to_string()
    }
}

pub fn process_classical_aline(
    path: &Path,
    frame_index: u64,
    config: &ClassicalOrpamConfig,
) -> Result<ClassicalAlineView, String> {
    let trace = read_frame_trace_from_legacy_file(
        path,
        frame_index,
        config.tz_ohm,
        config.vfs,
        config.zero_adc_code,
    )?;
    let resolved = resolve_classical_orpam_config(config, trace.samples.len(), 1, 1)?;
    let processor = AlineProcessor::new(resolved.clone())?;
    let processed = processor.process_codes(&trace.samples)?;
    let output_start_in_processing = resolved.output_start_index - resolved.processing_start_index;
    let z_um: Vec<f64> = (resolved.output_start_index..resolved.output_end_index)
        .map(|index| processor.depth_um(index))
        .collect();
    Ok(ClassicalAlineView {
        path: path.display().to_string(),
        frame_index,
        frame_id: trace.frame_id,
        metadata: trace.metadata,
        valid_time_ns: (0..resolved.valid_sample_count)
            .map(|index| index as f64 * config.sample_interval_ns)
            .collect(),
        raw_current_ua: processed.raw_valid,
        baseline_corrected_ua: processed.corrected_valid,
        processing_offset: resolved.processing_start_index,
        filtered_rf_ua: processed.filtered_processing,
        envelope_ua: processed.envelope_processing,
        output_offset: output_start_in_processing,
        output_envelope_ua: processed
            .output_envelope
            .iter()
            .map(|value| *value as f64)
            .collect(),
        z_um,
        metrics: processed.metrics,
        product_kind: product_kind(config),
    })
}
fn write_json_new<T: serde::Serialize>(path: &Path, value: &T) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(value)
        .map_err(|err| format!("serialize {} failed: {err}", path.display()))?;
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|err| format!("create {} failed: {err}", path.display()))?;
    file.write_all(&bytes)
        .map_err(|err| format!("write {} failed: {err}", path.display()))?;
    file.flush()
        .map_err(|err| format!("flush {} failed: {err}", path.display()))
}

fn resolved_coordinates(
    values: Vec<Option<f64>>,
    point_count: usize,
    um_per_count: f64,
) -> Vec<f64> {
    let known: Vec<(usize, f64)> = values
        .iter()
        .enumerate()
        .filter_map(|(index, value)| value.map(|coordinate| (index, coordinate * um_per_count)))
        .collect();
    if known.is_empty() {
        return (0..point_count)
            .map(|index| index as f64 * um_per_count)
            .collect();
    }
    let first = known.first().copied().unwrap_or((0, 0.0));
    let last = known.last().copied().unwrap_or(first);
    let step = if last.0 > first.0 {
        (last.1 - first.1) / (last.0 - first.0) as f64
    } else {
        um_per_count
    };
    (0..point_count)
        .map(|index| values[index].map(|value| value * um_per_count).unwrap_or(first.1 + (index as f64 - first.0 as f64) * step))
        .collect()
}

fn progress_event(
    started_at: Instant,
    source_frame_count: u64,
    valid_frame_count: u64,
    completed_rows: usize,
    total_rows: usize,
    stage: &str,
    warning_count: usize,
) -> ClassicalOrpamProgress {
    let elapsed_ms = started_at.elapsed().as_millis().min(u128::from(u64::MAX)) as u64;
    let estimated_remaining_ms = if completed_rows > 0 && completed_rows < total_rows {
        Some(
            (elapsed_ms as f64 * (total_rows - completed_rows) as f64 / completed_rows as f64)
                .round() as u64,
        )
    } else if completed_rows >= total_rows {
        Some(0)
    } else {
        None
    };
    ClassicalOrpamProgress {
        source_frame_count,
        valid_frame_count,
        completed_rows,
        total_rows,
        elapsed_ms,
        estimated_remaining_ms,
        stage: stage.to_string(),
        warning_count,
    }
}

pub fn reconstruct_classical_orpam<F, C>(
    request: &ClassicalOrpamRequest,
    mut on_progress: F,
    mut is_cancelled: C,
) -> Result<ClassicalOrpamResult, String>
where
    F: FnMut(ClassicalOrpamProgress) -> Result<(), String>,
    C: FnMut() -> bool,
{
    let started_at = Instant::now();
    let summary = scan_legacy_file(&request.input_path)?;
    let width = usize::from(
        summary
            .detected_x_points
            .ok_or_else(|| "legacy file has no valid x_points metadata".to_string())?,
    );
    let height = usize::from(
        summary
            .detected_y_points
            .ok_or_else(|| "legacy file has no valid y_points metadata".to_string())?,
    );
    if summary.detected_sample_count_min == 0
        || summary.detected_sample_count_min != summary.detected_sample_count_max
    {
        return Err(format!(
            "classical reconstruction requires one consistent waveform length; detected {}-{} samples",
            summary.detected_sample_count_min, summary.detected_sample_count_max
        ));
    }
    let resolved = resolve_classical_orpam_config(
        &request.config,
        summary.detected_sample_count_min,
        width,
        height,
    )?;
    let processor = AlineProcessor::new(resolved.clone())?;
    fs::create_dir_all(&request.output_directory).map_err(|err| {
        format!(
            "create output directory {} failed: {err}",
            request.output_directory.display()
        )
    })?;

    let envelope_path = request.output_directory.join("envelope_linear.npy");
    let envelope_partial_path = request
        .output_directory
        .join("envelope_linear.npy.partial");
    let filtered_rf_path = request.output_directory.join("filtered_rf.npy");
    let filtered_rf_partial_path = request
        .output_directory
        .join("filtered_rf.npy.partial");
    let x_um_path = request.output_directory.join("x_um.npy");
    let y_um_path = request.output_directory.join("y_um.npy");
    let z_um_path = request.output_directory.join("z_um.npy");
    let metadata_path = request
        .output_directory
        .join("reconstruction_metadata.json");
    let resolved_config_path = request.output_directory.join("resolved_config.json");
    let required_paths = [
        &envelope_path,
        &envelope_partial_path,
        &x_um_path,
        &y_um_path,
        &z_um_path,
        &metadata_path,
        &resolved_config_path,
    ];
    for path in required_paths {
        if path.exists() {
            return Err(format!(
                "refusing to overwrite existing reconstruction output {}",
                path.display()
            ));
        }
    }
    if request.config.save_filtered_rf
        && (filtered_rf_path.exists() || filtered_rf_partial_path.exists())
    {
        return Err(format!(
            "refusing to overwrite existing reconstruction output {}",
            filtered_rf_path.display()
        ));
    }

    let shape = [height, width, resolved.output_sample_count];
    let layout = create_zeroed_f32(&envelope_partial_path, &shape)?;
    let mut envelope_file = OpenOptions::new()
        .read(true)
        .write(true)
        .open(&envelope_partial_path)
        .map_err(|err| format!("open {} failed: {err}", envelope_partial_path.display()))?;
    let filtered_layout = if request.config.save_filtered_rf {
        Some(create_zeroed_f32(&filtered_rf_partial_path, &shape)?)
    } else {
        None
    };
    let mut filtered_file = if request.config.save_filtered_rf {
        Some(
            OpenOptions::new()
                .read(true)
                .write(true)
                .open(&filtered_rf_partial_path)
                .map_err(|err| {
                    format!("open {} failed: {err}", filtered_rf_partial_path.display())
                })?,
        )
    } else {
        None
    };

    let pixel_count = width * height;
    let mut counts = vec![0u32; pixel_count];
    let mut map_values = vec![None::<f32>; pixel_count];
    let mut x_coordinates = vec![None::<f64>; width];
    let mut y_coordinates = vec![None::<f64>; height];
    let mut source_frame_count = 0u64;
    let mut valid_frame_count = 0u64;
    let mut invalid_frame_count = 0u64;
    let mut all_zero_aline_count = 0u64;
    let mut raw_adc_min_clip_count = 0u64;
    let mut raw_adc_max_clip_count = 0u64;
    let mut nan_or_inf_count = 0u64;
    let mut issues = summary.issues.clone();
    let stream_issues = std::cell::RefCell::new(Vec::<PaParseIssue>::new());
    let stream_bad_frame_count = std::cell::Cell::new(0u64);
    let mut completed_rows = HashSet::<usize>::new();
    let emit_interval = (request.config.chunk_rows * width).max(512) as u64;
    let mut last_emit = 0u64;

    visit_legacy_frames(
        &request.input_path,
        |frame| {
            source_frame_count = frame.frame_index + 1;
            if is_cancelled() {
                return Err(format!(
                    "classical reconstruction cancelled; partial output retained at {}",
                    envelope_partial_path.display()
                ));
            }
            if frame.payload.len() < PA_METADATA_BYTES {
                invalid_frame_count += 1;
                return Ok(true);
            }
            let metadata = match parse_metadata(&frame.payload[..PA_METADATA_BYTES]) {
                Ok(metadata) => metadata,
                Err(error) => {
                    invalid_frame_count += 1;
                    issues.push(PaParseIssue {
                        severity: PaSeverity::Warning,
                        message: format!("frame {} metadata parse failed: {error}", frame.frame_id),
                        block_id: Some(frame.block_id),
                        frame_id: Some(frame.frame_id),
                    });
                    return Ok(true);
                }
            };
            if usize::from(metadata.x_points) != width
                || usize::from(metadata.y_points) != height
                || usize::from(metadata.x_idx) >= width
                || usize::from(metadata.y_idx) >= height
            {
                invalid_frame_count += 1;
                issues.push(PaParseIssue {
                    severity: PaSeverity::Warning,
                    message: format!(
                        "frame {} metadata position {},{} or dimensions {}x{} are invalid for {}x{}",
                        frame.frame_id,
                        metadata.x_idx,
                        metadata.y_idx,
                        metadata.x_points,
                        metadata.y_points,
                        width,
                        height
                    ),
                    block_id: Some(frame.block_id),
                    frame_id: Some(frame.frame_id),
                });
                return Ok(true);
            }
            let sample_bytes = &frame.payload[PA_METADATA_BYTES..];
            if sample_bytes.len() % 2 != 0
                || sample_bytes.len() / 2 != resolved.sample_count
            {
                invalid_frame_count += 1;
                issues.push(PaParseIssue {
                    severity: PaSeverity::Warning,
                    message: format!(
                        "frame {} contains {} waveform bytes; expected {} samples",
                        frame.frame_id,
                        sample_bytes.len(),
                        resolved.sample_count
                    ),
                    block_id: Some(frame.block_id),
                    frame_id: Some(frame.frame_id),
                });
                return Ok(true);
            }
            let samples = decode_samples(sample_bytes);
            if samples.iter().all(|value| *value == 0) {
                all_zero_aline_count += 1;
            }
            raw_adc_min_clip_count += samples.iter().filter(|value| **value == i16::MIN).count() as u64;
            raw_adc_max_clip_count += samples.iter().filter(|value| **value == i16::MAX).count() as u64;
            let processed = match processor.process_codes(&samples) {
                Ok(processed) => processed,
                Err(error) => {
                    invalid_frame_count += 1;
                    issues.push(PaParseIssue {
                        severity: PaSeverity::Warning,
                        message: format!("frame {} A-line processing failed: {error}", frame.frame_id),
                        block_id: Some(frame.block_id),
                        frame_id: Some(frame.frame_id),
                    });
                    return Ok(true);
                }
            };
            nan_or_inf_count += processed
                .output_envelope
                .iter()
                .filter(|value| !value.is_finite())
                .count() as u64;
            let x = usize::from(metadata.x_idx);
            let y = usize::from(metadata.y_idx);
            let pixel_index = y * width + x;
            let previous_count = counts[pixel_index];
            let output = if previous_count == 0 {
                processed.output_envelope.clone()
            } else {
                let previous = read_f32_at(
                    &mut envelope_file,
                    layout,
                    pixel_index as u64 * resolved.output_sample_count as u64,
                    resolved.output_sample_count,
                )?;
                previous
                    .into_iter()
                    .zip(processed.output_envelope.iter())
                    .map(|(old, new)| {
                        (old * previous_count as f32 + *new) / (previous_count + 1) as f32
                    })
                    .collect()
            };
            write_f32_at(
                &mut envelope_file,
                layout,
                pixel_index as u64 * resolved.output_sample_count as u64,
                &output,
            )?;
            if let (Some(file), Some(rf_layout)) = (filtered_file.as_mut(), filtered_layout) {
                let output_start = resolved.output_start_index - resolved.processing_start_index;
                let output_end = resolved.output_end_index - resolved.processing_start_index;
                let signed_output: Vec<f32> = processed.filtered_processing[output_start..output_end]
                    .iter()
                    .map(|value| *value as f32)
                    .collect();
                let averaged = if previous_count == 0 {
                    signed_output
                } else {
                    let previous = read_f32_at(
                        file,
                        rf_layout,
                        pixel_index as u64 * resolved.output_sample_count as u64,
                        resolved.output_sample_count,
                    )?;
                    previous
                        .into_iter()
                        .zip(signed_output.iter())
                        .map(|(old, new)| {
                            (old * previous_count as f32 + *new)
                                / (previous_count + 1) as f32
                        })
                        .collect()
                };
                write_f32_at(
                    file,
                    rf_layout,
                    pixel_index as u64 * resolved.output_sample_count as u64,
                    &averaged,
                )?;
            }
            counts[pixel_index] = previous_count + 1;
            map_values[pixel_index] = output.iter().copied().max_by(f32::total_cmp);
            x_coordinates[x] = Some(metadata.current_x as f64);
            y_coordinates[y] = Some(metadata.current_y as f64);
            completed_rows.insert(y);
            valid_frame_count += 1;

            if source_frame_count.saturating_sub(last_emit) >= emit_interval {
                on_progress(progress_event(
                    started_at,
                    source_frame_count,
                    valid_frame_count,
                    completed_rows.len(),
                    height,
                    "processing",
                    issues.len(),
                ))?;
                last_emit = source_frame_count;
            }
            Ok(true)
        },
        |warning| {
            stream_issues.borrow_mut().push(warning.issue);
            stream_bad_frame_count.set(
                stream_bad_frame_count.get().saturating_add(warning.bad_frame_count),
            );
        },
    )?;
    invalid_frame_count = invalid_frame_count.saturating_add(stream_bad_frame_count.get());
    issues.extend(stream_issues.into_inner());
    envelope_file
        .flush()
        .map_err(|err| format!("flush {} failed: {err}", envelope_partial_path.display()))?;
    if let Some(file) = filtered_file.as_mut() {
        file.flush().map_err(|err| {
            format!("flush {} failed: {err}", filtered_rf_partial_path.display())
        })?;
    }
    drop(filtered_file);
    drop(envelope_file);

    on_progress(progress_event(
        started_at,
        source_frame_count,
        valid_frame_count,
        completed_rows.len(),
        height,
        "writing",
        issues.len(),
    ))?;
    let x_um = resolved_coordinates(x_coordinates, width, request.config.um_per_count);
    let y_um = resolved_coordinates(y_coordinates, height, request.config.um_per_count);
    let z_um: Vec<f64> = (resolved.output_start_index..resolved.output_end_index)
        .map(|index| processor.depth_um(index))
        .collect();
    write_f64_vector(&x_um_path, &x_um)?;
    write_f64_vector(&y_um_path, &y_um)?;
    write_f64_vector(&z_um_path, &z_um)?;

    let missing_pixel_count = counts.iter().filter(|count| **count == 0).count() as u64;
    let duplicate_pixel_count = counts.iter().filter(|count| **count > 1).count() as u64;
    let diagnostics = ClassicalOrpamDiagnostics {
        source_frame_count,
        valid_frame_count,
        invalid_frame_count,
        missing_pixel_count,
        duplicate_pixel_count,
        all_zero_aline_count,
        raw_adc_min_clip_count,
        raw_adc_max_clip_count,
        nan_or_inf_count,
        warning_count: issues.len(),
        issues: issues.into_iter().take(100).collect(),
    };
    write_json_new(&resolved_config_path, &resolved)?;
    let source_size = fs::metadata(&request.input_path)
        .map_err(|err| format!("metadata {} failed: {err}", request.input_path.display()))?
        .len();
    let metadata = serde_json::json!({
        "source": {
            "path": request.input_path.display().to_string(),
            "size_bytes": source_size,
            "axis_block_header_bytes": 32,
            "axis_frame_header_bytes": 16,
            "pa_metadata_bytes": 32,
            "metadata_magic": "0x4D455441",
            "waveform_samples": resolved.sample_count,
        },
        "output": {
            "envelope_path": envelope_path.display().to_string(),
            "filtered_rf_path": if request.config.save_filtered_rf { Some(filtered_rf_path.display().to_string()) } else { None },
            "shape_yxz": shape,
            "axis_order": "[y,x,z] C-order",
            "dtype": "float32 little-endian",
            "units": "microamp",
            "linear": true,
            "product_kind": product_kind(&request.config),
        },
        "processing_order": [
            "validated legacy frame stream",
            "metadata placement y_idx * width + x_idx",
            "valid source slice",
            "per-A-line median baseline subtraction",
            "Butterworth SOS forward-backward zero-phase band-pass",
            "Hilbert analytic magnitude",
            "output crop",
            "one-way time-to-depth conversion"
        ],
        "resolved": &resolved,
        "diagnostics": &diagnostics,
        "application": { "name": "PA Image Post-Processor", "version": env!("CARGO_PKG_VERSION") },
        "processed_unix_ms": std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|duration| duration.as_millis())
            .unwrap_or(0),
    });
    write_json_new(&metadata_path, &metadata)?;

    fs::rename(&envelope_partial_path, &envelope_path).map_err(|err| {
        format!(
            "publish {} as {} failed: {err}",
            envelope_partial_path.display(),
            envelope_path.display()
        )
    })?;
    if request.config.save_filtered_rf {
        fs::rename(&filtered_rf_partial_path, &filtered_rf_path).map_err(|err| {
            format!(
                "publish {} as {} failed: {err}",
                filtered_rf_partial_path.display(),
                filtered_rf_path.display()
            )
        })?;
    }
    on_progress(progress_event(
        started_at,
        source_frame_count,
        valid_frame_count,
        height,
        height,
        "qc",
        diagnostics.warning_count,
    ))?;

    Ok(ClassicalOrpamResult {
        request_id: request.request_id.clone(),
        input_path: request.input_path.display().to_string(),
        output_directory: request.output_directory.display().to_string(),
        shape_yxz: shape,
        envelope_path: envelope_path.display().to_string(),
        filtered_rf_path: request
            .config
            .save_filtered_rf
            .then(|| filtered_rf_path.display().to_string()),
        x_um_path: x_um_path.display().to_string(),
        y_um_path: y_um_path.display().to_string(),
        z_um_path: z_um_path.display().to_string(),
        metadata_path: metadata_path.display().to_string(),
        resolved_config_path: resolved_config_path.display().to_string(),
        npy_data_offset: layout.data_offset,
        map_values,
        pixel_counts: counts,
        x_start_um: *x_um.first().unwrap_or(&0.0),
        x_end_um: *x_um.last().unwrap_or(&0.0),
        y_start_um: *y_um.first().unwrap_or(&0.0),
        y_end_um: *y_um.last().unwrap_or(&0.0),
        z_start_um: *z_um.first().unwrap_or(&0.0),
        z_end_um: *z_um.last().unwrap_or(&0.0),
        product_kind: product_kind(&request.config),
        resolved,
        diagnostics,
    })
}

pub fn load_classical_volume_slice(
    envelope_path: &Path,
    data_offset: u64,
    shape_yxz: [usize; 3],
    view: &str,
    slice_index: usize,
    x_range_um: [f64; 2],
    y_range_um: [f64; 2],
    z_range_um: [f64; 2],
) -> Result<ClassicalVolumeSlice, String> {
    let [ny, nx, nz] = shape_yxz;
    if ny == 0 || nx == 0 || nz == 0 {
        return Err("volume shape dimensions must be non-zero".to_string());
    }
    let layout = NpyLayout {
        data_offset,
        element_count: (ny as u64)
            .checked_mul(nx as u64)
            .and_then(|value| value.checked_mul(nz as u64))
            .ok_or_else(|| "volume shape overflows".to_string())?,
        element_bytes: 4,
    };
    let mut file = File::open(envelope_path)
        .map_err(|err| format!("open {} failed: {err}", envelope_path.display()))?;
    match view {
        "xz" => {
            if slice_index >= ny {
                return Err(format!("XZ y index {slice_index} outside 0..{ny}"));
            }
            let contiguous = read_f32_at(
                &mut file,
                layout,
                slice_index as u64 * nx as u64 * nz as u64,
                nx * nz,
            )?;
            let mut values = Vec::with_capacity(nx * nz);
            for z in 0..nz {
                for x in 0..nx {
                    values.push(Some(contiguous[x * nz + z]));
                }
            }
            Ok(ClassicalVolumeSlice {
                view: view.to_string(),
                slice_index,
                width: nx,
                height: nz,
                values,
                horizontal_label: "X".to_string(),
                vertical_label: "Depth".to_string(),
                horizontal_start_um: x_range_um[0],
                horizontal_end_um: x_range_um[1],
                vertical_start_um: z_range_um[0],
                vertical_end_um: z_range_um[1],
            })
        }
        "yz" => {
            if slice_index >= nx {
                return Err(format!("YZ x index {slice_index} outside 0..{nx}"));
            }
            let mut values = vec![None; ny * nz];
            for y in 0..ny {
                let trace = read_f32_at(
                    &mut file,
                    layout,
                    (y * nx * nz + slice_index * nz) as u64,
                    nz,
                )?;
                for z in 0..nz {
                    values[z * ny + y] = Some(trace[z]);
                }
            }
            Ok(ClassicalVolumeSlice {
                view: view.to_string(),
                slice_index,
                width: ny,
                height: nz,
                values,
                horizontal_label: "Y".to_string(),
                vertical_label: "Depth".to_string(),
                horizontal_start_um: y_range_um[0],
                horizontal_end_um: y_range_um[1],
                vertical_start_um: z_range_um[0],
                vertical_end_um: z_range_um[1],
            })
        }
        "xy" => {
            if slice_index >= nz {
                return Err(format!("XY z index {slice_index} outside 0..{nz}"));
            }
            let mut values = Vec::with_capacity(nx * ny);
            for pixel in 0..nx * ny {
                values.push(Some(read_f32_at(
                    &mut file,
                    layout,
                    (pixel * nz + slice_index) as u64,
                    1,
                )?[0]));
            }
            Ok(ClassicalVolumeSlice {
                view: view.to_string(),
                slice_index,
                width: nx,
                height: ny,
                values,
                horizontal_label: "X".to_string(),
                vertical_label: "Y".to_string(),
                horizontal_start_um: x_range_um[0],
                horizontal_end_um: x_range_um[1],
                vertical_start_um: y_range_um[0],
                vertical_end_um: y_range_um[1],
            })
        }
        _ => Err(format!("unknown volume slice view {view}")),
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    const GOLDEN_INDICES: [usize; 13] = [0, 1, 32, 128, 200, 220, 240, 260, 300, 384, 480, 510, 511];
    const SCIPY_FILTER_GOLDEN: [f64; 13] = [
        2.4499369377054613e-12,
        2.4587830016257636e-12,
        3.8523184554752978e-11,
        0.00064395164424989749,
        6.8510833950430339e-09,
        -0.76154651443128774,
        -0.58778523973776109,
        0.47066164768410551,
        3.369349611814787e-09,
        7.6508136065629992e-06,
        1.1591472133124656e-12,
        4.6330015160896468e-13,
        4.3290509703000061e-13,
    ];
    const SCIPY_ENVELOPE_GOLDEN: [f64; 13] = [
        4.1066107816751465e-12,
        3.1859573524243258e-12,
        3.9160460851715692e-11,
        0.00094069731072137311,
        0.41111230046550273,
        0.80073739769265695,
        0.99999997864076606,
        0.80073739769280938,
        0.13533528813955212,
        9.9294970130177839e-06,
        1.5663605516849276e-12,
        2.0075858882779096e-12,
        3.2921593322624527e-12,
    ];

    fn filter_fixture() -> Vec<f64> {
        let sample_rate = 125_000_000.0;
        (0..512)
            .map(|index| {
                let time = index as f64 / sample_rate;
                let gaussian = (-0.5 * ((index as f64 - 240.0) / 30.0).powi(2)).exp();
                gaussian * (2.0 * std::f64::consts::PI * 5_000_000.0 * time).sin()
            })
            .collect()
    }

    fn filter_config() -> ClassicalOrpamConfig {
        ClassicalOrpamConfig {
            sample_start_index: 0,
            sample_end_trim: 0,
            baseline_start_ns: 0.0,
            baseline_end_ns: 64.0,
            processing_start_ns: 0.0,
            processing_end_ns: 4096.0,
            output_start_ns: 0.0,
            output_end_ns: 4096.0,
            pipeline: ClassicalOrpamPipeline {
                median_baseline_enabled: false,
                bandpass_enabled: true,
                hilbert_envelope_enabled: true,
            },
            ..ClassicalOrpamConfig::default()
        }
    }

    #[test]
    fn maps_legacy_source_valid_and_half_open_windows_exactly() {
        let resolved = resolve_classical_orpam_config(
            &ClassicalOrpamConfig::default(),
            2032,
            400,
            400,
        )
        .expect("resolve config");
        assert_eq!(resolved.source_start_index, 10);
        assert_eq!(resolved.source_end_index, 1982);
        assert_eq!(resolved.valid_sample_count, 1972);
        assert_eq!(resolved.baseline_start_index, 31);
        assert_eq!(resolved.baseline_end_index, 138);
        assert_eq!(resolved.output_start_index, 193);
        assert_eq!(resolved.output_end_index, 636);
        assert_eq!(resolved.output_sample_count, 443);
    }

    #[test]
    fn rejects_output_window_outside_processing_window_without_clamping() {
        let mut config = ClassicalOrpamConfig::default();
        config.processing_end_ns = 3000.0;
        let error = resolve_classical_orpam_config(&config, 2032, 400, 400)
            .expect_err("invalid nesting");
        assert!(error.contains("contained in the processing window"));
    }

    #[test]
    fn median_baseline_preserves_relative_pulse_amplitudes() {
        let config = ClassicalOrpamConfig {
            sample_start_index: 0,
            sample_end_trim: 0,
            baseline_start_ns: 0.0,
            baseline_end_ns: 64.0,
            processing_start_ns: 0.0,
            processing_end_ns: 2048.0,
            output_start_ns: 800.0,
            output_end_ns: 1600.0,
            zero_adc_code: 1000.0,
            pipeline: ClassicalOrpamPipeline {
                median_baseline_enabled: true,
                bandpass_enabled: false,
                hilbert_envelope_enabled: false,
            },
            ..ClassicalOrpamConfig::default()
        };
        let resolved = resolve_classical_orpam_config(&config, 512, 1, 1).expect("resolve");
        let processor = AlineProcessor::new(resolved).expect("processor");
        let mut first = vec![1000i16; 512];
        let mut second = vec![1400i16; 512];
        first[150] = 900;
        second[150] = 1200;
        let first = processor.process_codes(&first).expect("first");
        let second = processor.process_codes(&second).expect("second");
        assert!(first.metrics.median_baseline_ua.abs() < 1e-12);
        assert!(second.metrics.median_baseline_ua.abs() > 0.0);
        let ratio = second.metrics.envelope_peak_ua / first.metrics.envelope_peak_ua;
        assert!((ratio - 2.0).abs() < 1e-6, "ratio={ratio}");
    }

    #[test]
    fn butterworth_sos_zero_phase_matches_scipy_1_17_1_fixture() {
        let config = filter_config();
        let resolved = resolve_classical_orpam_config(&config, 512, 1, 1).expect("resolve");
        let sos = design_bandpass(&resolved).expect("SOS");
        assert_eq!(sos.len(), 4);
        let filtered = sosfiltfilt_dyn(filter_fixture().iter(), &sos);
        for ((index, expected), actual) in GOLDEN_INDICES
            .iter()
            .zip(SCIPY_FILTER_GOLDEN.iter())
            .zip(GOLDEN_INDICES.iter().map(|index| filtered[*index]))
        {
            assert!(
                (actual - expected).abs() < 2e-6,
                "index {index}: actual={actual} expected={expected}"
            );
        }
        let peak = filtered
            .iter()
            .enumerate()
            .max_by(|left, right| left.1.abs().total_cmp(&right.1.abs()))
            .map(|(index, _)| index)
            .unwrap();
        assert!((peak as isize - 240).abs() <= 4);
    }

    #[test]
    fn hilbert_envelope_handles_even_lengths_and_matches_scipy_fixture() {
        let config = filter_config();
        let resolved = resolve_classical_orpam_config(&config, 512, 1, 1).expect("resolve");
        let processor = AlineProcessor::new(resolved).expect("processor");
        let filtered = sosfiltfilt_dyn(filter_fixture().iter(), &processor.sos);
        let envelope = hilbert_envelope(
            &filtered,
            &processor.fft_forward,
            &processor.fft_inverse,
        );
        for ((index, expected), actual) in GOLDEN_INDICES
            .iter()
            .zip(SCIPY_ENVELOPE_GOLDEN.iter())
            .zip(GOLDEN_INDICES.iter().map(|index| envelope[*index]))
        {
            assert!(
                (actual - expected).abs() < 2e-6,
                "index {index}: actual={actual} expected={expected}"
            );
        }
        assert_eq!(
            envelope
                .iter()
                .enumerate()
                .max_by(|left, right| left.1.total_cmp(right.1))
                .map(|(index, _)| index),
            Some(240)
        );
    }

    #[test]
    fn hilbert_envelope_handles_odd_lengths() {
        let values: Vec<f64> = (0..511)
            .map(|index| (2.0 * std::f64::consts::PI * index as f64 / 31.0).cos())
            .collect();
        let mut planner = FftPlanner::<f64>::new();
        let forward = planner.plan_fft_forward(values.len());
        let inverse = planner.plan_fft_inverse(values.len());
        let envelope = hilbert_envelope(&values, &forward, &inverse);
        assert_eq!(envelope.len(), values.len());
        assert!(envelope[40..470]
            .iter()
            .all(|value| (*value - 1.0).abs() < 0.08));
    }

    #[test]
    fn depth_conversion_is_one_way_and_never_divides_by_two() {
        let mut config = filter_config();
        config.relative_depth = false;
        config.output_start_ns = 1600.0;
        config.output_end_ns = 2400.0;
        let resolved = resolve_classical_orpam_config(&config, 512, 1, 1).expect("resolve");
        let processor = AlineProcessor::new(resolved).expect("processor");
        assert!((processor.depth_um(200) - 2400.0).abs() < 1e-9);
        assert!((processor.depth_um(200) - 1200.0).abs() > 1000.0);
    }

    fn write_synthetic_serpentine_legacy(name: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!("{name}_{}.bin", std::process::id()));
        let mut file = File::create(&path).expect("create legacy");
        let rows = [vec![(0usize, 0usize), (1, 0), (2, 0)], vec![(2, 1), (1, 1), (0, 1)]];
        let sample_count = 2032usize;
        let payload_bytes = PA_METADATA_BYTES + sample_count * 2;
        let used_bytes = 3 * (16 + payload_bytes);
        let mut global_index = 0usize;
        for (block_index, row) in rows.iter().enumerate() {
            let first_id = global_index as u64 + 1;
            let last_id = first_id + 2;
            file.write_all(&(block_index as u64 + 1).to_le_bytes()).expect("block id");
            file.write_all(&(used_bytes as u32).to_le_bytes()).expect("used");
            file.write_all(&3u32.to_le_bytes()).expect("count");
            file.write_all(&first_id.to_le_bytes()).expect("first");
            file.write_all(&last_id.to_le_bytes()).expect("last");
            for (x, y) in row {
                let frame_id = global_index as u64 + 1;
                file.write_all(&frame_id.to_le_bytes()).expect("frame id");
                file.write_all(&(payload_bytes as u32).to_le_bytes()).expect("payload");
                file.write_all(&0u32.to_le_bytes()).expect("reserved");
                let mut metadata = [0u8; PA_METADATA_BYTES];
                metadata[4..8].copy_from_slice(&(global_index as u32 + 1).to_le_bytes());
                metadata[8..10].copy_from_slice(&2u16.to_le_bytes());
                metadata[10..12].copy_from_slice(&3u16.to_le_bytes());
                metadata[12..14].copy_from_slice(&1u16.to_le_bytes());
                metadata[14..16].copy_from_slice(&(global_index as u16).to_le_bytes());
                metadata[16..18].copy_from_slice(&(*y as u16).to_le_bytes());
                metadata[18..20].copy_from_slice(&(*x as u16).to_le_bytes());
                metadata[20..22].copy_from_slice(&((*y as i16 * 8) - 4).to_le_bytes());
                metadata[22..24].copy_from_slice(&((*x as i16 * 8) - 8).to_le_bytes());
                metadata[24..28].copy_from_slice(&1u32.to_le_bytes());
                metadata[28..32].copy_from_slice(&crate::pa_image::PA_META_MAGIC.to_le_bytes());
                file.write_all(&metadata).expect("metadata");
                let amplitude = ((*y * 3 + *x + 1) * 100) as i16;
                for sample_index in 0..sample_count {
                    let value = if sample_index == 260 { -amplitude } else { 0 };
                    file.write_all(&value.to_le_bytes()).expect("sample");
                }
                global_index += 1;
            }
        }
        path
    }

    fn reconstruction_test_config() -> ClassicalOrpamConfig {
        ClassicalOrpamConfig {
            pipeline: ClassicalOrpamPipeline {
                median_baseline_enabled: true,
                bandpass_enabled: false,
                hilbert_envelope_enabled: false,
            },
            ..ClassicalOrpamConfig::default()
        }
    }

    fn cleanup_reconstruction(output: &Path, input: &Path) {
        for name in [
            "envelope_linear.npy",
            "filtered_rf.npy",
            "x_um.npy",
            "y_um.npy",
            "z_um.npy",
            "reconstruction_metadata.json",
            "resolved_config.json",
            "envelope_linear.npy.partial",
            "filtered_rf.npy.partial",
        ] {
            let path = output.join(name);
            if path.exists() {
                std::fs::remove_file(path).expect("remove output file");
            }
        }
        if output.exists() {
            std::fs::remove_dir(output).expect("remove output directory");
        }
        if input.exists() {
            std::fs::remove_file(input).expect("remove input");
        }
    }

    #[test]
    fn reconstructs_metadata_placed_yxz_volume_and_loads_all_slice_planes() {
        let input = write_synthetic_serpentine_legacy("pa_orpam_volume");
        let output = std::env::temp_dir().join(format!("pa_orpam_volume_out_{}", std::process::id()));
        let request = ClassicalOrpamRequest {
            input_path: input.clone(),
            output_directory: output.clone(),
            config: reconstruction_test_config(),
            request_id: "test-volume".to_string(),
        };
        let result = reconstruct_classical_orpam(&request, |_| Ok(()), || false)
            .expect("reconstruct");
        assert_eq!(result.shape_yxz, [2, 3, 443]);
        assert_eq!(result.pixel_counts, vec![1, 1, 1, 1, 1, 1]);
        assert_eq!(result.diagnostics.valid_frame_count, 6);
        assert_eq!(result.diagnostics.missing_pixel_count, 0);
        assert_eq!(result.diagnostics.duplicate_pixel_count, 0);
        let finite_map: Vec<f32> = result.map_values.iter().flatten().copied().collect();
        assert_eq!(finite_map.len(), 6);
        for pair in finite_map.windows(2) {
            assert!(pair[1] > pair[0], "metadata placement must preserve amplitude order");
        }

        let ranges = (
            [result.x_start_um, result.x_end_um],
            [result.y_start_um, result.y_end_um],
            [result.z_start_um, result.z_end_um],
        );
        let xz = load_classical_volume_slice(
            Path::new(&result.envelope_path), result.npy_data_offset, result.shape_yxz,
            "xz", 1, ranges.0, ranges.1, ranges.2,
        ).expect("xz");
        let yz = load_classical_volume_slice(
            Path::new(&result.envelope_path), result.npy_data_offset, result.shape_yxz,
            "yz", 2, ranges.0, ranges.1, ranges.2,
        ).expect("yz");
        let xy = load_classical_volume_slice(
            Path::new(&result.envelope_path), result.npy_data_offset, result.shape_yxz,
            "xy", 67, ranges.0, ranges.1, ranges.2,
        ).expect("xy");
        assert_eq!((xz.width, xz.height), (3, 443));
        assert_eq!((yz.width, yz.height), (2, 443));
        assert_eq!((xy.width, xy.height), (3, 2));
        assert_eq!(xz.values.len(), 3 * 443);
        assert_eq!(yz.values.len(), 2 * 443);
        assert_eq!(xy.values.len(), 6);
        cleanup_reconstruction(&output, &input);
    }

    #[test]
    fn cancellation_leaves_named_partial_and_never_publishes_complete_volume() {
        let input = write_synthetic_serpentine_legacy("pa_orpam_cancel");
        let output = std::env::temp_dir().join(format!("pa_orpam_cancel_out_{}", std::process::id()));
        let request = ClassicalOrpamRequest {
            input_path: input.clone(),
            output_directory: output.clone(),
            config: reconstruction_test_config(),
            request_id: "test-cancel".to_string(),
        };
        let mut checks = 0usize;
        let error = reconstruct_classical_orpam(
            &request,
            |_| Ok(()),
            || {
                checks += 1;
                checks >= 3
            },
        )
        .expect_err("cancel");
        assert!(error.contains("cancelled"));
        assert!(output.join("envelope_linear.npy.partial").exists());
        assert!(!output.join("envelope_linear.npy").exists());
        cleanup_reconstruction(&output, &input);
    }
    #[test]
    #[ignore = "opt-in real CarbonfiberH2 reconstruction; requires PA_ORPAM_SMOKE_OUTPUT"]
    fn carbonfiber_h2_real_data_smoke_test() {
        let input = PathBuf::from(
            std::env::var("PA_ORPAM_SMOKE_INPUT").unwrap_or_else(|_| {
                r"E:\Codex_Data\3D_PAM\share\data\20260706\CarbonfiberH2_1\legacy.bin"
                    .to_string()
            }),
        );
        let output = PathBuf::from(
            std::env::var("PA_ORPAM_SMOKE_OUTPUT")
                .expect("set PA_ORPAM_SMOKE_OUTPUT to a new empty output directory"),
        );
        let summary = scan_legacy_file(&input).expect("scan real CarbonfiberH2");
        assert_eq!(summary.block_count, 20);
        assert_eq!(summary.frame_count, 160_000);
        assert_eq!(summary.detected_x_points, Some(400));
        assert_eq!(summary.detected_y_points, Some(400));
        assert_eq!(summary.detected_sample_count_min, 2032);
        assert_eq!(summary.detected_sample_count_max, 2032);

        let request = ClassicalOrpamRequest {
            input_path: input,
            output_directory: output,
            config: ClassicalOrpamConfig::default(),
            request_id: "carbonfiber-h2-real-smoke".to_string(),
        };
        let result = reconstruct_classical_orpam(
            &request,
            |progress| {
                if progress.source_frame_count % 16_000 == 0 || progress.stage != "processing" {
                    eprintln!(
                        "stage={} source={} valid={} rows={}/{} warnings={}",
                        progress.stage,
                        progress.source_frame_count,
                        progress.valid_frame_count,
                        progress.completed_rows,
                        progress.total_rows,
                        progress.warning_count
                    );
                }
                Ok(())
            },
            || false,
        )
        .expect("reconstruct real CarbonfiberH2");
        assert_eq!(result.shape_yxz, [400, 400, 443]);
        assert_eq!(result.diagnostics.valid_frame_count, 160_000);
        assert_eq!(result.diagnostics.missing_pixel_count, 0);
        assert!(result.map_values.iter().flatten().all(|value| value.is_finite()));
        assert!(result.map_values.iter().flatten().copied().fold(0.0f32, f32::max) > 0.0);
    }
}
