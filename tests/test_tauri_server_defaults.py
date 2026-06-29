import io
import os
import tempfile
import threading
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest import mock

import butterfly_laser_server as legacy
import butterfly_laser_server_tauri as tauri_server
import pa_imaging_capture as pa


class TauriServerDefaultsTests(unittest.TestCase):
    def test_tauri_server_reuses_legacy_defaults(self):
        self.assertIs(tauri_server.DEFAULT_SETTINGS, legacy.DEFAULT_SETTINGS)
        self.assertEqual(tauri_server.DEFAULT_SETTINGS["laser"]["lock"]["kp"], "0.5")
        self.assertEqual(tauri_server.DEFAULT_SETTINGS["laser"]["lock"]["ki"], "0.01")
        self.assertEqual(tauri_server.DEFAULT_SETTINGS["laser"]["lock"]["max_step"], "3")
        self.assertEqual(tauri_server.DEFAULT_SETTINGS["laser"]["lock"]["integral_limit"], "500000")
        self.assertEqual(tauri_server.DEFAULT_SETTINGS["laser"]["lock"]["locked_threshold"], "1000")
        self.assertEqual(tauri_server.DEFAULT_SETTINGS["laser"]["lock"]["loss_threshold"], "10000")
        self.assertEqual(tauri_server.DEFAULT_SETTINGS["ada4355"]["lp_shift"], "13")
        self.assertEqual(tauri_server.DEFAULT_SETTINGS["ada4355"]["raw_lp_shift"], "13")
        self.assertEqual(tauri_server.DEFAULT_SETTINGS["ada4355"]["gain_ohms"], "2000")
        self.assertEqual(tauri_server.DEFAULT_SETTINGS["ada4355"]["low_pass_enabled"], False)
        self.assertEqual(tauri_server.DEFAULT_SETTINGS["tec"]["ramp"]["enabled"], True)
        self.assertEqual(tauri_server.DEFAULT_SETTINGS["tec"]["ramp"]["rate_c_per_s"], "0.05")
        self.assertEqual(tauri_server.DEFAULT_SETTINGS["tec"]["ramp"]["interval_ms"], "200")

    def test_pa_parser_defaults_are_exposed_by_legacy_and_tauri_servers(self):
        legacy_args = legacy.build_parser().parse_args([])
        tauri_args = tauri_server.build_parser().parse_args([])
        self.assertEqual(legacy_args.pa_tcp_port, 9090)
        self.assertEqual(tauri_args.pa_tcp_port, 9090)
        self.assertEqual(legacy_args.pa_axi_base, "0xa0110000")
        self.assertEqual(tauri_args.pa_axi_base, "0xa0110000")
        self.assertEqual(legacy_args.pa_axi_span, "0x1000")
        self.assertEqual(tauri_args.pa_axi_span, "0x1000")
        self.assertEqual(legacy_args.pa_capture_dev, "/dev/axis_capture0")
        self.assertEqual(tauri_args.pa_capture_dev, "/dev/axis_capture0")

    def test_ada4355_analog_config_read_write_uses_sysfs(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            sysfs = Path(temp_dir) / "ada4355-gpio-ctrl"
            sysfs.mkdir()
            (sysfs / "gain_ohms").write_text("2000\n", encoding="ascii")
            (sysfs / "low_pass_enabled").write_text("0\n", encoding="ascii")

            with mock.patch.dict(os.environ, {"ADA4355_GPIO_CTRL_DIR": str(sysfs)}):
                analog = legacy.read_ada4355_analog_config()
                self.assertTrue(analog["available"])
                self.assertEqual(analog["gain_ohms"], 2000)
                self.assertFalse(analog["low_pass_enabled"])
                self.assertEqual(analog["low_pass_label"], "100 MHz")
                self.assertEqual(analog["allowed_gain_ohms"], [2000, 20000, 200000])

                analog = legacy.write_ada4355_analog_config({"gain_ohms": 20000, "low_pass_enabled": True})
                self.assertTrue(analog["available"])
                self.assertEqual(analog["gain_ohms"], 20000)
                self.assertTrue(analog["low_pass_enabled"])
                self.assertEqual(analog["low_pass_label"], "1 MHz")
                self.assertEqual((sysfs / "gain_ohms").read_text(encoding="ascii").strip(), "20000")
                self.assertEqual((sysfs / "low_pass_enabled").read_text(encoding="ascii").strip(), "1")

    def test_ada4355_analog_config_rejects_invalid_gain(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            sysfs = Path(temp_dir) / "ada4355-gpio-ctrl"
            sysfs.mkdir()
            (sysfs / "gain_ohms").write_text("2000\n", encoding="ascii")
            (sysfs / "low_pass_enabled").write_text("0\n", encoding="ascii")

            with mock.patch.dict(os.environ, {"ADA4355_GPIO_CTRL_DIR": str(sysfs)}):
                with self.assertRaisesRegex(ValueError, "gain_ohms"):
                    legacy.write_ada4355_analog_config({"gain_ohms": 1234})


class FakePaSocket:
    def __init__(self, peer=("192.168.8.10", 50000), local=("192.168.8.236", 9090)):
        self.closed = False
        self.peer = peer
        self.local = local

    def getpeername(self):
        return self.peer

    def getsockname(self):
        return self.local

    def close(self):
        self.closed = True


class FakeRegs:
    def __init__(self, events=None):
        self.values = {}
        self.writes = []
        self.events = events

    def read32(self, offset):
        return self.values.get(offset, 0)

    def write32(self, offset, value):
        self.values[offset] = value & 0xFFFFFFFF
        self.writes.append((offset, value & 0xFFFFFFFF))
        if self.events is not None:
            self.events.append(("reg_write", offset, value & 0xFFFFFFFF))


class FakePaWriter:
    def __init__(self):
        self.closed = False

    def close_client(self):
        self.closed = True


class BlockingPaWorker:
    def __init__(self):
        self.run_entered = threading.Event()
        self.release_run = threading.Event()
        self.stop_requested = threading.Event()
        self.calls = []
        self.stats = {
            "running": False,
            "blocks_sent": 0,
            "frames_sent": 0,
            "bytes_sent": 0,
            "last_error": "",
            "end_reason": "",
        }

    def run_once(self, params, max_blocks=-1, capture_time_sec=0, expected_frames=0):
        self.calls.append((params, max_blocks, capture_time_sec, expected_frames))
        self.stats["running"] = True
        self.run_entered.set()
        self.release_run.wait(1.0)
        self.stats["running"] = False
        return dict(self.stats)

    def request_stop(self):
        self.stop_requested.set()


class RaisingPaWorker:
    def __init__(self):
        self.stats = {
            "running": False,
            "blocks_sent": 0,
            "frames_sent": 0,
            "bytes_sent": 0,
            "last_error": "",
            "end_reason": "",
        }

    def run_once(self, params, max_blocks=-1, capture_time_sec=0, expected_frames=0):
        self.stats["running"] = True
        self.stats["last_error"] = "send failed"
        self.stats["end_reason"] = "error"
        raise RuntimeError("send failed")

    def request_stop(self):
        pass


class DelayedRaisingPaWorker:
    def __init__(self):
        self.run_entered = threading.Event()
        self.release_run = threading.Event()
        self.stop_requested = threading.Event()
        self.stats = {
            "running": False,
            "blocks_sent": 0,
            "frames_sent": 0,
            "bytes_sent": 0,
            "last_error": "",
            "end_reason": "",
        }

    def run_once(self, params, max_blocks=-1, capture_time_sec=0, expected_frames=0):
        self.stats["running"] = True
        self.run_entered.set()
        self.release_run.wait(1.0)
        self.stats["last_error"] = "late send failed"
        self.stats["end_reason"] = "error"
        raise RuntimeError("late send failed")

    def request_stop(self):
        self.stop_requested.set()


class JoinablePaWorker:
    def __init__(self):
        self.run_entered = threading.Event()
        self.stop_requested = threading.Event()
        self.run_exited = threading.Event()
        self.stats = {
            "running": False,
            "blocks_sent": 0,
            "frames_sent": 0,
            "bytes_sent": 0,
            "last_error": "",
            "end_reason": "",
        }

    def run_once(self, params, max_blocks=-1, capture_time_sec=0, expected_frames=0):
        self.stats["running"] = True
        self.run_entered.set()
        self.stop_requested.wait(1.0)
        self.stats["running"] = False
        self.run_exited.set()
        return dict(self.stats)

    def request_stop(self):
        self.stop_requested.set()


class SlowJoinablePaWorker(JoinablePaWorker):
    def __init__(self):
        super().__init__()
        self.release_exit = threading.Event()

    def run_once(self, params, max_blocks=-1, capture_time_sec=0, expected_frames=0):
        self.stats["running"] = True
        self.run_entered.set()
        self.stop_requested.wait(1.0)
        self.release_exit.wait(1.0)
        self.stats["running"] = False
        self.run_exited.set()
        return dict(self.stats)


class SlowCleanStopPaWorker(SlowJoinablePaWorker):
    def run_once(self, params, max_blocks=-1, capture_time_sec=0, expected_frames=0):
        self.stats["running"] = True
        self.run_entered.set()
        self.stop_requested.wait(1.0)
        self.release_exit.wait(1.0)
        self.stats.update({
            "running": False,
            "blocks_sent": 4,
            "frames_sent": 9,
            "bytes_sent": 2048,
            "last_error": "",
            "end_reason": "stop_requested",
        })
        self.run_exited.set()
        return dict(self.stats)


class CountingStopPaWorker(JoinablePaWorker):
    def run_once(self, params, max_blocks=-1, capture_time_sec=0, expected_frames=0):
        self.stats["running"] = True
        self.run_entered.set()
        self.stop_requested.wait(1.0)
        self.stats.update({
            "running": False,
            "blocks_sent": 3,
            "frames_sent": 7,
            "bytes_sent": 1024,
            "end_reason": "stop_requested",
        })
        self.run_exited.set()
        return dict(self.stats)


class WriterClosedAfterStopPaWorker(JoinablePaWorker):
    def run_once(self, params, max_blocks=-1, capture_time_sec=0, expected_frames=0):
        self.stats["running"] = True
        self.run_entered.set()
        self.stop_requested.wait(1.0)
        self.stats.update({
            "running": False,
            "blocks_sent": 2,
            "frames_sent": 5,
            "bytes_sent": 512,
            "last_error": "PA writer client is closed",
            "end_reason": "error",
        })
        self.run_exited.set()
        raise RuntimeError("PA writer client is closed")


class BrokenPipeAfterStopPaWorker(JoinablePaWorker):
    def run_once(self, params, max_blocks=-1, capture_time_sec=0, expected_frames=0):
        self.stats["running"] = True
        self.run_entered.set()
        self.stop_requested.wait(1.0)
        self.stats.update({
            "running": False,
            "blocks_sent": 2,
            "frames_sent": 5,
            "bytes_sent": 512,
            "last_error": "broken pipe",
            "end_reason": "error",
        })
        self.run_exited.set()
        raise BrokenPipeError("broken pipe")


class BrokenPipeAfterStopStopWorker(JoinablePaWorker):
    def run_once(self, params, max_blocks=-1, capture_time_sec=0, expected_frames=0):
        self.stats["running"] = True
        self.run_entered.set()
        self.stop_requested.wait(1.0)
        self.stats.update({
            "running": False,
            "blocks_sent": 2,
            "frames_sent": 5,
            "bytes_sent": 512,
            "last_error": "broken pipe",
            "end_reason": "error",
        })
        self.run_exited.set()
        raise BrokenPipeError("broken pipe")


class EnrichedErrorPaWorker:
    def __init__(self):
        self.stats = {
            "running": False,
            "blocks_sent": 1,
            "frames_sent": 2,
            "bytes_sent": 3,
            "last_error": "",
            "end_reason": "",
        }

    def run_once(self, params, max_blocks=-1, capture_time_sec=0, expected_frames=0):
        self.stats.update({
            "running": False,
            "last_error": "send failed; stop failed: dma",
            "end_reason": "error",
        })
        raise RuntimeError("send failed")

    def request_stop(self):
        pass


class PaServiceTests(unittest.TestCase):
    def make_service(self, worker):
        writer = FakePaWriter()
        created = {}

        def worker_factory(pam, device, service_writer):
            created["pam"] = pam
            created["device"] = device
            created["writer"] = service_writer
            return worker

        service = legacy.PaService(
            pam_regs=object(),
            capture_dev_path="/tmp/fake-axis",
            writer_factory=lambda sock: writer,
            pam_factory=lambda regs: ("pam", regs),
            device_factory=lambda path: ("device", path),
            worker_factory=worker_factory,
        )
        return service, writer, created

    def test_pa_service_start_requires_attached_writer(self):
        worker = BlockingPaWorker()
        service, _writer, created = self.make_service(worker)

        with self.assertRaises(RuntimeError):
            service.start(pa.PamCaptureParams())

        self.assertEqual(created, {})
        self.assertFalse(worker.run_entered.is_set())

    def test_pa_service_status_includes_tcp_client_context(self):
        worker = BlockingPaWorker()
        service, _writer, _created = self.make_service(worker)

        status = service.attach_socket(FakePaSocket(peer=("10.0.0.5", 42310), local=("192.168.8.236", 9090)))

        self.assertEqual(status["client_peer"], "10.0.0.5:42310")
        self.assertEqual(status["client_local"], "192.168.8.236:9090")
        self.assertEqual(status["connection_count"], 1)
        self.assertGreater(status["client_connected_at"], 0)
        self.assertFalse(status["worker_alive"])

    def test_pa_service_idle_status_does_not_probe_pl_counters(self):
        pam_factory_calls = []

        def pam_factory(regs):
            pam_factory_calls.append(regs)
            raise AssertionError("idle status must not read PA PL registers")

        service = legacy.PaService(
            pam_regs=object(),
            writer_factory=lambda sock: FakePaWriter(),
            pam_factory=pam_factory,
            device_factory=lambda path: object(),
            worker_factory=lambda pam, device, writer: BlockingPaWorker(),
        )

        status = service.status()

        self.assertIsNone(status["pl_counters"])
        self.assertEqual(pam_factory_calls, [])

    def test_pa_service_start_stop_and_disconnect_are_nonblocking(self):
        worker = BlockingPaWorker()
        service, writer, created = self.make_service(worker)

        status = service.attach_socket(FakePaSocket())
        self.assertTrue(status["connected"])
        extra_socket = FakePaSocket()
        status = service.attach_socket(extra_socket)
        self.assertTrue(status["connected"])
        self.assertTrue(extra_socket.closed)

        status = service.start(pa.PamCaptureParams(task_id=7), max_blocks=3, capture_time_sec=0.25)
        self.assertTrue(worker.run_entered.wait(0.5))
        self.assertTrue(status["running"])
        self.assertTrue(status["connected"])
        self.assertEqual(worker.calls[0][1:], (3, 0.25, 0))
        self.assertEqual(created["device"], ("device", "/tmp/fake-axis"))

        with self.assertRaises(RuntimeError):
            service.start(pa.PamCaptureParams())

        stop_status = service.stop()
        self.assertTrue(stop_status["running"])
        self.assertTrue(worker.stop_requested.is_set())

        disconnect_status = service.disconnect()
        self.assertFalse(disconnect_status["connected"])
        self.assertTrue(writer.closed)
        worker.release_run.set()

    def test_pa_service_clears_failed_writer_so_client_can_reconnect(self):
        writers = []

        def writer_factory(sock):
            writer = FakePaWriter()
            writers.append(writer)
            return writer

        service = legacy.PaService(
            pam_regs=object(),
            writer_factory=writer_factory,
            pam_factory=lambda regs: object(),
            device_factory=lambda path: object(),
            worker_factory=lambda pam, device, writer: RaisingPaWorker(),
        )

        service.attach_socket(FakePaSocket())
        service.start(pa.PamCaptureParams())
        worker_thread = service.worker_thread
        if worker_thread is not None:
            worker_thread.join(0.5)

        replacement_socket = FakePaSocket()
        status = service.attach_socket(replacement_socket)

        self.assertTrue(writers[0].closed)
        self.assertFalse(replacement_socket.closed)
        self.assertTrue(status["connected"])

    def test_pa_service_failed_worker_status_uses_snapshot_not_stale_running_stats(self):
        writers = []

        def writer_factory(sock):
            writer = FakePaWriter()
            writers.append(writer)
            return writer

        service = legacy.PaService(
            pam_regs=object(),
            writer_factory=writer_factory,
            pam_factory=lambda regs: object(),
            device_factory=lambda path: object(),
            worker_factory=lambda pam, device, writer: RaisingPaWorker(),
        )

        service.attach_socket(FakePaSocket())
        service.start(pa.PamCaptureParams())
        worker_thread = service.worker_thread
        if worker_thread is not None:
            worker_thread.join(0.5)

        failed_status = service.status()
        self.assertFalse(failed_status["running"])
        self.assertEqual(failed_status["last_error"], "send failed")

        service.attach_socket(FakePaSocket())
        reconnected_status = service.status()
        self.assertFalse(reconnected_status["running"])
        self.assertEqual(reconnected_status["last_error"], "")

    def test_pa_service_late_old_worker_error_does_not_close_reconnected_writer(self):
        worker = DelayedRaisingPaWorker()
        writers = []

        def writer_factory(sock):
            writer = FakePaWriter()
            writers.append(writer)
            return writer

        service = legacy.PaService(
            pam_regs=object(),
            writer_factory=writer_factory,
            pam_factory=lambda regs: object(),
            device_factory=lambda path: object(),
            worker_factory=lambda pam, device, writer: worker,
        )

        service.attach_socket(FakePaSocket())
        service.start(pa.PamCaptureParams())
        self.assertTrue(worker.run_entered.wait(0.5))
        service.disconnect()
        old_writer = writers[0]

        replacement_socket = FakePaSocket()
        status = service.attach_socket(replacement_socket)
        new_writer = writers[1]
        worker_thread = service.worker_thread
        worker.release_run.set()
        if worker_thread is not None:
            worker_thread.join(0.5)

        self.assertTrue(old_writer.closed)
        self.assertFalse(replacement_socket.closed)
        self.assertFalse(new_writer.closed)
        self.assertIs(service.writer, new_writer)
        self.assertTrue(status["connected"])

    def test_pa_service_disconnect_with_join_waits_for_worker_exit(self):
        worker = JoinablePaWorker()
        service, writer, _created = self.make_service(worker)
        service.attach_socket(FakePaSocket())
        service.start(pa.PamCaptureParams())
        self.assertTrue(worker.run_entered.wait(0.5))

        status = service.disconnect(join_timeout=0.5)

        self.assertTrue(worker.run_exited.is_set())
        self.assertIsNone(service.worker_thread)
        self.assertTrue(writer.closed)
        self.assertFalse(status["connected"])

    def test_pa_service_joined_disconnect_preserves_final_worker_stats(self):
        worker = CountingStopPaWorker()
        service, writer, _created = self.make_service(worker)
        service.attach_socket(FakePaSocket())
        service.start(pa.PamCaptureParams())
        self.assertTrue(worker.run_entered.wait(0.5))

        status = service.disconnect(join_timeout=None)

        self.assertFalse(status["running"])
        self.assertEqual(status["blocks_sent"], 3)
        self.assertEqual(status["frames_sent"], 7)
        self.assertEqual(status["bytes_sent"], 1024)
        self.assertEqual(status["end_reason"], "stop_requested")
        self.assertTrue(writer.closed)

    def test_pa_service_user_disconnect_suppresses_expected_closed_writer_error(self):
        worker = WriterClosedAfterStopPaWorker()
        service, writer, _created = self.make_service(worker)
        service.attach_socket(FakePaSocket())
        service.start(pa.PamCaptureParams())
        self.assertTrue(worker.run_entered.wait(0.5))

        status = service.disconnect(join_timeout=None)

        self.assertFalse(status["running"])
        self.assertEqual(status["blocks_sent"], 2)
        self.assertEqual(status["frames_sent"], 5)
        self.assertEqual(status["bytes_sent"], 512)
        self.assertEqual(status["end_reason"], "disconnect")
        self.assertEqual(status["last_error"], "")
        self.assertTrue(writer.closed)

    def test_pa_service_user_disconnect_suppresses_broken_pipe_error(self):
        worker = BrokenPipeAfterStopPaWorker()
        service, writer, _created = self.make_service(worker)
        service.attach_socket(FakePaSocket())
        service.start(pa.PamCaptureParams())
        self.assertTrue(worker.run_entered.wait(0.5))

        status = service.disconnect(join_timeout=None)

        self.assertFalse(status["running"])
        self.assertEqual(status["blocks_sent"], 2)
        self.assertEqual(status["frames_sent"], 5)
        self.assertEqual(status["bytes_sent"], 512)
        self.assertEqual(status["end_reason"], "disconnect")
        self.assertEqual(status["last_error"], "")
        self.assertTrue(writer.closed)

    def test_pa_service_stop_suppresses_broken_pipe_error_when_stop_requested(self):
        worker = BrokenPipeAfterStopStopWorker()
        service, writer, _created = self.make_service(worker)
        service.attach_socket(FakePaSocket())
        service.start(pa.PamCaptureParams())
        self.assertTrue(worker.run_entered.wait(0.5))

        status = service.stop(join_timeout=None)

        self.assertFalse(status["running"])
        self.assertEqual(status["blocks_sent"], 2)
        self.assertEqual(status["frames_sent"], 5)
        self.assertEqual(status["bytes_sent"], 512)
        self.assertEqual(status["end_reason"], "stop_requested")
        self.assertEqual(status["last_error"], "")
        self.assertTrue(writer.closed)

    def test_pa_service_stop_with_join_waits_for_worker_exit(self):
        worker = JoinablePaWorker()
        service, _writer, _created = self.make_service(worker)
        service.attach_socket(FakePaSocket())
        service.start(pa.PamCaptureParams())
        self.assertTrue(worker.run_entered.wait(0.5))

        status = service.stop(join_timeout=None)

        self.assertTrue(worker.run_exited.is_set())
        self.assertIsNone(service.worker_thread)
        self.assertFalse(status["running"])

    def test_pa_service_stop_with_bounded_join_reports_timeout(self):
        worker = SlowJoinablePaWorker()
        service, _writer, _created = self.make_service(worker)
        service.attach_socket(FakePaSocket())
        service.start(pa.PamCaptureParams())
        self.assertTrue(worker.run_entered.wait(0.5))

        status = service.stop(join_timeout=0.01)

        self.assertTrue(status["running"])
        self.assertEqual(status["end_reason"], "stop_timeout")
        self.assertIn("timed out", status["last_error"])
        worker.release_exit.set()
        service.disconnect(join_timeout=None)

    def test_pa_service_clears_resolved_stop_timeout_after_clean_worker_exit(self):
        worker = SlowCleanStopPaWorker()
        service, _writer, _created = self.make_service(worker)
        service.attach_socket(FakePaSocket())
        service.start(pa.PamCaptureParams())
        self.assertTrue(worker.run_entered.wait(0.5))

        timeout_status = service.stop(join_timeout=0.01)
        self.assertTrue(timeout_status["running"])
        self.assertEqual(timeout_status["end_reason"], "stop_timeout")
        self.assertIn("timed out", timeout_status["last_error"])

        worker_thread = service.worker_thread
        worker.release_exit.set()
        worker_thread.join(0.5)
        final_status = service.status()

        self.assertFalse(final_status["running"])
        self.assertEqual(final_status["blocks_sent"], 4)
        self.assertEqual(final_status["frames_sent"], 9)
        self.assertEqual(final_status["bytes_sent"], 2048)
        self.assertEqual(final_status["end_reason"], "stop_requested")
        self.assertEqual(final_status["last_error"], "")

    def test_pa_service_prefers_enriched_worker_error_stats(self):
        worker = EnrichedErrorPaWorker()
        service, _writer, _created = self.make_service(worker)
        service.attach_socket(FakePaSocket())
        service.start(pa.PamCaptureParams())
        worker_thread = service.worker_thread
        if worker_thread is not None:
            worker_thread.join(0.5)

        status = service.status()

        self.assertFalse(status["running"])
        self.assertEqual(status["last_error"], "send failed; stop failed: dma")
        self.assertEqual(status["end_reason"], "error")

    def test_pa_service_disconnect_without_timeout_waits_for_worker_exit(self):
        worker = SlowJoinablePaWorker()
        service, writer, _created = self.make_service(worker)
        service.attach_socket(FakePaSocket())
        service.start(pa.PamCaptureParams())
        self.assertTrue(worker.run_entered.wait(0.5))

        disconnect_done = threading.Event()

        def disconnect_worker():
            service.disconnect(join_timeout=None)
            disconnect_done.set()

        thread = threading.Thread(target=disconnect_worker)
        thread.start()
        self.assertTrue(worker.stop_requested.wait(0.5))
        self.assertFalse(disconnect_done.wait(0.05))
        worker.release_exit.set()
        thread.join(0.5)

        self.assertTrue(disconnect_done.is_set())
        self.assertTrue(worker.run_exited.is_set())
        self.assertIsNone(service.worker_thread)
        self.assertTrue(writer.closed)


class FakeThread:
    def __init__(self):
        self.join_calls = []

    def start(self):
        pass

    def join(self, timeout=None):
        self.join_calls.append(timeout)


class FakeListenerSocket:
    def __init__(self):
        self.closed = False

    def close(self):
        self.closed = True


class FakeBindFailSocket:
    def __init__(self):
        self.closed = False

    def __enter__(self):
        return self

    def __exit__(self, _exc_type, _exc, _tb):
        self.close()

    def setsockopt(self, *_args):
        pass

    def bind(self, _addr):
        raise OSError("address already in use")

    def close(self):
        self.closed = True


class FakePaServiceForListener:
    def __init__(self):
        self.state_lock = threading.RLock()
        self.last_error = ""


class PaTcpListenerTests(unittest.TestCase):
    def test_stop_closes_listener_and_joins_thread(self):
        stop_event = threading.Event()
        service = mock.Mock()
        listener = legacy.PaTcpListener("127.0.0.1", 9090, service, stop_event)
        fake_thread = FakeThread()
        fake_socket = FakeListenerSocket()
        listener.thread = fake_thread
        listener.thread_started = True
        listener.listener = fake_socket

        listener.stop()

        self.assertTrue(stop_event.is_set())
        self.assertTrue(fake_socket.closed)
        self.assertEqual(fake_thread.join_calls, [1.0])

    def test_start_raises_and_records_error_when_bind_fails(self):
        stop_event = threading.Event()
        service = FakePaServiceForListener()
        listener = legacy.PaTcpListener("127.0.0.1", 9090, service, stop_event)

        with mock.patch.object(legacy.socket, "socket", return_value=FakeBindFailSocket()):
            with self.assertRaises(OSError):
                listener.start()

        self.assertIn("address already in use", service.last_error)
        listener.stop()

    def test_status_reports_listener_context(self):
        stop_event = threading.Event()
        service = FakePaServiceForListener()
        listener = legacy.PaTcpListener("127.0.0.1", 9090, service, stop_event)

        status = listener.status()

        self.assertEqual(status["host"], "127.0.0.1")
        self.assertEqual(status["port"], 9090)
        self.assertFalse(status["listening"])
        self.assertFalse(status["thread_alive"])
        self.assertEqual(status["accept_count"], 0)


class FakeRamp:
    def __init__(self):
        self.stop_called = False

    def stop(self):
        self.stop_called = True

    def status(self):
        return {"active": False}


class FakePaServiceForHandler:
    def __init__(self):
        self.stop_called = False
        self.disconnect_called = False

    def stop(self, join_timeout=0):
        self.stop_called = True
        return {"connected": True, "running": False, "last_error": ""}

    def disconnect(self, join_timeout=0):
        self.disconnect_called = True
        return {"connected": False, "running": False, "last_error": ""}

    def status(self):
        return {"connected": True, "running": False, "last_error": "", "blocks_sent": 4}


class RecordingPaServiceForHandler(FakePaServiceForHandler):
    def __init__(self, events):
        super().__init__()
        self.events = events

    def stop(self, join_timeout=0):
        self.events.append("pa_stop")
        return super().stop(join_timeout=join_timeout)

    def disconnect(self, join_timeout=0):
        self.events.append("pa_disconnect")
        return super().disconnect(join_timeout=join_timeout)


class RecordingPaSchedulerForHandler:
    def __init__(self, events, fail_abort=False):
        self.events = events
        self.fail_abort = fail_abort

    def abort_and_park(self):
        self.events.append("scheduler_abort")
        if self.fail_abort:
            raise RuntimeError("scheduler abort failed")
        return {"mode_name": "idle", "last_error": ""}

    def status(self):
        return {"mode_name": "idle", "last_error": ""}


class FailingSchedulerController:
    def __init__(self, _regs):
        pass

    def program(self, _config):
        raise RuntimeError("scheduler program failed")

    def command(self, _command_bits):
        raise RuntimeError("scheduler command failed")

    def manual_position(self, _x, _y):
        raise RuntimeError("scheduler manual position failed")

    def abort_and_park(self):
        raise RuntimeError("scheduler abort failed")

    def status(self):
        return {"available": True}


class FakePaTcpListenerForHandler:
    def status(self):
        return {"host": "0.0.0.0", "port": 9090, "listening": True}


class FakePaServiceForStart:
    def __init__(self, events):
        self.events = events
        self.expected_frames = "not called"
        self.capture_time_sec = "not called"

    def start(self, params, max_blocks=-1, capture_time_sec=0, expected_frames=0, **kwargs):
        self.events.append("pa_start")
        self.expected_frames = expected_frames
        self.capture_time_sec = capture_time_sec
        self.kwargs = kwargs
        return {"connected": True, "running": True, "last_error": ""}

    def status(self):
        return {"connected": True, "running": False, "last_error": ""}


class RaisingAlreadyRunningPaService:
    def start(self, params, max_blocks=-1, capture_time_sec=0, expected_frames=0):
        raise RuntimeError("PA capture already running")

    def status(self):
        return {"connected": True, "running": True, "last_error": ""}


class RecordingLock:
    def __init__(self, events):
        self.events = events

    def __enter__(self):
        self.events.append("lock_enter")
        return self

    def __exit__(self, _exc_type, _exc, _tb):
        self.events.append("lock_exit")
        return False


class FakeSystemForHandler:
    def __init__(self):
        self.stop_all_called = False

    def stop_all(self):
        self.stop_all_called = True

    def status(self):
        return {"laser": {}, "tec": {}, "ada4355": {}}


class FakeOldAdaFilter:
    def __init__(self):
        self.control = 0x19
        self.configure_calls = []
        self.writes = []

    def configure_filter(self, **kwargs):
        if "raw_glitch_reject" in kwargs:
            raise TypeError("Ada4355Capture.configure_filter() got an unexpected keyword argument 'raw_glitch_reject'")
        self.configure_calls.append(kwargs)
        if kwargs.get("control") is not None:
            self.control = int(kwargs["control"])
        if kwargs.get("enable") is not None:
            self.control = (self.control | 0x01) if kwargs["enable"] else (self.control & ~0x01)
        if kwargs.get("glitch_reject") is not None:
            self.control = (self.control | 0x02) if kwargs["glitch_reject"] else (self.control & ~0x02)
        if kwargs.get("raw_filtered") is not None:
            self.control = (self.control | 0x04) if kwargs["raw_filtered"] else (self.control & ~0x04)
        if kwargs.get("spectrum_filtered") is not None:
            self.control = (self.control | 0x08) if kwargs["spectrum_filtered"] else (self.control & ~0x08)
        if kwargs.get("monitor_filtered") is not None:
            self.control = (self.control | 0x10) if kwargs["monitor_filtered"] else (self.control & ~0x10)
        return self.status()

    def read(self, name):
        if name != "FILTER_CONTROL":
            raise KeyError(name)
        return self.control

    def write(self, name, value):
        if name != "FILTER_CONTROL":
            raise KeyError(name)
        self.control = int(value)
        self.writes.append((name, self.control))

    def status(self):
        return {"filter": {"control": self.control, "control_hex": f"0x{self.control:08X}"}}


class RecordingPaServiceForStopAll(FakePaServiceForHandler):
    def __init__(self, events):
        super().__init__()
        self.events = events
        self.join_timeout = "not called"

    def stop(self, join_timeout=0):
        self.join_timeout = join_timeout
        self.events.append("pa_stop")
        return super().stop()


class TimedOutPaServiceForStopAll(FakePaServiceForHandler):
    def __init__(self):
        super().__init__()
        self.join_timeout = "not called"

    def stop(self, join_timeout=0):
        self.stop_called = True
        self.join_timeout = join_timeout
        return {
            "connected": True,
            "running": True,
            "last_error": "PA stop timed out after 15.0s",
            "end_reason": "stop_timeout",
        }

    def status(self):
        return {
            "connected": True,
            "running": True,
            "last_error": "PA stop timed out after 15.0s",
            "end_reason": "stop_timeout",
        }


class RecordingSystemForStopAll(FakeSystemForHandler):
    def __init__(self, events):
        super().__init__()
        self.events = events

    def stop_all(self):
        self.events.append("system_stop_all")
        super().stop_all()


class RaisingPaServiceForStart:
    def start(self, params, max_blocks=-1, capture_time_sec=0, expected_frames=0):
        raise RuntimeError("PA TCP client is not connected")

    def status(self):
        return {"connected": False, "running": False, "last_error": ""}


class HandlerPaEndpointTests(unittest.TestCase):
    def make_handler(self, path, method="GET", body=b""):
        server = mock.Mock()
        server.lock = threading.RLock()
        server.tec_ramp = FakeRamp()
        server.pa_service = FakePaServiceForHandler()
        server.pa_tcp_listener = FakePaTcpListenerForHandler()
        server.system = FakeSystemForHandler()
        handler = legacy.ButterflyHandler.__new__(legacy.ButterflyHandler)
        handler.server = server
        handler.path = path
        handler.headers = {"Content-Length": str(len(body))}
        handler.rfile = io.BytesIO(body)
        replies = []
        handler.reply_json = lambda obj, status=200: replies.append((status, obj))
        handler.reply_error = lambda status, message: replies.append((status, {"ok": False, "error": message}))
        return handler, server, replies

    def test_root_lists_pa_endpoints(self):
        handler, _server, replies = self.make_handler("/")

        legacy.ButterflyHandler.do_GET(handler)

        self.assertEqual(replies[0][0], 200)
        endpoints = set(replies[0][1]["endpoints"])
        self.assertIn("/api/pa/status", endpoints)
        self.assertIn("/api/pa/start", endpoints)
        self.assertIn("/api/pa/point/start", endpoints)
        self.assertIn("/api/pa/stop", endpoints)
        self.assertIn("/api/pa/disconnect", endpoints)
        self.assertIn("/api/pa/diagnostics", endpoints)
        self.assertIn("/api/pa/scheduler/status", endpoints)
        self.assertIn("/api/pa/scheduler/config", endpoints)
        self.assertIn("/api/pa/scheduler/command", endpoints)
        self.assertIn("/api/pa/scheduler/manual-position", endpoints)
        self.assertIn("/api/pa/scheduler/pulse", endpoints)
        self.assertIn("/api/pa/scheduler/waveform", endpoints)

    def test_api_status_includes_pa_object(self):
        handler, _server, replies = self.make_handler("/api/status")

        legacy.ButterflyHandler.do_GET(handler)

        self.assertEqual(replies[0][0], 200)
        self.assertTrue(replies[0][1]["ok"])
        self.assertEqual(replies[0][1]["status"]["pa"]["blocks_sent"], 4)

    def test_pa_status_endpoint_returns_pa_status(self):
        handler, _server, replies = self.make_handler("/api/pa/status")

        legacy.ButterflyHandler.do_GET(handler)

        self.assertEqual(replies[0], (200, {
            "ok": True,
            "pa": {"connected": True, "running": False, "last_error": "", "blocks_sent": 4},
        }))

    def test_pa_diagnostics_endpoint_returns_service_and_listener_status(self):
        handler, _server, replies = self.make_handler("/api/pa/diagnostics")

        legacy.ButterflyHandler.do_GET(handler)

        self.assertEqual(replies[0][0], 200)
        self.assertTrue(replies[0][1]["ok"])
        self.assertEqual(replies[0][1]["pa"]["blocks_sent"], 4)
        self.assertEqual(replies[0][1]["tcp_listener"]["port"], 9090)

    def test_pa_scheduler_status_endpoint_returns_scheduler_status(self):
        handler, server, replies = self.make_handler("/api/pa/scheduler/status")
        regs = FakeRegs()
        regs.values[pa.PAM_REG_SCHED_STATE] = pa.PAM_SCHED_MODE_MANUAL_GALVO_HOLD | pa.PAM_SCHED_STATE_ACTIVE
        server.pa_scheduler = legacy.PaSchedulerService(regs)

        legacy.ButterflyHandler.do_GET(handler)

        self.assertEqual(replies[0][0], 200)
        self.assertTrue(replies[0][1]["ok"])
        self.assertEqual(replies[0][1]["scheduler"]["mode_name"], "manual_galvo_hold")

    def test_pa_stop_endpoint_calls_service_stop(self):
        handler, server, replies = self.make_handler("/api/pa/stop", method="POST", body=b"{}")

        legacy.ButterflyHandler.do_POST(handler)

        self.assertTrue(server.pa_service.stop_called)
        self.assertEqual(replies[0][0], 200)
        self.assertTrue(replies[0][1]["ok"])

    def test_pa_stop_aborts_scheduler_before_service_stop(self):
        events = []
        handler, server, replies = self.make_handler("/api/pa/stop", method="POST", body=b"{}")
        server.pa_service = RecordingPaServiceForHandler(events)
        server.pa_scheduler = RecordingPaSchedulerForHandler(events)

        legacy.ButterflyHandler.do_POST(handler)

        self.assertEqual(events, ["scheduler_abort", "pa_stop"])
        self.assertEqual(replies[0][0], 200)
        self.assertEqual(replies[0][1]["scheduler"]["mode_name"], "idle")

    def test_pa_stop_continues_when_scheduler_abort_fails(self):
        events = []
        handler, server, replies = self.make_handler("/api/pa/stop", method="POST", body=b"{}")
        server.pa_service = RecordingPaServiceForHandler(events)
        server.pa_scheduler = RecordingPaSchedulerForHandler(events, fail_abort=True)

        legacy.ButterflyHandler.do_POST(handler)

        self.assertEqual(events, ["scheduler_abort", "pa_stop"])
        self.assertEqual(replies[0][0], 200)
        self.assertIn("scheduler abort failed", replies[0][1]["scheduler"]["last_error"])

    def test_pa_disconnect_endpoint_calls_service_disconnect(self):
        handler, server, replies = self.make_handler("/api/pa/disconnect", method="POST", body=b"{}")

        legacy.ButterflyHandler.do_POST(handler)

        self.assertTrue(server.pa_service.disconnect_called)
        self.assertEqual(replies[0], (200, {
            "ok": True,
            "pa": {"connected": False, "running": False, "last_error": ""},
        }))

    def test_pa_disconnect_aborts_scheduler_before_service_disconnect(self):
        events = []
        handler, server, replies = self.make_handler("/api/pa/disconnect", method="POST", body=b"{}")
        server.pa_service = RecordingPaServiceForHandler(events)
        server.pa_scheduler = RecordingPaSchedulerForHandler(events)

        legacy.ButterflyHandler.do_POST(handler)

        self.assertEqual(events, ["scheduler_abort", "pa_disconnect"])
        self.assertEqual(replies[0][0], 200)

    def test_pa_start_no_client_conflict_maps_to_409(self):
        handler, server, replies = self.make_handler("/api/pa/start", method="POST", body=b"{}")
        server.pa_service = RaisingPaServiceForStart()

        legacy.ButterflyHandler.do_POST(handler)

        self.assertEqual(replies[0][0], 409)
        self.assertFalse(replies[0][1]["ok"])
        self.assertIn("not connected", replies[0][1]["error"])

    def test_pa_start_already_running_conflict_maps_to_409(self):
        handler, server, replies = self.make_handler("/api/pa/start", method="POST", body=b"{}")
        server.pa_service = RaisingAlreadyRunningPaService()

        legacy.ButterflyHandler.do_POST(handler)

        self.assertEqual(replies[0][0], 409)
        self.assertFalse(replies[0][1]["ok"])
        self.assertIn("already running", replies[0][1]["error"])

    def test_pa_start_passes_expected_frames_to_service(self):
        events = []
        handler, server, replies = self.make_handler(
            "/api/pa/start",
            method="POST",
            body=b'{"expected_frames": 12}',
        )
        server.pa_service = FakePaServiceForStart(events)

        legacy.ButterflyHandler.do_POST(handler)

        self.assertEqual(replies[0][0], 200)
        self.assertEqual(server.pa_service.expected_frames, 12)

    def test_pa_start_expected_frames_disables_capture_time_stop(self):
        events = []
        handler, server, replies = self.make_handler(
            "/api/pa/start",
            method="POST",
            body=b'{"expected_frames": 640000, "capture_time_sec": 213.3312}',
        )
        server.pa_service = FakePaServiceForStart(events)

        legacy.ButterflyHandler.do_POST(handler)

        self.assertEqual(replies[0][0], 200)
        self.assertEqual(server.pa_service.expected_frames, 640000)
        self.assertEqual(server.pa_service.capture_time_sec, 0)

    def test_manual_scheduler_command_does_not_require_tcp_client(self):
        handler, server, replies = self.make_handler(
            "/api/pa/scheduler/manual-position",
            method="POST",
            body=b'{"x": 123, "y": -45}',
        )
        regs = FakeRegs()
        server.pa_scheduler = legacy.PaSchedulerService(regs)

        legacy.ButterflyHandler.do_POST(handler)

        self.assertEqual(replies[0][0], 200)
        self.assertTrue(replies[0][1]["ok"])
        self.assertIn((pa.PAM_REG_MANUAL_X, 123), regs.writes)
        self.assertIn((pa.PAM_REG_MANUAL_Y, 0xFFD3), regs.writes)
        self.assertIn((pa.PAM_REG_SCHED_COMMAND, pa.PAM_SCHED_CMD_APPLY_MANUAL), regs.writes)
        self.assertNotIn((pa.PAM_REG_SCHED_MODE, pa.PAM_SCHED_MODE_MANUAL_GALVO_HOLD), regs.writes)

    def test_scheduler_service_records_last_error_when_operations_fail(self):
        service = legacy.PaSchedulerService(FakeRegs(), controller_factory=FailingSchedulerController)

        operations = (
            lambda: service.configure(pa.PamSchedulerConfig()),
            lambda: service.command(pa.PAM_SCHED_CMD_START),
            lambda: service.manual_position(1, 2),
            service.abort_and_park,
        )

        for operation in operations:
            with self.subTest(operation=operation):
                with self.assertRaisesRegex(RuntimeError, "scheduler"):
                    operation()
                self.assertIn("scheduler", service.status()["last_error"])

    def test_scheduler_config_command_pulse_and_waveform_endpoints(self):
        regs = FakeRegs()
        cases = [
            (
                "/api/pa/scheduler/config",
                b'{"config":{"mode":3,"manual_x":7,"manual_y":-8}}',
                (pa.PAM_REG_SCHED_MODE, pa.PAM_SCHED_MODE_MANUAL_GALVO_HOLD),
            ),
            (
                "/api/pa/scheduler/command",
                b'{"command":1}',
                (pa.PAM_REG_SCHED_COMMAND, pa.PAM_SCHED_CMD_START),
            ),
            (
                "/api/pa/scheduler/pulse",
                b'{"manual_x":1,"manual_y":2,"single":true}',
                (pa.PAM_REG_SCHED_COMMAND, pa.PAM_SCHED_CMD_SINGLE_PULSE),
            ),
            (
                "/api/pa/scheduler/waveform",
                b'{"waveform_x_min":-1,"waveform_x_max":1,"waveform_x_step":1}',
                (pa.PAM_REG_SCHED_COMMAND, pa.PAM_SCHED_CMD_START),
            ),
        ]

        for path, body, expected_write in cases:
            with self.subTest(path=path):
                handler, server, replies = self.make_handler(path, method="POST", body=body)
                server.pa_scheduler = legacy.PaSchedulerService(regs)

                legacy.ButterflyHandler.do_POST(handler)

                self.assertEqual(replies[-1][0], 200)
                self.assertTrue(replies[-1][1]["ok"])
                self.assertIn(expected_write, regs.writes)

    def test_auto_pa_start_programs_scheduler_mode_before_capture_worker(self):
        events = []
        handler, server, replies = self.make_handler(
            "/api/pa/start",
            method="POST",
            body=b'{"params":{"x_points":1,"y_points":1,"frame_number":1},"expected_frames":1}',
        )
        regs = FakeRegs(events)
        server.pa_service = FakePaServiceForStart(events)
        server.pa_scheduler = legacy.PaSchedulerService(regs)

        legacy.ButterflyHandler.do_POST(handler)

        self.assertEqual(replies[0][0], 200)
        self.assertTrue(replies[0][1]["ok"])
        self.assertIn((pa.PAM_REG_SCHED_MODE, pa.PAM_SCHED_MODE_AUTO_SCAN_CAPTURE), regs.writes)
        self.assertLess(
            events.index(("reg_write", pa.PAM_REG_SCHED_MODE, pa.PAM_SCHED_MODE_AUTO_SCAN_CAPTURE)),
            events.index("pa_start"),
        )

    def test_point_pa_start_programs_point_scheduler_before_capture_worker(self):
        events = []
        handler, server, replies = self.make_handler(
            "/api/pa/point/start",
            method="POST",
            body=(
                b'{"config":{"manual_x":12,"manual_y":-34,"period_cycles":33333,'
                b'"shot_limit":3000,"pulse_enabled":true,"capture_enabled":true,'
                b'"ld_delay_cycles":200,"ld_width_cycles":400,"adc_delay_cycles":100,"adc_width_cycles":1}}'
            ),
        )
        regs = FakeRegs(events)
        server.pa_service = FakePaServiceForStart(events)
        server.pa_scheduler = legacy.PaSchedulerService(regs)

        legacy.ButterflyHandler.do_POST(handler)

        self.assertEqual(replies[0][0], 200)
        self.assertTrue(replies[0][1]["ok"])
        self.assertIn((pa.PAM_REG_SCHED_MODE, pa.PAM_SCHED_MODE_CONTINUOUS_POINT_CAPTURE), regs.writes)
        self.assertIn((pa.PAM_REG_MANUAL_X, 12), regs.writes)
        self.assertIn((pa.PAM_REG_MANUAL_Y, 0xFFDE), regs.writes)
        self.assertEqual(server.pa_service.expected_frames, 3000)
        self.assertEqual(server.pa_service.capture_time_sec, 0)
        self.assertIn("capture_start", server.pa_service.kwargs)
        self.assertIn("capture_stop", server.pa_service.kwargs)
        self.assertLess(
            events.index(("reg_write", pa.PAM_REG_SCHED_MODE, pa.PAM_SCHED_MODE_CONTINUOUS_POINT_CAPTURE)),
            events.index("pa_start"),
        )

    def test_ada_filter_endpoint_falls_back_when_raw_glitch_keyword_is_missing(self):
        handler, server, replies = self.make_handler(
            "/api/ada/filter",
            method="POST",
            body=(
                b'{"raw_glitch_reject": true, "raw_filtered": true, "enable": true, '
                b'"spectrum_filtered": true, "monitor_filtered": true}'
            ),
        )
        server.system.ada = FakeOldAdaFilter()

        legacy.ButterflyHandler.do_POST(handler)

        self.assertEqual(replies[0][0], 200)
        self.assertEqual(server.system.ada.control, 0x3D)
        self.assertEqual(server.system.ada.writes[-1], ("FILTER_CONTROL", 0x3D))
        self.assertNotIn("raw_glitch_reject", server.system.ada.configure_calls[0])

    def test_stop_all_stops_pa_service_when_present(self):
        handler, server, replies = self.make_handler("/api/stop-all", method="POST")

        legacy.ButterflyHandler.do_POST(handler)

        self.assertTrue(server.pa_service.stop_called)
        self.assertTrue(server.system.stop_all_called)
        self.assertEqual(replies[0][0], 200)

    def test_stop_all_is_serialized_by_server_lock(self):
        events = []
        handler, server, replies = self.make_handler("/api/stop-all", method="POST")
        server.lock = RecordingLock(events)
        server.pa_service = RecordingPaServiceForStopAll(events)
        server.system = RecordingSystemForStopAll(events)
        server.pa_scheduler = RecordingPaSchedulerForHandler(events)

        legacy.ButterflyHandler.do_POST(handler)

        self.assertEqual(events, ["lock_enter", "scheduler_abort", "pa_stop", "system_stop_all", "lock_exit"])
        self.assertEqual(server.pa_service.join_timeout, 15.0)
        self.assertEqual(replies[0][0], 200)

    def test_stop_all_reports_pa_stop_timeout(self):
        handler, server, replies = self.make_handler("/api/stop-all", method="POST")
        server.pa_service = TimedOutPaServiceForStopAll()

        legacy.ButterflyHandler.do_POST(handler)

        self.assertTrue(server.pa_service.stop_called)
        self.assertTrue(server.system.stop_all_called)
        self.assertEqual(server.pa_service.join_timeout, 15.0)
        self.assertEqual(replies[0][0], 409)
        self.assertFalse(replies[0][1]["ok"])
        self.assertIn("timed out", replies[0][1]["error"])
        self.assertEqual(replies[0][1]["status"]["pa"]["end_reason"], "stop_timeout")

    def test_pa_start_is_serialized_by_server_lock(self):
        events = []
        server = mock.Mock()
        server.lock = RecordingLock(events)
        server.pa_service = FakePaServiceForStart(events)
        handler = legacy.ButterflyHandler.__new__(legacy.ButterflyHandler)
        handler.server = server
        handler.path = "/api/pa/start"
        handler.headers = {"Content-Length": "2"}
        handler.rfile = io.BytesIO(b"{}")
        replies = []
        handler.reply_json = lambda obj, status=200: replies.append((status, obj))
        handler.reply_error = lambda status, message: replies.append((status, {"ok": False, "error": message}))

        legacy.ButterflyHandler.do_POST(handler)

        self.assertEqual(events, ["lock_enter", "pa_start", "lock_exit"])
        self.assertEqual(replies[0][0], 200)


class FakeCloseable:
    def __init__(self):
        self.closed = False

    def close(self):
        self.closed = True


class FakeHttpd(FakeCloseable):
    def __init__(self, _addr, _handler):
        super().__init__()
        self.server_closed = False

    def server_close(self):
        self.server_closed = True

    def serve_forever(self, poll_interval=0.2):
        raise AssertionError("serve_forever should not run when PA listener start fails")


class FakeServingHttpd(FakeHttpd):
    def serve_forever(self, poll_interval=0.2):
        raise KeyboardInterrupt


class FailingServeHttpd(FakeHttpd):
    def serve_forever(self, poll_interval=0.2):
        raise RuntimeError("serve failed")

    def server_close(self):
        self.server_closed = True
        raise RuntimeError("server close failed")


class FakeSystemForMain(FakeCloseable):
    tec = object()

    def close(self):
        self.closed = True


class RaisingSystemForMain(FakeSystemForMain):
    def close(self):
        self.closed = True
        raise RuntimeError("system close failed")


class RaisingCloseable(FakeCloseable):
    def close(self):
        self.closed = True
        raise RuntimeError("pa regs close failed")


class FakePaTcpListenerForMain:
    def __init__(self, _host, _port, _service, _stop_event):
        self.started = False
        self.stopped = False

    def start(self):
        self.started = True

    def stop(self):
        self.stopped = True


class RaisingPaTcpListenerForMain(FakePaTcpListenerForMain):
    instances = []

    def __init__(self, host, port, service, stop_event):
        super().__init__(host, port, service, stop_event)
        RaisingPaTcpListenerForMain.instances.append(self)

    def stop(self):
        self.stopped = True
        raise RuntimeError("listener stop failed")


class RunningPaServiceForMain:
    instances = []
    events = None

    def __init__(self, _pa_regs, capture_dev_path="/dev/axis_capture0"):
        self.disconnect_timeout = "not called"
        RunningPaServiceForMain.instances.append(self)

    def disconnect(self, join_timeout=0):
        if RunningPaServiceForMain.events is not None:
            RunningPaServiceForMain.events.append("pa_disconnect")
        self.disconnect_timeout = join_timeout
        return {
            "connected": False,
            "running": True,
            "last_error": "PA shutdown timed out",
            "end_reason": "shutdown_timeout",
        }


class RunningPaSchedulerForMain:
    instances = []
    events = None

    def __init__(self, _pa_regs):
        self.abort_called = False
        RunningPaSchedulerForMain.instances.append(self)

    def abort_and_park(self):
        self.abort_called = True
        if RunningPaSchedulerForMain.events is not None:
            RunningPaSchedulerForMain.events.append("scheduler_abort")
        return {"last_error": "", "mode_name": "idle"}


class RaisingPaServiceForMain:
    instances = []

    def __init__(self, _pa_regs, capture_dev_path="/dev/axis_capture0"):
        self.disconnect_timeout = "not called"
        self.disconnect_called = False
        RaisingPaServiceForMain.instances.append(self)

    def disconnect(self, join_timeout=0):
        self.disconnect_timeout = join_timeout
        self.disconnect_called = True
        raise RuntimeError("pa disconnect failed")


class RaisingRamp(FakeRamp):
    def stop(self):
        self.stop_called = True
        raise RuntimeError("ramp stop failed")


class MainCleanupTests(unittest.TestCase):
    def test_legacy_main_closes_system_and_pa_regs_when_setup_fails(self):
        system = FakeCloseable()
        pa_regs = FakeCloseable()

        with mock.patch.object(legacy, "ButterflyLaserSystem", return_value=system):
            with mock.patch.object(legacy, "AxiMap", return_value=pa_regs):
                with mock.patch.object(legacy, "load_settings", side_effect=RuntimeError("settings failed")):
                    with mock.patch("sys.argv", ["butterfly_laser_server.py"]):
                        with self.assertRaises(RuntimeError):
                            with redirect_stdout(io.StringIO()):
                                legacy.main()

        self.assertTrue(system.closed)
        self.assertTrue(pa_regs.closed)

    def test_legacy_main_preserves_listener_start_error_and_cleans_partial_resources(self):
        system = FakeSystemForMain()
        pa_regs = FakeCloseable()
        httpd_instances = []

        def httpd_factory(addr, handler):
            httpd = FakeHttpd(addr, handler)
            httpd_instances.append(httpd)
            return httpd

        with mock.patch.object(legacy, "ButterflyLaserSystem", return_value=system):
            with mock.patch.object(legacy, "AxiMap", return_value=pa_regs):
                with mock.patch.object(legacy, "ThreadingHTTPServer", side_effect=httpd_factory):
                    with mock.patch.object(legacy, "load_settings", return_value={}):
                        with mock.patch.object(legacy, "tec_ramp_from_settings", return_value=FakeRamp()):
                            with mock.patch.object(legacy, "initialize_pl_parameters"):
                                with mock.patch.object(legacy.socket, "socket", return_value=FakeBindFailSocket()):
                                    with mock.patch("sys.argv", ["butterfly_laser_server.py"]):
                                        with self.assertRaisesRegex(OSError, "address already in use"):
                                            with redirect_stdout(io.StringIO()):
                                                legacy.main()

        self.assertTrue(system.closed)
        self.assertTrue(pa_regs.closed)
        self.assertTrue(httpd_instances[0].server_closed)

    def test_tauri_main_closes_system_and_pa_regs_when_setup_fails(self):
        system = FakeCloseable()
        pa_regs = FakeCloseable()

        with mock.patch.object(tauri_server, "ButterflyLaserSystem", return_value=system):
            with mock.patch.object(tauri_server, "AxiMap", return_value=pa_regs):
                with mock.patch.object(tauri_server, "load_settings", side_effect=RuntimeError("settings failed")):
                    with mock.patch("sys.argv", ["butterfly_laser_server_tauri.py"]):
                        with self.assertRaises(RuntimeError):
                            with redirect_stdout(io.StringIO()):
                                tauri_server.main()

        self.assertTrue(system.closed)
        self.assertTrue(pa_regs.closed)

    def test_tauri_main_preserves_listener_start_error_and_cleans_partial_resources(self):
        system = FakeSystemForMain()
        pa_regs = FakeCloseable()
        httpd_instances = []

        def httpd_factory(addr, handler):
            httpd = FakeHttpd(addr, handler)
            httpd_instances.append(httpd)
            return httpd

        with mock.patch.object(tauri_server, "ButterflyLaserSystem", return_value=system):
            with mock.patch.object(tauri_server, "AxiMap", return_value=pa_regs):
                with mock.patch.object(tauri_server, "ThreadingHTTPServer", side_effect=httpd_factory):
                    with mock.patch.object(tauri_server, "load_settings", return_value={}):
                        with mock.patch.object(tauri_server, "tec_ramp_from_settings", return_value=FakeRamp()):
                            with mock.patch.object(tauri_server, "initialize_pl_parameters"):
                                with mock.patch.object(legacy.socket, "socket", return_value=FakeBindFailSocket()):
                                    with mock.patch("sys.argv", ["butterfly_laser_server_tauri.py"]):
                                        with self.assertRaisesRegex(OSError, "address already in use"):
                                            with redirect_stdout(io.StringIO()):
                                                tauri_server.main()

        self.assertTrue(system.closed)
        self.assertTrue(pa_regs.closed)
        self.assertTrue(httpd_instances[0].server_closed)

    def test_legacy_main_uses_bounded_pa_disconnect_during_shutdown(self):
        system = FakeSystemForMain()
        pa_regs = FakeCloseable()
        httpd_instances = []
        events = []
        RunningPaServiceForMain.instances = []
        RunningPaServiceForMain.events = events
        RunningPaSchedulerForMain.instances = []
        RunningPaSchedulerForMain.events = events

        def httpd_factory(addr, handler):
            httpd = FakeServingHttpd(addr, handler)
            httpd_instances.append(httpd)
            return httpd

        with mock.patch.object(legacy, "ButterflyLaserSystem", return_value=system):
            with mock.patch.object(legacy, "AxiMap", return_value=pa_regs):
                with mock.patch.object(legacy, "ThreadingHTTPServer", side_effect=httpd_factory):
                    with mock.patch.object(legacy, "load_settings", return_value={}):
                        with mock.patch.object(legacy, "tec_ramp_from_settings", return_value=FakeRamp()):
                            with mock.patch.object(legacy, "initialize_pl_parameters"):
                                with mock.patch.object(legacy, "PaTcpListener", FakePaTcpListenerForMain):
                                    with mock.patch.object(legacy, "PaService", RunningPaServiceForMain):
                                        with mock.patch.object(legacy, "PaSchedulerService", RunningPaSchedulerForMain):
                                            with mock.patch("sys.argv", ["butterfly_laser_server.py"]):
                                                with redirect_stdout(io.StringIO()):
                                                    legacy.main()

        self.assertEqual(RunningPaServiceForMain.instances[0].disconnect_timeout, 15.0)
        self.assertEqual(events, ["scheduler_abort", "pa_disconnect"])
        self.assertTrue(RunningPaSchedulerForMain.instances[0].abort_called)
        self.assertTrue(system.closed)
        self.assertTrue(pa_regs.closed)
        self.assertTrue(httpd_instances[0].server_closed)
        RunningPaServiceForMain.events = None
        RunningPaSchedulerForMain.events = None

    def test_tauri_main_uses_bounded_pa_disconnect_during_shutdown(self):
        system = FakeSystemForMain()
        pa_regs = FakeCloseable()
        httpd_instances = []
        events = []
        RunningPaServiceForMain.instances = []
        RunningPaServiceForMain.events = events
        RunningPaSchedulerForMain.instances = []
        RunningPaSchedulerForMain.events = events

        def httpd_factory(addr, handler):
            httpd = FakeServingHttpd(addr, handler)
            httpd_instances.append(httpd)
            return httpd

        with mock.patch.object(tauri_server, "ButterflyLaserSystem", return_value=system):
            with mock.patch.object(tauri_server, "AxiMap", return_value=pa_regs):
                with mock.patch.object(tauri_server, "ThreadingHTTPServer", side_effect=httpd_factory):
                    with mock.patch.object(tauri_server, "load_settings", return_value={}):
                        with mock.patch.object(tauri_server, "tec_ramp_from_settings", return_value=FakeRamp()):
                            with mock.patch.object(tauri_server, "initialize_pl_parameters"):
                                with mock.patch.object(tauri_server, "PaTcpListener", FakePaTcpListenerForMain):
                                    with mock.patch.object(tauri_server, "PaService", RunningPaServiceForMain):
                                        with mock.patch.object(tauri_server, "PaSchedulerService", RunningPaSchedulerForMain):
                                            with mock.patch("sys.argv", ["butterfly_laser_server_tauri.py"]):
                                                with redirect_stdout(io.StringIO()):
                                                    tauri_server.main()

        self.assertEqual(RunningPaServiceForMain.instances[0].disconnect_timeout, 15.0)
        self.assertEqual(events, ["scheduler_abort", "pa_disconnect"])
        self.assertTrue(RunningPaSchedulerForMain.instances[0].abort_called)
        self.assertTrue(system.closed)
        self.assertTrue(pa_regs.closed)
        self.assertTrue(httpd_instances[0].server_closed)
        RunningPaServiceForMain.events = None
        RunningPaSchedulerForMain.events = None

    def test_legacy_main_cleanup_errors_do_not_mask_original_failure_or_skip_later_cleanup(self):
        system = RaisingSystemForMain()
        pa_regs = RaisingCloseable()
        ramp = RaisingRamp()
        httpd_instances = []
        RaisingPaTcpListenerForMain.instances = []
        RaisingPaServiceForMain.instances = []

        def httpd_factory(addr, handler):
            httpd = FailingServeHttpd(addr, handler)
            httpd_instances.append(httpd)
            return httpd

        with mock.patch.object(legacy, "ButterflyLaserSystem", return_value=system):
            with mock.patch.object(legacy, "AxiMap", return_value=pa_regs):
                with mock.patch.object(legacy, "ThreadingHTTPServer", side_effect=httpd_factory):
                    with mock.patch.object(legacy, "load_settings", return_value={}):
                        with mock.patch.object(legacy, "tec_ramp_from_settings", return_value=ramp):
                            with mock.patch.object(legacy, "initialize_pl_parameters"):
                                with mock.patch.object(legacy, "PaTcpListener", RaisingPaTcpListenerForMain):
                                    with mock.patch.object(legacy, "PaService", RaisingPaServiceForMain):
                                        with mock.patch("sys.argv", ["butterfly_laser_server.py"]):
                                            with self.assertRaisesRegex(RuntimeError, "serve failed"):
                                                with redirect_stdout(io.StringIO()):
                                                    legacy.main()

        self.assertTrue(RaisingPaTcpListenerForMain.instances[0].stopped)
        self.assertTrue(RaisingPaServiceForMain.instances[0].disconnect_called)
        self.assertTrue(ramp.stop_called)
        self.assertTrue(httpd_instances[0].server_closed)
        self.assertTrue(pa_regs.closed)
        self.assertTrue(system.closed)

    def test_tauri_main_cleanup_errors_do_not_mask_original_failure_or_skip_later_cleanup(self):
        system = RaisingSystemForMain()
        pa_regs = RaisingCloseable()
        ramp = RaisingRamp()
        httpd_instances = []
        RaisingPaTcpListenerForMain.instances = []
        RaisingPaServiceForMain.instances = []

        def httpd_factory(addr, handler):
            httpd = FailingServeHttpd(addr, handler)
            httpd_instances.append(httpd)
            return httpd

        with mock.patch.object(tauri_server, "ButterflyLaserSystem", return_value=system):
            with mock.patch.object(tauri_server, "AxiMap", return_value=pa_regs):
                with mock.patch.object(tauri_server, "ThreadingHTTPServer", side_effect=httpd_factory):
                    with mock.patch.object(tauri_server, "load_settings", return_value={}):
                        with mock.patch.object(tauri_server, "tec_ramp_from_settings", return_value=ramp):
                            with mock.patch.object(tauri_server, "initialize_pl_parameters"):
                                with mock.patch.object(tauri_server, "PaTcpListener", RaisingPaTcpListenerForMain):
                                    with mock.patch.object(tauri_server, "PaService", RaisingPaServiceForMain):
                                        with mock.patch("sys.argv", ["butterfly_laser_server_tauri.py"]):
                                            with self.assertRaisesRegex(RuntimeError, "serve failed"):
                                                with redirect_stdout(io.StringIO()):
                                                    tauri_server.main()

        self.assertTrue(RaisingPaTcpListenerForMain.instances[0].stopped)
        self.assertTrue(RaisingPaServiceForMain.instances[0].disconnect_called)
        self.assertTrue(ramp.stop_called)
        self.assertTrue(httpd_instances[0].server_closed)
        self.assertTrue(pa_regs.closed)
        self.assertTrue(system.closed)


if __name__ == "__main__":
    unittest.main()
