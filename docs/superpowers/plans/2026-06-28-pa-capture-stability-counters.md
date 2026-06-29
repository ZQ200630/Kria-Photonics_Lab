# PA Capture Stability Counters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add PA acquisition counters, watchdog fault reporting, and diagnostics while keeping the current one-frame DMA buffer pool and legacy `.bin` format.

**Architecture:** Keep the current 4KB DMA buffer pool and 32MB kernel superblocks. Add PL counters to the PA AXI-Lite register bank, add a V2 kernel status ioctl, then surface both through server diagnostics and Tauri.

**Tech Stack:** Verilog RTL, Vivado module/IP sources, Linux kernel module C, Python server, TypeScript/React Tauri UI, Python and frontend tests.

---

### Task 1: PL Register Map And Counter Readout Constants

**Files:**
- Modify: `/home/qian/Portable_System_Project/Butterfly_Laser_Driver/pa_imaging_capture.py`
- Modify: `/home/qian/Portable_System_Project/Butterfly_Laser_Driver/tests/test_pa_imaging_capture.py`

- [ ] **Step 1: Add a failing test for the PL counter register map**

Add a test that constructs a fake register reader and verifies the expected offsets and names:

```python
def test_pam_pl_counter_registers_are_read_in_order(self):
    class FakeRegs:
        def __init__(self):
            self.reads = []
        def read32(self, offset):
            self.reads.append(offset)
            return offset + 1

    regs = FakeRegs()
    counters = pa.PamAxiController(regs).read_pl_counters()

    self.assertEqual(counters["status"], 0x81)
    self.assertEqual(counters["fault_code"], 0x85)
    self.assertEqual(counters["accepted_trigger_count"], 0x8D)
    self.assertEqual(regs.reads[0], pa.PAM_REG_DBG_STATUS)
    self.assertEqual(regs.reads[-1], pa.PAM_REG_DBG_TX_DONE_COUNT)
```

- [ ] **Step 2: Implement constants and `read_pl_counters()`**

Add constants beginning at `0x80`, a `PAM_DEBUG_COUNTER_REGS` tuple, and `PamAxiController.read_pl_counters()`.

- [ ] **Step 3: Add `clear_pl_counters()`**

Write `1` to `PAM_REG_DBG_CONTROL`, then `0`, so capture start can reset per-run counters.

- [ ] **Step 4: Run Python tests**

Run:

```bash
/usr/bin/python3 -m unittest tests.test_pa_imaging_capture
```

Expected: pass.

### Task 2: Driver V2 DMA Health Counters

**Files:**
- Modify: `/home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/project-spec/meta-user/recipes-modules/axis-capture-superblock/files/axis-capture-superblock.c`
- Modify: `/home/qian/Portable_System_Project/Butterfly_Laser_Driver/pa_imaging_capture.py`
- Modify: `/home/qian/Portable_System_Project/Butterfly_Laser_Driver/tests/test_pa_imaging_capture.py`

- [ ] **Step 1: Add Python V2 unpack tests**

Add tests proving V2 fields unpack correctly and V1 still works.

- [ ] **Step 2: Add V2 ioctl definitions in Python**

Define `AXIS_CAP_IOC_GET_STATUS_V2_NR = 0x04`, `AXIS_STATUS_V2_FORMAT`, and `AxisCaptureStatusV2`.

- [ ] **Step 3: Add fallback in `AxisCaptureDevice.get_status()`**

Try V2 first. If ioctl returns `ENOTTY`, `EINVAL`, or `ENOSYS`, fall back to V1.

- [ ] **Step 4: Add V2 struct and counters in the kernel module**

Keep `struct axis_cap_status` unchanged. Add `struct axis_cap_status_v2` and fill it from protected driver state.

- [ ] **Step 5: Increment driver counters**

Increment submit/callback/rearm/abort/fault counters at the existing paths. Track queue high-water marks and active-DMA low-water mark under `qlock`.

- [ ] **Step 6: Run Python tests**

Run:

```bash
/usr/bin/python3 -m unittest tests.test_pa_imaging_capture
```

Expected: pass.

### Task 3: PL HDL Counters And Watchdog

**Files:**
- Modify: `/home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/hardware/xilinx-k26-som-2023.2/rtl/frame_capture_axis_top.v`
- Modify: `/home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/hardware/xilinx-k26-som-2023.2/rtl/axis_frame_packer.v`
- Modify: `/home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/IPs/ip_repo/axi_pam_image_acq_1_0/hdl/axi_pam_image_acq_v1_0.v`
- Modify: `/home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/IPs/ip_repo/axi_pam_image_acq_1_0/hdl/axi_pam_image_acq_v1_0_S00_AXI.v`
- Modify generated BD/IP copies only if required by the current Vivado project state.

- [ ] **Step 1: Add counter output ports to `frame_capture_axis_top`**

Expose accepted/rejected triggers, AXIS stall counters, FIFO overflow counters, capture done, tx done, status, and fault code.

- [ ] **Step 2: Count AXIS stalls**

Count `m_axis_tvalid && !m_axis_tready`, contiguous stall events, and max stall length in the PL clock domain.

- [ ] **Step 3: Count trigger accept/reject and FIFO overflow**

Increment accepted trigger on `accepted_trigger_pl`; rejected trigger when `trigger_pulse_pl && overall_busy_pl`; overflow on rising overflow/error observation.

- [ ] **Step 4: Add watchdog fault latch**

Latch fault if continuous busy or continuous AXIS stall exceeds the 5 second threshold. Latch immediate FIFO overflow fault.

- [ ] **Step 5: Add AXI-Lite read-only debug registers to `axi_pam_image_acq`**

Map offsets `0x80` through `0xB4` to the PL counter inputs. Implement write-to-clear on `0x88`.

- [ ] **Step 6: Validate syntax**

Run a Verilog parser/simulation compile if available:

```bash
xvlog /home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/hardware/xilinx-k26-som-2023.2/rtl/frame_capture_axis_top.v
```

Expected: no syntax errors.

### Task 4: Server Diagnostics

**Files:**
- Modify: `/home/qian/Portable_System_Project/Butterfly_Laser_Driver/pa_imaging_capture.py`
- Modify: `/home/qian/Portable_System_Project/Butterfly_Laser_Driver/butterfly_laser_server.py`
- Modify: `/home/qian/Portable_System_Project/Butterfly_Laser_Driver/tests/test_tauri_server_defaults.py`

- [ ] **Step 1: Add tests for diagnostics payload**

Assert `/api/pa/diagnostics` includes `pa.pl_counters` when available and reports errors without failing the entire endpoint.

- [ ] **Step 2: Clear PL counters on PA start**

Call `PamAxiController.clear_pl_counters()` before asserting PA start.

- [ ] **Step 3: Include PL counters in PA status**

Read and expose `pl_counters` in `PaService.status()`.

- [ ] **Step 4: Stop capture on PL fault**

If `pl_counters["status"] & 1`, request PA stop and report fault code in `last_error`.

- [ ] **Step 5: Run server tests**

Run:

```bash
/usr/bin/python3 -m unittest tests.test_pa_imaging_capture tests.test_tauri_server_defaults
```

Expected: pass.

### Task 5: Tauri Types And Diagnostics UI

**Files:**
- Modify: `/home/qian/Portable_System_Project/Butterfly_Laser_Driver/tauri_control_console/src/api/types.ts`
- Modify: `/home/qian/Portable_System_Project/Butterfly_Laser_Driver/tauri_control_console/src/components/PaImagingPanel.tsx`
- Modify: `/home/qian/Portable_System_Project/Butterfly_Laser_Driver/tauri_control_console/src/__tests__/paImagingPanelLayout.test.tsx`

- [ ] **Step 1: Add TypeScript types**

Add `PaPlCounters` and extend `PaCaptureStatus` with optional `pl_counters`.

- [ ] **Step 2: Add compact diagnostics display**

Show fault code, accepted/rejected triggers, AXIS stall counts, FIFO overflow count, and driver queue/callback counters. Highlight nonzero fault/risk counters.

- [ ] **Step 3: Add UI layout tests**

Verify the diagnostics labels render when mock status includes PL and driver V2 counters.

- [ ] **Step 4: Run frontend tests**

Run:

```bash
cd /home/qian/Portable_System_Project/Butterfly_Laser_Driver/tauri_control_console
npm test
```

Expected: pass.

### Task 6: End-To-End Verification

**Files:**
- Modify only if verification exposes issues.

- [ ] **Step 1: Run Python and frontend tests**

Run:

```bash
/usr/bin/python3 -m unittest tests.test_pa_imaging_capture tests.test_tauri_server_defaults
cd /home/qian/Portable_System_Project/Butterfly_Laser_Driver/tauri_control_console
npm test
```

Expected: pass.

- [ ] **Step 2: Check formatting/diff sanity**

Run:

```bash
git diff --check
```

Expected: no whitespace errors.

- [ ] **Step 3: Board verification after bitstream/module upload**

Run a 10x10x1 PA capture. Expected: `frames_sent=100`, no metadata gaps, no PL fault. Then run a long capture and confirm frame/global-shot gaps remain zero.
