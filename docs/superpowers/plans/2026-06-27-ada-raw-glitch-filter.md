# ADA Raw Glitch And Filter Decoupling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an independent Raw Glitch control before the raw low-pass filter so raw ADC capture can reject rare spikes without forcing raw LP filtering.

**Architecture:** Reuse the existing `FILTER_CONTROL` register and add bit 5 as `raw_glitch_reject`. HDL raw capture becomes `adc_data -> raw glitch optional -> raw LP optional -> raw buffer`, while live/spectrum global glitch/filter behavior remains unchanged. Server, CLI, status JSON, and Tauri ADA controls expose `Raw Glitch` and `Raw Filter` independently.

**Tech Stack:** Verilog AXI IP, Python server/control API, React/TypeScript Tauri UI, unittest, Vitest, Vivado xsim/xvlog/xelab.

---

### Task 1: Failing Tests

**Files:**
- Modify: `tests/test_ada4355_raw_buffer.py`
- Modify: `tests/test_panel_click_to_lock.py`
- Modify: `tauri_control_console/src/__tests__/adaPanelLayout.test.tsx`

- [ ] **Step 1: Add Python API expectations**

Add tests that expect `ADA_FILTER_RAW_GLITCH_REJECT`, status `raw_glitch_reject`, and partial `configure_filter(raw_glitch_reject=...)` behavior.

- [ ] **Step 2: Add HDL source expectations**

Update the existing ADA RTL source test to expect version `32'h0001_000D`, `raw_glitch_reject_enable`, `raw_glitch_sample_adc`, and `raw_sample_adc = raw_use_filtered_adc ? raw_filtered_adc_last : raw_glitch_sample_adc`.

- [ ] **Step 3: Add Tauri layout expectations**

Update ADA panel markup test to require both `Raw Glitch` and `Raw Filter`.

- [ ] **Step 4: Run targeted tests and verify RED**

Run:

```bash
python3 -m unittest tests.test_ada4355_raw_buffer tests.test_panel_click_to_lock
cd tauri_control_console
PATH=/home/qian/.local/nodejs/bin:$PATH npm test -- --run src/__tests__/adaPanelLayout.test.tsx
```

Expected: FAIL because the new raw glitch bit/status/UI/HDL path do not exist yet.

### Task 2: Python Server And CLI

**Files:**
- Modify: `butterfly_laser_control.py`
- Modify: `butterfly_laser_server.py`
- Modify: `butterfly_laser_server_tauri.py`
- Modify: `tauri_control_console/src/api/types.ts`

- [ ] **Step 1: Add filter bit constant and status**

Add `ADA_FILTER_RAW_GLITCH_REJECT = 0x20` and expose `raw_glitch_reject` in ADA filter status.

- [ ] **Step 2: Extend partial filter updates**

Add `raw_glitch_reject=None` to `configure_filter`, server `/api/ada/filter`, and the Tauri server mirror.

- [ ] **Step 3: Add CLI flags**

Add `--raw-glitch` and `--raw-no-glitch` to the `ada-filter` command.

- [ ] **Step 4: Run Python targeted tests and verify GREEN**

Run:

```bash
python3 -m unittest tests.test_ada4355_raw_buffer tests.test_panel_click_to_lock
```

Expected: Python API tests pass except any HDL text expectations that still need Task 3.

### Task 3: HDL Raw Path

**Files:**
- Modify: `/home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/IPs/ip_repo/axi_ada4355_capture_1_0/hdl/ada4355_capture_core.v`
- Modify: `/home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/IPs/ip_repo/axi_ada4355_capture_1_0/hdl/axi_ada4355_capture_v1_0_S00_AXI.v`
- Modify: `/home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/IPs/ip_repo/axi_ada4355_capture_1_0/tb_axi_ada4355_capture_compile.sv` if version/default assertions require it.

- [ ] **Step 1: Add raw glitch input and sync**

Add `raw_glitch_reject_enable`, synchronize it into the ADC domain, and connect it from `filter_control_reg[5]`.

- [ ] **Step 2: Add independent raw glitch state**

Track `raw_last_accepted_adc`, compute `raw_glitch_sample_adc`, and feed raw LP state from that sample.

- [ ] **Step 3: Preserve raw filter semantics**

Keep bit 2 as raw low-pass enable/source select and set raw buffer sample to `raw_filtered_adc_last` only when raw filter is enabled.

- [ ] **Step 4: Bump IP version**

Set `VERSION` to `32'h0001_000D` in the AXI wrapper.

- [ ] **Step 5: Run HDL text tests**

Run:

```bash
python3 -m unittest tests.test_panel_click_to_lock
```

Expected: PASS for updated HDL text assertions.

### Task 4: Tauri ADA UI

**Files:**
- Modify: `tauri_control_console/src/components/AdaPanel.tsx`
- Modify: `tauri_control_console/src/api/types.ts`

- [ ] **Step 1: Add raw glitch readback state**

Read `ada.filter.raw_glitch_reject` into a `Raw Glitch` checkbox with dirty-state behavior matching `Raw Filter`.

- [ ] **Step 2: Send independent raw controls**

`Update Parameters` sends `raw_glitch_reject` and `raw_filtered`, and continues not sending live/spectrum `lp_shift`.

- [ ] **Step 3: Save raw metadata**

Include `raw_glitch_enabled` and `raw_filter_enabled` in raw ADC metadata.

- [ ] **Step 4: Run ADA panel test**

Run:

```bash
cd tauri_control_console
PATH=/home/qian/.local/nodejs/bin:$PATH npm test -- --run src/__tests__/adaPanelLayout.test.tsx
```

Expected: PASS.

### Task 5: Verification

**Files:**
- No new files.

- [ ] **Step 1: Run Python tests**

```bash
python3 -m unittest discover tests
```

- [ ] **Step 2: Run frontend tests**

```bash
cd tauri_control_console
PATH=/home/qian/.local/nodejs/bin:$PATH npm test -- --run
```

- [ ] **Step 3: Run frontend build**

```bash
cd tauri_control_console
PATH=/home/qian/.local/nodejs/bin:$PATH npm run build
```

- [ ] **Step 4: Run Rust tests**

```bash
cd tauri_control_console/src-tauri
env -u PKG_CONFIG_SYSROOT_DIR -u CC -u CXX -u AR -u AS -u LD -u STRIP -u RANLIB -u OBJCOPY -u OBJDUMP -u READELF -u CFLAGS -u CXXFLAGS -u LDFLAGS PKG_CONFIG_PATH=/usr/lib/x86_64-linux-gnu/pkgconfig:/usr/share/pkgconfig:/usr/lib/pkgconfig PKG_CONFIG_LIBDIR=/usr/lib/x86_64-linux-gnu/pkgconfig:/usr/share/pkgconfig:/usr/lib/pkgconfig PATH=/home/qian/.cargo/bin:$PATH cargo test -- --nocapture
```

- [ ] **Step 5: Run diff check**

```bash
git diff --check
```
