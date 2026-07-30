use std::path::{Path, PathBuf};

use plotters::prelude::*;
use rustfft::{num_complex::Complex, FftPlanner};

use crate::classical_orpam::load_classical_volume_slice;

pub struct QcTrace {
    pub raw: Vec<f64>,
    pub filtered: Vec<f64>,
    pub envelope: Vec<f64>,
}

pub struct QcRequest<'a> {
    pub qc_directory: &'a Path,
    pub volume_path: &'a Path,
    pub data_offset: u64,
    pub shape_yxz: [usize; 3],
    pub map_values: &'a [Option<f32>],
    pub x_range_um: [f64; 2],
    pub y_range_um: [f64; 2],
    pub z_range_um: [f64; 2],
    pub sample_rate_hz: f64,
    pub cscan_z_index: usize,
    pub traces: &'a [QcTrace],
}

fn chart_error(label: &str, error: impl std::fmt::Debug) -> String {
    format!("{label} failed: {error:?}")
}

fn finite_range(series: &[(&str, &[f64], RGBColor)]) -> (f64, f64, usize) {
    let mut minimum = f64::INFINITY;
    let mut maximum = f64::NEG_INFINITY;
    let mut length = 0usize;
    for (_, values, _) in series {
        length = length.max(values.len());
        for value in values.iter().copied().filter(|value| value.is_finite()) {
            minimum = minimum.min(value);
            maximum = maximum.max(value);
        }
    }
    if !minimum.is_finite() || !maximum.is_finite() {
        return (-1.0, 1.0, length.max(1));
    }
    if (maximum - minimum).abs() < f64::EPSILON {
        let pad = maximum.abs().max(1.0) * 0.05;
        (minimum - pad, maximum + pad, length.max(1))
    } else {
        let pad = (maximum - minimum) * 0.05;
        (minimum - pad, maximum + pad, length.max(1))
    }
}

fn save_line_plot(
    path: &Path,
    title: &str,
    x_label: &str,
    y_label: &str,
    series: &[(&str, &[f64], RGBColor)],
) -> Result<(), String> {
    let (minimum, maximum, length) = finite_range(series);
    let root = BitMapBackend::new(path, (1200, 720)).into_drawing_area();
    root.fill(&WHITE).map_err(|error| chart_error("fill line QC", error))?;
    let mut chart = ChartBuilder::on(&root)
        .caption(title, ("sans-serif", 30))
        .margin(20)
        .x_label_area_size(50)
        .y_label_area_size(70)
        .build_cartesian_2d(0usize..length, minimum..maximum)
        .map_err(|error| chart_error("build line QC", error))?;
    chart
        .configure_mesh()
        .x_desc(x_label)
        .y_desc(y_label)
        .draw()
        .map_err(|error| chart_error("draw line QC mesh", error))?;
    for (label, values, color) in series {
        chart
            .draw_series(LineSeries::new(
                values
                    .iter()
                    .copied()
                    .enumerate()
                    .filter(|(_, value)| value.is_finite()),
                color.stroke_width(2),
            ))
            .map_err(|error| chart_error("draw line QC series", error))?
            .label(*label)
            .legend({
                let color = *color;
                move |(x, y)| PathElement::new([(x, y), (x + 24, y)], color.stroke_width(2))
            });
    }
    chart
        .configure_series_labels()
        .background_style(WHITE.mix(0.85))
        .border_style(BLACK)
        .draw()
        .map_err(|error| chart_error("draw line QC legend", error))?;
    root.present().map_err(|error| chart_error("save line QC", error))
}

fn percentile(values: &[f64], fraction: f64) -> f64 {
    let mut finite: Vec<f64> = values.iter().copied().filter(|value| value.is_finite()).collect();
    if finite.is_empty() {
        return 0.0;
    }
    finite.sort_by(f64::total_cmp);
    finite[((finite.len() - 1) as f64 * fraction).round() as usize]
}

fn save_heatmap(
    path: &Path,
    title: &str,
    width: usize,
    height: usize,
    values: &[Option<f32>],
    db_scale: bool,
    x_label: &str,
    y_label: &str,
) -> Result<(), String> {
    let linear: Vec<f64> = values
        .iter()
        .filter_map(|value| value.map(f64::from))
        .filter(|value| value.is_finite())
        .collect();
    let reference = linear
        .iter()
        .map(|value| value.abs())
        .fold(0.0f64, f64::max)
        .max(f64::MIN_POSITIVE);
    let display: Vec<f64> = values
        .iter()
        .map(|value| match value {
            Some(value) if value.is_finite() => {
                if db_scale {
                    (20.0 * (f64::from(*value).abs().max(reference * 1.0e-6) / reference).log10())
                        .max(-60.0)
                } else {
                    f64::from(*value)
                }
            }
            _ => f64::NAN,
        })
        .collect();
    let (low, high) = if db_scale {
        (-45.0, 0.0)
    } else {
        (percentile(&display, 0.01), percentile(&display, 0.995))
    };
    let span = (high - low).max(f64::EPSILON);
    let root = BitMapBackend::new(path, (1000, 860)).into_drawing_area();
    root.fill(&WHITE).map_err(|error| chart_error("fill heatmap QC", error))?;
    let mut chart = ChartBuilder::on(&root)
        .caption(title, ("sans-serif", 30))
        .margin(20)
        .x_label_area_size(55)
        .y_label_area_size(65)
        .build_cartesian_2d(0usize..width, height..0usize)
        .map_err(|error| chart_error("build heatmap QC", error))?;
    chart
        .configure_mesh()
        .x_desc(x_label)
        .y_desc(y_label)
        .disable_mesh()
        .draw()
        .map_err(|error| chart_error("draw heatmap QC mesh", error))?;
    chart
        .draw_series(display.iter().enumerate().filter_map(|(index, value)| {
            if !value.is_finite() {
                return None;
            }
            let x = index % width;
            let y = index / width;
            let unit = ((*value - low) / span).clamp(0.0, 1.0);
            let color = HSLColor(0.78 - 0.78 * unit, 0.95, 0.12 + 0.72 * unit);
            Some(Rectangle::new([(x, y), (x + 1, y + 1)], color.filled()))
        }))
        .map_err(|error| chart_error("draw heatmap QC pixels", error))?;
    root.present().map_err(|error| chart_error("save heatmap QC", error))
}

fn spectrum(values: &[f64], sample_rate_hz: f64) -> Vec<(f64, f64)> {
    let len = values.len().max(1);
    let mut planner = FftPlanner::<f64>::new();
    let fft = planner.plan_fft_forward(len);
    let mut bins: Vec<Complex<f64>> = values
        .iter()
        .enumerate()
        .map(|(index, value)| {
            let window = if len > 1 {
                0.5 - 0.5 * (2.0 * std::f64::consts::PI * index as f64 / (len - 1) as f64).cos()
            } else {
                1.0
            };
            Complex::new(value * window, 0.0)
        })
        .collect();
    if bins.is_empty() {
        bins.push(Complex::new(0.0, 0.0));
    }
    fft.process(&mut bins);
    let reference = bins
        .iter()
        .take(len / 2 + 1)
        .map(|value| value.norm())
        .fold(0.0f64, f64::max)
        .max(f64::MIN_POSITIVE);
    bins.into_iter()
        .take(len / 2 + 1)
        .enumerate()
        .map(|(index, value)| {
            let frequency_mhz = index as f64 * sample_rate_hz / len as f64 / 1.0e6;
            let db = (20.0 * (value.norm().max(reference * 1.0e-8) / reference).log10()).max(-100.0);
            (frequency_mhz, db)
        })
        .collect()
}

fn save_spectrum(path: &Path, trace: &QcTrace, sample_rate_hz: f64) -> Result<(), String> {
    let signal = spectrum(&trace.filtered, sample_rate_hz);
    let noise_len = (trace.filtered.len() / 8).max(8).min(trace.filtered.len());
    let noise = spectrum(&trace.filtered[..noise_len], sample_rate_hz);
    let nyquist_mhz = sample_rate_hz / 2.0 / 1.0e6;
    let root = BitMapBackend::new(path, (1200, 720)).into_drawing_area();
    root.fill(&WHITE).map_err(|error| chart_error("fill spectrum QC", error))?;
    let mut chart = ChartBuilder::on(&root)
        .caption("Signal and noise spectrum", ("sans-serif", 30))
        .margin(20)
        .x_label_area_size(50)
        .y_label_area_size(70)
        .build_cartesian_2d(0.0..nyquist_mhz, -100.0..0.0)
        .map_err(|error| chart_error("build spectrum QC", error))?;
    chart
        .configure_mesh()
        .x_desc("Frequency (MHz)")
        .y_desc("Normalized magnitude (dB)")
        .draw()
        .map_err(|error| chart_error("draw spectrum QC mesh", error))?;
    for (label, values, color) in [
        ("signal", signal.as_slice(), BLUE),
        ("baseline/noise proxy", noise.as_slice(), RED),
    ] {
        chart
            .draw_series(LineSeries::new(values.iter().copied(), color.stroke_width(2)))
            .map_err(|error| chart_error("draw spectrum QC series", error))?
            .label(label)
            .legend(move |(x, y)| PathElement::new([(x, y), (x + 24, y)], color.stroke_width(2)));
    }
    chart
        .configure_series_labels()
        .background_style(WHITE.mix(0.85))
        .border_style(BLACK)
        .draw()
        .map_err(|error| chart_error("draw spectrum QC legend", error))?;
    root.present().map_err(|error| chart_error("save spectrum QC", error))
}

pub fn generate_qc(request: &QcRequest<'_>) -> Result<Vec<PathBuf>, String> {
    if request.traces.is_empty() {
        return Err("cannot generate QC without representative A-lines".to_string());
    }
    let qc_directory = request.qc_directory.to_path_buf();
    std::fs::create_dir_all(&qc_directory)
        .map_err(|error| format!("create {} failed: {error}", qc_directory.display()))?;
    let colors = [BLUE, RED, GREEN];
    let raw_series: Vec<_> = request
        .traces
        .iter()
        .zip(colors)
        .enumerate()
        .map(|(index, (trace, color))| (format!("A-line {}", index + 1), trace.raw.as_slice(), color))
        .collect();
    let filtered_series: Vec<_> = request
        .traces
        .iter()
        .zip(colors)
        .enumerate()
        .map(|(index, (trace, color))| (format!("A-line {}", index + 1), trace.filtered.as_slice(), color))
        .collect();
    let envelope_series: Vec<_> = request
        .traces
        .iter()
        .zip(colors)
        .enumerate()
        .map(|(index, (trace, color))| (format!("A-line {}", index + 1), trace.envelope.as_slice(), color))
        .collect();
    let raw_refs: Vec<_> = raw_series.iter().map(|(label, values, color)| (label.as_str(), *values, *color)).collect();
    let filtered_refs: Vec<_> = filtered_series.iter().map(|(label, values, color)| (label.as_str(), *values, *color)).collect();
    let envelope_refs: Vec<_> = envelope_series.iter().map(|(label, values, color)| (label.as_str(), *values, *color)).collect();
    let mut outputs = Vec::new();
    let raw_path = qc_directory.join("representative_raw_alines.png");
    save_line_plot(&raw_path, "Representative raw A-lines", "Valid sample index", "Current (uA)", &raw_refs)?;
    outputs.push(raw_path);
    let filtered_path = qc_directory.join("representative_filtered_alines.png");
    save_line_plot(&filtered_path, "Representative filtered A-lines", "Processing sample index", "Current (uA)", &filtered_refs)?;
    outputs.push(filtered_path);
    let envelope_path = qc_directory.join("representative_envelopes.png");
    save_line_plot(&envelope_path, "Representative envelopes", "Processing sample index", "Amplitude (uA)", &envelope_refs)?;
    outputs.push(envelope_path);
    let spectrum_path = qc_directory.join("signal_and_noise_spectrum.png");
    save_spectrum(&spectrum_path, &request.traces[0], request.sample_rate_hz)?;
    outputs.push(spectrum_path);
    let [ny, nx, nz] = request.shape_yxz;
    let map_linear_path = qc_directory.join("map_xy_linear.png");
    save_heatmap(&map_linear_path, "XY MAP linear", nx, ny, request.map_values, false, "X index", "Y index")?;
    outputs.push(map_linear_path);
    let map_db_path = qc_directory.join("map_xy_db.png");
    save_heatmap(&map_db_path, "XY MAP dB (display only)", nx, ny, request.map_values, true, "X index", "Y index")?;
    outputs.push(map_db_path);
    let xz = load_classical_volume_slice(
        request.volume_path,
        request.data_offset,
        request.shape_yxz,
        "xz",
        ny / 2,
        request.x_range_um,
        request.y_range_um,
        request.z_range_um,
    )?;
    let xz_path = qc_directory.join("bscan_xz.png");
    save_heatmap(&xz_path, "XZ B-scan", xz.width, xz.height, &xz.values, true, "X index", "Z index")?;
    outputs.push(xz_path);
    let yz = load_classical_volume_slice(
        request.volume_path,
        request.data_offset,
        request.shape_yxz,
        "yz",
        nx / 2,
        request.x_range_um,
        request.y_range_um,
        request.z_range_um,
    )?;
    let yz_path = qc_directory.join("bscan_yz.png");
    save_heatmap(&yz_path, "YZ B-scan", yz.width, yz.height, &yz.values, true, "Y index", "Z index")?;
    outputs.push(yz_path);
    let xy = load_classical_volume_slice(
        request.volume_path,
        request.data_offset,
        request.shape_yxz,
        "xy",
        request.cscan_z_index.min(nz.saturating_sub(1)),
        request.x_range_um,
        request.y_range_um,
        request.z_range_um,
    )?;
    let xy_path = qc_directory.join("cscan_xy.png");
    save_heatmap(&xy_path, "XY C-scan", xy.width, xy.height, &xy.values, true, "X index", "Y index")?;
    outputs.push(xy_path);
    Ok(outputs)
}
