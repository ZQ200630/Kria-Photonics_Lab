use std::fs::File;
use std::io::{self, BufWriter, Read, Write};
use std::net::{Shutdown, SocketAddr, TcpStream, ToSocketAddrs};
use std::path::Path;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use serde::Serialize;

const STREAM_MAGIC: &[u8; 4] = b"PAI1";
const STREAM_VERSION: u16 = 1;
const STREAM_HEADER_BYTES: usize = 68;
const RECORD_TYPE_DATA: u16 = 2;
const MAX_STREAM_HEADER_BYTES: usize = 4096;
const MAX_STREAM_DATA_PAYLOAD_BYTES: usize = 128 * 1024 * 1024;
const MAX_STREAM_CONTROL_PAYLOAD_BYTES: usize = 16 * 1024 * 1024;
const DRAIN_BUFFER_BYTES: usize = 64 * 1024;
const DEFAULT_CONNECT_TIMEOUT_MS: u64 = 1_200;
const DEFAULT_STOP_JOIN_TIMEOUT_MS: u64 = 1_000;

#[derive(Debug, Serialize, Clone)]
pub struct PaReceiverStatus {
    pub connected: bool,
    pub running: bool,
    pub stop_requested: bool,
    pub bytes_received: u64,
    pub blocks_received: u64,
    pub frames_received: u64,
    pub output_path: String,
    pub last_error: String,
    pub last_sequence: u64,
    pub endpoint: String,
    pub phase: String,
}

#[derive(Debug, Default)]
struct PaReceiverRuntime {
    running: bool,
    stop_requested: bool,
    connected: bool,
    bytes_received: u64,
    blocks_received: u64,
    frames_received: u64,
    output_path: String,
    last_error: String,
    last_sequence: u64,
    endpoint: String,
    phase: String,
}

#[derive(Default)]
pub struct PaTcpReceiver {
    runtime: Arc<Mutex<PaReceiverRuntime>>,
    worker: Mutex<Option<JoinHandle<()>>>,
    stop_signal: Mutex<Option<Arc<AtomicBool>>>,
}

impl PaTcpReceiver {
    pub fn new() -> Self {
        Self {
            runtime: Arc::new(Mutex::new(PaReceiverRuntime::default())),
            worker: Mutex::new(None),
            stop_signal: Mutex::new(None),
        }
    }

    pub fn status(&self) -> PaReceiverStatus {
        let runtime = self.runtime.lock().expect("PA receiver runtime mutex poisoned");
        status_from_runtime(&runtime)
    }

    pub fn start(&self, host: String, port: u16, output_path: String) -> Result<PaReceiverStatus, String> {
        let mut runtime = self.runtime.lock().expect("PA receiver runtime mutex poisoned");
        if runtime.running {
            return Err("PA receiver already running".to_string());
        }

        let stop_flag = Arc::new(AtomicBool::new(false));
        let endpoint_host = if host.trim().is_empty() {
            "127.0.0.1".to_string()
        } else {
            host
        };
        let endpoint = format!("{}:{}", endpoint_host, if port == 0 { 9090 } else { port });
        let output_path = output_path.trim().to_string();

        if output_path.is_empty() {
            return Err("output_path is empty".to_string());
        }
        let parent = Path::new(&output_path).parent();
        if let Some(parent) = parent {
            if !parent.as_os_str().is_empty() {
                std::fs::create_dir_all(parent)
                    .map_err(|err| format!("create output directory failed: {err}"))?;
            }
        }

        let runtime_arc = Arc::clone(&self.runtime);
        let stop_clone = Arc::clone(&stop_flag);
        let thread_path = output_path.clone();
        let runtime_for_loop = Arc::clone(&runtime_arc);
        let runtime_for_done = Arc::clone(&runtime_arc);
        let worker = thread::spawn(move || {
            if let Err(err) = run_receiver_loop(endpoint, thread_path, runtime_for_loop.clone(), stop_clone) {
                let mut inner = runtime_for_loop.lock().expect("PA receiver runtime mutex poisoned");
                inner.last_error = err;
                inner.phase = "error".to_string();
            }

            let mut inner = runtime_for_done.lock().expect("PA receiver runtime mutex poisoned");
            let had_error = !inner.last_error.is_empty();
            let stop_requested = inner.stop_requested;
            inner.running = false;
            inner.connected = false;
            inner.stop_requested = false;
            if !had_error {
                inner.phase = if stop_requested {
                    "stopped".to_string()
                } else {
                    "idle".to_string()
                };
            }
        });

        *self.stop_signal.lock().expect("PA receiver stop signal mutex poisoned") = Some(stop_flag);
        *self.worker.lock().expect("PA receiver worker mutex poisoned") = Some(worker);

        runtime.running = true;
        runtime.stop_requested = false;
        runtime.last_error.clear();
        runtime.output_path = output_path;
        runtime.connected = false;
        runtime.bytes_received = 0;
        runtime.blocks_received = 0;
        runtime.frames_received = 0;
        runtime.last_sequence = 0;
        runtime.endpoint = endpoint_host.clone() + ":" + &(if port == 0 { 9090 } else { port }).to_string();
        runtime.phase = "starting".to_string();

        Ok(status_from_runtime(&runtime))
    }

    pub fn request_stop(&self) -> PaReceiverStatus {
        self.request_stop_with_timeout(Duration::from_millis(DEFAULT_STOP_JOIN_TIMEOUT_MS))
    }

    fn request_stop_with_timeout(&self, join_timeout: Duration) -> PaReceiverStatus {
        {
            let mut runtime = self.runtime.lock().expect("PA receiver runtime mutex poisoned");
            if runtime.running {
                runtime.stop_requested = true;
                runtime.phase = "stopping".to_string();
            }
        }

        if let Some(stop_signal) = self
            .stop_signal
            .lock()
            .expect("PA receiver stop signal mutex poisoned")
            .as_ref()
        {
            stop_signal.store(true, Ordering::SeqCst);
        }

        let worker = self.worker.lock().expect("PA receiver worker mutex poisoned").take();
        if let Some(worker) = worker {
            let deadline = Instant::now() + join_timeout;
            while !worker.is_finished() && Instant::now() < deadline {
                std::thread::sleep(Duration::from_millis(10));
            }
            if worker.is_finished() {
                if worker.join().is_err() {
                    let mut runtime = self.runtime.lock().expect("PA receiver runtime mutex poisoned");
                    runtime.last_error = "PA receiver thread panicked".to_string();
                }
            } else {
                let mut runtime = self.runtime.lock().expect("PA receiver runtime mutex poisoned");
                runtime.last_error = format!(
                    "PA receiver stop/join timed out after {}ms",
                    join_timeout.as_millis()
                );
                runtime.running = true;
                runtime.stop_requested = true;
                runtime.phase = "stopping".to_string();
                *self.worker.lock().expect("PA receiver worker mutex poisoned") = Some(worker);
                return status_from_runtime(&runtime);
            }
        }

        self.stop_signal
            .lock()
            .expect("PA receiver stop signal mutex poisoned")
            .take();

        let mut runtime = self.runtime.lock().expect("PA receiver runtime mutex poisoned");
        runtime.stop_requested = false;
        runtime.running = false;
        runtime.connected = false;
        runtime.phase = if runtime.last_error.is_empty() {
            "stopped".to_string()
        } else {
            "error".to_string()
        };
        status_from_runtime(&runtime)
    }
}

fn status_from_runtime(runtime: &PaReceiverRuntime) -> PaReceiverStatus {
    PaReceiverStatus {
        connected: runtime.connected,
        running: runtime.running,
        stop_requested: runtime.stop_requested,
        bytes_received: runtime.bytes_received,
        blocks_received: runtime.blocks_received,
        frames_received: runtime.frames_received,
        output_path: runtime.output_path.clone(),
        last_error: runtime.last_error.clone(),
        last_sequence: runtime.last_sequence,
        endpoint: runtime.endpoint.clone(),
        phase: if runtime.phase.is_empty() {
            "idle".to_string()
        } else {
            runtime.phase.clone()
        },
    }
}

fn set_receiver_phase(runtime: &Arc<Mutex<PaReceiverRuntime>>, phase: &str) {
    let mut inner = runtime.lock().expect("PA receiver runtime mutex poisoned");
    inner.phase = phase.to_string();
}

fn write_legacy_block_record<W: Write>(
    output: &mut W,
    block_id: u64,
    used_bytes: u64,
    frame_count: u32,
    first_frame_id: u64,
    last_frame_id: u64,
    payload: &[u8],
) -> io::Result<()> {
    let used = u32::try_from(used_bytes).map_err(|_| {
        io::Error::new(
            io::ErrorKind::InvalidData,
            "PA block payload exceeds u32 used_bytes",
        )
    })?;
    output.write_all(&block_id.to_le_bytes())?;
    output.write_all(&used.to_le_bytes())?;
    output.write_all(&frame_count.to_le_bytes())?;
    output.write_all(&first_frame_id.to_le_bytes())?;
    output.write_all(&last_frame_id.to_le_bytes())?;
    output.write_all(payload)?;
    Ok(())
}

fn run_receiver_loop(
    endpoint: String,
    output_path: String,
    runtime: Arc<Mutex<PaReceiverRuntime>>,
    stop_signal: Arc<AtomicBool>,
) -> Result<(), String> {
    set_receiver_phase(&runtime, "resolving");
    let addrs: Vec<SocketAddr> = endpoint
        .to_socket_addrs()
        .map_err(|err| format!("resolve endpoint failed: {err}"))?
        .collect();
    let endpoint_addr = addrs
        .first()
        .copied()
        .ok_or_else(|| "resolve endpoint failed: no address returned".to_string())?;

    set_receiver_phase(&runtime, "connecting");
    let mut stream = TcpStream::connect_timeout(&endpoint_addr, Duration::from_millis(DEFAULT_CONNECT_TIMEOUT_MS))
        .map_err(|err| format!("connect failed: {err}"))?;
    stream
        .set_read_timeout(Some(Duration::from_millis(500)))
        .map_err(|err| format!("set_read_timeout failed: {err}"))?;

    {
        let mut inner = runtime.lock().expect("PA receiver runtime mutex poisoned");
        inner.connected = true;
        inner.phase = "connected".to_string();
    }

    set_receiver_phase(&runtime, "opening_output");
    let mut output = BufWriter::new(
        File::create(&output_path).map_err(|err| format!("open output file failed: {err}"))?,
    );
    let mut header = [0u8; STREAM_HEADER_BYTES];
    let mut drain_buffer = vec![0u8; DRAIN_BUFFER_BYTES];

    loop {
        if stop_signal.load(Ordering::SeqCst) {
            set_receiver_phase(&runtime, "stopping");
            let _ = stream.shutdown(Shutdown::Read);
            let _ = stream.shutdown(Shutdown::Write);
            break;
        }

        set_receiver_phase(&runtime, "reading_header");
        match read_exact_with_stop(&mut stream, &mut header, &stop_signal, "stream header")? {
            ReadExactStatus::Complete => {}
            ReadExactStatus::Stopped | ReadExactStatus::CleanEof => break,
        }

        if &header[0..4] != STREAM_MAGIC {
            let mut inner = runtime.lock().expect("PA receiver runtime mutex poisoned");
            inner.last_error = format!(
                "invalid stream magic: {:02X}{:02X}{:02X}{:02X}",
                header[0], header[1], header[2], header[3]
            );
            return Err(inner.last_error.clone());
        }

        let version = u16::from_le_bytes([header[4], header[5]]);
        if version != STREAM_VERSION {
            let mut inner = runtime.lock().expect("PA receiver runtime mutex poisoned");
            inner.last_error = format!("unsupported stream version {version}");
            return Err(inner.last_error.clone());
        }

        let record_type = u16::from_le_bytes([header[6], header[7]]);
        let declared_header_bytes = usize::try_from(u32::from_le_bytes([header[8], header[9], header[10], header[11]]))
            .map_err(|_| "invalid header_bytes value".to_string())?;
        let payload_bytes = usize::try_from(u64::from_le_bytes([
            header[12],
            header[13],
            header[14],
            header[15],
            header[16],
            header[17],
            header[18],
            header[19],
        ]))
        .map_err(|_| "invalid payload size".to_string())?;
        let sequence = u64::from_le_bytes([
            header[20],
            header[21],
            header[22],
            header[23],
            header[24],
            header[25],
            header[26],
            header[27],
        ]);
        let block_id = u64::from_le_bytes([
            header[36],
            header[37],
            header[38],
            header[39],
            header[40],
            header[41],
            header[42],
            header[43],
        ]);
        let frame_count = u32::from_le_bytes([header[44], header[45], header[46], header[47]]);
        let first_frame_id = u64::from_le_bytes([
            header[52],
            header[53],
            header[54],
            header[55],
            header[56],
            header[57],
            header[58],
            header[59],
        ]);
        let last_frame_id = u64::from_le_bytes([
            header[60],
            header[61],
            header[62],
            header[63],
            header[64],
            header[65],
            header[66],
            header[67],
        ]);

        if declared_header_bytes < STREAM_HEADER_BYTES {
            let mut inner = runtime.lock().expect("PA receiver runtime mutex poisoned");
            inner.last_error = format!("invalid declared header size {declared_header_bytes}");
            return Err(inner.last_error.clone());
        }
        if declared_header_bytes > MAX_STREAM_HEADER_BYTES {
            let mut inner = runtime.lock().expect("PA receiver runtime mutex poisoned");
            inner.last_error = format!(
                "stream header size {declared_header_bytes} exceeds limit {MAX_STREAM_HEADER_BYTES}"
            );
            return Err(inner.last_error.clone());
        }

        if record_type == RECORD_TYPE_DATA {
            if payload_bytes > MAX_STREAM_DATA_PAYLOAD_BYTES {
                let mut inner = runtime.lock().expect("PA receiver runtime mutex poisoned");
                inner.last_error = format!(
                    "data payload size {payload_bytes} exceeds limit {MAX_STREAM_DATA_PAYLOAD_BYTES}"
                );
                return Err(inner.last_error.clone());
            }
            if payload_bytes > u32::MAX as usize {
                let mut inner = runtime.lock().expect("PA receiver runtime mutex poisoned");
                inner.last_error = format!("data payload size {payload_bytes} exceeds u32 used_bytes");
                return Err(inner.last_error.clone());
            }
        } else if payload_bytes > MAX_STREAM_CONTROL_PAYLOAD_BYTES {
            let mut inner = runtime.lock().expect("PA receiver runtime mutex poisoned");
            inner.last_error = format!(
                "control payload size {payload_bytes} exceeds limit {MAX_STREAM_CONTROL_PAYLOAD_BYTES}"
            );
            return Err(inner.last_error.clone());
        }

        if declared_header_bytes > STREAM_HEADER_BYTES {
            let mut extra_header = vec![0u8; declared_header_bytes - STREAM_HEADER_BYTES];
            match read_exact_with_stop(&mut stream, &mut extra_header, &stop_signal, "extra header")? {
                ReadExactStatus::Complete => {}
                ReadExactStatus::Stopped => break,
                ReadExactStatus::CleanEof => return Err(format!(
                    "unexpected EOF while reading extra header: read 0 of {} bytes",
                    extra_header.len()
                )),
            }
        }

        if record_type == RECORD_TYPE_DATA {
            let mut payload = vec![0u8; payload_bytes];
            set_receiver_phase(&runtime, "reading_payload");
            if payload_bytes > 0 {
                match read_exact_with_stop(&mut stream, &mut payload, &stop_signal, "data payload")? {
                    ReadExactStatus::Complete => {}
                    ReadExactStatus::Stopped => break,
                    ReadExactStatus::CleanEof => return Err(format!(
                        "unexpected EOF while reading data payload: read 0 of {payload_bytes} bytes"
                    )),
                }
            }

            write_legacy_block_record(
                &mut output,
                block_id,
                u64::try_from(payload_bytes).unwrap_or(u64::MAX),
                frame_count,
                first_frame_id,
                last_frame_id,
                &payload,
            )
            .map_err(|err| err.to_string())?;
            output.flush().map_err(|err| err.to_string())?;

            let mut inner = runtime.lock().expect("PA receiver runtime mutex poisoned");
            inner.blocks_received = inner.blocks_received.saturating_add(1);
            inner.frames_received = inner.frames_received.saturating_add(u64::from(frame_count));
        } else if payload_bytes > 0 {
            set_receiver_phase(&runtime, "reading_payload");
            let mut remaining = payload_bytes;
            while remaining > 0 {
                let chunk_len = remaining.min(drain_buffer.len());
                match read_exact_with_stop(
                    &mut stream,
                    &mut drain_buffer[..chunk_len],
                    &stop_signal,
                    "control payload",
                )? {
                    ReadExactStatus::Complete => {}
                    ReadExactStatus::Stopped => break,
                    ReadExactStatus::CleanEof => return Err(format!(
                        "unexpected EOF while reading control payload: read 0 of {remaining} bytes"
                    )),
                }
                remaining -= chunk_len;
            }
            if remaining > 0 {
                break;
            }
        }

        let mut inner = runtime.lock().expect("PA receiver runtime mutex poisoned");
        inner.bytes_received = inner
            .bytes_received
            .saturating_add(u64::try_from(declared_header_bytes).unwrap_or(u64::MAX))
            .saturating_add(u64::try_from(payload_bytes).unwrap_or(u64::MAX));
        inner.last_sequence = sequence;
        inner.connected = true;
        inner.phase = "receiving".to_string();
    }

    Ok(())
}

enum ReadExactStatus {
    Complete,
    Stopped,
    CleanEof,
}

fn read_exact_with_stop(
    reader: &mut TcpStream,
    buf: &mut [u8],
    stop_signal: &Arc<AtomicBool>,
    context: &str,
) -> Result<ReadExactStatus, String> {
    let mut offset = 0usize;
    while offset < buf.len() {
        if stop_signal.load(Ordering::SeqCst) {
            return Ok(ReadExactStatus::Stopped);
        }

        match reader.read(&mut buf[offset..]) {
            Ok(0) if offset == 0 => return Ok(ReadExactStatus::CleanEof),
            Ok(0) => {
                return Err(format!(
                    "unexpected EOF while reading {context}: read {offset} of {} bytes",
                    buf.len()
                ))
            }
            Ok(n) => offset += n,
            Err(err) if err.kind() == io::ErrorKind::WouldBlock || err.kind() == io::ErrorKind::TimedOut => {
                continue;
            }
            Err(err) => return Err(format!("{err}")),
        }
    }
    Ok(ReadExactStatus::Complete)
}

#[tauri::command]
pub fn pa_receiver_start(
    host: String,
    port: u16,
    output_path: String,
    receiver: tauri::State<'_, PaTcpReceiver>,
) -> Result<PaReceiverStatus, String> {
    receiver.start(host, port, output_path)
}

#[tauri::command]
pub fn pa_receiver_stop(receiver: tauri::State<'_, PaTcpReceiver>) -> Result<PaReceiverStatus, String> {
    Ok(receiver.request_stop())
}

#[tauri::command]
pub fn pa_receiver_status(receiver: tauri::State<'_, PaTcpReceiver>) -> Result<PaReceiverStatus, String> {
    Ok(receiver.status())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpListener;
    use std::sync::mpsc;

    fn temp_output_path(name: &str) -> String {
        let mut path = std::env::temp_dir();
        path.push(format!("{name}_{}.bin", std::process::id()));
        path.display().to_string()
    }

    fn encode_pai_record(
        record_type: u16,
        sequence: u64,
        payload: &[u8],
        block_id: u64,
        frame_count: u32,
        first_frame_id: u64,
        last_frame_id: u64,
    ) -> Vec<u8> {
        let mut record = vec![0u8; STREAM_HEADER_BYTES + payload.len()];
        record[0..4].copy_from_slice(STREAM_MAGIC);
        record[4..6].copy_from_slice(&1u16.to_le_bytes());
        record[6..8].copy_from_slice(&record_type.to_le_bytes());
        record[8..12].copy_from_slice(&(STREAM_HEADER_BYTES as u32).to_le_bytes());
        record[12..20].copy_from_slice(&(payload.len() as u64).to_le_bytes());
        record[20..28].copy_from_slice(&sequence.to_le_bytes());
        record[36..44].copy_from_slice(&block_id.to_le_bytes());
        record[44..48].copy_from_slice(&frame_count.to_le_bytes());
        record[52..60].copy_from_slice(&first_frame_id.to_le_bytes());
        record[60..68].copy_from_slice(&last_frame_id.to_le_bytes());
        record[STREAM_HEADER_BYTES..].copy_from_slice(payload);
        record
    }

    fn run_socket_receiver<F>(name: &str, sender: F) -> (Result<(), String>, PaReceiverRuntime, Vec<u8>)
    where
        F: FnOnce(TcpStream) + Send + 'static,
    {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind test listener");
        let addr = listener.local_addr().expect("listener addr");
        let output_path = temp_output_path(name);
        let output_for_read = output_path.clone();
        let sender_thread = thread::spawn(move || {
            let (stream, _) = listener.accept().expect("accept receiver connection");
            sender(stream);
        });
        let runtime = Arc::new(Mutex::new(PaReceiverRuntime::default()));
        let stop_flag = Arc::new(AtomicBool::new(false));

        let result = run_receiver_loop(addr.to_string(), output_path, Arc::clone(&runtime), stop_flag);
        sender_thread.join().expect("sender thread should exit");
        let bytes = std::fs::read(&output_for_read).unwrap_or_default();
        let runtime = Arc::try_unwrap(runtime)
            .expect("runtime should have one owner")
            .into_inner()
            .expect("runtime mutex poisoned");
        let _ = std::fs::remove_file(output_for_read);
        (result, runtime, bytes)
    }

    #[test]
    fn start_returns_without_relocking_runtime_status() {
        let receiver = Arc::new(PaTcpReceiver::new());
        let receiver_for_start = Arc::clone(&receiver);
        let output_path = temp_output_path("pa_receiver_start_returns");
        let (tx, rx) = mpsc::channel();

        let start_thread = thread::spawn(move || {
            let result = receiver_for_start.start("127.0.0.1".to_string(), 1, output_path);
            tx.send(result.map(|status| status.running)).ok();
        });

        let start_result = rx
            .recv_timeout(Duration::from_millis(500))
            .expect("PA receiver start deadlocked before returning status");
        assert!(start_result.expect("start result should be ok"));

        let _ = receiver.request_stop();
        start_thread.join().expect("start thread should exit");
    }

    #[test]
    fn status_reports_endpoint_and_receiver_phase() {
        let receiver = PaTcpReceiver::new();
        let output_path = temp_output_path("pa_receiver_status_phase");

        let start_status = receiver
            .start("127.0.0.1".to_string(), 1, output_path)
            .expect("start should return status");

        assert_eq!(start_status.endpoint, "127.0.0.1:1");
        assert!(!start_status.phase.is_empty());

        let status = receiver.status();
        assert_eq!(status.endpoint, "127.0.0.1:1");
        assert!(!status.phase.is_empty());

        let _ = receiver.request_stop();
    }

    #[test]
    fn writes_data_record_payload_as_legacy_block() {
        let mut out = Vec::<u8>::new();
        let payload = vec![1u8, 2, 3, 4];
        write_legacy_block_record(&mut out, 9, payload.len() as u64, 2, 100, 101, &payload)
            .expect("legacy write");

        assert_eq!(out.len(), 36);
        assert_eq!(u64::from_le_bytes(out[0..8].try_into().unwrap()), 9);
        assert_eq!(u32::from_le_bytes(out[8..12].try_into().unwrap()), 4);
        assert_eq!(u32::from_le_bytes(out[12..16].try_into().unwrap()), 2);
        assert_eq!(u64::from_le_bytes(out[16..24].try_into().unwrap()), 100);
        assert_eq!(u64::from_le_bytes(out[24..32].try_into().unwrap()), 101);
        assert_eq!(&out[32..36], &[1, 2, 3, 4]);
    }

    #[test]
    fn receiver_writes_only_data_records_as_legacy_blocks() {
        let metadata = encode_pai_record(1, 10, &[9, 9], 0, 0, 0, 0);
        let data = encode_pai_record(2, 11, &[1, 2, 3, 4], 9, 2, 100, 101);
        let status = encode_pai_record(3, 12, &[7], 0, 0, 0, 0);
        let expected_bytes_received = metadata.len() + data.len() + status.len();

        let (result, runtime, output) =
            run_socket_receiver("pa_receiver_socket_data_only", move |mut stream| {
                stream.write_all(&metadata).expect("write metadata");
                stream.write_all(&data).expect("write data");
                stream.write_all(&status).expect("write status");
            });

        result.expect("receiver should finish cleanly");
        assert_eq!(output.len(), 36);
        assert_eq!(u64::from_le_bytes(output[0..8].try_into().unwrap()), 9);
        assert_eq!(u32::from_le_bytes(output[8..12].try_into().unwrap()), 4);
        assert_eq!(u32::from_le_bytes(output[12..16].try_into().unwrap()), 2);
        assert_eq!(u64::from_le_bytes(output[16..24].try_into().unwrap()), 100);
        assert_eq!(u64::from_le_bytes(output[24..32].try_into().unwrap()), 101);
        assert_eq!(&output[32..36], &[1, 2, 3, 4]);
        assert_eq!(runtime.blocks_received, 1);
        assert_eq!(runtime.frames_received, 2);
        assert_eq!(runtime.bytes_received, expected_bytes_received as u64);
    }

    #[test]
    fn receiver_reports_unexpected_eof_mid_payload() {
        let mut data = encode_pai_record(2, 1, &[1, 2, 3, 4], 9, 2, 100, 101);
        data.truncate(STREAM_HEADER_BYTES + 2);

        let (result, _, _) = run_socket_receiver("pa_receiver_eof_mid_payload", move |mut stream| {
            stream.write_all(&data).expect("write partial data");
        });

        let err = result.expect_err("partial payload should fail");
        assert!(err.contains("data payload"), "unexpected error: {err}");
        assert!(err.contains("2") && err.contains("4"), "unexpected error: {err}");
    }

    #[test]
    fn receiver_rejects_unsupported_stream_version() {
        let mut data = encode_pai_record(2, 1, &[], 0, 0, 0, 0);
        data[4..6].copy_from_slice(&2u16.to_le_bytes());

        let (result, _, _) = run_socket_receiver("pa_receiver_bad_version", move |mut stream| {
            stream.write_all(&data).expect("write bad version");
        });

        let err = result.expect_err("unsupported stream version should fail");
        assert!(err.contains("unsupported stream version"), "unexpected error: {err}");
    }

    #[test]
    fn receiver_rejects_oversized_data_payload_before_reading_payload() {
        let mut data = encode_pai_record(2, 1, &[], 0, 0, 0, 0);
        data[12..20].copy_from_slice(&((MAX_STREAM_DATA_PAYLOAD_BYTES as u64) + 1).to_le_bytes());

        let (result, _, _) =
            run_socket_receiver("pa_receiver_oversized_payload", move |mut stream| {
                stream.write_all(&data).expect("write oversized data header");
            });

        let err = result.expect_err("oversized payload should fail");
        assert!(err.contains("payload"), "unexpected error: {err}");
        assert!(err.contains("exceeds"), "unexpected error: {err}");
    }

    #[test]
    fn request_stop_keeps_worker_handle_when_join_times_out() {
        let receiver = PaTcpReceiver::new();
        let stop_flag = Arc::new(AtomicBool::new(false));
        let thread_stop_flag = Arc::clone(&stop_flag);
        let worker = thread::spawn(move || {
            while !thread_stop_flag.load(Ordering::SeqCst) {
                thread::sleep(Duration::from_millis(1));
            }
            thread::sleep(Duration::from_millis(50));
        });

        {
            let mut runtime = receiver.runtime.lock().expect("runtime mutex poisoned");
            runtime.running = true;
        }
        *receiver.stop_signal.lock().expect("stop signal mutex poisoned") = Some(stop_flag);
        *receiver.worker.lock().expect("worker mutex poisoned") = Some(worker);

        let status = receiver.request_stop_with_timeout(Duration::from_millis(1));

        assert!(status.running);
        assert!(status.stop_requested);
        assert!(receiver.worker.lock().expect("worker mutex poisoned").is_some());
        assert!(receiver.stop_signal.lock().expect("stop signal mutex poisoned").is_some());

        thread::sleep(Duration::from_millis(100));
        let status = receiver.request_stop_with_timeout(Duration::from_millis(100));
        assert!(!status.running);
        assert!(receiver.worker.lock().expect("worker mutex poisoned").is_none());
    }
}
