# ADA4355 Extended Raw ADC Buffer Design

Date: 2026-06-25

## Goal

Increase ADA4355 raw ADC capture from the current 16K-sample BRAM-backed path to a dedicated 512K-sample raw buffer. The raw buffer must not share `spectrum0/buf0`, and raw capture filtering must have an LP shift that is independent from the spectrum/live PD monitor LP shift.

The design targets the current K26 part, `xck26-sfvc784-2LVI-i`, which has 64 UltraRAM blocks and 144 BRAM blocks. A 512K x 16-bit raw buffer needs about 8 Mbit, so it fits in URAM but not in the available BRAM.

## Milestone Before Changes

A pre-change milestone was created before implementation:

`/home/qian/Portable_System_Project/milestones/butterfly_pre_raw_uram_20260625_112841`

It contains the current software workspace, current Vivado IP workspace, current hardware `.srcs`, project files, git metadata, diffs, manifests, and checksums. Generated dependency/build folders such as `node_modules`, Rust `target`, `dist`, caches, and xsim outputs are excluded.

## Recommended Architecture

Use a dedicated raw buffer path:

1. The ADC clock domain samples the selected raw value after raw-specific LPF selection.
2. The ADC clock domain packs two 16-bit samples into one 32-bit word.
3. A small `xpm_fifo_async` crosses packed 32-bit words from `adc_clk` at 125 MHz into the raw buffer clock domain at 100 MHz.
4. The raw buffer clock domain writes those 32-bit words into a dedicated `xpm_memory_sdpram` UltraRAM buffer.
5. A new AXI BRAM Controller-style read port exposes the raw buffer to the PS/server.

This avoids using XPM FIFO width-conversion ordering as part of the ABI. The packing order is explicit in RTL:

```text
raw_word[15:0]  = earlier sample
raw_word[31:16] = later sample
```

For odd sample counts, the ADC domain pads the last upper 16 bits with zero. `RAW_WRITE_COUNT` still reports real samples, not padded samples.

## Hardware Interface

The existing `buf0_*` and `buf1_*` ports remain the spectrum buffers with 16K 32-bit words each. Raw capture gets a new port group:

```text
raw_buf_clk
raw_buf_rst
raw_buf_en
raw_buf_we
raw_buf_addr
raw_buf_wrdata
raw_buf_rddata
```

The raw buffer is read-only from software in normal use; writes from the AXI side are ignored or left unsupported. The internal writer is the raw buffer clock domain logic fed by the async FIFO.

Raw capacity:

```text
RAW_MAX_SAMPLES = 524288
RAW_WORDS       = 262144
AXI span        = 0x100000 bytes
```

The default proposed PS physical base for the new raw buffer window is:

```text
ADA raw buffer base = 0xA0200000
ADA raw buffer span = 0x00100000
```

This is separate from the current ADA register block and spectrum BRAM windows.

## XPM Memory Plan

The raw buffer uses `xpm_memory_sdpram` with UltraRAM:

```text
MEMORY_PRIMITIVE = "ultra"
CLOCKING_MODE    = "common_clock"
MEMORY_SIZE      = 262144 * 32
WRITE_DATA_WIDTH_A = 32
READ_DATA_WIDTH_B  = 32
READ_LATENCY_B      = 1
WRITE_MODE_B        = "read_first"
```

UltraRAM requires common clock operation, so both the raw buffer write side and raw buffer AXI read side run on `raw_buf_clk`. The ADC-to-raw-buffer crossing is handled by the async FIFO before the URAM writer.

## Raw Capture Control

`RAW_LENGTH` remains in sample units and accepts values from 1 to 524288. A write of 0 clamps to the maximum. `RAW_DECIM` remains in sample-domain decimation units and clamps 0 to 1.

`RAW_WRITE_COUNT` remains in real sample units. Software reads this count, calculates:

```text
word_count = ceil(RAW_WRITE_COUNT / 2)
```

and then unpacks each 32-bit word into two 16-bit samples.

Raw capture no longer writes `spectrum0/buf0` and no longer blocks spectrum buffer writes just to avoid BRAM write conflicts. Spectrum capture and raw capture can share the ADC/filter datapath, but their storage paths are separate.

## LPF Decoupling

The existing `LP_SHIFT` register continues to control the spectrum/live PD monitor first-order IIR filter. A new raw-specific LPF path is added with its own shift:

```text
RAW_LP_SHIFT
RAW_FILTERED_ADC_LAST
```

`FILTER_CONTROL` bit meanings stay compatible:

```text
bit 0: filter enable
bit 1: glitch reject enable
bit 2: raw uses filtered value
bit 3: spectrum uses filtered value
bit 4: monitor uses filtered value
```

When bit 2 is set, raw capture uses the raw LPF output controlled by `RAW_LP_SHIFT`. When bits 3 or 4 are set, spectrum/monitor use the existing LPF output controlled by `LP_SHIFT`.

The glitch reject threshold remains shared for this change.

## Register Map Changes

The existing ADA4355 capture register map is preserved. New registers are appended after the current map:

```text
0x9C RAW_LP_SHIFT          RW, default 13
0xA0 RAW_FILTERED_ADC_LAST RO
0xA4 RAW_CAPACITY_SAMPLES  RO, 524288
0xA8 RAW_BUFFER_WORDS      RO, 262144
```

`VERSION` is bumped from `0x00010006` to `0x00010007`.

`RAW_STATUS` keeps the existing idle/busy/done behavior and adds an overflow/error indication if the async FIFO cannot accept a packed word. On overflow, capture stops, the writer drains valid FIFO contents, and `RAW_WRITE_COUNT` reports the number of real samples stored.

## Server Changes

The Python hardware layer adds a dedicated raw buffer mmap:

```text
DEFAULT_ADA_RAW_BASE = 0xA0200000
DEFAULT_RAW_BUFFER_SPAN = 0x00100000
ADA_RAW_MAX_POINTS = 524288
```

`Ada4355Capture` receives `raw_buf_regs` separately from `buf0_regs` and `buf1_regs`.

`capture_raw(length, decim)` clamps length to 1..524288. `read_raw(count)` reads `ceil(count / 2)` 32-bit words from the raw buffer and unpacks little-endian sample order:

```python
samples.append(word & 0xFFFF)
samples.append((word >> 16) & 0xFFFF)
```

The API continues to return a flat sample array so Tauri and CSV code see one ADC sample per item. Response metadata includes the storage format, for example `packed_u16_le`.

The filter API accepts both:

```text
lp_shift      -> spectrum/live PD monitor LPF
raw_lp_shift  -> raw capture LPF
```

Status/settings expose both fields.

## Tauri Changes

The ADA4355 panel separates:

```text
Spectrum/Monitor LP Shift
Raw LP Shift
Raw Length
Raw Decimation
Raw Uses Filtered
Spectrum Uses Filtered
Monitor Uses Filtered
```

Raw length accepts up to `524288`. The previous coupling where raw length was also used as spectrum `max_points` is removed. Spectrum capture remains capped by the 16K spectrum buffers unless that path is explicitly redesigned later.

For large raw captures, the API keeps the full sample list for save/export. The UI plot should avoid rendering all 512K points directly on every state update; it should decimate for display while preserving full data for CSV/export.

## Error Handling

Hardware:
- Clamp invalid raw length/decimation.
- Report FIFO overflow in `RAW_STATUS`.
- Report actual stored sample count through `RAW_WRITE_COUNT`.

Server:
- Reject or clamp raw length above 524288.
- Decode packed raw buffer words into samples.
- Surface raw overflow and short captures in response metadata.
- Keep spectrum read paths unchanged.

Tauri:
- Enforce raw length input range in UI.
- Display capture errors returned by the server.
- Treat full raw data as export data and downsample only the rendered preview.

## Verification

HDL verification:
- Compile ADA4355 capture RTL with Vivado `xvlog`.
- Update the ADA4355 compile testbench to instantiate `raw_buf_*`.
- Test raw capture of even and odd lengths.
- Test packed word order.
- Test that raw capture no longer changes `buf0/spectrum0`.
- Test `RAW_LP_SHIFT` does not change spectrum/monitor LPF shift.
- Test `RAW_CAPACITY_SAMPLES` and `RAW_BUFFER_WORDS`.

Python verification:
- Unit-test raw capture length clamp up to 524288.
- Unit-test packed u16 unpacking, including odd sample counts.
- Unit-test `raw_lp_shift` status and filter API behavior.
- Compile Python files with `py_compile`.

Tauri verification:
- Unit-test raw length upper bound of 524288.
- Unit-test separate spectrum/monitor and raw LP shift controls.
- Run `npm test`.
- Run `npm run build`.

Integration verification:
- Start the Tauri dev app after implementation.
- Confirm `/api/status` reports raw capacity and separate LP shifts.
- Confirm a raw capture request can ask for 524288 samples and returns sample-count metadata consistently.

## Out Of Scope

- Expanding spectrum buffers beyond 16K.
- Moving raw capture to DDR/AXI DMA.
- Adding a separate raw glitch threshold.
- Changing the live PD monitor SSE sample format.
