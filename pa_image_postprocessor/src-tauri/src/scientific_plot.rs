use serde::{Deserialize, Serialize};
use std::{
    env,
    ffi::OsString,
    io::{Read, Write},
    path::{Path, PathBuf},
    process::{Child, Command, Output, Stdio},
    thread,
    time::{Duration, Instant},
};

const PYTHON_PREFLIGHT_TIMEOUT: Duration = Duration::from_secs(5);
const SCIENTIFIC_RENDER_TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScientificAlineSeries {
    pub label: String,
    pub color: String,
    pub values: Vec<f64>,
    #[serde(default)]
    pub x_offset: usize,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScientificAlineVisibleDomain {
    pub start_index: usize,
    pub end_index: usize,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScientificAlinePlotRequest {
    pub time_ns: Vec<f64>,
    pub series: Vec<ScientificAlineSeries>,
    pub visible_domain: Option<ScientificAlineVisibleDomain>,
    pub frame_index: u64,
}

#[derive(Serialize)]
struct PythonSeries<'a> {
    label: &'a str,
    color: &'a str,
    values: &'a [f64],
    x_offset: usize,
}

#[derive(Serialize)]
struct PythonDomain {
    start_index: usize,
    end_index: usize,
}

#[derive(Serialize)]
struct PythonRequest<'a> {
    time_ns: &'a [f64],
    series: Vec<PythonSeries<'a>>,
    visible_domain: Option<PythonDomain>,
    frame_index: u64,
}

#[derive(Clone, Debug)]
struct PythonCommand {
    program: OsString,
    prefix_args: Vec<OsString>,
}

fn python_payload(request: &ScientificAlinePlotRequest) -> Result<Vec<u8>, String> {
    if request.time_ns.is_empty() {
        return Err("scientific A-line time axis is empty".to_string());
    }
    if request.series.is_empty() {
        return Err("no scientific A-line series were selected".to_string());
    }
    if request.series.iter().all(|series| series.values.is_empty()) {
        return Err("all scientific A-line series are empty".to_string());
    }
    if request
        .series
        .iter()
        .any(|series| series.label.trim().is_empty() || series.color.trim().is_empty())
    {
        return Err("scientific A-line series require labels and colors".to_string());
    }
    let payload = PythonRequest {
        time_ns: &request.time_ns,
        series: request
            .series
            .iter()
            .map(|series| PythonSeries {
                label: &series.label,
                color: &series.color,
                values: &series.values,
                x_offset: series.x_offset,
            })
            .collect(),
        visible_domain: request
            .visible_domain
            .as_ref()
            .map(|domain| PythonDomain {
                start_index: domain.start_index,
                end_index: domain.end_index,
            }),
        frame_index: request.frame_index,
    };
    serde_json::to_vec(&payload)
        .map_err(|err| format!("serialize scientific A-line request failed: {err}"))
}

fn python_candidates() -> Vec<PythonCommand> {
    let mut candidates = Vec::new();
    if let Some(program) = env::var_os("PA_IMAGE_PYTHON").filter(|value| !value.is_empty()) {
        candidates.push(PythonCommand {
            program,
            prefix_args: Vec::new(),
        });
    }
    if let Some(profile) = env::var_os("USERPROFILE") {
        candidates.push(PythonCommand {
            program: PathBuf::from(profile)
                .join(".cache")
                .join("codex-runtimes")
                .join("codex-primary-runtime")
                .join("dependencies")
                .join("python")
                .join("python.exe")
                .into_os_string(),
            prefix_args: Vec::new(),
        });
    }
    candidates.push(PythonCommand {
        program: OsString::from("python"),
        prefix_args: Vec::new(),
    });
    candidates.push(PythonCommand {
        program: OsString::from("py"),
        prefix_args: vec![OsString::from("-3")],
    });
    candidates
}

fn resolve_python() -> Result<PythonCommand, String> {
    for candidate in python_candidates() {
        let mut command = Command::new(&candidate.program);
        command
            .args(&candidate.prefix_args)
            .args(["-c", "import matplotlib"])
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        hidden_command(&mut command);
        let Ok(child) = command.spawn() else {
            continue;
        };
        if wait_with_output_timeout(child, PYTHON_PREFLIGHT_TIMEOUT)
            .is_ok_and(|output| output.status.success())
        {
            return Ok(candidate);
        }
    }
    Err(
        "Python with Matplotlib was not found. Install Python + matplotlib, or set PA_IMAGE_PYTHON to the Python executable."
            .to_string(),
    )
}

fn hidden_command(command: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
}

fn read_child_pipe<R: Read + Send + 'static>(mut pipe: R) -> thread::JoinHandle<std::io::Result<Vec<u8>>> {
    thread::spawn(move || {
        let mut bytes = Vec::new();
        pipe.read_to_end(&mut bytes)?;
        Ok(bytes)
    })
}

fn join_child_pipe(
    reader: thread::JoinHandle<std::io::Result<Vec<u8>>>,
    name: &str,
) -> Result<Vec<u8>, String> {
    reader
        .join()
        .map_err(|_| format!("Python renderer {name} reader panicked"))?
        .map_err(|err| format!("read Python renderer {name} failed: {err}"))
}

fn wait_with_output_timeout(mut child: Child, timeout: Duration) -> Result<Output, String> {
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "open Python renderer stdout failed".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "open Python renderer stderr failed".to_string())?;
    let stdout_reader = read_child_pipe(stdout);
    let stderr_reader = read_child_pipe(stderr);
    let deadline = Instant::now() + timeout;

    let status = loop {
        match child
            .try_wait()
            .map_err(|err| format!("wait for Python scientific renderer failed: {err}"))?
        {
            Some(status) => break status,
            None if Instant::now() >= deadline => {
                let _ = child.kill();
                let _ = child.wait();
                let _ = join_child_pipe(stdout_reader, "stdout");
                let _ = join_child_pipe(stderr_reader, "stderr");
                return Err(format!(
                    "Python scientific renderer timed out after {} seconds",
                    timeout.as_secs()
                ));
            }
            None => thread::sleep(Duration::from_millis(25)),
        }
    };

    Ok(Output {
        status,
        stdout: join_child_pipe(stdout_reader, "stdout")?,
        stderr: join_child_pipe(stderr_reader, "stderr")?,
    })
}

fn wait_renderer_with_input(
    mut child: Child,
    payload: Vec<u8>,
    timeout: Duration,
) -> Result<Output, String> {
    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| "open Python renderer stdin failed".to_string())?;
    let input_writer = thread::spawn(move || {
        stdin
            .write_all(&payload)
            .map_err(|err| format!("send scientific A-line data to Python failed: {err}"))
    });
    let output = wait_with_output_timeout(child, timeout);
    let input_result = input_writer
        .join()
        .map_err(|_| "Python renderer stdin writer panicked".to_string())?;
    let output = output?;
    if output.status.success() {
        input_result?;
    }
    Ok(output)
}

pub fn render_scientific_aline_png(
    request: &ScientificAlinePlotRequest,
    script_path: &Path,
) -> Result<Vec<u8>, String> {
    if !script_path.is_file() {
        return Err("scientific A-line Python script is missing from application resources".to_string());

    }
    let payload = python_payload(request)?;
    let python = resolve_python()?;
    let mut command = Command::new(&python.program);
    command
        .args(&python.prefix_args)
        .arg(script_path)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    hidden_command(&mut command);
    let child = command
        .spawn()
        .map_err(|err| format!("start Python scientific renderer failed: {err}"))?;
    let output = wait_renderer_with_input(child, payload, SCIENTIFIC_RENDER_TIMEOUT)?;
    if !output.status.success() {
        let detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if detail.is_empty() {
            "Python scientific A-line rendering failed".to_string()
        } else {
            detail
        });
    }
    if output.stdout.len() < 24 || !output.stdout.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Err("Python scientific renderer returned invalid PNG data".to_string());
    }
    Ok(output.stdout)
}

#[cfg(any(debug_assertions, test))]
pub fn development_script_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("python")
        .join("scientific_aline_plot.py")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request() -> ScientificAlinePlotRequest {
        ScientificAlinePlotRequest {
            time_ns: vec![0.0, 1_000.0, 2_000.0, 3_000.0],
            series: vec![
                ScientificAlineSeries {
                    label: "Raw current".to_string(),
                    color: "#0F4D92".to_string(),
                    values: vec![-1.0, 2.0, -3.0, 4.0],
                    x_offset: 0,
                },
                ScientificAlineSeries {
                    label: "Filtered RF".to_string(),
                    color: "#9A4D8E".to_string(),
                    values: vec![10.0, 20.0],
                    x_offset: 1,
                },
            ],
            visible_domain: Some(ScientificAlineVisibleDomain {
                start_index: 1,
                end_index: 2,
            }),
            frame_index: 42,
        }
    }

    #[cfg(windows)]
    #[test]
    fn times_out_and_reaps_a_hung_renderer_process() {
        let mut command = Command::new("powershell");
        command
            .args(["-NoProfile", "-Command", "Start-Sleep -Seconds 5"])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        hidden_command(&mut command);
        let child = command.spawn().expect("start hanging child");
        let started = Instant::now();

        let error = wait_renderer_with_input(
            child,
            vec![b'x'; 1024 * 1024],
            Duration::from_millis(100),
        )
        .expect_err("renderer should time out while not reading stdin");

        assert!(error.contains("timed out"));
        assert!(started.elapsed() < Duration::from_secs(3));
    }

    #[test]
    fn serializes_python_protocol_with_snake_case_and_offsets() {
        let value: serde_json::Value =
            serde_json::from_slice(&python_payload(&request()).expect("payload")).expect("json");

        assert_eq!(value["time_ns"], serde_json::json!([0.0, 1000.0, 2000.0, 3000.0]));
        assert_eq!(value["visible_domain"]["start_index"], 1);
        assert_eq!(value["series"][1]["x_offset"], 1);
        assert!(value.get("timeNs").is_none());
    }

    #[test]
    #[ignore = "requires Python with Matplotlib"]
    fn renders_real_matplotlib_png() {
        let png =
            render_scientific_aline_png(&request(), &development_script_path()).expect("PNG");

        assert_eq!(&png[..8], b"\x89PNG\r\n\x1a\n");
        assert_eq!(u32::from_be_bytes(png[16..20].try_into().expect("width")), 2400);
        assert_eq!(u32::from_be_bytes(png[20..24].try_into().expect("height")), 1200);
    }

    #[test]
    #[ignore = "requires real CarbonfiberH2 data, Python/Matplotlib, and PA_SCIENTIFIC_PLOT_PREVIEW"]
    fn renders_real_carbonfiber_aline_preview() {
        let input = PathBuf::from(
            env::var("PA_ORPAM_SMOKE_INPUT")
                .expect("set PA_ORPAM_SMOKE_INPUT to a legacy PA binary"),
        );
        let output = PathBuf::from(
            env::var("PA_SCIENTIFIC_PLOT_PREVIEW")
                .expect("set PA_SCIENTIFIC_PLOT_PREVIEW to a PNG path"),
        );
        let aline = crate::classical_orpam::process_classical_aline(
            &input,
            135_484,
            &crate::classical_orpam::ClassicalOrpamConfig::default(),
        )
        .expect("process real A-line");
        let request = ScientificAlinePlotRequest {
            time_ns: aline.valid_time_ns,
            series: vec![
                ScientificAlineSeries {
                    label: "Raw current".to_string(),
                    color: "#0F4D92".to_string(),
                    values: aline.raw_current_ua,
                    x_offset: 0,
                },
                ScientificAlineSeries {
                    label: "Baseline-corrected".to_string(),
                    color: "#42949E".to_string(),
                    values: aline.baseline_corrected_ua,
                    x_offset: 0,
                },
                ScientificAlineSeries {
                    label: "Filtered RF".to_string(),
                    color: "#9A4D8E".to_string(),
                    values: aline.filtered_rf_ua,
                    x_offset: aline.processing_offset,
                },
                ScientificAlineSeries {
                    label: "Hilbert envelope".to_string(),
                    color: "#B64342".to_string(),
                    values: aline.envelope_ua,
                    x_offset: aline.processing_offset,
                },
            ],
            visible_domain: None,
            frame_index: aline.frame_index,
        };
        let png =
            render_scientific_aline_png(&request, &development_script_path()).expect("PNG");
        std::fs::write(&output, png).expect("write preview");
    }
}