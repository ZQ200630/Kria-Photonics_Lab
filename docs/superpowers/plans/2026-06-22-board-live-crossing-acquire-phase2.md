# Board Live Crossing Acquire Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a hardware-supported acquire path that scans live, detects the selected side-fringe crossing inside a CH1-code search window, and immediately enters the existing side-fringe PID lock at the live CH1 code.

**Architecture:** Keep the existing direct marker lock unchanged. Extend `axi_laser_current_ctrl` with a versioned acquire register window in the existing 8-bit AXI address space, add a live crossing detector in `laser_current_ctrl_core`, and make software endpoints refuse acquire on old bitstreams. Phase 2 intentionally uses target-crossing plus polarity/search-window matching; the Phase 1 code-domain template remains available for a later correlation-score matcher.

**Tech Stack:** Verilog RTL for Vivado IP, Python `/dev/mem` control/server, Vitest/Tauri GUI tests, Python unittest static RTL checks, `xvlog` syntax compile.

---

### Task 1: Software and RTL Tests

**Files:**
- Create: `tests/test_board_acquire.py`
- Modify: `tests/test_panel_click_to_lock.py`

- [ ] **Step 1: Write failing Python tests**

Create `tests/test_board_acquire.py` with a fake register bank:

```python
import unittest

import butterfly_laser_control as control


class FakeRegs:
    def __init__(self, initial=None):
        self.values = dict(initial or {})
        self.writes = []

    def read32(self, offset):
        return self.values.get(offset, 0)

    def write32(self, offset, value):
        self.values[offset] = value & 0xFFFFFFFF
        self.writes.append((offset, value & 0xFFFFFFFF))


class BoardAcquireControlTests(unittest.TestCase):
    def test_acquire_support_requires_version_2_bitstream(self):
        old_laser = control.LaserCurrentController(FakeRegs({"VERSION": 0}))
        new_laser = control.LaserCurrentController(FakeRegs({control.LASER_REG["VERSION"]: 0x00020000}))

        self.assertFalse(old_laser.supports_board_acquire())
        self.assertTrue(new_laser.supports_board_acquire())

    def test_configure_acquire_writes_versioned_acquire_registers(self):
        regs = FakeRegs({control.LASER_REG["VERSION"]: 0x00020000})
        laser = control.LaserCurrentController(regs)

        laser.configure_acquire(search_min=24000, search_max=26000, threshold=25)

        self.assertIn((control.LASER_REG["ACQUIRE_SEARCH_RANGE"], (26000 << 16) | 24000), regs.writes)
        self.assertIn((control.LASER_REG["ACQUIRE_THRESHOLD"], 25), regs.writes)
        self.assertIn((control.LASER_REG["ACQUIRE_CONTROL"], control.LASER_ACQ_ENABLE), regs.writes)

    def test_arm_acquire_refuses_old_bitstreams(self):
        laser = control.LaserCurrentController(FakeRegs({control.LASER_REG["VERSION"]: 0}))

        with self.assertRaisesRegex(RuntimeError, "does not support board acquire"):
            laser.arm_acquire()


if __name__ == "__main__":
    unittest.main()
```

Add static RTL checks to `tests/test_panel_click_to_lock.py`:

```python
    def test_laser_rtl_exposes_versioned_board_acquire_registers(self):
        rtl = LASER_AXI.read_text(encoding="utf-8")
        self.assertIn("C_S_AXI_ADDR_WIDTH = 8", rtl)
        self.assertIn("LASER_CURRENT_CTRL_VERSION = 32'h0002_0000", rtl)
        self.assertIn("ACQUIRE_CONTROL", rtl)
        self.assertIn("acquire_arm_pulse", rtl)
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
python3 -m unittest tests.test_board_acquire tests.test_panel_click_to_lock
```

Expected: FAIL because `VERSION`, acquire constants/methods, and RTL acquire registers do not exist yet.

### Task 2: Extend Python Control Plane

**Files:**
- Modify: `butterfly_laser_control.py`
- Modify: `butterfly_laser_server.py`

- [ ] **Step 1: Add laser acquire register map and helpers**

Add:

```python
"VERSION": 0xFC,
"ACQUIRE_CONTROL": 0xC8,
"ACQUIRE_SEARCH_RANGE": 0xCC,
"ACQUIRE_THRESHOLD": 0xD0,
"ACQUIRE_STATUS": 0xD4,
"ACQUIRE_MATCH_CODE": 0xD8,
"ACQUIRE_MATCH_ADC": 0xDC,
"ACQUIRE_MATCH_ERROR": 0xE0,
```

Add constants:

```python
LASER_MIN_BOARD_ACQUIRE_VERSION = 0x00020000
LASER_ACQ_ENABLE = 1 << 0
LASER_ACQ_ARM = 1 << 1
LASER_ACQ_CANCEL = 1 << 2
```

Add methods:

```python
def supports_board_acquire(self):
    return self.read("VERSION") >= LASER_MIN_BOARD_ACQUIRE_VERSION

def require_board_acquire(self):
    if not self.supports_board_acquire():
        raise RuntimeError("current laser bitstream does not support board acquire")

def configure_acquire(self, search_min, search_max, threshold=20):
    self.require_board_acquire()
    search_min = require_u16("search_min", search_min)
    search_max = require_u16("search_max", search_max)
    if search_max < search_min:
        raise ValueError("search_max must be >= search_min")
    self.write("ACQUIRE_SEARCH_RANGE", (search_max << 16) | search_min)
    self.write("ACQUIRE_THRESHOLD", require_u16("threshold", threshold))
    self.write("ACQUIRE_CONTROL", LASER_ACQ_ENABLE)

def arm_acquire(self):
    self.require_board_acquire()
    self.write("ACQUIRE_CONTROL", LASER_ACQ_ENABLE | LASER_ACQ_ARM)

def cancel_acquire(self):
    self.require_board_acquire()
    self.write("ACQUIRE_CONTROL", LASER_ACQ_CANCEL)
```

- [ ] **Step 2: Replace server 501 placeholders**

Make `/api/laser/acquire-template` configure lock parameters and acquire search range, `/api/laser/acquire-arm` pulse arm, and `/api/laser/acquire-cancel` cancel. Preserve the version guard so old bitstreams return JSON error without writing extended AXI addresses.

- [ ] **Step 3: Run tests and verify GREEN for software**

Run:

```bash
python3 -m unittest tests.test_board_acquire
python3 -m py_compile butterfly_laser_control.py butterfly_laser_server.py butterfly_laser_server_tauri.py
```

Expected: PASS.

### Task 3: Extend Laser Current RTL Acquire Path

**Files:**
- Modify: `/home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/IPs/ip_repo/axi_laser_current_ctrl_1_0/hdl/axi_laser_current_ctrl_v1_0.v`
- Modify: `/home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/IPs/ip_repo/axi_laser_current_ctrl_1_0/hdl/axi_laser_current_ctrl_v1_0_S00_AXI.v`
- Modify: `/home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/IPs/ip_repo/axi_laser_current_ctrl_1_0/hdl/laser_current_ctrl_core.v`

- [ ] **Step 1: Widen AXI register decode**

Keep the default laser AXI address width at 8, `OPT_MEM_ADDR_BITS` at 5, and `slv_reg [0:63]`. Keep existing offsets unchanged. Add read-only `LASER_CURRENT_CTRL_VERSION = 32'h0002_0000` at register 63 (`0xFC`).

- [ ] **Step 2: Add acquire registers**

Use:

```verilog
localparam [5:0] REG_ACQUIRE_CONTROL      = 6'd50;
localparam [5:0] REG_ACQUIRE_SEARCH_RANGE = 6'd51;
localparam [5:0] REG_ACQUIRE_THRESHOLD    = 6'd52;
localparam [5:0] REG_ACQUIRE_STATUS       = 6'd53;
localparam [5:0] REG_ACQUIRE_MATCH_CODE   = 6'd54;
localparam [5:0] REG_ACQUIRE_MATCH_ADC    = 6'd55;
localparam [5:0] REG_ACQUIRE_MATCH_ERROR  = 6'd56;
```

Generate write-one pulses from `REG_ACQUIRE_CONTROL` bits 1 and 2. Store only bit 0.

- [ ] **Step 3: Add core live crossing acquire**

Add core inputs for acquire enable/arm/cancel/search/threshold and status outputs. During fine scan, when acquire is armed and `fb_adc_valid` is high, compute `target_adc - fb_adc_data`, apply polarity, detect either a sign crossing against the previous sample or absolute error below threshold inside the CH1 search range. On match, stop scan, emit `frame_end_pulse`, set the runtime lock bias to the live CH1 code, reset PID counters, and enter `ST_LOCK_HOLD`.

- [ ] **Step 4: Run RTL static tests and syntax compile**

Run:

```bash
python3 -m unittest tests.test_panel_click_to_lock
xvlog -sv /home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/IPs/ip_repo/axi_laser_current_ctrl_1_0/hdl/laser_current_ctrl_core.v /home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/IPs/ip_repo/axi_laser_current_ctrl_1_0/hdl/axi_laser_current_ctrl_v1_0_S00_AXI.v /home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/IPs/ip_repo/axi_laser_current_ctrl_1_0/hdl/axi_laser_current_ctrl_v1_0.v
```

Expected: tests pass and `xvlog` exits 0.

### Task 4: GUI Enablement

**Files:**
- Modify: `tauri_control_console/src/components/LockPanel.tsx`
- Modify: `tauri_control_console/src/api/types.ts`

- [ ] **Step 1: Enable Board-Matched Acquire controls only when supported**

Use `laser.version >= 0x00020000` or `laser.acquire.supported` from status. Keep buttons disabled when unsupported.

- [ ] **Step 2: Upload selected marker config and arm acquire**

`Upload Template` sends the marker target ADC, polarity, search range, and lock parameters to `/api/laser/acquire-template`. `Arm Board Match` sends `/api/laser/acquire-arm`, then starts/keeps fine scan. Direct marker lock remains available.

- [ ] **Step 3: Run frontend verification**

Run:

```bash
PATH=/home/qian/.local/nodejs/bin:$PATH npm test
PATH=/home/qian/.local/nodejs/bin:$PATH npm run build
```

Expected: PASS.
