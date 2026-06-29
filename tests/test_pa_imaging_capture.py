import json
import errno
import struct
import threading
import unittest
from unittest import mock

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

    def test_pam_params_reject_invalid_count_register_values(self):
        invalid_params = (
            pa.PamCaptureParams(x_points=0),
            pa.PamCaptureParams(x_points=-1),
            pa.PamCaptureParams(y_points=0),
            pa.PamCaptureParams(frame_number=0),
        )

        for params in invalid_params:
            with self.subTest(params=params):
                with self.assertRaises(ValueError):
                    params.register_values()

    def test_pam_axi_program_forces_start_low_before_register_writes(self):
        regs = FakeRegs()
        params = pa.PamCaptureParams(x_start=-1, x_step=2, x_points=3)
        controller = pa.PamAxiController(regs)

        controller.program(params, verify=True)

        self.assertEqual(regs.writes[0], (pa.PAM_REG_START, 0))
        self.assertIn((pa.PAM_REG_X_START, 0xFFFF), regs.writes)
        self.assertIn((pa.PAM_REG_X_STEP, 2), regs.writes)
        self.assertIn((pa.PAM_REG_X_POINTS, 3), regs.writes)

    def test_pam_params_include_return_mode_register(self):
        params = pa.PamCaptureParams(return_mode=1)

        packed = params.register_values()

        self.assertEqual(packed[pa.PAM_REG_RETURN_MODE], 1)

    def test_pam_pl_counter_registers_are_read_in_order(self):
        regs = FakeRegs()
        for name, offset in pa.PAM_DEBUG_COUNTER_REGS:
            regs.values[offset] = offset + 1

        counters = pa.PamAxiController(regs).read_pl_counters()

        self.assertEqual(counters["status"], 0x81)
        self.assertEqual(counters["fault_code"], 0x85)
        self.assertEqual(counters["accepted_trigger_count"], 0x8D)

    def test_pam_pl_counter_clear_pulses_control_register(self):
        regs = FakeRegs()

        pa.PamAxiController(regs).clear_pl_counters()

        self.assertEqual(
            regs.writes[-2:],
            [(pa.PAM_REG_DBG_CONTROL, 1), (pa.PAM_REG_DBG_CONTROL, 0)],
        )

    def test_scheduler_config_packs_signed_and_packed_fields(self):
        config = pa.PamSchedulerConfig(
            mode=pa.PAM_SCHED_MODE_CONTINUOUS_POINT_CAPTURE,
            control=pa.PAM_SCHED_CTRL_LD_ENABLE
            | pa.PAM_SCHED_CTRL_ADC_ENABLE
            | pa.PAM_SCHED_CTRL_CAPTURE_ENABLE
            | pa.PAM_SCHED_CTRL_RESPECT_DOWNSTREAM_BUSY,
            period_cycles=1234,
            manual_x=-12,
            manual_y=34,
            shot_limit=99,
            ld_delay_cycles=2,
            ld_width_cycles=3,
            adc_delay_cycles=4,
            adc_width_cycles=1,
            waveform_x_min=-100,
            waveform_x_max=100,
            waveform_y_min=-50,
            waveform_y_max=50,
            waveform_x_step=5,
            waveform_y_step=-6,
        )

        values = config.register_values()

        self.assertEqual(values[pa.PAM_REG_SCHED_MODE], pa.PAM_SCHED_MODE_CONTINUOUS_POINT_CAPTURE)
        self.assertEqual(values[pa.PAM_REG_MANUAL_X], 0xFFF4)
        self.assertEqual(values[pa.PAM_REG_MANUAL_Y], 34)
        self.assertEqual(values[pa.PAM_REG_WAVEFORM_X_RANGE], 0x0064FF9C)
        self.assertEqual(values[pa.PAM_REG_WAVEFORM_Y_RANGE], 0x0032FFCE)
        self.assertEqual(values[pa.PAM_REG_WAVEFORM_STEP_XY], 0xFFFA0005)

    def test_scheduler_config_coerces_zero_period_and_adc_width_to_one(self):
        config = pa.PamSchedulerConfig(period_cycles=0, adc_width_cycles=0)

        values = config.register_values()

        self.assertEqual(values[pa.PAM_REG_SCHED_PERIOD_CYCLES], 1)
        self.assertEqual(values[pa.PAM_REG_MANUAL_ADC_WIDTH_CYCLES], 1)

    def test_scheduler_config_rejects_negative_period_and_adc_width(self):
        invalid_configs = (
            pa.PamSchedulerConfig(period_cycles=-1),
            pa.PamSchedulerConfig(adc_width_cycles=-1),
        )

        for config in invalid_configs:
            with self.subTest(config=config):
                with self.assertRaises(ValueError):
                    config.register_values()

    def test_scheduler_config_accepts_defined_control_masks(self):
        config = pa.PamSchedulerConfig(
            control=pa.PAM_SCHED_CTRL_ALLOWED_MASK,
            waveform_control=pa.PAM_WAVEFORM_CONTROL_ALLOWED_MASK,
        )

        values = config.register_values()

        self.assertEqual(values[pa.PAM_REG_SCHED_CONTROL], pa.PAM_SCHED_CTRL_ALLOWED_MASK)
        self.assertEqual(values[pa.PAM_REG_WAVEFORM_CONTROL], pa.PAM_WAVEFORM_CONTROL_ALLOWED_MASK)

    def test_scheduler_config_rejects_invalid_signed_and_reserved_values(self):
        invalid_configs = (
            pa.PamSchedulerConfig(manual_x=40000),
            pa.PamSchedulerConfig(waveform_y_step=-40000),
            pa.PamSchedulerConfig(mode=9),
            pa.PamSchedulerConfig(control=1 << 6),
            pa.PamSchedulerConfig(control=1 << 7),
            pa.PamSchedulerConfig(control=1 << 10),
            pa.PamSchedulerConfig(control=1 << 11),
            pa.PamSchedulerConfig(control=1 << 12),
            pa.PamSchedulerConfig(waveform_control=1 << 11),
            pa.PamSchedulerConfig(waveform_control=1 << 12),
        )

        for config in invalid_configs:
            with self.subTest(config=config):
                with self.assertRaises(ValueError):
                    config.register_values()

    def test_scheduler_status_decodes_mode_flags_and_signed_xy(self):
        counters = {
            "sched_version": 0x0001007F,
            "sched_state": (
                pa.PAM_SCHED_MODE_MANUAL_PULSE_NO_CAPTURE
                | (2 << 4)
                | pa.PAM_SCHED_STATE_ACTIVE
                | pa.PAM_SCHED_STATE_RUNNING_WITHOUT_CAPTURE
            ),
            "sched_current_xy": 0xFFCE0064,
            "sched_current_index_xy": 0x00120034,
            "sched_shot_count": 7,
            "sched_capture_count": 0,
            "sched_fault_detail": 0,
        }

        status = pa.decode_scheduler_status(counters)

        self.assertEqual(status["mode"], pa.PAM_SCHED_MODE_MANUAL_PULSE_NO_CAPTURE)
        self.assertEqual(status["mode_name"], "manual_pulse_no_capture")
        self.assertEqual(status["fsm_state"], 2)
        self.assertTrue(status["active"])
        self.assertFalse(status["capture_required"])
        self.assertEqual(status["current_x"], 100)
        self.assertEqual(status["current_y"], -50)
        self.assertEqual(status["x_idx"], 0x34)
        self.assertEqual(status["y_idx"], 0x12)
        self.assertEqual(status["x_index"], 0x34)
        self.assertEqual(status["y_index"], 0x12)
        self.assertEqual(status["shot_count"], 7)

    def test_scheduler_controller_programs_config_and_pulses_start(self):
        regs = FakeRegs()
        controller = pa.PamSchedulerController(regs)
        config = pa.PamSchedulerConfig(
            mode=pa.PAM_SCHED_MODE_MANUAL_GALVO_HOLD,
            manual_x=11,
            manual_y=-12,
        )

        controller.program(config, verify=True)
        controller.command(pa.PAM_SCHED_CMD_START)

        self.assertIn((pa.PAM_REG_SCHED_MODE, pa.PAM_SCHED_MODE_MANUAL_GALVO_HOLD), regs.writes)
        self.assertIn((pa.PAM_REG_MANUAL_X, 11), regs.writes)
        self.assertIn((pa.PAM_REG_MANUAL_Y, 0xFFF4), regs.writes)
        self.assertEqual(regs.writes[-1], (pa.PAM_REG_SCHED_COMMAND, pa.PAM_SCHED_CMD_START))

    def test_scheduler_controller_command_helpers_write_expected_pulses(self):
        regs = FakeRegs()
        controller = pa.PamSchedulerController(regs)

        controller.start()
        controller.stop()
        controller.clear_fault()
        controller.apply_manual()
        controller.single_pulse()

        self.assertEqual(
            regs.writes,
            [
                (pa.PAM_REG_SCHED_COMMAND, pa.PAM_SCHED_CMD_START),
                (pa.PAM_REG_SCHED_COMMAND, pa.PAM_SCHED_CMD_STOP),
                (pa.PAM_REG_SCHED_COMMAND, pa.PAM_SCHED_CMD_CLEAR_FAULT),
                (pa.PAM_REG_SCHED_COMMAND, pa.PAM_SCHED_CMD_APPLY_MANUAL),
                (pa.PAM_REG_SCHED_COMMAND, pa.PAM_SCHED_CMD_SINGLE_PULSE),
            ],
        )

    def test_scheduler_controller_manual_position_preserves_active_mode(self):
        regs = FakeRegs()
        controller = pa.PamSchedulerController(regs)

        controller.manual_position(123, -45)

        self.assertEqual(
            regs.writes,
            [
                (pa.PAM_REG_MANUAL_X, 123),
                (pa.PAM_REG_MANUAL_Y, 0xFFD3),
                (pa.PAM_REG_SCHED_COMMAND, pa.PAM_SCHED_CMD_APPLY_MANUAL),
            ],
        )

    def test_scheduler_controller_rejects_reserved_command_bits(self):
        regs = FakeRegs()
        controller = pa.PamSchedulerController(regs)

        with self.assertRaises(ValueError):
            controller.command(pa.PAM_SCHED_CMD_ALLOWED_MASK | (1 << 7))

        self.assertEqual(regs.writes, [])

    def test_scheduler_controller_abort_and_park_uses_new_command_and_legacy_start_low(self):
        regs = FakeRegs()
        controller = pa.PamSchedulerController(regs)

        controller.abort_and_park()

        self.assertEqual(
            regs.writes,
            [
                (pa.PAM_REG_START, 0),
                (pa.PAM_REG_SCHED_COMMAND, pa.PAM_SCHED_CMD_ABORT_AND_PARK),
            ],
        )

    def test_scheduler_controller_reads_counters_and_decodes_status(self):
        regs = FakeRegs()
        regs.values[pa.PAM_REG_SCHED_STATE] = (
            pa.PAM_SCHED_MODE_MANUAL_GALVO_HOLD
            | (1 << 4)
            | pa.PAM_SCHED_STATE_ACTIVE
            | pa.PAM_SCHED_STATE_PARKED
        )
        regs.values[pa.PAM_REG_SCHED_CURRENT_XY] = 0xFFF4000B
        regs.values[pa.PAM_REG_SCHED_CURRENT_INDEX_XY] = 0x00030002
        regs.values[pa.PAM_REG_SCHED_SHOT_COUNT] = 5
        controller = pa.PamSchedulerController(regs)

        counters = controller.read_scheduler_counters()
        status = controller.status()

        self.assertEqual(list(counters.keys()), [name for name, _offset in pa.PAM_SCHED_STATUS_REGS])
        self.assertEqual(counters["sched_shot_count"], 5)
        self.assertEqual(status["mode"], pa.PAM_SCHED_MODE_MANUAL_GALVO_HOLD)
        self.assertEqual(status["current_x"], 11)
        self.assertEqual(status["current_y"], -12)
        self.assertEqual(status["x_idx"], 2)
        self.assertEqual(status["y_idx"], 3)
        self.assertTrue(status["parked"])

    def test_pam_wait_not_busy_returns_when_debug_busy_bit_is_clear(self):
        regs = FakeRegs()
        regs.values[pa.PAM_REG_DBG_STATUS] = 0x10

        status = pa.PamAxiController(regs).wait_not_busy(timeout_s=0)

        self.assertEqual(status, 0x10)

    def test_pam_wait_not_busy_times_out_when_debug_busy_bit_stays_set(self):
        regs = FakeRegs()
        regs.values[pa.PAM_REG_DBG_STATUS] = 0x2

        with self.assertRaises(TimeoutError):
            pa.PamAxiController(regs).wait_not_busy(timeout_s=0)

    def test_pam_wait_not_busy_times_out_when_downstream_busy_bit_stays_set(self):
        regs = FakeRegs()
        regs.values[pa.PAM_REG_DBG_STATUS] = 0x20

        with self.assertRaises(TimeoutError):
            pa.PamAxiController(regs).wait_not_busy(timeout_s=0)

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

    def test_axis_status_unpack_matches_superblock_driver_layout(self):
        raw = struct.pack("<15I", 1, 1, 0, 4096, 33554432, 2, 3, 4, 5, 6, 7, 8, 9, 10, 1)

        status = pa.AxisCaptureStatus.unpack(raw)

        self.assertTrue(status.running)
        self.assertTrue(status.stop_requested)
        self.assertFalse(status.removing)
        self.assertEqual(status.frame_bytes, 4096)
        self.assertEqual(status.superblock_bytes, 33554432)
        self.assertEqual(status.active_dma_count, 2)
        self.assertEqual(status.done_count, 3)
        self.assertEqual(status.ready_block_count, 4)
        self.assertEqual(status.free_block_count, 5)
        self.assertEqual(status.completed_frames, 6)
        self.assertEqual(status.aggregated_frames, 7)
        self.assertEqual(status.completed_blocks, 8)
        self.assertEqual(status.dropped_frames, 9)
        self.assertEqual(status.dropped_blocks, 10)
        self.assertTrue(status.draining_done)
        self.assertEqual(status.submit_count, 0)

    def test_axis_status_v2_unpack_includes_dma_health_counters(self):
        raw = struct.pack(
            "<28I",
            1,
            0,
            0,
            4096,
            33554432,
            31,
            2,
            3,
            4,
            100,
            99,
            8,
            1,
            2,
            0,
            1000,
            990,
            958,
            7,
            6,
            5,
            4,
            3,
            2,
            1,
            9,
            8,
            7,
        )

        status = pa.AxisCaptureStatus.unpack_v2(raw)

        self.assertTrue(status.running)
        self.assertEqual(status.active_dma_count, 31)
        self.assertEqual(status.submit_count, 1000)
        self.assertEqual(status.callback_count, 990)
        self.assertEqual(status.rearm_count, 958)
        self.assertEqual(status.done_q_high_watermark, 7)
        self.assertEqual(status.ready_block_high_watermark, 6)
        self.assertEqual(status.free_block_low_watermark, 5)
        self.assertEqual(status.active_dma_low_watermark, 4)
        self.assertEqual(status.active_dma_zero_events, 3)
        self.assertEqual(status.done_q_overflow_count, 2)
        self.assertEqual(status.aggregate_fail_count, 1)
        self.assertEqual(status.rearm_fail_count, 9)
        self.assertEqual(status.abort_count, 8)
        self.assertEqual(status.copy_to_user_fault_count, 7)

    def test_axis_block_header_unpack_matches_superblock_driver_layout(self):
        raw = struct.pack("<QIIQQ", 5, 12, 3, 20, 22)

        header = pa.AxisBlockHeader.unpack(raw)

        self.assertEqual(header.block_id, 5)
        self.assertEqual(header.used_bytes, 12)
        self.assertEqual(header.frame_count, 3)
        self.assertEqual(header.first_frame_id, 20)
        self.assertEqual(header.last_frame_id, 22)


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


class FailingStartPam:
    def __init__(self):
        self.actions = []

    def program(self, params):
        self.actions.append("program")

    def write_start(self, level):
        self.actions.append(("start", 1 if level else 0))
        if level:
            raise RuntimeError("start verify failed")


class FailingProgramPam:
    def __init__(self):
        self.actions = []

    def program(self, params):
        self.actions.append("program")
        raise RuntimeError("program failed")

    def write_start(self, level):
        self.actions.append(("start", 1 if level else 0))


class OrderingPam:
    def __init__(self, actions, fail_low=False):
        self.actions = actions
        self.fail_low = fail_low

    def program(self, params):
        self.actions.append("program")

    def write_start(self, level):
        if level:
            self.actions.append("pam_high")
        else:
            self.actions.append("pam_low")
            if self.fail_low:
                raise RuntimeError("pam low failed")


class RetryLowPam(OrderingPam):
    def __init__(self, actions):
        super().__init__(actions)
        self.low_attempts = 0

    def write_start(self, level):
        if level:
            self.actions.append("pam_high")
            return
        self.low_attempts += 1
        self.actions.append("pam_low")
        if self.low_attempts == 1:
            raise RuntimeError("pam low failed once")


class OrderingCaptureDevice(FakeCaptureDevice):
    def __init__(self, actions, blocks):
        super().__init__(blocks)
        self.actions_ref = actions

    def open(self):
        self.actions_ref.append("open")
        super().open()

    def get_status(self):
        self.actions_ref.append("status")
        return super().get_status()

    def start(self):
        self.actions_ref.append("dma_start")
        super().start()

    def stop(self):
        self.actions_ref.append("dma_stop")
        super().stop()

    def read_block(self, timeout=0.5):
        self.actions_ref.append("read")
        return super().read_block(timeout=timeout)


class StopFailsOnceDevice(OrderingCaptureDevice):
    def __init__(self, actions, blocks):
        super().__init__(actions, blocks)
        self.stop_attempts = 0

    def stop(self):
        self.stop_attempts += 1
        self.actions_ref.append("dma_stop")
        self.actions.append("dma_stop")
        if self.stop_attempts == 1:
            raise RuntimeError("stop failed once")


class RequestStopDevice(OrderingCaptureDevice):
    def __init__(self, actions):
        super().__init__(actions, [])
        self.on_read = None
        self.stopped = False

    def stop(self):
        self.stopped = True
        super().stop()

    def read_block(self, timeout=0.5):
        self.actions_ref.append("read")
        self.actions.append("read")
        if self.stopped:
            return None
        if self.on_read is not None:
            self.on_read()
        return pa.AXIS_READ_TIMEOUT


class PartialBlockAfterStopDevice(OrderingCaptureDevice):
    def __init__(self, actions, final_block, max_live_reads=3):
        super().__init__(actions, [])
        self.final_block = final_block
        self.final_sent = False
        self.max_live_reads = max_live_reads
        self.live_reads = 0
        self.stopped = False

    def stop(self):
        self.stopped = True
        super().stop()

    def read_block(self, timeout=0.5):
        self.actions_ref.append("read")
        self.actions.append("read")
        if not self.stopped:
            self.live_reads += 1
            if self.live_reads > self.max_live_reads:
                raise RuntimeError("test guard: expected-frame flush did not stop")
            return pa.AXIS_READ_TIMEOUT
        if not self.final_sent:
            self.final_sent = True
            return self.final_block
        return None


class OrderingWriter:
    def __init__(self, actions, fail_on_data=False):
        self.actions = actions
        self.fail_on_data = fail_on_data
        self.records = []

    def send_record(self, record):
        if record.record_type == pa.RECORD_TYPE_METADATA:
            self.actions.append("send_metadata")
        elif record.record_type == pa.RECORD_TYPE_DATA:
            self.actions.append("send_data")
            if self.fail_on_data:
                raise RuntimeError("data send failed")
        elif record.record_type == pa.RECORD_TYPE_ERROR:
            self.actions.append("send_error")
        elif record.record_type == pa.RECORD_TYPE_END:
            self.actions.append("send_end")
        self.records.append(record)


class TimeoutDrainDevice(FakeCaptureDevice):
    def __init__(self, status, guard_reads=2):
        super().__init__([])
        self.status = status
        self.guard_reads = guard_reads

    def read_block(self, timeout=0.5):
        self.actions.append("read")
        self.guard_reads -= 1
        if self.guard_reads < 0:
            raise RuntimeError("test guard: drain did not exit")
        return pa.AXIS_READ_TIMEOUT


class RaisingDrainDevice(FakeCaptureDevice):
    def stop(self):
        self.actions.append("dma_stop")

    def read_block(self, timeout=0.5):
        self.actions.append("read")
        raise RuntimeError("drain failed")


class EndlessDrainDevice(FakeCaptureDevice):
    def __init__(self, guard_reads=3):
        block = (
            pa.AxisBlockHeader(block_id=3, used_bytes=4, frame_count=1, first_frame_id=30, last_frame_id=30),
            b"loop",
        )
        super().__init__([block])
        self.block = block
        self.guard_reads = guard_reads

    def read_block(self, timeout=0.5):
        self.actions.append("read")
        self.guard_reads -= 1
        if self.guard_reads < 0:
            raise RuntimeError("test guard: total drain timeout did not fire")
        return self.block


class FakeSocket:
    def __init__(self):
        self.timeout = None
        self.sent = []
        self.shutdown_calls = []
        self.closed = False

    def settimeout(self, timeout):
        self.timeout = timeout

    def sendall(self, data):
        self.sent.append(data)

    def shutdown(self, how):
        self.shutdown_calls.append(how)

    def close(self):
        self.closed = True


class BlockingSocket:
    def __init__(self):
        self.timeout = None
        self.send_started = threading.Event()
        self.unblock_send = threading.Event()
        self.shutdown_called = threading.Event()
        self.close_called = threading.Event()

    def settimeout(self, timeout):
        self.timeout = timeout

    def sendall(self, data):
        self.send_started.set()
        while not self.unblock_send.is_set() and not self.close_called.is_set() and not self.shutdown_called.is_set():
            self.unblock_send.wait(0.01)

    def shutdown(self, how):
        self.shutdown_called.set()

    def close(self):
        self.close_called.set()


class FakePoll:
    def __init__(self, events):
        self.events = events
        self.registered = []

    def register(self, fd, event_mask):
        self.registered.append((fd, event_mask))

    def poll(self, timeout_ms):
        return self.events


class AxisCaptureDeviceTests(unittest.TestCase):
    def axis_status(self, superblock_bytes):
        return pa.AxisCaptureStatus(False, False, False, 4096, superblock_bytes, 0, 0, 0, 8, 0, 0, 0, 0, 0, False)

    def block_bytes(self, used_bytes, payload):
        header = struct.pack("<QIIQQ", 7, used_bytes, 2, 20, 21)
        return header + payload

    def test_read_block_accepts_used_bytes_shorter_than_superblock(self):
        device = pa.AxisCaptureDevice()
        device.fd = 123
        device.get_status = lambda: self.axis_status(superblock_bytes=32)
        raw = self.block_bytes(used_bytes=4, payload=b"abcd")

        with mock.patch.object(pa.select, "poll", return_value=FakePoll([(123, pa.select.POLLIN)])):
            with mock.patch.object(pa.os, "read", return_value=raw) as read_mock:
                header, payload = device.read_block()

        read_mock.assert_called_once_with(123, pa.AXIS_BLOCK_HEADER_BYTES + 32)
        self.assertEqual(header.block_id, 7)
        self.assertEqual(header.used_bytes, 4)
        self.assertEqual(payload, b"abcd")

    def test_read_block_rejects_extra_payload_bytes(self):
        device = pa.AxisCaptureDevice()
        device.fd = 123
        device.get_status = lambda: self.axis_status(superblock_bytes=5)
        raw = self.block_bytes(used_bytes=4, payload=b"abcde")

        with mock.patch.object(pa.select, "poll", return_value=FakePoll([(123, pa.select.POLLIN)])):
            with mock.patch.object(pa.os, "read", return_value=raw):
                with self.assertRaises(RuntimeError):
                    device.read_block()

    def test_get_status_falls_back_to_v1_when_v2_ioctl_is_not_available(self):
        device = pa.AxisCaptureDevice()
        device.fd = 123
        raw_v1 = struct.pack("<15I", 1, 0, 0, 4096, 33554432, 2, 3, 4, 5, 6, 7, 8, 9, 10, 1)
        calls = []

        def fake_ioctl(fd, cmd, buf=None, mutate_flag=True):
            calls.append(cmd)
            if cmd == pa.AXIS_CAP_IOC_GET_STATUS_V2:
                raise OSError(errno.ENOTTY, "not supported")
            self.assertEqual(cmd, pa.AXIS_CAP_IOC_GET_STATUS)
            for idx, value in enumerate(raw_v1):
                buf[idx] = value
            return 0

        with mock.patch.object(pa.fcntl, "ioctl", side_effect=fake_ioctl):
            status = device.get_status()

        self.assertEqual(calls, [pa.AXIS_CAP_IOC_GET_STATUS_V2, pa.AXIS_CAP_IOC_GET_STATUS])
        self.assertEqual(status.completed_frames, 6)
        self.assertEqual(status.submit_count, 0)

    def test_get_status_uses_v2_when_available(self):
        device = pa.AxisCaptureDevice()
        device.fd = 123
        raw_v2 = struct.pack(
            "<28I",
            1, 0, 0, 4096, 33554432, 2, 3, 4, 5, 6, 7, 8, 9, 10, 1,
            101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 113,
        )

        def fake_ioctl(fd, cmd, buf=None, mutate_flag=True):
            self.assertEqual(cmd, pa.AXIS_CAP_IOC_GET_STATUS_V2)
            for idx, value in enumerate(raw_v2):
                buf[idx] = value
            return 0

        with mock.patch.object(pa.fcntl, "ioctl", side_effect=fake_ioctl):
            status = device.get_status()

        self.assertEqual(status.submit_count, 101)
        self.assertEqual(status.copy_to_user_fault_count, 113)


class PaWorkerTests(unittest.TestCase):
    def valid_frame_block(self, block_id=1, frame_id=0, global_shot_idx=0):
        metadata = struct.pack("<8I", 0, global_shot_idx, 0, 0, 0, 0, 0, pa.PA_META_MAGIC)
        payload = struct.pack("<QII", frame_id, len(metadata), 0) + metadata
        return (
            pa.AxisBlockHeader(
                block_id=block_id,
                used_bytes=len(payload),
                frame_count=1,
                first_frame_id=frame_id,
                last_frame_id=frame_id,
            ),
            payload,
        )

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

    def test_worker_stops_after_expected_frames(self):
        regs = FakeRegs()
        pam = pa.PamAxiController(regs)
        first_block = (
            pa.AxisBlockHeader(block_id=1, used_bytes=4, frame_count=2, first_frame_id=10, last_frame_id=11),
            b"abcd",
        )
        second_block = (
            pa.AxisBlockHeader(block_id=2, used_bytes=4, frame_count=2, first_frame_id=12, last_frame_id=13),
            b"wxyz",
        )
        device = FakeCaptureDevice([first_block, second_block])
        writer = FakeWriter()
        worker = pa.PaCaptureWorker(pam, device, writer)

        summary = worker.run_once(pa.PamCaptureParams(), expected_frames=3, capture_time_sec=0)

        self.assertEqual(summary["end_reason"], "expected_frames")
        self.assertEqual(summary["expected_frames"], 3)
        self.assertEqual(summary["blocks_sent"], 2)
        self.assertEqual(summary["frames_sent"], 4)
        self.assertEqual([record.record_type for record in writer.records], [
            pa.RECORD_TYPE_METADATA,
            pa.RECORD_TYPE_DATA,
            pa.RECORD_TYPE_DATA,
            pa.RECORD_TYPE_END,
        ])

    def test_worker_expected_frames_flushes_final_partial_block_without_capture_time(self):
        actions = []
        pam = OrderingPam(actions)
        device = PartialBlockAfterStopDevice(actions, self.valid_frame_block())
        writer = OrderingWriter(actions)
        worker = pa.PaCaptureWorker(
            pam,
            device,
            writer,
            expected_flush_min_margin_s=0.0,
            expected_flush_margin_fraction=0.0,
        )

        summary = worker.run_once(pa.PamCaptureParams(gap_time=0), expected_frames=1, capture_time_sec=0)

        self.assertEqual(summary["end_reason"], "expected_frames")
        self.assertEqual(summary["frames_sent"], 1)
        self.assertEqual([record.record_type for record in writer.records], [
            pa.RECORD_TYPE_METADATA,
            pa.RECORD_TYPE_DATA,
            pa.RECORD_TYPE_END,
        ])
        self.assertLess(actions.index("pam_low"), actions.index("dma_stop"))

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

    def test_worker_capture_hooks_start_scheduler_without_legacy_start_high(self):
        actions = []
        pam = OrderingPam(actions)
        block = (
            pa.AxisBlockHeader(block_id=1, used_bytes=4, frame_count=1, first_frame_id=10, last_frame_id=10),
            b"abcd",
        )
        device = OrderingCaptureDevice(actions, [block])
        writer = OrderingWriter(actions)
        worker = pa.PaCaptureWorker(pam, device, writer)
        worker.configure_capture_hooks(
            start=lambda: actions.append("scheduler_start"),
            stop=lambda: actions.append("scheduler_abort"),
            expected_frame_period_counts=33333,
        )

        summary = worker.run_once(pa.PamCaptureParams(), expected_frames=1, capture_time_sec=0)

        self.assertEqual(summary["end_reason"], "expected_frames")
        self.assertIn("scheduler_start", actions)
        self.assertIn("scheduler_abort", actions)
        self.assertNotIn("pam_high", actions)
        self.assertLess(actions.index("dma_start"), actions.index("scheduler_start"))
        self.assertLess(actions.index("scheduler_abort"), actions.index("dma_stop"))

    def test_worker_stop_requested_before_run_skips_hardware_start(self):
        actions = []
        pam = OrderingPam(actions)
        device = OrderingCaptureDevice(actions, [])
        writer = OrderingWriter(actions)
        worker = pa.PaCaptureWorker(pam, device, writer)

        worker.request_stop()
        summary = worker.run_once(pa.PamCaptureParams(), max_blocks=1, capture_time_sec=0)

        self.assertEqual(summary["end_reason"], "stop_requested")
        self.assertIn("send_metadata", actions)
        self.assertNotIn("dma_start", actions)
        self.assertNotIn("pam_high", actions)
        self.assertEqual(writer.records[-1].record_type, pa.RECORD_TYPE_END)

    def test_worker_sends_drained_blocks_before_end_record(self):
        regs = FakeRegs()
        pam = pa.PamAxiController(regs)
        block = (
            pa.AxisBlockHeader(block_id=2, used_bytes=4, frame_count=3, first_frame_id=12, last_frame_id=14),
            b"wxyz",
        )
        device = FakeCaptureDevice([block])
        writer = FakeWriter()
        worker = pa.PaCaptureWorker(pam, device, writer)

        summary = worker.run_once(pa.PamCaptureParams(), max_blocks=0, capture_time_sec=0)

        self.assertEqual([record.record_type for record in writer.records], [
            pa.RECORD_TYPE_METADATA,
            pa.RECORD_TYPE_DATA,
            pa.RECORD_TYPE_END,
        ])
        self.assertEqual(writer.records[1].payload, b"wxyz")
        self.assertEqual(writer.records[1].block_id, 2)
        self.assertEqual(summary["blocks_sent"], 1)
        self.assertEqual(summary["frames_sent"], 3)
        self.assertEqual(summary["bytes_sent"], 4)

    def test_worker_drain_exits_when_status_reports_done(self):
        regs = FakeRegs()
        pam = pa.PamAxiController(regs)
        status = pa.AxisCaptureStatus(False, True, False, 4096, 33554432, 0, 0, 0, 8, 0, 0, 0, 0, 0, True)
        device = TimeoutDrainDevice(status)
        writer = FakeWriter()
        worker = pa.PaCaptureWorker(pam, device, writer)

        summary = worker.run_once(pa.PamCaptureParams(), max_blocks=0, capture_time_sec=0)

        self.assertEqual([record.record_type for record in writer.records], [
            pa.RECORD_TYPE_METADATA,
            pa.RECORD_TYPE_END,
        ])
        self.assertEqual(summary["end_reason"], "max_blocks")

    def test_worker_drain_idle_timeout_sends_error_record(self):
        regs = FakeRegs()
        pam = pa.PamAxiController(regs)
        status = pa.AxisCaptureStatus(False, True, False, 4096, 33554432, 0, 0, 1, 7, 0, 0, 0, 0, 0, False)
        device = TimeoutDrainDevice(status)
        writer = FakeWriter()
        worker = pa.PaCaptureWorker(pam, device, writer)
        worker.drain_idle_timeout_s = 0

        with self.assertRaisesRegex(RuntimeError, "axis capture drain timed out"):
            worker.run_once(pa.PamCaptureParams(), max_blocks=0, capture_time_sec=0)

        self.assertEqual(writer.records[-1].record_type, pa.RECORD_TYPE_ERROR)
        self.assertIn("axis capture drain timed out", writer.records[-1].payload.decode("utf-8"))

    def test_worker_cleanup_does_not_repeat_stop_after_drain_failure(self):
        regs = FakeRegs()
        pam = pa.PamAxiController(regs)
        device = RaisingDrainDevice([])
        writer = FakeWriter()
        worker = pa.PaCaptureWorker(pam, device, writer)

        with self.assertRaisesRegex(RuntimeError, "drain failed"):
            worker.run_once(pa.PamCaptureParams(), max_blocks=0, capture_time_sec=0)

        self.assertEqual(device.actions.count("dma_stop"), 1)
        self.assertEqual(regs.writes.count((pa.PAM_REG_START, 0)), 2)

    def test_worker_total_drain_timeout_sends_error_after_streaming_blocks(self):
        regs = FakeRegs()
        pam = pa.PamAxiController(regs)
        device = EndlessDrainDevice()
        writer = FakeWriter()
        worker = pa.PaCaptureWorker(
            pam,
            device,
            writer,
            drain_idle_timeout_s=10.0,
            drain_total_timeout_s=0,
        )

        with self.assertRaisesRegex(RuntimeError, "axis capture drain total timeout"):
            worker.run_once(pa.PamCaptureParams(), max_blocks=0, capture_time_sec=0)

        record_types = [record.record_type for record in writer.records]
        self.assertIn(pa.RECORD_TYPE_DATA, record_types)
        self.assertEqual(writer.records[-1].record_type, pa.RECORD_TYPE_ERROR)
        self.assertIn("axis capture drain total timeout", writer.records[-1].payload.decode("utf-8"))

    def test_worker_clears_pam_start_when_high_write_verification_fails(self):
        pam = FailingStartPam()
        device = FakeCaptureDevice([])
        writer = FakeWriter()
        worker = pa.PaCaptureWorker(pam, device, writer)

        with self.assertRaisesRegex(RuntimeError, "start verify failed"):
            worker.run_once(pa.PamCaptureParams(), max_blocks=0, capture_time_sec=0)

        self.assertEqual(pam.actions, ["program", ("start", 1), ("start", 0)])
        self.assertEqual(device.actions.count("dma_stop"), 1)
        self.assertEqual(writer.records[-1].record_type, pa.RECORD_TYPE_ERROR)
        self.assertIn("start verify failed", writer.records[-1].payload.decode("utf-8"))

    def test_worker_stops_hardware_before_error_send_after_data_send_failure(self):
        actions = []
        block = (
            pa.AxisBlockHeader(block_id=4, used_bytes=4, frame_count=1, first_frame_id=40, last_frame_id=40),
            b"fail",
        )
        pam = OrderingPam(actions)
        device = OrderingCaptureDevice(actions, [block])
        writer = OrderingWriter(actions, fail_on_data=True)
        worker = pa.PaCaptureWorker(pam, device, writer)

        with self.assertRaisesRegex(RuntimeError, "data send failed"):
            worker.run_once(pa.PamCaptureParams(), max_blocks=1, capture_time_sec=0)

        self.assertLess(actions.index("pam_low"), actions.index("dma_stop"))
        self.assertLess(actions.index("dma_stop"), actions.index("send_error"))
        self.assertEqual(actions.count("dma_stop"), 1)
        self.assertEqual(writer.records[-1].record_type, pa.RECORD_TYPE_ERROR)

    def test_worker_attempts_dma_stop_before_error_when_pam_low_cleanup_fails(self):
        actions = []
        block = (
            pa.AxisBlockHeader(block_id=5, used_bytes=4, frame_count=1, first_frame_id=50, last_frame_id=50),
            b"fail",
        )
        pam = OrderingPam(actions, fail_low=True)
        device = OrderingCaptureDevice(actions, [block])
        writer = OrderingWriter(actions, fail_on_data=True)
        worker = pa.PaCaptureWorker(pam, device, writer)

        with self.assertRaisesRegex(RuntimeError, "data send failed"):
            worker.run_once(pa.PamCaptureParams(), max_blocks=1, capture_time_sec=0)

        self.assertLess(actions.index("pam_low"), actions.index("dma_stop"))
        self.assertLess(actions.index("dma_stop"), actions.index("send_error"))
        self.assertEqual(actions.count("dma_stop"), 1)
        self.assertEqual(writer.records[-1].record_type, pa.RECORD_TYPE_ERROR)

    def test_worker_drains_to_eof_after_data_send_failure(self):
        actions = []
        blocks = [
            (
                pa.AxisBlockHeader(block_id=6, used_bytes=4, frame_count=1, first_frame_id=60, last_frame_id=60),
                b"send",
            ),
            (
                pa.AxisBlockHeader(block_id=7, used_bytes=4, frame_count=1, first_frame_id=61, last_frame_id=61),
                b"drop",
            ),
        ]
        pam = OrderingPam(actions)
        device = OrderingCaptureDevice(actions, blocks)
        writer = OrderingWriter(actions, fail_on_data=True)
        worker = pa.PaCaptureWorker(pam, device, writer)

        with self.assertRaisesRegex(RuntimeError, "data send failed"):
            worker.run_once(pa.PamCaptureParams(), max_blocks=1, capture_time_sec=0)

        self.assertLess(actions.index("pam_low"), actions.index("dma_stop"))
        self.assertLess(actions.index("dma_stop"), actions.index("send_error"))
        self.assertEqual(actions.count("dma_stop"), 1)
        self.assertEqual(actions.count("read"), 3)
        self.assertEqual(writer.records[-1].record_type, pa.RECORD_TYPE_ERROR)

    def test_worker_retries_pam_low_after_cleanup_low_failure(self):
        actions = []
        block = (
            pa.AxisBlockHeader(block_id=8, used_bytes=4, frame_count=1, first_frame_id=80, last_frame_id=80),
            b"fail",
        )
        pam = RetryLowPam(actions)
        device = OrderingCaptureDevice(actions, [block])
        writer = OrderingWriter(actions, fail_on_data=True)
        worker = pa.PaCaptureWorker(pam, device, writer)

        with self.assertRaisesRegex(RuntimeError, "data send failed"):
            worker.run_once(pa.PamCaptureParams(), max_blocks=1, capture_time_sec=0)

        self.assertGreaterEqual(actions.count("pam_low"), 2)
        self.assertEqual(actions.count("dma_stop"), 1)

    def test_worker_retries_dma_stop_in_finally_after_stop_failure(self):
        actions = []
        block = (
            pa.AxisBlockHeader(block_id=9, used_bytes=4, frame_count=1, first_frame_id=90, last_frame_id=90),
            b"fail",
        )
        pam = OrderingPam(actions)
        device = StopFailsOnceDevice(actions, [block])
        writer = OrderingWriter(actions, fail_on_data=True)
        worker = pa.PaCaptureWorker(pam, device, writer)

        with self.assertRaisesRegex(RuntimeError, "data send failed"):
            worker.run_once(pa.PamCaptureParams(), max_blocks=1, capture_time_sec=0)

        self.assertGreaterEqual(actions.count("dma_stop"), 2)
        self.assertIn("close", device.actions)

    def test_worker_drains_after_finally_stop_retry_succeeds(self):
        actions = []
        blocks = [
            (
                pa.AxisBlockHeader(block_id=10, used_bytes=4, frame_count=1, first_frame_id=100, last_frame_id=100),
                b"fail",
            ),
            (
                pa.AxisBlockHeader(block_id=11, used_bytes=4, frame_count=1, first_frame_id=101, last_frame_id=101),
                b"drop",
            ),
        ]
        pam = OrderingPam(actions)
        device = StopFailsOnceDevice(actions, blocks)
        writer = OrderingWriter(actions, fail_on_data=True)
        worker = pa.PaCaptureWorker(pam, device, writer)

        with self.assertRaisesRegex(RuntimeError, "data send failed"):
            worker.run_once(pa.PamCaptureParams(), max_blocks=1, capture_time_sec=0)

        self.assertGreaterEqual(actions.count("dma_stop"), 2)
        self.assertEqual(actions.count("read"), 3)
        self.assertLess(device.actions.index("read"), device.actions.index("close"))

    def test_worker_program_failure_aborts_before_dma(self):
        pam = FailingProgramPam()
        device = FakeCaptureDevice([])
        writer = FakeWriter()
        worker = pa.PaCaptureWorker(pam, device, writer)

        with self.assertRaisesRegex(RuntimeError, "program failed"):
            worker.run_once(pa.PamCaptureParams(), max_blocks=0, capture_time_sec=0)

        self.assertEqual(pam.actions, ["program"])
        self.assertNotIn("open", device.actions)
        self.assertNotIn("dma_start", device.actions)
        self.assertNotIn("dma_stop", device.actions)

    def test_worker_repeated_stop_requests_use_one_cleanup_sequence(self):
        actions = []
        pam = OrderingPam(actions)
        device = RequestStopDevice(actions)
        writer = OrderingWriter(actions)
        worker = pa.PaCaptureWorker(pam, device, writer)
        device.on_read = lambda: (worker.request_stop(), worker.request_stop())

        summary = worker.run_once(pa.PamCaptureParams(), max_blocks=-1, capture_time_sec=0)

        self.assertEqual(summary["end_reason"], "stop_requested")
        self.assertEqual(actions.count("pam_low"), 1)
        self.assertEqual(actions.count("dma_stop"), 1)
        self.assertEqual(writer.records[-1].record_type, pa.RECORD_TYPE_END)


class PaWriterTests(unittest.TestCase):
    def test_connected_writer_sets_timeout_and_sends_encoded_record(self):
        sock = FakeSocket()
        writer = pa.ConnectedPaWriter(sock, send_timeout_s=1.5)
        record = pa.metadata_record(sequence=1, timestamp_ns=2, payload={"ok": True})

        writer.send_record(record)

        self.assertEqual(sock.timeout, 1.5)
        self.assertEqual(sock.sent, [record.encode()])

    def test_connected_writer_close_interrupts_blocked_send(self):
        sock = BlockingSocket()
        writer = pa.ConnectedPaWriter(sock, send_timeout_s=None)
        record = pa.metadata_record(sequence=1, timestamp_ns=2, payload={"ok": True})
        send_thread = threading.Thread(target=writer.send_record, args=(record,))
        close_thread = threading.Thread(target=writer.close_client)

        send_thread.start()
        self.assertTrue(sock.send_started.wait(1.0))
        close_thread.start()
        try:
            self.assertTrue(sock.shutdown_called.wait(0.05))
            self.assertTrue(sock.close_called.wait(0.05))
        finally:
            send_thread.join(1.0)
            close_thread.join(1.0)
            sock.unblock_send.set()


if __name__ == "__main__":
    unittest.main()
