use std::fs::File;
use std::io::{BufReader, Read};
use std::path::Path;
use std::sync::Mutex;
use std::time::Instant;

pub const PA_META_MAGIC: u32 = 0x4D45_5441;
pub const AXIS_BLOCK_HEADER_BYTES: usize = 32;
pub const AXIS_FRAME_HEADER_BYTES: usize = 16;
pub const PA_METADATA_BYTES: usize = 32;

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PaSeverity {
    Ok,
    Warning,
    #[allow(dead_code)]
    Error,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct PaParseIssue {
    pub severity: PaSeverity,
    pub message: String,
    pub block_id: Option<u64>,
    pub frame_id: Option<u64>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct PaFrameMetadata {
    pub reserved: u32,
    pub global_shot_idx: u32,
    pub y_points: u16,
    pub x_points: u16,
    pub frame_number: u16,
    pub frame_idx: u16,
    pub y_idx: u16,
    pub x_idx: u16,
    pub current_y: i16,
    pub current_x: i16,
    pub task_id: u32,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct PaFileSummary {
    pub path: String,
    pub file_size: u64,
    pub block_count: u64,
    pub frame_count: u64,
    pub bad_frame_count: u64,
    pub block_id_gaps: u64,
    pub frame_id_gaps: u64,
    pub global_shot_gaps: u64,
    pub frame_count_mismatches: u64,
    pub first_block_id: Option<u64>,
    pub last_block_id: Option<u64>,
    pub first_frame_id: Option<u64>,
    pub last_frame_id: Option<u64>,
    pub first_global_shot_idx: Option<u32>,
    pub last_global_shot_idx: Option<u32>,
    pub detected_x_points: Option<u16>,
    pub detected_y_points: Option<u16>,
    pub detected_frame_number: Option<u16>,
    pub detected_sample_count_min: usize,
    pub detected_sample_count_max: usize,
    pub severity: PaSeverity,
    pub issues: Vec<PaParseIssue>,
}

#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
pub struct PaImageProcessingConfig {
    pub sample_interval_ns: f64,
    pub sample_start_index: usize,
    pub sample_end_trim: usize,
    pub baseline_start_ns: f64,
    pub baseline_end_ns: f64,
    pub ptp_start_ns: f64,
    pub ptp_end_ns: f64,
    pub tz_ohm: f64,
    pub vfs: f64,
    #[serde(default = "default_zero_adc_code")]
    pub zero_adc_code: f64,
}

fn default_zero_adc_code() -> f64 {
    27034.0
}

impl PaImageProcessingConfig {
    #[allow(dead_code)]
    pub fn default_for_tz(tz_ohm: f64) -> Self {
        Self {
            sample_interval_ns: 8.0,
            sample_start_index: 10,
            sample_end_trim: 50,
            baseline_start_ns: 100.0,
            baseline_end_ns: 400.0,
            ptp_start_ns: 1600.0,
            ptp_end_ns: 2400.0,
            tz_ohm,
            vfs: 1.0,
            zero_adc_code: default_zero_adc_code(),
        }
    }
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct PaFrameTrace {
    pub path: String,
    pub frame_index: u64,
    pub frame_id: u64,
    pub metadata: Option<PaFrameMetadata>,
    pub time_ns: Vec<f64>,
    pub samples: Vec<i16>,
    pub current_ua: Vec<f64>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct PaImageBuildResult {
    pub path: String,
    pub width: usize,
    pub height: usize,
    pub values: Vec<Option<f64>>,
    pub counts: Vec<u32>,
    pub pixel_frame_indices: Vec<Option<u64>>,
    pub x_start: Option<i16>,
    pub x_end: Option<i16>,
    pub y_start: Option<i16>,
    pub y_end: Option<i16>,
    pub pixel_count: u64,
    pub frame_count: u64,
    pub bad_frame_count: u64,
    pub severity: PaSeverity,
    pub issues: Vec<PaParseIssue>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct PaSeriesPoint {
    pub frame_index: u64,
    pub frame_id: u64,
    pub global_shot_idx: Option<u32>,
    pub current_x: Option<i16>,
    pub current_y: Option<i16>,
    pub ptp: Option<f64>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct PaSeriesBuildResult {
    pub path: String,
    pub frame_count: u64,
    pub bad_frame_count: u64,
    pub ptp_average: Option<f64>,
    pub ptp_variance: Option<f64>,
    pub ptp_std: Option<f64>,
    pub ptp_min: Option<f64>,
    pub ptp_max: Option<f64>,
    pub points: Vec<PaSeriesPoint>,
    pub severity: PaSeverity,
    pub issues: Vec<PaParseIssue>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct PaImageBuildProgress {
    pub source_frame_count: u64,
    pub elapsed_ms: u64,
    pub image: Option<PaImageBuildResult>,
}

struct PaLiveImageAccumulatorState {
    config: PaImageProcessingConfig,
    width: Option<usize>,
    height: Option<usize>,
    sums: Vec<f64>,
    counts: Vec<u32>,
    pixel_frame_indices: Vec<Option<u64>>,
    x_start: Option<i16>,
    x_end: Option<i16>,
    y_start: Option<i16>,
    y_end: Option<i16>,
    frame_count: u64,
    bad_frame_count: u64,
    severity: PaSeverity,
    issues: Vec<PaParseIssue>,
}

impl PaLiveImageAccumulatorState {
    fn new() -> Self {
        Self {
            config: PaImageProcessingConfig::default_for_tz(2000.0),
            width: None,
            height: None,
            sums: Vec::new(),
            counts: Vec::new(),
            pixel_frame_indices: Vec::new(),
            x_start: None,
            x_end: None,
            y_start: None,
            y_end: None,
            frame_count: 0,
            bad_frame_count: 0,
            severity: PaSeverity::Ok,
            issues: Vec::new(),
        }
    }

    fn reset_data(&mut self) {
        self.width = None;
        self.height = None;
        self.sums.clear();
        self.counts.clear();
        self.pixel_frame_indices.clear();
        self.x_start = None;
        self.x_end = None;
        self.y_start = None;
        self.y_end = None;
        self.frame_count = 0;
        self.bad_frame_count = 0;
        self.severity = PaSeverity::Ok;
        self.issues.clear();
    }

    fn set_processing(&mut self, config: PaImageProcessingConfig) {
        self.config = config;
        self.reset_data();
    }

    fn push_issue(&mut self, severity: PaSeverity, message: String, block_id: Option<u64>, frame_id: Option<u64>) {
        push_parse_issue_to(
            &mut self.issues,
            &mut self.severity,
            severity,
            message,
            block_id,
            frame_id,
        );
    }

    fn ingest_frame_payload(&mut self, block_id: Option<u64>, frame_id: u64, payload: &[u8]) -> Result<(), String> {
        if payload.len() < PA_METADATA_BYTES {
            self.bad_frame_count += 1;
            self.push_issue(
                PaSeverity::Warning,
                format!("frame {frame_id} payload shorter than metadata"),
                block_id,
                Some(frame_id),
            );
            return Ok(());
        }

        let metadata = match parse_metadata(&payload[..PA_METADATA_BYTES]) {
            Ok(metadata) => metadata,
            Err(err) => {
                self.bad_frame_count += 1;
                self.push_issue(
                    PaSeverity::Warning,
                    format!("frame {frame_id} metadata parse failed: {err}"),
                    block_id,
                    Some(frame_id),
                );
                return Ok(());
            }
        };

        if metadata.x_points == 0 || metadata.y_points == 0 {
            self.bad_frame_count += 1;
            self.push_issue(
                PaSeverity::Warning,
                format!(
                    "frame {frame_id} has zero image dimension {}x{}",
                    metadata.x_points, metadata.y_points
                ),
                block_id,
                Some(frame_id),
            );
            return Ok(());
        }

        let frame_width = usize::from(metadata.x_points);
        let frame_height = usize::from(metadata.y_points);
        if self.width.is_none() {
            self.width = Some(frame_width);
            self.height = Some(frame_height);
            let pixel_count = frame_width
                .checked_mul(frame_height)
                .ok_or_else(|| "image dimensions overflow address space".to_string())?;
            self.sums = vec![0.0; pixel_count];
            self.counts = vec![0; pixel_count];
            self.pixel_frame_indices = vec![None; pixel_count];
        } else if self.width != Some(frame_width) || self.height != Some(frame_height) {
            self.bad_frame_count += 1;
            self.push_issue(
                PaSeverity::Warning,
                format!(
                    "frame {frame_id} has inconsistent image dimension {}x{}",
                    metadata.x_points, metadata.y_points
                ),
                block_id,
                Some(frame_id),
            );
            return Ok(());
        }

        let image_width = self.width.expect("width initialized");
        let image_height = self.height.expect("height initialized");
        let x = usize::from(metadata.x_idx);
        let y = usize::from(metadata.y_idx);
        if x >= image_width || y >= image_height {
            self.bad_frame_count += 1;
            self.push_issue(
                PaSeverity::Warning,
                format!(
                    "frame {frame_id} pixel index {},{} outside {}x{} image",
                    metadata.x_idx, metadata.y_idx, image_width, image_height
                ),
                block_id,
                Some(frame_id),
            );
            return Ok(());
        }

        let ptp = match compute_frame_ptp_from_sample_bytes(&payload[PA_METADATA_BYTES..], &self.config) {
            Ok(value) => value,
            Err(err) => {
                self.bad_frame_count += 1;
                self.push_issue(
                    PaSeverity::Warning,
                    format!("frame {frame_id} ptp failed: {err}"),
                    block_id,
                    Some(frame_id),
                );
                return Ok(());
            }
        };

        let pixel_index = y * image_width + x;
        self.sums[pixel_index] += ptp;
        self.counts[pixel_index] += 1;
        if self.pixel_frame_indices[pixel_index].is_none() {
            self.pixel_frame_indices[pixel_index] = Some(frame_id.saturating_sub(1));
        }
        self.x_start = Some(self.x_start.map_or(metadata.current_x, |value| value.min(metadata.current_x)));
        self.x_end = Some(self.x_end.map_or(metadata.current_x, |value| value.max(metadata.current_x)));
        self.y_start = Some(self.y_start.map_or(metadata.current_y, |value| value.min(metadata.current_y)));
        self.y_end = Some(self.y_end.map_or(metadata.current_y, |value| value.max(metadata.current_y)));
        self.frame_count += 1;
        Ok(())
    }

    fn snapshot(&self) -> PaImageBuildResult {
        let width = self.width.unwrap_or(0);
        let height = self.height.unwrap_or(0);
        let values = self
            .sums
            .iter()
            .zip(&self.counts)
            .map(|(sum, count)| {
                if *count == 0 {
                    None
                } else {
                    Some(*sum / f64::from(*count))
                }
            })
            .collect();

        PaImageBuildResult {
            path: "live".to_string(),
            width,
            height,
            values,
            counts: self.counts.clone(),
            pixel_frame_indices: self.pixel_frame_indices.clone(),
            x_start: self.x_start,
            x_end: self.x_end,
            y_start: self.y_start,
            y_end: self.y_end,
            pixel_count: (width * height) as u64,
            frame_count: self.frame_count,
            bad_frame_count: self.bad_frame_count,
            severity: self.severity,
            issues: self.issues.clone(),
        }
    }
}

pub struct PaLiveImageAccumulator {
    state: Mutex<PaLiveImageAccumulatorState>,
}

impl Default for PaLiveImageAccumulator {
    fn default() -> Self {
        Self::new()
    }
}

impl PaLiveImageAccumulator {
    pub fn new() -> Self {
        Self {
            state: Mutex::new(PaLiveImageAccumulatorState::new()),
        }
    }

    pub fn reset(&self) {
        self.state
            .lock()
            .expect("PA live image accumulator mutex poisoned")
            .reset_data();
    }

    pub fn set_processing(&self, config: PaImageProcessingConfig) {
        self.state
            .lock()
            .expect("PA live image accumulator mutex poisoned")
            .set_processing(config);
    }

    pub fn snapshot(&self) -> PaImageBuildResult {
        self.state
            .lock()
            .expect("PA live image accumulator mutex poisoned")
            .snapshot()
    }

    pub fn ingest_legacy_block_payload(&self, payload: &[u8]) -> Result<(), String> {
        let mut state = self
            .state
            .lock()
            .expect("PA live image accumulator mutex poisoned");
        let mut offset = 0usize;
        while offset < payload.len() {
            if payload.len() - offset < AXIS_FRAME_HEADER_BYTES {
                state.bad_frame_count += 1;
                state.push_issue(
                    PaSeverity::Warning,
                    format!("live block ended with {} trailing bytes before frame header", payload.len() - offset),
                    None,
                    None,
                );
                break;
            }

            let frame_header = &payload[offset..offset + AXIS_FRAME_HEADER_BYTES];
            let frame = parse_frame_header(frame_header)?;
            offset += AXIS_FRAME_HEADER_BYTES;
            let data_bytes = frame.data_bytes as usize;
            if frame.reserved != 0 {
                state.push_issue(
                    PaSeverity::Warning,
                    format!("frame {} reserved header field is non-zero", frame.frame_id),
                    None,
                    Some(frame.frame_id),
                );
            }
            if data_bytes > payload.len() - offset {
                state.bad_frame_count += 1;
                state.push_issue(
                    PaSeverity::Warning,
                    format!("frame {} payload exceeds live block payload", frame.frame_id),
                    None,
                    Some(frame.frame_id),
                );
                break;
            }

            state.ingest_frame_payload(None, frame.frame_id, &payload[offset..offset + data_bytes])?;
            offset += data_bytes;
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Copy)]
struct AxisBlockHeader {
    block_id: u64,
    used_bytes: u32,
    frame_count: u32,
    first_frame_id: u64,
    last_frame_id: u64,
}

#[derive(Debug, Clone, Copy)]
struct AxisFrameHeader {
    frame_id: u64,
    data_bytes: u32,
    reserved: u32,
}

struct LegacyFramePayload {
    block_id: u64,
    frame_index: u64,
    frame_id: u64,
    payload: Vec<u8>,
}

struct LegacyStreamWarning {
    issue: PaParseIssue,
    bad_frame_count: u64,
}

struct PaBuildIssueState {
    bad_frame_count: u64,
    severity: PaSeverity,
    issues: Vec<PaParseIssue>,
}

impl PaBuildIssueState {
    fn new() -> Self {
        Self {
            bad_frame_count: 0,
            severity: PaSeverity::Ok,
            issues: Vec::new(),
        }
    }

    fn push(
        &mut self,
        severity: PaSeverity,
        message: String,
        block_id: Option<u64>,
        frame_id: Option<u64>,
    ) {
        push_parse_issue_to(
            &mut self.issues,
            &mut self.severity,
            severity,
            message,
            block_id,
            frame_id,
        );
    }

    fn push_existing(&mut self, issue: PaParseIssue) {
        push_existing_issue_to(&mut self.issues, &mut self.severity, issue);
    }
}

pub fn parse_metadata(raw: &[u8]) -> Result<PaFrameMetadata, String> {
    if raw.len() < PA_METADATA_BYTES {
        return Err(format!(
            "metadata too short: expected at least {PA_METADATA_BYTES} bytes, got {}",
            raw.len()
        ));
    }

    let magic = read_u32(raw, 28)?;
    if magic != PA_META_MAGIC {
        return Err(format!("invalid metadata magic 0x{magic:08X}"));
    }

    Ok(PaFrameMetadata {
        reserved: read_u32(raw, 0)?,
        global_shot_idx: read_u32(raw, 4)?,
        y_points: read_u16(raw, 8)?,
        x_points: read_u16(raw, 10)?,
        frame_number: read_u16(raw, 12)?,
        frame_idx: read_u16(raw, 14)?,
        y_idx: read_u16(raw, 16)?,
        x_idx: read_u16(raw, 18)?,
        current_y: read_i16(raw, 20)?,
        current_x: read_i16(raw, 22)?,
        task_id: read_u32(raw, 24)?,
    })
}

pub fn signed_code_to_current_ua(code: i16, tz_ohm: f64, vfs: f64, zero_adc_code: f64) -> f64 {
    let zero = zero_adc_code.round().clamp(-32768.0, 32767.0);
    let v_zero = zero / 32768.0 * vfs;
    let v_adc = (code as f64) / 32768.0 * vfs;
    ((v_zero - v_adc) / tz_ohm) * 1_000_000.0
}

#[allow(dead_code)]
pub fn compute_frame_ptp(samples: &[i16], config: &PaImageProcessingConfig) -> Result<f64, String> {
    let (ptp_start, ptp_end, scale_ua_per_code) = validated_ptp_code_window(samples.len(), config)?;
    let mut min_code = i16::MAX;
    let mut max_code = i16::MIN;
    for &code in &samples[ptp_start..ptp_end] {
        min_code = min_code.min(code);
        max_code = max_code.max(code);
    }
    Ok(f64::from(max_code as i32 - min_code as i32) * scale_ua_per_code)
}

fn compute_frame_ptp_from_sample_bytes(
    raw: &[u8],
    config: &PaImageProcessingConfig,
) -> Result<f64, String> {
    let sample_count = raw.len() / 2;
    let (ptp_start, ptp_end, scale_ua_per_code) = validated_ptp_code_window(sample_count, config)?;
    let mut min_code = i16::MAX;
    let mut max_code = i16::MIN;
    for index in ptp_start..ptp_end {
        let offset = index * 2;
        let code = i16::from_le_bytes([raw[offset], raw[offset + 1]]);
        min_code = min_code.min(code);
        max_code = max_code.max(code);
    }
    Ok(f64::from(max_code as i32 - min_code as i32) * scale_ua_per_code)
}

fn validated_ptp_code_window(
    sample_count: usize,
    config: &PaImageProcessingConfig,
) -> Result<(usize, usize, f64), String> {
    if !config.sample_interval_ns.is_finite() || config.sample_interval_ns <= 0.0 {
        return Err("sample_interval_ns must be finite and positive".to_string());
    }
    if !config.tz_ohm.is_finite() || config.tz_ohm == 0.0 {
        return Err("tz_ohm must be finite and non-zero".to_string());
    }
    if !config.vfs.is_finite() {
        return Err("vfs must be finite".to_string());
    }
    if !config.zero_adc_code.is_finite() {
        return Err("zero_adc_code must be finite".to_string());
    }
    if config.sample_start_index > sample_count {
        return Err("sample_start_index exceeds sample length".to_string());
    }
    if config.sample_end_trim > sample_count.saturating_sub(config.sample_start_index) {
        return Err("sample_end_trim leaves no valid trace".to_string());
    }

    let end = sample_count - config.sample_end_trim;
    let trace_len = end - config.sample_start_index;
    if trace_len == 0 {
        return Err("trace slice is empty".to_string());
    }

    let (baseline_start, baseline_end) = sample_window_indices(
        trace_len,
        config.sample_interval_ns,
        config.baseline_start_ns,
        config.baseline_end_ns,
    )?;
    let (ptp_start, ptp_end) = sample_window_indices(
        trace_len,
        config.sample_interval_ns,
        config.ptp_start_ns,
        config.ptp_end_ns,
    )?;
    let _ = (baseline_start, baseline_end);
    let scale_ua_per_code = (config.vfs / (32768.0 * config.tz_ohm) * 1_000_000.0).abs();
    Ok((
        config.sample_start_index + ptp_start,
        config.sample_start_index + ptp_end,
        scale_ua_per_code,
    ))
}

pub fn read_frame_trace_from_legacy_file(
    path: &Path,
    frame_index: u64,
    tz_ohm: f64,
    vfs: f64,
    zero_adc_code: f64,
) -> Result<PaFrameTrace, String> {
    if !tz_ohm.is_finite() || tz_ohm == 0.0 {
        return Err("tz_ohm must be finite and non-zero".to_string());
    }
    if !vfs.is_finite() {
        return Err("vfs must be finite".to_string());
    }
    if !zero_adc_code.is_finite() {
        return Err("zero_adc_code must be finite".to_string());
    }

    let mut trace = None;
    visit_legacy_frames(
        path,
        |frame| {
            if frame.frame_index != frame_index {
                return Ok(true);
            }
            if frame.payload.len() < PA_METADATA_BYTES {
                return Err(format!(
                    "frame {} payload shorter than metadata",
                    frame.frame_id
                ));
            }

            let metadata = parse_metadata(&frame.payload[..PA_METADATA_BYTES]).ok();
            let samples = decode_i16_samples(&frame.payload[PA_METADATA_BYTES..]);
            let time_ns: Vec<f64> = (0..samples.len()).map(|index| index as f64 * 8.0).collect();
            let current_ua = samples
                .iter()
                .map(|code| signed_code_to_current_ua(*code, tz_ohm, vfs, zero_adc_code))
                .collect();
            trace = Some(PaFrameTrace {
                path: path.display().to_string(),
                frame_index,
                frame_id: frame.frame_id,
                metadata,
                time_ns,
                samples,
                current_ua,
            });
            Ok(false)
        },
        |_warning| {},
    )?;

    trace.ok_or_else(|| format!("frame index {frame_index} not found"))
}

fn build_image_snapshot(
    path: &Path,
    width: usize,
    height: usize,
    sums: &[f64],
    counts: &[u32],
    pixel_frame_indices: &[Option<u64>],
    x_start: Option<i16>,
    x_end: Option<i16>,
    y_start: Option<i16>,
    y_end: Option<i16>,
    frame_count: u64,
    issue_state: &PaBuildIssueState,
) -> PaImageBuildResult {
    let values = sums
        .iter()
        .zip(counts)
        .map(|(sum, count)| {
            if *count == 0 {
                None
            } else {
                Some(*sum / f64::from(*count))
            }
        })
        .collect();

    PaImageBuildResult {
        path: path.display().to_string(),
        width,
        height,
        values,
        counts: counts.to_vec(),
        pixel_frame_indices: pixel_frame_indices.to_vec(),
        x_start,
        x_end,
        y_start,
        y_end,
        pixel_count: (width * height) as u64,
        frame_count,
        bad_frame_count: issue_state.bad_frame_count,
        severity: issue_state.severity,
        issues: issue_state.issues.clone(),
    }
}

fn empty_image_build_result(path: &Path, issue_state: PaBuildIssueState) -> PaImageBuildResult {
    PaImageBuildResult {
        path: path.display().to_string(),
        width: 0,
        height: 0,
        values: Vec::new(),
        counts: Vec::new(),
        pixel_frame_indices: Vec::new(),
        x_start: None,
        x_end: None,
        y_start: None,
        y_end: None,
        pixel_count: 0,
        frame_count: 0,
        bad_frame_count: issue_state.bad_frame_count,
        severity: issue_state.severity,
        issues: issue_state.issues,
    }
}

fn build_image_from_legacy_file_inner<F>(
    path: &Path,
    config: &PaImageProcessingConfig,
    frame_range: Option<(u64, u64)>,
    emit_every_source_frames: u64,
    emit_image_every_source_frames: u64,
    mut on_progress: F,
) -> Result<PaImageBuildResult, String>
where
    F: FnMut(PaImageBuildProgress) -> Result<(), String>,
{
    let started_at = Instant::now();
    let mut width = None;
    let mut height = None;
    let mut sums = Vec::<f64>::new();
    let mut counts = Vec::<u32>::new();
    let mut pixel_frame_indices = Vec::<Option<u64>>::new();
    let mut x_start = None::<i16>;
    let mut x_end = None::<i16>;
    let mut y_start = None::<i16>;
    let mut y_end = None::<i16>;
    let mut frame_count = 0u64;
    let mut last_emit_source_frame_count = 0u64;
    let mut last_image_emit_source_frame_count = 0u64;
    let issue_state = std::cell::RefCell::new(PaBuildIssueState::new());

    visit_legacy_frames(
        path,
        |frame| {
            if let Some((start, end)) = frame_range {
                if frame.frame_index < start {
                    return Ok(true);
                }
                if frame.frame_index >= end {
                    return Ok(false);
                }
            }
            let source_frame_count = frame.frame_index + 1;
            if frame.payload.len() < PA_METADATA_BYTES {
                let mut issue_state = issue_state.borrow_mut();
                issue_state.bad_frame_count += 1;
                issue_state.push(
                    PaSeverity::Warning,
                    format!("frame {} payload shorter than metadata", frame.frame_id),
                    Some(frame.block_id),
                    Some(frame.frame_id),
                );
                return Ok(true);
            }

            let metadata = match parse_metadata(&frame.payload[..PA_METADATA_BYTES]) {
                Ok(metadata) => metadata,
                Err(err) => {
                    let mut issue_state = issue_state.borrow_mut();
                    issue_state.bad_frame_count += 1;
                    issue_state.push(
                        PaSeverity::Warning,
                        format!("frame {} metadata parse failed: {err}", frame.frame_id),
                        Some(frame.block_id),
                        Some(frame.frame_id),
                    );
                    return Ok(true);
                }
            };

            if metadata.x_points == 0 || metadata.y_points == 0 {
                let mut issue_state = issue_state.borrow_mut();
                issue_state.bad_frame_count += 1;
                issue_state.push(
                    PaSeverity::Warning,
                    format!(
                        "frame {} has zero image dimension {}x{}",
                        frame.frame_id, metadata.x_points, metadata.y_points
                    ),
                    Some(frame.block_id),
                    Some(frame.frame_id),
                );
                return Ok(true);
            }

            let frame_width = usize::from(metadata.x_points);
            let frame_height = usize::from(metadata.y_points);
            if width.is_none() {
                width = Some(frame_width);
                height = Some(frame_height);
                let pixel_count = frame_width
                    .checked_mul(frame_height)
                    .ok_or_else(|| "image dimensions overflow address space".to_string())?;
                sums = vec![0.0; pixel_count];
                counts = vec![0; pixel_count];
                pixel_frame_indices = vec![None; pixel_count];
            } else if width != Some(frame_width) || height != Some(frame_height) {
                let mut issue_state = issue_state.borrow_mut();
                issue_state.bad_frame_count += 1;
                issue_state.push(
                    PaSeverity::Warning,
                    format!(
                        "frame {} has inconsistent image dimension {}x{}",
                        frame.frame_id, metadata.x_points, metadata.y_points
                    ),
                    Some(frame.block_id),
                    Some(frame.frame_id),
                );
                return Ok(true);
            }

            let image_width = width.expect("width initialized");
            let image_height = height.expect("height initialized");
            let x = usize::from(metadata.x_idx);
            let y = usize::from(metadata.y_idx);
            if x >= image_width || y >= image_height {
                let mut issue_state = issue_state.borrow_mut();
                issue_state.bad_frame_count += 1;
                issue_state.push(
                    PaSeverity::Warning,
                    format!(
                        "frame {} pixel index {},{} outside {}x{} image",
                        frame.frame_id, metadata.x_idx, metadata.y_idx, image_width, image_height
                    ),
                    Some(frame.block_id),
                    Some(frame.frame_id),
                );
                return Ok(true);
            }

            let ptp = match compute_frame_ptp_from_sample_bytes(
                &frame.payload[PA_METADATA_BYTES..],
                config,
            ) {
                Ok(value) => value,
                Err(err) => {
                    let mut issue_state = issue_state.borrow_mut();
                    issue_state.bad_frame_count += 1;
                    issue_state.push(
                        PaSeverity::Warning,
                        format!("frame {} ptp failed: {err}", frame.frame_id),
                        Some(frame.block_id),
                        Some(frame.frame_id),
                    );
                    return Ok(true);
                }
            };

            let pixel_index = y * image_width + x;
            sums[pixel_index] += ptp;
            counts[pixel_index] += 1;
            if pixel_frame_indices[pixel_index].is_none() {
                pixel_frame_indices[pixel_index] = Some(frame.frame_index);
            }
            x_start = Some(x_start.map_or(metadata.current_x, |value| value.min(metadata.current_x)));
            x_end = Some(x_end.map_or(metadata.current_x, |value| value.max(metadata.current_x)));
            y_start = Some(y_start.map_or(metadata.current_y, |value| value.min(metadata.current_y)));
            y_end = Some(y_end.map_or(metadata.current_y, |value| value.max(metadata.current_y)));
            frame_count += 1;
            if emit_every_source_frames > 0
                && source_frame_count.saturating_sub(last_emit_source_frame_count) >= emit_every_source_frames
                && width.is_some()
            {
                let should_emit_image = emit_image_every_source_frames > 0
                    && source_frame_count.saturating_sub(last_image_emit_source_frame_count) >= emit_image_every_source_frames;
                let image = if should_emit_image {
                    let issue_state_ref = issue_state.borrow();
                    Some(build_image_snapshot(
                        path,
                        image_width,
                        image_height,
                        &sums,
                        &counts,
                        &pixel_frame_indices,
                        x_start,
                        x_end,
                        y_start,
                        y_end,
                        frame_count,
                        &issue_state_ref,
                    ))
                } else {
                    None
                };
                on_progress(PaImageBuildProgress {
                    source_frame_count,
                    elapsed_ms: started_at.elapsed().as_millis().min(u128::from(u64::MAX)) as u64,
                    image,
                })?;
                last_emit_source_frame_count = source_frame_count;
                if should_emit_image {
                    last_image_emit_source_frame_count = source_frame_count;
                }
            }
            Ok(true)
        },
        |warning| {
            let mut issue_state = issue_state.borrow_mut();
            issue_state.bad_frame_count += warning.bad_frame_count;
            issue_state.push_existing(warning.issue);
        },
    )?;

    let issue_state = issue_state.into_inner();
    let Some(width) = width else {
        return if frame_range.is_some() {
            Ok(empty_image_build_result(path, issue_state))
        } else {
            Err("no valid PA frame metadata found".to_string())
        };
    };
    let height = height.expect("height initialized with width");

    Ok(build_image_snapshot(
        path,
        width,
        height,
        &sums,
        &counts,
        &pixel_frame_indices,
        x_start,
        x_end,
        y_start,
        y_end,
        frame_count,
        &issue_state,
    ))
}

pub fn build_image_from_legacy_file(
    path: &Path,
    config: &PaImageProcessingConfig,
) -> Result<PaImageBuildResult, String> {
    build_image_from_legacy_file_inner(path, config, None, 0, 0, |_| Ok(()))
}

pub fn build_image_range_from_legacy_file(
    path: &Path,
    config: &PaImageProcessingConfig,
    start_frame_index: u64,
    max_frames: u64,
) -> Result<PaImageBuildResult, String> {
    let end_frame_index = start_frame_index.saturating_add(max_frames);
    build_image_from_legacy_file_inner(
        path,
        config,
        Some((start_frame_index, end_frame_index)),
        0,
        0,
        |_| Ok(()),
    )
}

pub fn build_image_from_legacy_file_with_progress<F>(
    path: &Path,
    config: &PaImageProcessingConfig,
    emit_every_source_frames: u64,
    emit_image_every_source_frames: u64,
    on_progress: F,
) -> Result<PaImageBuildResult, String>
where
    F: FnMut(PaImageBuildProgress) -> Result<(), String>,
{
    build_image_from_legacy_file_inner(
        path,
        config,
        None,
        emit_every_source_frames,
        emit_image_every_source_frames,
        on_progress,
    )
}

pub fn build_series_from_legacy_file(
    path: &Path,
    config: &PaImageProcessingConfig,
) -> Result<PaSeriesBuildResult, String> {
    let issue_state = std::cell::RefCell::new(PaBuildIssueState::new());
    let mut points = Vec::new();
    let mut ptp_count = 0u64;
    let mut ptp_sum = 0.0;
    let mut ptp_sum_squares = 0.0;
    let mut ptp_min: Option<f64> = None;
    let mut ptp_max: Option<f64> = None;

    visit_legacy_frames(
        path,
        |frame| {
            if frame.payload.len() < PA_METADATA_BYTES {
                let mut issue_state = issue_state.borrow_mut();
                issue_state.bad_frame_count += 1;
                issue_state.push(
                    PaSeverity::Warning,
                    format!("frame {} payload shorter than metadata", frame.frame_id),
                    Some(frame.block_id),
                    Some(frame.frame_id),
                );
                return Ok(true);
            }

            let metadata = match parse_metadata(&frame.payload[..PA_METADATA_BYTES]) {
                Ok(metadata) => Some(metadata),
                Err(err) => {
                    let mut issue_state = issue_state.borrow_mut();
                    issue_state.push(
                        PaSeverity::Warning,
                        format!("frame {} metadata parse failed: {err}", frame.frame_id),
                        Some(frame.block_id),
                        Some(frame.frame_id),
                    );
                    None
                }
            };
            let ptp = match compute_frame_ptp_from_sample_bytes(&frame.payload[PA_METADATA_BYTES..], config) {
                Ok(value) => {
                    ptp_count += 1;
                    ptp_sum += value;
                    ptp_sum_squares += value * value;
                    ptp_min = Some(ptp_min.map_or(value, |current| current.min(value)));
                    ptp_max = Some(ptp_max.map_or(value, |current| current.max(value)));
                    Some(value)
                }
                Err(err) => {
                    let mut issue_state = issue_state.borrow_mut();
                    issue_state.bad_frame_count += 1;
                    issue_state.push(
                        PaSeverity::Warning,
                        format!("frame {} ptp failed: {err}", frame.frame_id),
                        Some(frame.block_id),
                        Some(frame.frame_id),
                    );
                    None
                }
            };
            points.push(PaSeriesPoint {
                frame_index: frame.frame_index,
                frame_id: frame.frame_id,
                global_shot_idx: metadata.as_ref().map(|item| item.global_shot_idx),
                current_x: metadata.as_ref().map(|item| item.current_x),
                current_y: metadata.as_ref().map(|item| item.current_y),
                ptp,
            });
            Ok(true)
        },
        |warning| {
            let mut issue_state = issue_state.borrow_mut();
            issue_state.bad_frame_count += warning.bad_frame_count;
            issue_state.push_existing(warning.issue);
        },
    )?;

    let ptp_average = if ptp_count > 0 {
        Some(ptp_sum / ptp_count as f64)
    } else {
        None
    };
    let ptp_variance = ptp_average.map(|average| (ptp_sum_squares / ptp_count as f64 - average * average).max(0.0));

    let issue_state = issue_state.into_inner();
    Ok(PaSeriesBuildResult {
        path: path.display().to_string(),
        frame_count: points.len() as u64,
        bad_frame_count: issue_state.bad_frame_count,
        ptp_average,
        ptp_variance,
        ptp_std: ptp_variance.map(f64::sqrt),
        ptp_min,
        ptp_max,
        points,
        severity: issue_state.severity,
        issues: issue_state.issues,
    })
}

pub fn scan_legacy_file(path: &Path) -> Result<PaFileSummary, String> {
    let file = File::open(path).map_err(|err| format!("open {} failed: {err}", path.display()))?;
    let file_size = file
        .metadata()
        .map_err(|err| format!("metadata {} failed: {err}", path.display()))?
        .len();
    let mut reader = BufReader::new(file);

    let mut summary = PaFileSummary {
        path: path.display().to_string(),
        file_size,
        block_count: 0,
        frame_count: 0,
        bad_frame_count: 0,
        block_id_gaps: 0,
        frame_id_gaps: 0,
        global_shot_gaps: 0,
        frame_count_mismatches: 0,
        first_block_id: None,
        last_block_id: None,
        first_frame_id: None,
        last_frame_id: None,
        first_global_shot_idx: None,
        last_global_shot_idx: None,
        detected_x_points: None,
        detected_y_points: None,
        detected_frame_number: None,
        detected_sample_count_min: 0,
        detected_sample_count_max: 0,
        severity: PaSeverity::Ok,
        issues: Vec::new(),
    };

    let mut offset = 0u64;
    while offset < file_size {
        if file_size - offset < AXIS_BLOCK_HEADER_BYTES as u64 {
            return Err(format!(
                "short block header at byte {offset}: {} bytes remain",
                file_size - offset
            ));
        }

        let mut block_header = [0u8; AXIS_BLOCK_HEADER_BYTES];
        read_exact_at(&mut reader, &mut block_header, offset, "block header")?;
        let block = parse_block_header(&block_header)?;
        offset += AXIS_BLOCK_HEADER_BYTES as u64;
        summary.block_count += 1;
        if let Some(last_block_id) = summary.last_block_id {
            if block.block_id != last_block_id.saturating_add(1) {
                summary.block_id_gaps += 1;
                push_issue(
                    &mut summary,
                    PaSeverity::Warning,
                    format!("block_id gap: expected {}, got {}", last_block_id + 1, block.block_id),
                    Some(block.block_id),
                    None,
                );
            }
        } else {
            summary.first_block_id = Some(block.block_id);
        }
        summary.last_block_id = Some(block.block_id);

        let block_payload_bytes = usize::try_from(block.used_bytes)
            .map_err(|_| format!("block {} payload size is not addressable", block.block_id))?;
        let block_end = offset.checked_add(u64::from(block.used_bytes)).ok_or_else(|| {
            format!("block {} size overflows address space", block.block_id)
        })?;
        if block_end > file_size {
            return Err(format!(
                "block {} declares {} payload bytes but only {} remain",
                block.block_id,
                block_payload_bytes,
                file_size.saturating_sub(offset)
            ));
        }
        if block.frame_count > 0 && block.last_frame_id < block.first_frame_id {
            push_issue(
                &mut summary,
                PaSeverity::Warning,
                format!(
                    "block {} has invalid frame id range {}..{}",
                    block.block_id, block.first_frame_id, block.last_frame_id
                ),
                Some(block.block_id),
                None,
            );
        }
        if block.frame_count > 0 {
            let expected_last_frame_id = block.first_frame_id.saturating_add(u64::from(block.frame_count - 1));
            if block.last_frame_id != expected_last_frame_id {
                summary.frame_count_mismatches += 1;
                push_issue(
                    &mut summary,
                    PaSeverity::Warning,
                    format!(
                        "block {} frame range/count mismatch: {}..{} for {} frames",
                        block.block_id, block.first_frame_id, block.last_frame_id, block.frame_count
                    ),
                    Some(block.block_id),
                    None,
                );
            }
        }

        let mut block_remaining = block_payload_bytes;
        for frame_index in 0..block.frame_count {
            if block_remaining < AXIS_FRAME_HEADER_BYTES {
                push_issue(
                    &mut summary,
                    PaSeverity::Warning,
                    format!(
                        "block {} ended before frame {} header",
                        block.block_id, frame_index
                    ),
                    Some(block.block_id),
                    None,
                );
                summary.bad_frame_count += u64::from(block.frame_count - frame_index);
                skip_exact_at(&mut reader, block_remaining, offset, "trailing block payload")?;
                offset += block_remaining as u64;
                block_remaining = 0;
                break;
            }

            let mut frame_header = [0u8; AXIS_FRAME_HEADER_BYTES];
            read_exact_at(&mut reader, &mut frame_header, offset, "frame header")?;
            let frame = parse_frame_header(&frame_header)?;
            offset += AXIS_FRAME_HEADER_BYTES as u64;
            block_remaining -= AXIS_FRAME_HEADER_BYTES;

            if frame_index == 0 && frame.frame_id != block.first_frame_id {
                summary.frame_count_mismatches += 1;
                push_issue(
                    &mut summary,
                    PaSeverity::Warning,
                    format!(
                        "block {} first payload frame_id {} does not match header {}",
                        block.block_id, frame.frame_id, block.first_frame_id
                    ),
                    Some(block.block_id),
                    Some(frame.frame_id),
                );
            }
            if frame_index == block.frame_count - 1 && frame.frame_id != block.last_frame_id {
                summary.frame_count_mismatches += 1;
                push_issue(
                    &mut summary,
                    PaSeverity::Warning,
                    format!(
                        "block {} last payload frame_id {} does not match header {}",
                        block.block_id, frame.frame_id, block.last_frame_id
                    ),
                    Some(block.block_id),
                    Some(frame.frame_id),
                );
            }
            if let Some(last_frame_id) = summary.last_frame_id {
                if frame.frame_id != last_frame_id.saturating_add(1) {
                    summary.frame_id_gaps += 1;
                    push_issue(
                        &mut summary,
                        PaSeverity::Warning,
                        format!("frame_id gap: expected {}, got {}", last_frame_id + 1, frame.frame_id),
                        Some(block.block_id),
                        Some(frame.frame_id),
                    );
                }
            } else {
                summary.first_frame_id = Some(frame.frame_id);
            }
            summary.last_frame_id = Some(frame.frame_id);

            let data_bytes = frame.data_bytes as usize;
            if frame.reserved != 0 {
                push_issue(
                    &mut summary,
                    PaSeverity::Warning,
                    format!("frame {} reserved header field is non-zero", frame.frame_id),
                    Some(block.block_id),
                    Some(frame.frame_id),
                );
            }
            if data_bytes > block_remaining {
                push_issue(
                    &mut summary,
                    PaSeverity::Warning,
                    format!("frame {} payload exceeds block payload", frame.frame_id),
                    Some(block.block_id),
                    Some(frame.frame_id),
                );
                summary.bad_frame_count += 1;
                skip_exact_at(&mut reader, block_remaining, offset, "trailing block payload")?;
                offset += block_remaining as u64;
                block_remaining = 0;
                break;
            }

            let mut payload = vec![0u8; data_bytes];
            read_exact_at(&mut reader, &mut payload, offset, "frame payload")?;
            offset += data_bytes as u64;
            block_remaining -= data_bytes;

            if data_bytes < PA_METADATA_BYTES {
                push_issue(
                    &mut summary,
                    PaSeverity::Warning,
                    format!("frame {} payload shorter than metadata", frame.frame_id),
                    Some(block.block_id),
                    Some(frame.frame_id),
                );
                summary.bad_frame_count += 1;
                continue;
            }

            match parse_metadata(&payload[..PA_METADATA_BYTES]) {
                Ok(metadata) => {
                    summary.frame_count += 1;
                    if let Some(last_global_shot_idx) = summary.last_global_shot_idx {
                        if metadata.global_shot_idx != last_global_shot_idx.saturating_add(1) {
                            summary.global_shot_gaps += 1;
                            push_issue(
                                &mut summary,
                                PaSeverity::Warning,
                                format!(
                                    "global_shot_idx gap: expected {}, got {}",
                                    last_global_shot_idx + 1,
                                    metadata.global_shot_idx
                                ),
                                Some(block.block_id),
                                Some(frame.frame_id),
                            );
                        }
                    } else {
                        summary.first_global_shot_idx = Some(metadata.global_shot_idx);
                    }
                    summary.last_global_shot_idx = Some(metadata.global_shot_idx);
                    set_or_warn_u16(
                        &mut summary,
                        "x_points",
                        metadata.x_points,
                        Some(block.block_id),
                        Some(frame.frame_id),
                    );
                    if summary.detected_x_points.is_none() {
                        summary.detected_x_points = Some(metadata.x_points);
                    }
                    if summary.detected_y_points.is_none() {
                        summary.detected_y_points = Some(metadata.y_points);
                    } else if summary.detected_y_points != Some(metadata.y_points) {
                        push_issue(
                            &mut summary,
                            PaSeverity::Warning,
                            format!("inconsistent y_points {}", metadata.y_points),
                            Some(block.block_id),
                            Some(frame.frame_id),
                        );
                    }
                    if summary.detected_frame_number.is_none() {
                        summary.detected_frame_number = Some(metadata.frame_number);
                    } else if summary.detected_frame_number != Some(metadata.frame_number) {
                        push_issue(
                            &mut summary,
                            PaSeverity::Warning,
                            format!("inconsistent frame_number {}", metadata.frame_number),
                            Some(block.block_id),
                            Some(frame.frame_id),
                        );
                    }

                    let sample_count = (data_bytes - PA_METADATA_BYTES) / 2;
                    update_sample_count(&mut summary, sample_count);
                    if (data_bytes - PA_METADATA_BYTES) % 2 != 0 {
                        push_issue(
                            &mut summary,
                            PaSeverity::Warning,
                            format!("frame {} has trailing odd sample byte", frame.frame_id),
                            Some(block.block_id),
                            Some(frame.frame_id),
                        );
                    }
                }
                Err(err) => {
                    push_issue(
                        &mut summary,
                        PaSeverity::Warning,
                        format!("frame {} metadata parse failed: {err}", frame.frame_id),
                        Some(block.block_id),
                        Some(frame.frame_id),
                    );
                    summary.bad_frame_count += 1;
                }
            }
        }

        if block_remaining > 0 {
            push_issue(
                &mut summary,
                PaSeverity::Warning,
                format!(
                    "block {} has {} unused payload bytes",
                    block.block_id,
                    block_remaining
                ),
                Some(block.block_id),
                None,
            );
            skip_exact_at(&mut reader, block_remaining, offset, "unused block payload")?;
        }

        offset = block_end;
    }

    Ok(summary)
}

fn read_exact_at<R: Read>(reader: &mut R, buf: &mut [u8], offset: u64, label: &str) -> Result<(), String> {
    reader
        .read_exact(buf)
        .map_err(|err| format!("read {label} at byte {offset} failed: {err}"))
}

fn skip_exact_at<R: Read>(reader: &mut R, byte_count: usize, offset: u64, label: &str) -> Result<(), String> {
    let mut remaining = byte_count;
    let mut scratch = [0u8; 8192];
    while remaining > 0 {
        let chunk_len = remaining.min(scratch.len());
        read_exact_at(reader, &mut scratch[..chunk_len], offset + (byte_count - remaining) as u64, label)?;
        remaining -= chunk_len;
    }
    Ok(())
}

fn visit_legacy_frames<F, W>(path: &Path, mut on_frame: F, mut on_warning: W) -> Result<(), String>
where
    F: FnMut(LegacyFramePayload) -> Result<bool, String>,
    W: FnMut(LegacyStreamWarning),
{
    let file = File::open(path).map_err(|err| format!("open {} failed: {err}", path.display()))?;
    let file_size = file
        .metadata()
        .map_err(|err| format!("metadata {} failed: {err}", path.display()))?
        .len();
    let mut reader = BufReader::new(file);
    let mut offset = 0u64;
    let mut global_frame_index = 0u64;

    while offset < file_size {
        if file_size - offset < AXIS_BLOCK_HEADER_BYTES as u64 {
            return Err(format!(
                "short block header at byte {offset}: {} bytes remain",
                file_size - offset
            ));
        }

        let mut block_header = [0u8; AXIS_BLOCK_HEADER_BYTES];
        read_exact_at(&mut reader, &mut block_header, offset, "block header")?;
        let block = parse_block_header(&block_header)?;
        offset += AXIS_BLOCK_HEADER_BYTES as u64;

        let block_payload_bytes = usize::try_from(block.used_bytes)
            .map_err(|_| format!("block {} payload size is not addressable", block.block_id))?;
        let block_end = offset.checked_add(u64::from(block.used_bytes)).ok_or_else(|| {
            format!("block {} size overflows address space", block.block_id)
        })?;
        if block_end > file_size {
            return Err(format!(
                "block {} declares {} payload bytes but only {} remain",
                block.block_id,
                block_payload_bytes,
                file_size.saturating_sub(offset)
            ));
        }
        if block.frame_count > 0 && block.last_frame_id < block.first_frame_id {
            on_warning(LegacyStreamWarning {
                issue: make_parse_issue(
                    PaSeverity::Warning,
                    format!(
                        "block {} has invalid frame id range {}..{}",
                        block.block_id, block.first_frame_id, block.last_frame_id
                    ),
                    Some(block.block_id),
                    None,
                ),
                bad_frame_count: 0,
            });
        }

        let mut block_remaining = block_payload_bytes;
        for frame_index in 0..block.frame_count {
            if block_remaining < AXIS_FRAME_HEADER_BYTES {
                on_warning(LegacyStreamWarning {
                    issue: make_parse_issue(
                        PaSeverity::Warning,
                        format!(
                            "block {} ended before frame {} header",
                            block.block_id, frame_index
                        ),
                        Some(block.block_id),
                        None,
                    ),
                    bad_frame_count: u64::from(block.frame_count - frame_index),
                });
                skip_exact_at(&mut reader, block_remaining, offset, "trailing block payload")?;
                offset += block_remaining as u64;
                block_remaining = 0;
                break;
            }

            let mut frame_header = [0u8; AXIS_FRAME_HEADER_BYTES];
            read_exact_at(&mut reader, &mut frame_header, offset, "frame header")?;
            let frame = parse_frame_header(&frame_header)?;
            offset += AXIS_FRAME_HEADER_BYTES as u64;
            block_remaining -= AXIS_FRAME_HEADER_BYTES;

            let data_bytes = frame.data_bytes as usize;
            if frame.reserved != 0 {
                on_warning(LegacyStreamWarning {
                    issue: make_parse_issue(
                        PaSeverity::Warning,
                        format!("frame {} reserved header field is non-zero", frame.frame_id),
                        Some(block.block_id),
                        Some(frame.frame_id),
                    ),
                    bad_frame_count: 0,
                });
            }
            if data_bytes > block_remaining {
                on_warning(LegacyStreamWarning {
                    issue: make_parse_issue(
                        PaSeverity::Warning,
                        format!("frame {} payload exceeds block payload", frame.frame_id),
                        Some(block.block_id),
                        Some(frame.frame_id),
                    ),
                    bad_frame_count: 1,
                });
                skip_exact_at(&mut reader, block_remaining, offset, "trailing block payload")?;
                offset += block_remaining as u64;
                block_remaining = 0;
                break;
            }

            let mut payload = vec![0u8; data_bytes];
            read_exact_at(&mut reader, &mut payload, offset, "frame payload")?;
            offset += data_bytes as u64;
            block_remaining -= data_bytes;

            let should_continue = on_frame(LegacyFramePayload {
                block_id: block.block_id,
                frame_index: global_frame_index,
                frame_id: frame.frame_id,
                payload,
            })?;
            global_frame_index += 1;
            if !should_continue {
                return Ok(());
            }
        }

        if block_remaining > 0 {
            on_warning(LegacyStreamWarning {
                issue: make_parse_issue(
                    PaSeverity::Warning,
                    format!(
                        "block {} has {} unused payload bytes",
                        block.block_id, block_remaining
                    ),
                    Some(block.block_id),
                    None,
                ),
                bad_frame_count: 0,
            });
            skip_exact_at(&mut reader, block_remaining, offset, "unused block payload")?;
        }

        offset = block_end;
    }

    Ok(())
}

fn decode_i16_samples(raw: &[u8]) -> Vec<i16> {
    raw.chunks_exact(2)
        .map(|chunk| i16::from_le_bytes([chunk[0], chunk[1]]))
        .collect()
}

fn parse_block_header(raw: &[u8]) -> Result<AxisBlockHeader, String> {
    if raw.len() < AXIS_BLOCK_HEADER_BYTES {
        return Err("short block header".to_string());
    }
    Ok(AxisBlockHeader {
        block_id: read_u64(raw, 0)?,
        used_bytes: read_u32(raw, 8)?,
        frame_count: read_u32(raw, 12)?,
        first_frame_id: read_u64(raw, 16)?,
        last_frame_id: read_u64(raw, 24)?,
    })
}

fn parse_frame_header(raw: &[u8]) -> Result<AxisFrameHeader, String> {
    if raw.len() < AXIS_FRAME_HEADER_BYTES {
        return Err("short frame header".to_string());
    }
    Ok(AxisFrameHeader {
        frame_id: read_u64(raw, 0)?,
        data_bytes: read_u32(raw, 8)?,
        reserved: read_u32(raw, 12)?,
    })
}

fn sample_window_indices(
    len: usize,
    interval_ns: f64,
    start_ns: f64,
    end_ns: f64,
) -> Result<(usize, usize), String> {
    if !start_ns.is_finite() || !end_ns.is_finite() {
        return Err("time windows must be finite".to_string());
    }
    if start_ns < 0.0 || end_ns < 0.0 || end_ns <= start_ns {
        return Err("time window must be non-negative and increasing".to_string());
    }

    let start = (start_ns / interval_ns).ceil() as usize;
    let end = (end_ns / interval_ns).ceil() as usize;
    let end = end.min(len);
    if start >= end || start >= len {
        return Err("time window selects no samples".to_string());
    }

    Ok((start, end))
}

fn update_sample_count(summary: &mut PaFileSummary, sample_count: usize) {
    if summary.detected_sample_count_min == 0 || sample_count < summary.detected_sample_count_min {
        summary.detected_sample_count_min = sample_count;
    }
    if sample_count > summary.detected_sample_count_max {
        summary.detected_sample_count_max = sample_count;
    }
}

fn set_or_warn_u16(
    summary: &mut PaFileSummary,
    field: &str,
    value: u16,
    block_id: Option<u64>,
    frame_id: Option<u64>,
) {
    if summary.detected_x_points == Some(value) || field != "x_points" {
        return;
    }
    if summary.detected_x_points.is_some() {
        push_issue(
            summary,
            PaSeverity::Warning,
            format!("inconsistent {field} {value}"),
            block_id,
            frame_id,
        );
    }
}

fn push_issue(
    summary: &mut PaFileSummary,
    severity: PaSeverity,
    message: String,
    block_id: Option<u64>,
    frame_id: Option<u64>,
) {
    push_parse_issue_to(
        &mut summary.issues,
        &mut summary.severity,
        severity,
        message,
        block_id,
        frame_id,
    );
}

fn push_parse_issue_to(
    issues: &mut Vec<PaParseIssue>,
    current_severity: &mut PaSeverity,
    severity: PaSeverity,
    message: String,
    block_id: Option<u64>,
    frame_id: Option<u64>,
) {
    push_existing_issue_to(
        issues,
        current_severity,
        make_parse_issue(severity, message, block_id, frame_id),
    );
}

fn push_existing_issue_to(
    issues: &mut Vec<PaParseIssue>,
    current_severity: &mut PaSeverity,
    issue: PaParseIssue,
) {
    if severity_rank(issue.severity) > severity_rank(*current_severity) {
        *current_severity = issue.severity;
    }
    issues.push(issue);
}

fn make_parse_issue(
    severity: PaSeverity,
    message: String,
    block_id: Option<u64>,
    frame_id: Option<u64>,
) -> PaParseIssue {
    PaParseIssue {
        severity,
        message,
        block_id,
        frame_id,
    }
}

fn severity_rank(severity: PaSeverity) -> u8 {
    match severity {
        PaSeverity::Ok => 0,
        PaSeverity::Warning => 1,
        PaSeverity::Error => 2,
    }
}

fn read_u16(raw: &[u8], offset: usize) -> Result<u16, String> {
    let bytes = raw
        .get(offset..offset + 2)
        .ok_or_else(|| format!("short read for u16 at byte {offset}"))?;
    Ok(u16::from_le_bytes([bytes[0], bytes[1]]))
}

fn read_i16(raw: &[u8], offset: usize) -> Result<i16, String> {
    let bytes = raw
        .get(offset..offset + 2)
        .ok_or_else(|| format!("short read for i16 at byte {offset}"))?;
    Ok(i16::from_le_bytes([bytes[0], bytes[1]]))
}

fn read_u32(raw: &[u8], offset: usize) -> Result<u32, String> {
    let bytes = raw
        .get(offset..offset + 4)
        .ok_or_else(|| format!("short read for u32 at byte {offset}"))?;
    Ok(u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]))
}

fn read_u64(raw: &[u8], offset: usize) -> Result<u64, String> {
    let bytes = raw
        .get(offset..offset + 8)
        .ok_or_else(|| format!("short read for u64 at byte {offset}"))?;
    Ok(u64::from_le_bytes([
        bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5], bytes[6], bytes[7],
    ]))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use std::path::PathBuf;

    #[test]
    fn parses_little_endian_metadata_magic_and_indices() {
        let mut raw = [0u8; 32];
        raw[4..8].copy_from_slice(&7u32.to_le_bytes());
        raw[8..10].copy_from_slice(&5u16.to_le_bytes());
        raw[10..12].copy_from_slice(&4u16.to_le_bytes());
        raw[12..14].copy_from_slice(&3u16.to_le_bytes());
        raw[14..16].copy_from_slice(&2u16.to_le_bytes());
        raw[16..18].copy_from_slice(&1u16.to_le_bytes());
        raw[18..20].copy_from_slice(&9u16.to_le_bytes());
        raw[20..22].copy_from_slice(&(-120i16).to_le_bytes());
        raw[22..24].copy_from_slice(&(320i16).to_le_bytes());
        raw[24..28].copy_from_slice(&11u32.to_le_bytes());
        raw[28..32].copy_from_slice(&PA_META_MAGIC.to_le_bytes());

        let meta = parse_metadata(&raw).expect("metadata parses");

        assert_eq!(meta.global_shot_idx, 7);
        assert_eq!(meta.y_points, 5);
        assert_eq!(meta.x_points, 4);
        assert_eq!(meta.frame_number, 3);
        assert_eq!(meta.frame_idx, 2);
        assert_eq!(meta.y_idx, 1);
        assert_eq!(meta.x_idx, 9);
        assert_eq!(meta.current_y, -120);
        assert_eq!(meta.current_x, 320);
        assert_eq!(meta.task_id, 11);
    }

    #[test]
    fn computes_ptp_after_baseline_subtraction_from_signed_codes() {
        let samples = vec![0i16, 0, 0, -32768, 32767, 0];
        let config = PaImageProcessingConfig {
            sample_interval_ns: 8.0,
            sample_start_index: 0,
            sample_end_trim: 0,
            baseline_start_ns: 0.0,
            baseline_end_ns: 16.0,
            ptp_start_ns: 24.0,
            ptp_end_ns: 40.0,
            tz_ohm: 2000.0,
            vfs: 1.0,
            zero_adc_code: default_zero_adc_code(),
        };

        let result = compute_frame_ptp(&samples, &config).expect("ptp");

        assert!(result > 999.0);
        assert!(result < 1001.0);
    }

    #[test]
    fn signed_code_to_current_uses_zero_adc_code_before_tz_scaling() {
        let zero_at_2k = signed_code_to_current_ua(29620, 2000.0, 1.0, 29620.0);
        assert!(zero_at_2k.abs() < 1e-9);
        let zero_at_20k = signed_code_to_current_ua(29620, 20000.0, 1.0, 29620.0);
        assert!(zero_at_20k.abs() < 1e-9);
    }

    #[test]
    fn scans_synthetic_legacy_file_without_hardcoding_sample_count() {
        let path = write_synthetic_legacy_file("pa_scan_sample_count", 2, 6);

        let summary = scan_legacy_file(&path).expect("scan");

        assert_eq!(summary.severity, PaSeverity::Ok);
        assert_eq!(summary.frame_count, 2);
        assert_eq!(summary.detected_sample_count_min, 6);
        assert_eq!(summary.detected_sample_count_max, 6);
    }

    #[test]
    fn builds_image_from_synthetic_repeated_pixels() {
        let path = write_synthetic_grid_file("pa_build_image", 2, 2, 2);
        let config = PaImageProcessingConfig::default_for_tz(2000.0);

        let image = build_image_from_legacy_file(&path, &config).expect("image");

        assert_eq!(image.width, 2);
        assert_eq!(image.height, 2);
        assert_eq!(image.pixel_count, 4);
        assert_eq!(image.frame_count, 8);
        assert_eq!(image.counts, vec![2, 2, 2, 2]);
    }

    #[test]
    fn build_image_reports_actual_coordinate_bounds_and_first_frame_indices() {
        let path = write_synthetic_grid_file("pa_build_image_coords", 2, 2, 2);
        let config = PaImageProcessingConfig::default_for_tz(2000.0);

        let image = build_image_from_legacy_file(&path, &config).expect("image");

        assert_eq!(image.x_start, Some(0));
        assert_eq!(image.x_end, Some(1));
        assert_eq!(image.y_start, Some(0));
        assert_eq!(image.y_end, Some(1));
        assert_eq!(image.pixel_frame_indices, vec![Some(0), Some(1), Some(2), Some(3)]);
    }

    #[test]
    fn builds_image_from_requested_frame_range() {
        let path = write_synthetic_grid_file("pa_build_image_range", 2, 2, 2);
        let config = PaImageProcessingConfig::default_for_tz(2000.0);

        let image = build_image_range_from_legacy_file(&path, &config, 2, 3).expect("image range");

        assert_eq!(image.width, 2);
        assert_eq!(image.height, 2);
        assert_eq!(image.pixel_count, 4);
        assert_eq!(image.frame_count, 3);
        assert_eq!(image.counts.iter().sum::<u32>(), 3);
    }

    #[test]
    fn streamed_image_build_separates_progress_from_image_snapshots() {
        let path = write_synthetic_grid_file("pa_build_image_progress", 2, 2, 3);
        let config = PaImageProcessingConfig::default_for_tz(2000.0);
        let mut progress = Vec::new();

        let image = build_image_from_legacy_file_with_progress(&path, &config, 1, 5, |event| {
            progress.push(event);
            Ok(())
        })
        .expect("streamed image");

        assert_eq!(image.frame_count, 12);
        assert!(progress.iter().any(|event| event.image.is_none()));
        assert!(progress.iter().any(|event| event.image.is_some()));
    }

    #[test]
    fn streamed_image_build_propagates_progress_errors_for_cancellation() {
        let path = write_synthetic_grid_file("pa_build_image_cancel", 2, 2, 6);
        let config = PaImageProcessingConfig::default_for_tz(2000.0);
        let mut progress_events = 0;

        let err = build_image_from_legacy_file_with_progress(&path, &config, 1, 0, |_event| {
            progress_events += 1;
            if progress_events >= 3 {
                Err("PA image build cancelled".to_string())
            } else {
                Ok(())
            }
        })
        .expect_err("progress callback should stop image build");

        assert!(err.contains("cancelled"));
        assert_eq!(progress_events, 3);
    }

    #[test]
    fn live_accumulator_updates_from_one_data_payload() {
        let accumulator = PaLiveImageAccumulator::new();
        let path = write_synthetic_grid_file("pa_live_accumulator", 2, 1, 1);
        let bytes = std::fs::read(path).expect("read synthetic grid");
        let payload = &bytes[AXIS_BLOCK_HEADER_BYTES..];
        let config = PaImageProcessingConfig::default_for_tz(2000.0);

        accumulator.set_processing(config);
        accumulator
            .ingest_legacy_block_payload(payload)
            .expect("ingest block payload");
        let image = accumulator.snapshot();

        assert_eq!(image.width, 2);
        assert_eq!(image.height, 1);
        assert_eq!(image.frame_count, 2);
        assert_eq!(image.counts, vec![1, 1]);
        assert!(image.values.iter().all(|value| value.unwrap_or_default() > 0.0));
    }

    #[test]
    fn image_build_skips_inconsistent_dimensions() {
        let path = write_synthetic_frame_specs(
            "pa_mismatch_dims",
            &[
                SyntheticFrameSpec {
                    width: 2,
                    height: 2,
                    x: 0,
                    y: 0,
                },
                SyntheticFrameSpec {
                    width: 3,
                    height: 3,
                    x: 1,
                    y: 0,
                },
            ],
        );
        let config = PaImageProcessingConfig::default_for_tz(2000.0);

        let image = build_image_from_legacy_file(&path, &config).expect("image");

        assert_eq!(image.width, 2);
        assert_eq!(image.height, 2);
        assert_eq!(image.frame_count, 1);
        assert_eq!(image.bad_frame_count, 1);
        assert_eq!(image.counts, vec![1, 0, 0, 0]);
        assert_eq!(image.severity, PaSeverity::Warning);
    }

    #[test]
    fn image_build_leaves_missing_pixels_empty() {
        let path = write_synthetic_frame_specs(
            "pa_missing_pixel",
            &[SyntheticFrameSpec {
                width: 2,
                height: 2,
                x: 1,
                y: 0,
            }],
        );
        let config = PaImageProcessingConfig::default_for_tz(2000.0);

        let image = build_image_from_legacy_file(&path, &config).expect("image");

        assert_eq!(image.counts, vec![0, 1, 0, 0]);
        assert_eq!(image.values[0], None);
        assert!(image.values[1].is_some());
        assert_eq!(image.values[2], None);
        assert_eq!(image.values[3], None);
    }

    #[test]
    fn extracts_one_frame_trace_with_time_axis() {
        let path = write_synthetic_legacy_file("pa_frame_trace", 1, 5);

        let trace = read_frame_trace_from_legacy_file(&path, 0, 2000.0, 1.0, 0.0).expect("trace");

        assert_eq!(trace.samples.len(), 5);
        assert_eq!(trace.time_ns, vec![0.0, 8.0, 16.0, 24.0, 32.0]);
        assert_eq!(trace.frame_index, 0);
    }

    #[test]
    fn trace_read_uses_vfs_for_current_conversion() {
        let path = write_synthetic_legacy_file("pa_frame_trace_vfs", 1, 5);

        let trace_1v = read_frame_trace_from_legacy_file(&path, 0, 2000.0, 1.0, 0.0).expect("trace 1v");
        let trace_2v = read_frame_trace_from_legacy_file(&path, 0, 2000.0, 2.0, 0.0).expect("trace 2v");

        assert_ne!(trace_1v.current_ua[1], trace_2v.current_ua[1]);
    }

    #[test]
    fn trace_read_rejects_out_of_range_frame_index() {
        let path = write_synthetic_legacy_file("pa_frame_trace_missing", 1, 5);

        let err = read_frame_trace_from_legacy_file(&path, 1, 2000.0, 1.0, 0.0).expect_err("missing frame");

        assert!(err.contains("frame index 1 not found"));
    }

    #[test]
    fn trace_read_rejects_invalid_tz_ohm() {
        let path = write_synthetic_legacy_file("pa_frame_trace_bad_tz", 1, 5);

        let err = read_frame_trace_from_legacy_file(&path, 0, 0.0, 1.0, 0.0).expect_err("invalid tz");

        assert!(err.contains("tz_ohm"));
    }

    #[test]
    fn image_builder_does_not_decode_samples_to_vec() {
        let source = include_str!("pa_image.rs");
        let build_source = source
            .split("pub fn build_image_from_legacy_file")
            .nth(1)
            .expect("build function source")
            .split("pub fn scan_legacy_file")
            .next()
            .expect("build function end");

        assert!(!build_source.contains("decode_i16_samples"));
        assert!(!build_source.contains("compute_frame_ptp("));
    }

    #[test]
    fn scanner_does_not_use_whole_file_read() {
        let source = include_str!("pa_image.rs");

        assert!(!source.contains(&format!("read_to{}", "_end")));
    }

    #[test]
    fn scanner_does_not_decode_sample_codes() {
        let source = include_str!("pa_image.rs");
        let scan_source = source
            .split("pub fn scan_legacy_file")
            .nth(1)
            .expect("scan function source")
            .split("fn read_exact_at")
            .next()
            .expect("scan function end");

        assert!(!scan_source.contains("i16::from_le_bytes"));
    }

    pub fn write_synthetic_legacy_file(name: &str, frame_count: usize, sample_count: usize) -> PathBuf {
        let mut path = std::env::temp_dir();
        path.push(format!("{name}_{}_{}.bin", std::process::id(), frame_count));

        let frame_payload_bytes = PA_METADATA_BYTES + sample_count * 2;
        let frame_bytes = AXIS_FRAME_HEADER_BYTES + frame_payload_bytes;
        let used_bytes = frame_count * frame_bytes;

        let mut file = std::fs::File::create(&path).expect("create synthetic legacy file");
        file.write_all(&1u64.to_le_bytes()).expect("block id");
        file.write_all(&(used_bytes as u32).to_le_bytes()).expect("used bytes");
        file.write_all(&(frame_count as u32).to_le_bytes()).expect("frame count");
        file.write_all(&1u64.to_le_bytes()).expect("first frame id");
        file.write_all(&(frame_count as u64).to_le_bytes()).expect("last frame id");

        for frame_idx in 0..frame_count {
            file.write_all(&(frame_idx as u64 + 1).to_le_bytes()).expect("frame id");
            file.write_all(&(frame_payload_bytes as u32).to_le_bytes())
                .expect("frame data bytes");
            file.write_all(&0u32.to_le_bytes()).expect("frame reserved");

            let mut metadata = [0u8; PA_METADATA_BYTES];
            metadata[4..8].copy_from_slice(&(frame_idx as u32 + 1).to_le_bytes());
            metadata[8..10].copy_from_slice(&1u16.to_le_bytes());
            metadata[10..12].copy_from_slice(&(frame_count as u16).to_le_bytes());
            metadata[12..14].copy_from_slice(&(frame_count as u16).to_le_bytes());
            metadata[14..16].copy_from_slice(&(frame_idx as u16).to_le_bytes());
            metadata[16..18].copy_from_slice(&0u16.to_le_bytes());
            metadata[18..20].copy_from_slice(&(frame_idx as u16).to_le_bytes());
            metadata[20..22].copy_from_slice(&0i16.to_le_bytes());
            metadata[22..24].copy_from_slice(&(frame_idx as i16).to_le_bytes());
            metadata[24..28].copy_from_slice(&99u32.to_le_bytes());
            metadata[28..32].copy_from_slice(&PA_META_MAGIC.to_le_bytes());
            file.write_all(&metadata).expect("metadata");

            for sample in 0..sample_count {
                file.write_all(&(sample as i16).to_le_bytes()).expect("sample");
            }
        }

        path
    }

    struct SyntheticFrameSpec {
        width: usize,
        height: usize,
        x: usize,
        y: usize,
    }

    fn write_synthetic_frame_specs(name: &str, frames: &[SyntheticFrameSpec]) -> PathBuf {
        let mut path = std::env::temp_dir();
        path.push(format!(
            "{name}_{}_{}.bin",
            std::process::id(),
            frames.len()
        ));

        let sample_count = 380usize;
        let frame_payload_bytes = PA_METADATA_BYTES + sample_count * 2;
        let frame_bytes = AXIS_FRAME_HEADER_BYTES + frame_payload_bytes;
        let used_bytes = frames.len() * frame_bytes;

        let mut file = std::fs::File::create(&path).expect("create synthetic frame spec file");
        file.write_all(&1u64.to_le_bytes()).expect("block id");
        file.write_all(&(used_bytes as u32).to_le_bytes()).expect("used bytes");
        file.write_all(&(frames.len() as u32).to_le_bytes())
            .expect("frame count");
        file.write_all(&1u64.to_le_bytes()).expect("first frame id");
        file.write_all(&(frames.len() as u64).to_le_bytes())
            .expect("last frame id");

        for (frame_idx, frame) in frames.iter().enumerate() {
            file.write_all(&(frame_idx as u64 + 1).to_le_bytes())
                .expect("frame id");
            file.write_all(&(frame_payload_bytes as u32).to_le_bytes())
                .expect("frame data bytes");
            file.write_all(&0u32.to_le_bytes()).expect("frame reserved");

            let mut metadata = [0u8; PA_METADATA_BYTES];
            metadata[4..8].copy_from_slice(&(frame_idx as u32 + 1).to_le_bytes());
            metadata[8..10].copy_from_slice(&(frame.height as u16).to_le_bytes());
            metadata[10..12].copy_from_slice(&(frame.width as u16).to_le_bytes());
            metadata[12..14].copy_from_slice(&(frames.len() as u16).to_le_bytes());
            metadata[14..16].copy_from_slice(&(frame_idx as u16).to_le_bytes());
            metadata[16..18].copy_from_slice(&(frame.y as u16).to_le_bytes());
            metadata[18..20].copy_from_slice(&(frame.x as u16).to_le_bytes());
            metadata[20..22].copy_from_slice(&(frame.y as i16).to_le_bytes());
            metadata[22..24].copy_from_slice(&(frame.x as i16).to_le_bytes());
            metadata[24..28].copy_from_slice(&99u32.to_le_bytes());
            metadata[28..32].copy_from_slice(&PA_META_MAGIC.to_le_bytes());
            file.write_all(&metadata).expect("metadata");

            write_synthetic_ptp_samples(&mut file, sample_count);
        }

        path
    }

    pub fn write_synthetic_grid_file(name: &str, width: usize, height: usize, repeats: usize) -> PathBuf {
        let mut path = std::env::temp_dir();
        path.push(format!(
            "{name}_{}_{}_{}_{}.bin",
            std::process::id(),
            width,
            height,
            repeats
        ));

        let frame_count = width * height * repeats;
        let sample_count = 380usize;
        let frame_payload_bytes = PA_METADATA_BYTES + sample_count * 2;
        let frame_bytes = AXIS_FRAME_HEADER_BYTES + frame_payload_bytes;
        let used_bytes = frame_count * frame_bytes;

        let mut file = std::fs::File::create(&path).expect("create synthetic grid file");
        file.write_all(&1u64.to_le_bytes()).expect("block id");
        file.write_all(&(used_bytes as u32).to_le_bytes()).expect("used bytes");
        file.write_all(&(frame_count as u32).to_le_bytes()).expect("frame count");
        file.write_all(&1u64.to_le_bytes()).expect("first frame id");
        file.write_all(&(frame_count as u64).to_le_bytes())
            .expect("last frame id");

        let mut frame_idx = 0usize;
        for repeat in 0..repeats {
            for y in 0..height {
                for x in 0..width {
                    file.write_all(&(frame_idx as u64 + 1).to_le_bytes())
                        .expect("frame id");
                    file.write_all(&(frame_payload_bytes as u32).to_le_bytes())
                        .expect("frame data bytes");
                    file.write_all(&0u32.to_le_bytes()).expect("frame reserved");

                    let mut metadata = [0u8; PA_METADATA_BYTES];
                    metadata[4..8].copy_from_slice(&(frame_idx as u32 + 1).to_le_bytes());
                    metadata[8..10].copy_from_slice(&(height as u16).to_le_bytes());
                    metadata[10..12].copy_from_slice(&(width as u16).to_le_bytes());
                    metadata[12..14].copy_from_slice(&(frame_count as u16).to_le_bytes());
                    metadata[14..16].copy_from_slice(&(repeat as u16).to_le_bytes());
                    metadata[16..18].copy_from_slice(&(y as u16).to_le_bytes());
                    metadata[18..20].copy_from_slice(&(x as u16).to_le_bytes());
                    metadata[20..22].copy_from_slice(&(y as i16).to_le_bytes());
                    metadata[22..24].copy_from_slice(&(x as i16).to_le_bytes());
                    metadata[24..28].copy_from_slice(&99u32.to_le_bytes());
                    metadata[28..32].copy_from_slice(&PA_META_MAGIC.to_le_bytes());
                    file.write_all(&metadata).expect("metadata");

                    write_synthetic_ptp_samples(&mut file, sample_count);

                    frame_idx += 1;
                }
            }
        }

        path
    }

    fn write_synthetic_ptp_samples(file: &mut std::fs::File, sample_count: usize) {
        for sample in 0..sample_count {
            let code = if sample == 220 {
                -1000i16
            } else if sample == 260 {
                1000i16
            } else {
                0i16
            };
            file.write_all(&code.to_le_bytes()).expect("sample");
        }
    }
}
