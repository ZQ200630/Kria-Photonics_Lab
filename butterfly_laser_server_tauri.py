#!/usr/bin/env python3
"""
Tauri/SSE HTTP JSON server for the Butterfly Laser Driver.

Run on the board:
  sudo python3 butterfly_laser_server_tauri.py --host 0.0.0.0 --port 8080

This server is intended for a trusted lab network. It exposes direct hardware
control and does not implement authentication.
"""

import json
import signal
import threading
import time
from http.server import ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

from butterfly_laser_control import AxiMap, ButterflyLaserSystem, parse_int
from butterfly_laser_server import (
    DEFAULT_ADA_BASE,
    DEFAULT_ADA_BUF0_BASE,
    DEFAULT_ADA_BUF1_BASE,
    DEFAULT_BUFFER_SPAN,
    DEFAULT_LASER_BASE,
    DEFAULT_SETTINGS,
    DEFAULT_SPAN,
    DEFAULT_TEC_BASE,
    PA_SHUTDOWN_JOIN_TIMEOUT_S,
    ButterflyHandler,
    PaService,
    PaTcpListener,
    build_parser as build_legacy_parser,
    initialize_pl_parameters,
    load_settings,
    server_status,
    tec_ramp_from_settings,
)


def format_sse(event, payload):
    data = json.dumps(payload, separators=(",", ":"), sort_keys=True)
    return f"event: {event}\ndata: {data}\n\n"


def spectrum_key(spectrum):
    return (
        int(spectrum.get("frame_counter", -1)),
        int(spectrum.get("buffer_id", -1)),
        int(spectrum.get("count", -1)),
    )


def fault_signature(status):
    tec = status.get("tec", {})
    laser = status.get("laser", {})
    ada = status.get("ada4355", {})
    return (
        tec.get("status_hex", ""),
        tec.get("main_error_status_hex", ""),
        laser.get("status_hex", ""),
        laser.get("fault_status_hex", ""),
        laser.get("lock", {}).get("status_hex", ""),
        ada.get("status_hex", ""),
        ada.get("read_status_hex", ""),
    )


def query_float(qs, name, default, minimum=None, maximum=None):
    values = qs.get(name)
    if not values:
        value = default
    else:
        try:
            value = float(values[0])
        except (TypeError, ValueError):
            value = default
    if minimum is not None:
        value = max(float(minimum), value)
    if maximum is not None:
        value = min(float(maximum), value)
    return value


def query_int(qs, name, default, minimum=None, maximum=None):
    values = qs.get(name)
    if not values:
        value = default
    else:
        try:
            value = int(values[0])
        except (TypeError, ValueError):
            value = default
    if minimum is not None:
        value = max(int(minimum), value)
    if maximum is not None:
        value = min(int(maximum), value)
    return value


def query_bool(qs, name, default):
    values = qs.get(name)
    if not values:
        return default
    return str(values[0]).lower() not in ("0", "false", "no", "off")


class ButterflyTauriHandler(ButterflyHandler):
    server_version = "ButterflyLaserTauriServer/1.0"

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/events":
            self.handle_events()
            return
        super().do_GET()

    def handle_events(self):
        qs = parse_qs(urlparse(self.path).query)
        status_hz = query_float(qs, "status_hz", self.server.sse_status_hz, minimum=0.1, maximum=200.0)
        status_interval = 1.0 / status_hz
        heartbeat_interval = query_float(qs, "heartbeat_s", self.server.sse_heartbeat_interval, minimum=0.2)
        spectrum_enabled = query_bool(qs, "spectrum", True)
        spectrum_hz = query_float(qs, "spectrum_hz", self.server.sse_spectrum_hz, minimum=0.0, maximum=50.0)
        spectrum_interval = 1.0 / spectrum_hz if spectrum_enabled and spectrum_hz > 0 else None
        spectrum_points = query_int(qs, "spectrum_points", self.server.sse_spectrum_points, minimum=1, maximum=16384)

        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "keep-alive")
        self.end_headers()
        self.close_connection = True

        last_spectrum_key = None
        last_spectrum_poll = 0.0
        last_fault_signature = None
        last_heartbeat = 0.0

        while not self.server.stop_event.is_set():
            now = time.time()
            try:
                with self.server.lock:
                    status = server_status(self.server)
                self.write_event("status", {"timestamp": now, "status": status})

                current_fault_signature = fault_signature(status)
                if current_fault_signature != last_fault_signature:
                    last_fault_signature = current_fault_signature
                    self.write_event(
                        "fault",
                        {
                            "timestamp": now,
                            "signature": current_fault_signature,
                            "status": status,
                        },
                    )

                if spectrum_interval is not None and now - last_spectrum_poll >= spectrum_interval:
                    last_spectrum_poll = now
                    try:
                        with self.server.lock:
                            spectrum = self.server.system.ada.read_spectrum(
                                count=spectrum_points,
                                release=True,
                            )
                    except RuntimeError as exc:
                        if "no readable ADA4355 spectrum buffer" not in str(exc):
                            raise
                    else:
                        current_spectrum_key = spectrum_key(spectrum)
                        if current_spectrum_key != last_spectrum_key:
                            last_spectrum_key = current_spectrum_key
                            self.write_event("spectrum", {"timestamp": now, "spectrum": spectrum})

                if now - last_heartbeat >= heartbeat_interval:
                    last_heartbeat = now
                    self.write_event("heartbeat", {"timestamp": now})

                time.sleep(status_interval)
            except (BrokenPipeError, ConnectionResetError):
                break
            except Exception as exc:
                try:
                    self.write_event("error", {"timestamp": time.time(), "error": str(exc)})
                except Exception:
                    pass
                time.sleep(status_interval)

    def write_event(self, event, payload):
        data = format_sse(event, payload).encode("utf-8")
        self.wfile.write(data)
        self.wfile.flush()


def build_parser():
    parser = build_legacy_parser()
    parser.description = "Tauri/SSE HTTP server for Butterfly Laser Driver"
    parser.add_argument("--sse-status-hz", type=float, default=50.0, help="SSE status event rate")
    parser.add_argument("--sse-heartbeat-s", type=float, default=2.0, help="SSE heartbeat interval")
    parser.add_argument("--sse-spectrum-hz", type=float, default=5.0, help="SSE spectrum event rate, set 0 to disable")
    parser.add_argument("--sse-spectrum-points", type=int, default=16384, help="Max points per SSE spectrum event")
    return parser


def main():
    args = build_parser().parse_args()
    system = None
    pa_regs = None
    httpd = None
    try:
        system = ButterflyLaserSystem(
            tec_base=args.tec_base,
            laser_base=args.laser_base,
            span=args.span,
            ada_base=args.ada_base,
            ada_buf0_base=args.ada_buf0_base,
            ada_buf1_base=args.ada_buf1_base,
            buffer_span=args.buffer_span,
            ada_raw_base=args.ada_raw_base,
            raw_buffer_span=args.raw_buffer_span,
        )
        pa_regs = AxiMap(args.pa_axi_base, args.pa_axi_span)
        settings = load_settings(args.settings)
        httpd = ThreadingHTTPServer((args.host, args.port), ButterflyTauriHandler)
        httpd.system = system
        httpd.lock = threading.RLock()
        httpd.verbose = args.verbose
        httpd.settings = settings
        httpd.settings_path = args.settings
        httpd.tec_ramp = tec_ramp_from_settings(system.tec, httpd.lock, settings)
        initialize_pl_parameters(system, settings)
        httpd.stop_event = threading.Event()
        httpd.pa_service = PaService(pa_regs, capture_dev_path=args.pa_capture_dev)
        httpd.pa_tcp_listener = PaTcpListener(args.host, args.pa_tcp_port, httpd.pa_service, httpd.stop_event)
        httpd.pa_tcp_listener.start()
        httpd.sse_status_hz = max(float(args.sse_status_hz), 0.1)
        httpd.sse_status_interval = 1.0 / httpd.sse_status_hz
        httpd.sse_heartbeat_interval = max(float(args.sse_heartbeat_s), 0.2)
        httpd.sse_spectrum_hz = max(float(args.sse_spectrum_hz), 0.0)
        httpd.sse_spectrum_points = max(1, min(int(args.sse_spectrum_points), 16384))
        httpd.daemon_threads = True
        httpd.block_on_close = False

        def request_stop(signum, _frame):
            name = signal.Signals(signum).name
            print(f"\n{name} received, shutting down Tauri server...", flush=True)
            httpd.stop_event.set()
            raise KeyboardInterrupt

        signal.signal(signal.SIGTERM, request_stop)
        signal.signal(signal.SIGINT, request_stop)

        print(
            f"Listening on http://{args.host}:{args.port} "
            f"tec=0x{parse_int(args.tec_base):08X} laser=0x{parse_int(args.laser_base):08X} "
            f"ada=0x{parse_int(args.ada_base):08X} pa_tcp={args.pa_tcp_port} "
            f"settings={args.settings} sse=on",
            flush=True,
        )
        httpd.serve_forever(poll_interval=0.2)
    except KeyboardInterrupt:
        pass
    finally:
        if httpd is not None:
            stop_event = getattr(httpd, "stop_event", None)
            if stop_event is not None:
                stop_event.set()
            pa_tcp_listener = getattr(httpd, "pa_tcp_listener", None)
            if pa_tcp_listener is not None:
                pa_tcp_listener.stop()
            pa_service = getattr(httpd, "pa_service", None)
            if pa_service is not None:
                pa_status = pa_service.disconnect(join_timeout=PA_SHUTDOWN_JOIN_TIMEOUT_S)
                if pa_status.get("running"):
                    error = pa_status.get("last_error") or "PA shutdown timed out"
                    print(error, flush=True)
            tec_ramp = getattr(httpd, "tec_ramp", None)
            if tec_ramp is not None:
                tec_ramp.stop()
            httpd.server_close()
        if pa_regs is not None:
            pa_regs.close()
        if system is not None:
            system.close()
        print("Tauri server stopped.", flush=True)


if __name__ == "__main__":
    main()
