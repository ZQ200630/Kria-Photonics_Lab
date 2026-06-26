import threading
import unittest

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


if __name__ == "__main__":
    unittest.main()
