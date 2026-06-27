use std::fs::File;
use std::io::{BufReader, Read};
use std::path::Path;

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
    pub pixel_count: u64,
    pub frame_count: u64,
    pub bad_frame_count: u64,
    pub severity: PaSeverity,
    pub issues: Vec<PaParseIssue>,
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

pub fn signed_code_to_current_ua(code: i16, tz_ohm: f64, vfs: f64) -> f64 {
    let v_adc = (code as f64) / 32768.0 * vfs;
    ((0.825 - v_adc) / tz_ohm) * 1_000_000.0
}

#[allow(dead_code)]
pub fn compute_frame_ptp(samples: &[i16], config: &PaImageProcessingConfig) -> Result<f64, String> {
    compute_frame_ptp_from_sample_count(samples.len(), config, |index| {
        signed_code_to_current_ua(samples[index], config.tz_ohm, config.vfs)
    })
}

fn compute_frame_ptp_from_sample_bytes(
    raw: &[u8],
    config: &PaImageProcessingConfig,
) -> Result<f64, String> {
    let sample_count = raw.len() / 2;
    compute_frame_ptp_from_sample_count(sample_count, config, |index| {
        let offset = index * 2;
        let code = i16::from_le_bytes([raw[offset], raw[offset + 1]]);
        signed_code_to_current_ua(code, config.tz_ohm, config.vfs)
    })
}

fn compute_frame_ptp_from_sample_count<F>(
    sample_count: usize,
    config: &PaImageProcessingConfig,
    current_at: F,
) -> Result<f64, String>
where
    F: Fn(usize) -> f64,
{
    if !config.sample_interval_ns.is_finite() || config.sample_interval_ns <= 0.0 {
        return Err("sample_interval_ns must be finite and positive".to_string());
    }
    if !config.tz_ohm.is_finite() || config.tz_ohm == 0.0 {
        return Err("tz_ohm must be finite and non-zero".to_string());
    }
    if !config.vfs.is_finite() {
        return Err("vfs must be finite".to_string());
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

    let mut baseline_sum = 0.0;
    for index in baseline_start..baseline_end {
        baseline_sum += current_at(config.sample_start_index + index);
    }
    let baseline = baseline_sum / (baseline_end - baseline_start) as f64;

    let mut min_value = f64::INFINITY;
    let mut max_value = f64::NEG_INFINITY;
    for index in ptp_start..ptp_end {
        let corrected = current_at(config.sample_start_index + index) - baseline;
        min_value = min_value.min(corrected);
        max_value = max_value.max(corrected);
    }

    Ok(max_value - min_value)
}

pub fn read_frame_trace_from_legacy_file(
    path: &Path,
    frame_index: u64,
    tz_ohm: f64,
) -> Result<PaFrameTrace, String> {
    if !tz_ohm.is_finite() || tz_ohm == 0.0 {
        return Err("tz_ohm must be finite and non-zero".to_string());
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
                .map(|code| signed_code_to_current_ua(*code, tz_ohm, 1.0))
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

pub fn build_image_from_legacy_file(
    path: &Path,
    config: &PaImageProcessingConfig,
) -> Result<PaImageBuildResult, String> {
    let mut width = None;
    let mut height = None;
    let mut sums = Vec::<f64>::new();
    let mut counts = Vec::<u32>::new();
    let mut frame_count = 0u64;
    let issue_state = std::cell::RefCell::new(PaBuildIssueState::new());

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
            frame_count += 1;
            Ok(true)
        },
        |warning| {
            let mut issue_state = issue_state.borrow_mut();
            issue_state.bad_frame_count += warning.bad_frame_count;
            issue_state.push_existing(warning.issue);
        },
    )?;

    let width = width.ok_or_else(|| "no valid PA frame metadata found".to_string())?;
    let height = height.expect("height initialized with width");
    let issue_state = issue_state.into_inner();
    let values = sums
        .iter()
        .zip(&counts)
        .map(|(sum, count)| {
            if *count == 0 {
                None
            } else {
                Some(*sum / f64::from(*count))
            }
        })
        .collect();

    Ok(PaImageBuildResult {
        path: path.display().to_string(),
        width,
        height,
        values,
        counts,
        pixel_count: (width * height) as u64,
        frame_count,
        bad_frame_count: issue_state.bad_frame_count,
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
        };

        let result = compute_frame_ptp(&samples, &config).expect("ptp");

        assert!(result > 999.0);
        assert!(result < 1001.0);
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

        let trace = read_frame_trace_from_legacy_file(&path, 0, 2000.0).expect("trace");

        assert_eq!(trace.samples.len(), 5);
        assert_eq!(trace.time_ns, vec![0.0, 8.0, 16.0, 24.0, 32.0]);
        assert_eq!(trace.frame_index, 0);
    }

    #[test]
    fn trace_read_rejects_out_of_range_frame_index() {
        let path = write_synthetic_legacy_file("pa_frame_trace_missing", 1, 5);

        let err = read_frame_trace_from_legacy_file(&path, 1, 2000.0).expect_err("missing frame");

        assert!(err.contains("frame index 1 not found"));
    }

    #[test]
    fn trace_read_rejects_invalid_tz_ohm() {
        let path = write_synthetic_legacy_file("pa_frame_trace_bad_tz", 1, 5);

        let err = read_frame_trace_from_legacy_file(&path, 0, 0.0).expect_err("invalid tz");

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
