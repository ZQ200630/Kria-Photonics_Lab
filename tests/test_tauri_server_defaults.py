import io
import threading
import unittest
from contextlib import redirect_stdout
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


class FakePaSocket:
    def __init__(self):
        self.closed = False

    def close(self):
        self.closed = True


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

    def run_once(self, params, max_blocks=-1, capture_time_sec=0):
        self.calls.append((params, max_blocks, capture_time_sec))
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

    def run_once(self, params, max_blocks=-1, capture_time_sec=0):
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

    def run_once(self, params, max_blocks=-1, capture_time_sec=0):
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

    def run_once(self, params, max_blocks=-1, capture_time_sec=0):
        self.stats["running"] = True
        self.run_entered.set()
        self.stop_requested.wait(1.0)
        self.stats["running"] = False
        self.run_exited.set()
        return dict(self.stats)

    def request_stop(self):
        self.stop_requested.set()


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
        self.assertEqual(worker.calls[0][1:], (3, 0.25))
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
        service.worker_thread.join(0.5)

        replacement_socket = FakePaSocket()
        status = service.attach_socket(replacement_socket)

        self.assertTrue(writers[0].closed)
        self.assertFalse(replacement_socket.closed)
        self.assertTrue(status["connected"])

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
        worker.release_run.set()
        service.worker_thread.join(0.5)

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
        self.assertFalse(service.worker_thread.is_alive())
        self.assertTrue(writer.closed)
        self.assertFalse(status["connected"])


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


class PaTcpListenerTests(unittest.TestCase):
    def test_stop_closes_listener_and_joins_thread(self):
        stop_event = threading.Event()
        service = mock.Mock()
        listener = legacy.PaTcpListener("127.0.0.1", 9090, service, stop_event)
        fake_thread = FakeThread()
        fake_socket = FakeListenerSocket()
        listener.thread = fake_thread
        listener.listener = fake_socket

        listener.stop()

        self.assertTrue(stop_event.is_set())
        self.assertTrue(fake_socket.closed)
        self.assertEqual(fake_thread.join_calls, [1.0])


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

    def stop(self):
        self.stop_called = True
        return {"connected": True, "running": False, "last_error": ""}

    def status(self):
        return {"connected": True, "running": False, "last_error": ""}


class FakeSystemForHandler:
    def __init__(self):
        self.stop_all_called = False

    def stop_all(self):
        self.stop_all_called = True

    def status(self):
        return {"laser": {}, "tec": {}, "ada4355": {}}


class HandlerPaEndpointTests(unittest.TestCase):
    def test_stop_all_stops_pa_service_when_present(self):
        server = mock.Mock()
        server.lock = threading.RLock()
        server.tec_ramp = FakeRamp()
        server.pa_service = FakePaServiceForHandler()
        server.system = FakeSystemForHandler()
        handler = legacy.ButterflyHandler.__new__(legacy.ButterflyHandler)
        handler.server = server
        handler.path = "/api/stop-all"
        handler.headers = {"Content-Length": "0"}
        handler.rfile = io.BytesIO(b"")
        replies = []
        handler.reply_json = lambda obj, status=200: replies.append((status, obj))
        handler.reply_error = lambda status, message: replies.append((status, {"ok": False, "error": message}))

        legacy.ButterflyHandler.do_POST(handler)

        self.assertTrue(server.pa_service.stop_called)
        self.assertTrue(server.system.stop_all_called)
        self.assertEqual(replies[0][0], 200)


class FakeCloseable:
    def __init__(self):
        self.closed = False

    def close(self):
        self.closed = True


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


if __name__ == "__main__":
    unittest.main()
