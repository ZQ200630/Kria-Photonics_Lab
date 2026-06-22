# Butterfly Laser Driver Manual

This directory contains the board-side control documentation and software for
the Butterfly Laser Driver system.

The system has three FPGA/PL control blocks:

```text
TEC temperature loop:
  AD4170-4 ADC/DAC <-> PL SPI controller/PID <-> TEC driver enable/control

Laser current path:
  AXI laser current controller <-> AD3552R DAC driver <-> coarse/fine current source

Photodiode / spectrum path:
  ADA4355 ADC stream <-> PL monitor/frame capture <-> spectrum buffer readout
```

The PS/Linux side should normally configure and monitor registers only. The
time-critical AD4170 sampling, TEC DAC updates, and PID loop run in PL.

## Fixed AXI Base Addresses

These addresses are fixed by the Vivado address map.

```text
AD4170 TEC controller base:       0xA0000000
ADA4355 capture controller base:  0xA0100000
Laser current controller base:    0xA0120000
ADA4355 spectrum buffer 0:        0xA01C0000
ADA4355 spectrum buffer 1:        0xA01D0000
```

All register offsets in this document are byte offsets from the corresponding
base address. All registers are 32-bit little-endian AXI4-Lite registers.

## Safety Order

Use this order for normal operation:

1. Load PL.
2. Initialize and start the TEC controller.
3. Confirm TEC status is healthy and temperature is valid.
4. Start the TEC closed loop and let it reach the desired temperature.
5. Enable laser current output in static or scan mode.
6. Stop laser current before stopping TEC.

Emergency order:

```text
1. Laser emergency stop.
2. TEC stop or safe DAC.
3. Inspect fault/status registers.
```

FPGA safety logic does not replace analog current limiting, hardware shutdown,
or laser safety procedures.

## Temperature / TEC Controller

### Hardware Meaning

The AD4170-4 performs:

- ADC ch0 temperature measurement from TH10K NTC divider.
- DAC output to the TEC driver control input.
- PL-side periodic control at approximately 100 Hz.
- Active-high `tec_enable_o` output to the external TEC driver enable pin.

NTC divider wiring:

```text
2.5 V reference -> TH10K NTC -> AIN2/AIN3 sense node -> 10 kOhm reference -> GND
```

ADC ch0 is `AIN2 - AIN3`. Higher AD4170 raw code means higher NTC resistance,
which means lower temperature for this NTC divider.

Validated control direction:

```text
AD4170 DAC code < 0x800  -> TEC cooling direction
AD4170 DAC code > 0x800  -> TEC heating direction
AD4170 DAC code = 0x800  -> approximate zero/mid control point
```

### TEC Register Map

Base address:

```text
TEC_BASE = 0xA0000000
```

| Offset | Register | Access | Meaning |
|---:|---|---|---|
| `0x00` | `CONTROL` | RW/W1P | Main control bits |
| `0x04` | `STATUS` | RO | Decoded controller status bits |
| `0x08` | `CURRENT_STATE` | RO | Internal FSM state |
| `0x0C` | `MAIN_ERROR_STATUS` | RO | Latched error bitfield |
| `0x10` | `LAST_STATUS` | RO | Last AD4170 STATUS register |
| `0x14` | `SAMPLE_COUNTER` | RO | ADC valid sample counter |
| `0x18` | `DAC_UPDATE_COUNTER` | RO | DAC update counter |
| `0x1C` | `LAST_READY_LATENCY_CYCLES` | RO | Last RDY wait latency |
| `0x20` | `ADC_RAW_CH0` | RO | NTC ADC raw code |
| `0x24` | `ADC_RAW_CH1` | RO | Optional monitor channel |
| `0x28` | `ADC_RAW_CH2` | RO | Optional monitor channel |
| `0x2C` | `ADC_RAW_CH3` | RO | Optional monitor channel |
| `0x30` | `MONITOR_COUNTER` | RO | Reserved monitor counter |
| `0x40` | `TEMPERATURE_MEASURED_MILLIC` | RO | Last measured temperature, signed mdegC |
| `0x44` | `TEMPERATURE_FILTERED_MILLIC` | RO | Filtered temperature, signed mdegC |
| `0x48` | `ERROR_MILLIC` | RO | `target - filtered`, signed mdegC |
| `0x4C` | `TARGET_TEMPERATURE_MILLIC` | RW | Target temperature, mdegC, clamped 10..40 C |
| `0x50` | `TEMPERATURE_MIN_LIMIT` | RW | Safety lower limit, mdegC |
| `0x54` | `TEMPERATURE_MAX_LIMIT` | RW | Safety upper limit, mdegC |
| `0x58` | `TEMP_FILTER_ALPHA` | RW | IIR alpha, Q0.16; `65535` nearly unfiltered |
| `0x5C` | `NTC_R_FIXED_OHM` | RW | Legacy/debug register; TH10K LUT is fixed |
| `0x60` | `NTC_R25_OHM` | RW | Legacy/debug register; TH10K LUT is fixed |
| `0x70` | `MANUAL_DAC_CODE` | RW | Open-loop AD4170 DAC code, 0..4095 |
| `0x74` | `ACTIVE_DAC_CODE` | RO | Last DAC code written by PL |
| `0x78` | `DAC_BIAS_CODE` | RW | PID bias code |
| `0x7C` | `DAC_MIN_CODE` | RW | PID lower clamp |
| `0x80` | `DAC_MAX_CODE` | RW | PID upper clamp |
| `0x84` | `DAC_SAFE_CODE` | RW | Safe DAC code on fault/stop |
| `0x90` | `PID_KP` | RW | Signed Q12.20 proportional gain |
| `0x94` | `PID_KI` | RW | Signed Q2.30 integral gain |
| `0x98` | `PID_KD` | RW | Signed Q12.20 derivative gain |
| `0x9C` | `PID_INTEGRAL_LIMIT` | RW | Integral accumulator limit, mdegC-samples |
| `0xA0` | `PID_MAX_STEP` | RW | Max DAC code movement per 100 Hz update |
| `0xA4` | `PID_ERROR_MILLIC` | RO | PID sampled error |
| `0xA8` | `PID_P_TERM` | RO | Signed P term, DAC codes |
| `0xAC` | `PID_I_TERM` | RO | Signed I term, DAC codes |
| `0xB0` | `PID_D_TERM` | RO | Signed D term, DAC codes |
| `0xB4` | `PID_INTEGRAL` | RO | Signed integral accumulator |
| `0xB8` | `PID_OUTPUT_CODE` | RO | PID output DAC code |
| `0xC0` | `SPI_CLK_DIV` | RW | SPI clock divider |
| `0xC4` | `RDY_TIMEOUT_CYCLES` | RW | AD4170 RDY timeout |
| `0xC8` | `MONITOR_INTERVAL_CYCLES` | RW | Reserved monitor interval |
| `0xCC` | `VERSION` | RO | Current expected value: `0x00030000` |

### TEC CONTROL Register

| Bit | Name | Type | Meaning |
|---:|---|---|---|
| 0 | `init_start` | W1P | Start AD4170 initialization |
| 1 | `run` | RW | Run periodic ADC/DAC loop |
| 2 | `mode_closed_loop` | RW | `0` open-loop, `1` PID closed-loop |
| 3 | `pid_enable` | RW | Enable PID calculation |
| 4 | `tec_enable_request` | RW | Request external TEC enable |
| 5 | `tec_enable_override` | RW | Allow TEC enable in open-loop |
| 6 | `monitor_request` | W1P | Reserved in current RTL |
| 7 | `fault_clear` | W1P | Clear allowed temperature fault |
| 8 | `soft_reset` | W1P | Reset controller registers/FSM |

Useful values:

```text
0x00000001  init only
0x00000002  run open-loop, TEC disabled
0x00000032  run open-loop with TEC enable request and override
0x0000003E  run closed-loop PID with TEC enable request and override
0x00000100  soft reset pulse
```

### TEC STATUS Register

| Bit | Name |
|---:|---|
| 0 | `init_done` |
| 1 | `id_check_pass` |
| 2 | `run` |
| 3 | `mode_closed_loop` |
| 4 | `adc_sample_valid` |
| 5 | `temperature_valid` |
| 6 | `tec_enabled` |
| 7 | `fault_latched` |
| 8 | `spi_busy` |
| 9 | `spi_error` |
| 10 | `rdy_timeout_error` |
| 11 | `por_flag_seen` |
| 12 | `temperature_range_error` |

Healthy closed loop usually reads near:

```text
STATUS = 0x0000097F
MAIN_ERROR_STATUS = 0x00000000
```

### TEC MAIN_ERROR_STATUS

| Bit | Meaning |
|---:|---|
| 0 | AD4170 ID check failed |
| 1 | SPI error |
| 2 | AD4170 RDY timeout |
| 3 | Temperature/conversion range fault |

### TEC Units And Conversions

Temperature registers are signed integer millidegrees Celsius:

```text
31000 -> 31.000 degC
0x00007918 -> 31000 -> 31.000 degC
```

Signed negative values are two's-complement. Example:

```text
ERROR_MILLIC = 0xFFFFFFCC = -52 mdegC = -0.052 degC
```

PID gain formats:

```text
KP and KD: signed Q12.20
  float_value = register / 1048576
  register = round(float_value * 1048576)

KI: signed Q2.30
  float_value = register / 1073741824
  register = round(float_value * 1073741824)
```

Validated TEC reset defaults:

```text
TARGET_TEMPERATURE_MILLIC = 31000       # 31.000 degC
TEMPERATURE_MIN_LIMIT     = 20000       # 20.000 degC
TEMPERATURE_MAX_LIMIT     = 40000       # 40.000 degC
DAC_BIAS_CODE             = 0x0800
DAC_MIN_CODE              = 0x0740
DAC_MAX_CODE              = 0x08C0
DAC_SAFE_CODE             = 0x0800
PID_KP                    = 0x0000CCCD
PID_KI                    = 0x00041893
PID_KD                    = 0x00000000
PID_INTEGRAL_LIMIT        = 500000
PID_MAX_STEP              = 10
```

### TEC Bring-Up With devmem

Load PL first:

```sh
fpgautil -o pl.dtbo
```

Check IP version:

```sh
devmem 0xA00000CC 32
```

Expected:

```text
0x00030000
```

Start TEC closed loop with reset defaults:

```sh
devmem 0xA0000000 32 0x00000100
sleep 1
devmem 0xA0000000 32 0x00000001
sleep 1
devmem 0xA0000000 32 0x0000003E
sleep 5
devmem 0xA0000004 32
devmem 0xA000000C 32
devmem 0xA0000044 32
devmem 0xA0000048 32
devmem 0xA0000074 32
```

Set a new target, for example 31.5 C:

```sh
devmem 0xA000004C 32 0x00007B0C
```

Stop TEC loop and return to safe DAC path:

```sh
devmem 0xA0000000 32 0x00000000
devmem 0xA0000070 32 0x00000800
```

## Laser Current Controller

### Hardware Meaning

The laser current controller generates two internal 16-bit physical setpoints:

```text
CH0: coarse laser-current tuning
CH1: fine laser-current tuning
```

These internal codes are not the raw DAC bus codes. Internal code `0` means
intended physical 0 V / zero current. The HDL converts the internal code for
the downstream DAC path by flipping the MSB:

```text
raw_dac_code = internal_code ^ 0x8000
```

Examples:

```text
internal 0x0000 -> raw 0x8000 -> intended 0 V / zero current
internal 0x8000 -> raw 0x0000 -> midscale physical output
internal 0xFFFF -> raw 0x7FFF -> near full-scale physical output
```

### Laser Current Register Map

Base address:

```text
LASER_BASE = 0xA0120000
```

| Offset | Register | Access | Meaning |
|---:|---|---|---|
| `0x00` | `CTRL` | RW/W1P | Main control |
| `0x04` | `STATUS` | RO | Main decoded status |
| `0x08` | `FAULT_STATUS` | RO | Latched fault bitfield |
| `0x0C` | `ACTUAL_DAC_CODES` | RO | `{actual_ch1, actual_ch0}` internal codes |
| `0x10` | `CH0_STATIC_CODE` | RW | Static coarse code |
| `0x14` | `CH1_STATIC_CODE` | RW | Static fine code |
| `0x18` | `CH0_START_CODE` | RW | Nested scan CH0 start |
| `0x1C` | `CH0_STOP_CODE` | RW | Nested scan CH0 stop |
| `0x20` | `CH0_STEP_CODE` | RW | Nested scan CH0 step |
| `0x24` | `CH0_DWELL_FRAMES` | RW | CH1 frames per CH0 step; 0 becomes 1 |
| `0x28` | `CH1_START_CODE` | RW | Fine scan CH1 start |
| `0x2C` | `CH1_STOP_CODE` | RW | Fine scan CH1 stop |
| `0x30` | `CH1_STEP_CODE` | RW | Fine scan CH1 step; 0 becomes 1 |
| `0x34` | `CH1_DWELL_TICKS` | RW | Hold time per fine point |
| `0x38` | `FRAME_COUNT` | RW | Number of frames |
| `0x3C` | `DAC_SETTLE_TICKS` | RW | Wait after target reached before point strobe |
| `0x40` | `CH0_LIMIT` | RW | `{max, min}`; min=max=0 disables clamp |
| `0x44` | `CH1_LIMIT` | RW | `{max, min}`; min=max=0 disables clamp |
| `0x48` | `RAMP_CONFIG` | RW | `{ch1_soft_step, ch0_soft_step}`; 0 means immediate |
| `0x4C` | `RAMP_INTERVAL_TICKS` | RW | Clock ticks between ramp updates |
| `0x50` | `DAC_TIMEOUT_TICKS` | RW | DAC-ready timeout; 0 disables |
| `0x54` | `WATCHDOG_TIMEOUT_TICKS` | RW | Watchdog timeout; 0 disables |
| `0x58` | Reserved | RW | Reserved |
| `0x5C` | `ENABLE_DELAY_TICKS` | RW | Delay before asserting `laser_enable` |
| `0x60` | `CURRENT_LIMIT_CODE` | RW | Combined current estimate limit; 0 disables |
| `0x64` | `CH0_GAIN_COEFF` | RW | Coarse current estimate coefficient |
| `0x68` | `CH1_GAIN_COEFF` | RW | Fine current estimate coefficient |
| `0x6C` | `CURRENT_OFFSET` | RW | Current estimate offset |
| `0x70` | `LOCK_TARGET` | RW | `{polarity_invert, target_adc}` |
| `0x74` | `LOCK_BIAS_CH1_CODE` | RW | CH1 bias/center code for side-fringe lock |
| `0x78` | `LOCK_CH1_RANGE` | RW | `{lock_ch1_max, lock_ch1_min}` |
| `0x7C` | `LOCK_KP` | RW | Signed Q16.16 proportional gain |
| `0x80` | `TARGET_DAC_CODES` | RO | `{target_ch1, target_ch0}` internal codes |
| `0x84` | `SCAN_INDEX` | RO | `{slow_index, fast_index}` |
| `0x88` | `FRAME_INDEX` | RO | Current frame index |
| `0x8C` | `LAST_FB_ADC` | RO | Last feedback ADC value |
| `0x90` | `CURRENT_ESTIMATE` | RO | Estimated current code |
| `0x94` | `LOCK_KI` | RW | Signed Q16.16 integral gain |
| `0x98` | `LOCK_INTEGRAL_LIMIT` | RW | Integral clamp |
| `0x9C` | `LOCK_MAX_STEP` | RW | Max CH1 code step per feedback sample |
| `0xA0` | `LOCK_THRESHOLDS` | RW | `{loss_threshold, locked_threshold}` ADC codes |
| `0xA4` | `LOCK_COUNTS` | RW | `{loss_count, locked_count}` feedback samples |
| `0xA8` | `LOCK_SAT_LIMIT_COUNT` | RW | Consecutive saturation samples before lost |
| `0xAC` | `LOCK_FB_TIMEOUT_TICKS` | RW | Feedback timeout; 0 disables |
| `0xB0` | `LOCK_ADC_VALID_RANGE` | RW | `{adc_max_valid, adc_min_valid}`; 0/0 disables |
| `0xB4` | `LOCK_STATUS` | RO | Lock state flags |
| `0xB8` | `LOCK_ERROR` | RO | Signed ADC-code error |
| `0xBC` | `LOCK_INTEGRAL` | RO | Signed integral accumulator |
| `0xC0` | `LOCK_OUTPUT_CH1_CODE` | RO | Current lock CH1 output code |
| `0xC4` | `LOCK_COUNTERS` | RO | `{loss_counter, locked_counter}` |

### Laser CTRL Register

| Bit | Name | Type | Meaning |
|---:|---|---|---|
| 0 | `enable` | stored | Main enable |
| 1 | `start` | W1P | Start selected mode |
| 2 | `stop` | W1P | Request soft stop |
| 3 | `continuous` | stored | Repeat scans continuously |
| 6:4 | `mode` | stored | Operation mode |
| 8 | `laser_arm` | stored | Software laser arm |
| 9 | `fault_clear` | W1P | Clear fault if external faults are inactive |
| 10 | `watchdog_kick` | W1P | Reset watchdog counter |
| 11 | `emergency_stop` | W1P | Immediate emergency stop |

Modes:

| Mode | Name | Meaning |
|---:|---|---|
| 0 | `IDLE` | Safe output |
| 1 | `STATIC` | Hold CH0/CH1 static codes |
| 2 | `FINE_SCAN` | Hold CH0, scan CH1 |
| 3 | `NESTED_SCAN` | Slow CH0 scan, fast CH1 scan |
| 4 | `LOCK` | Side-fringe PI lock. CH0 is fixed; CH1 is feedback actuator. |

Useful CTRL values:

```text
0x00000200  fault_clear pulse
0x00000800  emergency_stop pulse
0x00000113  enable + start + mode static + laser_arm
0x00000123  enable + start + mode fine_scan + laser_arm
0x00000143  enable + start + mode lock + laser_arm
0x00000127  enable + stop + mode fine_scan + laser_arm
```

### Laser STATUS Register

| Bit | Name |
|---:|---|
| 0 | `busy` |
| 1 | `done_latched` |
| 2 | `laser_enable` |
| 3 | `frame_active` |
| 4 | `point_strobe` |
| 5 | `fault_latched` |
| 6 | `lock_active` |
| 7 | `scan_active` |
| 8 | `ramping` |
| 9 | `dac_waiting` |
| 10 | `output_at_target` |
| 11 | `error` |

### Laser LOCK_STATUS Register

| Bit | Name |
|---:|---|
| 0 | `lock_active` |
| 1 | `control_enabled` |
| 2 | `locked` |
| 3 | `saturated` |
| 4 | `lock_lost` |
| 5 | `fb_timeout` |
| 6 | `adc_invalid` |
| 7 | `hold` |
| 8 | `acquiring` |

When `lock_lost` is set, PI updates stop and CH1 holds the last lock output code. This is not treated as a fatal laser fault; hard faults such as TEC unlock, emergency stop, external fault, DAC timeout, or global current-limit violation still use `FAULT_STATUS`.

For PL feedback wiring, connect the ADA4355 capture IP monitor output to the laser current IP:

```text
axi_ada4355_capture.monitor_adc_code    -> axi_laser_current_ctrl.fb_adc_data
axi_ada4355_capture.monitor_valid_pulse -> axi_laser_current_ctrl.fb_adc_valid
```

Both IPs should use the same `s00_axi_aclk` for this direct connection. `monitor_adc_code` is the low-speed monitor ADC code, updated with `monitor_valid_pulse`; it is not the 125 MHz raw stream.

### Laser FAULT_STATUS

| Bit | Fault |
|---:|---|
| 0 | TEC unlocked at start |
| 1 | External fault input active |
| 2 | Emergency stop |
| 3 | CH0 limit violation |
| 4 | CH1 limit violation |
| 5 | Combined current limit violation |
| 6 | DAC timeout |
| 7 | Watchdog timeout |
| 8 | Illegal mode |
| 9 | TEC lock lost during run |

### Laser Current Estimate

The RTL current estimate is:

```text
estimated_current = CURRENT_OFFSET
                  + CH0_GAIN_COEFF * CH0_internal_code
                  + CH1_GAIN_COEFF * CH1_internal_code
```

If `CURRENT_LIMIT_CODE = 0`, the combined-current limit is disabled. If it is
nonzero, exceeding the limit latches a fault.

The exact conversion from code to mA depends on the analog current-source
gain. Once measured, define:

```text
current_mA = offset_mA + ch0_code * ch0_mA_per_code + ch1_code * ch1_mA_per_code
```

Do not assume the FPGA code itself is mA unless the analog gain has been
calibrated.

### Laser Bring-Up With devmem

Clear any fault:

```sh
devmem 0xA0120000 32 0x00000200
```

Set conservative output limits:

```sh
# CH0 max=40000, min=0
devmem 0xA0120040 32 0x9C400000

# CH1 max=50000, min=0
devmem 0xA0120044 32 0xC3500000
```

Set ramp behavior:

```sh
# ch1_soft_step=8, ch0_soft_step=8
devmem 0xA0120048 32 0x00080008

# ramp interval ticks
devmem 0xA012004C 32 1000

# DAC timeout
devmem 0xA0120050 32 1000000
```

Static output:

```sh
devmem 0xA0120010 32 5000
devmem 0xA0120014 32 0
devmem 0xA0120000 32 0x00000113
sleep 1
devmem 0xA0120004 32
devmem 0xA0120008 32
devmem 0xA012000C 32
```

Fine scan:

```sh
devmem 0xA0120010 32 26000
devmem 0xA0120028 32 20000
devmem 0xA012002C 32 30000
devmem 0xA0120030 32 10
devmem 0xA0120034 32 100
devmem 0xA0120038 32 1
devmem 0xA012003C 32 100
devmem 0xA0120000 32 0x00000123
```

Soft stop:

```sh
devmem 0xA0120000 32 0x00000105
```

Emergency stop:

```sh
devmem 0xA0120000 32 0x00000800
```

## Python Control

Run all commands on the board as root or with permission to access `/dev/mem`.

```sh
cd /home/qian/Portable_System_Project/Butterfly_Laser_Driver
sudo python3 butterfly_laser_control.py status
```

Start TEC closed loop using reset defaults:

```sh
sudo python3 butterfly_laser_control.py tec-start
```

Set TEC target:

```sh
sudo python3 butterfly_laser_control.py tec-target --celsius 31.5
```

Start laser static output:

```sh
sudo python3 butterfly_laser_control.py laser-static --ch0 5000 --ch1 0
```

Start a fine scan:

```sh
sudo python3 butterfly_laser_control.py laser-fine-scan \
  --ch0 26000 --start 20000 --stop 30000 --step 10 \
  --dwell 100 --settle 100 --frames 1
```

Start side-fringe lock after choosing a point from the spectrum:

```sh
sudo python3 butterfly_laser_control.py laser-lock \
  --ch0 24000 \
  --target-adc 42000 \
  --bias-ch1 20000 \
  --lock-ch1-min 19000 \
  --lock-ch1-max 21000 \
  --kp 0.5 --ki 0.01 \
  --max-step 10 \
  --locked-threshold 20 \
  --loss-threshold 500
```

To leave lock mode without shutting off the laser output, hold the current codes:

```sh
sudo python3 butterfly_laser_control.py laser-lock-hold
```

Start ADA4355 monitor/capture and read the latest spectrum:

```sh
sudo python3 butterfly_laser_control.py ada-start
sudo python3 butterfly_laser_control.py ada-monitor-rate --hz 100000
sudo python3 butterfly_laser_control.py ada-capture-config --frame-decim 1000
sudo python3 butterfly_laser_control.py ada-filter \
  --filter --threshold 3000 --lp-shift 13 \
  --spectrum-filtered --monitor-filtered --raw-raw
sudo python3 butterfly_laser_control.py ada-read-spectrum --points 2000 --out spectrum.csv
```

Capture raw 125 MHz ADC samples for noise/debug analysis:

```sh
sudo python3 butterfly_laser_control.py ada-raw-capture \
  --length 16384 --decim 1 --out raw_adc.csv
```

At `decim=1`, `16384` samples cover about `131 us` with a 125 MHz ADC clock.
Increase `decim` to capture a longer time window.

If you want the raw snapshot plot to show the filtered ADC stream instead of
the original 125 MHz samples:

```sh
sudo python3 butterfly_laser_control.py ada-filter --raw-filtered
```

To return raw snapshot to true raw ADC data:

```sh
sudo python3 butterfly_laser_control.py ada-filter --raw-raw
```

The ADA4355 front-end transfer is inverted:

```text
ADC code decreases -> PD current increases -> optical signal increases
```

The software therefore exports both `avg_adc` and
`relative_intensity_code = 65535 - avg_adc` for quick plotting.

Stop everything:

```sh
sudo python3 butterfly_laser_control.py stop-all
```

Raw register access:

```sh
sudo python3 butterfly_laser_control.py read --block tec --offset 0x44
sudo python3 butterfly_laser_control.py write --block laser --offset 0x10 --value 5000
sudo python3 butterfly_laser_control.py read --block ada --offset 0x14
```

## HTTP Remote Control

Run on the board:

```sh
cd /home/qian/Portable_System_Project/Butterfly_Laser_Driver
sudo python3 butterfly_laser_server.py --host 0.0.0.0 --port 8080
```

The server stores persistent panel settings in:

```text
butterfly_laser_settings.json
```

You can override the settings file path:

```sh
sudo python3 butterfly_laser_server.py --settings /run/media/sdb1/PL/my_settings.json
```

Then from another machine:

```sh
curl http://BOARD_IP:8080/api/status
```

Start TEC:

```sh
curl -X POST http://BOARD_IP:8080/api/tec/start
```

Set TEC target:

```sh
curl -X POST http://BOARD_IP:8080/api/tec/target \
  -H 'Content-Type: application/json' \
  -d '{"celsius":31.5}'
```

Start laser static output:

```sh
curl -X POST http://BOARD_IP:8080/api/laser/static \
  -H 'Content-Type: application/json' \
  -d '{"ch0":5000,"ch1":0}'
```

Stop all:

```sh
curl -X POST http://BOARD_IP:8080/api/stop-all
```

Save current panel/settings JSON to the board:

```sh
curl -X POST http://BOARD_IP:8080/api/settings \
  -H 'Content-Type: application/json' \
  -d @butterfly_laser_settings.json
```

Load saved settings:

```sh
curl http://BOARD_IP:8080/api/settings
```

Apply saved target/PID/protection parameters to hardware:

```sh
curl -X POST http://BOARD_IP:8080/api/settings/apply
```

Applying saved settings does not start laser output.

The HTTP server is for a trusted lab network. It does not implement
authentication.

## Tauri Desktop Console

The new desktop console uses the same hardware control layer, but it should be
paired with the SSE-capable backend.

Start the Tauri/SSE backend on the K26 board:

```sh
python3 butterfly_laser_server_tauri.py --host 0.0.0.0 --port 8080
```

Open the desktop console and connect to:

```text
http://192.168.8.236:8080
```

The legacy browser GUI remains available through:

```sh
python3 butterfly_laser_server.py --host 0.0.0.0 --port 8080
```

The Tauri console project is in:

```text
tauri_control_console/
```

On this development machine, Node.js was installed under:

```text
/home/qian/.local/nodejs
```

Rust was installed under the standard user cargo directory:

```text
/home/qian/.cargo
```

Use this PATH before running frontend or Tauri commands:

```sh
export PATH=/home/qian/.local/nodejs/bin:/home/qian/.cargo/bin:$PATH
```

Build and test the frontend:

```sh
cd tauri_control_console
npm test
npm run build
```

For native Tauri packaging on Ubuntu 22.04, install the Linux GUI development
dependencies first:

```sh
sudo apt-get update
sudo apt-get install -y \
  build-essential pkg-config curl wget file libssl-dev \
  libgtk-3-dev libwebkit2gtk-4.1-dev libxdo-dev \
  libayatana-appindicator3-dev librsvg2-dev
```

If a PetaLinux environment is active, clear its pkg-config sysroot variables
before native desktop packaging:

```sh
env -u PKG_CONFIG_PATH -u PKG_CONFIG_SYSROOT_DIR npm run tauri build
```

## First-Time Checklist

Before enabling real laser current:

1. Confirm `TEC VERSION = 0x00030000`.
2. Confirm TEC temperature is close to an external thermometer.
3. Confirm `MAIN_ERROR_STATUS = 0`.
4. Confirm laser current hardware limit and external fault input are connected.
5. Start with low CH0/CH1 codes.
6. Watch `FAULT_STATUS`, `ACTUAL_DAC_CODES`, and physical current.
7. Keep emergency stop access available.
