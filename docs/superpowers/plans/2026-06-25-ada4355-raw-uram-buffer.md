# ADA4355 Raw URAM Buffer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dedicated 512K-sample packed raw ADC buffer to the ADA4355 capture IP and expose independent raw LP shift control through the Python server and Tauri GUI.

**Architecture:** Raw ADC samples are selected in the ADC domain, packed as two 16-bit samples per 32-bit word, crossed into a 100 MHz raw buffer domain through a small async FIFO, then written into an UltraRAM-backed `xpm_memory_sdpram`. Software maps this raw buffer separately from the existing spectrum BRAM windows and unpacks packed words before returning API/Tauri samples.

**Tech Stack:** Verilog/SystemVerilog, Vivado 2023.2 XPM (`xpm_fifo_async`, `xpm_memory_sdpram`), Python `/dev/mem` server, Tauri/React/TypeScript, Vitest, Python unittest.

---

## Pre-Execution Notes

The pre-change backup exists at:

```text
/home/qian/Portable_System_Project/milestones/butterfly_pre_raw_uram_20260625_112841
```

The repository currently has many synchronized but uncommitted software changes from the Windows-to-Linux sync. Before committing implementation work, either make the baseline commit in Task 0 or keep all implementation changes uncommitted. Do not use broad reset/checkout commands.

## File Structure

Software files:
- Modify: `butterfly_laser_control.py`
  - Add raw buffer constants, new ADA register offsets, raw packed-word unpacking, raw mmap wiring, raw LP shift support.
- Modify: `butterfly_laser_server.py`
  - Add defaults/settings for `raw_lp_shift`, add parser args for raw buffer base/span, pass raw buffer into `ButterflyLaserSystem`, accept `raw_lp_shift` in `/api/ada/filter`.
- Modify: `butterfly_laser_server_tauri.py`
  - Import raw buffer defaults and pass raw args into `ButterflyLaserSystem`.
- Create: `tests/test_ada4355_raw_buffer.py`
  - Unit-test packed raw reads, 512K clamp, raw LP shift, and parser defaults.
- Modify: `tests/test_panel_click_to_lock.py`
  - Add static RTL checks for new ADA register defaults and raw port names.
- Modify: `tests/test_tauri_server_defaults.py`
  - Assert shared defaults include `raw_lp_shift`.

Tauri files:
- Modify: `tauri_control_console/src/api/client.ts`
  - Default raw capture length to `524288`.
- Modify: `tauri_control_console/src/api/types.ts`
  - Add raw storage metadata fields and typed raw/filter status fields where useful.
- Modify: `tauri_control_console/src/components/AdaPanel.tsx`
  - Separate spectrum/monitor LP shift from raw LP shift and stop using raw length as spectrum `max_points`.
- Modify: `tauri_control_console/src/utils/settings.ts`
  - Persist `raw_lp_shift` from status/settings.
- Modify: `tauri_control_console/src/__tests__/adaPanelLayout.test.tsx`
  - Assert separate LP shift labels and 512K raw length.
- Modify: `tauri_control_console/src/__tests__/settings.test.ts`
  - Assert `raw_lp_shift` is captured and flattened.
- Modify: `tauri_control_console/src/__tests__/api.test.ts`
  - Assert `rawCapture()` default payload is `524288`.

Vivado IP files:
- Modify: `/home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/IPs/ip_repo/axi_ada4355_capture_1_0/hdl/axi_ada4355_capture_v1_0.v`
  - Add `RAW_ADDR_WIDTH` parameter and `raw_buf_*` top-level ports.
- Modify: `/home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/IPs/ip_repo/axi_ada4355_capture_1_0/hdl/axi_ada4355_capture_v1_0_S00_AXI.v`
  - Add new register offsets, raw LP shift register, raw capacity readbacks, version bump, and raw buffer port passthrough.
- Modify: `/home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/IPs/ip_repo/axi_ada4355_capture_1_0/hdl/ada4355_capture_core.v`
  - Add raw-specific LPF path, ADC-domain packer, async FIFO, raw-clock writer, and XPM UltraRAM buffer.
- Modify: `/home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/IPs/ip_repo/axi_ada4355_capture_1_0/tb_axi_ada4355_capture_compile.sv`
  - Instantiate new raw buffer ports and check packed raw order, odd length, capacity registers, and non-pollution of `buf0`.
- Modify: `/home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/IPs/ip_repo/axi_ada4355_capture_1_0/README_AXI_ADA4355_CAPTURE.md`
  - Document raw buffer storage and new registers.
- Modify: `/home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/IPs/ip_repo/axi_ada4355_capture_1_0/component.xml`
  - Refresh/add port metadata for `raw_buf_*` and `RAW_ADDR_WIDTH`.
- Modify: `/home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/IPs/ip_repo/axi_ada4355_capture_1_0/xgui/axi_ada4355_capture_v1_0.tcl`
  - Expose/propagate `RAW_ADDR_WIDTH`.
- Modify: `/home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/IPs/ip_repo/axi_ada4355_capture_1_0/bd/bd.tcl`
  - Keep IP packager BD helper in sync with new parameter/ports.

---

### Task 0: Baseline Guard

**Files:**
- Read: `/home/qian/Portable_System_Project/milestones/butterfly_pre_raw_uram_20260625_112841/README.md`
- Read: `docs/superpowers/specs/2026-06-25-ada4355-raw-uram-buffer-design.md`
- Read: `docs/superpowers/plans/2026-06-25-ada4355-raw-uram-buffer.md`

- [ ] **Step 1: Confirm backup and design exist**

Run:

```bash
test -f /home/qian/Portable_System_Project/milestones/butterfly_pre_raw_uram_20260625_112841/README.md
test -f docs/superpowers/specs/2026-06-25-ada4355-raw-uram-buffer-design.md
test -f docs/superpowers/plans/2026-06-25-ada4355-raw-uram-buffer.md
```

Expected: all commands exit 0.

- [ ] **Step 2: Record current dirty state**

Run:

```bash
git status --short --branch
git rev-parse HEAD
```

Expected: branch is `feature/live-marker-tracking`; HEAD includes the design spec commit `8beac77` or a later commit.

- [ ] **Step 3: Stop the Tauri dev app before editing frontend files**

Run:

```bash
pgrep -af "tauri dev|butterfly_laser_control_console|vite"
```

Expected: if the old dev app is still running, stop it with Ctrl-C in its active tool session. If there is no active session, terminate only the listed Tauri/Vite PIDs with `kill -TERM <pid...>`.

- [ ] **Step 4: Decide commit strategy**

If the execution owner wants task-level commits, create a baseline commit of the synchronized dirty tree before Task 1:

```bash
git add -A
git commit -m "Baseline synchronized Butterfly Laser Driver workspace"
```

Expected: commit succeeds and `git status --short --branch` becomes clean. If this baseline commit is not made, skip all later commit steps and keep the milestone backup as the rollback point.

---

### Task 1: Python Raw Buffer Tests

**Files:**
- Create: `tests/test_ada4355_raw_buffer.py`
- Modify: `tests/test_tauri_server_defaults.py`

- [ ] **Step 1: Add failing unit tests for raw buffer behavior**

Create `tests/test_ada4355_raw_buffer.py` with:

```python
import unittest

import butterfly_laser_control as control
import butterfly_laser_server as server
import butterfly_laser_server_tauri as tauri_server


class FakeRegs:
    def __init__(self, base=0xA0100000, words=None):
        self.base = base
        self.values = {}
        self.writes = []
        self.words = list(words or [])
        self.last_read_count = None
        self.closed = False

    def read32(self, offset):
        return self.values.get(offset, 0)

    def write32(self, offset, value):
        self.values[offset] = value & 0xFFFFFFFF
        self.writes.append((offset, value & 0xFFFFFFFF))

    def read_words(self, count):
        self.last_read_count = count
        return self.words[:count]

    def close(self):
        self.closed = True


class Ada4355RawBufferTests(unittest.TestCase):
    def make_capture(self, raw_words):
        regs = FakeRegs()
        regs.values[control.ADA_REG["RAW_STATUS"]] = 0x4
        regs.values[control.ADA_REG["RAW_WRITE_COUNT"]] = 5
        regs.values[control.ADA_REG["RAW_DECIM"]] = 2
        raw = FakeRegs(base=control.DEFAULT_ADA_RAW_BASE, words=raw_words)
        ada = control.Ada4355Capture(regs, FakeRegs(base=0xA01C0000), FakeRegs(base=0xA01D0000), raw)
        return ada, regs, raw

    def test_raw_constants_describe_packed_512k_buffer(self):
        self.assertEqual(control.DEFAULT_ADA_RAW_BASE, 0xA0200000)
        self.assertEqual(control.DEFAULT_RAW_BUFFER_SPAN, 0x00100000)
        self.assertEqual(control.ADA_RAW_MAX_POINTS, 524288)
        self.assertEqual(control.ADA_RAW_BUFFER_WORDS, 262144)
        self.assertEqual(control.ADA_REG["RAW_LP_SHIFT"], 0x9C)
        self.assertEqual(control.ADA_REG["RAW_FILTERED_ADC_LAST"], 0xA0)
        self.assertEqual(control.ADA_REG["RAW_CAPACITY_SAMPLES"], 0xA4)
        self.assertEqual(control.ADA_REG["RAW_BUFFER_WORDS"], 0xA8)

    def test_read_raw_unpacks_two_u16_samples_per_word(self):
        ada, _regs, raw = self.make_capture([0x22221111, 0x44443333, 0x00005555])

        result = ada.read_raw()

        self.assertEqual(raw.last_read_count, 3)
        self.assertEqual(result["count"], 5)
        self.assertEqual(result["samples"], [0x1111, 0x2222, 0x3333, 0x4444, 0x5555])
        self.assertEqual(result["storage"], "packed_u16_le")
        self.assertEqual(result["raw_write_count"], 5)
        self.assertEqual(result["decim"], 2)

    def test_capture_raw_accepts_512k_samples(self):
        ada, regs, _raw = self.make_capture([])
        regs.values[control.ADA_REG["RAW_WRITE_COUNT"]] = control.ADA_RAW_MAX_POINTS

        meta = ada.capture_raw(length=control.ADA_RAW_MAX_POINTS, decim=4, timeout=0)

        self.assertEqual(meta["length"], control.ADA_RAW_MAX_POINTS)
        self.assertEqual(meta["write_count"], control.ADA_RAW_MAX_POINTS)
        self.assertIn((control.ADA_REG["RAW_LENGTH"], control.ADA_RAW_MAX_POINTS), regs.writes)
        self.assertIn((control.ADA_REG["RAW_DECIM"], 4), regs.writes)

    def test_configure_filter_writes_raw_lp_shift_independently(self):
        ada, regs, _raw = self.make_capture([])
        regs.values[control.ADA_REG["FILTER_CONTROL"]] = control.ADA_FILTER_DEFAULT

        ada.configure_filter(lp_shift=7, raw_lp_shift=12)

        self.assertIn((control.ADA_REG["LP_SHIFT"], 7), regs.writes)
        self.assertIn((control.ADA_REG["RAW_LP_SHIFT"], 12), regs.writes)

    def test_system_constructor_maps_raw_buffer_and_closes_it(self):
        created = []

        class FakeAxiMap(FakeRegs):
            def __init__(self, base, span, dev="/dev/mem"):
                super().__init__(base=control.parse_int(base))
                self.span = control.parse_int(span)
                created.append(self)

        original = control.AxiMap
        control.AxiMap = FakeAxiMap
        try:
            system = control.ButterflyLaserSystem(
                ada_raw_base=control.DEFAULT_ADA_RAW_BASE,
                raw_buffer_span=control.DEFAULT_RAW_BUFFER_SPAN,
            )
            self.assertEqual(system.ada.raw_buf_regs.base, control.DEFAULT_ADA_RAW_BASE)
            self.assertEqual(system.ada.raw_buf_regs.span, control.DEFAULT_RAW_BUFFER_SPAN)
            system.close()
            self.assertTrue(system.ada_raw_regs.closed)
        finally:
            control.AxiMap = original


class Ada4355ServerRawBufferTests(unittest.TestCase):
    def test_server_defaults_include_raw_lp_shift(self):
        self.assertEqual(server.DEFAULT_SETTINGS["ada4355"]["raw_lp_shift"], "13")
        self.assertEqual(tauri_server.DEFAULT_SETTINGS["ada4355"]["raw_lp_shift"], "13")

    def test_parsers_expose_raw_buffer_addresses(self):
        parser = server.build_parser()
        args = parser.parse_args([])
        self.assertEqual(control.parse_int(args.ada_raw_base), control.DEFAULT_ADA_RAW_BASE)
        self.assertEqual(control.parse_int(args.raw_buffer_span), control.DEFAULT_RAW_BUFFER_SPAN)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Extend Tauri defaults test**

In `tests/test_tauri_server_defaults.py`, add this assertion inside `test_tauri_server_reuses_legacy_defaults`:

```python
self.assertEqual(tauri_server.DEFAULT_SETTINGS["ada4355"]["raw_lp_shift"], "13")
```

- [ ] **Step 3: Run tests and verify they fail for missing feature**

Run:

```bash
python3 -m unittest tests.test_ada4355_raw_buffer tests.test_tauri_server_defaults
```

Expected: FAIL because `DEFAULT_ADA_RAW_BASE`, `DEFAULT_RAW_BUFFER_SPAN`, `ADA_RAW_MAX_POINTS`, `RAW_LP_SHIFT`, and the 4-argument `Ada4355Capture` constructor do not exist yet.

- [ ] **Step 4: Commit tests if Task 0 baseline commit was made**

```bash
git add tests/test_ada4355_raw_buffer.py tests/test_tauri_server_defaults.py
git commit -m "test: cover ADA4355 packed raw buffer API"
```

Expected: commit succeeds. If Task 0 baseline commit was skipped, do not run this commit step.

---

### Task 2: Python Raw Buffer Implementation

**Files:**
- Modify: `butterfly_laser_control.py`

- [ ] **Step 1: Add constants and registers**

In `butterfly_laser_control.py`, update the default address section:

```python
DEFAULT_ADA_BUF0_BASE = 0xA01C0000
DEFAULT_ADA_BUF1_BASE = 0xA01D0000
DEFAULT_ADA_RAW_BASE = 0xA0200000
DEFAULT_SPAN = 0x1000
DEFAULT_BUFFER_SPAN = 0x10000
DEFAULT_RAW_BUFFER_SPAN = 0x100000
ADA_RAW_MAX_POINTS = 512 * 1024
ADA_RAW_BUFFER_WORDS = ADA_RAW_MAX_POINTS // 2
```

Append these entries to `ADA_REG`:

```python
    "RAW_LP_SHIFT": 0x9C,
    "RAW_FILTERED_ADC_LAST": 0xA0,
    "RAW_CAPACITY_SAMPLES": 0xA4,
    "RAW_BUFFER_WORDS": 0xA8,
```

- [ ] **Step 2: Update Ada4355Capture constructor**

Replace the constructor with:

```python
class Ada4355Capture:
    def __init__(self, regs, buf0_regs, buf1_regs, raw_buf_regs):
        self.regs = regs
        self.buf0_regs = buf0_regs
        self.buf1_regs = buf1_regs
        self.raw_buf_regs = raw_buf_regs
```

- [ ] **Step 3: Add raw LP shift handling**

Update `configure_filter` signature and body:

```python
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
```

After the existing `LP_SHIFT` write, add:

```python
        if raw_lp_shift is not None:
            self.write("RAW_LP_SHIFT", require_range("raw_lp_shift", raw_lp_shift, 0, 31))
```

- [ ] **Step 4: Raise raw capture limit to 512K**

Change `capture_raw` validation:

```python
    def capture_raw(self, length=ADA_RAW_MAX_POINTS, decim=1, timeout=1.0, release_existing=True):
        length = require_range("length", length, 1, ADA_RAW_MAX_POINTS)
```

Keep `RAW_LENGTH`, `RAW_DECIM`, `CONTROL`, `RAW_CONTROL`, polling, and metadata behavior unchanged except that `write_count` uses the new limit:

```python
        count = min(self.read("RAW_WRITE_COUNT"), length)
```

- [ ] **Step 5: Read and unpack the dedicated raw buffer**

Replace `read_raw` with:

```python
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
```

- [ ] **Step 6: Extend status readback**

Inside `status()`, add raw base and raw LP fields:

```python
            "raw_base_hex": f"0x{self.raw_buf_regs.base:08X}",
```

Inside `"filter"` add:

```python
                "raw_lp_shift": self.read("RAW_LP_SHIFT"),
                "raw_filtered_adc_last": self.read("RAW_FILTERED_ADC_LAST") & 0xFFFF,
```

Inside `"raw"` add:

```python
                "capacity_samples": self.read("RAW_CAPACITY_SAMPLES"),
                "buffer_words": self.read("RAW_BUFFER_WORDS"),
                "storage": "packed_u16_le",
```

- [ ] **Step 7: Wire raw mmap through ButterflyLaserSystem**

Update `ButterflyLaserSystem.__init__` parameters:

```python
        ada_raw_base=DEFAULT_ADA_RAW_BASE,
        buffer_span=DEFAULT_BUFFER_SPAN,
        raw_buffer_span=DEFAULT_RAW_BUFFER_SPAN,
```

Add map creation and controller wiring:

```python
        self.ada_raw_regs = AxiMap(ada_raw_base, raw_buffer_span)
        self.ada = Ada4355Capture(
            self.ada_regs,
            self.ada_buf0_regs,
            self.ada_buf1_regs,
            self.ada_raw_regs,
        )
```

Update `close()`:

```python
        self.ada_raw_regs.close()
```

- [ ] **Step 8: Update CLI parser and main wiring**

Add parser arguments near the existing ADA buffer args:

```python
    parser.add_argument("--ada-raw-base", default=hex(DEFAULT_ADA_RAW_BASE), help="ADA4355 packed raw buffer base address")
    parser.add_argument("--raw-buffer-span", default=hex(DEFAULT_RAW_BUFFER_SPAN), help="ADA4355 packed raw buffer mapping span")
```

Pass the values into `ButterflyLaserSystem` in `main()`:

```python
        args.ada_raw_base,
        args.buffer_span,
        args.raw_buffer_span,
```

Use keyword arguments if positional ordering becomes hard to read:

```python
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
```

- [ ] **Step 9: Run Python raw tests**

Run:

```bash
python3 -m unittest tests.test_ada4355_raw_buffer tests.test_tauri_server_defaults
```

Expected: PASS.

- [ ] **Step 10: Compile Python**

Run:

```bash
python3 -m py_compile butterfly_laser_control.py
```

Expected: exits 0.

- [ ] **Step 11: Commit implementation if Task 0 baseline commit was made**

```bash
git add butterfly_laser_control.py
git commit -m "feat: add ADA4355 packed raw buffer hardware API"
```

Expected: commit succeeds. If Task 0 baseline commit was skipped, do not run this commit step.

---

### Task 3: Server Settings and Endpoint Wiring

**Files:**
- Modify: `butterfly_laser_server.py`
- Modify: `butterfly_laser_server_tauri.py`
- Modify: `tests/test_panel_click_to_lock.py`
- Modify: `tests/test_tauri_server_defaults.py`

- [ ] **Step 1: Add server tests for settings application**

In `tests/test_panel_click_to_lock.py`, update `FakeAda` in `test_startup_parameter_initialization_applies_settings_without_enabling_outputs`:

```python
        class FakeAda:
            def __init__(self):
                self.monitor_rate = None
                self.capture = None
                self.filter = None

            def set_monitor_rate_hz(self, value):
                self.monitor_rate = value

            def configure_capture(self, **kwargs):
                self.capture = kwargs

            def configure_filter(self, **kwargs):
                self.filter = kwargs
```

Add assertions after `server.initialize_pl_parameters(...)`:

```python
        self.assertEqual(system.ada.capture["max_points"], 16384)
        self.assertEqual(system.ada.capture["frame_decim"], 1000)
        self.assertEqual(system.ada.filter["lp_shift"], 13)
        self.assertEqual(system.ada.filter["raw_lp_shift"], 13)
```

- [ ] **Step 2: Update default settings assertions**

In `tests/test_panel_click_to_lock.py`, add:

```python
self.assertEqual(settings["ada4355"]["raw_lp_shift"], "13")
```

In `tests/test_tauri_server_defaults.py`, add:

```python
self.assertEqual(tauri_server.DEFAULT_SETTINGS["ada4355"]["raw_lp_shift"], "13")
```

- [ ] **Step 3: Run server tests and verify failure before implementation**

Run:

```bash
python3 -m unittest tests.test_panel_click_to_lock tests.test_tauri_server_defaults
```

Expected: FAIL until `raw_lp_shift` is added to defaults and `apply_saved_settings()`.

- [ ] **Step 4: Add settings default and schema migration**

In `butterfly_laser_server.py`, increment:

```python
SETTINGS_SCHEMA_VERSION = 6
```

Add to `DEFAULT_SETTINGS["ada4355"]`:

```python
        "raw_lp_shift": "13",
```

No legacy replacement is needed for missing `raw_lp_shift`; `deep_merge(DEFAULT_SETTINGS, loaded_settings)` fills it.

- [ ] **Step 5: Apply raw LP shift from settings**

In `apply_saved_settings()`, update the ADA filter call:

```python
        system.ada.configure_filter(
            control=body_int(ada, "filter_control") if "filter_control" in ada else None,
            threshold=body_int(ada, "glitch_threshold") if "glitch_threshold" in ada else None,
            lp_shift=body_int(ada, "lp_shift") if "lp_shift" in ada else None,
            raw_lp_shift=body_int(ada, "raw_lp_shift") if "raw_lp_shift" in ada else None,
        )
```

- [ ] **Step 6: Accept raw LP shift in `/api/ada/filter`**

In `ButterflyHandler.do_POST`, update the `/api/ada/filter` call:

```python
                        raw_lp_shift=body_int(body, "raw_lp_shift") if "raw_lp_shift" in body else None,
```

- [ ] **Step 7: Add raw buffer parser args in legacy server**

Import defaults from `butterfly_laser_control`:

```python
    DEFAULT_ADA_RAW_BASE,
    DEFAULT_RAW_BUFFER_SPAN,
```

Add parser args in `build_parser()`:

```python
    parser.add_argument("--ada-raw-base", default=hex(DEFAULT_ADA_RAW_BASE), help="ADA4355 packed raw buffer base address")
    parser.add_argument("--raw-buffer-span", default=hex(DEFAULT_RAW_BUFFER_SPAN), help="ADA4355 packed raw buffer mapping span")
```

Pass keyword args into `ButterflyLaserSystem`:

```python
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
```

- [ ] **Step 8: Add raw buffer args in Tauri server**

In `butterfly_laser_server_tauri.py`, import:

```python
    DEFAULT_ADA_RAW_BASE,
    DEFAULT_RAW_BUFFER_SPAN,
```

The parser reuses `build_legacy_parser()`, so the args come from `butterfly_laser_server.py`. Pass keyword args into `ButterflyLaserSystem` in `main()` using the same block from Step 7.

- [ ] **Step 9: Run server verification**

Run:

```bash
python3 -m unittest tests.test_ada4355_raw_buffer tests.test_panel_click_to_lock tests.test_tauri_server_defaults tests.test_tauri_server_sse
python3 -m py_compile butterfly_laser_server.py butterfly_laser_server_tauri.py butterfly_laser_control.py
```

Expected: all tests pass and compile exits 0.

- [ ] **Step 10: Commit server changes if Task 0 baseline commit was made**

```bash
git add butterfly_laser_server.py butterfly_laser_server_tauri.py tests/test_panel_click_to_lock.py tests/test_tauri_server_defaults.py
git commit -m "feat: expose ADA4355 raw LP shift and raw buffer mapping"
```

Expected: commit succeeds. If Task 0 baseline commit was skipped, do not run this commit step.

---

### Task 4: Tauri Frontend Tests

**Files:**
- Modify: `tauri_control_console/src/__tests__/api.test.ts`
- Modify: `tauri_control_console/src/__tests__/adaPanelLayout.test.tsx`
- Modify: `tauri_control_console/src/__tests__/settings.test.ts`

- [ ] **Step 1: Add raw capture default test**

In `tauri_control_console/src/__tests__/api.test.ts`, add or update a fetch mock test:

```ts
it("requests 512K raw samples by default", async () => {
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  global.fetch = vi.fn(async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body ?? "{}")) });
    return {
      ok: true,
      json: async () => ({ ok: true, capture: {}, raw: { count: 0, samples: [] } }),
    } as Response;
  });

  const client = new ApiClient("http://127.0.0.1:8080");
  await client.rawCapture();

  expect(calls[0].url).toBe("http://127.0.0.1:8080/api/ada/raw-capture");
  expect(calls[0].body).toMatchObject({ length: 524288, decim: 1, timeout: 1.0 });
});
```

Make sure the file imports `ApiClient` and `vi`:

```ts
import { describe, expect, it, vi } from "vitest";
import { ApiClient } from "../api/client";
```

- [ ] **Step 2: Update AdaPanel layout test**

In `tauri_control_console/src/__tests__/adaPanelLayout.test.tsx`, change the ADA status fixture:

```ts
      filter: {
        lp_shift: 13,
        raw_lp_shift: 9,
        glitch_threshold: 3000,
        raw_use_filtered: false,
      },
      raw: { length: 524288, decim: 1, capacity_samples: 524288, storage: "packed_u16_le" },
```

Add assertions:

```ts
    expect(html).toContain("Spectrum/Monitor LP Shift");
    expect(html).toContain("Raw LP Shift");
    expect(html).toContain("524288");
```

- [ ] **Step 3: Update settings test**

In `tauri_control_console/src/__tests__/settings.test.ts`, add `raw_lp_shift` to the status fixture:

```ts
      filter: {
        control_hex: "0x00000019",
        glitch_threshold: 3000,
        lp_shift: 13,
        raw_lp_shift: 9,
      },
```

Add assertion:

```ts
expect(settings.ada4355.raw_lp_shift).toBe("9");
```

Update the flattening test input and expectation:

```ts
ada4355: { lp_shift: "13", raw_lp_shift: "9" },
```

Expected rows should include:

```ts
{ key: "ada4355.raw_lp_shift", value: "9" },
```

- [ ] **Step 4: Run frontend tests and verify they fail before implementation**

Run:

```bash
cd tauri_control_console
PATH=/home/qian/.local/nodejs/bin:$PATH npm test -- --run src/__tests__/api.test.ts src/__tests__/adaPanelLayout.test.tsx src/__tests__/settings.test.ts
```

Expected: FAIL until client defaults, labels, and settings extraction are implemented.

- [ ] **Step 5: Commit tests if Task 0 baseline commit was made**

```bash
git add tauri_control_console/src/__tests__/api.test.ts tauri_control_console/src/__tests__/adaPanelLayout.test.tsx tauri_control_console/src/__tests__/settings.test.ts
git commit -m "test: cover ADA raw buffer frontend controls"
```

Expected: commit succeeds. If Task 0 baseline commit was skipped, do not run this commit step.

---

### Task 5: Tauri Frontend Implementation

**Files:**
- Modify: `tauri_control_console/src/api/client.ts`
- Modify: `tauri_control_console/src/api/types.ts`
- Modify: `tauri_control_console/src/components/AdaPanel.tsx`
- Modify: `tauri_control_console/src/utils/settings.ts`

- [ ] **Step 1: Update API defaults and types**

In `client.ts`, change:

```ts
rawCapture(length = 524288, decim = 1): Promise<{ ok: true; capture: Record<string, unknown>; raw: RawCapture }> {
  return this.post("/api/ada/raw-capture", { length, decim, timeout: 1.0 });
}
```

In `types.ts`, replace `AdaStatus` raw/filter loose records with compatible typed fields:

```ts
export type AdaFilterStatus = {
  control?: number;
  control_hex?: string;
  enabled?: boolean;
  glitch_reject?: boolean;
  raw_use_filtered?: boolean;
  spectrum_use_filtered?: boolean;
  monitor_use_filtered?: boolean;
  glitch_threshold?: number;
  lp_shift?: number;
  raw_lp_shift?: number;
  filtered_adc_last?: number;
  raw_filtered_adc_last?: number;
  glitch_reject_counter?: number;
};

export type AdaRawStatus = {
  control?: number;
  status?: number;
  status_hex?: string;
  length?: number;
  decim?: number;
  write_count?: number;
  capacity_samples?: number;
  buffer_words?: number;
  storage?: string;
};
```

Then set:

```ts
  filter?: AdaFilterStatus;
  raw?: AdaRawStatus;
```

Add raw response metadata:

```ts
export type RawCapture = {
  count: number;
  samples: number[];
  storage?: string;
  word_count?: number;
  raw_status?: number;
  raw_status_hex?: string;
  raw_write_count?: number;
  decim?: number;
};
```

- [ ] **Step 2: Add independent Raw LP Shift state**

In `AdaPanel.tsx`, keep the existing `lpShift` for spectrum/monitor and add:

```ts
  const rawLpShift = useSyncedInput(inputInt(ada?.filter?.raw_lp_shift), "13");
```

Update `releaseDrafts()`:

```ts
    rawLpShift.release();
```

Update `/api/ada/filter` payload:

```ts
      lp_shift: numberFromInput(lpShift.value),
      raw_lp_shift: numberFromInput(rawLpShift.value),
```

- [ ] **Step 3: Decouple spectrum config from raw length**

In `updateParameters()`, stop sending `max_points: rawLength`. Replace the capture-config payload with:

```ts
    await client.post("/api/ada/capture-config", {
      max_points: Math.min(16384, Math.max(1, Number(ada?.max_points ?? 16384))),
      frame_decim: Math.max(1, Number(ada?.frame_decim_n ?? 1000)),
    });
```

Keep raw decimation only for raw capture:

```ts
    const response = await client.rawCapture(
      Math.min(524288, Math.max(1, numberFromInput(rawLength.value))),
      Math.max(1, numberFromInput(rawDecim.value)),
    );
```

- [ ] **Step 4: Update visible labels and metadata**

Change the existing LP shift label:

```tsx
<label>
  Spectrum/Monitor LP Shift
  <input {...lpShift.bind} />
</label>
<label>
  Raw LP Shift
  <input {...rawLpShift.bind} />
</label>
```

Change raw length default:

```ts
const rawLength = useSyncedInput(inputInt(ada?.raw?.length), "524288");
```

In raw save metadata, add:

```ts
              raw_lp_shift: numberFromInput(rawLpShift.value),
              raw_storage: raw.storage,
              raw_word_count: raw.word_count,
```

- [ ] **Step 5: Update settings extraction**

In `tauri_control_console/src/utils/settings.ts`, after the existing LP shift assignment add:

```ts
  assignText(ada, "raw_lp_shift", status.ada4355.filter?.raw_lp_shift);
```

- [ ] **Step 6: Run focused frontend tests**

Run:

```bash
cd tauri_control_console
PATH=/home/qian/.local/nodejs/bin:$PATH npm test -- --run src/__tests__/api.test.ts src/__tests__/adaPanelLayout.test.tsx src/__tests__/settings.test.ts
```

Expected: PASS.

- [ ] **Step 7: Run full frontend test suite**

Run:

```bash
cd tauri_control_console
PATH=/home/qian/.local/nodejs/bin:$PATH npm test
```

Expected: PASS.

- [ ] **Step 8: Commit frontend implementation if Task 0 baseline commit was made**

```bash
git add tauri_control_console/src/api/client.ts tauri_control_console/src/api/types.ts tauri_control_console/src/components/AdaPanel.tsx tauri_control_console/src/utils/settings.ts
git commit -m "feat: decouple ADA raw LPF controls in Tauri"
```

Expected: commit succeeds. If Task 0 baseline commit was skipped, do not run this commit step.

---

### Task 6: HDL Testbench and Static Tests

**Files:**
- Modify: `/home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/IPs/ip_repo/axi_ada4355_capture_1_0/tb_axi_ada4355_capture_compile.sv`
- Modify: `tests/test_panel_click_to_lock.py`

- [ ] **Step 1: Update static RTL tests**

In `tests/test_panel_click_to_lock.py`, extend `test_ada_rtl_defaults_support_100khz_lock_feedback`:

```python
        self.assertIn("localparam [7:0] A_RAW_LP_SHIFT", rtl)
        self.assertIn("localparam [7:0] A_RAW_CAPACITY", rtl)
        self.assertIn("raw_lp_shift_reg <= 32'd13;", rtl)
        self.assertIn("VERSION = 32'h0001_0007", rtl)
```

Add a new test:

```python
    def test_ada_rtl_exposes_independent_raw_buffer_ports(self):
        top = ADA_AXI.parent / "axi_ada4355_capture_v1_0.v"
        core = ADA_AXI.parent / "ada4355_capture_core.v"
        top_rtl = top.read_text(encoding="utf-8")
        core_rtl = core.read_text(encoding="utf-8")
        self.assertIn("parameter integer RAW_ADDR_WIDTH", top_rtl)
        self.assertIn("raw_buf_clk", top_rtl)
        self.assertIn("raw_buf_rddata", top_rtl)
        self.assertIn("xpm_fifo_async", core_rtl)
        self.assertIn("xpm_memory_sdpram", core_rtl)
        self.assertIn('MEMORY_PRIMITIVE("ultra")', core_rtl.replace(" ", ""))
        self.assertIn("RAW_MAX_SAMPLES", core_rtl)
```

- [ ] **Step 2: Update testbench port declarations**

In the ADA testbench, add:

```systemverilog
  localparam RAW_W = 18;
  reg [RAW_W+1:0] raw_buf_addr = {(RAW_W+2){1'b0}};
  wire [31:0] raw_buf_rddata;
```

Add these DUT connections:

```systemverilog
    .raw_buf_clk(axi_clk),
    .raw_buf_rst(1'b0),
    .raw_buf_en(1'b1),
    .raw_buf_we(4'd0),
    .raw_buf_addr(raw_buf_addr),
    .raw_buf_wrdata(32'd0),
    .raw_buf_rddata(raw_buf_rddata),
```

Add read task:

```systemverilog
  task automatic raw_buf_read(input integer word_index, output [31:0] data);
    begin
      @(negedge axi_clk);
      raw_buf_addr = word_index << 2;
      @(posedge axi_clk);
      @(posedge axi_clk);
      data = raw_buf_rddata;
    end
  endtask
```

- [ ] **Step 3: Update register expectations**

Change version check:

```systemverilog
    if (value !== 32'h0001_0007)
      $fatal(1, "VERSION got 0x%08x", value);
```

Add raw capacity checks after version:

```systemverilog
    axi_read(8'h9c, value);
    if (value !== 32'd13)
      $fatal(1, "RAW_LP_SHIFT default got %0d", value);
    axi_read(8'ha4, value);
    if (value !== 32'd524288)
      $fatal(1, "RAW_CAPACITY_SAMPLES got %0d", value);
    axi_read(8'ha8, value);
    if (value !== 32'd262144)
      $fatal(1, "RAW_BUFFER_WORDS got %0d", value);
```

- [ ] **Step 4: Update raw capture checks**

Replace the final `buf0_read(0, value)` raw check with:

```systemverilog
    raw_buf_read(0, value);
    if (value[15:0] === 16'h0000 || value[31:16] === 16'h0000)
      $fatal(1, "raw packed word did not contain two samples: 0x%08x", value);
    buf0_read(0, value);
    if (value[31:16] === 16'h3000 || value[15:0] === 16'h3000)
      $fatal(1, "raw capture polluted spectrum buf0 word0: 0x%08x", value);
```

Add an odd length capture after the 16-sample capture:

```systemverilog
    axi_write(8'h68, 32'd5);
    adc_data = 16'h4100;
    axi_write(8'h64, 32'h0000_0001);
    for (i = 0; i < 40; i = i + 1) begin
      @(posedge adc_clk);
      adc_data <= adc_data + 16'd1;
    end
    repeat (20) @(posedge axi_clk);
    axi_read(8'h7c, value);
    if (value !== 32'd5)
      $fatal(1, "odd RAW_WRITE_COUNT expected 5 got %0d", value);
    raw_buf_read(2, value);
    if (value[31:16] !== 16'h0000)
      $fatal(1, "odd raw capture last upper half not padded: 0x%08x", value);
```

- [ ] **Step 5: Run tests and verify failure before HDL implementation**

Run Python static tests:

```bash
python3 -m unittest tests.test_panel_click_to_lock
```

Expected: FAIL until HDL files are changed.

Run Vivado compile from the IP directory:

```bash
cd /home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/IPs/ip_repo/axi_ada4355_capture_1_0
xvlog -sv tb_axi_ada4355_capture_compile.sv hdl/ada4355_capture_core.v hdl/axi_ada4355_capture_v1_0_S00_AXI.v hdl/axi_ada4355_capture_v1_0.v
```

Expected: FAIL until `raw_buf_*` ports and raw registers exist.

- [ ] **Step 6: Commit tests if Task 0 baseline commit was made**

```bash
git add tests/test_panel_click_to_lock.py /home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/IPs/ip_repo/axi_ada4355_capture_1_0/tb_axi_ada4355_capture_compile.sv
git commit -m "test: require ADA raw URAM capture path"
```

Expected: commit succeeds. If Task 0 baseline commit was skipped, do not run this commit step.

---

### Task 7: HDL Raw Buffer Implementation

**Files:**
- Modify: `/home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/IPs/ip_repo/axi_ada4355_capture_1_0/hdl/axi_ada4355_capture_v1_0.v`
- Modify: `/home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/IPs/ip_repo/axi_ada4355_capture_1_0/hdl/axi_ada4355_capture_v1_0_S00_AXI.v`
- Modify: `/home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/IPs/ip_repo/axi_ada4355_capture_1_0/hdl/ada4355_capture_core.v`

- [ ] **Step 1: Add raw buffer top-level parameter and ports**

In `axi_ada4355_capture_v1_0.v`, add:

```verilog
    parameter integer RAW_ADDR_WIDTH       = 18
```

Add ports after `buf1_rddata`:

```verilog
    input  wire        raw_buf_clk,
    input  wire        raw_buf_rst,
    input  wire        raw_buf_en,
    input  wire [3:0]  raw_buf_we,
    input  wire [RAW_ADDR_WIDTH+1:0] raw_buf_addr,
    input  wire [31:0] raw_buf_wrdata,
    output wire [31:0] raw_buf_rddata,
```

Pass `.RAW_ADDR_WIDTH(RAW_ADDR_WIDTH)` into the S00 instance and connect every `raw_buf_*` signal.

- [ ] **Step 2: Add S00_AXI raw buffer ports and registers**

In `axi_ada4355_capture_v1_0_S00_AXI.v`, add the same `RAW_ADDR_WIDTH` parameter and `raw_buf_*` ports.

Add register localparams:

```verilog
    localparam [7:0] A_RAW_LP_SHIFT = 8'h9c;
    localparam [7:0] A_RAW_FILTERED_ADC = 8'ha0;
    localparam [7:0] A_RAW_CAPACITY = 8'ha4;
    localparam [7:0] A_RAW_WORDS = 8'ha8;
```

Change version:

```verilog
    localparam [31:0] VERSION = 32'h0001_0007;
```

Add:

```verilog
    reg [31:0] raw_lp_shift_reg;
    wire [15:0] raw_filtered_adc_last;
```

Reset default:

```verilog
            raw_lp_shift_reg <= 32'd13;
```

Readback cases:

```verilog
                    A_RAW_LP_SHIFT:    axi_rdata <= raw_lp_shift_reg;
                    A_RAW_FILTERED_ADC: axi_rdata <= {16'd0, raw_filtered_adc_last};
                    A_RAW_CAPACITY:     axi_rdata <= 32'd524288;
                    A_RAW_WORDS:        axi_rdata <= 32'd262144;
```

Write case:

```verilog
                    A_RAW_LP_SHIFT: raw_lp_shift_reg <= apply_wstrb(raw_lp_shift_reg, S_AXI_WDATA, S_AXI_WSTRB);
```

Pass to core:

```verilog
        .raw_lp_shift(raw_lp_shift_reg[4:0]),
        .raw_buf_clk(raw_buf_clk),
        .raw_buf_rst(raw_buf_rst),
        .raw_buf_en(raw_buf_en),
        .raw_buf_we(raw_buf_we),
        .raw_buf_addr(raw_buf_addr),
        .raw_buf_rddata(raw_buf_rddata),
        .raw_filtered_adc_last(raw_filtered_adc_last),
```

- [ ] **Step 3: Add core parameters and XPM ports**

In `ada4355_capture_core.v`, add parameters:

```verilog
    parameter integer RAW_ADDR_WIDTH = 18
```

Add inputs/outputs:

```verilog
    input  wire [4:0]  raw_lp_shift,
    input  wire        raw_buf_clk,
    input  wire        raw_buf_rst,
    input  wire        raw_buf_en,
    input  wire [3:0]  raw_buf_we,
    input  wire [RAW_ADDR_WIDTH+1:0] raw_buf_addr,
    output wire [31:0] raw_buf_rddata,
    output reg  [15:0] raw_filtered_adc_last,
```

Add localparams:

```verilog
    localparam integer RAW_WORDS = (1 << RAW_ADDR_WIDTH);
    localparam integer RAW_MAX_SAMPLES = (RAW_WORDS << 1);
    localparam [31:0] RAW_STATUS_BUSY = 32'h0000_0002;
    localparam [31:0] RAW_STATUS_DONE = 32'h0000_0004;
    localparam [31:0] RAW_STATUS_OVERFLOW = 32'h0000_0008;
```

- [ ] **Step 4: Add raw-specific LPF**

Add ADC-domain raw LPF registers:

```verilog
    reg [4:0] raw_lp_shift_sync0_adc;
    reg [4:0] raw_lp_shift_sync1_adc;
    reg raw_filter_initialized_adc;
    reg [31:0] raw_filter_accum_adc;
    reg signed [33:0] raw_filter_delta_adc;
    reg signed [33:0] raw_filter_step_adc;
    reg signed [33:0] raw_filter_next_accum_adc;
    reg [31:0] raw_filter_next_clamped_adc;
```

Synchronize `raw_lp_shift` next to `lp_shift`:

```verilog
            raw_lp_shift_sync0_adc <= 5'd13;
            raw_lp_shift_sync1_adc <= 5'd13;
```

and:

```verilog
            raw_lp_shift_sync0_adc <= raw_lp_shift;
            raw_lp_shift_sync1_adc <= raw_lp_shift_sync0_adc;
```

After `filter_input_sample_adc` is chosen by glitch rejection, update raw filter:

```verilog
                if (!raw_filter_initialized_adc) begin
                    raw_filter_initialized_adc <= 1'b1;
                    raw_filter_accum_adc <= {filter_input_sample_adc, 16'd0};
                    raw_filtered_adc_last <= filter_input_sample_adc;
                end else if (filter_enable_adc) begin
                    raw_filter_delta_adc =
                        $signed({2'd0, filter_input_sample_adc, 16'd0}) -
                        $signed({2'd0, raw_filter_accum_adc});
                    raw_filter_step_adc = raw_filter_delta_adc >>> raw_lp_shift_sync1_adc;
                    raw_filter_next_accum_adc =
                        $signed({2'd0, raw_filter_accum_adc}) + raw_filter_step_adc;
                    if (raw_filter_next_accum_adc < 34'sd0)
                        raw_filter_next_clamped_adc = 32'd0;
                    else if (raw_filter_next_accum_adc > 34'sd4294967295)
                        raw_filter_next_clamped_adc = 32'hffff_ffff;
                    else
                        raw_filter_next_clamped_adc = raw_filter_next_accum_adc[31:0];
                    raw_filter_accum_adc <= raw_filter_next_clamped_adc;
                    raw_filtered_adc_last <= raw_filter_next_clamped_adc[31:16];
                end else begin
                    raw_filter_accum_adc <= {filter_input_sample_adc, 16'd0};
                    raw_filtered_adc_last <= filter_input_sample_adc;
                end
```

Change raw sample selection:

```verilog
    wire [15:0] raw_sample_adc = raw_use_filtered_adc ? raw_filtered_adc_last : adc_data;
```

- [ ] **Step 5: Replace raw writes to spectrum0 with ADC-domain packer**

Remove the raw path assignments to `ram0_we_adc`, `ram0_addr_adc`, and `ram0_data_adc`.

Add ADC-domain packer registers:

```verilog
    reg raw_pack_half_adc;
    reg [15:0] raw_pack_first_adc;
    reg raw_fifo_wr_en_adc;
    reg [31:0] raw_fifo_din_adc;
    reg raw_capture_finished_tgl_adc;
    reg [31:0] raw_final_sample_count_adc;
    reg [31:0] raw_final_word_count_adc;
    wire raw_fifo_full_adc;
    wire raw_fifo_wr_rst_busy_adc;
```

During raw capture, when decimation fires:

```verilog
                    if (!raw_pack_half_adc) begin
                        raw_pack_first_adc <= raw_sample_adc;
                        raw_pack_half_adc <= 1'b1;
                    end else begin
                        raw_fifo_din_adc <= {raw_sample_adc, raw_pack_first_adc};
                        raw_fifo_wr_en_adc <= !raw_fifo_full_adc && !raw_fifo_wr_rst_busy_adc;
                        raw_pack_half_adc <= 1'b0;
                    end
```

When the last sample is odd, flush:

```verilog
                        if (!raw_fifo_full_adc && raw_pack_half_adc) begin
                            raw_fifo_din_adc <= {16'd0, raw_pack_first_adc};
                            raw_fifo_wr_en_adc <= !raw_fifo_wr_rst_busy_adc;
                        end
```

If `raw_fifo_full_adc` is high when a word must be written, stop capture and set `raw_status_adc <= RAW_STATUS_OVERFLOW`.

When capture ends normally, do not report raw done to AXI yet. Instead latch final counts and toggle a raw-buffer-domain handoff:

```verilog
                        raw_final_sample_count_adc <= raw_write_count_adc + 1'b1;
                        raw_final_word_count_adc <= (raw_write_count_adc + 32'd2) >> 1;
                        raw_capture_finished_tgl_adc <= ~raw_capture_finished_tgl_adc;
```

On FIFO overflow, latch the number of samples that were actually accepted and the corresponding packed word count:

```verilog
                        raw_final_sample_count_adc <= raw_write_count_adc;
                        raw_final_word_count_adc <= (raw_write_count_adc + 1'b1) >> 1;
                        raw_capture_finished_tgl_adc <= ~raw_capture_finished_tgl_adc;
```

- [ ] **Step 6: Add async FIFO and URAM writer in raw_buf_clk domain**

Instantiate FIFO:

```verilog
    wire raw_fifo_empty_rawclk;
    reg raw_fifo_rd_en_rawclk;
    wire [31:0] raw_fifo_dout_rawclk;
    wire raw_fifo_data_valid_rawclk;
    wire raw_fifo_rd_rst_busy_rawclk;

    xpm_fifo_async #(
        .FIFO_MEMORY_TYPE("block"),
        .FIFO_WRITE_DEPTH(1024),
        .WRITE_DATA_WIDTH(32),
        .READ_DATA_WIDTH(32),
        .READ_MODE("std"),
        .FIFO_READ_LATENCY(1),
        .CDC_SYNC_STAGES(2),
        .DOUT_RESET_VALUE("0"),
        .ECC_MODE("no_ecc"),
        .FULL_RESET_VALUE(0),
        .PROG_EMPTY_THRESH(10),
        .PROG_FULL_THRESH(1014),
        .RELATED_CLOCKS(0),
        .USE_ADV_FEATURES("0707"),
        .WAKEUP_TIME(0)
    ) raw_pack_fifo (
        .rst(!adc_resetn || raw_buf_rst),
        .wr_clk(adc_clk),
        .rd_clk(raw_buf_clk),
        .din(raw_fifo_din_adc),
        .wr_en(raw_fifo_wr_en_adc),
        .rd_en(raw_fifo_rd_en_rawclk),
        .dout(raw_fifo_dout_rawclk),
        .full(raw_fifo_full_adc),
        .empty(raw_fifo_empty_rawclk),
        .wr_rst_busy(raw_fifo_wr_rst_busy_adc),
        .rd_rst_busy(raw_fifo_rd_rst_busy_rawclk),
        .almost_empty(),
        .almost_full(),
        .data_valid(raw_fifo_data_valid_rawclk),
        .dbiterr(),
        .overflow(),
        .prog_empty(),
        .prog_full(),
        .rd_data_count(),
        .sbiterr(),
        .underflow(),
        .wr_ack(),
        .wr_data_count()
    );
```

Add synchronizers for raw arm and ADC capture finish:

```verilog
    reg [2:0] raw_arm_sync_rawclk;
    reg [2:0] raw_finished_sync_rawclk;
    wire raw_arm_evt_rawclk = raw_arm_sync_rawclk[2] ^ raw_arm_sync_rawclk[1];
    wire raw_finished_evt_rawclk = raw_finished_sync_rawclk[2] ^ raw_finished_sync_rawclk[1];

    always @(posedge raw_buf_clk) begin
        if (raw_buf_rst) begin
            raw_arm_sync_rawclk <= 3'd0;
            raw_finished_sync_rawclk <= 3'd0;
        end else begin
            raw_arm_sync_rawclk <= {raw_arm_sync_rawclk[1:0], raw_arm_toggle};
            raw_finished_sync_rawclk <= {raw_finished_sync_rawclk[1:0], raw_capture_finished_tgl_adc};
        end
    end
```

Add raw clock writer. The writer uses `raw_fifo_data_valid_rawclk`; it does not write URAM in the same cycle as `rd_en` for standard FIFO reads:

```verilog
    reg [RAW_ADDR_WIDTH-1:0] raw_write_addr_rawclk;
    reg raw_mem_we_rawclk;
    reg [31:0] raw_mem_din_rawclk;
    reg raw_writer_active_rawclk;
    reg [31:0] raw_target_words_rawclk;
    reg [31:0] raw_done_count_rawclk;
    reg [31:0] raw_status_rawclk;
    reg raw_done_tgl_rawclk;

    always @(posedge raw_buf_clk) begin
        if (raw_buf_rst) begin
            raw_write_addr_rawclk <= {RAW_ADDR_WIDTH{1'b0}};
            raw_fifo_rd_en_rawclk <= 1'b0;
            raw_mem_we_rawclk <= 1'b0;
            raw_mem_din_rawclk <= 32'd0;
            raw_writer_active_rawclk <= 1'b0;
            raw_target_words_rawclk <= 32'd0;
            raw_done_count_rawclk <= 32'd0;
            raw_status_rawclk <= 32'd0;
            raw_done_tgl_rawclk <= 1'b0;
        end else begin
            raw_fifo_rd_en_rawclk <= 1'b0;
            raw_mem_we_rawclk <= 1'b0;
            if (raw_arm_evt_rawclk) begin
                raw_write_addr_rawclk <= {RAW_ADDR_WIDTH{1'b0}};
                raw_writer_active_rawclk <= 1'b1;
                raw_target_words_rawclk <= 32'd0;
            end
            if (raw_finished_evt_rawclk) begin
                raw_target_words_rawclk <= raw_final_word_count_adc;
                raw_done_count_rawclk <= raw_final_sample_count_adc;
            end
            if (raw_writer_active_rawclk && !raw_fifo_empty_rawclk && !raw_fifo_rd_rst_busy_rawclk) begin
                raw_fifo_rd_en_rawclk <= 1'b1;
            end
            if (raw_fifo_data_valid_rawclk) begin
                raw_mem_din_rawclk <= raw_fifo_dout_rawclk;
                raw_mem_we_rawclk <= 1'b1;
                raw_write_addr_rawclk <= raw_write_addr_rawclk + 1'b1;
            end
            if (raw_writer_active_rawclk &&
                raw_target_words_rawclk != 32'd0 &&
                {14'd0, raw_write_addr_rawclk} >= raw_target_words_rawclk) begin
                raw_writer_active_rawclk <= 1'b0;
                raw_status_rawclk <= raw_status_adc[3] ? RAW_STATUS_OVERFLOW : RAW_STATUS_DONE;
                raw_done_tgl_rawclk <= ~raw_done_tgl_rawclk;
            end
        end
    end
```

Synchronize `raw_done_tgl_rawclk`, `raw_status_rawclk`, and `raw_done_count_rawclk` into `axi_clk` for `raw_done`, `raw_status`, and `raw_write_count`. The existing AXI raw done/status path currently listens to `raw_done_tgl_adc`; replace that source with the raw-buffer-domain done toggle so software only sees done after URAM writes complete.

- [ ] **Step 7: Instantiate XPM UltraRAM**

Add:

```verilog
    xpm_memory_sdpram #(
        .ADDR_WIDTH_A(RAW_ADDR_WIDTH),
        .ADDR_WIDTH_B(RAW_ADDR_WIDTH),
        .AUTO_SLEEP_TIME(0),
        .BYTE_WRITE_WIDTH_A(32),
        .CASCADE_HEIGHT(0),
        .CLOCKING_MODE("common_clock"),
        .ECC_MODE("no_ecc"),
        .MEMORY_INIT_FILE("none"),
        .MEMORY_INIT_PARAM("0"),
        .MEMORY_OPTIMIZATION("true"),
        .MEMORY_PRIMITIVE("ultra"),
        .MEMORY_SIZE((1 << RAW_ADDR_WIDTH) * 32),
        .MESSAGE_CONTROL(0),
        .READ_DATA_WIDTH_B(32),
        .READ_LATENCY_B(1),
        .READ_RESET_VALUE_B("0"),
        .RST_MODE_A("SYNC"),
        .RST_MODE_B("SYNC"),
        .USE_EMBEDDED_CONSTRAINT(0),
        .USE_MEM_INIT(0),
        .WAKEUP_TIME("disable_sleep"),
        .WRITE_DATA_WIDTH_A(32),
        .WRITE_MODE_B("read_first")
    ) raw_sample_mem (
        .clka(raw_buf_clk),
        .ena(raw_mem_we_rawclk),
        .wea(4'hf),
        .addra(raw_write_addr_rawclk),
        .dina(raw_mem_din_rawclk),
        .injectdbiterra(1'b0),
        .injectsbiterra(1'b0),
        .clkb(raw_buf_clk),
        .rstb(raw_buf_rst),
        .enb(raw_buf_en),
        .addrb(raw_buf_addr[RAW_ADDR_WIDTH+1:2]),
        .doutb(raw_buf_rddata),
        .regceb(1'b1),
        .sleep(1'b0),
        .dbiterrb(),
        .sbiterrb()
    );
```

- [ ] **Step 8: Remove raw_busy gating from spectrum writes**

In `CAP_SAMPLE` and `CAP_STREAM`, remove `&& !raw_busy_adc` from conditions that write/capture spectrum samples. Keep max point and overrun checks intact.

- [ ] **Step 9: Compile RTL**

Run:

```bash
cd /home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/IPs/ip_repo/axi_ada4355_capture_1_0
xvlog -sv tb_axi_ada4355_capture_compile.sv hdl/ada4355_capture_core.v hdl/axi_ada4355_capture_v1_0_S00_AXI.v hdl/axi_ada4355_capture_v1_0.v
```

Expected: PASS.

- [ ] **Step 10: Run HDL static tests**

Run:

```bash
cd /home/qian/Portable_System_Project/Butterfly_Laser_Driver
python3 -m unittest tests.test_panel_click_to_lock
```

Expected: PASS.

- [ ] **Step 11: Commit HDL if Task 0 baseline commit was made**

```bash
git add /home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/IPs/ip_repo/axi_ada4355_capture_1_0/hdl/axi_ada4355_capture_v1_0.v /home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/IPs/ip_repo/axi_ada4355_capture_1_0/hdl/axi_ada4355_capture_v1_0_S00_AXI.v /home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/IPs/ip_repo/axi_ada4355_capture_1_0/hdl/ada4355_capture_core.v
git commit -m "feat: add ADA4355 packed raw URAM buffer"
```

Expected: commit succeeds if the IP path is tracked in this repository. If it is outside this git repository or Task 0 baseline commit was skipped, do not run this commit step.

---

### Task 8: IP Metadata and Documentation

**Files:**
- Modify: `/home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/IPs/ip_repo/axi_ada4355_capture_1_0/component.xml`
- Modify: `/home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/IPs/ip_repo/axi_ada4355_capture_1_0/xgui/axi_ada4355_capture_v1_0.tcl`
- Modify: `/home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/IPs/ip_repo/axi_ada4355_capture_1_0/bd/bd.tcl`
- Modify: `/home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/IPs/ip_repo/axi_ada4355_capture_1_0/README_AXI_ADA4355_CAPTURE.md`

- [ ] **Step 1: Refresh IP component metadata with Vivado**

Run:

```bash
cd /home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/IPs/ip_repo/axi_ada4355_capture_1_0
/opt/pkg/Xilinx/Vivado/2023.2/bin/vivado -mode batch -nolog -nojournal -source /tmp/repackage_axi_ada4355_capture.tcl
```

Before running, create `/tmp/repackage_axi_ada4355_capture.tcl` with:

```tcl
set ip_dir "/home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/IPs/ip_repo/axi_ada4355_capture_1_0"
ipx::open_ipxact_file [file join $ip_dir component.xml]
set core [ipx::current_core]
ipx::merge_project_changes files $core
ipx::merge_project_changes ports $core
ipx::merge_project_changes parameters $core
ipx::save_core $core
```

Expected: `component.xml` contains `raw_buf_clk`, `raw_buf_addr`, `raw_buf_rddata`, and `RAW_ADDR_WIDTH`.

- [ ] **Step 2: Update xgui parameter propagation if Vivado did not add it**

Add to `init_gui`:

```tcl
  ipgui::add_param $IPINST -name "RAW_ADDR_WIDTH" -parent ${Page_0}
```

Add procs:

```tcl
proc update_PARAM_VALUE.RAW_ADDR_WIDTH { PARAM_VALUE.RAW_ADDR_WIDTH } {
}

proc validate_PARAM_VALUE.RAW_ADDR_WIDTH { PARAM_VALUE.RAW_ADDR_WIDTH } {
	return true
}

proc update_MODELPARAM_VALUE.RAW_ADDR_WIDTH { MODELPARAM_VALUE.RAW_ADDR_WIDTH PARAM_VALUE.RAW_ADDR_WIDTH } {
	set_property value [get_property value ${PARAM_VALUE.RAW_ADDR_WIDTH}] ${MODELPARAM_VALUE.RAW_ADDR_WIDTH}
}
```

- [ ] **Step 3: Update README register and buffer docs**

In `README_AXI_ADA4355_CAPTURE.md`, document:

```text
0x9C RAW_LP_SHIFT
0xA0 RAW_FILTERED_ADC_LAST
0xA4 RAW_CAPACITY_SAMPLES
0xA8 RAW_BUFFER_WORDS

Raw buffer storage:
word[15:0]  = earlier 16-bit ADC sample
word[31:16] = later 16-bit ADC sample
RAW_LENGTH and RAW_WRITE_COUNT are sample counts.
Software reads ceil(RAW_WRITE_COUNT / 2) 32-bit words.
Default raw buffer base: 0xA0200000
Default raw buffer span: 0x00100000
```

- [ ] **Step 4: Verify metadata**

Run:

```bash
rg -n "raw_buf_clk|raw_buf_addr|raw_buf_rddata|RAW_ADDR_WIDTH|RAW_LP_SHIFT|RAW_CAPACITY_SAMPLES" /home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/IPs/ip_repo/axi_ada4355_capture_1_0/component.xml /home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/IPs/ip_repo/axi_ada4355_capture_1_0/xgui/axi_ada4355_capture_v1_0.tcl /home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/IPs/ip_repo/axi_ada4355_capture_1_0/README_AXI_ADA4355_CAPTURE.md
```

Expected: every pattern appears in the relevant metadata/docs files.

- [ ] **Step 5: Commit metadata if Task 0 baseline commit was made**

```bash
git add /home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/IPs/ip_repo/axi_ada4355_capture_1_0/component.xml /home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/IPs/ip_repo/axi_ada4355_capture_1_0/xgui/axi_ada4355_capture_v1_0.tcl /home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/IPs/ip_repo/axi_ada4355_capture_1_0/bd/bd.tcl /home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/IPs/ip_repo/axi_ada4355_capture_1_0/README_AXI_ADA4355_CAPTURE.md
git commit -m "docs: refresh ADA4355 raw buffer IP metadata"
```

Expected: commit succeeds if the IP path is tracked in this repository. If it is outside this git repository or Task 0 baseline commit was skipped, do not run this commit step.

---

### Task 9: Full Verification

**Files:**
- Verify only.

- [ ] **Step 1: Run Python unit tests**

Run:

```bash
cd /home/qian/Portable_System_Project/Butterfly_Laser_Driver
python3 -m unittest tests.test_board_acquire tests.test_tauri_server_defaults tests.test_tauri_server_sse tests.test_panel_click_to_lock tests.test_plot_lock_recording tests.test_ada4355_raw_buffer tests.test_tec_target_ramp
```

Expected: PASS.

- [ ] **Step 2: Compile Python**

Run:

```bash
python3 -m py_compile butterfly_laser_control.py butterfly_laser_server.py butterfly_laser_server_tauri.py plot_lock_recording.py
```

Expected: exits 0.

- [ ] **Step 3: Run frontend tests**

Run:

```bash
cd /home/qian/Portable_System_Project/Butterfly_Laser_Driver/tauri_control_console
PATH=/home/qian/.local/nodejs/bin:$PATH npm test
```

Expected: PASS.

- [ ] **Step 4: Build frontend**

Run:

```bash
cd /home/qian/Portable_System_Project/Butterfly_Laser_Driver/tauri_control_console
PATH=/home/qian/.local/nodejs/bin:$PATH npm run build
```

Expected: PASS.

- [ ] **Step 5: Compile ADA HDL**

Run:

```bash
cd /home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/IPs/ip_repo/axi_ada4355_capture_1_0
xvlog -sv tb_axi_ada4355_capture_compile.sv hdl/ada4355_capture_core.v hdl/axi_ada4355_capture_v1_0_S00_AXI.v hdl/axi_ada4355_capture_v1_0.v
```

Expected: PASS.

- [ ] **Step 6: Start Tauri dev app**

Run:

```bash
cd /home/qian/Portable_System_Project/Butterfly_Laser_Driver/tauri_control_console
env -u PKG_CONFIG_PATH -u PKG_CONFIG_SYSROOT_DIR -u PKG_CONFIG_LIBDIR -u CC -u CXX -u AR -u AS -u LD -u STRIP -u RANLIB -u OBJCOPY -u OBJDUMP -u READELF -u CFLAGS -u CXXFLAGS -u LDFLAGS PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/home/qian/.local/nodejs/bin:/home/qian/.cargo/bin npm run tauri dev
```

Expected: Vite listens on `127.0.0.1:1420` and the Tauri window opens. Some EGL/GBM warnings are acceptable if the app stays running.

- [ ] **Step 7: Final status report**

Run:

```bash
git status --short --branch
```

Expected: Report all remaining modified/untracked files, including whether task commits were skipped due to the dirty baseline.
