# Vivado Warning Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move from warning triage into root-cause repair while keeping undecidable hardware-policy items explicit.

**Architecture:** Fix only warnings whose root cause is already proven and whose behavior impact is bounded. Keep timing, CDC, DSP, BRAM, and board-interface choices visible until the required evidence is extracted and reviewed.

**Tech Stack:** Vivado 2023.2 Tcl, Verilog RTL, Xilinx DRC/methodology reports, repository markdown evidence.

---

### Task 1: Make Message Policy Reapplication Idempotent

**Files:**
- Modify: `tools/vivado_warning_cleanup/message_severity_policy.tcl`
- Sync: `/home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/tools/message_severity_policy.tcl`
- Test: `tools/vivado_warning_cleanup/guard_message_policy.py`
- Test: `tools/vivado_warning_cleanup/verify_message_policy.tcl`

- [ ] **Step 1: Guard only set_msg_config registration**

Add `::reviewed_message_config_applied` around the `set_msg_config` calls. Leave the DRC/methodology `set_property SEVERITY Advisory` section outside the guard so it can run again after `open_project` or `open_run`.

- [ ] **Step 2: Run policy guard**

Run:

```bash
python3 -B tools/vivado_warning_cleanup/guard_message_policy.py
```

Expected: `MESSAGE_POLICY_GUARD_OK=tools/vivado_warning_cleanup/message_severity_policy.tcl`

- [ ] **Step 3: Sync into Demo1013**

Run:

```bash
cp tools/vivado_warning_cleanup/message_severity_policy.tcl /home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/tools/message_severity_policy.tcl
```

- [ ] **Step 4: Verify with Vivado**

Run:

```bash
vivado -mode batch -source tools/vivado_warning_cleanup/verify_message_policy.tcl
```

Expected: exit code 0. No broad downgrade of protected timing, CDC, DSP, BRAM, or IO-buffer warnings.

### Task 2: Fix `switch_in` Top-Level Direction

**Files:**
- Modify: `/home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/hardware/xilinx-k26-som-2023.2/xilinx-k26-som-2023.2.srcs/sources_1/new/design_top.v`
- Backup: `milestones/vivado_warning_cleanup_20260626_180839/design_top.before_switch_in_direction.v`

- [ ] **Step 1: Confirm `switch_in` is not read by top-level RTL**

Run:

```bash
rg -n "switch_in|laser_enable_0" /home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/hardware/xilinx-k26-som-2023.2/xilinx-k26-som-2023.2.srcs/sources_1/new/design_top.v /home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/hardware/xilinx-k26-som-2023.2/xilinx-k26-som-2023.2.srcs/sources_1/bd/project_1/project_1.bd
```

Expected: top-level `switch_in` is connected only to BD output `laser_enable_0`.

- [ ] **Step 2: Change port direction**

Change:

```verilog
       inout           switch_in,
```

to:

```verilog
       output          switch_in,
```

- [ ] **Step 3: Compile top-level RTL**

Run:

```bash
xvlog /home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/hardware/xilinx-k26-som-2023.2/xilinx-k26-som-2023.2.srcs/sources_1/new/design_top.v
```

Expected: no syntax error from the edited top-level file. Missing generated dependencies are acceptable only if `xvlog` cannot locate Vivado project libraries; in that case use Vivado project synthesis/report as the authoritative check.

### Task 3: Document Undecidable Warning Extraction

**Files:**
- Create: `milestones/vivado_warning_cleanup_20260626_180839/warning_repair_decision_points.md`

- [ ] **Step 1: List warnings that need hardware or latency decisions**

Include `Vivado 12-23575`, `TIMING-18`, `TIMING-17`, `TIMING-24`, `TIMING-54`, `TIMING-47`, `TIMING-9`, `TIMING-10`, `DPIP-2`, `DPOP-3`, `DPOP-4`, `DPIR-2`, `REQP-1858`, `NO_ID`, and exact generated `LUTAR-1`.

- [ ] **Step 2: Provide extraction commands**

For each group, include the report command or file search that extracts the decisive evidence.

- [ ] **Step 3: Provide recommendation**

For each group, mark the recommendation as one of: fix now, needs board timing, needs latency budget, needs protocol proof, or waiver only after review.

### Task 4: Refresh Warning Summary

**Files:**
- Update: `milestones/vivado_warning_cleanup_20260626_180839/warning_category_summary.generated.md`

- [ ] **Step 1: Regenerate mechanical summary**

Run:

```bash
python3 -B tools/vivado_warning_cleanup/summarize_warning_categories.py
```

Expected: summary is regenerated and clearly reports whether implementation data came from live run output or fallback snapshots.

- [ ] **Step 2: Inspect changed files**

Run:

```bash
git diff -- tools/vivado_warning_cleanup/message_severity_policy.tcl milestones/vivado_warning_cleanup_20260626_180839/warning_category_summary.generated.md milestones/vivado_warning_cleanup_20260626_180839/warning_repair_decision_points.md docs/superpowers/plans/2026-06-27-vivado-warning-repair.md
```

Expected: only the scoped warning repair artifacts changed in the repository.
