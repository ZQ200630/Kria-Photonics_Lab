# PA Imaging TCP Stream Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate the PA imaging AXIS capture flow into the Python server and stream captured superblocks over board-hosted TCP to the Tauri app for upper-computer saving.

**Architecture:** Add a focused Python PA capture module that owns the PAM AXI register writes, `axis-capture-superblock` ioctl/read loop, TCP record framing, and one capture worker. Extend the existing HTTP/SSE server as the control plane, while a board-side TCP listener is the data plane. Add Tauri Rust receiver commands and a React PA tab that starts the receiver, starts/stops board capture, and reports progress without storing data blocks in React state.

**Tech Stack:** Python stdlib (`struct`, `socket`, `threading`, `fcntl`, `select`, `mmap` through existing `AxiMap`), existing `ThreadingHTTPServer` server, Rust std `TcpStream`/threads/files with Tauri commands, React/Vitest.

---

## Scope Check

This plan implements the first version from
`docs/superpowers/specs/2026-06-26-pa-imaging-tcp-stream-design.md`.
It includes raw PA stream transfer and saving. It does not include real-time PA
image reconstruction or display.

## File Structure

- Create `pa_imaging_capture.py`: PA parameter parsing, ioctl constants, TCP
  record framing, TCP data server, hardware wrappers, and capture worker.
- Create `tests/test_pa_imaging_capture.py`: Python unit tests with fake AXI,
  fake capture device, and fake socket writer.
- Modify `butterfly_laser_server.py`: CLI args, server construction, `/api/pa/*`
  endpoints, `/api/status` PA summary.
- Modify `butterfly_laser_server_tauri.py`: pass PA CLI args through and stop PA
  services during shutdown.
- Modify `tauri_control_console/src-tauri/src/main.rs`: expose PA receiver
  Tauri commands.
- Create `tauri_control_console/src-tauri/src/pa_stream.rs`: Rust TCP receiver,
  file writer, header parser, shared status, and unit tests.
- Modify `tauri_control_console/src/api/types.ts`: PA server and receiver
  status types.
- Modify `tauri_control_console/src/api/client.ts`: PA HTTP API methods.
- Modify `tauri_control_console/src/App.tsx`: add `PA` tab.
- Create `tauri_control_console/src/components/PaImagingPanel.tsx`: PA capture
  UI.
- Create `tauri_control_console/src/__tests__/paImaging.test.tsx`: UI tests.

Keep the current dirty raw/plot worktree intact. Stage only PA files when
committing each task.

## Task 1: Python Protocol And Parameter Model

**Files:**
- Create: `/home/qian/Portable_System_Project/Butterfly_Laser_Driver/pa_imaging_capture.py`
- Test: `/home/qian/Portable_System_Project/Butterfly_Laser_Driver/tests/test_pa_imaging_capture.py`

- [ ] **Step 1: Write failing tests for PA parameters and TCP records**

Add this initial test file:

```python
import json
import struct
import unittest

import pa_imaging_capture as pa


class FakeRegs:
    def __init__(self):
        self.values = {}
        self.writes = []

    def read32(self, offset):
        return self.values.get(offset, 0)

    def write32(self, offset, value):
        self.values[offset] = value & 0xFFFFFFFF
        self.writes.append((offset, value & 0xFFFFFFFF))


class PaProtocolTests(unittest.TestCase):
    def test_pam_params_pack_signed_16_bit_values_like_axis_capture_app(self):
        params = pa.PamCaptureParams(x_start=-1000, x_step=25, x_points=128)

        packed = params.register_values()

        self.assertEqual(packed[pa.PAM_REG_X_START], 0xFC18)
        self.assertEqual(packed[pa.PAM_REG_X_STEP], 25)
        self.assertEqual(packed[pa.PAM_REG_X_POINTS], 128)
        self.assertEqual(packed[pa.PAM_REG_SCAN_MODE], 0)

    def test_pam_axi_program_forces_start_low_before_register_writes(self):
        regs = FakeRegs()
        params = pa.PamCaptureParams(x_start=-1, x_step=2, x_points=3)
        controller = pa.PamAxiController(regs)

        controller.program(params, verify=True)

        self.assertEqual(regs.writes[0], (pa.PAM_REG_START, 0))
        self.assertIn((pa.PAM_REG_X_START, 0xFFFF), regs.writes)
        self.assertIn((pa.PAM_REG_X_STEP, 2), regs.writes)
        self.assertIn((pa.PAM_REG_X_POINTS, 3), regs.writes)

    def test_stream_record_header_is_little_endian_and_self_describing(self):
        record = pa.PaStreamRecord(
            record_type=pa.RECORD_TYPE_DATA,
            sequence=7,
            timestamp_ns=123,
            block_id=9,
            frame_count=4,
            first_frame_id=11,
            last_frame_id=14,
            payload=b"abcd",
        )

        encoded = record.encode()
        header = struct.unpack(pa.STREAM_RECORD_HEADER_FORMAT, encoded[:pa.STREAM_RECORD_HEADER_BYTES])

        self.assertEqual(header[0], pa.STREAM_MAGIC)
        self.assertEqual(header[1], pa.STREAM_VERSION)
        self.assertEqual(header[2], pa.RECORD_TYPE_DATA)
        self.assertEqual(header[3], pa.STREAM_RECORD_HEADER_BYTES)
        self.assertEqual(header[4], 4)
        self.assertEqual(header[5], 7)
        self.assertEqual(header[7], 9)
        self.assertEqual(encoded[pa.STREAM_RECORD_HEADER_BYTES:], b"abcd")

    def test_metadata_record_encodes_compact_json_payload(self):
        record = pa.metadata_record(sequence=1, timestamp_ns=2, payload={"x_points": 3})

        decoded = json.loads(record.payload.decode("utf-8"))

        self.assertEqual(record.record_type, pa.RECORD_TYPE_METADATA)
        self.assertEqual(decoded, {"x_points": 3})


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run the tests and verify they fail because the module is missing**

Run:

```bash
cd /home/qian/Portable_System_Project/Butterfly_Laser_Driver
python -m unittest tests.test_pa_imaging_capture.PaProtocolTests -v
```

Expected: `ModuleNotFoundError: No module named 'pa_imaging_capture'`.

- [ ] **Step 3: Create the minimal protocol and parameter implementation**

Create `pa_imaging_capture.py` with this content:

```python
import json
import struct
import time
from dataclasses import asdict, dataclass

PAM_AXI_DEFAULT_BASE = 0xA0110000
PAM_AXI_MAP_SPAN = 0x1000

PAM_REG_START = 0x00
PAM_REG_X_START = 0x04
PAM_REG_X_STEP = 0x08
PAM_REG_X_POINTS = 0x0C
PAM_REG_Y_START = 0x10
PAM_REG_Y_STEP = 0x14
PAM_REG_Y_POINTS = 0x18
PAM_REG_FRAME_NUMBER = 0x1C
PAM_REG_TASK_ID = 0x20
PAM_REG_GAP_TIME = 0x24
PAM_REG_GALVO_SETTLE_TIME = 0x28
PAM_REG_LD_TRIGGER_TIME = 0x2C
PAM_REG_ADC_TRIGGER_TIME = 0x30
PAM_REG_LD_TIME = 0x34
PAM_REG_SCAN_MODE = 0x38

PAM_REGISTER_ORDER = (
    PAM_REG_X_START,
    PAM_REG_X_STEP,
    PAM_REG_X_POINTS,
    PAM_REG_Y_START,
    PAM_REG_Y_STEP,
    PAM_REG_Y_POINTS,
    PAM_REG_FRAME_NUMBER,
    PAM_REG_TASK_ID,
    PAM_REG_GAP_TIME,
    PAM_REG_GALVO_SETTLE_TIME,
    PAM_REG_LD_TRIGGER_TIME,
    PAM_REG_ADC_TRIGGER_TIME,
    PAM_REG_LD_TIME,
    PAM_REG_SCAN_MODE,
)

STREAM_MAGIC = b"PAI1"
STREAM_VERSION = 1
RECORD_TYPE_METADATA = 1
RECORD_TYPE_DATA = 2
RECORD_TYPE_STATUS = 3
RECORD_TYPE_END = 4
RECORD_TYPE_ERROR = 5
STREAM_RECORD_HEADER_FORMAT = "<4sHHIQQQQIIQQ"
STREAM_RECORD_HEADER_BYTES = struct.calcsize(STREAM_RECORD_HEADER_FORMAT)


def now_ns():
    return time.monotonic_ns()


def _u16_bits(value):
    value = int(value)
    if value < -32768 or value > 0xFFFF:
        raise ValueError("16-bit register value out of range")
    return value & 0xFFFF


def _u32(value):
    value = int(value)
    if value < 0 or value > 0xFFFFFFFF:
        raise ValueError("32-bit register value out of range")
    return value


@dataclass(frozen=True)
class PamCaptureParams:
    x_start: int = 0
    x_step: int = 1
    x_points: int = 1
    y_start: int = 0
    y_step: int = 1
    y_points: int = 1
    frame_number: int = 1
    task_id: int = 1
    gap_time: int = 1000
    galvo_settle_time: int = 1000
    ld_trigger_time: int = 0
    adc_trigger_time: int = 100
    ld_time: int = 100
    scan_mode: int = 0

    @classmethod
    def from_dict(cls, body):
        return cls(
            x_start=int(body.get("x_start", 0)),
            x_step=int(body.get("x_step", 1)),
            x_points=int(body.get("x_points", 1)),
            y_start=int(body.get("y_start", 0)),
            y_step=int(body.get("y_step", 1)),
            y_points=int(body.get("y_points", 1)),
            frame_number=int(body.get("frame_number", 1)),
            task_id=int(body.get("task_id", 1)),
            gap_time=int(body.get("gap_time", 1000)),
            galvo_settle_time=int(body.get("galvo_settle_time", 1000)),
            ld_trigger_time=int(body.get("ld_trigger_time", 0)),
            adc_trigger_time=int(body.get("adc_trigger_time", 100)),
            ld_time=int(body.get("ld_time", 100)),
            scan_mode=int(body.get("scan_mode", 0)),
        )

    def register_values(self):
        return {
            PAM_REG_X_START: _u16_bits(self.x_start),
            PAM_REG_X_STEP: _u16_bits(self.x_step),
            PAM_REG_X_POINTS: _u16_bits(self.x_points),
            PAM_REG_Y_START: _u16_bits(self.y_start),
            PAM_REG_Y_STEP: _u16_bits(self.y_step),
            PAM_REG_Y_POINTS: _u16_bits(self.y_points),
            PAM_REG_FRAME_NUMBER: _u16_bits(self.frame_number),
            PAM_REG_TASK_ID: _u32(self.task_id),
            PAM_REG_GAP_TIME: _u32(self.gap_time),
            PAM_REG_GALVO_SETTLE_TIME: _u32(self.galvo_settle_time),
            PAM_REG_LD_TRIGGER_TIME: _u32(self.ld_trigger_time),
            PAM_REG_ADC_TRIGGER_TIME: _u32(self.adc_trigger_time),
            PAM_REG_LD_TIME: _u32(self.ld_time),
            PAM_REG_SCAN_MODE: _u32(self.scan_mode),
        }

    def to_dict(self):
        return asdict(self)


class PamAxiController:
    def __init__(self, regs):
        self.regs = regs

    def write_start(self, level, verify=True):
        value = 1 if level else 0
        self.regs.write32(PAM_REG_START, value)
        if verify and (self.regs.read32(PAM_REG_START) & 1) != value:
            raise RuntimeError("PAM start readback mismatch")

    def program(self, params, verify=True):
        self.write_start(0, verify=verify)
        values = params.register_values()
        for offset in PAM_REGISTER_ORDER:
            value = values[offset]
            self.regs.write32(offset, value)
            if verify:
                readback = self.regs.read32(offset)
                if offset <= PAM_REG_FRAME_NUMBER:
                    readback &= 0xFFFF
                if readback != value:
                    raise RuntimeError(f"PAM register 0x{offset:02X} readback mismatch")


@dataclass(frozen=True)
class PaStreamRecord:
    record_type: int
    sequence: int
    timestamp_ns: int
    block_id: int = 0
    frame_count: int = 0
    first_frame_id: int = 0
    last_frame_id: int = 0
    payload: bytes = b""

    def encode(self):
        header = struct.pack(
            STREAM_RECORD_HEADER_FORMAT,
            STREAM_MAGIC,
            STREAM_VERSION,
            int(self.record_type),
            STREAM_RECORD_HEADER_BYTES,
            len(self.payload),
            int(self.sequence),
            int(self.timestamp_ns),
            int(self.block_id),
            int(self.frame_count),
            0,
            int(self.first_frame_id),
            int(self.last_frame_id),
        )
        return header + self.payload


def json_record(record_type, sequence, timestamp_ns, payload):
    data = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
    return PaStreamRecord(record_type=record_type, sequence=sequence, timestamp_ns=timestamp_ns, payload=data)


def metadata_record(sequence, timestamp_ns, payload):
    return json_record(RECORD_TYPE_METADATA, sequence, timestamp_ns, payload)
```

- [ ] **Step 4: Run the focused tests and verify they pass**

Run:

```bash
cd /home/qian/Portable_System_Project/Butterfly_Laser_Driver
python -m unittest tests.test_pa_imaging_capture.PaProtocolTests -v
```

Expected: 4 tests pass.

- [ ] **Step 5: Commit Task 1**

Run:

```bash
cd /home/qian/Portable_System_Project/Butterfly_Laser_Driver
git add pa_imaging_capture.py tests/test_pa_imaging_capture.py
git commit -m "feat: add pa imaging stream protocol"
```

## Task 2: Axis Capture Device Wrapper

**Files:**
- Modify: `/home/qian/Portable_System_Project/Butterfly_Laser_Driver/pa_imaging_capture.py`
- Modify: `/home/qian/Portable_System_Project/Butterfly_Laser_Driver/tests/test_pa_imaging_capture.py`

- [ ] **Step 1: Add failing tests for ioctl status and block parsing**

Append these tests to `PaProtocolTests`:

```python
    def test_axis_status_unpack_matches_superblock_driver_layout(self):
        raw = struct.pack("<15I", 1, 0, 0, 4096, 33554432, 2, 3, 4, 5, 6, 7, 8, 9, 10, 0)

        status = pa.AxisCaptureStatus.unpack(raw)

        self.assertTrue(status.running)
        self.assertEqual(status.frame_bytes, 4096)
        self.assertEqual(status.superblock_bytes, 33554432)
        self.assertEqual(status.ready_block_count, 4)
        self.assertEqual(status.completed_blocks, 8)

    def test_axis_block_header_unpack_matches_superblock_driver_layout(self):
        raw = struct.pack("<QIIQQ", 5, 12, 3, 20, 22)

        header = pa.AxisBlockHeader.unpack(raw)

        self.assertEqual(header.block_id, 5)
        self.assertEqual(header.used_bytes, 12)
        self.assertEqual(header.frame_count, 3)
        self.assertEqual(header.first_frame_id, 20)
        self.assertEqual(header.last_frame_id, 22)
```

- [ ] **Step 2: Run the tests and verify they fail on missing classes**

Run:

```bash
cd /home/qian/Portable_System_Project/Butterfly_Laser_Driver
python -m unittest tests.test_pa_imaging_capture.PaProtocolTests -v
```

Expected: failure mentioning `AxisCaptureStatus` or `AxisBlockHeader`.

- [ ] **Step 3: Implement status/header structures and ioctl constants**

Append this code to `pa_imaging_capture.py`:

```python
import array
import fcntl
import os
import select

AXIS_CAP_IOC_MAGIC = ord("q")
AXIS_CAP_IOC_START_NR = 0x01
AXIS_CAP_IOC_STOP_NR = 0x02
AXIS_CAP_IOC_GET_STATUS_NR = 0x03

IOC_NRBITS = 8
IOC_TYPEBITS = 8
IOC_SIZEBITS = 14
IOC_DIRBITS = 2
IOC_NRSHIFT = 0
IOC_TYPESHIFT = IOC_NRSHIFT + IOC_NRBITS
IOC_SIZESHIFT = IOC_TYPESHIFT + IOC_TYPEBITS
IOC_DIRSHIFT = IOC_SIZESHIFT + IOC_SIZEBITS
IOC_NONE = 0
IOC_WRITE = 1
IOC_READ = 2

AXIS_STATUS_FORMAT = "<15I"
AXIS_STATUS_BYTES = struct.calcsize(AXIS_STATUS_FORMAT)
AXIS_BLOCK_HEADER_FORMAT = "<QIIQQ"
AXIS_BLOCK_HEADER_BYTES = struct.calcsize(AXIS_BLOCK_HEADER_FORMAT)
AXIS_READ_TIMEOUT = object()


def _ioc(direction, magic, number, size):
    return (
        (int(direction) << IOC_DIRSHIFT)
        | (int(magic) << IOC_TYPESHIFT)
        | (int(number) << IOC_NRSHIFT)
        | (int(size) << IOC_SIZESHIFT)
    )


AXIS_CAP_IOC_START = _ioc(IOC_NONE, AXIS_CAP_IOC_MAGIC, AXIS_CAP_IOC_START_NR, 0)
AXIS_CAP_IOC_STOP = _ioc(IOC_NONE, AXIS_CAP_IOC_MAGIC, AXIS_CAP_IOC_STOP_NR, 0)
AXIS_CAP_IOC_GET_STATUS = _ioc(IOC_READ, AXIS_CAP_IOC_MAGIC, AXIS_CAP_IOC_GET_STATUS_NR, AXIS_STATUS_BYTES)


@dataclass(frozen=True)
class AxisCaptureStatus:
    running: bool
    stop_requested: bool
    removing: bool
    frame_bytes: int
    superblock_bytes: int
    active_dma_count: int
    done_count: int
    ready_block_count: int
    free_block_count: int
    completed_frames: int
    aggregated_frames: int
    completed_blocks: int
    dropped_frames: int
    dropped_blocks: int
    draining_done: bool

    @classmethod
    def unpack(cls, raw):
        fields = struct.unpack(AXIS_STATUS_FORMAT, raw[:AXIS_STATUS_BYTES])
        return cls(
            running=bool(fields[0]),
            stop_requested=bool(fields[1]),
            removing=bool(fields[2]),
            frame_bytes=fields[3],
            superblock_bytes=fields[4],
            active_dma_count=fields[5],
            done_count=fields[6],
            ready_block_count=fields[7],
            free_block_count=fields[8],
            completed_frames=fields[9],
            aggregated_frames=fields[10],
            completed_blocks=fields[11],
            dropped_frames=fields[12],
            dropped_blocks=fields[13],
            draining_done=bool(fields[14]),
        )

    def to_dict(self):
        return asdict(self)


@dataclass(frozen=True)
class AxisBlockHeader:
    block_id: int
    used_bytes: int
    frame_count: int
    first_frame_id: int
    last_frame_id: int

    @classmethod
    def unpack(cls, raw):
        block_id, used_bytes, frame_count, first_frame_id, last_frame_id = struct.unpack(
            AXIS_BLOCK_HEADER_FORMAT,
            raw[:AXIS_BLOCK_HEADER_BYTES],
        )
        return cls(block_id, used_bytes, frame_count, first_frame_id, last_frame_id)

    def to_dict(self):
        return asdict(self)
```

- [ ] **Step 4: Run tests and verify they pass**

Run:

```bash
cd /home/qian/Portable_System_Project/Butterfly_Laser_Driver
python -m unittest tests.test_pa_imaging_capture.PaProtocolTests -v
```

Expected: 6 tests pass.

- [ ] **Step 5: Commit Task 2**

Run:

```bash
cd /home/qian/Portable_System_Project/Butterfly_Laser_Driver
git add pa_imaging_capture.py tests/test_pa_imaging_capture.py
git commit -m "feat: parse pa axis capture driver records"
```

## Task 3: TCP Server And Capture Worker

**Files:**
- Modify: `/home/qian/Portable_System_Project/Butterfly_Laser_Driver/pa_imaging_capture.py`
- Modify: `/home/qian/Portable_System_Project/Butterfly_Laser_Driver/tests/test_pa_imaging_capture.py`

- [ ] **Step 1: Add failing tests for send order and stop order**

Append these fakes and tests:

```python
class FakeWriter:
    def __init__(self):
        self.records = []
        self.closed = False

    def send_record(self, record):
        self.records.append(record)

    def close_client(self):
        self.closed = True


class FakeCaptureDevice:
    def __init__(self, blocks):
        self.blocks = list(blocks)
        self.actions = []
        self.status = pa.AxisCaptureStatus(False, False, False, 4096, 33554432, 0, 0, 0, 8, 0, 0, 0, 0, 0, False)

    def open(self):
        self.actions.append("open")

    def get_status(self):
        self.actions.append("status")
        return self.status

    def start(self):
        self.actions.append("dma_start")

    def stop(self):
        self.actions.append("dma_stop")

    def read_block(self, timeout=0.5):
        self.actions.append("read")
        if self.blocks:
            return self.blocks.pop(0)
        return None

    def close(self):
        self.actions.append("close")


class PaWorkerTests(unittest.TestCase):
    def test_worker_sends_metadata_data_and_end_records(self):
        regs = FakeRegs()
        pam = pa.PamAxiController(regs)
        block = (
            pa.AxisBlockHeader(block_id=1, used_bytes=4, frame_count=2, first_frame_id=10, last_frame_id=11),
            b"abcd",
        )
        device = FakeCaptureDevice([block])
        writer = FakeWriter()
        worker = pa.PaCaptureWorker(pam, device, writer)

        summary = worker.run_once(pa.PamCaptureParams(), max_blocks=1, capture_time_sec=0)

        self.assertEqual([record.record_type for record in writer.records], [
            pa.RECORD_TYPE_METADATA,
            pa.RECORD_TYPE_DATA,
            pa.RECORD_TYPE_END,
        ])
        self.assertEqual(writer.records[1].payload, b"abcd")
        self.assertEqual(writer.records[1].block_id, 1)
        self.assertEqual(summary["blocks_sent"], 1)

    def test_worker_stop_order_matches_axis_capture_app(self):
        regs = FakeRegs()
        pam = pa.PamAxiController(regs)
        device = FakeCaptureDevice([])
        writer = FakeWriter()
        worker = pa.PaCaptureWorker(pam, device, writer)

        worker.run_once(pa.PamCaptureParams(), max_blocks=0, capture_time_sec=0)

        self.assertIn((pa.PAM_REG_START, 0), regs.writes)
        self.assertLess(device.actions.index("dma_start"), device.actions.index("dma_stop"))
        self.assertEqual(regs.writes[-1], (pa.PAM_REG_START, 0))
```

- [ ] **Step 2: Run tests and verify they fail on missing worker**

Run:

```bash
cd /home/qian/Portable_System_Project/Butterfly_Laser_Driver
python -m unittest tests.test_pa_imaging_capture.PaWorkerTests -v
```

Expected: failure mentioning `PaCaptureWorker`.

- [ ] **Step 3: Implement writer and worker**

Append this code to `pa_imaging_capture.py`:

```python
import socket
import threading


class ConnectedPaWriter:
    def __init__(self, sock):
        self.sock = sock
        self.lock = threading.Lock()

    def send_record(self, record):
        data = record.encode()
        with self.lock:
            self.sock.sendall(data)

    def close_client(self):
        with self.lock:
            try:
                self.sock.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            try:
                self.sock.close()
            except OSError:
                pass


class AxisCaptureDevice:
    def __init__(self, dev_path="/dev/axis_capture0"):
        self.dev_path = dev_path
        self.fd = None

    def open(self):
        self.fd = os.open(self.dev_path, os.O_RDONLY)

    def close(self):
        if self.fd is not None:
            os.close(self.fd)
            self.fd = None

    def get_status(self):
        buf = array.array("B", b"\x00" * AXIS_STATUS_BYTES)
        fcntl.ioctl(self.fd, AXIS_CAP_IOC_GET_STATUS, buf, True)
        return AxisCaptureStatus.unpack(buf.tobytes())

    def start(self):
        fcntl.ioctl(self.fd, AXIS_CAP_IOC_START, 0)

    def stop(self):
        fcntl.ioctl(self.fd, AXIS_CAP_IOC_STOP, 0)

    def read_block(self, timeout=0.5):
        poller = select.poll()
        poller.register(self.fd, select.POLLIN | select.POLLRDNORM | select.POLLHUP | select.POLLERR)
        events = poller.poll(int(float(timeout) * 1000.0))
        if not events:
            return AXIS_READ_TIMEOUT
        _fd, mask = events[0]
        if mask & select.POLLERR:
            raise RuntimeError("axis capture poll error")
        status = self.get_status()
        read_size = AXIS_BLOCK_HEADER_BYTES + int(status.superblock_bytes)
        data = os.read(self.fd, read_size)
        if not data:
            return None
        if len(data) < AXIS_BLOCK_HEADER_BYTES:
            raise RuntimeError("short axis capture block header")
        header = AxisBlockHeader.unpack(data[:AXIS_BLOCK_HEADER_BYTES])
        payload = data[AXIS_BLOCK_HEADER_BYTES:]
        if len(payload) != header.used_bytes:
            raise RuntimeError("axis capture block size mismatch")
        return header, payload


class PaCaptureWorker:
    def __init__(self, pam, device, writer):
        self.pam = pam
        self.device = device
        self.writer = writer
        self.stop_event = threading.Event()
        self.sequence = 0
        self.stats = {
            "running": False,
            "blocks_sent": 0,
            "frames_sent": 0,
            "bytes_sent": 0,
            "last_error": "",
            "end_reason": "",
        }

    def request_stop(self):
        self.stop_event.set()

    def _next_record(self, record):
        self.sequence += 1
        return PaStreamRecord(
            record_type=record.record_type,
            sequence=self.sequence,
            timestamp_ns=record.timestamp_ns,
            block_id=record.block_id,
            frame_count=record.frame_count,
            first_frame_id=record.first_frame_id,
            last_frame_id=record.last_frame_id,
            payload=record.payload,
        )

    def _send_json(self, record_type, payload):
        self.sequence += 1
        self.writer.send_record(json_record(record_type, self.sequence, now_ns(), payload))

    def run_once(self, params, max_blocks=-1, capture_time_sec=0):
        self.stats.update({
            "running": True,
            "blocks_sent": 0,
            "frames_sent": 0,
            "bytes_sent": 0,
            "last_error": "",
            "end_reason": "",
        })
        dma_started = False
        start_asserted = False
        start_time = time.monotonic()
        try:
            self.pam.program(params, verify=True)
            self.device.open()
            initial_status = self.device.get_status()
            self._send_json(RECORD_TYPE_METADATA, {
                "params": params.to_dict(),
                "axis_status": initial_status.to_dict(),
                "stream_record_header_bytes": STREAM_RECORD_HEADER_BYTES,
                "stream_version": STREAM_VERSION,
            })
            self.device.start()
            dma_started = True
            self.pam.write_start(1, verify=True)
            start_asserted = True
            while not self.stop_event.is_set():
                if max_blocks >= 0 and self.stats["blocks_sent"] >= int(max_blocks):
                    self.stats["end_reason"] = "max_blocks"
                    break
                if capture_time_sec > 0 and (time.monotonic() - start_time) >= float(capture_time_sec):
                    self.stats["end_reason"] = "capture_time"
                    break
                item = self.device.read_block(timeout=0.5)
                if item is AXIS_READ_TIMEOUT:
                    continue
                if item is None:
                    self.stats["end_reason"] = "eof"
                    break
                header, payload = item
                self.sequence += 1
                self.writer.send_record(PaStreamRecord(
                    record_type=RECORD_TYPE_DATA,
                    sequence=self.sequence,
                    timestamp_ns=now_ns(),
                    block_id=header.block_id,
                    frame_count=header.frame_count,
                    first_frame_id=header.first_frame_id,
                    last_frame_id=header.last_frame_id,
                    payload=payload,
                ))
                self.stats["blocks_sent"] += 1
                self.stats["frames_sent"] += int(header.frame_count)
                self.stats["bytes_sent"] += len(payload)
            if not self.stats["end_reason"]:
                self.stats["end_reason"] = "stop_requested" if self.stop_event.is_set() else "eof"
            return self._finish(dma_started, start_asserted)
        except Exception as exc:
            self.stats["last_error"] = str(exc)
            self.stats["end_reason"] = "error"
            try:
                self._send_json(RECORD_TYPE_ERROR, dict(self.stats))
            except Exception:
                pass
            self._finish(dma_started, start_asserted)
            raise
        finally:
            self.stats["running"] = False
            self.device.close()

    def _finish(self, dma_started, start_asserted):
        if start_asserted:
            self.pam.write_start(0, verify=True)
        if dma_started:
            self.device.stop()
        while dma_started:
            item = self.device.read_block(timeout=0.1)
            if item is AXIS_READ_TIMEOUT:
                continue
            if item is None:
                break
            header, payload = item
            self.sequence += 1
            self.writer.send_record(PaStreamRecord(
                record_type=RECORD_TYPE_DATA,
                sequence=self.sequence,
                timestamp_ns=now_ns(),
                block_id=header.block_id,
                frame_count=header.frame_count,
                first_frame_id=header.first_frame_id,
                last_frame_id=header.last_frame_id,
                payload=payload,
            ))
            self.stats["blocks_sent"] += 1
            self.stats["frames_sent"] += int(header.frame_count)
            self.stats["bytes_sent"] += len(payload)
        self._send_json(RECORD_TYPE_END, dict(self.stats))
        return dict(self.stats)
```

- [ ] **Step 4: Run worker tests and full PA Python tests**

Run:

```bash
cd /home/qian/Portable_System_Project/Butterfly_Laser_Driver
python -m unittest tests.test_pa_imaging_capture -v
```

Expected: all PA tests pass.

- [ ] **Step 5: Commit Task 3**

Run:

```bash
cd /home/qian/Portable_System_Project/Butterfly_Laser_Driver
git add pa_imaging_capture.py tests/test_pa_imaging_capture.py
git commit -m "feat: stream pa capture blocks over tcp records"
```

## Task 4: Python Server Integration

**Files:**
- Modify: `/home/qian/Portable_System_Project/Butterfly_Laser_Driver/butterfly_laser_server.py`
- Modify: `/home/qian/Portable_System_Project/Butterfly_Laser_Driver/butterfly_laser_server_tauri.py`
- Modify: `/home/qian/Portable_System_Project/Butterfly_Laser_Driver/tests/test_tauri_server_defaults.py`

- [ ] **Step 1: Add failing parser/default tests**

Append this test method to `TauriServerDefaultsTests`:

```python
    def test_pa_parser_defaults_are_exposed_by_legacy_and_tauri_servers(self):
        legacy_args = legacy.build_parser().parse_args([])
        tauri_args = tauri_server.build_parser().parse_args([])

        self.assertEqual(legacy_args.pa_tcp_port, 9090)
        self.assertEqual(tauri_args.pa_tcp_port, 9090)
        self.assertEqual(legacy_args.pa_axi_base, "0xa0110000")
        self.assertEqual(legacy_args.pa_capture_dev, "/dev/axis_capture0")
```

- [ ] **Step 2: Run the parser test and verify it fails**

Run:

```bash
cd /home/qian/Portable_System_Project/Butterfly_Laser_Driver
python -m unittest tests.test_tauri_server_defaults.TauriServerDefaultsTests.test_pa_parser_defaults_are_exposed_by_legacy_and_tauri_servers -v
```

Expected: failure mentioning missing `pa_tcp_port`.

- [ ] **Step 3: Add PA manager construction and parser args**

Modify `butterfly_laser_server.py` imports:

```python
from pa_imaging_capture import (
    PAM_AXI_DEFAULT_BASE,
    PAM_AXI_MAP_SPAN,
    AxisCaptureDevice,
    ConnectedPaWriter,
    PaCaptureWorker,
    PamAxiController,
    PamCaptureParams,
)
```

Also add `AxiMap` to the existing `from butterfly_laser_control import (...)`
list:

```python
    AxiMap,
```

Add parser arguments inside `build_parser()`:

```python
    parser.add_argument("--pa-axi-base", default=hex(PAM_AXI_DEFAULT_BASE), help="PAM image acquisition AXI base address")
    parser.add_argument("--pa-axi-span", default=hex(PAM_AXI_MAP_SPAN), help="PAM image acquisition AXI map span")
    parser.add_argument("--pa-capture-dev", default="/dev/axis_capture0", help="AXIS capture device path")
    parser.add_argument("--pa-tcp-port", type=int, default=9090, help="PA imaging TCP stream port")
```

Add a minimal manager class near the server helper classes:

```python
class PaService:
    def __init__(self, pam_regs, capture_dev_path="/dev/axis_capture0"):
        self.pam_regs = pam_regs
        self.capture_dev_path = capture_dev_path
        self.lock = threading.RLock()
        self.writer = None
        self.worker = None
        self.thread = None
        self.last_status = {"connected": False, "running": False, "last_error": ""}

    def attach_socket(self, sock):
        with self.lock:
            if self.writer is not None:
                sock.close()
                raise RuntimeError("PA TCP client already connected")
            self.writer = ConnectedPaWriter(sock)
            self.last_status["connected"] = True

    def disconnect(self):
        with self.lock:
            if self.worker:
                self.worker.request_stop()
            if self.writer:
                self.writer.close_client()
                self.writer = None
            self.last_status["connected"] = False

    def start(self, params, max_blocks=-1, capture_time_sec=0):
        with self.lock:
            if self.writer is None:
                raise RuntimeError("PA TCP client is not connected")
            if self.thread and self.thread.is_alive():
                raise RuntimeError("PA capture already running")
            self.worker = PaCaptureWorker(
                PamAxiController(self.pam_regs),
                AxisCaptureDevice(self.capture_dev_path),
                self.writer,
            )
            self.last_status.update({"running": True, "last_error": ""})

            def target():
                try:
                    result = self.worker.run_once(params, max_blocks=max_blocks, capture_time_sec=capture_time_sec)
                    with self.lock:
                        self.last_status.update(result)
                except Exception as exc:
                    with self.lock:
                        self.last_status["last_error"] = str(exc)
                finally:
                    with self.lock:
                        self.last_status["running"] = False

            self.thread = threading.Thread(target=target, name="pa-capture-worker", daemon=True)
            self.thread.start()
            return self.status()

    def stop(self):
        with self.lock:
            if self.worker:
                self.worker.request_stop()
            return self.status()

    def status(self):
        with self.lock:
            status = dict(self.last_status)
            status["connected"] = self.writer is not None
            status["running"] = bool(self.thread and self.thread.is_alive())
            return status
```

In `main()`, after `system = ButterflyLaserSystem(...)`, map PA regs and attach
the service:

```python
    pa_regs = AxiMap(args.pa_axi_base, args.pa_axi_span)
```

Set server attributes after `httpd.settings_path = args.settings`:

```python
    httpd.pa_service = PaService(pa_regs, capture_dev_path=args.pa_capture_dev)
```

In `finally`, close the PA service and map before `system.close()`:

```python
        httpd.pa_service.disconnect()
        pa_regs.close()
```

- [ ] **Step 4: Add HTTP endpoints**

In `do_GET`, add `/api/pa/status` and include it in the root endpoint list:

```python
            elif parsed.path == "/api/pa/status":
                self.reply_json({"ok": True, "pa": self.server.pa_service.status()})
```

In `do_POST`, add:

```python
                elif parsed.path == "/api/pa/start":
                    params = PamCaptureParams.from_dict(body.get("params", body))
                    max_blocks = body_int(body, "max_blocks", -1)
                    capture_time_sec = float(body.get("capture_time_sec", 0.0))
                    pa_status = self.server.pa_service.start(params, max_blocks=max_blocks, capture_time_sec=capture_time_sec)
                    self.reply_json({"ok": True, "pa": pa_status})
                elif parsed.path == "/api/pa/stop":
                    self.reply_json({"ok": True, "pa": self.server.pa_service.stop()})
                elif parsed.path == "/api/pa/disconnect":
                    self.server.pa_service.disconnect()
                    self.reply_json({"ok": True, "pa": self.server.pa_service.status()})
```

Update `server_status(server)` to include:

```python
        "pa": server.pa_service.status() if hasattr(server, "pa_service") else {"connected": False, "running": False},
```

- [ ] **Step 5: Add TCP listener thread**

Add a small listener after `PaService`:

```python
class PaTcpListener:
    def __init__(self, host, port, service, stop_event):
        self.host = host
        self.port = int(port)
        self.service = service
        self.stop_event = stop_event
        self.thread = None
        self.sock = None

    def start(self):
        self.thread = threading.Thread(target=self._run, name="pa-tcp-listener", daemon=True)
        self.thread.start()

    def _run(self):
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        sock.bind((self.host, self.port))
        sock.listen(1)
        sock.settimeout(0.5)
        self.sock = sock
        while not self.stop_event.is_set():
            try:
                client, _addr = sock.accept()
            except socket.timeout:
                continue
            self.service.attach_socket(client)
        sock.close()

    def stop(self):
        self.stop_event.set()
        if self.sock:
            try:
                self.sock.close()
            except OSError:
                pass
```

Import `socket` at the top. In both server `main()` functions, create
`httpd.stop_event = threading.Event()` if it does not already exist, then:

```python
    httpd.pa_tcp_listener = PaTcpListener(args.host, args.pa_tcp_port, httpd.pa_service, httpd.stop_event)
    httpd.pa_tcp_listener.start()
```

Stop it in `finally`:

```python
        httpd.pa_tcp_listener.stop()
```

- [ ] **Step 6: Run Python tests**

Run:

```bash
cd /home/qian/Portable_System_Project/Butterfly_Laser_Driver
python -m unittest tests.test_tauri_server_defaults tests.test_pa_imaging_capture -v
```

Expected: all selected tests pass.

- [ ] **Step 7: Commit Task 4**

Run:

```bash
cd /home/qian/Portable_System_Project/Butterfly_Laser_Driver
git add butterfly_laser_server.py butterfly_laser_server_tauri.py tests/test_tauri_server_defaults.py
git commit -m "feat: expose pa imaging capture server controls"
```

## Task 5: Tauri Rust PA Receiver

**Files:**
- Create: `/home/qian/Portable_System_Project/Butterfly_Laser_Driver/tauri_control_console/src-tauri/src/pa_stream.rs`
- Modify: `/home/qian/Portable_System_Project/Butterfly_Laser_Driver/tauri_control_console/src-tauri/src/main.rs`

- [ ] **Step 1: Write Rust receiver module tests**

Create `pa_stream.rs` with tests first:

```rust
use std::path::PathBuf;

const STREAM_MAGIC: &[u8; 4] = b"PAI1";
const RECORD_HEADER_BYTES: usize = 68;

#[derive(Clone, Debug, Default, serde::Serialize)]
pub struct PaReceiverStatus {
    pub connected: bool,
    pub running: bool,
    pub output_path: Option<String>,
    pub bytes_received: u64,
    pub blocks_received: u64,
    pub frames_received: u64,
    pub last_error: String,
}

#[derive(Debug, PartialEq, Eq)]
struct RecordHeader {
    record_type: u16,
    payload_bytes: u64,
    sequence: u64,
    block_id: u64,
    frame_count: u32,
}

fn read_u16_le(buf: &[u8], offset: usize) -> u16 {
    u16::from_le_bytes([buf[offset], buf[offset + 1]])
}

fn read_u32_le(buf: &[u8], offset: usize) -> u32 {
    u32::from_le_bytes([buf[offset], buf[offset + 1], buf[offset + 2], buf[offset + 3]])
}

fn read_u64_le(buf: &[u8], offset: usize) -> u64 {
    u64::from_le_bytes([
        buf[offset],
        buf[offset + 1],
        buf[offset + 2],
        buf[offset + 3],
        buf[offset + 4],
        buf[offset + 5],
        buf[offset + 6],
        buf[offset + 7],
    ])
}

fn parse_record_header(buf: &[u8]) -> Result<RecordHeader, String> {
    if buf.len() != RECORD_HEADER_BYTES {
        return Err(format!("record header length {} != {}", buf.len(), RECORD_HEADER_BYTES));
    }
    if &buf[0..4] != STREAM_MAGIC {
        return Err("bad PA stream magic".to_string());
    }
    let version = read_u16_le(buf, 4);
    if version != 1 {
        return Err(format!("unsupported PA stream version {}", version));
    }
    let header_bytes = read_u32_le(buf, 8);
    if header_bytes as usize != RECORD_HEADER_BYTES {
        return Err(format!("record header bytes {} != {}", header_bytes, RECORD_HEADER_BYTES));
    }
    Ok(RecordHeader {
        record_type: read_u16_le(buf, 6),
        payload_bytes: read_u64_le(buf, 12),
        sequence: read_u64_le(buf, 20),
        block_id: read_u64_le(buf, 36),
        frame_count: read_u32_le(buf, 44),
    })
}

pub fn default_pa_output_path(run_name: Option<String>) -> Result<PathBuf, String> {
    let mut root = super::default_data_dir()?;
    root.push("PA Imaging");
    std::fs::create_dir_all(&root).map_err(|err| format!("create {} failed: {}", root.display(), err))?;
    let name = run_name
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "pa_capture".to_string());
    root.push(format!("{}.paibin", super::safe_component(&name, "pa_capture")));
    Ok(root)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_python_stream_header_layout() {
        let mut buf = vec![0u8; RECORD_HEADER_BYTES];
        buf[0..4].copy_from_slice(STREAM_MAGIC);
        buf[4..6].copy_from_slice(&1u16.to_le_bytes());
        buf[6..8].copy_from_slice(&2u16.to_le_bytes());
        buf[8..12].copy_from_slice(&(RECORD_HEADER_BYTES as u32).to_le_bytes());
        buf[12..20].copy_from_slice(&4u64.to_le_bytes());
        buf[20..28].copy_from_slice(&7u64.to_le_bytes());
        buf[36..44].copy_from_slice(&9u64.to_le_bytes());
        buf[44..48].copy_from_slice(&3u32.to_le_bytes());

        let header = parse_record_header(&buf).expect("header");

        assert_eq!(header.record_type, 2);
        assert_eq!(header.payload_bytes, 4);
        assert_eq!(header.sequence, 7);
        assert_eq!(header.block_id, 9);
        assert_eq!(header.frame_count, 3);
    }

    #[test]
    fn default_output_path_uses_pa_imaging_folder() {
        let path = default_pa_output_path(Some("run 1".to_string())).expect("path");

        assert!(path.ends_with("Data/PA Imaging/run_1.paibin"));
    }
}
```

- [ ] **Step 2: Run Rust tests and verify they compile-fail until main exposes helpers**

Run:

```bash
cd /home/qian/Portable_System_Project/Butterfly_Laser_Driver/tauri_control_console/src-tauri
cargo test pa_stream
```

Expected: compile failure because `default_data_dir` and `safe_component` are private to `main.rs`.

- [ ] **Step 3: Expose helpers and module from main**

At the top of `main.rs`, add:

```rust
mod pa_stream;
```

Change helper visibility:

```rust
pub(crate) fn default_data_dir() -> Result<PathBuf, String> {
```

```rust
pub(crate) fn safe_component(value: &str, fallback: &str) -> String {
```

- [ ] **Step 4: Implement receiver commands in `pa_stream.rs`**

Add real receiver state below the tests' helper code:

```rust
use std::{
    fs::File,
    io::{Read, Write},
    net::{Shutdown, TcpStream},
    sync::{Mutex, OnceLock},
    thread,
};

static RECEIVER: OnceLock<Mutex<PaReceiverStatus>> = OnceLock::new();

fn receiver_state() -> &'static Mutex<PaReceiverStatus> {
    RECEIVER.get_or_init(|| Mutex::new(PaReceiverStatus::default()))
}

pub fn pa_receiver_status() -> Result<PaReceiverStatus, String> {
    receiver_state()
        .lock()
        .map(|guard| guard.clone())
        .map_err(|_| "PA receiver status lock poisoned".to_string())
}

pub fn pa_connect_and_prepare(
    board_host: String,
    tcp_port: u16,
    output_path: Option<String>,
    run_name: Option<String>,
) -> Result<PaReceiverStatus, String> {
    let path = match output_path {
        Some(value) if !value.trim().is_empty() => PathBuf::from(value),
        _ => default_pa_output_path(run_name)?,
    };
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|err| format!("create {} failed: {}", parent.display(), err))?;
    }
    let stream = TcpStream::connect((board_host.as_str(), tcp_port))
        .map_err(|err| format!("connect {}:{} failed: {}", board_host, tcp_port, err))?;
    stream
        .set_nodelay(true)
        .map_err(|err| format!("set TCP_NODELAY failed: {}", err))?;
    {
        let mut status = receiver_state().lock().map_err(|_| "PA receiver status lock poisoned".to_string())?;
        *status = PaReceiverStatus {
            connected: true,
            running: true,
            output_path: Some(path.display().to_string()),
            bytes_received: 0,
            blocks_received: 0,
            frames_received: 0,
            last_error: String::new(),
        };
    }
    thread::spawn(move || {
        let result = receive_loop(stream, path);
        if let Ok(mut status) = receiver_state().lock() {
            status.running = false;
            status.connected = false;
            if let Err(err) = result {
                status.last_error = err;
            }
        }
    });
    pa_receiver_status()
}

fn receive_loop(mut stream: TcpStream, path: PathBuf) -> Result<(), String> {
    let mut file = File::create(&path).map_err(|err| format!("create {} failed: {}", path.display(), err))?;
    file.write_all(b"BFLY_PA_STREAM_FILE_V1\n")
        .map_err(|err| format!("write {} failed: {}", path.display(), err))?;
    loop {
        let mut header_buf = [0u8; RECORD_HEADER_BYTES];
        match stream.read_exact(&mut header_buf) {
            Ok(()) => {}
            Err(err) if err.kind() == std::io::ErrorKind::UnexpectedEof => return Ok(()),
            Err(err) => return Err(format!("read PA header failed: {}", err)),
        }
        let header = parse_record_header(&header_buf)?;
        file.write_all(&header_buf)
            .map_err(|err| format!("write PA header failed: {}", err))?;
        let mut payload = vec![0u8; header.payload_bytes as usize];
        stream
            .read_exact(&mut payload)
            .map_err(|err| format!("read PA payload failed: {}", err))?;
        file.write_all(&payload)
            .map_err(|err| format!("write PA payload failed: {}", err))?;
        if let Ok(mut status) = receiver_state().lock() {
            status.bytes_received += header.payload_bytes;
            if header.record_type == 2 {
                status.blocks_received += 1;
                status.frames_received += u64::from(header.frame_count);
            }
        }
        if header.record_type == 4 || header.record_type == 5 {
            return Ok(());
        }
    }
}

pub fn pa_receiver_stop() -> Result<PaReceiverStatus, String> {
    let mut status = receiver_state().lock().map_err(|_| "PA receiver status lock poisoned".to_string())?;
    status.running = false;
    status.connected = false;
    Ok(status.clone())
}
```

- [ ] **Step 5: Register Tauri commands**

In `main.rs`, add wrappers:

```rust
#[tauri::command]
fn pa_receiver_status() -> Result<pa_stream::PaReceiverStatus, String> {
    pa_stream::pa_receiver_status()
}

#[tauri::command]
fn pa_connect_and_prepare(
    board_host: String,
    tcp_port: u16,
    output_path: Option<String>,
    run_name: Option<String>,
) -> Result<pa_stream::PaReceiverStatus, String> {
    pa_stream::pa_connect_and_prepare(board_host, tcp_port, output_path, run_name)
}

#[tauri::command]
fn pa_receiver_stop() -> Result<pa_stream::PaReceiverStatus, String> {
    pa_stream::pa_receiver_stop()
}
```

Add them to `tauri::generate_handler!`.

- [ ] **Step 6: Run Rust tests**

Run:

```bash
cd /home/qian/Portable_System_Project/Butterfly_Laser_Driver/tauri_control_console/src-tauri
cargo test pa_stream
```

Expected: PA Rust tests pass.

- [ ] **Step 7: Commit Task 5**

Run:

```bash
cd /home/qian/Portable_System_Project/Butterfly_Laser_Driver
git add tauri_control_console/src-tauri/src/main.rs tauri_control_console/src-tauri/src/pa_stream.rs
git commit -m "feat: add tauri pa stream receiver"
```

## Task 6: React API And PA Panel

**Files:**
- Modify: `/home/qian/Portable_System_Project/Butterfly_Laser_Driver/tauri_control_console/src/api/types.ts`
- Modify: `/home/qian/Portable_System_Project/Butterfly_Laser_Driver/tauri_control_console/src/api/client.ts`
- Modify: `/home/qian/Portable_System_Project/Butterfly_Laser_Driver/tauri_control_console/src/App.tsx`
- Create: `/home/qian/Portable_System_Project/Butterfly_Laser_Driver/tauri_control_console/src/components/PaImagingPanel.tsx`
- Create: `/home/qian/Portable_System_Project/Butterfly_Laser_Driver/tauri_control_console/src/__tests__/paImaging.test.tsx`

- [ ] **Step 1: Write failing UI test**

Create `paImaging.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import PaImagingPanel from "../components/PaImagingPanel";

describe("PaImagingPanel", () => {
  it("renders PA controls and progress without data payloads", () => {
    const client = {
      paStart: vi.fn(),
      paStop: vi.fn(),
      paDisconnect: vi.fn(),
    };

    render(
      <PaImagingPanel
        backendUrl="http://192.168.8.236:8080"
        client={client}
        paStatus={{ connected: true, running: false, bytes_sent: 1024, blocks_sent: 2, frames_sent: 8 }}
        command={vi.fn()}
      />,
    );

    expect(screen.getByText("PA Imaging")).toBeTruthy();
    expect(screen.getByLabelText("X points")).toBeTruthy();
    expect(screen.getByLabelText("Y points")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Start" })).toBeTruthy();
    expect(screen.getByText("2")).toBeTruthy();
    expect(screen.getByText("8")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the UI test and verify it fails**

Run:

```bash
cd /home/qian/Portable_System_Project/Butterfly_Laser_Driver/tauri_control_console
npm test -- src/__tests__/paImaging.test.tsx
```

Expected: failure because `PaImagingPanel` does not exist.

- [ ] **Step 3: Add TypeScript types and API methods**

In `types.ts`, add:

```ts
export type PaStatus = {
  connected?: boolean;
  running?: boolean;
  blocks_sent?: number;
  frames_sent?: number;
  bytes_sent?: number;
  last_error?: string;
  end_reason?: string;
};

export type PaParams = {
  x_start: number;
  x_step: number;
  x_points: number;
  y_start: number;
  y_step: number;
  y_points: number;
  frame_number: number;
  task_id: number;
  gap_time: number;
  galvo_settle_time: number;
  ld_trigger_time: number;
  adc_trigger_time: number;
  ld_time: number;
  scan_mode: number;
};
```

Add `pa?: PaStatus;` to `SystemStatus`.

In `client.ts`, import `PaParams` and `PaStatus`, then add:

```ts
  paStatus(): Promise<{ ok: true; pa: PaStatus }> {
    return this.get("/api/pa/status");
  }

  paStart(params: PaParams, captureTimeSec = 0, maxBlocks = -1): Promise<{ ok: true; pa: PaStatus }> {
    return this.post("/api/pa/start", { params, capture_time_sec: captureTimeSec, max_blocks: maxBlocks });
  }

  paStop(): Promise<{ ok: true; pa: PaStatus }> {
    return this.post("/api/pa/stop");
  }

  paDisconnect(): Promise<{ ok: true; pa: PaStatus }> {
    return this.post("/api/pa/disconnect");
  }
```

- [ ] **Step 4: Create `PaImagingPanel.tsx`**

Use controlled inputs for the app's existing PAM keys:

```tsx
import { useMemo, useState } from "react";
import type { ApiClient } from "../api/client";
import type { PaParams, PaStatus } from "../api/types";

type Props = {
  backendUrl: string;
  client: Pick<ApiClient, "paStart" | "paStop" | "paDisconnect">;
  paStatus?: PaStatus | null;
  command: (label: string, action: () => Promise<unknown>) => Promise<void>;
};

const defaultParams: PaParams = {
  x_start: 0,
  x_step: 1,
  x_points: 1,
  y_start: 0,
  y_step: 1,
  y_points: 1,
  frame_number: 1,
  task_id: 1,
  gap_time: 1000,
  galvo_settle_time: 1000,
  ld_trigger_time: 0,
  adc_trigger_time: 100,
  ld_time: 100,
  scan_mode: 0,
};

function numberInput(value: number, setValue: (value: number) => void, label: string) {
  return (
    <label>
      <span>{label}</span>
      <input type="number" aria-label={label} value={value} onChange={(event) => setValue(Number(event.target.value))} />
    </label>
  );
}

export default function PaImagingPanel({ client, paStatus, command }: Props) {
  const [params, setParams] = useState<PaParams>(defaultParams);
  const [captureTimeSec, setCaptureTimeSec] = useState(0);
  const [maxBlocks, setMaxBlocks] = useState(-1);
  const status = paStatus || {};
  const update = (key: keyof PaParams, value: number) => setParams((current) => ({ ...current, [key]: value }));
  const bytesText = useMemo(() => `${Number(status.bytes_sent || 0)}`, [status.bytes_sent]);

  return (
    <section className="panel pa-panel">
      <h2>PA Imaging</h2>
      <div className="form-grid">
        {numberInput(params.x_start, (value) => update("x_start", value), "X start")}
        {numberInput(params.x_step, (value) => update("x_step", value), "X step")}
        {numberInput(params.x_points, (value) => update("x_points", value), "X points")}
        {numberInput(params.y_start, (value) => update("y_start", value), "Y start")}
        {numberInput(params.y_step, (value) => update("y_step", value), "Y step")}
        {numberInput(params.y_points, (value) => update("y_points", value), "Y points")}
        {numberInput(params.frame_number, (value) => update("frame_number", value), "Frame number")}
        {numberInput(params.task_id, (value) => update("task_id", value), "Task ID")}
        {numberInput(params.gap_time, (value) => update("gap_time", value), "Gap time")}
        {numberInput(params.galvo_settle_time, (value) => update("galvo_settle_time", value), "Galvo settle")}
        {numberInput(params.ld_trigger_time, (value) => update("ld_trigger_time", value), "LD trigger")}
        {numberInput(params.adc_trigger_time, (value) => update("adc_trigger_time", value), "ADC trigger")}
        {numberInput(params.ld_time, (value) => update("ld_time", value), "LD time")}
        {numberInput(params.scan_mode, (value) => update("scan_mode", value), "Scan mode")}
        {numberInput(captureTimeSec, setCaptureTimeSec, "Capture seconds")}
        {numberInput(maxBlocks, setMaxBlocks, "Max blocks")}
      </div>
      <div className="actions">
        <button onClick={() => command("PA start", () => client.paStart(params, captureTimeSec, maxBlocks))}>Start</button>
        <button onClick={() => command("PA stop", () => client.paStop())}>Stop</button>
        <button onClick={() => command("PA disconnect", () => client.paDisconnect())}>Disconnect</button>
      </div>
      <dl className="status-grid">
        <dt>Connected</dt>
        <dd>{status.connected ? "yes" : "no"}</dd>
        <dt>Running</dt>
        <dd>{status.running ? "yes" : "no"}</dd>
        <dt>Bytes</dt>
        <dd>{bytesText}</dd>
        <dt>Blocks</dt>
        <dd>{Number(status.blocks_sent || 0)}</dd>
        <dt>Frames</dt>
        <dd>{Number(status.frames_sent || 0)}</dd>
        <dt>Error</dt>
        <dd>{status.last_error || ""}</dd>
      </dl>
    </section>
  );
}
```

- [ ] **Step 5: Add PA tab to `App.tsx`**

Add import:

```tsx
import PaImagingPanel from "./components/PaImagingPanel";
```

Change tabs:

```tsx
const tabs = ["Overview", "TEC", "Laser", "Lock", "ADA", "PA", "Settings", "Debug"] as const;
```

Add a panel:

```tsx
        <div className={tabPanelClass("PA")} data-tab="PA" aria-hidden={tab !== "PA"}>
          <PaImagingPanel
            backendUrl={state.backendUrl}
            client={client}
            command={command}
            paStatus={state.lastStatus?.pa}
          />
        </div>
```

- [ ] **Step 6: Run UI tests**

Run:

```bash
cd /home/qian/Portable_System_Project/Butterfly_Laser_Driver/tauri_control_console
npm test -- src/__tests__/paImaging.test.tsx
```

Expected: PA imaging test passes.

- [ ] **Step 7: Commit Task 6**

Run:

```bash
cd /home/qian/Portable_System_Project/Butterfly_Laser_Driver
git add tauri_control_console/src/api/types.ts tauri_control_console/src/api/client.ts tauri_control_console/src/App.tsx tauri_control_console/src/components/PaImagingPanel.tsx tauri_control_console/src/__tests__/paImaging.test.tsx
git commit -m "feat: add pa imaging control panel"
```

## Task 7: Verification And Board Smoke Test

**Files:**
- Modify only if the verification steps expose a concrete defect in PA files.

- [ ] **Step 1: Run Python unit tests touched by PA work**

Run:

```bash
cd /home/qian/Portable_System_Project/Butterfly_Laser_Driver
python -m unittest tests.test_pa_imaging_capture tests.test_tauri_server_defaults -v
```

Expected: all selected Python tests pass.

- [ ] **Step 2: Run Tauri TypeScript tests**

Run:

```bash
cd /home/qian/Portable_System_Project/Butterfly_Laser_Driver/tauri_control_console
npm test -- src/__tests__/paImaging.test.tsx
```

Expected: PA UI test passes.

- [ ] **Step 3: Run Rust tests**

Run:

```bash
cd /home/qian/Portable_System_Project/Butterfly_Laser_Driver/tauri_control_console/src-tauri
cargo test pa_stream
```

Expected: PA stream Rust tests pass.

- [ ] **Step 4: Start server locally enough to check route registration**

Run on the board when hardware files are available:

```bash
cd /home/qian/Portable_System_Project/Butterfly_Laser_Driver
sudo python3 butterfly_laser_server_tauri.py --host 0.0.0.0 --port 8080 --pa-tcp-port 9090
```

Expected: log prints HTTP listener and PA TCP listener ports. `GET /api/pa/status`
returns JSON with `connected`, `running`, and counter fields.

- [ ] **Step 5: Start Tauri and connect receiver before capture**

Run on the upper computer:

```bash
cd /home/qian/Portable_System_Project/Butterfly_Laser_Driver/tauri_control_console
env -u PKG_CONFIG_PATH -u PKG_CONFIG_SYSROOT_DIR -u PKG_CONFIG_LIBDIR -u CC -u CXX -u AR -u AS -u LD -u STRIP -u RANLIB -u OBJCOPY -u OBJDUMP -u READELF -u CFLAGS -u CXXFLAGS -u LDFLAGS PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/home/qian/.local/nodejs/bin:/home/qian/.cargo/bin npm run tauri dev
```

Expected: the PA tab renders. The receiver connects to `192.168.8.236:9090`
before `/api/pa/start` is sent.

- [ ] **Step 6: Short hardware capture smoke test**

Use conservative parameters:

```text
x_points=1
y_points=1
frame_number=1
capture_time_sec=0
max_blocks=1
```

Expected: capture ends by `max_blocks`, the output file appears under
`Data/PA Imaging`, server `blocks_sent` is `1`, Tauri `blocks_received` is `1`,
and the file size is larger than `BFLY_PA_STREAM_FILE_V1` plus one PA record
header.

- [ ] **Step 7: Commit final verification notes if code changed during verification**

If Step 4-6 required a code fix, commit only the changed PA files:

```bash
cd /home/qian/Portable_System_Project/Butterfly_Laser_Driver
git status --short
git add pa_imaging_capture.py butterfly_laser_server.py butterfly_laser_server_tauri.py tauri_control_console/src-tauri/src/main.rs tauri_control_console/src-tauri/src/pa_stream.rs tauri_control_console/src/api/types.ts tauri_control_console/src/api/client.ts tauri_control_console/src/App.tsx tauri_control_console/src/components/PaImagingPanel.tsx tauri_control_console/src/__tests__/paImaging.test.tsx tests/test_pa_imaging_capture.py tests/test_tauri_server_defaults.py
git commit -m "fix: stabilize pa imaging tcp smoke test"
```

## Self-Review

- Spec coverage: hardware register flow, DMA start/stop/drain order, board TCP
  listener, Tauri receiver, progress display, and first-version no-realtime
  reconstruction are all mapped to tasks.
- No multi-client support is planned; the service rejects a second connected
  client.
- No kernel ABI change is planned; Python parses the existing superblock ABI.
- Type names used across Python, Rust, and TypeScript are consistent with the
  task snippets.
