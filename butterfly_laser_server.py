#!/usr/bin/env python3
"""
HTTP JSON server for the Butterfly Laser Driver.

Run on the board:
  sudo python3 butterfly_laser_server.py --host 0.0.0.0 --port 8080

This server is intended for a trusted lab network. It exposes direct hardware
control and does not implement authentication.
"""

import argparse
import json
import os
import signal
import socket
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

from butterfly_laser_control import (
    AxiMap,
    DEFAULT_ADA_BASE,
    DEFAULT_ADA_BUF0_BASE,
    DEFAULT_ADA_BUF1_BASE,
    DEFAULT_ADA_RAW_BASE,
    DEFAULT_BUFFER_SPAN,
    DEFAULT_LASER_BASE,
    DEFAULT_RAW_BUFFER_SPAN,
    DEFAULT_SPAN,
    DEFAULT_TEC_BASE,
    ButterflyLaserSystem,
    parse_int,
    require_u16,
    require_u32,
)
from pa_imaging_capture import (
    PAM_AXI_DEFAULT_BASE,
    PAM_AXI_MAP_SPAN,
    AxisCaptureDevice,
    ConnectedPaWriter,
    PaCaptureWorker,
    PamAxiController,
    PamCaptureParams,
)


SETTINGS_SCHEMA_VERSION = 6


DEFAULT_SETTINGS = {
    "settings_schema_version": SETTINGS_SCHEMA_VERSION,
    "tec": {
        "target_celsius": "31.0",
        "manual_dac": "0x800",
        "open_loop_enable": "false",
        "pid": {
            "kp": "1",
            "ki": "0.003",
            "kd": "0",
            "integral_limit": "300000",
            "max_step": "10",
            "dac_bias": "0x800",
            "dac_min": "1800",
            "dac_max": "2150",
            "dac_safe": "0x800",
        },
        "protection": {
            "temp_min_celsius": "20.0",
            "temp_max_celsius": "40.0",
            "alpha": "65535",
            "rdy_timeout": "5000000",
            "spi_clk_div": "10",
        },
        "ramp": {
            "enabled": True,
            "rate_c_per_s": "0.05",
            "interval_ms": "200",
        },
    },
    "laser": {
        "static": {
            "ch0": "5000",
            "ch1": "0",
        },
        "fine_scan": {
            "ch0": "26000",
            "start": "20000",
            "stop": "30000",
            "step": "10",
            "dwell": "100",
            "settle": "100",
            "frames": "1",
            "continuous": True,
        },
        "lock": {
            "ch0": "5000",
            "target_adc": "42000",
            "bias_ch1": "25000",
            "range_halfspan": "5000",
            "ch1_min": "20000",
            "ch1_max": "30000",
            "kp": "0.5",
            "ki": "0.01",
            "polarity_invert": False,
            "integral_limit": "500000",
            "max_step": "3",
            "locked_threshold": "1000",
            "loss_threshold": "10000",
            "locked_count": "50",
            "loss_count": "10",
            "sat_count": "100",
            "fb_timeout": "0",
            "adc_min_valid": "0",
            "adc_max_valid": "0",
        },
        "protection": {
            "ch0_min": "0",
            "ch0_max": "40000",
            "ch1_min": "0",
            "ch1_max": "40000",
            "ch0_soft_step": "8",
            "ch1_soft_step": "8",
            "ramp_interval": "1000",
            "dac_timeout": "1000000",
            "watchdog_timeout": "0",
            "enable_delay": "0",
            "current_limit": "0",
            "ch0_gain": "0",
            "ch1_gain": "0",
            "current_offset": "0",
        },
    },
    "ada4355": {
        "monitor_rate_hz": "100000",
        "sample_delay": "0",
        "sample_window": "1024",
        "max_points": "16384",
        "spectrum_points": "16384",
        "raw_length": "16384",
        "raw_decim": "1",
        "frame_decim": "1000",
        "filter_control": "0x19",
        "glitch_threshold": "3000",
        "lp_shift": "13",
        "raw_lp_shift": "13",
    },
}


LEGACY_DEFAULT_REPLACEMENTS = (
    (("tec", "pid", "kp"), "0.05", "0.5"),
    (("tec", "pid", "kp"), "0.5", "1"),
    (("tec", "pid", "ki"), "0.00025", "0.001"),
    (("tec", "pid", "ki"), "0.001", "0.003"),
    (("tec", "pid", "integral_limit"), "80000", "300000"),
    (("tec", "pid", "integral_limit"), "500000", "300000"),
    (("tec", "pid", "dac_min"), "0x740", "1800"),
    (("tec", "pid", "dac_min"), "1856", "1800"),
    (("tec", "pid", "dac_min"), "1748", "1800"),
    (("tec", "pid", "dac_max"), "0x8c0", "2150"),
    (("tec", "pid", "dac_max"), "2240", "2150"),
    (("tec", "pid", "dac_max"), "2348", "2150"),
    (("tec", "protection", "temp_min_celsius"), "10.0", "20.0"),
    (("laser", "fine_scan", "ch0"), "5000", "26000"),
    (("laser", "fine_scan", "start"), "1000", "20000"),
    (("laser", "fine_scan", "stop"), "5000", "30000"),
    (("laser", "fine_scan", "dwell"), "100000", "100"),
    (("laser", "fine_scan", "settle"), "1000", "100"),
    (("laser", "protection", "ch0_max"), "20000", "40000"),
    (("laser", "protection", "ch1_max"), "10000", "50000"),
    (("laser", "protection", "ch1_max"), "50000", "40000"),
    (("laser", "lock", "bias_ch1"), "3000", "25000"),
    (("laser", "lock", "range_halfspan"), "500", "5000"),
    (("laser", "lock", "ch1_min"), "2500", "20000"),
    (("laser", "lock", "ch1_max"), "3500", "30000"),
    (("laser", "lock", "kp"), "0.05", "0.5"),
    (("laser", "lock", "ki"), "0", "0.01"),
    (("laser", "lock", "max_step"), "2", "10"),
    (("laser", "lock", "max_step"), "10", "3"),
    (("laser", "lock", "integral_limit"), "100000", "500000"),
    (("laser", "lock", "locked_threshold"), "20", "1000"),
    (("laser", "lock", "loss_threshold"), "500", "10000"),
    (("ada4355", "monitor_rate_hz"), "1000", "100000"),
    (("ada4355", "lp_shift"), "11", "13"),
)


def deep_merge(defaults, override):
    if not isinstance(defaults, dict):
        return override
    merged = dict(defaults)
    if isinstance(override, dict):
        for key, value in override.items():
            if isinstance(value, dict) and isinstance(merged.get(key), dict):
                merged[key] = deep_merge(merged[key], value)
            else:
                merged[key] = value
    return merged


def replace_if_legacy_default(settings, path, old_value, new_value):
    node = settings
    for key in path[:-1]:
        next_node = node.get(key)
        if not isinstance(next_node, dict):
            return
        node = next_node
    leaf = path[-1]
    if str(node.get(leaf)) == old_value:
        node[leaf] = new_value


def migrate_settings(settings):
    if not isinstance(settings, dict):
        return {}
    try:
        schema_version = int(settings.get("settings_schema_version", 1))
    except (TypeError, ValueError):
        schema_version = 1
    for path, old_value, new_value in LEGACY_DEFAULT_REPLACEMENTS:
        replace_if_legacy_default(settings, path, old_value, new_value)
    if schema_version < SETTINGS_SCHEMA_VERSION:
        settings["settings_schema_version"] = SETTINGS_SCHEMA_VERSION
    return settings


def load_settings(path):
    if not os.path.exists(path):
        settings = deep_merge(DEFAULT_SETTINGS, {})
        save_settings(path, settings)
        return settings
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    settings = deep_merge(DEFAULT_SETTINGS, migrate_settings(data))
    if data != settings:
        save_settings(path, settings)
    return settings


def save_settings(path, settings):
    directory = os.path.dirname(os.path.abspath(path))
    if directory:
        os.makedirs(directory, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(settings, f, indent=2, sort_keys=True)
        f.write("\n")


class TecTargetRamp:
    def __init__(self, tec, lock=None, enabled=True, rate_c_per_s=0.05, interval_ms=200):
        self.tec = tec
        self.hardware_lock = lock or threading.RLock()
        self.state_lock = threading.RLock()
        self.enabled = bool(enabled)
        self.rate_c_per_s = max(float(rate_c_per_s), 0.0)
        self.interval_ms = max(int(interval_ms), 1)
        self.active = False
        self.current_celsius = None
        self.target_celsius = None
        self.last_update_time = None
        self._generation = 0

    def configure(self, enabled=None, rate_c_per_s=None, interval_ms=None):
        with self.state_lock:
            if enabled is not None:
                self.enabled = bool(enabled)
            if rate_c_per_s is not None:
                self.rate_c_per_s = max(float(rate_c_per_s), 0.0)
            if interval_ms is not None:
                self.interval_ms = max(int(interval_ms), 1)
            return self.status()

    def start(self, target_celsius, rate_c_per_s=None, interval_ms=None, enabled=None, run_async=True):
        if rate_c_per_s is not None or interval_ms is not None or enabled is not None:
            self.configure(enabled=enabled, rate_c_per_s=rate_c_per_s, interval_ms=interval_ms)

        final_target = float(target_celsius)
        current_target = self._read_current_target(final_target)
        with self.state_lock:
            self.target_celsius = final_target
            self.current_celsius = current_target
            self._generation += 1
            generation = self._generation
            step_celsius = self._step_celsius_locked()
            self.active = self.enabled and step_celsius > 0.0 and abs(final_target - current_target) > 1e-9

        if not self.active:
            self._write_target(final_target)
            with self.state_lock:
                self.current_celsius = final_target
                self.last_update_time = time.time()
            return self.status()

        if run_async:
            thread = threading.Thread(target=self._run_worker, args=(generation,), daemon=True)
            thread.start()
        return self.status()

    def stop(self):
        with self.state_lock:
            self.active = False
            self._generation += 1
            return self.status()

    def step_once(self, generation=None):
        with self.state_lock:
            if generation is not None and generation != self._generation:
                return True
            if not self.active or self.target_celsius is None or self.current_celsius is None:
                return True

            remaining = self.target_celsius - self.current_celsius
            step_celsius = self._step_celsius_locked()
            if step_celsius <= 0.0 or abs(remaining) <= step_celsius:
                next_target = self.target_celsius
                self.active = False
                done = True
            elif remaining > 0:
                next_target = self.current_celsius + step_celsius
                done = False
            else:
                next_target = self.current_celsius - step_celsius
                done = False

            self.current_celsius = next_target
            self.last_update_time = time.time()

        self._write_target(next_target)
        return done

    def status(self):
        with self.state_lock:
            return {
                "active": self.active,
                "enabled": self.enabled,
                "target_celsius": self.target_celsius,
                "current_celsius": self.current_celsius,
                "rate_c_per_s": self.rate_c_per_s,
                "interval_ms": self.interval_ms,
                "last_update_time": self.last_update_time,
            }

    def _run_worker(self, generation):
        while True:
            done = self.step_once(generation=generation)
            if done:
                return
            with self.state_lock:
                interval_s = self.interval_ms / 1000.0
            time.sleep(interval_s)

    def _read_current_target(self, fallback):
        try:
            with self.hardware_lock:
                status = self.tec.status()
            value = status.get("target_celsius", status.get("target_c", fallback))
            return float(value)
        except Exception:
            return fallback

    def _write_target(self, target_celsius):
        with self.hardware_lock:
            self.tec.set_target_celsius(float(target_celsius))

    def _step_celsius_locked(self):
        return self.rate_c_per_s * (self.interval_ms / 1000.0)


def tec_ramp_from_settings(tec, lock, settings):
    ramp = settings.get("tec", {}).get("ramp", {})
    return TecTargetRamp(
        tec,
        lock=lock,
        enabled=bool_body(ramp, "enabled", True),
        rate_c_per_s=float(ramp.get("rate_c_per_s", 0.05)),
        interval_ms=body_int(ramp, "interval_ms", 200),
    )


class PaService:
    def __init__(
        self,
        pam_regs,
        capture_dev_path="/dev/axis_capture0",
        writer_factory=ConnectedPaWriter,
        pam_factory=PamAxiController,
        device_factory=AxisCaptureDevice,
        worker_factory=PaCaptureWorker,
    ):
        self.pam_regs = pam_regs
        self.capture_dev_path = capture_dev_path
        self.writer_factory = writer_factory
        self.pam_factory = pam_factory
        self.device_factory = device_factory
        self.worker_factory = worker_factory
        self.state_lock = threading.RLock()
        self.writer = None
        self.worker = None
        self.worker_thread = None
        self.worker_token = None
        self.client_socket = None
        self.writer_token = None
        self.last_stats = self._new_stats()
        self.last_error = ""

    def attach_socket(self, sock):
        with self.state_lock:
            if self.writer is not None:
                self.last_error = "PA TCP client already connected"
                self._close_socket(sock)
                return self._status_locked()
            self.client_socket = sock
            self.writer = self.writer_factory(sock)
            self.writer_token = object()
            self.last_error = ""
            return self._status_locked()

    def start(self, params, max_blocks=-1, capture_time_sec=0):
        with self.state_lock:
            if self.writer is None:
                raise RuntimeError("PA TCP client is not connected")
            if self._capture_active_locked():
                raise RuntimeError("PA capture is already running")
            pam = self.pam_factory(self.pam_regs)
            device = self.device_factory(self.capture_dev_path)
            worker = self.worker_factory(pam, device, self.writer)
            worker_writer = self.writer
            writer_token = self.writer_token
            worker_token = object()
            self.worker = worker
            self.worker_token = worker_token
            self.worker_thread = threading.Thread(
                target=self._run_worker,
                args=(worker, worker_writer, writer_token, worker_token, params, int(max_blocks), float(capture_time_sec)),
                name="pa-capture-worker",
                daemon=True,
            )
            self.last_error = ""
            self.worker_thread.start()
            return self._status_locked()

    def stop(self):
        with self.state_lock:
            if self.worker is not None:
                self.worker.request_stop()
            return self._status_locked()

    def disconnect(self, join_timeout=0):
        with self.state_lock:
            if self.worker is not None:
                self.worker.request_stop()
            writer = self.writer
            sock = self.client_socket
            worker_thread = self.worker_thread
            self.writer = None
            self.client_socket = None
            self.writer_token = None
            if writer is not None:
                try:
                    writer.close_client()
                except Exception as exc:
                    self.last_error = str(exc)
            elif sock is not None:
                self._close_socket(sock)
        if worker_thread is not None and worker_thread is not threading.current_thread():
            worker_thread.join(timeout=None if join_timeout is None else float(join_timeout))
        with self.state_lock:
            return self._status_locked()

    def status(self):
        with self.state_lock:
            return self._status_locked()

    def _run_worker(self, worker, worker_writer, writer_token, worker_token, params, max_blocks, capture_time_sec):
        try:
            worker.run_once(params, max_blocks=max_blocks, capture_time_sec=capture_time_sec)
        except Exception as exc:
            with self.state_lock:
                if self.worker is worker and self.worker_token is worker_token:
                    self.last_error = str(exc)
                writer = self.writer if self.writer is worker_writer and self.writer_token is writer_token else None
                if writer is not None:
                    self.writer = None
                    self.client_socket = None
                    self.writer_token = None
            if writer is not None:
                try:
                    writer.close_client()
                except Exception as close_exc:
                    with self.state_lock:
                        self.last_error = f"{exc}; close failed: {close_exc}"
        finally:
            with self.state_lock:
                if self.worker is worker:
                    stats = self._snapshot_worker_stats(worker)
                    if self.worker_token is worker_token:
                        self.last_stats = stats
                    self.worker = None
                    self.worker_thread = None
                    self.worker_token = None

    def _capture_active_locked(self):
        return self.worker_thread is not None and self.worker_thread.is_alive()

    def _status_locked(self):
        running = self._capture_active_locked()
        if running and self.worker is not None:
            stats = dict(getattr(self.worker, "stats", {}) or {})
        else:
            stats = dict(self.last_stats)
        return {
            "connected": self.writer is not None,
            "running": running,
            "last_error": self.last_error,
            "blocks_sent": int(stats.get("blocks_sent", 0) or 0),
            "frames_sent": int(stats.get("frames_sent", 0) or 0),
            "bytes_sent": int(stats.get("bytes_sent", 0) or 0),
            "end_reason": str(stats.get("end_reason", "")),
        }

    def _new_stats(self):
        return {
            "running": False,
            "blocks_sent": 0,
            "frames_sent": 0,
            "bytes_sent": 0,
            "last_error": "",
            "end_reason": "",
        }

    def _snapshot_worker_stats(self, worker):
        stats = self._new_stats()
        stats.update(dict(getattr(worker, "stats", {}) or {}))
        stats["running"] = False
        if self.last_error:
            stats["last_error"] = self.last_error
        return stats

    def _close_socket(self, sock):
        try:
            sock.shutdown(socket.SHUT_RDWR)
        except (AttributeError, OSError):
            pass
        try:
            sock.close()
        except OSError:
            pass


class PaTcpListener:
    def __init__(self, host, port, service, stop_event, join_timeout=1.0):
        self.host = host
        self.port = int(port)
        self.service = service
        self.stop_event = stop_event
        self.join_timeout = float(join_timeout)
        self.listener = None
        self.thread = threading.Thread(target=self._run, name="pa-tcp-listener", daemon=True)

    def start(self):
        listener = None
        try:
            listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            listener.bind((self.host, self.port))
            listener.listen(1)
            listener.settimeout(0.2)
        except Exception as exc:
            self._record_error(exc)
            try:
                listener.close()
            except Exception:
                pass
            raise
        self.listener = listener
        self.thread.start()

    def stop(self):
        self.stop_event.set()
        if self.listener is not None:
            try:
                self.listener.close()
            except OSError:
                pass
        if self.thread is not threading.current_thread():
            self.thread.join(timeout=self.join_timeout)

    def _run(self):
        try:
            listener = self.listener
            if listener is None:
                return
            while not self.stop_event.is_set():
                try:
                    client, _addr = listener.accept()
                except socket.timeout:
                    continue
                except OSError as exc:
                    if not self.stop_event.is_set():
                        self._record_error(exc)
                    break
                try:
                    self.service.attach_socket(client)
                except Exception as exc:
                    self._record_error(exc)
                    self._close_client(client)
        except Exception as exc:
            if not self.stop_event.is_set():
                self._record_error(exc)
        finally:
            listener = self.listener
            self.listener = None
            if listener is not None:
                try:
                    listener.close()
                except OSError:
                    pass

    def _record_error(self, exc):
        with self.service.state_lock:
            self.service.last_error = str(exc)

    def _close_client(self, client):
        try:
            client.shutdown(socket.SHUT_RDWR)
        except (AttributeError, OSError):
            pass
        try:
            client.close()
        except OSError:
            pass


def server_status(server):
    status = server.system.status()
    ramp = getattr(server, "tec_ramp", None)
    if ramp is not None:
        status.setdefault("tec", {})["ramp"] = ramp.status()
    pa_service = getattr(server, "pa_service", None)
    if pa_service is not None:
        status["pa"] = pa_service.status()
    return status


def apply_saved_settings(system, settings):
    tec = settings.get("tec", {})
    pid = tec.get("pid", {})
    prot = tec.get("protection", {})
    laser = settings.get("laser", {})
    laser_prot = laser.get("protection", {})
    lock = laser.get("lock", {})
    ada = settings.get("ada4355", {})

    if "target_celsius" in tec:
        system.tec.set_target_celsius(float(tec["target_celsius"]))
    system.tec.configure_pid(
        kp=float(pid["kp"]) if "kp" in pid else None,
        ki=float(pid["ki"]) if "ki" in pid else None,
        kd=float(pid["kd"]) if "kd" in pid else None,
        integral_limit=body_int(pid, "integral_limit") if "integral_limit" in pid else None,
        max_step=body_int(pid, "max_step") if "max_step" in pid else None,
        dac_min=body_int(pid, "dac_min") if "dac_min" in pid else None,
        dac_max=body_int(pid, "dac_max") if "dac_max" in pid else None,
        dac_bias=body_int(pid, "dac_bias") if "dac_bias" in pid else None,
        dac_safe=body_int(pid, "dac_safe") if "dac_safe" in pid else None,
    )
    if prot:
        if "temp_min_celsius" in prot:
            system.tec.write("TEMP_MIN", int(round(float(prot["temp_min_celsius"]) * 1000.0)))
        if "temp_max_celsius" in prot:
            system.tec.write("TEMP_MAX", int(round(float(prot["temp_max_celsius"]) * 1000.0)))
        if "alpha" in prot:
            system.tec.write("TEMP_ALPHA", body_int(prot, "alpha"))
        if "rdy_timeout" in prot:
            system.tec.write("RDY_TIMEOUT", body_int(prot, "rdy_timeout"))
        if "spi_clk_div" in prot:
            system.tec.write("SPI_CLK_DIV", body_int(prot, "spi_clk_div"))
    if laser_prot:
        system.laser.configure_safety(**laser_safety_from_body(laser_prot))
    if lock:
        system.laser.write("CH0_STATIC_CODE", body_int(lock, "ch0", 5000))
        system.laser.configure_lock(
            target_adc=body_int(lock, "target_adc", 42000),
            bias_ch1=body_int(lock, "bias_ch1", 3000),
            ch1_min=body_int(lock, "ch1_min", 20000),
            ch1_max=body_int(lock, "ch1_max", 30000),
            kp=float(lock.get("kp", 0.5)),
            ki=float(lock.get("ki", 0.01)),
            polarity_invert=bool_body(lock, "polarity_invert", False),
            integral_limit=body_int(lock, "integral_limit", 500000),
            max_step=body_int(lock, "max_step", 3),
            locked_threshold=body_int(lock, "locked_threshold", 1000),
            loss_threshold=body_int(lock, "loss_threshold", 10000),
            locked_count=body_int(lock, "locked_count", 50),
            loss_count=body_int(lock, "loss_count", 10),
            sat_count=body_int(lock, "sat_count", 100),
            fb_timeout=body_int(lock, "fb_timeout", 0),
            adc_min_valid=body_int(lock, "adc_min_valid", 0),
            adc_max_valid=body_int(lock, "adc_max_valid", 0),
        )
    if ada:
        if "monitor_rate_hz" in ada:
            system.ada.set_monitor_rate_hz(float(ada["monitor_rate_hz"]))
        system.ada.configure_capture(
            sample_delay=body_int(ada, "sample_delay") if "sample_delay" in ada else None,
            sample_window=body_int(ada, "sample_window") if "sample_window" in ada else None,
            max_points=body_int(ada, "max_points") if "max_points" in ada else None,
            frame_decim=body_int(ada, "frame_decim") if "frame_decim" in ada else None,
        )
        system.ada.configure_filter(
            control=body_int(ada, "filter_control") if "filter_control" in ada else None,
            threshold=body_int(ada, "glitch_threshold") if "glitch_threshold" in ada else None,
            lp_shift=body_int(ada, "lp_shift") if "lp_shift" in ada else None,
            raw_lp_shift=body_int(ada, "raw_lp_shift") if "raw_lp_shift" in ada else None,
        )


def initialize_pl_parameters(system, settings):
    """Write persisted/default parameters to PL without enabling TEC or laser output."""
    apply_saved_settings(system, settings)


def is_tec_enabled_for_laser(tec_status):
    return "tec_enabled" in set(tec_status.get("status_flags", []))


def parse_body(handler):
    length = int(handler.headers.get("Content-Length", "0"))
    if length == 0:
        return {}
    return json.loads(handler.rfile.read(length).decode("utf-8"))


def body_int(body, name, default=None):
    if name in body:
        return parse_int(body[name])
    if default is not None:
        return default
    raise KeyError(name)


def bool_body(body, name, default=False):
    value = body.get(name, default)
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.lower() in ("1", "true", "yes", "on")
    return bool(value)


def laser_safety_from_body(body):
    return {
        "ch0_min": body_int(body, "ch0_min", 0),
        "ch0_max": body_int(body, "ch0_max", 40000),
        "ch1_min": body_int(body, "ch1_min", 0),
        "ch1_max": body_int(body, "ch1_max", 40000),
        "ch0_soft_step": body_int(body, "ch0_soft_step", 8),
        "ch1_soft_step": body_int(body, "ch1_soft_step", 8),
        "ramp_interval": body_int(body, "ramp_interval", 1000),
        "dac_timeout": body_int(body, "dac_timeout", 1000000),
        "watchdog_timeout": body_int(body, "watchdog_timeout", 0),
        "enable_delay": body_int(body, "enable_delay", 0),
        "current_limit": body_int(body, "current_limit", 0),
        "ch0_gain": body_int(body, "ch0_gain", 0),
        "ch1_gain": body_int(body, "ch1_gain", 0),
        "current_offset": body_int(body, "current_offset", 0),
    }


def laser_lock_from_body(body):
    return {
        "target_adc": body_int(body, "target_adc", 42000),
        "bias_ch1": body_int(body, "bias_ch1", 25000),
        "ch1_min": body_int(body, "lock_ch1_min", body_int(body, "ch1_min", 20000)),
        "ch1_max": body_int(body, "lock_ch1_max", body_int(body, "ch1_max", 30000)),
        "kp": float(body.get("lock_kp", body.get("kp", 0.5))),
        "ki": float(body.get("lock_ki", body.get("ki", 0.01))),
        "polarity_invert": bool_body(body, "polarity_invert", False),
        "integral_limit": body_int(body, "lock_integral_limit", body_int(body, "integral_limit", 500000)),
        "max_step": body_int(body, "lock_max_step", body_int(body, "max_step", 3)),
        "locked_threshold": body_int(body, "locked_threshold", 1000),
        "loss_threshold": body_int(body, "loss_threshold", 10000),
        "locked_count": body_int(body, "locked_count", 50),
        "loss_count": body_int(body, "loss_count", 10),
        "sat_count": body_int(body, "sat_count", 100),
        "fb_timeout": body_int(body, "fb_timeout", 0),
        "adc_min_valid": body_int(body, "adc_min_valid", 0),
        "adc_max_valid": body_int(body, "adc_max_valid", 0),
    }


def laser_acquire_from_body(body):
    marker = body_int(body, "marker_ch1_code", body_int(body, "bias_ch1", 25000))
    halfspan = body_int(body, "search_halfspan_code", body_int(body, "lock_halfspan", 1000))
    search_min = body_int(body, "search_min_code", body_int(body, "search_min", max(0, marker - halfspan)))
    search_max = body_int(body, "search_max_code", body_int(body, "search_max", min(65535, marker + halfspan)))
    return {
        "marker_ch1_code": marker,
        "search_min": search_min,
        "search_max": search_max,
        "threshold": body_int(body, "acquire_threshold", body_int(body, "locked_threshold", 1000)),
    }


class ButterflyHandler(BaseHTTPRequestHandler):
    server_version = "ButterflyLaserServer/1.0"

    def log_message(self, fmt, *args):
        if self.server.verbose:
            super().log_message(fmt, *args)

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

    def require_tec_enabled_for_laser(self):
        tec_status = self.server.system.tec.status()
        if is_tec_enabled_for_laser(tec_status):
            return True
        self.reply_json({
            "ok": False,
            "error": "TEC must be enabled before laser output can be enabled",
            "tec": tec_status,
            "status": server_status(self.server),
        }, status=409)
        return False

    def do_GET(self):
        try:
            parsed = urlparse(self.path)
            if parsed.path == "/":
                self.reply_json({
                    "ok": True,
                    "name": "Butterfly Laser Driver",
                    "endpoints": [
                        "/api/status",
                        "/api/settings",
                        "/api/registers",
                        "/api/read",
                        "/api/tec/start",
                        "/api/tec/target",
                        "/api/tec/ramp-target",
                        "/api/tec/ramp",
                        "/api/tec/ramp-stop",
                        "/api/tec/pid",
                        "/api/tec/protection",
                        "/api/tec/open-loop",
                        "/api/tec/stop",
                        "/api/laser/static",
                        "/api/laser/on",
                        "/api/laser/off",
                        "/api/laser/static-setpoint",
                        "/api/laser/fine-scan",
                        "/api/laser/stop-scan",
                        "/api/laser/lock-start",
                        "/api/laser/lock-params",
                        "/api/laser/lock-hold",
                        "/api/laser/lock-clear",
                        "/api/laser/acquire-template",
                        "/api/laser/acquire-arm",
                        "/api/laser/acquire-cancel",
                        "/api/laser/protection",
                        "/api/ada/start",
                        "/api/ada/status",
                        "/api/ada/spectrum",
                        "/api/ada/filter",
                        "/api/pa/status",
                        "/api/pa/start",
                        "/api/pa/stop",
                        "/api/pa/disconnect",
                        "/api/stop-all",
                    ],
                })
            elif parsed.path == "/api/status":
                with self.server.lock:
                    self.reply_json({"ok": True, "status": server_status(self.server)})
            elif parsed.path == "/api/pa/status":
                self.reply_json({"ok": True, "pa": self.server.pa_service.status()})
            elif parsed.path == "/api/settings":
                with self.server.lock:
                    self.reply_json({
                        "ok": True,
                        "path": self.server.settings_path,
                        "settings": self.server.settings,
                    })
            elif parsed.path == "/api/registers":
                with self.server.lock:
                    self.reply_json({
                        "ok": True,
                        "tec": self.server.system.tec.dump_registers(),
                        "laser": self.server.system.laser.dump_registers(),
                        "ada4355": self.server.system.ada.dump_registers(),
                    })
            elif parsed.path == "/api/ada/status":
                with self.server.lock:
                    self.reply_json({"ok": True, "ada4355": self.server.system.ada.status()})
            elif parsed.path == "/api/ada/spectrum":
                qs = parse_qs(parsed.query)
                points_text = qs.get("points", [None])[0]
                count = require_u32("points", points_text) if points_text is not None else None
                release = qs.get("release", ["true"])[0].lower() not in ("0", "false", "no", "off")
                with self.server.lock:
                    spectrum = self.server.system.ada.read_spectrum(count=count, release=release)
                self.reply_json({"ok": True, "spectrum": spectrum})
            elif parsed.path == "/api/ada/raw":
                qs = parse_qs(parsed.query)
                count_text = qs.get("count", [None])[0]
                count = require_u32("count", count_text) if count_text is not None else None
                with self.server.lock:
                    raw = self.server.system.ada.read_raw(count=count)
                self.reply_json({"ok": True, "raw": raw})
            elif parsed.path == "/api/read":
                qs = parse_qs(parsed.query)
                block = qs.get("block", [""])[0]
                offset = require_u32("offset", qs.get("offset", [None])[0])
                value = self.read_block(block, offset)
                self.reply_json({
                    "ok": True,
                    "block": block,
                    "offset": offset,
                    "offset_hex": f"0x{offset:02X}",
                    "value": value,
                    "value_hex": f"0x{value:08X}",
                })
            else:
                self.reply_error(404, "unknown endpoint")
        except Exception as exc:
            self.reply_error(400, str(exc))

    def do_POST(self):
        try:
            parsed = urlparse(self.path)
            body = parse_body(self)
            if parsed.path.startswith("/api/pa/"):
                self.handle_pa_post(parsed.path, body)
                return
            with self.server.lock:
                if parsed.path == "/api/tec/start":
                    target = body.get("celsius", body.get("target_celsius"))
                    reset = bool_body(body, "reset", True)
                    self.server.tec_ramp.stop()
                    status = self.server.system.start_tec_default(target, reset=reset)
                    self.reply_json({"ok": True, "tec": server_status(self.server)["tec"]})
                elif parsed.path == "/api/tec/target":
                    target = body.get("celsius", body.get("target_celsius"))
                    if target is None:
                        raise KeyError("celsius")
                    self.server.tec_ramp.stop()
                    self.server.system.tec.set_target_celsius(float(target))
                    self.reply_json({"ok": True, "tec": server_status(self.server)["tec"]})
                elif parsed.path == "/api/tec/ramp-target":
                    target = body.get("celsius", body.get("target_celsius"))
                    if target is None:
                        raise KeyError("celsius")
                    self.server.tec_ramp.start(
                        float(target),
                        rate_c_per_s=float(body["rate_c_per_s"]) if "rate_c_per_s" in body else None,
                        interval_ms=body_int(body, "interval_ms") if "interval_ms" in body else None,
                        enabled=bool_body(body, "enabled") if "enabled" in body else None,
                    )
                    self.reply_json({"ok": True, "tec": server_status(self.server)["tec"]})
                elif parsed.path == "/api/tec/ramp":
                    self.server.tec_ramp.configure(
                        enabled=bool_body(body, "enabled") if "enabled" in body else None,
                        rate_c_per_s=float(body["rate_c_per_s"]) if "rate_c_per_s" in body else None,
                        interval_ms=body_int(body, "interval_ms") if "interval_ms" in body else None,
                    )
                    self.reply_json({"ok": True, "tec": server_status(self.server)["tec"]})
                elif parsed.path == "/api/tec/ramp-stop":
                    self.server.tec_ramp.stop()
                    self.reply_json({"ok": True, "tec": server_status(self.server)["tec"]})
                elif parsed.path == "/api/tec/open-loop":
                    dac = body_int(body, "dac", 0x800)
                    enable = bool_body(body, "enable_tec", False)
                    self.server.tec_ramp.stop()
                    self.server.system.tec.start_open_loop(dac, enable_tec=enable)
                    self.reply_json({"ok": True, "tec": server_status(self.server)["tec"]})
                elif parsed.path == "/api/tec/pid":
                    self.server.system.tec.configure_pid(
                        kp=float(body["kp"]) if "kp" in body else None,
                        ki=float(body["ki"]) if "ki" in body else None,
                        kd=float(body["kd"]) if "kd" in body else None,
                        integral_limit=body_int(body, "integral_limit") if "integral_limit" in body else None,
                        max_step=body_int(body, "max_step") if "max_step" in body else None,
                        dac_min=body_int(body, "dac_min") if "dac_min" in body else None,
                        dac_max=body_int(body, "dac_max") if "dac_max" in body else None,
                        dac_bias=body_int(body, "dac_bias") if "dac_bias" in body else None,
                        dac_safe=body_int(body, "dac_safe") if "dac_safe" in body else None,
                    )
                    self.reply_json({"ok": True, "tec": self.server.system.tec.status()})
                elif parsed.path == "/api/tec/protection":
                    tec = self.server.system.tec
                    if "temp_min_millic" in body:
                        tec.write("TEMP_MIN", body_int(body, "temp_min_millic"))
                    if "temp_max_millic" in body:
                        tec.write("TEMP_MAX", body_int(body, "temp_max_millic"))
                    if "temp_min_celsius" in body:
                        tec.write("TEMP_MIN", int(round(float(body["temp_min_celsius"]) * 1000.0)))
                    if "temp_max_celsius" in body:
                        tec.write("TEMP_MAX", int(round(float(body["temp_max_celsius"]) * 1000.0)))
                    if "alpha" in body:
                        tec.write("TEMP_ALPHA", body_int(body, "alpha"))
                    if "rdy_timeout" in body:
                        tec.write("RDY_TIMEOUT", body_int(body, "rdy_timeout"))
                    if "spi_clk_div" in body:
                        tec.write("SPI_CLK_DIV", body_int(body, "spi_clk_div"))
                    self.reply_json({"ok": True, "tec": tec.status()})
                elif parsed.path == "/api/tec/stop":
                    self.server.tec_ramp.stop()
                    self.server.system.laser.stop()
                    self.server.system.tec.stop()
                    self.reply_json({"ok": True, "tec": server_status(self.server)["tec"]})
                elif parsed.path == "/api/tec/clear-fault":
                    self.server.system.tec.clear_fault()
                    self.reply_json({"ok": True, "tec": self.server.system.tec.status()})
                elif parsed.path == "/api/laser/static":
                    if not self.require_tec_enabled_for_laser():
                        return
                    ch0 = require_u16("ch0", body["ch0"])
                    ch1 = require_u16("ch1", body.get("ch1", 0))
                    self.server.system.laser.start_static(ch0, ch1, **laser_safety_from_body(body))
                    time.sleep(0.05)
                    self.reply_json({"ok": True, "laser": self.server.system.laser.status()})
                elif parsed.path == "/api/laser/on":
                    if not self.require_tec_enabled_for_laser():
                        return
                    ch0 = require_u16("ch0", body.get("ch0", self.server.system.laser.read("CH0_STATIC_CODE") & 0xFFFF))
                    ch1 = require_u16("ch1", body.get("ch1", self.server.system.laser.read("CH1_STATIC_CODE") & 0xFFFF))
                    self.server.system.laser.start_static(ch0, ch1, **laser_safety_from_body(body))
                    time.sleep(0.05)
                    self.reply_json({"ok": True, "laser": self.server.system.laser.status()})
                elif parsed.path == "/api/laser/off":
                    self.server.system.laser.stop()
                    self.reply_json({"ok": True, "laser": self.server.system.laser.status()})
                elif parsed.path == "/api/laser/static-setpoint":
                    ch0 = require_u16("ch0", body["ch0"])
                    ch1 = require_u16("ch1", body.get("ch1", 0))
                    self.server.system.laser.configure_safety(**laser_safety_from_body(body))
                    self.server.system.laser.set_static_setpoint(ch0, ch1)
                    laser_status = self.server.system.laser.status()
                    if ("laser_enable" in laser_status["status_flags"] or
                            "scan_active" in laser_status["status_flags"] or
                            "busy" in laser_status["status_flags"]):
                        if not self.require_tec_enabled_for_laser():
                            return
                        self.server.system.laser.start_static(ch0, ch1, configure=False)
                        time.sleep(0.05)
                    self.reply_json({"ok": True, "laser": self.server.system.laser.status()})
                elif parsed.path == "/api/laser/fine-scan":
                    if not self.require_tec_enabled_for_laser():
                        return
                    self.server.system.laser.start_fine_scan(
                        require_u16("ch0", body["ch0"]),
                        require_u16("start", body["start"]),
                        require_u16("stop", body["stop"]),
                        require_u16("step", body["step"]),
                        dwell=body_int(body, "dwell", 100),
                        settle=body_int(body, "settle", 100),
                        frames=body_int(body, "frames", 1),
                        continuous=bool_body(body, "continuous", False),
                        **laser_safety_from_body(body),
                    )
                    time.sleep(0.05)
                    self.reply_json({"ok": True, "laser": self.server.system.laser.status()})
                elif parsed.path == "/api/laser/stop-scan":
                    self.server.system.laser.hold_scan_start(configure=True, **laser_safety_from_body(body))
                    time.sleep(0.05)
                    self.reply_json({"ok": True, "laser": self.server.system.laser.status()})
                elif parsed.path == "/api/laser/lock-start":
                    if not self.require_tec_enabled_for_laser():
                        return
                    self.server.system.laser.configure_safety(**laser_safety_from_body(body))
                    self.server.system.laser.start_lock(
                        require_u16("ch0", body.get("ch0", self.server.system.laser.read("CH0_STATIC_CODE") & 0xFFFF)),
                        configure=False,
                        **laser_lock_from_body(body),
                    )
                    time.sleep(0.05)
                    self.reply_json({"ok": True, "laser": self.server.system.laser.status()})
                elif parsed.path == "/api/laser/lock-params":
                    self.server.system.laser.configure_safety(**laser_safety_from_body(body))
                    self.server.system.laser.write(
                        "CH0_STATIC_CODE",
                        require_u16("ch0", body.get("ch0", self.server.system.laser.read("CH0_STATIC_CODE") & 0xFFFF)),
                    )
                    self.server.system.laser.configure_lock(**laser_lock_from_body(body))
                    time.sleep(0.05)
                    self.reply_json({"ok": True, "laser": self.server.system.laser.status()})
                elif parsed.path == "/api/laser/lock-hold":
                    self.server.system.laser.hold_current()
                    time.sleep(0.05)
                    self.reply_json({"ok": True, "laser": self.server.system.laser.status()})
                elif parsed.path == "/api/laser/lock-clear":
                    self.server.system.laser.clear_fault()
                    self.reply_json({"ok": True, "laser": self.server.system.laser.status()})
                elif parsed.path == "/api/laser/acquire-template":
                    if not self.server.system.laser.supports_board_acquire():
                        self.reply_json({
                            "ok": False,
                            "error": "current laser bitstream does not support board acquire",
                            "laser": self.server.system.laser.status(),
                        }, status=501)
                    else:
                        acquire = laser_acquire_from_body(body)
                        lock_params = laser_lock_from_body(body)
                        lock_params["bias_ch1"] = acquire["marker_ch1_code"]
                        self.server.system.laser.configure_safety(**laser_safety_from_body(body))
                        self.server.system.laser.write(
                            "CH0_STATIC_CODE",
                            require_u16("ch0", body.get("ch0", self.server.system.laser.read("CH0_STATIC_CODE") & 0xFFFF)),
                        )
                        self.server.system.laser.configure_lock(**lock_params)
                        self.server.system.laser.configure_acquire(
                            search_min=acquire["search_min"],
                            search_max=acquire["search_max"],
                            threshold=acquire["threshold"],
                        )
                        self.reply_json({"ok": True, "laser": self.server.system.laser.status()})
                elif parsed.path == "/api/laser/acquire-arm":
                    if not self.server.system.laser.supports_board_acquire():
                        self.reply_json({
                            "ok": False,
                            "error": "current laser bitstream does not support board acquire",
                            "laser": self.server.system.laser.status(),
                        }, status=501)
                    else:
                        if not self.require_tec_enabled_for_laser():
                            return
                        self.server.system.laser.arm_acquire()
                        self.reply_json({"ok": True, "laser": self.server.system.laser.status()})
                elif parsed.path == "/api/laser/acquire-cancel":
                    if not self.server.system.laser.supports_board_acquire():
                        self.reply_json({
                            "ok": False,
                            "error": "current laser bitstream does not support board acquire",
                            "laser": self.server.system.laser.status(),
                        }, status=501)
                    else:
                        self.server.system.laser.cancel_acquire()
                        self.reply_json({"ok": True, "laser": self.server.system.laser.status()})
                elif parsed.path == "/api/laser/protection":
                    self.server.system.laser.configure_safety(**laser_safety_from_body(body))
                    self.reply_json({"ok": True, "laser": self.server.system.laser.status()})
                elif parsed.path == "/api/laser/stop":
                    self.server.system.laser.stop()
                    self.reply_json({"ok": True, "laser": self.server.system.laser.status()})
                elif parsed.path == "/api/laser/estop":
                    self.server.system.laser.emergency_stop()
                    self.reply_json({"ok": True, "laser": self.server.system.laser.status()})
                elif parsed.path == "/api/laser/clear-fault":
                    self.server.system.laser.clear_fault()
                    self.reply_json({"ok": True, "laser": self.server.system.laser.status()})
                elif parsed.path == "/api/ada/start":
                    self.server.system.ada.start(clear_counters=bool_body(body, "clear_counters", False))
                    self.reply_json({"ok": True, "ada4355": self.server.system.ada.status()})
                elif parsed.path == "/api/ada/stop":
                    self.server.system.ada.stop()
                    self.reply_json({"ok": True, "ada4355": self.server.system.ada.status()})
                elif parsed.path == "/api/ada/clear":
                    self.server.system.ada.start(clear_counters=True)
                    self.reply_json({"ok": True, "ada4355": self.server.system.ada.status()})
                elif parsed.path == "/api/ada/monitor-rate":
                    decim = self.server.system.ada.set_monitor_rate_hz(
                        float(body["hz"]),
                        adc_clk_hz=body_int(body, "adc_clk_hz", 125000000),
                    )
                    self.reply_json({"ok": True, "decim": decim, "ada4355": self.server.system.ada.status()})
                elif parsed.path == "/api/ada/capture-config":
                    self.server.system.ada.configure_capture(
                        sample_delay=body_int(body, "sample_delay") if "sample_delay" in body else None,
                        sample_window=body_int(body, "sample_window") if "sample_window" in body else None,
                        max_points=body_int(body, "max_points") if "max_points" in body else None,
                        frame_decim=body_int(body, "frame_decim") if "frame_decim" in body else None,
                    )
                    self.reply_json({"ok": True, "ada4355": self.server.system.ada.status()})
                elif parsed.path == "/api/ada/filter":
                    self.server.system.ada.configure_filter(
                        control=body_int(body, "control") if "control" in body else None,
                        threshold=body_int(body, "threshold") if "threshold" in body else None,
                        lp_shift=body_int(body, "lp_shift") if "lp_shift" in body else None,
                        raw_lp_shift=body_int(body, "raw_lp_shift") if "raw_lp_shift" in body else None,
                        enable=bool_body(body, "enable") if "enable" in body else None,
                        glitch_reject=bool_body(body, "glitch_reject") if "glitch_reject" in body else None,
                        raw_filtered=bool_body(body, "raw_filtered") if "raw_filtered" in body else None,
                        spectrum_filtered=bool_body(body, "spectrum_filtered") if "spectrum_filtered" in body else None,
                        monitor_filtered=bool_body(body, "monitor_filtered") if "monitor_filtered" in body else None,
                    )
                    self.reply_json({"ok": True, "ada4355": self.server.system.ada.status()})
                elif parsed.path == "/api/ada/raw-capture":
                    meta = self.server.system.ada.capture_raw(
                        length=body_int(body, "length", 16384),
                        decim=body_int(body, "decim", 1),
                        timeout=float(body.get("timeout", 1.0)),
                    )
                    raw = self.server.system.ada.read_raw(count=meta["write_count"])
                    self.reply_json({"ok": True, "capture": meta, "raw": raw})
                elif parsed.path == "/api/stop-all":
                    self.server.tec_ramp.stop()
                    pa_service = getattr(self.server, "pa_service", None)
                    if pa_service is not None:
                        pa_service.stop()
                    self.server.system.stop_all()
                    self.reply_json({"ok": True, "status": server_status(self.server)})
                elif parsed.path == "/api/settings":
                    settings = migrate_settings(deep_merge(DEFAULT_SETTINGS, body.get("settings", body)))
                    self.server.settings = settings
                    save_settings(self.server.settings_path, settings)
                    self.reply_json({
                        "ok": True,
                        "path": self.server.settings_path,
                        "settings": self.server.settings,
                    })
                elif parsed.path == "/api/settings/apply":
                    initialize_pl_parameters(self.server.system, self.server.settings)
                    ramp = self.server.settings.get("tec", {}).get("ramp", {})
                    self.server.tec_ramp.configure(
                        enabled=bool_body(ramp, "enabled", True),
                        rate_c_per_s=float(ramp.get("rate_c_per_s", 0.05)),
                        interval_ms=body_int(ramp, "interval_ms", 200),
                    )
                    self.reply_json({
                        "ok": True,
                        "settings": self.server.settings,
                        "status": server_status(self.server),
                    })
                elif parsed.path == "/api/write":
                    block = body["block"]
                    offset = require_u32("offset", body["offset"])
                    value = require_u32("value", body["value"])
                    self.write_block(block, offset, value)
                    readback = self.read_block(block, offset)
                    self.reply_json({
                        "ok": True,
                        "block": block,
                        "offset": offset,
                        "offset_hex": f"0x{offset:02X}",
                        "value": readback,
                        "value_hex": f"0x{readback:08X}",
                    })
                else:
                    self.reply_error(404, "unknown endpoint")
        except KeyError as exc:
            self.reply_error(400, f"missing field: {exc}")
        except Exception as exc:
            self.reply_error(400, str(exc))

    def handle_pa_post(self, path, body):
        pa_service = self.server.pa_service
        if path == "/api/pa/start":
            params_body = body.get("params", body)
            params = PamCaptureParams.from_dict(params_body)
            max_blocks = body_int(body, "max_blocks", -1)
            capture_time_sec = float(body.get("capture_time_sec", 0))
            try:
                status = pa_service.start(
                    params,
                    max_blocks=max_blocks,
                    capture_time_sec=capture_time_sec,
                )
            except RuntimeError as exc:
                self.reply_json({"ok": False, "error": str(exc), "pa": pa_service.status()}, status=409)
                return
            self.reply_json({"ok": True, "pa": status})
        elif path == "/api/pa/stop":
            self.reply_json({"ok": True, "pa": pa_service.stop()})
        elif path == "/api/pa/disconnect":
            self.reply_json({"ok": True, "pa": pa_service.disconnect()})
        else:
            self.reply_error(404, "unknown endpoint")

    def read_block(self, block, offset):
        with self.server.lock:
            if block == "tec":
                return self.server.system.tec_regs.read32(offset)
            if block == "laser":
                return self.server.system.laser_regs.read32(offset)
            if block == "ada":
                return self.server.system.ada_regs.read32(offset)
        raise ValueError("block must be 'tec', 'laser', or 'ada'")

    def write_block(self, block, offset, value):
        if block == "tec":
            self.server.system.tec_regs.write32(offset, value)
        elif block == "laser":
            self.server.system.laser_regs.write32(offset, value)
        elif block == "ada":
            self.server.system.ada_regs.write32(offset, value)
        else:
            raise ValueError("block must be 'tec', 'laser', or 'ada'")

    def reply_json(self, obj, status=200):
        payload = json.dumps(obj, indent=2, sort_keys=True).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def reply_error(self, status, message):
        self.reply_json({"ok": False, "error": message}, status=status)


def build_parser():
    parser = argparse.ArgumentParser(description="HTTP server for Butterfly Laser Driver")
    parser.add_argument("--tec-base", default=hex(DEFAULT_TEC_BASE), help="TEC AXI base address")
    parser.add_argument("--laser-base", default=hex(DEFAULT_LASER_BASE), help="Laser current AXI base address")
    parser.add_argument("--ada-base", default=hex(DEFAULT_ADA_BASE), help="ADA4355 capture AXI base address")
    parser.add_argument("--ada-buf0-base", default=hex(DEFAULT_ADA_BUF0_BASE), help="ADA4355 spectrum buffer 0 base address")
    parser.add_argument("--ada-buf1-base", default=hex(DEFAULT_ADA_BUF1_BASE), help="ADA4355 spectrum buffer 1 base address")
    parser.add_argument("--ada-raw-base", default=hex(DEFAULT_ADA_RAW_BASE), help="ADA4355 raw ADC packed buffer base address")
    parser.add_argument("--span", default=hex(DEFAULT_SPAN), help="/dev/mem mapping span")
    parser.add_argument("--buffer-span", default=hex(DEFAULT_BUFFER_SPAN), help="ADA4355 spectrum buffer mapping span")
    parser.add_argument("--raw-buffer-span", default=hex(DEFAULT_RAW_BUFFER_SPAN), help="ADA4355 raw ADC buffer mapping span")
    parser.add_argument("--pa-axi-base", default=hex(PAM_AXI_DEFAULT_BASE), help="PA imaging AXI base address")
    parser.add_argument("--pa-axi-span", default=hex(PAM_AXI_MAP_SPAN), help="PA imaging AXI mapping span")
    parser.add_argument("--pa-capture-dev", default="/dev/axis_capture0", help="PA AXIS capture device path")
    parser.add_argument("--pa-tcp-port", type=int, default=9090, help="PA imaging TCP stream port")
    parser.add_argument("--host", default="0.0.0.0", help="Listen address")
    parser.add_argument("--port", type=int, default=8080, help="Listen port")
    parser.add_argument(
        "--settings",
        default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "butterfly_laser_settings.json"),
        help="Persistent settings JSON file",
    )
    parser.add_argument("--verbose", action="store_true", help="Print HTTP request logs")
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
        httpd = ThreadingHTTPServer((args.host, args.port), ButterflyHandler)
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

        httpd.daemon_threads = True
        httpd.block_on_close = False

        def request_stop(signum, _frame):
            name = signal.Signals(signum).name
            print(f"\n{name} received, shutting down server...", flush=True)
            httpd.stop_event.set()
            raise KeyboardInterrupt

        signal.signal(signal.SIGTERM, request_stop)
        signal.signal(signal.SIGINT, request_stop)

        print(
            f"Listening on http://{args.host}:{args.port} "
            f"tec=0x{parse_int(args.tec_base):08X} laser=0x{parse_int(args.laser_base):08X} "
            f"ada=0x{parse_int(args.ada_base):08X} "
            f"pa_tcp={args.pa_tcp_port} "
            f"settings={args.settings}",
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
                pa_service.disconnect(join_timeout=None)
            tec_ramp = getattr(httpd, "tec_ramp", None)
            if tec_ramp is not None:
                tec_ramp.stop()
            httpd.server_close()
        if pa_regs is not None:
            pa_regs.close()
        if system is not None:
            system.close()
        print("Server stopped.", flush=True)


if __name__ == "__main__":
    main()
