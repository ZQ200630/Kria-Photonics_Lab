# Vivado Warning Repair Decision Points

Date: 2026-06-27

This file separates warnings that can be fixed from code evidence alone from warnings that need board timing, latency budget, or protocol proof before changing RTL/constraints.

## Can Fix From Current Evidence

### `Common 17-1361`

Why it is decidable:
- Current live implementation log has only repeated message-policy warnings.
- The policy is sourced more than once in the same Vivado session.

Fix:
- Register `set_msg_config` rules only once per Tcl session.
- Still reapply DRC/methodology `Advisory` severities after project/run open.

Verification:

```bash
python3 -B tools/vivado_warning_cleanup/guard_message_policy.py
vivado -mode batch -source tools/vivado_warning_cleanup/verify_message_policy.tcl
```

### `HPDR-1` / `RPBF-3` on `switch_in`

Why it is decidable:
- Before this repair, `design_top.v` declared `switch_in` as `inout`.
- `project_1` exposes `laser_enable_0` as an output.
- Top-level RTL connects `.laser_enable_0(switch_in)` and does not read `switch_in`.

Fix:
- Changed top-level `switch_in` from `inout` to `output`.

Verification:

```bash
rg -n "switch_in|laser_enable_0" /home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/hardware/xilinx-k26-som-2023.2/xilinx-k26-som-2023.2.srcs/sources_1/new/design_top.v /home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/hardware/xilinx-k26-som-2023.2/xilinx-k26-som-2023.2.srcs/sources_1/bd/project_1/project_1.bd
```

Remaining evidence needed:
- Rerun synthesis/implementation so routed DRC and methodology reports reflect the edited source instead of the old netlist.

## Needs Board Timing Decision

### `TIMING-18`

Extraction:

```tcl
report_methodology -checks {TIMING-18} -verbose -file timing18_missing_io_delay.rpt
report_timing -from [get_ports {ada4355_d*_p ada4355_fco_p}] -max_paths 20 -file ada4355_input_paths.rpt
report_timing -to [get_ports {SPI_CLK SPI_SDIO AD4170_SPI_CLK AD4170_SPI_MOSI AD4170_SPI_CS}] -max_paths 20 -file spi_output_paths.rpt
```

Needed decision:
- ADA4355 data/FCO/DCO input delays need the ADC datasheet timing plus board skew.
- SPI and slow control pins need a policy: timed with conservative external delay, or explicitly false-pathed as slow/asynchronous control.

Recommendation:
- Fix ADA4355 source-synchronous input delays first.
- Do not silence SPI/GPIO missing-delay warnings until each port is either timed or explicitly excepted.

### `TIMING-17`

Extraction:

```tcl
report_methodology -checks {TIMING-17} -verbose -file timing17_spi_feedback_clock.rpt
report_clocks -file clocks_after_spi_review.rpt
```

Needed decision:
- Whether to keep the current SPI_CLK feedback clocking architecture or replace it.

Recommendation:
- Preferred fix is architectural: move SDIO direction/readback logic into a normal PL clock domain or use the AXI Quad SPI IOBUF path.
- Temporary generated-clock constraints can be used only as an interim debug step.

## Needs Constraint Architecture Review

### `Vivado 12-23575`

Extraction:

```tcl
report_methodology -verbose -file methodology_critical_details.rpt
```

Needed decision:
- None at the message-policy level. This is a summary warning that critical methodology violations exist.

Recommendation:
- Keep visible.
- Fix the underlying methodology rules such as `TIMING-17`, `TIMING-18`, `TIMING-24`, `TIMING-54`, `TIMING-47`, `TIMING-9`, and `TIMING-10`; do not downgrade this summary warning.

### `TIMING-24`

Extraction:

```tcl
report_exceptions -ignored -file exceptions_ignored_after_clock_groups.rpt
report_cdc -details -file cdc_after_clock_groups.rpt
report_bus_skew -file bus_skew_after_clock_groups.rpt
```

Needed decision:
- Which crossings between `clk_pl_0` and `ada4355_dco` are real asynchronous CDCs and which should retain XPM max-delay/bus-skew constraints.

Recommendation:
- Replace broad `set_clock_groups -asynchronous` with point-to-point CDC exceptions.
- Preserve XPM FIFO gray-pointer max-delay and bus-skew constraints.

### `TIMING-54` / `TIMING-47`

Extraction:

```tcl
report_exceptions -file exceptions_dmac_maxdelay.rpt
report_methodology -checks {TIMING-54 TIMING-47} -verbose -file timing54_47_dmac.rpt
```

Needed decision:
- Whether each ADI DMAC source/destination clock pair is truly asynchronous in this design.

Recommendation:
- If clocks are synchronous derivatives, neutralize only the generated through-scoped DMAC `set_max_delay -datapath_only` constraints.
- If they are asynchronous, keep exceptions only around proven CDC structures.

## Needs CDC Protocol Work

### `TIMING-9` / `TIMING-10`

Extraction:

```tcl
report_cdc -details -file cdc_details_after_custom_review.rpt
```

Needed decision:
- Which multi-bit ADA4355 capture configuration fields may change while ADC-domain capture logic is active.

Recommendation:
- Add `ASYNC_REG` or `xpm_cdc_single` for simple one-bit synchronizers.
- Use a request/ack snapshot handshake for multi-bit config such as `sample_window` and mode bits.
- Snapshot at `CAP_IDLE` or frame boundary where possible.

## Needs Latency Budget

### `DPIP-2` / `DPOP-3` / `DPOP-4` / `DPIR-2`

Extraction:

```bash
rg -n "DPIP-2|DPOP-3|DPOP-4|DPIR-2" milestones/vivado_warning_cleanup_20260626_180839/warning_category_summary.generated.md
```

Needed decision:
- Acceptable added latency for TEC control, laser current lock, and PAM geometry calculations.

Recommendation:
- TEC temperature loop is likely safe to pipeline by several PL clock cycles.
- Laser current lock path needs testbench-backed latency changes because feedback is real-time.
- PAM geometry can usually add a prepare state before acquisition starts; also convert async reset near DSP inputs to synchronous reset or no reset.

## Needs Protocol Proof

### `REQP-1858`

Extraction:

```tcl
report_drc -checks {REQP-1858} -verbose -file reqp1858_dmac_collision.rpt
```

Needed decision:
- Whether ADI DMAC store-and-forward RAM can read and write the same address in the same cycle.

Recommendation:
- Keep warning visible until collision exclusion is proven by protocol review or simulation.
- If collision is possible, prefer `READ_FIRST` semantics or extra buffering.

### `REQP-1769`

Extraction:

```tcl
report_drc -checks {REQP-1769} -verbose -file reqp1769_spectrum_bram_wea.rpt
```

Needed decision:
- Whether replacing inferred spectrum BRAMs with explicit XPM RAM is acceptable in this IP version.

Recommendation:
- Replace only `spectrum0` and `spectrum1` with explicit simple-dual-port RAM/XPM memory so write-enable granularity is controlled.

## Keep Visible Or Waive Only Exactly

### `NO_ID`

Extraction:

```bash
rg -n "Unsupported FPGA device name|WARNING::74" /home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/hardware/xilinx-k26-som-2023.2/xilinx-k26-som-2023.2.runs milestones/vivado_warning_cleanup_20260626_180839
```

Needed decision:
- Whether bitstream export, hardware manager programming, and board bring-up accept `xck26-sfvc784-2LVI-i`.

Recommendation:
- Do not hide in Vivado policy because it has no bracketed message ID.
- Filter externally only after programming/export is proven.

### `LUTAR-1`

Extraction:

```tcl
report_methodology -checks {LUTAR-1} -verbose -file lutar1_exact_instances.rpt
```

Needed decision:
- Whether exact generated AXI downsizer/debug instances are accepted.

Recommendation:
- Do not globally downgrade.
- Use exact per-instance waiver only after reviewing the generated instance path.
