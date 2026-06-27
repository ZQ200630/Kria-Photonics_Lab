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

pub fn compute_frame_ptp(samples: &[i16], config: &PaImageProcessingConfig) -> Result<f64, String> {
    if !config.sample_interval_ns.is_finite() || config.sample_interval_ns <= 0.0 {
        return Err("sample_interval_ns must be finite and positive".to_string());
    }
    if !config.tz_ohm.is_finite() || config.tz_ohm == 0.0 {
        return Err("tz_ohm must be finite and non-zero".to_string());
    }
    if !config.vfs.is_finite() {
        return Err("vfs must be finite".to_string());
    }
    if config.sample_start_index > samples.len() {
        return Err("sample_start_index exceeds sample length".to_string());
    }
    if config.sample_end_trim > samples.len().saturating_sub(config.sample_start_index) {
        return Err("sample_end_trim leaves no valid trace".to_string());
    }

    let end = samples.len() - config.sample_end_trim;
    let sliced = &samples[config.sample_start_index..end];
    if sliced.is_empty() {
        return Err("trace slice is empty".to_string());
    }

    let currents: Vec<f64> = sliced
        .iter()
        .map(|code| signed_code_to_current_ua(*code, config.tz_ohm, config.vfs))
        .collect();
    let baseline = mean_window(
        &currents,
        config.sample_interval_ns,
        config.baseline_start_ns,
        config.baseline_end_ns,
    )?;
    let (ptp_start, ptp_end) = sample_window_indices(
        currents.len(),
        config.sample_interval_ns,
        config.ptp_start_ns,
        config.ptp_end_ns,
    )?;

    let mut min_value = f64::INFINITY;
    let mut max_value = f64::NEG_INFINITY;
    for value in &currents[ptp_start..ptp_end] {
        let corrected = *value - baseline;
        min_value = min_value.min(corrected);
        max_value = max_value.max(corrected);
    }

    Ok(max_value - min_value)
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

fn mean_window(values: &[f64], interval_ns: f64, start_ns: f64, end_ns: f64) -> Result<f64, String> {
    let (start, end) = sample_window_indices(values.len(), interval_ns, start_ns, end_ns)?;
    let sum: f64 = values[start..end].iter().sum();
    Ok(sum / (end - start) as f64)
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
    if severity_rank(severity) > severity_rank(summary.severity) {
        summary.severity = severity;
    }
    summary.issues.push(PaParseIssue {
        severity,
        message,
        block_id,
        frame_id,
    });
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
}
