# AXI_ADA4355 Delay Clock 300 MHz

Date: 2026-06-27

## Scope

- Changed PS `PL1` from 200 MHz to 300 MHz in the Vivado block design.
- Updated `AXI_ADA4355/delay_clk` generated clock metadata to `299997009` Hz.
- Updated ADI `ad_serdes_in.v` so UltraScale and UltraScale+ default `REFCLK_FREQUENCY` to 300 MHz while 7 series remains 200 MHz.
- Regenerated BD/IP output products and reran synth/impl through bitstream.

## Root Cause

The remaining `[Timing 38-282]` warning after the lock PID pipeline fix was not a setup violation. It came from pulse-width timing on `clk_pl_1` feeding `AXI_ADA4355` `IDELAYCTRL/REFCLK`.

Before this change:

- `clk_pl_1`: 200 MHz / 5.000 ns
- `IDELAYCTRL/REFCLK` max period requirement: 3.333 ns
- Actual max period: 5.000 ns
- Slack: `-1.667 ns`

ADI's guidance is 200 MHz for 7 series and 300 MHz for UltraScale. The K26 target is UltraScale+, so the delay reference clock and IDELAYE3 `REFCLK_FREQUENCY` needed to move to 300 MHz together.

## Verification

Clock/config consistency:

```sh
vivado -mode batch -source tools/vivado_warning_cleanup/check_axi_ada4355_delay_clk_300.tcl
```

Result:

- `PL1_FREQ_MHZ=300`
- `PL1_ACTUAL_MHZ=299.997009`
- `AXI_ADA4355_DELAY_FREQ_HZ=299997009`
- `CHECK_OK AXI_ADA4355 delay clock project files are configured for 300 MHz`

Vivado implementation:

```sh
vivado -mode batch -source /home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/tools/run_synth_impl_reports.tcl
```

Result:

- `synth_1`: `synth_design Complete!`
- `impl_1`: `write_bitstream Complete!`

Timing debug reports:

```sh
vivado -mode batch -source tools/vivado_warning_cleanup/timing_debug_reports.tcl -tclargs \
  /home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/hardware/xilinx-k26-som-2023.2/xilinx-k26-som-2023.2.xpr \
  /home/qian/Portable_System_Project/Butterfly_Laser_Driver/milestones/vivado_warning_cleanup_20260626_180839/timing_debug_after_axi_ada4355_delay_clk_300
```

Result from `timing_summary_debug.rpt`:

- `All user specified timing constraints are met.`
- WNS: `0.173 ns`
- TNS: `0.000 ns`
- Failing setup endpoints: `0`
- WPWS: `0.000 ns`
- TPWS: `0.000 ns`
- TPWS failing endpoints: `0`
- `clk_pl_1`: `3.333 ns`, `300.030 MHz`
- `clk_pl_1` intra-clock WNS: `2.793 ns`

Result from `pulse_width_paths.rpt`:

- `IDELAYCTRL/REFCLK` Min Period slack: `2.083 ns`
- `IDELAYCTRL/REFCLK` Max Period slack: `0.000 ns`
- `IDELAYCTRL/REFCLK` Low Pulse Width slack: `1.103 ns`
- `IDELAYCTRL/REFCLK` High Pulse Width slack: `1.104 ns`

`failing_setup_paths_short.rpt` reports `No timing paths found.`

`[Timing 38-282]` is not present in the new timing summary outputs.

## Notes

- One stale Vivado IP cache sim netlist still contains `REFCLK_FREQUENCY(200.x)`. It is under the generated `.cache/ip` tree and was not deleted. The regenerated project files, generated XDC, AXI_ADA4355 wrappers, XCI/XML metadata, and post-implementation timing all use 300 MHz.
- `ip_status.rpt` shows `project_1_axi_ada4355_0_0` as `Up-to-date`. Other unrelated ADI IP status lines are outside this fix.

## Archived Artifacts

- `ad_serdes_in.after_300.v`
- `timing_summary_debug.rpt`
- `timing_summary_impl_after_300.rpt`
- `pulse_width_paths.rpt`
- `ip_status.rpt`
