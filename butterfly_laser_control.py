#!/usr/bin/env python3
"""
Unified board-side control utility for the Butterfly Laser Driver.

Default AXI base addresses:
  TEC / AD4170 controller:    0xA0000000
  ADA4355 capture controller:  0xA0100000
  ADA4355 spectrum buffer 0:   0xA01C0000
  ADA4355 spectrum buffer 1:   0xA01D0000
  ADA4355 packed raw buffer:   0xA0200000
  Laser current controller:   0xA0120000

Run on the board as root, for example:
  sudo python3 butterfly_laser_control.py status
  sudo python3 butterfly_laser_control.py tec-start
  sudo python3 butterfly_laser_control.py laser-static --ch0 5000 --ch1 0
  sudo python3 butterfly_laser_control.py stop-all
"""

import argparse
import json
import mmap
import os
import struct
import sys
import time


DEFAULT_TEC_BASE = 0xA0000000
DEFAULT_ADA_BASE = 0xA0100000
DEFAULT_LASER_BASE = 0xA0120000
DEFAULT_ADA_BUF0_BASE = 0xA01C0000
DEFAULT_ADA_BUF1_BASE = 0xA01D0000
DEFAULT_ADA_RAW_BASE = 0xA0200000
DEFAULT_SPAN = 0x1000
DEFAULT_BUFFER_SPAN = 0x10000
DEFAULT_RAW_BUFFER_SPAN = 0x100000
ADA_RAW_MAX_POINTS = 512 * 1024
ADA_RAW_BUFFER_WORDS = ADA_RAW_MAX_POINTS // 2


TEC_REG = {
    "CONTROL": 0x00,
    "STATUS": 0x04,
    "CURRENT_STATE": 0x08,
    "MAIN_ERROR_STATUS": 0x0C,
    "LAST_STATUS": 0x10,
    "SAMPLE_COUNTER": 0x14,
    "DAC_UPDATE_COUNTER": 0x18,
    "LAST_READY_LATENCY_CYCLES": 0x1C,
    "ADC_RAW_CH0": 0x20,
    "ADC_RAW_CH1": 0x24,
    "ADC_RAW_CH2": 0x28,
    "ADC_RAW_CH3": 0x2C,
    "MONITOR_COUNTER": 0x30,
    "TEMP_MEASURED": 0x40,
    "TEMP_FILTERED": 0x44,
    "ERROR_MILLIC": 0x48,
    "TARGET_TEMP": 0x4C,
    "TEMP_MIN": 0x50,
    "TEMP_MAX": 0x54,
    "TEMP_ALPHA": 0x58,
    "NTC_R_FIXED": 0x5C,
    "NTC_R25": 0x60,
    "MANUAL_DAC": 0x70,
    "ACTIVE_DAC": 0x74,
    "DAC_BIAS": 0x78,
    "DAC_MIN": 0x7C,
    "DAC_MAX": 0x80,
    "DAC_SAFE": 0x84,
    "PID_KP": 0x90,
    "PID_KI": 0x94,
    "PID_KD": 0x98,
    "PID_ILIM": 0x9C,
    "PID_MAX_STEP": 0xA0,
    "PID_ERROR": 0xA4,
    "PID_P": 0xA8,
    "PID_I": 0xAC,
    "PID_D": 0xB0,
    "PID_INTEGRAL": 0xB4,
    "PID_OUTPUT": 0xB8,
    "SPI_CLK_DIV": 0xC0,
    "RDY_TIMEOUT": 0xC4,
    "MONITOR_INTERVAL": 0xC8,
    "VERSION": 0xCC,
}

TEC_CTRL_INIT = 1 << 0
TEC_CTRL_RUN = 1 << 1
TEC_CTRL_CLOSED_LOOP = 1 << 2
TEC_CTRL_PID_ENABLE = 1 << 3
TEC_CTRL_ENABLE_REQ = 1 << 4
TEC_CTRL_ENABLE_OVERRIDE = 1 << 5
TEC_CTRL_FAULT_CLEAR = 1 << 7
TEC_CTRL_SOFT_RESET = 1 << 8

TEC_STATUS_BITS = [
    (0, "init_done"),
    (1, "id_check_pass"),
    (2, "run"),
    (3, "closed_loop"),
    (4, "adc_sample_valid"),
    (5, "temperature_valid"),
    (6, "tec_enabled"),
    (7, "fault_latched"),
    (8, "spi_busy"),
    (9, "spi_error"),
    (10, "rdy_timeout_error"),
    (11, "por_flag_seen"),
    (12, "temperature_range_error"),
]

TEC_ERROR_BITS = [
    (0, "id_check_failed"),
    (1, "spi_error"),
    (2, "rdy_timeout"),
    (3, "temperature_range_or_conversion"),
]


LASER_REG = {
    "CTRL": 0x00,
    "STATUS": 0x04,
    "FAULT_STATUS": 0x08,
    "ACTUAL_DAC_CODES": 0x0C,
    "CH0_STATIC_CODE": 0x10,
    "CH1_STATIC_CODE": 0x14,
    "CH0_START_CODE": 0x18,
    "CH0_STOP_CODE": 0x1C,
    "CH0_STEP_CODE": 0x20,
    "CH0_DWELL_FRAMES": 0x24,
    "CH1_START_CODE": 0x28,
    "CH1_STOP_CODE": 0x2C,
    "CH1_STEP_CODE": 0x30,
    "CH1_DWELL_TICKS": 0x34,
    "FRAME_COUNT": 0x38,
    "DAC_SETTLE_TICKS": 0x3C,
    "CH0_LIMIT": 0x40,
    "CH1_LIMIT": 0x44,
    "RAMP_CONFIG": 0x48,
    "RAMP_INTERVAL_TICKS": 0x4C,
    "DAC_TIMEOUT_TICKS": 0x50,
    "WATCHDOG_TIMEOUT_TICKS": 0x54,
    "ENABLE_DELAY_TICKS": 0x5C,
    "CURRENT_LIMIT_CODE": 0x60,
    "CH0_GAIN_COEFF": 0x64,
    "CH1_GAIN_COEFF": 0x68,
    "CURRENT_OFFSET": 0x6C,
    "LOCK_TARGET": 0x70,
    "LOCK_BIAS_CH1_CODE": 0x74,
    "LOCK_CH1_RANGE": 0x78,
    "LOCK_KP": 0x7C,
    "TARGET_DAC_CODES": 0x80,
    "SCAN_INDEX": 0x84,
    "FRAME_INDEX": 0x88,
    "LAST_FB_ADC": 0x8C,
    "CURRENT_ESTIMATE": 0x90,
    "LOCK_KI": 0x94,
    "LOCK_INTEGRAL_LIMIT": 0x98,
    "LOCK_MAX_STEP": 0x9C,
    "LOCK_THRESHOLDS": 0xA0,
    "LOCK_COUNTS": 0xA4,
    "LOCK_SAT_LIMIT_COUNT": 0xA8,
    "LOCK_FB_TIMEOUT_TICKS": 0xAC,
    "LOCK_ADC_VALID_RANGE": 0xB0,
    "LOCK_STATUS": 0xB4,
    "LOCK_ERROR": 0xB8,
    "LOCK_INTEGRAL": 0xBC,
    "LOCK_OUTPUT_CH1_CODE": 0xC0,
    "LOCK_COUNTERS": 0xC4,
    "VERSION": 0xFC,
    "ACQUIRE_CONTROL": 0xC8,
    "ACQUIRE_SEARCH_RANGE": 0xCC,
    "ACQUIRE_THRESHOLD": 0xD0,
    "ACQUIRE_STATUS": 0xD4,
    "ACQUIRE_MATCH_CODE": 0xD8,
    "ACQUIRE_MATCH_ADC": 0xDC,
    "ACQUIRE_MATCH_ERROR": 0xE0,
}

LASER_CTRL_ENABLE = 1 << 0
LASER_CTRL_START = 1 << 1
LASER_CTRL_STOP = 1 << 2
LASER_CTRL_CONTINUOUS = 1 << 3
LASER_CTRL_MODE_SHIFT = 4
LASER_CTRL_LASER_ARM = 1 << 8
LASER_CTRL_FAULT_CLEAR = 1 << 9
LASER_CTRL_WATCHDOG_KICK = 1 << 10
LASER_CTRL_EMERGENCY_STOP = 1 << 11
LASER_MIN_BOARD_ACQUIRE_VERSION = 0x00020000
LASER_ACQ_ENABLE = 1 << 0
LASER_ACQ_ARM = 1 << 1
LASER_ACQ_CANCEL = 1 << 2

MODE_IDLE = 0
MODE_STATIC = 1
MODE_FINE_SCAN = 2
MODE_NESTED_SCAN = 3
MODE_LOCK = 4

LASER_STATUS_BITS = [
    (0, "busy"),
    (1, "done_latched"),
    (2, "laser_enable"),
    (3, "frame_active"),
    (4, "point_strobe"),
    (5, "fault_latched"),
    (6, "lock_active"),
    (7, "scan_active"),
    (8, "ramping"),
    (9, "dac_waiting"),
    (10, "output_at_target"),
    (11, "error"),
]

LASER_LOCK_STATUS_BITS = [
    (0, "lock_active"),
    (1, "control_enabled"),
    (2, "locked"),
    (3, "saturated"),
    (4, "lock_lost"),
    (5, "fb_timeout"),
    (6, "adc_invalid"),
    (7, "hold"),
    (8, "acquiring"),
]

LASER_FAULT_BITS = [
    (0, "tec_unlocked_at_start"),
    (1, "external_fault"),
    (2, "emergency_stop"),
    (3, "ch0_limit"),
    (4, "ch1_limit"),
    (5, "combined_current_limit"),
    (6, "dac_timeout"),
    (7, "watchdog_timeout"),
    (8, "illegal_mode"),
    (9, "tec_lost_during_run"),
]


ADA_REG = {
    "CONTROL": 0x00,
    "STATUS": 0x04,
    "CONFIG": 0x08,
    "ADC_OFFSET": 0x0C,
    "MONITOR_DECIM_N": 0x10,
    "MONITOR_AVG": 0x14,
    "MONITOR_MIN_MAX": 0x18,
    "MONITOR_COUNTER": 0x1C,
    "SAMPLE_DELAY": 0x20,
    "SAMPLE_WINDOW": 0x24,
    "MAX_POINTS": 0x28,
    "POINTS_WRITTEN": 0x2C,
    "MAX_FAST_INDEX_SEEN": 0x30,
    "READ_BUFFER_ID": 0x34,
    "LOCKED_BUFFER_ID": 0x38,
    "READ_FRAME_COUNTER": 0x3C,
    "READ_SLOW_INDEX": 0x40,
    "READ_POINTS_WRITTEN": 0x44,
    "READ_MAX_FAST_INDEX": 0x48,
    "READ_STATUS": 0x4C,
    "TOTAL_FRAME_COUNTER": 0x50,
    "DROPPED_FRAME_COUNTER": 0x54,
    "POINT_OVERRUN_COUNTER": 0x58,
    "DEBUG_ADC_LAST": 0x5C,
    "VERSION": 0x60,
    "RAW_CONTROL": 0x64,
    "RAW_LENGTH": 0x68,
    "RAW_DECIM": 0x6C,
    "RAW_STATUS": 0x78,
    "RAW_WRITE_COUNT": 0x7C,
    "FILTER_CONTROL": 0x80,
    "GLITCH_THRESHOLD": 0x84,
    "LP_SHIFT": 0x88,
    "FILTERED_ADC_LAST": 0x8C,
    "GLITCH_REJECT_COUNTER": 0x90,
    "FRAME_DECIM_N": 0x94,
    "CAPTURED_COUNT": 0x98,
    "RAW_LP_SHIFT": 0x9C,
    "RAW_FILTERED_ADC_LAST": 0xA0,
    "RAW_CAPACITY_SAMPLES": 0xA4,
    "RAW_BUFFER_WORDS": 0xA8,
}

ADA_CTRL_ENABLE = 1 << 0
ADA_CTRL_SOFT_RESET = 1 << 1
ADA_CTRL_MONITOR_ENABLE = 1 << 2
ADA_CTRL_CAPTURE_ENABLE = 1 << 3
ADA_CTRL_CLEAR_COUNTERS = 1 << 4
ADA_CTRL_ARM_SINGLE_FRAME = 1 << 5
ADA_CTRL_CONTINUOUS_CAPTURE = 1 << 6
ADA_CTRL_CLEAR_FRAME_AVAILABLE = 1 << 7
ADA_CTRL_LOCK_READ_BUFFER = 1 << 8
ADA_CTRL_RELEASE_READ_BUFFER = 1 << 9
ADA_CTRL_DROP_WHEN_FULL = 1 << 10

ADA_FILTER_ENABLE = 1 << 0
ADA_FILTER_GLITCH_REJECT = 1 << 1
ADA_FILTER_RAW_USE_FILTERED = 1 << 2
ADA_FILTER_SPECTRUM_USE_FILTERED = 1 << 3
ADA_FILTER_MONITOR_USE_FILTERED = 1 << 4
ADA_FILTER_DEFAULT = (
    ADA_FILTER_ENABLE
    | ADA_FILTER_SPECTRUM_USE_FILTERED
    | ADA_FILTER_MONITOR_USE_FILTERED
)

ADA_RUN_DEFAULT = (
    ADA_CTRL_ENABLE
    | ADA_CTRL_MONITOR_ENABLE
    | ADA_CTRL_CAPTURE_ENABLE
    | ADA_CTRL_CONTINUOUS_CAPTURE
    | ADA_CTRL_DROP_WHEN_FULL
)

ADA_STATUS_BITS = [
    (0, "enable"),
    (1, "capture_busy"),
    (2, "frame_done"),
    (3, "frame_available"),
    (4, "read_buffer_locked"),
    (5, "buffer0_readable"),
    (6, "buffer1_readable"),
    (7, "drop_when_full"),
    (8, "monitor_valid"),
    (9, "monitor_updated"),
]


def parse_int(value):
    if isinstance(value, int):
        return value
    if isinstance(value, str):
        return int(value, 0)
    raise ValueError(f"expected integer, got {value!r}")


def u32(value):
    return value & 0xFFFFFFFF


def s32(value):
    value &= 0xFFFFFFFF
    return value - 0x100000000 if value & 0x80000000 else value


def require_range(name, value, low, high):
    value = parse_int(value)
    if not low <= value <= high:
        raise ValueError(f"{name} must be {low}..{high}, got {value}")
    return value


def require_u16(name, value):
    return require_range(name, value, 0, 0xFFFF)


def require_u12(name, value):
    return require_range(name, value, 0, 0xFFF)


def require_u32(name, value):
    return require_range(name, value, 0, 0xFFFFFFFF)


def millic_from_celsius(celsius):
    return int(round(float(celsius) * 1000.0))


def celsius_from_millic(millic):
    return float(s32(millic)) / 1000.0


def q12_20(value):
    return u32(int(round(float(value) * 1048576.0)))


def q2_30(value):
    return u32(int(round(float(value) * 1073741824.0)))


def q16_16(value):
    return u32(int(round(float(value) * 65536.0)))


def q12_20_to_float(value):
    return float(s32(value)) / 1048576.0


def q2_30_to_float(value):
    return float(s32(value)) / 1073741824.0


def q16_16_to_float(value):
    return float(s32(value)) / 65536.0


def signed_hex(value):
    return f"0x{u32(value):08X}"


def flags_from_bits(word, table):
    return [name for bit, name in table if word & (1 << bit)]


def split_u16_pair(word):
    return word & 0xFFFF, (word >> 16) & 0xFFFF


def raw_laser_dac_code(internal_code):
    return internal_code ^ 0x8000


def ch0_code_to_ma(code):
    return float(require_u16("ch0_code", code)) * 100.0 / 65535.0


def ch1_code_to_ma(code):
    return float(require_u16("ch1_code", code)) * 10.0 / 65535.0


class AxiMap:
    def __init__(self, base, span=DEFAULT_SPAN, dev="/dev/mem"):
        self.base = parse_int(base)
        self.span = parse_int(span)
        self.dev = dev
        self.page_size = mmap.PAGESIZE
        self.page_base = self.base & ~(self.page_size - 1)
        self.page_offset = self.base - self.page_base
        self.map_size = self.page_offset + self.span
        self.fd = os.open(self.dev, os.O_RDWR | os.O_SYNC)
        self.mem = mmap.mmap(
            self.fd,
            self.map_size,
            mmap.MAP_SHARED,
            mmap.PROT_READ | mmap.PROT_WRITE,
            offset=self.page_base,
        )

    def close(self):
        self.mem.close()
        os.close(self.fd)

    def read32(self, offset):
        offset = require_u32("offset", offset)
        self.mem.seek(self.page_offset + offset)
        return struct.unpack("<I", self.mem.read(4))[0]

    def write32(self, offset, value):
        offset = require_u32("offset", offset)
        value = require_u32("value", value)
        self.mem.seek(self.page_offset + offset)
        self.mem.write(struct.pack("<I", value))

    def dump(self, reg_map):
        return {
            name: {
                "offset": offset,
                "offset_hex": f"0x{offset:02X}",
                "value": self.read32(offset),
                "value_hex": f"0x{self.read32(offset):08X}",
            }
            for name, offset in reg_map.items()
        }

    def read_words(self, count):
        count = require_u32("count", count)
        self.mem.seek(self.page_offset)
        data = self.mem.read(count * 4)
        return list(struct.unpack("<" + "I" * count, data))


class TecController:
    def __init__(self, regs):
        self.regs = regs

    def read(self, name_or_offset):
        offset = TEC_REG[name_or_offset] if isinstance(name_or_offset, str) else name_or_offset
        return self.regs.read32(offset)

    def write(self, name_or_offset, value):
        offset = TEC_REG[name_or_offset] if isinstance(name_or_offset, str) else name_or_offset
        self.regs.write32(offset, value)

    def soft_reset(self, delay=1.0):
        self.write("CONTROL", TEC_CTRL_SOFT_RESET)
        if delay:
            time.sleep(delay)

    def init(self, delay=1.0):
        self.write("CONTROL", TEC_CTRL_INIT)
        if delay:
            time.sleep(delay)

    def start_closed_loop(self):
        self.write(
            "CONTROL",
            TEC_CTRL_RUN
            | TEC_CTRL_CLOSED_LOOP
            | TEC_CTRL_PID_ENABLE
            | TEC_CTRL_ENABLE_REQ
            | TEC_CTRL_ENABLE_OVERRIDE,
        )

    def start_open_loop(self, dac_code=0x800, enable_tec=False):
        self.write("MANUAL_DAC", require_u12("dac_code", dac_code))
        ctrl = TEC_CTRL_RUN
        if enable_tec:
            ctrl |= TEC_CTRL_ENABLE_REQ | TEC_CTRL_ENABLE_OVERRIDE
        self.write("CONTROL", ctrl)

    def stop(self):
        self.write("MANUAL_DAC", 0x800)
        self.write("CONTROL", TEC_CTRL_RUN)

    def clear_fault(self):
        self.write("CONTROL", TEC_CTRL_FAULT_CLEAR)
        time.sleep(0.02)

    def set_target_millic(self, millic):
        millic = require_range("target_millic", millic, 10000, 40000)
        self.write("TARGET_TEMP", millic)

    def set_target_celsius(self, celsius):
        self.set_target_millic(millic_from_celsius(celsius))

    def set_manual_dac(self, dac_code):
        self.write("MANUAL_DAC", require_u12("dac_code", dac_code))

    def configure_pid(
        self,
        kp=None,
        ki=None,
        kd=None,
        integral_limit=None,
        max_step=None,
        dac_min=None,
        dac_max=None,
        dac_bias=None,
        dac_safe=None,
    ):
        if kp is not None:
            self.write("PID_KP", q12_20(kp))
        if ki is not None:
            self.write("PID_KI", q2_30(ki))
        if kd is not None:
            self.write("PID_KD", q12_20(kd))
        if integral_limit is not None:
            self.write("PID_ILIM", require_u32("integral_limit", integral_limit))
        if max_step is not None:
            self.write("PID_MAX_STEP", require_u12("max_step", max_step))
        if dac_min is not None:
            self.write("DAC_MIN", require_u12("dac_min", dac_min))
        if dac_max is not None:
            self.write("DAC_MAX", require_u12("dac_max", dac_max))
        if dac_bias is not None:
            self.write("DAC_BIAS", require_u12("dac_bias", dac_bias))
        if dac_safe is not None:
            self.write("DAC_SAFE", require_u12("dac_safe", dac_safe))

    def status(self):
        status = self.read("STATUS")
        error = self.read("MAIN_ERROR_STATUS")
        temp_measured = self.read("TEMP_MEASURED")
        temp_filtered = self.read("TEMP_FILTERED")
        err_millic = self.read("ERROR_MILLIC")
        temp_min = self.read("TEMP_MIN")
        temp_max = self.read("TEMP_MAX")
        pid_kp = self.read("PID_KP")
        pid_ki = self.read("PID_KI")
        pid_kd = self.read("PID_KD")
        pid_p = self.read("PID_P")
        pid_i = self.read("PID_I")
        pid_d = self.read("PID_D")
        return {
            "base_hex": f"0x{self.regs.base:08X}",
            "version": self.read("VERSION"),
            "version_hex": f"0x{self.read('VERSION'):08X}",
            "status": status,
            "status_hex": f"0x{status:08X}",
            "status_flags": flags_from_bits(status, TEC_STATUS_BITS),
            "main_error_status": error,
            "main_error_status_hex": f"0x{error:08X}",
            "error_flags": flags_from_bits(error, TEC_ERROR_BITS),
            "current_state": self.read("CURRENT_STATE"),
            "last_status": self.read("LAST_STATUS"),
            "last_status_hex": f"0x{self.read('LAST_STATUS'):08X}",
            "sample_counter": self.read("SAMPLE_COUNTER"),
            "dac_update_counter": self.read("DAC_UPDATE_COUNTER"),
            "adc_raw_ch0": self.read("ADC_RAW_CH0"),
            "adc_raw_ch0_hex": f"0x{self.read('ADC_RAW_CH0'):06X}",
            "temperature_measured_millic": s32(temp_measured),
            "temperature_measured_celsius": celsius_from_millic(temp_measured),
            "temperature_filtered_millic": s32(temp_filtered),
            "temperature_filtered_celsius": celsius_from_millic(temp_filtered),
            "error_millic": s32(err_millic),
            "error_celsius": celsius_from_millic(err_millic),
            "target_millic": s32(self.read("TARGET_TEMP")),
            "target_celsius": celsius_from_millic(self.read("TARGET_TEMP")),
            "temp_min_millic": s32(temp_min),
            "temp_min_celsius": celsius_from_millic(temp_min),
            "temp_max_millic": s32(temp_max),
            "temp_max_celsius": celsius_from_millic(temp_max),
            "temp_alpha": self.read("TEMP_ALPHA"),
            "rdy_timeout": self.read("RDY_TIMEOUT"),
            "spi_clk_div": self.read("SPI_CLK_DIV"),
            "active_dac_code": self.read("ACTIVE_DAC") & 0xFFF,
            "manual_dac_code": self.read("MANUAL_DAC") & 0xFFF,
            "dac_min": self.read("DAC_MIN") & 0xFFF,
            "dac_max": self.read("DAC_MAX") & 0xFFF,
            "dac_bias": self.read("DAC_BIAS") & 0xFFF,
            "dac_safe": self.read("DAC_SAFE") & 0xFFF,
            "pid": {
                "kp": q12_20_to_float(pid_kp),
                "ki": q2_30_to_float(pid_ki),
                "kd": q12_20_to_float(pid_kd),
                "kp_reg": pid_kp,
                "ki_reg": pid_ki,
                "kd_reg": pid_kd,
                "integral_limit": s32(self.read("PID_ILIM")),
                "max_step": self.read("PID_MAX_STEP") & 0xFFF,
                "p_term": s32(pid_p),
                "i_term": s32(pid_i),
                "d_term": s32(pid_d),
                "integral": s32(self.read("PID_INTEGRAL")),
                "output_code": self.read("PID_OUTPUT") & 0xFFF,
            },
        }

    def dump_registers(self):
        return self.regs.dump(TEC_REG)


class LaserCurrentController:
    def __init__(self, regs):
        self.regs = regs

    def read(self, name_or_offset):
        offset = LASER_REG[name_or_offset] if isinstance(name_or_offset, str) else name_or_offset
        return self.regs.read32(offset)

    def write(self, name_or_offset, value):
        offset = LASER_REG[name_or_offset] if isinstance(name_or_offset, str) else name_or_offset
        self.regs.write32(offset, value)

    def supports_board_acquire(self):
        return self.read("VERSION") >= LASER_MIN_BOARD_ACQUIRE_VERSION

    def require_board_acquire(self):
        if not self.supports_board_acquire():
            raise RuntimeError("current laser bitstream does not support board acquire")

    def configure_acquire(self, search_min, search_max, threshold=20):
        self.require_board_acquire()
        search_min = require_u16("search_min", search_min)
        search_max = require_u16("search_max", search_max)
        threshold = require_u16("threshold", threshold)
        if search_max < search_min:
            raise ValueError("search_max must be >= search_min")
        self.write("ACQUIRE_SEARCH_RANGE", (search_max << 16) | search_min)
        self.write("ACQUIRE_THRESHOLD", threshold)
        self.write("ACQUIRE_CONTROL", LASER_ACQ_ENABLE)

    def arm_acquire(self):
        self.require_board_acquire()
        self.write("ACQUIRE_CONTROL", LASER_ACQ_ENABLE | LASER_ACQ_ARM)

    def cancel_acquire(self):
        self.require_board_acquire()
        self.write("ACQUIRE_CONTROL", LASER_ACQ_CANCEL)

    def clear_fault(self):
        self.write("CTRL", LASER_CTRL_FAULT_CLEAR)
        time.sleep(0.02)

    def stop(self):
        self.write("CTRL", LASER_CTRL_ENABLE | LASER_CTRL_STOP | LASER_CTRL_LASER_ARM)
        time.sleep(0.05)

    def emergency_stop(self):
        self.write("CTRL", LASER_CTRL_EMERGENCY_STOP)
        time.sleep(0.02)

    def configure_safety(
        self,
        ch0_min=0,
        ch0_max=40000,
        ch1_min=0,
        ch1_max=50000,
        ch0_soft_step=8,
        ch1_soft_step=8,
        ramp_interval=1000,
        dac_timeout=1000000,
        watchdog_timeout=0,
        enable_delay=0,
        current_limit=0,
        ch0_gain=0,
        ch1_gain=0,
        current_offset=0,
    ):
        ch0_min = require_u16("ch0_min", ch0_min)
        ch0_max = require_u16("ch0_max", ch0_max)
        ch1_min = require_u16("ch1_min", ch1_min)
        ch1_max = require_u16("ch1_max", ch1_max)
        self.write("CH0_LIMIT", (ch0_max << 16) | ch0_min)
        self.write("CH1_LIMIT", (ch1_max << 16) | ch1_min)
        self.write(
            "RAMP_CONFIG",
            (require_u16("ch1_soft_step", ch1_soft_step) << 16)
            | require_u16("ch0_soft_step", ch0_soft_step),
        )
        self.write("RAMP_INTERVAL_TICKS", require_u32("ramp_interval", ramp_interval))
        self.write("DAC_TIMEOUT_TICKS", require_u32("dac_timeout", dac_timeout))
        self.write("WATCHDOG_TIMEOUT_TICKS", require_u32("watchdog_timeout", watchdog_timeout))
        self.write("ENABLE_DELAY_TICKS", require_u32("enable_delay", enable_delay))
        self.write("CURRENT_LIMIT_CODE", require_u32("current_limit", current_limit))
        self.write("CH0_GAIN_COEFF", require_u16("ch0_gain", ch0_gain))
        self.write("CH1_GAIN_COEFF", require_u16("ch1_gain", ch1_gain))
        self.write("CURRENT_OFFSET", require_u32("current_offset", current_offset))

    def start_static(self, ch0, ch1=0, configure=True, **safety):
        ch0 = require_u16("ch0", ch0)
        ch1 = require_u16("ch1", ch1)
        if configure:
            self.configure_safety(**safety)
        self.set_static_setpoint(ch0, ch1)
        self.clear_fault()
        self.write(
            "CTRL",
            LASER_CTRL_ENABLE
            | LASER_CTRL_START
            | (MODE_STATIC << LASER_CTRL_MODE_SHIFT)
            | LASER_CTRL_LASER_ARM,
        )

    def set_static_setpoint(self, ch0, ch1=0):
        ch0 = require_u16("ch0", ch0)
        ch1 = require_u16("ch1", ch1)
        self.write("CH0_STATIC_CODE", ch0)
        self.write("CH1_STATIC_CODE", ch1)

    def hold_scan_start(self, configure=False, **safety):
        if configure:
            self.configure_safety(**safety)
        ch0 = self.read("CH0_STATIC_CODE") & 0xFFFF
        ch1 = self.read("CH1_START_CODE") & 0xFFFF
        self.write("CH1_STATIC_CODE", ch1)
        self.clear_fault()
        self.write(
            "CTRL",
            LASER_CTRL_ENABLE
            | LASER_CTRL_START
            | (MODE_STATIC << LASER_CTRL_MODE_SHIFT)
            | LASER_CTRL_LASER_ARM,
        )

    def start_fine_scan(
        self,
        ch0,
        start,
        stop,
        step,
        dwell=100,
        settle=100,
        frames=1,
        continuous=False,
        configure=True,
        **safety,
    ):
        ch0 = require_u16("ch0", ch0)
        start = require_u16("start", start)
        stop = require_u16("stop", stop)
        step = require_u16("step", step)
        if step == 0:
            raise ValueError("step must be nonzero")
        if configure:
            self.configure_safety(**safety)
        self.write("CH0_STATIC_CODE", ch0)
        self.write("CH1_START_CODE", start)
        self.write("CH1_STOP_CODE", stop)
        self.write("CH1_STEP_CODE", step)
        self.write("CH1_DWELL_TICKS", require_u32("dwell", dwell))
        self.write("FRAME_COUNT", require_u32("frames", frames))
        self.write("DAC_SETTLE_TICKS", require_u32("settle", settle))
        self.clear_fault()
        ctrl = (
            LASER_CTRL_ENABLE
            | LASER_CTRL_START
            | (MODE_FINE_SCAN << LASER_CTRL_MODE_SHIFT)
            | LASER_CTRL_LASER_ARM
        )
        if continuous:
            ctrl |= LASER_CTRL_CONTINUOUS
        self.write("CTRL", ctrl)

    def configure_lock(
        self,
        target_adc,
        bias_ch1,
        ch1_min,
        ch1_max,
        kp=0.5,
        ki=0.01,
        polarity_invert=False,
        integral_limit=500000,
        max_step=3,
        locked_threshold=1000,
        loss_threshold=10000,
        locked_count=50,
        loss_count=10,
        sat_count=100,
        fb_timeout=0,
        adc_min_valid=0,
        adc_max_valid=0,
    ):
        target_adc = require_u16("target_adc", target_adc)
        bias_ch1 = require_u16("bias_ch1", bias_ch1)
        ch1_min = require_u16("ch1_min", ch1_min)
        ch1_max = require_u16("ch1_max", ch1_max)
        if ch1_max < ch1_min:
            raise ValueError("ch1_max must be >= ch1_min")
        locked_threshold = require_u16("locked_threshold", locked_threshold)
        loss_threshold = require_u16("loss_threshold", loss_threshold)
        locked_count = require_u16("locked_count", locked_count)
        loss_count = require_u16("loss_count", loss_count)
        adc_min_valid = require_u16("adc_min_valid", adc_min_valid)
        adc_max_valid = require_u16("adc_max_valid", adc_max_valid)
        if (adc_min_valid or adc_max_valid) and adc_max_valid < adc_min_valid:
            raise ValueError("adc_max_valid must be >= adc_min_valid")

        self.write("LOCK_TARGET", target_adc | ((1 if polarity_invert else 0) << 16))
        self.write("LOCK_BIAS_CH1_CODE", bias_ch1)
        self.write("LOCK_CH1_RANGE", (ch1_max << 16) | ch1_min)
        self.write("LOCK_KP", q16_16(kp))
        self.write("LOCK_KI", q16_16(ki))
        self.write("LOCK_INTEGRAL_LIMIT", require_u32("integral_limit", integral_limit))
        self.write("LOCK_MAX_STEP", require_u16("max_step", max_step))
        self.write("LOCK_THRESHOLDS", (loss_threshold << 16) | locked_threshold)
        self.write("LOCK_COUNTS", (loss_count << 16) | locked_count)
        self.write("LOCK_SAT_LIMIT_COUNT", require_u32("sat_count", sat_count))
        self.write("LOCK_FB_TIMEOUT_TICKS", require_u32("fb_timeout", fb_timeout))
        self.write("LOCK_ADC_VALID_RANGE", (adc_max_valid << 16) | adc_min_valid)

    def start_lock(self, ch0, configure=True, **params):
        ch0 = require_u16("ch0", ch0)
        if configure:
            self.configure_safety(**{
                key: params.pop(key)
                for key in list(params.keys())
                if key in {
                    "ch0_min", "ch0_max", "ch1_min", "ch1_max",
                    "ch0_soft_step", "ch1_soft_step", "ramp_interval",
                    "dac_timeout", "watchdog_timeout", "enable_delay",
                    "current_limit", "ch0_gain", "ch1_gain", "current_offset",
                }
            })
        self.write("CH0_STATIC_CODE", ch0)
        self.configure_lock(**params)
        self.clear_fault()
        self.write(
            "CTRL",
            LASER_CTRL_ENABLE
            | LASER_CTRL_START
            | (MODE_LOCK << LASER_CTRL_MODE_SHIFT)
            | LASER_CTRL_LASER_ARM,
        )

    def hold_current(self):
        actual = self.read("ACTUAL_DAC_CODES")
        ch0, ch1 = split_u16_pair(actual)
        self.set_static_setpoint(ch0, ch1)
        self.clear_fault()
        self.write(
            "CTRL",
            LASER_CTRL_ENABLE
            | LASER_CTRL_START
            | (MODE_STATIC << LASER_CTRL_MODE_SHIFT)
            | LASER_CTRL_LASER_ARM,
        )

    def kick_watchdog(self):
        self.write("CTRL", LASER_CTRL_WATCHDOG_KICK)

    def status(self):
        control = self.read("CTRL")
        status = self.read("STATUS")
        faults = self.read("FAULT_STATUS")
        actual = self.read("ACTUAL_DAC_CODES")
        target = self.read("TARGET_DAC_CODES")
        scan = self.read("SCAN_INDEX")
        ch0_limit = self.read("CH0_LIMIT")
        ch1_limit = self.read("CH1_LIMIT")
        ramp_config = self.read("RAMP_CONFIG")
        actual_ch0, actual_ch1 = split_u16_pair(actual)
        target_ch0, target_ch1 = split_u16_pair(target)
        static_ch0 = self.read("CH0_STATIC_CODE") & 0xFFFF
        static_ch1 = self.read("CH1_STATIC_CODE") & 0xFFFF
        scan_ch1_start = self.read("CH1_START_CODE") & 0xFFFF
        scan_ch1_stop = self.read("CH1_STOP_CODE") & 0xFFFF
        scan_ch1_step = self.read("CH1_STEP_CODE") & 0xFFFF
        scan_dwell = self.read("CH1_DWELL_TICKS")
        scan_frames = self.read("FRAME_COUNT")
        scan_settle = self.read("DAC_SETTLE_TICKS")
        lock_target = self.read("LOCK_TARGET")
        lock_range = self.read("LOCK_CH1_RANGE")
        lock_thresholds = self.read("LOCK_THRESHOLDS")
        lock_counts = self.read("LOCK_COUNTS")
        lock_kp = self.read("LOCK_KP")
        lock_ki = self.read("LOCK_KI")
        lock_status = self.read("LOCK_STATUS")
        lock_counters = self.read("LOCK_COUNTERS")
        lock_bias = self.read("LOCK_BIAS_CH1_CODE") & 0xFFFF
        lock_output = self.read("LOCK_OUTPUT_CH1_CODE") & 0xFFFF
        version = self.read("VERSION")
        acquire_supported = version >= LASER_MIN_BOARD_ACQUIRE_VERSION
        acquire_control = self.read("ACQUIRE_CONTROL") if acquire_supported else 0
        acquire_search = self.read("ACQUIRE_SEARCH_RANGE") if acquire_supported else 0
        acquire_threshold = self.read("ACQUIRE_THRESHOLD") if acquire_supported else 0
        acquire_status = self.read("ACQUIRE_STATUS") if acquire_supported else 0
        acquire_match_code = self.read("ACQUIRE_MATCH_CODE") if acquire_supported else 0
        acquire_match_adc = self.read("ACQUIRE_MATCH_ADC") if acquire_supported else 0
        acquire_match_error = self.read("ACQUIRE_MATCH_ERROR") if acquire_supported else 0
        fast_index = scan & 0xFFFF
        slow_index = (scan >> 16) & 0xFFFF
        return {
            "base_hex": f"0x{self.regs.base:08X}",
            "version": version,
            "version_hex": f"0x{version:08X}",
            "control": control,
            "control_hex": f"0x{control:08X}",
            "status": status,
            "status_hex": f"0x{status:08X}",
            "status_flags": flags_from_bits(status, LASER_STATUS_BITS),
            "fault_status": faults,
            "fault_status_hex": f"0x{faults:08X}",
            "fault_flags": flags_from_bits(faults, LASER_FAULT_BITS),
            "actual": {
                "word": actual,
                "word_hex": f"0x{actual:08X}",
                "ch0_internal": actual_ch0,
                "ch1_internal": actual_ch1,
                "ch0_current_mA": ch0_code_to_ma(actual_ch0),
                "ch1_current_mA": ch1_code_to_ma(actual_ch1),
                "ch0_raw_dac": raw_laser_dac_code(actual_ch0),
                "ch1_raw_dac": raw_laser_dac_code(actual_ch1),
                "ch0_raw_dac_hex": f"0x{raw_laser_dac_code(actual_ch0):04X}",
                "ch1_raw_dac_hex": f"0x{raw_laser_dac_code(actual_ch1):04X}",
            },
            "target": {
                "word": target,
                "word_hex": f"0x{target:08X}",
                "ch0_internal": target_ch0,
                "ch1_internal": target_ch1,
                "ch0_current_mA": ch0_code_to_ma(target_ch0),
                "ch1_current_mA": ch1_code_to_ma(target_ch1),
                "ch0_raw_dac": raw_laser_dac_code(target_ch0),
                "ch1_raw_dac": raw_laser_dac_code(target_ch1),
                "ch0_raw_dac_hex": f"0x{raw_laser_dac_code(target_ch0):04X}",
                "ch1_raw_dac_hex": f"0x{raw_laser_dac_code(target_ch1):04X}",
            },
            "scan": {
                "word": scan,
                "word_hex": f"0x{scan:08X}",
                "slow_index": slow_index,
                "fast_index": fast_index,
            },
            "static_setpoint": {
                "ch0_internal": static_ch0,
                "ch1_internal": static_ch1,
                "ch0_current_mA": ch0_code_to_ma(static_ch0),
                "ch1_current_mA": ch1_code_to_ma(static_ch1),
            },
            "fine_scan_setpoint": {
                "ch0_internal": static_ch0,
                "ch1_start_internal": scan_ch1_start,
                "ch1_stop_internal": scan_ch1_stop,
                "ch1_step_internal": scan_ch1_step,
                "dwell_ticks": scan_dwell,
                "settle_ticks": scan_settle,
                "frames": scan_frames,
                "continuous": bool(control & LASER_CTRL_CONTINUOUS),
                "ch0_current_mA": ch0_code_to_ma(static_ch0),
                "ch1_start_current_mA": ch1_code_to_ma(scan_ch1_start),
                "ch1_stop_current_mA": ch1_code_to_ma(scan_ch1_stop),
            },
            "safety": {
                "ch0_min": ch0_limit & 0xFFFF,
                "ch0_max": (ch0_limit >> 16) & 0xFFFF,
                "ch1_min": ch1_limit & 0xFFFF,
                "ch1_max": (ch1_limit >> 16) & 0xFFFF,
                "ch0_soft_step": ramp_config & 0xFFFF,
                "ch1_soft_step": (ramp_config >> 16) & 0xFFFF,
                "ramp_interval": self.read("RAMP_INTERVAL_TICKS"),
                "dac_timeout": self.read("DAC_TIMEOUT_TICKS"),
                "watchdog_timeout": self.read("WATCHDOG_TIMEOUT_TICKS"),
                "enable_delay": self.read("ENABLE_DELAY_TICKS"),
                "current_limit": self.read("CURRENT_LIMIT_CODE"),
                "ch0_gain": self.read("CH0_GAIN_COEFF") & 0xFFFF,
                "ch1_gain": self.read("CH1_GAIN_COEFF") & 0xFFFF,
                "current_offset": self.read("CURRENT_OFFSET"),
            },
            "lock": {
                "target_adc": lock_target & 0xFFFF,
                "polarity_invert": bool(lock_target & (1 << 16)),
                "bias_ch1_internal": lock_bias,
                "bias_ch1_current_mA": ch1_code_to_ma(lock_bias),
                "ch1_min_internal": lock_range & 0xFFFF,
                "ch1_max_internal": (lock_range >> 16) & 0xFFFF,
                "kp": q16_16_to_float(lock_kp),
                "ki": q16_16_to_float(lock_ki),
                "kp_q16": lock_kp,
                "ki_q16": lock_ki,
                "integral_limit": self.read("LOCK_INTEGRAL_LIMIT"),
                "max_step": self.read("LOCK_MAX_STEP") & 0xFFFF,
                "locked_threshold": lock_thresholds & 0xFFFF,
                "loss_threshold": (lock_thresholds >> 16) & 0xFFFF,
                "locked_count_cfg": lock_counts & 0xFFFF,
                "loss_count_cfg": (lock_counts >> 16) & 0xFFFF,
                "sat_count_cfg": self.read("LOCK_SAT_LIMIT_COUNT"),
                "fb_timeout_ticks": self.read("LOCK_FB_TIMEOUT_TICKS"),
                "adc_valid_min": self.read("LOCK_ADC_VALID_RANGE") & 0xFFFF,
                "adc_valid_max": (self.read("LOCK_ADC_VALID_RANGE") >> 16) & 0xFFFF,
                "status": lock_status,
                "status_hex": f"0x{lock_status:08X}",
                "status_flags": flags_from_bits(lock_status, LASER_LOCK_STATUS_BITS),
                "error": s32(self.read("LOCK_ERROR")),
                "integral": s32(self.read("LOCK_INTEGRAL")),
                "output_ch1_internal": lock_output,
                "output_ch1_current_mA": ch1_code_to_ma(lock_output),
                "loss_counter": (lock_counters >> 16) & 0xFFFF,
                "locked_counter": lock_counters & 0xFFFF,
            },
            "acquire": {
                "supported": acquire_supported,
                "control": acquire_control,
                "control_hex": f"0x{acquire_control:08X}",
                "enabled": bool(acquire_control & LASER_ACQ_ENABLE),
                "search_min": acquire_search & 0xFFFF,
                "search_max": (acquire_search >> 16) & 0xFFFF,
                "threshold": acquire_threshold & 0xFFFF,
                "status": acquire_status,
                "status_hex": f"0x{acquire_status:08X}",
                "active": bool(acquire_status & (1 << 0)),
                "matched": bool(acquire_status & (1 << 1)),
                "cancelled": bool(acquire_status & (1 << 2)),
                "match_code": acquire_match_code & 0xFFFF,
                "match_adc": acquire_match_adc & 0xFFFF,
                "match_error": s32(acquire_match_error),
            },
            "frame_index": self.read("FRAME_INDEX"),
            "last_fb_adc": self.read("LAST_FB_ADC") & 0xFFFF,
            "current_estimate": self.read("CURRENT_ESTIMATE"),
        }

    def dump_registers(self):
        return self.regs.dump(LASER_REG)


class Ada4355Capture:
    def __init__(self, regs, buf0_regs, buf1_regs, raw_buf_regs):
        self.regs = regs
        self.buf0_regs = buf0_regs
        self.buf1_regs = buf1_regs
        self.raw_buf_regs = raw_buf_regs

    def read(self, name_or_offset):
        offset = ADA_REG[name_or_offset] if isinstance(name_or_offset, str) else name_or_offset
        return self.regs.read32(offset)

    def write(self, name_or_offset, value):
        offset = ADA_REG[name_or_offset] if isinstance(name_or_offset, str) else name_or_offset
        self.regs.write32(offset, value)

    def start(self, clear_counters=False):
        ctrl = ADA_RUN_DEFAULT
        if clear_counters:
            ctrl |= ADA_CTRL_CLEAR_COUNTERS
        self.write("CONTROL", ctrl)

    def stop(self):
        self.write("CONTROL", 0)

    def soft_reset(self):
        self.write("CONTROL", ADA_CTRL_SOFT_RESET)
        time.sleep(0.02)

    def set_monitor_rate_hz(self, rate_hz, adc_clk_hz=125000000):
        rate_hz = float(rate_hz)
        if rate_hz <= 0:
            raise ValueError("rate_hz must be positive")
        decim = max(1, int(round(float(adc_clk_hz) / rate_hz)))
        self.write("MONITOR_DECIM_N", decim)
        return decim

    def configure_capture(self, sample_delay=None, sample_window=None, max_points=None, frame_decim=None):
        if sample_delay is not None:
            self.write("SAMPLE_DELAY", require_u32("sample_delay", sample_delay))
        if sample_window is not None:
            self.write("SAMPLE_WINDOW", require_u32("sample_window", sample_window))
        if max_points is not None:
            self.write("MAX_POINTS", require_range("max_points", max_points, 1, 16384))
        if frame_decim is not None:
            self.write("FRAME_DECIM_N", require_range("frame_decim", frame_decim, 1, 0xFFFFFFFF))

    def configure_filter(
        self,
        control=None,
        threshold=None,
        lp_shift=None,
        raw_lp_shift=None,
        enable=None,
        glitch_reject=None,
        raw_filtered=None,
        spectrum_filtered=None,
        monitor_filtered=None,
    ):
        if control is None:
            control = self.read("FILTER_CONTROL")
            updates = [
                (ADA_FILTER_ENABLE, enable),
                (ADA_FILTER_GLITCH_REJECT, glitch_reject),
                (ADA_FILTER_RAW_USE_FILTERED, raw_filtered),
                (ADA_FILTER_SPECTRUM_USE_FILTERED, spectrum_filtered),
                (ADA_FILTER_MONITOR_USE_FILTERED, monitor_filtered),
            ]
            for bit, value in updates:
                if value is None:
                    continue
                if bool(value):
                    control |= bit
                else:
                    control &= ~bit
        self.write("FILTER_CONTROL", require_u32("control", control))
        if threshold is not None:
            self.write("GLITCH_THRESHOLD", require_range("threshold", threshold, 0, 0xFFFF))
        if lp_shift is not None:
            self.write("LP_SHIFT", require_range("lp_shift", lp_shift, 0, 31))
        if raw_lp_shift is not None:
            self.write("RAW_LP_SHIFT", require_range("raw_lp_shift", raw_lp_shift, 0, 31))
        return self.status()

    def capture_raw(self, length=ADA_RAW_MAX_POINTS, decim=1, timeout=1.0, release_existing=True):
        length = require_range("length", length, 1, ADA_RAW_MAX_POINTS)
        decim = require_u32("decim", decim)
        if decim == 0:
            decim = 1
        if release_existing:
            self.release_buffer()
        self.write("RAW_LENGTH", length)
        self.write("RAW_DECIM", decim)
        self.write("CONTROL", ADA_RUN_DEFAULT)
        self.write("RAW_CONTROL", 1)
        deadline = time.time() + float(timeout)
        while time.time() < deadline:
            status = self.read("RAW_STATUS")
            if status & 0x4:
                break
            time.sleep(0.002)
        status = self.read("RAW_STATUS")
        count = min(self.read("RAW_WRITE_COUNT"), length)
        return {
            "status": status,
            "status_hex": f"0x{status:08X}",
            "busy": bool(status & 0x2),
            "done": bool(status & 0x4),
            "length": length,
            "decim": decim,
            "write_count": count,
            "sample_rate_hz": 125000000.0 / float(decim),
        }

    def read_raw(self, count=None):
        available = self.read("RAW_WRITE_COUNT")
        if count is None:
            count = available
        count = min(require_u32("count", count), ADA_RAW_MAX_POINTS)
        word_count = (count + 1) // 2
        words = self.raw_buf_regs.read_words(word_count)
        samples = []
        for word in words:
            samples.append(word & 0xFFFF)
            if len(samples) < count:
                samples.append((word >> 16) & 0xFFFF)
        raw_status = self.read("RAW_STATUS")
        return {
            "count": count,
            "samples": samples,
            "storage": "packed_u16_le",
            "word_count": word_count,
            "raw_status": raw_status,
            "raw_status_hex": f"0x{raw_status:08X}",
            "raw_write_count": available,
            "decim": self.read("RAW_DECIM"),
        }

    def lock_latest_buffer(self):
        self.write("CONTROL", ADA_RUN_DEFAULT | ADA_CTRL_LOCK_READ_BUFFER)
        time.sleep(0.01)
        locked = self.read("LOCKED_BUFFER_ID")
        if locked == 0xFFFFFFFF:
            return None
        return locked & 1

    def release_buffer(self):
        self.write("CONTROL", ADA_RUN_DEFAULT | ADA_CTRL_RELEASE_READ_BUFFER | ADA_CTRL_CLEAR_FRAME_AVAILABLE)

    def read_spectrum(self, count=None, release=True):
        buf_id = self.lock_latest_buffer()
        if buf_id is None:
            raise RuntimeError("no readable ADA4355 spectrum buffer; wait for a completed frame")
        points = self.read("READ_POINTS_WRITTEN")
        max_fast = self.read("READ_MAX_FAST_INDEX")
        frame = self.read("READ_FRAME_COUNTER")
        slow = self.read("READ_SLOW_INDEX")
        frame_decim = self.read("FRAME_DECIM_N")
        captured = self.read("CAPTURED_COUNT")
        if count is None:
            count = max(points, max_fast + 1)
        count = min(require_u32("count", count), 16384)
        source = self.buf0_regs if buf_id == 0 else self.buf1_regs
        words = source.read_words(count)
        duration_s = float(captured) * float(frame_decim) / 125000000.0
        duration_ms = duration_s * 1000.0
        dt_us = (duration_s * 1000000.0 / float(count - 1)) if count > 1 else 0.0
        if release:
            self.release_buffer()
        return {
            "buffer_id": buf_id,
            "frame_counter": frame,
            "slow_index": slow,
            "points_written": points,
            "max_fast_index": max_fast,
            "captured_count": captured,
            "frame_decim_n": frame_decim,
            "duration_s": duration_s,
            "duration_ms": duration_ms,
            "start_time_ms": 0.0,
            "end_time_ms": duration_ms,
            "dt_us_per_point": dt_us,
            "count": count,
            "points": words,
        }

    def status(self):
        status = self.read("STATUS")
        min_max = self.read("MONITOR_MIN_MAX")
        avg = self.read("MONITOR_AVG")
        monitor_decim = self.read("MONITOR_DECIM_N")
        debug_adc_last = self.read("DEBUG_ADC_LAST") & 0xFFFF
        filter_control = self.read("FILTER_CONTROL")
        filtered_adc = self.read("FILTERED_ADC_LAST") & 0xFFFF
        return {
            "base_hex": f"0x{self.regs.base:08X}",
            "buf0_base_hex": f"0x{self.buf0_regs.base:08X}",
            "buf1_base_hex": f"0x{self.buf1_regs.base:08X}",
            "raw_base_hex": f"0x{self.raw_buf_regs.base:08X}",
            "version": self.read("VERSION"),
            "version_hex": f"0x{self.read('VERSION'):08X}",
            "status": status,
            "status_hex": f"0x{status:08X}",
            "status_flags": flags_from_bits(status, ADA_STATUS_BITS),
            "monitor_decim_n": monitor_decim,
            "monitor_rate_hz": 125000000.0 / float(monitor_decim) if monitor_decim else 0.0,
            "monitor_avg": avg,
            "monitor_min": min_max & 0xFFFF,
            "monitor_max": (min_max >> 16) & 0xFFFF,
            "monitor_counter": self.read("MONITOR_COUNTER"),
            "debug_adc_last": debug_adc_last,
            "filtered_adc_last": filtered_adc,
            "filter": {
                "control": filter_control,
                "control_hex": f"0x{filter_control:08X}",
                "enabled": bool(filter_control & ADA_FILTER_ENABLE),
                "glitch_reject": bool(filter_control & ADA_FILTER_GLITCH_REJECT),
                "raw_use_filtered": bool(filter_control & ADA_FILTER_RAW_USE_FILTERED),
                "spectrum_use_filtered": bool(filter_control & ADA_FILTER_SPECTRUM_USE_FILTERED),
                "monitor_use_filtered": bool(filter_control & ADA_FILTER_MONITOR_USE_FILTERED),
                "glitch_threshold": self.read("GLITCH_THRESHOLD"),
                "lp_shift": self.read("LP_SHIFT"),
                "raw_lp_shift": self.read("RAW_LP_SHIFT"),
                "filtered_adc_last": filtered_adc,
                "raw_filtered_adc_last": self.read("RAW_FILTERED_ADC_LAST") & 0xFFFF,
                "glitch_reject_counter": self.read("GLITCH_REJECT_COUNTER"),
            },
            "relative_intensity_code": max(0, 0xFFFF - avg),
            "sample_delay": self.read("SAMPLE_DELAY"),
            "sample_window": self.read("SAMPLE_WINDOW"),
            "max_points": self.read("MAX_POINTS"),
            "frame_decim_n": self.read("FRAME_DECIM_N"),
            "captured_count": self.read("CAPTURED_COUNT"),
            "points_written": self.read("POINTS_WRITTEN"),
            "max_fast_index_seen": self.read("MAX_FAST_INDEX_SEEN"),
            "read_buffer_id": self.read("READ_BUFFER_ID"),
            "locked_buffer_id": self.read("LOCKED_BUFFER_ID"),
            "read_frame_counter": self.read("READ_FRAME_COUNTER"),
            "read_slow_index": self.read("READ_SLOW_INDEX"),
            "read_points_written": self.read("READ_POINTS_WRITTEN"),
            "read_max_fast_index": self.read("READ_MAX_FAST_INDEX"),
            "read_status": self.read("READ_STATUS"),
            "read_status_hex": f"0x{self.read('READ_STATUS'):08X}",
            "total_frame_counter": self.read("TOTAL_FRAME_COUNTER"),
            "dropped_frame_counter": self.read("DROPPED_FRAME_COUNTER"),
            "point_overrun_counter": self.read("POINT_OVERRUN_COUNTER"),
            "raw": {
                "control": self.read("RAW_CONTROL"),
                "status": self.read("RAW_STATUS"),
                "status_hex": f"0x{self.read('RAW_STATUS'):08X}",
                "length": self.read("RAW_LENGTH"),
                "decim": self.read("RAW_DECIM"),
                "write_count": self.read("RAW_WRITE_COUNT"),
                "capacity_samples": self.read("RAW_CAPACITY_SAMPLES"),
                "buffer_words": self.read("RAW_BUFFER_WORDS"),
                "storage": "packed_u16_le",
            },
        }

    def dump_registers(self):
        return self.regs.dump(ADA_REG)


class ButterflyLaserSystem:
    def __init__(
        self,
        tec_base=DEFAULT_TEC_BASE,
        laser_base=DEFAULT_LASER_BASE,
        span=DEFAULT_SPAN,
        ada_base=DEFAULT_ADA_BASE,
        ada_buf0_base=DEFAULT_ADA_BUF0_BASE,
        ada_buf1_base=DEFAULT_ADA_BUF1_BASE,
        ada_raw_base=DEFAULT_ADA_RAW_BASE,
        buffer_span=DEFAULT_BUFFER_SPAN,
        raw_buffer_span=DEFAULT_RAW_BUFFER_SPAN,
    ):
        self.tec_regs = AxiMap(tec_base, span)
        self.laser_regs = AxiMap(laser_base, span)
        self.ada_regs = AxiMap(ada_base, span)
        self.ada_buf0_regs = AxiMap(ada_buf0_base, buffer_span)
        self.ada_buf1_regs = AxiMap(ada_buf1_base, buffer_span)
        self.ada_raw_regs = AxiMap(ada_raw_base, raw_buffer_span)
        self.tec = TecController(self.tec_regs)
        self.laser = LaserCurrentController(self.laser_regs)
        self.ada = Ada4355Capture(
            self.ada_regs,
            self.ada_buf0_regs,
            self.ada_buf1_regs,
            self.ada_raw_regs,
        )

    def close(self):
        self.tec_regs.close()
        self.laser_regs.close()
        self.ada_regs.close()
        self.ada_buf0_regs.close()
        self.ada_buf1_regs.close()
        self.ada_raw_regs.close()

    def status(self):
        return {
            "tec": self.tec.status(),
            "laser": self.laser.status(),
            "ada4355": self.ada.status(),
        }

    def stop_all(self):
        self.laser.emergency_stop()
        self.tec.stop()
        return self.status()

    def start_tec_default(self, target_celsius=None, reset=True):
        if reset:
            self.tec.soft_reset(delay=1.0)
        self.tec.init(delay=1.0)
        if target_celsius is not None:
            self.tec.set_target_celsius(target_celsius)
        self.tec.start_closed_loop()
        time.sleep(0.2)
        return self.tec.status()


def print_json(obj):
    print(json.dumps(obj, indent=2, sort_keys=True))


def print_human_status(system):
    snapshot = system.status()
    tec = snapshot["tec"]
    laser = snapshot["laser"]
    print("TEC")
    print(f"  STATUS       {tec['status_hex']} {tec['status_flags']}")
    print(f"  ERROR        {tec['main_error_status_hex']} {tec['error_flags']}")
    print(f"  TEMP         {tec['temperature_filtered_celsius']:.3f} C")
    print(f"  TARGET       {tec['target_celsius']:.3f} C")
    print(f"  TEMP ERROR   {tec['error_celsius']:.3f} C")
    print(f"  DAC          active=0x{tec['active_dac_code']:03X} manual=0x{tec['manual_dac_code']:03X}")
    print("")
    print("LASER CURRENT")
    print(f"  STATUS       {laser['status_hex']} {laser['status_flags']}")
    print(f"  FAULT        {laser['fault_status_hex']} {laser['fault_flags']}")
    print(
        "  ACTUAL       "
        f"ch0={laser['actual']['ch0_internal']} raw={laser['actual']['ch0_raw_dac_hex']}  "
        f"ch1={laser['actual']['ch1_internal']} raw={laser['actual']['ch1_raw_dac_hex']}"
    )
    print(
        "  TARGET       "
        f"ch0={laser['target']['ch0_internal']} raw={laser['target']['ch0_raw_dac_hex']}  "
        f"ch1={laser['target']['ch1_internal']} raw={laser['target']['ch1_raw_dac_hex']}"
    )
    print(f"  SCAN         slow={laser['scan']['slow_index']} fast={laser['scan']['fast_index']} frame={laser['frame_index']}")
    print("")
    ada = snapshot["ada4355"]
    print("ADA4355 CAPTURE")
    print(f"  STATUS       {ada['status_hex']} {ada['status_flags']}")
    print(f"  MONITOR      avg={ada['monitor_avg']} min={ada['monitor_min']} max={ada['monitor_max']} count={ada['monitor_counter']}")
    print(f"  FRAME        buf={ada['read_buffer_id']} points={ada['read_points_written']} max_fast={ada['read_max_fast_index']} total={ada['total_frame_counter']}")
    print(f"  ERRORS       dropped={ada['dropped_frame_counter']} overrun={ada['point_overrun_counter']}")


def add_base_args(parser):
    parser.add_argument("--tec-base", default=hex(DEFAULT_TEC_BASE), help="TEC AXI base address")
    parser.add_argument("--laser-base", default=hex(DEFAULT_LASER_BASE), help="Laser current AXI base address")
    parser.add_argument("--ada-base", default=hex(DEFAULT_ADA_BASE), help="ADA4355 capture AXI base address")
    parser.add_argument("--ada-buf0-base", default=hex(DEFAULT_ADA_BUF0_BASE), help="ADA4355 spectrum buffer 0 base address")
    parser.add_argument("--ada-buf1-base", default=hex(DEFAULT_ADA_BUF1_BASE), help="ADA4355 spectrum buffer 1 base address")
    parser.add_argument("--ada-raw-base", default=hex(DEFAULT_ADA_RAW_BASE), help="ADA4355 packed raw buffer base address")
    parser.add_argument("--span", default=hex(DEFAULT_SPAN), help="/dev/mem mapping span")
    parser.add_argument("--buffer-span", default=hex(DEFAULT_BUFFER_SPAN), help="ADA4355 spectrum buffer mapping span")
    parser.add_argument("--raw-buffer-span", default=hex(DEFAULT_RAW_BUFFER_SPAN), help="ADA4355 packed raw buffer mapping span")
    parser.add_argument("--json", action="store_true", help="Print JSON output")


def add_laser_safety_args(parser):
    parser.add_argument("--ch0-min", type=parse_int, default=0)
    parser.add_argument("--ch0-max", type=parse_int, default=40000)
    parser.add_argument("--ch1-min", type=parse_int, default=0)
    parser.add_argument("--ch1-max", type=parse_int, default=40000)
    parser.add_argument("--ch0-soft-step", type=parse_int, default=8)
    parser.add_argument("--ch1-soft-step", type=parse_int, default=8)
    parser.add_argument("--ramp-interval", type=parse_int, default=1000)
    parser.add_argument("--dac-timeout", type=parse_int, default=1000000)
    parser.add_argument("--watchdog-timeout", type=parse_int, default=0)
    parser.add_argument("--enable-delay", type=parse_int, default=0)
    parser.add_argument("--current-limit", type=parse_int, default=0)
    parser.add_argument("--ch0-gain", type=parse_int, default=0)
    parser.add_argument("--ch1-gain", type=parse_int, default=0)
    parser.add_argument("--current-offset", type=parse_int, default=0)


def safety_kwargs(args):
    return {
        "ch0_min": args.ch0_min,
        "ch0_max": args.ch0_max,
        "ch1_min": args.ch1_min,
        "ch1_max": args.ch1_max,
        "ch0_soft_step": args.ch0_soft_step,
        "ch1_soft_step": args.ch1_soft_step,
        "ramp_interval": args.ramp_interval,
        "dac_timeout": args.dac_timeout,
        "watchdog_timeout": args.watchdog_timeout,
        "enable_delay": args.enable_delay,
        "current_limit": args.current_limit,
        "ch0_gain": args.ch0_gain,
        "ch1_gain": args.ch1_gain,
        "current_offset": args.current_offset,
    }


def build_parser():
    parser = argparse.ArgumentParser(description="Control Butterfly Laser Driver registers")
    add_base_args(parser)
    sub = parser.add_subparsers(dest="cmd", required=True)

    sub.add_parser("status", help="Print decoded TEC and laser status")
    sub.add_parser("dump-tec", help="Dump TEC registers")
    sub.add_parser("dump-laser", help="Dump laser current registers")
    sub.add_parser("dump-ada", help="Dump ADA4355 capture registers")
    sub.add_parser("stop-all", help="Emergency stop laser and stop TEC loop")
    sub.add_parser("ada-start", help="Start ADA4355 monitor and capture")
    sub.add_parser("ada-stop", help="Stop ADA4355 monitor and capture")
    sub.add_parser("ada-clear", help="Clear ADA4355 counters")

    p = sub.add_parser("ada-monitor-rate", help="Set ADA4355 monitor update rate")
    p.add_argument("--hz", type=float, required=True)
    p.add_argument("--adc-clk-hz", type=parse_int, default=125000000)

    p = sub.add_parser("ada-capture-config", help="Configure ADA4355 capture timing")
    p.add_argument("--sample-delay", type=parse_int)
    p.add_argument("--sample-window", type=parse_int)
    p.add_argument("--max-points", type=parse_int)
    p.add_argument("--frame-decim", type=parse_int, help="Continuous-frame decimation before 16384-point resample")

    p = sub.add_parser("ada-filter", help="Configure ADA4355 glitch reject and low-pass filter")
    p.add_argument("--control", type=parse_int, help="Raw FILTER_CONTROL value")
    p.add_argument("--threshold", type=parse_int, help="Glitch reject threshold in ADC codes")
    p.add_argument("--lp-shift", type=parse_int, help="IIR shift; 13 is about 2.4 kHz at 125 MHz")
    p.add_argument("--filter", dest="enable", action="store_true", help="Enable low-pass filter")
    p.add_argument("--no-filter", dest="enable", action="store_false", help="Disable low-pass filter")
    p.add_argument("--glitch", dest="glitch_reject", action="store_true", help="Enable glitch reject")
    p.add_argument("--no-glitch", dest="glitch_reject", action="store_false", help="Disable glitch reject")
    p.add_argument("--raw-filtered", dest="raw_filtered", action="store_true", help="Store filtered samples in raw snapshot")
    p.add_argument("--raw-raw", dest="raw_filtered", action="store_false", help="Store original ADC samples in raw snapshot")
    p.add_argument("--spectrum-filtered", dest="spectrum_filtered", action="store_true", help="Use filtered samples for spectrum")
    p.add_argument("--spectrum-raw", dest="spectrum_filtered", action="store_false", help="Use original samples for spectrum")
    p.add_argument("--monitor-filtered", dest="monitor_filtered", action="store_true", help="Use filtered samples for monitor")
    p.add_argument("--monitor-raw", dest="monitor_filtered", action="store_false", help="Use original samples for monitor")
    p.set_defaults(enable=None, glitch_reject=None, raw_filtered=None, spectrum_filtered=None, monitor_filtered=None)

    p = sub.add_parser("ada-read-spectrum", help="Read latest ADA4355 spectrum to stdout or CSV")
    p.add_argument("--points", type=parse_int)
    p.add_argument("--out")
    p.add_argument("--no-release", action="store_true")

    p = sub.add_parser("ada-raw-capture", help="Capture raw 125 MHz ADC snapshot into buffer0")
    p.add_argument("--length", type=parse_int, default=16384)
    p.add_argument("--decim", type=parse_int, default=1)
    p.add_argument("--timeout", type=float, default=1.0)
    p.add_argument("--out")

    p = sub.add_parser("tec-start", help="Soft reset, init, and start TEC closed loop")
    p.add_argument("--target", type=float, help="Optional target temperature in degC")
    p.add_argument("--no-reset", action="store_true", help="Skip TEC soft reset")

    p = sub.add_parser("tec-target", help="Set TEC target temperature")
    p.add_argument("--celsius", type=float, required=True)

    p = sub.add_parser("tec-open-loop", help="Run TEC open-loop")
    p.add_argument("--dac", type=parse_int, default=0x800)
    p.add_argument("--enable-tec", action="store_true")

    sub.add_parser("tec-stop", help="Disable TEC output, set manual DAC to 0x800, and keep temperature monitor running")
    sub.add_parser("tec-clear-fault", help="Pulse TEC fault clear")

    p = sub.add_parser("tec-pid", help="Update TEC PID parameters")
    p.add_argument("--kp", type=float)
    p.add_argument("--ki", type=float)
    p.add_argument("--kd", type=float)
    p.add_argument("--integral-limit", type=parse_int)
    p.add_argument("--max-step", type=parse_int)
    p.add_argument("--dac-min", type=parse_int)
    p.add_argument("--dac-max", type=parse_int)
    p.add_argument("--dac-bias", type=parse_int)
    p.add_argument("--dac-safe", type=parse_int)

    p = sub.add_parser("laser-static", help="Start laser static output")
    p.add_argument("--ch0", type=parse_int, required=True)
    p.add_argument("--ch1", type=parse_int, default=0)
    add_laser_safety_args(p)

    p = sub.add_parser("laser-fine-scan", help="Start laser fine scan")
    p.add_argument("--ch0", type=parse_int, required=True)
    p.add_argument("--start", type=parse_int, required=True)
    p.add_argument("--stop", type=parse_int, required=True)
    p.add_argument("--step", type=parse_int, required=True)
    p.add_argument("--dwell", type=parse_int, default=100)
    p.add_argument("--settle", type=parse_int, default=100)
    p.add_argument("--frames", type=parse_int, default=1)
    p.add_argument("--continuous", action="store_true")
    add_laser_safety_args(p)

    p = sub.add_parser("laser-lock", help="Start side-fringe lock: CH0 fixed, CH1 PI feedback")
    p.add_argument("--ch0", type=parse_int, required=True)
    p.add_argument("--target-adc", type=parse_int, required=True)
    p.add_argument("--bias-ch1", type=parse_int, required=True)
    p.add_argument("--lock-ch1-min", type=parse_int, required=True)
    p.add_argument("--lock-ch1-max", type=parse_int, required=True)
    p.add_argument("--kp", type=float, default=0.5)
    p.add_argument("--ki", type=float, default=0.01)
    p.add_argument("--polarity-invert", action="store_true")
    p.add_argument("--integral-limit", type=parse_int, default=500000)
    p.add_argument("--max-step", type=parse_int, default=3)
    p.add_argument("--locked-threshold", type=parse_int, default=1000)
    p.add_argument("--loss-threshold", type=parse_int, default=10000)
    p.add_argument("--locked-count", type=parse_int, default=50)
    p.add_argument("--loss-count", type=parse_int, default=10)
    p.add_argument("--sat-count", type=parse_int, default=100)
    p.add_argument("--fb-timeout", type=parse_int, default=0)
    p.add_argument("--adc-min-valid", type=parse_int, default=0)
    p.add_argument("--adc-max-valid", type=parse_int, default=0)
    add_laser_safety_args(p)

    sub.add_parser("laser-lock-hold", help="Leave lock mode and hold current CH0/CH1 codes")
    sub.add_parser("laser-stop", help="Request laser soft stop")
    sub.add_parser("laser-estop", help="Emergency stop laser current controller")
    sub.add_parser("laser-clear-fault", help="Pulse laser fault clear")

    p = sub.add_parser("read", help="Raw register read")
    p.add_argument("--block", choices=["tec", "laser", "ada"], required=True)
    p.add_argument("--offset", type=parse_int, required=True)

    p = sub.add_parser("write", help="Raw register write")
    p.add_argument("--block", choices=["tec", "laser", "ada"], required=True)
    p.add_argument("--offset", type=parse_int, required=True)
    p.add_argument("--value", type=parse_int, required=True)

    return parser


def main():
    args = build_parser().parse_args()
    system = ButterflyLaserSystem(
        tec_base=args.tec_base,
        laser_base=args.laser_base,
        span=args.span,
        ada_base=args.ada_base,
        ada_buf0_base=args.ada_buf0_base,
        ada_buf1_base=args.ada_buf1_base,
        ada_raw_base=args.ada_raw_base,
        buffer_span=args.buffer_span,
        raw_buffer_span=args.raw_buffer_span,
    )
    try:
        result = None
        if args.cmd == "status":
            if args.json:
                print_json(system.status())
            else:
                print_human_status(system)
            return
        if args.cmd == "dump-tec":
            result = system.tec.dump_registers()
        elif args.cmd == "dump-laser":
            result = system.laser.dump_registers()
        elif args.cmd == "dump-ada":
            result = system.ada.dump_registers()
        elif args.cmd == "stop-all":
            result = system.stop_all()
        elif args.cmd == "ada-start":
            system.ada.start()
            result = system.ada.status()
        elif args.cmd == "ada-stop":
            system.ada.stop()
            result = system.ada.status()
        elif args.cmd == "ada-clear":
            system.ada.start(clear_counters=True)
            result = system.ada.status()
        elif args.cmd == "ada-monitor-rate":
            decim = system.ada.set_monitor_rate_hz(args.hz, args.adc_clk_hz)
            result = {"decim": decim, "ada4355": system.ada.status()}
        elif args.cmd == "ada-capture-config":
            system.ada.configure_capture(args.sample_delay, args.sample_window, args.max_points, args.frame_decim)
            result = system.ada.status()
        elif args.cmd == "ada-filter":
            result = system.ada.configure_filter(
                control=args.control,
                threshold=args.threshold,
                lp_shift=args.lp_shift,
                enable=args.enable,
                glitch_reject=args.glitch_reject,
                raw_filtered=args.raw_filtered,
                spectrum_filtered=args.spectrum_filtered,
                monitor_filtered=args.monitor_filtered,
            )
        elif args.cmd == "ada-read-spectrum":
            spectrum = system.ada.read_spectrum(args.points, release=not args.no_release)
            if args.out:
                import csv
                ch0_code = system.laser.read("CH0_STATIC_CODE") & 0xFFFF
                ch1_start_code = system.laser.read("CH1_START_CODE") & 0xFFFF
                ch1_stop_code = system.laser.read("CH1_STOP_CODE") & 0xFFFF
                ch0_ma = ch0_code_to_ma(ch0_code)
                ch1_start_ma = ch1_code_to_ma(ch1_start_code)
                ch1_stop_ma = ch1_code_to_ma(ch1_stop_code)
                point_count = len(spectrum["points"])
                with open(args.out, "w", newline="", encoding="utf-8") as f:
                    writer = csv.writer(f)
                    writer.writerow([
                        "frame",
                        "slow_index",
                        "index",
                        "time_ms",
                        "ch0_current_mA",
                        "ch1_current_mA",
                        "adc_code",
                        "relative_intensity_code",
                    ])
                    for i, value in enumerate(spectrum["points"]):
                        frac = float(i) / float(point_count - 1) if point_count > 1 else 0.0
                        writer.writerow([
                            spectrum["frame_counter"],
                            spectrum["slow_index"],
                            i,
                            frac * spectrum["duration_ms"],
                            ch0_ma,
                            ch1_start_ma + frac * (ch1_stop_ma - ch1_start_ma),
                            value,
                            max(0, 0xFFFF - value),
                        ])
                spectrum = dict(spectrum)
                spectrum["ch0_code"] = ch0_code
                spectrum["ch1_start_code"] = ch1_start_code
                spectrum["ch1_stop_code"] = ch1_stop_code
                spectrum["ch0_current_mA"] = ch0_ma
                spectrum["ch1_start_current_mA"] = ch1_start_ma
                spectrum["ch1_stop_current_mA"] = ch1_stop_ma
                spectrum["points"] = []
                spectrum["out"] = args.out
            result = spectrum
        elif args.cmd == "ada-raw-capture":
            meta = system.ada.capture_raw(args.length, args.decim, args.timeout)
            raw = system.ada.read_raw(meta["write_count"])
            if args.out:
                import csv
                with open(args.out, "w", newline="", encoding="utf-8") as f:
                    writer = csv.writer(f)
                    writer.writerow(["sample_index", "adc_raw"])
                    for i, value in enumerate(raw["samples"]):
                        writer.writerow([i, value])
                raw = dict(raw)
                raw["samples"] = []
                raw["out"] = args.out
            result = {"capture": meta, "raw": raw}
        elif args.cmd == "tec-start":
            result = system.start_tec_default(args.target, reset=not args.no_reset)
        elif args.cmd == "tec-target":
            system.tec.set_target_celsius(args.celsius)
            result = system.tec.status()
        elif args.cmd == "tec-open-loop":
            system.tec.start_open_loop(args.dac, enable_tec=args.enable_tec)
            result = system.tec.status()
        elif args.cmd == "tec-stop":
            system.tec.stop()
            result = system.tec.status()
        elif args.cmd == "tec-clear-fault":
            system.tec.clear_fault()
            result = system.tec.status()
        elif args.cmd == "tec-pid":
            system.tec.configure_pid(
                kp=args.kp,
                ki=args.ki,
                kd=args.kd,
                integral_limit=args.integral_limit,
                max_step=args.max_step,
                dac_min=args.dac_min,
                dac_max=args.dac_max,
                dac_bias=args.dac_bias,
                dac_safe=args.dac_safe,
            )
            result = system.tec.status()
        elif args.cmd == "laser-static":
            system.laser.start_static(args.ch0, args.ch1, **safety_kwargs(args))
            time.sleep(0.1)
            result = system.laser.status()
        elif args.cmd == "laser-fine-scan":
            system.laser.start_fine_scan(
                args.ch0,
                args.start,
                args.stop,
                args.step,
                dwell=args.dwell,
                settle=args.settle,
                frames=args.frames,
                continuous=args.continuous,
                **safety_kwargs(args),
            )
            time.sleep(0.1)
            result = system.laser.status()
        elif args.cmd == "laser-lock":
            system.laser.configure_safety(**safety_kwargs(args))
            system.laser.start_lock(
                args.ch0,
                configure=False,
                target_adc=args.target_adc,
                bias_ch1=args.bias_ch1,
                ch1_min=args.lock_ch1_min,
                ch1_max=args.lock_ch1_max,
                kp=args.kp,
                ki=args.ki,
                polarity_invert=args.polarity_invert,
                integral_limit=args.integral_limit,
                max_step=args.max_step,
                locked_threshold=args.locked_threshold,
                loss_threshold=args.loss_threshold,
                locked_count=args.locked_count,
                loss_count=args.loss_count,
                sat_count=args.sat_count,
                fb_timeout=args.fb_timeout,
                adc_min_valid=args.adc_min_valid,
                adc_max_valid=args.adc_max_valid,
            )
            time.sleep(0.1)
            result = system.laser.status()
        elif args.cmd == "laser-lock-hold":
            system.laser.hold_current()
            result = system.laser.status()
        elif args.cmd == "laser-stop":
            system.laser.stop()
            result = system.laser.status()
        elif args.cmd == "laser-estop":
            system.laser.emergency_stop()
            result = system.laser.status()
        elif args.cmd == "laser-clear-fault":
            system.laser.clear_fault()
            result = system.laser.status()
        elif args.cmd == "read":
            regs = {"tec": system.tec_regs, "laser": system.laser_regs, "ada": system.ada_regs}[args.block]
            value = regs.read32(args.offset)
            result = {
                "block": args.block,
                "offset": args.offset,
                "offset_hex": f"0x{args.offset:02X}",
                "value": value,
                "value_hex": f"0x{value:08X}",
            }
        elif args.cmd == "write":
            regs = {"tec": system.tec_regs, "laser": system.laser_regs, "ada": system.ada_regs}[args.block]
            regs.write32(args.offset, args.value)
            value = regs.read32(args.offset)
            result = {
                "block": args.block,
                "offset": args.offset,
                "offset_hex": f"0x{args.offset:02X}",
                "value": value,
                "value_hex": f"0x{value:08X}",
            }
        if args.json:
            print_json(result)
        else:
            print_json(result)
    finally:
        system.close()


if __name__ == "__main__":
    try:
        main()
    except BrokenPipeError:
        sys.exit(1)
