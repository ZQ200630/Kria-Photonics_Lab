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


class SlowJoinablePaWorker(JoinablePaWorker):
    def __init__(self):
        super().__init__()
        self.release_exit = threading.Event()

    def run_once(self, params, max_blocks=-1, capture_time_sec=0):
        self.stats["running"] = True
        self.run_entered.set()
        self.stop_requested.wait(1.0)
        self.release_exit.wait(1.0)
        self.stats["running"] = False
        self.run_exited.set()
        return dict(self.stats)


class CountingStopPaWorker(JoinablePaWorker):
    def run_once(self, params, max_blocks=-1, capture_time_sec=0):
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
    def run_once(self, params, max_blocks=-1, capture_time_sec=0):
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
    def run_once(self, params, max_blocks=-1, capture_time_sec=0):
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

    def disconnect(self):
        self.disconnect_called = True
        return {"connected": False, "running": False, "last_error": ""}

    def status(self):
        return {"connected": True, "running": False, "last_error": "", "blocks_sent": 4}


class FakePaServiceForStart:
    def __init__(self, events):
        self.events = events

    def start(self, params, max_blocks=-1, capture_time_sec=0):
        self.events.append("pa_start")
        return {"connected": True, "running": True, "last_error": ""}

    def status(self):
        return {"connected": True, "running": False, "last_error": ""}


class RaisingAlreadyRunningPaService:
    def start(self, params, max_blocks=-1, capture_time_sec=0):
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


class RecordingPaServiceForStopAll(FakePaServiceForHandler):
    def __init__(self, events):
        super().__init__()
        self.events = events
        self.join_timeout = "not called"

    def stop(self, join_timeout=0):
        self.join_timeout = join_timeout
        self.events.append("pa_stop")
        return super().stop()


class RecordingSystemForStopAll(FakeSystemForHandler):
    def __init__(self, events):
        super().__init__()
        self.events = events

    def stop_all(self):
        self.events.append("system_stop_all")
        super().stop_all()


class RaisingPaServiceForStart:
    def start(self, params, max_blocks=-1, capture_time_sec=0):
        raise RuntimeError("PA TCP client is not connected")

    def status(self):
        return {"connected": False, "running": False, "last_error": ""}


class HandlerPaEndpointTests(unittest.TestCase):
    def make_handler(self, path, method="GET", body=b""):
        server = mock.Mock()
        server.lock = threading.RLock()
        server.tec_ramp = FakeRamp()
        server.pa_service = FakePaServiceForHandler()
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
        self.assertIn("/api/pa/stop", endpoints)
        self.assertIn("/api/pa/disconnect", endpoints)

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

    def test_pa_stop_endpoint_calls_service_stop(self):
        handler, server, replies = self.make_handler("/api/pa/stop", method="POST", body=b"{}")

        legacy.ButterflyHandler.do_POST(handler)

        self.assertTrue(server.pa_service.stop_called)
        self.assertEqual(replies[0][0], 200)
        self.assertTrue(replies[0][1]["ok"])

    def test_pa_disconnect_endpoint_calls_service_disconnect(self):
        handler, server, replies = self.make_handler("/api/pa/disconnect", method="POST", body=b"{}")

        legacy.ButterflyHandler.do_POST(handler)

        self.assertTrue(server.pa_service.disconnect_called)
        self.assertEqual(replies[0], (200, {
            "ok": True,
            "pa": {"connected": False, "running": False, "last_error": ""},
        }))

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

        legacy.ButterflyHandler.do_POST(handler)

        self.assertEqual(events, ["lock_enter", "pa_stop", "system_stop_all", "lock_exit"])
        self.assertIsNone(server.pa_service.join_timeout)
        self.assertEqual(replies[0][0], 200)

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


class FakeSystemForMain(FakeCloseable):
    tec = object()

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


if __name__ == "__main__":
    unittest.main()
