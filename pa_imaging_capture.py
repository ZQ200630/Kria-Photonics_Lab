import array
import fcntl
import json
import os
import select
import socket
import struct
import threading
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


def now_ns():
    return time.monotonic_ns()


def _u16_bits(value):
    value = int(value)
    if value < -32768 or value > 0xFFFF:
        raise ValueError("16-bit register value out of range")
    return value & 0xFFFF


def _u16_positive(value):
    value = int(value)
    if value < 1 or value > 0xFFFF:
        raise ValueError("positive 16-bit register value out of range")
    return value


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
            PAM_REG_X_POINTS: _u16_positive(self.x_points),
            PAM_REG_Y_START: _u16_bits(self.y_start),
            PAM_REG_Y_STEP: _u16_bits(self.y_step),
            PAM_REG_Y_POINTS: _u16_positive(self.y_points),
            PAM_REG_FRAME_NUMBER: _u16_positive(self.frame_number),
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


class ConnectedPaWriter:
    def __init__(self, sock, send_timeout_s=5.0):
        self.sock = sock
        if send_timeout_s is not None:
            self.sock.settimeout(float(send_timeout_s))
        self._lock = threading.Lock()
        self._closed = False

    def send_record(self, record):
        encoded = record.encode()
        with self._lock:
            if self._closed:
                raise RuntimeError("PA writer client is closed")
        self.sock.sendall(encoded)

    def close_client(self):
        with self._lock:
            if self._closed:
                return
            self._closed = True
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
        if self.fd is None:
            self.fd = os.open(self.dev_path, os.O_RDONLY)

    def close(self):
        if self.fd is None:
            return
        fd = self.fd
        self.fd = None
        os.close(fd)

    def _require_fd(self):
        if self.fd is None:
            raise RuntimeError("axis capture device is not open")
        return self.fd

    def get_status(self):
        fd = self._require_fd()
        buf = array.array("B", b"\x00" * AXIS_STATUS_BYTES)
        fcntl.ioctl(fd, AXIS_CAP_IOC_GET_STATUS, buf, True)
        return AxisCaptureStatus.unpack(buf.tobytes())

    def start(self):
        fcntl.ioctl(self._require_fd(), AXIS_CAP_IOC_START)

    def stop(self):
        fcntl.ioctl(self._require_fd(), AXIS_CAP_IOC_STOP)

    def read_block(self, timeout=0.5):
        fd = self._require_fd()
        read_events = select.POLLIN | getattr(select, "POLLRDNORM", 0) | select.POLLHUP
        poller = select.poll()
        poller.register(fd, read_events | select.POLLERR)

        timeout_ms = None if timeout is None else max(0, int(timeout * 1000))
        events = poller.poll(timeout_ms)
        if not events:
            return AXIS_READ_TIMEOUT

        revents = 0
        for event_fd, event_mask in events:
            if event_fd == fd:
                revents |= event_mask

        if revents & select.POLLERR:
            raise RuntimeError("axis capture poll error")
        if not (revents & read_events):
            return AXIS_READ_TIMEOUT

        status = self.get_status()
        expected_bytes = AXIS_BLOCK_HEADER_BYTES + status.superblock_bytes
        raw = os.read(fd, expected_bytes)
        if not raw:
            return None
        if len(raw) < AXIS_BLOCK_HEADER_BYTES:
            raise RuntimeError("axis capture short block header")

        header = AxisBlockHeader.unpack(raw[:AXIS_BLOCK_HEADER_BYTES])
        if header.used_bytes > status.superblock_bytes:
            raise RuntimeError(
                f"axis capture block payload size mismatch: used {header.used_bytes}, superblock {status.superblock_bytes}"
            )
        actual_bytes = AXIS_BLOCK_HEADER_BYTES + header.used_bytes
        if len(raw) != actual_bytes:
            raise RuntimeError(f"axis capture block size mismatch: expected {actual_bytes}, got {len(raw)}")
        payload = raw[AXIS_BLOCK_HEADER_BYTES:]
        return header, payload


class PaCaptureWorker:
    def __init__(self, pam, device, writer, drain_idle_timeout_s=2.0, drain_total_timeout_s=10.0):
        self.pam = pam
        self.device = device
        self.writer = writer
        self.drain_idle_timeout_s = drain_idle_timeout_s
        self.drain_total_timeout_s = drain_total_timeout_s
        self._stop_event = threading.Event()
        self._writer_failed = False
        self.sequence = 0
        self.stats = self._new_stats()

    def _new_stats(self):
        return {
            "running": False,
            "blocks_sent": 0,
            "frames_sent": 0,
            "bytes_sent": 0,
            "last_error": "",
            "end_reason": "",
        }

    def request_stop(self):
        self._stop_event.set()

    def _next_sequence(self):
        sequence = self.sequence
        self.sequence += 1
        return sequence

    def _send_json_record(self, record_type, payload):
        try:
            self.writer.send_record(json_record(record_type, self._next_sequence(), now_ns(), payload))
        except Exception:
            self._writer_failed = True
            raise

    def _send_data_record(self, header, payload):
        try:
            self.writer.send_record(
                PaStreamRecord(
                    record_type=RECORD_TYPE_DATA,
                    sequence=self._next_sequence(),
                    timestamp_ns=now_ns(),
                    block_id=header.block_id,
                    frame_count=header.frame_count,
                    first_frame_id=header.first_frame_id,
                    last_frame_id=header.last_frame_id,
                    payload=payload,
                )
            )
        except Exception:
            self._writer_failed = True
            raise
        self.stats["blocks_sent"] += 1
        self.stats["frames_sent"] += header.frame_count
        self.stats["bytes_sent"] += len(payload)

    def _drain_until_eof(self):
        drain_start_ns = now_ns()
        idle_start_ns = now_ns()
        drain_send_error = None
        while True:
            item = self.device.read_block(timeout=0.1)
            if item is AXIS_READ_TIMEOUT:
                status = self.device.get_status()
                if status.draining_done and status.ready_block_count == 0:
                    if drain_send_error is not None:
                        raise drain_send_error
                    return
                if self.drain_total_timeout_s is not None:
                    elapsed_ns = now_ns() - drain_start_ns
                    if elapsed_ns >= int(float(self.drain_total_timeout_s) * 1_000_000_000):
                        raise RuntimeError("axis capture drain total timeout")
                if self.drain_idle_timeout_s is not None:
                    elapsed_ns = now_ns() - idle_start_ns
                    if elapsed_ns >= int(float(self.drain_idle_timeout_s) * 1_000_000_000):
                        raise RuntimeError("axis capture drain timed out")
                continue
            if item is None:
                if drain_send_error is not None:
                    raise drain_send_error
                return
            header, payload = item
            if not self._writer_failed:
                try:
                    self._send_data_record(header, payload)
                except Exception as exc:
                    if drain_send_error is None:
                        drain_send_error = exc
            if self.drain_total_timeout_s is not None:
                elapsed_ns = now_ns() - drain_start_ns
                if elapsed_ns >= int(float(self.drain_total_timeout_s) * 1_000_000_000):
                    raise RuntimeError("axis capture drain total timeout")
            idle_start_ns = now_ns()

    def run_once(self, params, max_blocks=-1, capture_time_sec=0):
        self.sequence = 0
        self._writer_failed = False
        self.stats = self._new_stats()
        self.stats["running"] = True
        pam_started = False
        dma_started = False
        device_opened = False
        start_ns = now_ns()

        def stop_capture(best_effort=False):
            nonlocal pam_started, dma_started
            errors = []
            if pam_started:
                try:
                    self.pam.write_start(0)
                except Exception as exc:
                    errors.append(exc)
                else:
                    pam_started = False
            if dma_started:
                stop_succeeded = False
                try:
                    self.device.stop()
                    stop_succeeded = True
                except Exception as exc:
                    errors.append(exc)
                if stop_succeeded:
                    dma_started = False
                    try:
                        self._drain_until_eof()
                    except Exception as exc:
                        errors.append(exc)
            if errors and not best_effort:
                raise errors[0]
            return errors

        try:
            self.pam.program(params)
            self.device.open()
            device_opened = True
            status = self.device.get_status()
            self._send_json_record(
                RECORD_TYPE_METADATA,
                {
                    "params": params.to_dict(),
                    "status": status.to_dict(),
                    "start_ns": start_ns,
                },
            )

            if self._stop_event.is_set():
                self.stats["end_reason"] = "stop_requested"
                stop_capture()
                self.stats["running"] = False
                self._send_json_record(RECORD_TYPE_END, dict(self.stats))
                return dict(self.stats)

            self.device.start()
            dma_started = True

            if self._stop_event.is_set():
                self.stats["end_reason"] = "stop_requested"
                stop_capture()
                self.stats["running"] = False
                self._send_json_record(RECORD_TYPE_END, dict(self.stats))
                return dict(self.stats)

            pam_started = True
            self.pam.write_start(1)

            while not self._stop_event.is_set():
                if max_blocks >= 0 and self.stats["blocks_sent"] >= max_blocks:
                    self.stats["end_reason"] = "max_blocks"
                    break
                if capture_time_sec > 0 and (now_ns() - start_ns) >= int(capture_time_sec * 1_000_000_000):
                    self.stats["end_reason"] = "capture_time"
                    break

                item = self.device.read_block(timeout=0.5)
                if item is AXIS_READ_TIMEOUT:
                    continue
                if item is None:
                    self.stats["end_reason"] = "eof"
                    break

                header, payload = item
                self._send_data_record(header, payload)

            if self._stop_event.is_set() and not self.stats["end_reason"]:
                self.stats["end_reason"] = "stop_requested"
            if not self.stats["end_reason"]:
                self.stats["end_reason"] = "complete"

            stop_capture()
            self.stats["running"] = False
            self._send_json_record(RECORD_TYPE_END, dict(self.stats))
            return dict(self.stats)
        except Exception as exc:
            self.stats["last_error"] = str(exc)
            self.stats["end_reason"] = "error"
            for stop_exc in stop_capture(best_effort=True):
                if self.stats["last_error"]:
                    self.stats["last_error"] += f"; stop failed: {stop_exc}"
                else:
                    self.stats["last_error"] = f"stop failed: {stop_exc}"
            self.stats["running"] = False
            try:
                self._send_json_record(RECORD_TYPE_ERROR, dict(self.stats))
            except Exception:
                pass
            raise
        finally:
            self.stats["running"] = False
            if pam_started:
                try:
                    self.pam.write_start(0)
                except Exception:
                    pass
            if dma_started:
                try:
                    self.device.stop()
                    dma_started = False
                    writer_failed = self._writer_failed
                    self._writer_failed = True
                    try:
                        self._drain_until_eof()
                    finally:
                        self._writer_failed = writer_failed
                except Exception:
                    pass
            if device_opened:
                try:
                    self.device.close()
                except Exception:
                    pass
