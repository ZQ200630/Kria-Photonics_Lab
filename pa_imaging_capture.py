import array
import errno
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
PAM_REG_RETURN_MODE = 0x3C
PAM_REG_DBG_STATUS = 0x80
PAM_REG_DBG_FAULT_CODE = 0x84
PAM_REG_DBG_CONTROL = 0x88
PAM_REG_DBG_ACCEPTED_TRIGGER_COUNT = 0x8C
PAM_REG_DBG_REJECTED_TRIGGER_BUSY_COUNT = 0x90
PAM_REG_DBG_BUSY_HOLD_EVENTS = 0x94
PAM_REG_DBG_BUSY_HOLD_CYCLES = 0x98
PAM_REG_DBG_BUSY_HOLD_MAX_CYCLES = 0x9C
PAM_REG_DBG_AXIS_TREADY_LOW_CYCLES = 0xA0
PAM_REG_DBG_AXIS_STALL_EVENTS = 0xA4
PAM_REG_DBG_AXIS_STALL_MAX_CYCLES = 0xA8
PAM_REG_DBG_FIFO_OVERFLOW_COUNT = 0xAC
PAM_REG_DBG_CAPTURE_DONE_COUNT = 0xB0
PAM_REG_DBG_TX_DONE_COUNT = 0xB4
PAM_REG_SCHED_MODE = 0x40
PAM_REG_SCHED_COMMAND = 0x44
PAM_REG_SCHED_CONTROL = 0x48
PAM_REG_SCHED_PERIOD_CYCLES = 0x4C
PAM_REG_MANUAL_X = 0x50
PAM_REG_MANUAL_Y = 0x54
PAM_REG_SHOT_LIMIT = 0x58
PAM_REG_PULSE_PHASE_CYCLES = 0x5C
PAM_REG_MANUAL_LD_DELAY_CYCLES = 0x60
PAM_REG_MANUAL_LD_WIDTH_CYCLES = 0x64
PAM_REG_MANUAL_ADC_DELAY_CYCLES = 0x68
PAM_REG_MANUAL_ADC_WIDTH_CYCLES = 0x6C
PAM_REG_WAVEFORM_CONTROL = 0x70
PAM_REG_WAVEFORM_X_RANGE = 0x74
PAM_REG_WAVEFORM_Y_RANGE = 0x78
PAM_REG_WAVEFORM_STEP_XY = 0x7C
PAM_REG_SCHED_VERSION = 0xB8
PAM_REG_SCHED_STATE = 0xBC
PAM_REG_SCHED_CURRENT_XY = 0xC0
PAM_REG_SCHED_CURRENT_INDEX_XY = 0xC4
PAM_REG_SCHED_CURRENT_FRAME = 0xC8
PAM_REG_SCHED_SHOT_COUNT = 0xCC
PAM_REG_SCHED_CAPTURE_COUNT = 0xD0
PAM_REG_SCHED_PIXEL_COUNT = 0xD4
PAM_REG_SCHED_COMMAND_COUNT = 0xD8
PAM_REG_SCHED_LAST_COMMAND = 0xDC
PAM_REG_SCHED_STOP_COUNT = 0xE0
PAM_REG_SCHED_PARK_COUNT = 0xE4
PAM_REG_SCHED_MANUAL_UPDATE_COUNT = 0xE8
PAM_REG_SCHED_WAVEFORM_CYCLE_COUNT = 0xEC
PAM_REG_SCHED_FAULT_DETAIL = 0xF0
PAM_REG_SCHED_CONTROL_SNAPSHOT = 0xF4
PAM_REG_SCHED_PERIOD_ACTIVE = 0xF8

PAM_SCHED_MODE_IDLE = 0
PAM_SCHED_MODE_AUTO_SCAN_CAPTURE = 1
PAM_SCHED_MODE_CONTINUOUS_POINT_CAPTURE = 2
PAM_SCHED_MODE_MANUAL_GALVO_HOLD = 3
PAM_SCHED_MODE_MANUAL_PULSE_NO_CAPTURE = 4
PAM_SCHED_MODE_GALVO_WAVEFORM_NO_CAPTURE = 5
PAM_SCHED_MODE_GALVO_WAVEFORM_CAPTURE = 6

PAM_SCHED_CMD_START = 1 << 0
PAM_SCHED_CMD_STOP = 1 << 1
PAM_SCHED_CMD_ABORT_AND_PARK = 1 << 2
PAM_SCHED_CMD_CLEAR_FAULT = 1 << 3
PAM_SCHED_CMD_APPLY_MANUAL = 1 << 4
PAM_SCHED_CMD_SINGLE_PULSE = 1 << 5
PAM_SCHED_CMD_SOFT_RESET_FSM = 1 << 6
PAM_SCHED_CMD_ALLOWED_MASK = (
    PAM_SCHED_CMD_START
    | PAM_SCHED_CMD_STOP
    | PAM_SCHED_CMD_ABORT_AND_PARK
    | PAM_SCHED_CMD_CLEAR_FAULT
    | PAM_SCHED_CMD_APPLY_MANUAL
    | PAM_SCHED_CMD_SINGLE_PULSE
    | PAM_SCHED_CMD_SOFT_RESET_FSM
)

PAM_SCHED_CTRL_LD_ENABLE = 1 << 0
PAM_SCHED_CTRL_ADC_ENABLE = 1 << 1
PAM_SCHED_CTRL_CAPTURE_ENABLE = 1 << 2
PAM_SCHED_CTRL_RESPECT_DOWNSTREAM_BUSY = 1 << 3
PAM_SCHED_CTRL_LOOP_ENABLE = 1 << 4
PAM_SCHED_CTRL_MANUAL_LIVE_UPDATE = 1 << 5
PAM_SCHED_CTRL_PARK_MODE_MASK = 0x300
PAM_SCHED_CTRL_ALLOWED_MASK = (
    PAM_SCHED_CTRL_LD_ENABLE
    | PAM_SCHED_CTRL_ADC_ENABLE
    | PAM_SCHED_CTRL_CAPTURE_ENABLE
    | PAM_SCHED_CTRL_RESPECT_DOWNSTREAM_BUSY
    | PAM_SCHED_CTRL_LOOP_ENABLE
    | PAM_SCHED_CTRL_MANUAL_LIVE_UPDATE
    | PAM_SCHED_CTRL_PARK_MODE_MASK
)
PAM_SCHED_MODE_MAX = PAM_SCHED_MODE_GALVO_WAVEFORM_CAPTURE
PAM_WAVEFORM_CONTROL_ALLOWED_MASK = 0x7FF

PAM_SCHED_STATE_ACTIVE = 1 << 8
PAM_SCHED_STATE_CAPTURE_REQUIRED = 1 << 9
PAM_SCHED_STATE_CAPTURE_ENABLED = 1 << 10
PAM_SCHED_STATE_RUNNING_WITHOUT_CAPTURE = 1 << 11
PAM_SCHED_STATE_PARKED = 1 << 12
PAM_SCHED_STATE_STOP_PENDING = 1 << 13
PAM_SCHED_STATE_ABORT_OBSERVED = 1 << 14
PAM_SCHED_STATE_FAULT_LATCHED = 1 << 15

PAM_SCHED_MODE_NAMES = {
    PAM_SCHED_MODE_IDLE: "idle",
    PAM_SCHED_MODE_AUTO_SCAN_CAPTURE: "auto_scan_capture",
    PAM_SCHED_MODE_CONTINUOUS_POINT_CAPTURE: "continuous_point_capture",
    PAM_SCHED_MODE_MANUAL_GALVO_HOLD: "manual_galvo_hold",
    PAM_SCHED_MODE_MANUAL_PULSE_NO_CAPTURE: "manual_pulse_no_capture",
    PAM_SCHED_MODE_GALVO_WAVEFORM_NO_CAPTURE: "galvo_waveform_no_capture",
    PAM_SCHED_MODE_GALVO_WAVEFORM_CAPTURE: "galvo_waveform_capture",
}

PAM_DEBUG_COUNTER_REGS = (
    ("status", PAM_REG_DBG_STATUS),
    ("fault_code", PAM_REG_DBG_FAULT_CODE),
    ("accepted_trigger_count", PAM_REG_DBG_ACCEPTED_TRIGGER_COUNT),
    ("rejected_trigger_busy_count", PAM_REG_DBG_REJECTED_TRIGGER_BUSY_COUNT),
    ("busy_hold_events", PAM_REG_DBG_BUSY_HOLD_EVENTS),
    ("busy_hold_cycles", PAM_REG_DBG_BUSY_HOLD_CYCLES),
    ("busy_hold_max_cycles", PAM_REG_DBG_BUSY_HOLD_MAX_CYCLES),
    ("axis_tready_low_cycles", PAM_REG_DBG_AXIS_TREADY_LOW_CYCLES),
    ("axis_stall_events", PAM_REG_DBG_AXIS_STALL_EVENTS),
    ("axis_stall_max_cycles", PAM_REG_DBG_AXIS_STALL_MAX_CYCLES),
    ("fifo_overflow_count", PAM_REG_DBG_FIFO_OVERFLOW_COUNT),
    ("capture_done_count", PAM_REG_DBG_CAPTURE_DONE_COUNT),
    ("tx_done_count", PAM_REG_DBG_TX_DONE_COUNT),
)

PAM_SCHED_STATUS_REGS = (
    ("sched_version", PAM_REG_SCHED_VERSION),
    ("sched_state", PAM_REG_SCHED_STATE),
    ("sched_current_xy", PAM_REG_SCHED_CURRENT_XY),
    ("sched_current_index_xy", PAM_REG_SCHED_CURRENT_INDEX_XY),
    ("sched_current_frame", PAM_REG_SCHED_CURRENT_FRAME),
    ("sched_shot_count", PAM_REG_SCHED_SHOT_COUNT),
    ("sched_capture_count", PAM_REG_SCHED_CAPTURE_COUNT),
    ("sched_pixel_count", PAM_REG_SCHED_PIXEL_COUNT),
    ("sched_command_count", PAM_REG_SCHED_COMMAND_COUNT),
    ("sched_last_command", PAM_REG_SCHED_LAST_COMMAND),
    ("sched_stop_count", PAM_REG_SCHED_STOP_COUNT),
    ("sched_park_count", PAM_REG_SCHED_PARK_COUNT),
    ("sched_manual_update_count", PAM_REG_SCHED_MANUAL_UPDATE_COUNT),
    ("sched_waveform_cycle_count", PAM_REG_SCHED_WAVEFORM_CYCLE_COUNT),
    ("sched_fault_detail", PAM_REG_SCHED_FAULT_DETAIL),
    ("sched_control_snapshot", PAM_REG_SCHED_CONTROL_SNAPSHOT),
    ("sched_period_active", PAM_REG_SCHED_PERIOD_ACTIVE),
)

PAM_SCHED_REGISTER_ORDER = (
    PAM_REG_SCHED_MODE,
    PAM_REG_SCHED_CONTROL,
    PAM_REG_SCHED_PERIOD_CYCLES,
    PAM_REG_MANUAL_X,
    PAM_REG_MANUAL_Y,
    PAM_REG_SHOT_LIMIT,
    PAM_REG_PULSE_PHASE_CYCLES,
    PAM_REG_MANUAL_LD_DELAY_CYCLES,
    PAM_REG_MANUAL_LD_WIDTH_CYCLES,
    PAM_REG_MANUAL_ADC_DELAY_CYCLES,
    PAM_REG_MANUAL_ADC_WIDTH_CYCLES,
    PAM_REG_WAVEFORM_CONTROL,
    PAM_REG_WAVEFORM_X_RANGE,
    PAM_REG_WAVEFORM_Y_RANGE,
    PAM_REG_WAVEFORM_STEP_XY,
)

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
    PAM_REG_RETURN_MODE,
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
AXIS_CAP_IOC_GET_STATUS_V2_NR = 0x04

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
AXIS_STATUS_V2_FORMAT = "<28I"
AXIS_STATUS_V2_BYTES = struct.calcsize(AXIS_STATUS_V2_FORMAT)
AXIS_BLOCK_HEADER_FORMAT = "<QIIQQ"
AXIS_BLOCK_HEADER_BYTES = struct.calcsize(AXIS_BLOCK_HEADER_FORMAT)
AXIS_FRAME_HEADER_FORMAT = "<QII"
AXIS_FRAME_HEADER_BYTES = struct.calcsize(AXIS_FRAME_HEADER_FORMAT)
PA_METADATA_BYTES = 32
PA_META_MAGIC = 0x4D455441
AXIS_READ_TIMEOUT = object()
MAX_DIAGNOSTIC_ISSUES = 32
PAM_TIMING_CLOCK_HZ = 100_000_000
NS_PER_SECOND = 1_000_000_000


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
AXIS_CAP_IOC_GET_STATUS_V2 = _ioc(IOC_READ, AXIS_CAP_IOC_MAGIC, AXIS_CAP_IOC_GET_STATUS_V2_NR, AXIS_STATUS_V2_BYTES)


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
    submit_count: int = 0
    callback_count: int = 0
    rearm_count: int = 0
    done_q_high_watermark: int = 0
    ready_block_high_watermark: int = 0
    free_block_low_watermark: int = 0
    active_dma_low_watermark: int = 0
    active_dma_zero_events: int = 0
    done_q_overflow_count: int = 0
    aggregate_fail_count: int = 0
    rearm_fail_count: int = 0
    abort_count: int = 0
    copy_to_user_fault_count: int = 0

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

    @classmethod
    def unpack_v2(cls, raw):
        fields = struct.unpack(AXIS_STATUS_V2_FORMAT, raw[:AXIS_STATUS_V2_BYTES])
        base = cls.unpack(raw[:AXIS_STATUS_BYTES])
        return cls(
            running=base.running,
            stop_requested=base.stop_requested,
            removing=base.removing,
            frame_bytes=base.frame_bytes,
            superblock_bytes=base.superblock_bytes,
            active_dma_count=base.active_dma_count,
            done_count=base.done_count,
            ready_block_count=base.ready_block_count,
            free_block_count=base.free_block_count,
            completed_frames=base.completed_frames,
            aggregated_frames=base.aggregated_frames,
            completed_blocks=base.completed_blocks,
            dropped_frames=base.dropped_frames,
            dropped_blocks=base.dropped_blocks,
            draining_done=base.draining_done,
            submit_count=fields[15],
            callback_count=fields[16],
            rearm_count=fields[17],
            done_q_high_watermark=fields[18],
            ready_block_high_watermark=fields[19],
            free_block_low_watermark=fields[20],
            active_dma_low_watermark=fields[21],
            active_dma_zero_events=fields[22],
            done_q_overflow_count=fields[23],
            aggregate_fail_count=fields[24],
            rearm_fail_count=fields[25],
            abort_count=fields[26],
            copy_to_user_fault_count=fields[27],
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


class PaCaptureDiagnostics:
    def __init__(self):
        self.blocks_checked = 0
        self.frames_checked = 0
        self.metadata_frames_checked = 0
        self.block_id_gaps = 0
        self.frame_id_gaps = 0
        self.global_shot_gaps = 0
        self.frame_count_mismatches = 0
        self.malformed_blocks = 0
        self.malformed_frames = 0
        self.metadata_parse_errors = 0
        self.first_block_id = None
        self.last_block_id = None
        self.first_frame_id = None
        self.last_frame_id = None
        self.first_global_shot_idx = None
        self.last_global_shot_idx = None
        self.issues = []

    @classmethod
    def empty_snapshot(cls):
        return cls().snapshot()

    def snapshot(self):
        return {
            "blocks_checked": self.blocks_checked,
            "frames_checked": self.frames_checked,
            "metadata_frames_checked": self.metadata_frames_checked,
            "block_id_gaps": self.block_id_gaps,
            "frame_id_gaps": self.frame_id_gaps,
            "global_shot_gaps": self.global_shot_gaps,
            "frame_count_mismatches": self.frame_count_mismatches,
            "malformed_blocks": self.malformed_blocks,
            "malformed_frames": self.malformed_frames,
            "metadata_parse_errors": self.metadata_parse_errors,
            "first_block_id": self.first_block_id,
            "last_block_id": self.last_block_id,
            "first_frame_id": self.first_frame_id,
            "last_frame_id": self.last_frame_id,
            "first_global_shot_idx": self.first_global_shot_idx,
            "last_global_shot_idx": self.last_global_shot_idx,
            "issues": list(self.issues),
        }

    def _push_issue(self, message, block_id=None, frame_id=None):
        if len(self.issues) >= MAX_DIAGNOSTIC_ISSUES:
            return
        self.issues.append({
            "message": message,
            "block_id": block_id,
            "frame_id": frame_id,
        })

    def _check_block_header(self, header):
        if self.first_block_id is None:
            self.first_block_id = header.block_id
        elif self.last_block_id is not None and header.block_id != self.last_block_id + 1:
            self.block_id_gaps += 1
            self._push_issue(
                f"block_id gap: expected {self.last_block_id + 1}, got {header.block_id}",
                block_id=header.block_id,
            )

        if header.frame_count > 0:
            expected_last = header.first_frame_id + header.frame_count - 1
            if header.last_frame_id != expected_last:
                self.frame_count_mismatches += 1
                self._push_issue(
                    f"block {header.block_id} frame range/count mismatch: "
                    f"{header.first_frame_id}..{header.last_frame_id} for {header.frame_count} frames",
                    block_id=header.block_id,
                )

        self.last_block_id = header.block_id

    def _read_global_shot_idx(self, payload, frame_payload_offset, data_bytes, block_id, frame_id):
        if data_bytes < PA_METADATA_BYTES:
            self.metadata_parse_errors += 1
            self._push_issue(
                f"frame {frame_id} payload shorter than metadata",
                block_id=block_id,
                frame_id=frame_id,
            )
            return None
        try:
            magic = struct.unpack_from("<I", payload, frame_payload_offset + 28)[0]
            if magic != PA_META_MAGIC:
                raise ValueError(f"invalid metadata magic 0x{magic:08X}")
            return struct.unpack_from("<I", payload, frame_payload_offset + 4)[0]
        except Exception as exc:
            self.metadata_parse_errors += 1
            self._push_issue(
                f"frame {frame_id} metadata parse failed: {exc}",
                block_id=block_id,
                frame_id=frame_id,
            )
            return None

    def check_block(self, header, payload):
        self.blocks_checked += 1
        self._check_block_header(header)

        offset = 0
        parsed_frames = 0
        payload_len = len(payload)
        for frame_index in range(header.frame_count):
            if payload_len - offset < AXIS_FRAME_HEADER_BYTES:
                self.malformed_blocks += 1
                self._push_issue(
                    f"block {header.block_id} ended before frame {frame_index} header",
                    block_id=header.block_id,
                )
                break

            frame_id, data_bytes, reserved = struct.unpack_from(AXIS_FRAME_HEADER_FORMAT, payload, offset)
            offset += AXIS_FRAME_HEADER_BYTES
            if frame_index == 0 and frame_id != header.first_frame_id:
                self.frame_count_mismatches += 1
                self._push_issue(
                    f"block {header.block_id} first payload frame_id {frame_id} "
                    f"does not match header {header.first_frame_id}",
                    block_id=header.block_id,
                    frame_id=frame_id,
                )
            if frame_index == header.frame_count - 1 and frame_id != header.last_frame_id:
                self.frame_count_mismatches += 1
                self._push_issue(
                    f"block {header.block_id} last payload frame_id {frame_id} "
                    f"does not match header {header.last_frame_id}",
                    block_id=header.block_id,
                    frame_id=frame_id,
                )
            if reserved != 0:
                self.malformed_frames += 1
                self._push_issue(
                    f"frame {frame_id} reserved header field is non-zero",
                    block_id=header.block_id,
                    frame_id=frame_id,
                )
            if data_bytes > payload_len - offset:
                self.malformed_blocks += 1
                self._push_issue(
                    f"frame {frame_id} payload exceeds block payload",
                    block_id=header.block_id,
                    frame_id=frame_id,
                )
                break

            if self.last_frame_id is not None and frame_id != self.last_frame_id + 1:
                self.frame_id_gaps += 1
                self._push_issue(
                    f"frame_id gap: expected {self.last_frame_id + 1}, got {frame_id}",
                    block_id=header.block_id,
                    frame_id=frame_id,
                )
            if self.first_frame_id is None:
                self.first_frame_id = frame_id
            self.last_frame_id = frame_id

            global_shot_idx = self._read_global_shot_idx(
                payload,
                offset,
                data_bytes,
                header.block_id,
                frame_id,
            )
            if global_shot_idx is not None:
                self.metadata_frames_checked += 1
                if self.first_global_shot_idx is None:
                    self.first_global_shot_idx = global_shot_idx
                elif self.last_global_shot_idx is not None and global_shot_idx != self.last_global_shot_idx + 1:
                    self.global_shot_gaps += 1
                    self._push_issue(
                        f"global_shot_idx gap: expected {self.last_global_shot_idx + 1}, "
                        f"got {global_shot_idx}",
                        block_id=header.block_id,
                        frame_id=frame_id,
                    )
                self.last_global_shot_idx = global_shot_idx

            offset += data_bytes
            parsed_frames += 1

        self.frames_checked += parsed_frames
        if parsed_frames != header.frame_count:
            self.frame_count_mismatches += 1
            self._push_issue(
                f"block {header.block_id} parsed {parsed_frames} of {header.frame_count} frames",
                block_id=header.block_id,
            )
        if offset != payload_len:
            self.malformed_blocks += 1
            self._push_issue(
                f"block {header.block_id} has {payload_len - offset} trailing payload bytes",
                block_id=header.block_id,
            )


def now_ns():
    return time.monotonic_ns()


def _u16_bits(value):
    value = int(value)
    if value < -32768 or value > 0xFFFF:
        raise ValueError("16-bit register value out of range")
    return value & 0xFFFF


def _s16_bits(value):
    value = int(value)
    if value < -32768 or value > 32767:
        raise ValueError("signed 16-bit register value out of range")
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


def _u32_zero_to_one(value):
    value = _u32(value)
    return max(1, value)


def _s16(value):
    value = int(value) & 0xFFFF
    return value - 0x10000 if value & 0x8000 else value


def _pack_s16_pair(low, high):
    return _s16_bits(low) | (_s16_bits(high) << 16)


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
    return_mode: int = 0

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
            return_mode=int(body.get("return_mode", 0)),
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
            PAM_REG_RETURN_MODE: _u32(self.return_mode),
        }

    def to_dict(self):
        return asdict(self)


@dataclass(frozen=True)
class PamSchedulerConfig:
    mode: int = PAM_SCHED_MODE_IDLE
    control: int = 0
    period_cycles: int = 1
    manual_x: int = 0
    manual_y: int = 0
    shot_limit: int = 0
    pulse_phase_cycles: int = 0
    ld_delay_cycles: int = 0
    ld_width_cycles: int = 0
    adc_delay_cycles: int = 0
    adc_width_cycles: int = 1
    waveform_control: int = 0
    waveform_x_min: int = 0
    waveform_x_max: int = 0
    waveform_y_min: int = 0
    waveform_y_max: int = 0
    waveform_x_step: int = 0
    waveform_y_step: int = 0

    @classmethod
    def from_dict(cls, body):
        return cls(
            mode=int(body.get("mode", PAM_SCHED_MODE_IDLE)),
            control=int(body.get("control", 0)),
            period_cycles=int(body.get("period_cycles", 1)),
            manual_x=int(body.get("manual_x", body.get("x", 0))),
            manual_y=int(body.get("manual_y", body.get("y", 0))),
            shot_limit=int(body.get("shot_limit", 0)),
            pulse_phase_cycles=int(body.get("pulse_phase_cycles", 0)),
            ld_delay_cycles=int(body.get("ld_delay_cycles", body.get("ld_delay", 0))),
            ld_width_cycles=int(body.get("ld_width_cycles", body.get("ld_width", 0))),
            adc_delay_cycles=int(body.get("adc_delay_cycles", body.get("adc_delay", 0))),
            adc_width_cycles=int(body.get("adc_width_cycles", body.get("adc_width", 1))),
            waveform_control=int(body.get("waveform_control", 0)),
            waveform_x_min=int(body.get("waveform_x_min", 0)),
            waveform_x_max=int(body.get("waveform_x_max", 0)),
            waveform_y_min=int(body.get("waveform_y_min", 0)),
            waveform_y_max=int(body.get("waveform_y_max", 0)),
            waveform_x_step=int(body.get("waveform_x_step", 0)),
            waveform_y_step=int(body.get("waveform_y_step", 0)),
        )

    def register_values(self):
        mode = _u32(self.mode)
        if mode > PAM_SCHED_MODE_MAX:
            raise ValueError("scheduler mode out of range")
        control = _u32(self.control)
        if control & ~PAM_SCHED_CTRL_ALLOWED_MASK:
            raise ValueError("scheduler control contains reserved bits")
        waveform_control = _u32(self.waveform_control)
        if waveform_control & ~PAM_WAVEFORM_CONTROL_ALLOWED_MASK:
            raise ValueError("waveform control contains reserved bits")

        return {
            PAM_REG_SCHED_MODE: mode,
            PAM_REG_SCHED_CONTROL: control,
            PAM_REG_SCHED_PERIOD_CYCLES: _u32_zero_to_one(self.period_cycles),
            PAM_REG_MANUAL_X: _s16_bits(self.manual_x),
            PAM_REG_MANUAL_Y: _s16_bits(self.manual_y),
            PAM_REG_SHOT_LIMIT: _u32(self.shot_limit),
            PAM_REG_PULSE_PHASE_CYCLES: _u32(self.pulse_phase_cycles),
            PAM_REG_MANUAL_LD_DELAY_CYCLES: _u32(self.ld_delay_cycles),
            PAM_REG_MANUAL_LD_WIDTH_CYCLES: _u32(self.ld_width_cycles),
            PAM_REG_MANUAL_ADC_DELAY_CYCLES: _u32(self.adc_delay_cycles),
            PAM_REG_MANUAL_ADC_WIDTH_CYCLES: _u32_zero_to_one(self.adc_width_cycles),
            PAM_REG_WAVEFORM_CONTROL: waveform_control,
            PAM_REG_WAVEFORM_X_RANGE: _pack_s16_pair(self.waveform_x_min, self.waveform_x_max),
            PAM_REG_WAVEFORM_Y_RANGE: _pack_s16_pair(self.waveform_y_min, self.waveform_y_max),
            PAM_REG_WAVEFORM_STEP_XY: _pack_s16_pair(self.waveform_x_step, self.waveform_y_step),
        }

    def to_dict(self):
        return asdict(self)


def decode_scheduler_status(counters):
    state = int(counters.get("sched_state", 0) or 0)
    current_xy = int(counters.get("sched_current_xy", 0) or 0)
    index_xy = int(counters.get("sched_current_index_xy", 0) or 0)
    mode = state & 0xF
    x_idx = index_xy & 0xFFFF
    y_idx = (index_xy >> 16) & 0xFFFF
    return {
        "version": int(counters.get("sched_version", 0) or 0),
        "mode": mode,
        "mode_name": PAM_SCHED_MODE_NAMES.get(mode, f"unknown_{mode}"),
        "fsm_state": (state >> 4) & 0xF,
        "active": bool(state & PAM_SCHED_STATE_ACTIVE),
        "capture_required": bool(state & PAM_SCHED_STATE_CAPTURE_REQUIRED),
        "capture_enabled": bool(state & PAM_SCHED_STATE_CAPTURE_ENABLED),
        "running_without_capture": bool(state & PAM_SCHED_STATE_RUNNING_WITHOUT_CAPTURE),
        "parked": bool(state & PAM_SCHED_STATE_PARKED),
        "stop_pending": bool(state & PAM_SCHED_STATE_STOP_PENDING),
        "abort_observed": bool(state & PAM_SCHED_STATE_ABORT_OBSERVED),
        "fault_latched": bool(state & PAM_SCHED_STATE_FAULT_LATCHED),
        "current_x": _s16(current_xy & 0xFFFF),
        "current_y": _s16((current_xy >> 16) & 0xFFFF),
        "x_idx": x_idx,
        "y_idx": y_idx,
        "x_index": x_idx,
        "y_index": y_idx,
        "current_frame": int(counters.get("sched_current_frame", 0) or 0),
        "shot_count": int(counters.get("sched_shot_count", 0) or 0),
        "capture_count": int(counters.get("sched_capture_count", 0) or 0),
        "pixel_count": int(counters.get("sched_pixel_count", 0) or 0),
        "command_count": int(counters.get("sched_command_count", 0) or 0),
        "last_command": int(counters.get("sched_last_command", 0) or 0),
        "stop_count": int(counters.get("sched_stop_count", 0) or 0),
        "park_count": int(counters.get("sched_park_count", 0) or 0),
        "manual_update_count": int(counters.get("sched_manual_update_count", 0) or 0),
        "waveform_cycle_count": int(counters.get("sched_waveform_cycle_count", 0) or 0),
        "fault_detail": int(counters.get("sched_fault_detail", 0) or 0),
        "control_snapshot": int(counters.get("sched_control_snapshot", 0) or 0),
        "period_active": int(counters.get("sched_period_active", 0) or 0),
        "raw": dict(counters),
    }


class PamAxiController:
    def __init__(self, regs):
        self.regs = regs

    def read_pl_counters(self):
        return {name: self.regs.read32(offset) for name, offset in PAM_DEBUG_COUNTER_REGS}

    def clear_pl_counters(self):
        self.regs.write32(PAM_REG_DBG_CONTROL, 1)
        self.regs.write32(PAM_REG_DBG_CONTROL, 0)

    def wait_not_busy(self, timeout_s=0.1, poll_s=0.001):
        deadline = time.monotonic() + max(0.0, float(timeout_s))
        while True:
            status = self.regs.read32(PAM_REG_DBG_STATUS)
            if (status & 0x22) == 0:
                return status
            if time.monotonic() >= deadline:
                raise TimeoutError(f"PAM acquisition/downstream did not go idle, status=0x{status:08X}")
            time.sleep(max(0.0, float(poll_s)))

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


class PamSchedulerController:
    def __init__(self, regs):
        self.regs = regs

    def program(self, config, verify=True):
        values = config.register_values()
        for offset in PAM_SCHED_REGISTER_ORDER:
            value = values[offset]
            self.regs.write32(offset, value)
            if verify:
                readback = self.regs.read32(offset)
                if readback != value:
                    raise RuntimeError(f"PAM scheduler register 0x{offset:02X} readback mismatch")

    def command(self, command_bits):
        command_bits = _u32(command_bits)
        if command_bits & ~PAM_SCHED_CMD_ALLOWED_MASK:
            raise ValueError("scheduler command contains reserved bits")
        self.regs.write32(PAM_REG_SCHED_COMMAND, command_bits)

    def start(self):
        self.command(PAM_SCHED_CMD_START)

    def stop(self):
        self.command(PAM_SCHED_CMD_STOP)

    def abort_and_park(self):
        self.regs.write32(PAM_REG_START, 0)
        self.command(PAM_SCHED_CMD_ABORT_AND_PARK)

    def clear_fault(self):
        self.command(PAM_SCHED_CMD_CLEAR_FAULT)

    def apply_manual(self):
        self.command(PAM_SCHED_CMD_APPLY_MANUAL)

    def manual_position(self, x, y):
        self.regs.write32(PAM_REG_MANUAL_X, _s16_bits(x))
        self.regs.write32(PAM_REG_MANUAL_Y, _s16_bits(y))
        self.apply_manual()

    def single_pulse(self):
        self.command(PAM_SCHED_CMD_SINGLE_PULSE)

    def read_scheduler_counters(self):
        return {name: self.regs.read32(offset) for name, offset in PAM_SCHED_STATUS_REGS}

    def status(self):
        return decode_scheduler_status(self.read_scheduler_counters())


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
        v2_buf = array.array("B", b"\x00" * AXIS_STATUS_V2_BYTES)
        try:
            fcntl.ioctl(fd, AXIS_CAP_IOC_GET_STATUS_V2, v2_buf, True)
            return AxisCaptureStatus.unpack_v2(v2_buf.tobytes())
        except OSError as exc:
            if exc.errno not in (errno.ENOTTY, errno.EINVAL, errno.ENOSYS):
                raise

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
    def __init__(
        self,
        pam,
        device,
        writer,
        drain_idle_timeout_s=2.0,
        drain_total_timeout_s=10.0,
        expected_flush_min_margin_s=1.0,
        expected_flush_margin_fraction=0.25,
    ):
        self.pam = pam
        self.device = device
        self.writer = writer
        self.drain_idle_timeout_s = drain_idle_timeout_s
        self.drain_total_timeout_s = drain_total_timeout_s
        self.expected_flush_min_margin_s = expected_flush_min_margin_s
        self.expected_flush_margin_fraction = expected_flush_margin_fraction
        self._stop_event = threading.Event()
        self._writer_failed = False
        self.sequence = 0
        self.diagnostics = PaCaptureDiagnostics()
        self.stats = self._new_stats()
        self.capture_program_hook = None
        self.capture_start_hook = None
        self.capture_stop_hook = None
        self.expected_frame_period_counts = None

    def configure_capture_hooks(
        self,
        program=None,
        start=None,
        stop=None,
        expected_frame_period_counts=None,
    ):
        self.capture_program_hook = program
        self.capture_start_hook = start
        self.capture_stop_hook = stop
        self.expected_frame_period_counts = expected_frame_period_counts

    def _program_active_capture(self, params):
        if self.capture_program_hook is not None:
            return self.capture_program_hook(params)
        return self.pam.program(params)

    def _start_active_capture(self):
        if self.capture_start_hook is not None:
            return self.capture_start_hook()
        return self.pam.write_start(1)

    def _stop_active_capture(self):
        if self.capture_stop_hook is not None:
            return self.capture_stop_hook()
        return self.pam.write_start(0)

    def _new_stats(self):
        return {
            "running": False,
            "blocks_sent": 0,
            "frames_sent": 0,
            "bytes_sent": 0,
            "expected_frames": 0,
            "last_error": "",
            "end_reason": "",
            "last_block": None,
            "axis_status_initial": None,
            "axis_status_before_stop": None,
            "axis_status_after_stop": None,
            "axis_status_after_drain": None,
            "axis_status_end": None,
            "diagnostics": PaCaptureDiagnostics.empty_snapshot(),
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
        self.diagnostics.check_block(header, payload)
        self.stats["last_block"] = header.to_dict()
        self.stats["diagnostics"] = self.diagnostics.snapshot()
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

    def _snapshot_axis_status(self, key):
        try:
            self.stats[key] = self.device.get_status().to_dict()
        except Exception as exc:
            self.stats[f"{key}_error"] = str(exc)

    def _read_pl_counters(self):
        if not hasattr(self.pam, "read_pl_counters"):
            return None
        return self.pam.read_pl_counters()

    def _snapshot_pl_counters(self, key):
        try:
            counters = self._read_pl_counters()
        except Exception as exc:
            self.stats[f"{key}_error"] = str(exc)
            return None
        if counters is not None:
            self.stats[key] = counters
        return counters

    def _pl_fault_message(self, counters):
        if not counters:
            return ""
        status = int(counters.get("status", 0) or 0)
        if (status & 1) == 0:
            return ""
        fault_code = int(counters.get("fault_code", 0) or 0)
        return f"PA PL fault code {fault_code}"

    def _send_end_record(self):
        self.stats["diagnostics"] = self.diagnostics.snapshot()
        self._snapshot_pl_counters("pl_counters_end")
        self._snapshot_axis_status("axis_status_end")
        self._send_json_record(RECORD_TYPE_END, dict(self.stats))

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

    def _expected_frame_flush_due_ns(self, params, expected_frames, frames_sent, base_ns):
        remaining_frames = max(0, int(expected_frames) - int(frames_sent))
        if remaining_frames <= 0:
            return base_ns
        gap_counts = self.expected_frame_period_counts
        if gap_counts is None:
            gap_counts = getattr(params, "gap_time", 0) or 0
        gap_counts = max(1, int(gap_counts))
        ns_per_count = NS_PER_SECOND // PAM_TIMING_CLOCK_HZ
        estimated_remaining_ns = remaining_frames * gap_counts * ns_per_count
        min_margin_ns = int(max(0.0, float(self.expected_flush_min_margin_s)) * NS_PER_SECOND)
        fraction_margin_ns = int(estimated_remaining_ns * max(0.0, float(self.expected_flush_margin_fraction)))
        return int(base_ns) + estimated_remaining_ns + max(min_margin_ns, fraction_margin_ns)

    def run_once(self, params, max_blocks=-1, capture_time_sec=0, expected_frames=0):
        self.sequence = 0
        self._writer_failed = False
        self.diagnostics = PaCaptureDiagnostics()
        self.stats = self._new_stats()
        self.stats["running"] = True
        expected_frames = max(0, int(expected_frames or 0))
        capture_time_sec = max(0.0, float(capture_time_sec or 0))
        if expected_frames > 0:
            capture_time_sec = 0.0
        self.stats["expected_frames"] = expected_frames
        pam_started = False
        dma_started = False
        device_opened = False
        start_ns = now_ns()
        last_progress_ns = start_ns

        def stop_capture(best_effort=False):
            nonlocal pam_started, dma_started
            errors = []
            if pam_started:
                try:
                    self._stop_active_capture()
                    if self.capture_stop_hook is None and hasattr(self.pam, "wait_not_busy"):
                        self.pam.wait_not_busy(timeout_s=0.1)
                except Exception as exc:
                    errors.append(exc)
                else:
                    pam_started = False
            if dma_started:
                self._snapshot_axis_status("axis_status_before_stop")
                stop_succeeded = False
                try:
                    self.device.stop()
                    stop_succeeded = True
                except Exception as exc:
                    errors.append(exc)
                if stop_succeeded:
                    self._snapshot_axis_status("axis_status_after_stop")
                    dma_started = False
                    try:
                        self._drain_until_eof()
                        self._snapshot_axis_status("axis_status_after_drain")
                    except Exception as exc:
                        errors.append(exc)
            if errors and not best_effort:
                raise errors[0]
            return errors

        try:
            self._program_active_capture(params)
            if hasattr(self.pam, "clear_pl_counters"):
                self.pam.clear_pl_counters()
            self._snapshot_pl_counters("pl_counters_initial")
            self.device.open()
            device_opened = True
            status = self.device.get_status()
            self.stats["axis_status_initial"] = status.to_dict()
            self._send_json_record(
                RECORD_TYPE_METADATA,
                {
                    "params": params.to_dict(),
                    "status": status.to_dict(),
                    "start_ns": start_ns,
                    "expected_frames": expected_frames,
                },
            )

            if self._stop_event.is_set():
                self.stats["end_reason"] = "stop_requested"
                stop_capture()
                self.stats["running"] = False
                self._send_end_record()
                return dict(self.stats)

            self.device.start()
            dma_started = True

            if self._stop_event.is_set():
                self.stats["end_reason"] = "stop_requested"
                stop_capture()
                self.stats["running"] = False
                self._send_end_record()
                return dict(self.stats)

            pam_started = True
            self._start_active_capture()

            while not self._stop_event.is_set():
                pl_counters = self._snapshot_pl_counters("pl_counters_latest")
                pl_fault = self._pl_fault_message(pl_counters)
                if pl_fault:
                    self.stats["last_error"] = pl_fault
                    self.stats["end_reason"] = "pl_fault"
                    break
                if max_blocks >= 0 and self.stats["blocks_sent"] >= max_blocks:
                    self.stats["end_reason"] = "max_blocks"
                    break
                if capture_time_sec > 0 and (now_ns() - start_ns) >= int(capture_time_sec * 1_000_000_000):
                    self.stats["end_reason"] = "capture_time"
                    break
                if expected_frames > 0 and self.stats["frames_sent"] >= expected_frames:
                    self.stats["end_reason"] = "expected_frames"
                    break

                item = self.device.read_block(timeout=0.5)
                if item is AXIS_READ_TIMEOUT:
                    if expected_frames > 0:
                        due_ns = self._expected_frame_flush_due_ns(
                            params,
                            expected_frames,
                            self.stats["frames_sent"],
                            last_progress_ns,
                        )
                        if now_ns() >= due_ns:
                            self.stats["end_reason"] = "expected_frames_flush"
                            break
                    continue
                if item is None:
                    self.stats["end_reason"] = "eof"
                    break

                header, payload = item
                self._send_data_record(header, payload)
                last_progress_ns = now_ns()

            if self._stop_event.is_set() and not self.stats["end_reason"]:
                self.stats["end_reason"] = "stop_requested"
            if not self.stats["end_reason"]:
                self.stats["end_reason"] = "complete"

            stop_capture()
            if self.stats["end_reason"] == "expected_frames_flush":
                if self.stats["frames_sent"] >= expected_frames:
                    self.stats["end_reason"] = "expected_frames"
                else:
                    self.stats["end_reason"] = "expected_frames_timeout"
            self.stats["running"] = False
            self._send_end_record()
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
            self.stats["diagnostics"] = self.diagnostics.snapshot()
            self._snapshot_axis_status("axis_status_end")
            try:
                self._send_json_record(RECORD_TYPE_ERROR, dict(self.stats))
            except Exception:
                pass
            raise
        finally:
            self.stats["running"] = False
            if pam_started:
                try:
                    self._stop_active_capture()
                except Exception:
                    pass
            if dma_started:
                try:
                    self._snapshot_axis_status("axis_status_before_stop")
                    self.device.stop()
                    self._snapshot_axis_status("axis_status_after_stop")
                    dma_started = False
                    writer_failed = self._writer_failed
                    self._writer_failed = True
                    try:
                        self._drain_until_eof()
                        self._snapshot_axis_status("axis_status_after_drain")
                    finally:
                        self._writer_failed = writer_failed
                except Exception:
                    pass
            if device_opened:
                try:
                    self.device.close()
                except Exception:
                    pass
