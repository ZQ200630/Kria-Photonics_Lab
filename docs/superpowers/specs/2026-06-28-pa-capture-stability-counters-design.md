# PA Capture Stability Counters Design

## Goal

Add observability and fault handling to the existing PA imaging acquisition path without changing the current DMA frame size, kernel superblock format, TCP stream format, or legacy `.bin` layout.

## Current Data Path

The current chain remains:

```text
frame_capture_axis_top
  -> AXI_ADA4355_DMA
  -> 32 rotating 4KB kernel DMA buffers
  -> 8 rotating 32MB kernel superblocks
  -> server TCP stream
  -> Tauri receiver legacy .bin
```

Each DMA completion is still one PA frame. A full 32MB kernel superblock contains 8160 legacy frame records because each record is `16B software frame header + 4096B frame payload = 4112B`.

## Scope

This change does not implement batched DMA. The DMA buffer pool remains the active design because it is already working and keeps the file contract simple.

The change adds:

- PL counters for accepted triggers, rejected triggers, AXIS backpressure, FIFO overflow, and busy-hold time.
- PL watchdog/fault latch so long AXIS/backpressure stalls become visible and stop accepting new capture triggers.
- Driver V2 status counters for DMA callback/worker health without changing the existing V1 ioctl.
- Server diagnostics and Tauri display for the new counters.

## PL Counters

Counters are exposed through unused registers in `axi_pam_image_acq`. The existing IP has 64 32-bit registers and currently uses only offsets `0x00` through `0x38`.

The new register bank starts at `0x80`:

| Offset | Name | Meaning |
| --- | --- | --- |
| `0x80` | `status` | bit 0 `fault`, bit 1 `capture_busy`, bit 2 `axis_stalled`, bit 3 `fifo_overflow_seen`, bit 4 `timeout_seen` |
| `0x84` | `fault_code` | 0 none, 1 busy timeout, 2 AXIS stall timeout, 3 FIFO overflow |
| `0x88` | `control` | write bit 0 to clear counters/fault |
| `0x8C` | `accepted_trigger_count` | triggers accepted by `frame_capture_axis_top` |
| `0x90` | `rejected_trigger_busy_count` | trigger arrived while capture path busy |
| `0x94` | `busy_hold_events` | PA controller had to wait for `overall_busy_pl` |
| `0x98` | `busy_hold_cycles` | total cycles spent waiting for `overall_busy_pl` |
| `0x9C` | `busy_hold_max_cycles` | longest continuous `overall_busy_pl` wait |
| `0xA0` | `axis_tready_low_cycles` | total cycles with `m_axis_tvalid && !m_axis_tready` |
| `0xA4` | `axis_stall_events` | number of contiguous AXIS stalls |
| `0xA8` | `axis_stall_max_cycles` | longest contiguous AXIS stall |
| `0xAC` | `fifo_overflow_count` | ADC/FIFO overflow events |
| `0xB0` | `capture_done_count` | ADC capture done pulses returned to PL |
| `0xB4` | `tx_done_count` | AXIS packetizer done pulses |

Watchdog thresholds are programmable later if needed. For the first implementation, use a 5 second default in the 100 MHz PL domain: `500_000_000` cycles.

## Driver Counters

The existing `AXIS_CAP_IOC_GET_STATUS` struct stays unchanged. Add a new `AXIS_CAP_IOC_GET_STATUS_V2` ioctl with all V1 fields plus:

- `submit_count`
- `callback_count`
- `rearm_count`
- `done_q_high_watermark`
- `ready_block_high_watermark`
- `free_block_low_watermark`
- `active_dma_low_watermark`
- `active_dma_zero_events`
- `done_q_overflow_count`
- `aggregate_fail_count`
- `rearm_fail_count`
- `abort_count`
- `copy_to_user_fault_count`

The Python server tries V2 first and falls back to V1 if the running kernel module does not support V2.

## Server And Tauri

The server clears PL counters at PA capture start, polls them during diagnostics, and includes them in `/api/pa/status` and `/api/pa/diagnostics` as `pa.pl_counters`.

Tauri shows a compact PA diagnostics section. Fault/nonzero risk counters are visually emphasized, but normal zero counters stay quiet.

## Error Handling

When PL fault is observed:

1. Server stops PA capture.
2. Server stops `/dev/axis_capture0`.
3. Server reports the fault code and counters.
4. User can clear fault/counters from a diagnostics action or by starting a new capture.

## Verification

Verification uses unit tests for:

- Python V2 ioctl fallback.
- PL counter register mapping.
- Server diagnostics payload shape.
- Tauri type/layout rendering of nonzero counters.

Hardware verification uses:

- A normal 10x10x1 capture should show expected frame count and zero fault counters.
- A long 640000-frame capture should show no frame/global-shot gaps.
- An induced AXIS stall should increment AXIS stall counters and eventually latch fault.
