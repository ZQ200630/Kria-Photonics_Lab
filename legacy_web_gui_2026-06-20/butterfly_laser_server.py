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
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

from butterfly_laser_control import (
    DEFAULT_ADA_BASE,
    DEFAULT_ADA_BUF0_BASE,
    DEFAULT_ADA_BUF1_BASE,
    DEFAULT_BUFFER_SPAN,
    DEFAULT_LASER_BASE,
    DEFAULT_SPAN,
    DEFAULT_TEC_BASE,
    ButterflyLaserSystem,
    parse_int,
    require_u16,
    require_u32,
)


SETTINGS_SCHEMA_VERSION = 3


DEFAULT_SETTINGS = {
    "settings_schema_version": SETTINGS_SCHEMA_VERSION,
    "tec": {
        "target_celsius": "31.0",
        "manual_dac": "0x800",
        "open_loop_enable": "false",
        "pid": {
            "kp": "0.05",
            "ki": "0.00025",
            "kd": "0",
            "integral_limit": "500000",
            "max_step": "10",
            "dac_bias": "0x800",
            "dac_min": "0x740",
            "dac_max": "0x8c0",
            "dac_safe": "0x800",
        },
        "protection": {
            "temp_min_celsius": "20.0",
            "temp_max_celsius": "40.0",
            "alpha": "65535",
            "rdy_timeout": "5000000",
            "spi_clk_div": "10",
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
            "bias_ch1": "3000",
            "range_halfspan": "500",
            "ch1_min": "2500",
            "ch1_max": "3500",
            "kp": "0.5",
            "ki": "0.01",
            "polarity_invert": False,
            "integral_limit": "100000",
            "max_step": "10",
            "locked_threshold": "20",
            "loss_threshold": "500",
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
            "ch1_max": "50000",
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
    },
}


LEGACY_DEFAULT_REPLACEMENTS = (
    (("tec", "pid", "integral_limit"), "80000", "500000"),
    (("tec", "protection", "temp_min_celsius"), "10.0", "20.0"),
    (("laser", "fine_scan", "ch0"), "5000", "26000"),
    (("laser", "fine_scan", "start"), "1000", "20000"),
    (("laser", "fine_scan", "stop"), "5000", "30000"),
    (("laser", "fine_scan", "dwell"), "100000", "100"),
    (("laser", "fine_scan", "settle"), "1000", "100"),
    (("laser", "protection", "ch0_max"), "20000", "40000"),
    (("laser", "protection", "ch1_max"), "10000", "50000"),
    (("laser", "lock", "kp"), "0.05", "0.5"),
    (("laser", "lock", "ki"), "0", "0.01"),
    (("laser", "lock", "max_step"), "2", "10"),
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
        return deep_merge(DEFAULT_SETTINGS, {})
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    return deep_merge(DEFAULT_SETTINGS, migrate_settings(data))


def save_settings(path, settings):
    directory = os.path.dirname(os.path.abspath(path))
    if directory:
        os.makedirs(directory, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(settings, f, indent=2, sort_keys=True)
        f.write("\n")


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
            ch1_min=body_int(lock, "ch1_min", 1000),
            ch1_max=body_int(lock, "ch1_max", 5000),
            kp=float(lock.get("kp", 0.5)),
            ki=float(lock.get("ki", 0.01)),
            polarity_invert=bool_body(lock, "polarity_invert", False),
            integral_limit=body_int(lock, "integral_limit", 100000),
            max_step=body_int(lock, "max_step", 10),
            locked_threshold=body_int(lock, "locked_threshold", 20),
            loss_threshold=body_int(lock, "loss_threshold", 500),
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
        )


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
        "ch1_max": body_int(body, "ch1_max", 50000),
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
        "bias_ch1": body_int(body, "bias_ch1", 3000),
        "ch1_min": body_int(body, "lock_ch1_min", body_int(body, "ch1_min", 1000)),
        "ch1_max": body_int(body, "lock_ch1_max", body_int(body, "ch1_max", 5000)),
        "kp": float(body.get("lock_kp", body.get("kp", 0.5))),
        "ki": float(body.get("lock_ki", body.get("ki", 0.01))),
        "polarity_invert": bool_body(body, "polarity_invert", False),
        "integral_limit": body_int(body, "lock_integral_limit", body_int(body, "integral_limit", 100000)),
        "max_step": body_int(body, "lock_max_step", body_int(body, "max_step", 10)),
        "locked_threshold": body_int(body, "locked_threshold", 20),
        "loss_threshold": body_int(body, "loss_threshold", 500),
        "locked_count": body_int(body, "locked_count", 50),
        "loss_count": body_int(body, "loss_count", 10),
        "sat_count": body_int(body, "sat_count", 100),
        "fb_timeout": body_int(body, "fb_timeout", 0),
        "adc_min_valid": body_int(body, "adc_min_valid", 0),
        "adc_max_valid": body_int(body, "adc_max_valid", 0),
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
                        "/api/laser/lock-hold",
                        "/api/laser/lock-clear",
                        "/api/laser/protection",
                        "/api/ada/start",
                        "/api/ada/status",
                        "/api/ada/spectrum",
                        "/api/ada/filter",
                        "/api/stop-all",
                    ],
                })
            elif parsed.path == "/api/status":
                with self.server.lock:
                    self.reply_json({"ok": True, "status": self.server.system.status()})
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
            with self.server.lock:
                if parsed.path == "/api/tec/start":
                    target = body.get("celsius", body.get("target_celsius"))
                    reset = bool_body(body, "reset", True)
                    status = self.server.system.start_tec_default(target, reset=reset)
                    self.reply_json({"ok": True, "tec": status})
                elif parsed.path == "/api/tec/target":
                    target = body.get("celsius", body.get("target_celsius"))
                    if target is None:
                        raise KeyError("celsius")
                    self.server.system.tec.set_target_celsius(float(target))
                    self.reply_json({"ok": True, "tec": self.server.system.tec.status()})
                elif parsed.path == "/api/tec/open-loop":
                    dac = body_int(body, "dac", 0x800)
                    enable = bool_body(body, "enable_tec", False)
                    self.server.system.tec.start_open_loop(dac, enable_tec=enable)
                    self.reply_json({"ok": True, "tec": self.server.system.tec.status()})
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
                    self.server.system.tec.stop()
                    self.reply_json({"ok": True, "tec": self.server.system.tec.status()})
                elif parsed.path == "/api/tec/clear-fault":
                    self.server.system.tec.clear_fault()
                    self.reply_json({"ok": True, "tec": self.server.system.tec.status()})
                elif parsed.path == "/api/laser/static":
                    ch0 = require_u16("ch0", body["ch0"])
                    ch1 = require_u16("ch1", body.get("ch1", 0))
                    self.server.system.laser.start_static(ch0, ch1, **laser_safety_from_body(body))
                    time.sleep(0.05)
                    self.reply_json({"ok": True, "laser": self.server.system.laser.status()})
                elif parsed.path == "/api/laser/on":
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
                        self.server.system.laser.start_static(ch0, ch1, configure=False)
                        time.sleep(0.05)
                    self.reply_json({"ok": True, "laser": self.server.system.laser.status()})
                elif parsed.path == "/api/laser/fine-scan":
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
                    self.server.system.laser.configure_safety(**laser_safety_from_body(body))
                    self.server.system.laser.start_lock(
                        require_u16("ch0", body.get("ch0", self.server.system.laser.read("CH0_STATIC_CODE") & 0xFFFF)),
                        configure=False,
                        **laser_lock_from_body(body),
                    )
                    time.sleep(0.05)
                    self.reply_json({"ok": True, "laser": self.server.system.laser.status()})
                elif parsed.path == "/api/laser/lock-hold":
                    self.server.system.laser.hold_current()
                    time.sleep(0.05)
                    self.reply_json({"ok": True, "laser": self.server.system.laser.status()})
                elif parsed.path == "/api/laser/lock-clear":
                    self.server.system.laser.clear_fault()
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
                    self.reply_json({"ok": True, "status": self.server.system.stop_all()})
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
                    apply_saved_settings(self.server.system, self.server.settings)
                    self.reply_json({
                        "ok": True,
                        "settings": self.server.settings,
                        "status": self.server.system.status(),
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
    parser.add_argument("--span", default=hex(DEFAULT_SPAN), help="/dev/mem mapping span")
    parser.add_argument("--buffer-span", default=hex(DEFAULT_BUFFER_SPAN), help="ADA4355 spectrum buffer mapping span")
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
    system = ButterflyLaserSystem(
        args.tec_base,
        args.laser_base,
        args.span,
        args.ada_base,
        args.ada_buf0_base,
        args.ada_buf1_base,
        args.buffer_span,
    )
    settings = load_settings(args.settings)
    httpd = ThreadingHTTPServer((args.host, args.port), ButterflyHandler)
    httpd.system = system
    httpd.lock = threading.RLock()
    httpd.verbose = args.verbose
    httpd.settings = settings
    httpd.settings_path = args.settings

    httpd.daemon_threads = True
    httpd.block_on_close = False

    def request_stop(signum, _frame):
        name = signal.Signals(signum).name
        print(f"\n{name} received, shutting down server...", flush=True)
        raise KeyboardInterrupt

    signal.signal(signal.SIGTERM, request_stop)
    signal.signal(signal.SIGINT, request_stop)

    print(
        f"Listening on http://{args.host}:{args.port} "
        f"tec=0x{parse_int(args.tec_base):08X} laser=0x{parse_int(args.laser_base):08X} "
        f"ada=0x{parse_int(args.ada_base):08X} "
        f"settings={args.settings}",
        flush=True,
    )
    try:
        httpd.serve_forever(poll_interval=0.2)
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()
        system.close()
        print("Server stopped.", flush=True)


if __name__ == "__main__":
    main()
