import json
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
