# Lock PID Pipeline Timing Closure

Date: 2026-06-27

## Scope

- Updated `axi_laser_current_ctrl_1_0/hdl/laser_current_ctrl_core.v`.
- Updated `axi_laser_current_ctrl_1_0/tb/tb_laser_lock_core.sv`.
- Added a 5-stage one-sample-at-a-time pipeline for lock PI feedback updates.
- Added testbench coverage for latency, stop/scan flush, invalid ADC overlap, feedback timeout overlap, external fault overlap, and restart/start-command overlap.

## Verification

Run from:

`/home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/IPs/ip_repo/axi_laser_current_ctrl_1_0`

Commands:

```sh
xvlog -sv hdl/laser_current_ctrl_core.v tb/tb_laser_lock_core.sv
xelab tb_laser_lock_core -s tb_laser_lock_core
xsim tb_laser_lock_core -runall
xvlog -sv hdl/laser_current_ctrl_core.v hdl/axi_laser_current_ctrl_v1_0_S00_AXI.v hdl/axi_laser_current_ctrl_v1_0.v tb/tb_laser_lock_core.sv
```

Result:

- `tb_laser_lock_core PASS`

Vivado implementation:

```sh
vivado -mode batch -source /home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/tools/run_synth_impl_reports.tcl
```

Result:

- `synth_1`: `synth_design Complete!`
- `impl_1`: `write_bitstream Complete!`

## Timing Result

Baseline setup timing from `timing_debug_latest/timing_summary_debug.rpt`:

- WNS: `-5.028 ns`
- TNS: `-683.037 ns`
- Failing setup endpoints: `246`

After lock PID pipeline from `timing_debug_after_lock_pipeline/timing_summary_debug.rpt`:

- WNS: `+0.397 ns`
- TNS: `0.000 ns`
- Failing setup endpoints: `0`

Remaining violation class:

- Pulse-width checks still fail on `clk_pl_1` / `IDELAYCTRL/REFCLK` and related ADI/debug clocked primitives.
- This is not a lock PID setup path; handle it as the next timing-closure item.

## Timing 38-282 Follow-Up

`[Timing 38-282] The design failed to meet the timing requirements` remains because Vivado reports any failing timing class, not only setup timing.

Current evidence:

- Setup timing is clean: WNS `+0.397 ns`, TNS `0.000 ns`, failing setup endpoints `0`.
- The remaining failing clock group is `clk_pl_1`.
- `clk_pl_1` is 200 MHz / 5 ns and is connected from `K26_SOM/pl_clk1` to `AXI_ADA4355/delay_clk`.
- The failing primitive check is `IDELAYCTRL/REFCLK` with required max period `3.333 ns`, actual `5.000 ns`, slack `-1.667 ns`.
- Generated AXI_ADA4355 netlist also shows `IDELAYE3 .REFCLK_FREQUENCY(200.000000)` with `.SIM_DEVICE("ULTRASCALE_PLUS")`.
- Vivado 2023.2 `IDELAYE3` unisim requires `REFCLK_FREQUENCY` from `300.0` to `2667.0` when `SIM_DEVICE != "ULTRASCALE"`.

Likely root cause:

- The ADI SERDES delay reference is configured as 200 MHz while this UltraScale+ primitive configuration expects at least 300 MHz.

Recommended next fix:

- Change the AXI_ADA4355 delay reference clock consistently to 300 MHz.
- Update the `IDELAYE3` `REFCLK_FREQUENCY` path to 300 MHz as well; changing only the PS clock or only the Verilog parameter would leave the design internally inconsistent.
- Regenerate BD/IP output products, rerun synth/impl, and confirm `report_pulse_width` clears before treating `[Timing 38-282]` as resolved.

Resolution:

- Completed in `../axi_ada4355_delay_clk_300/`.
- New timing reports show `clk_pl_1` at `3.333 ns` / `300.030 MHz`, all user timing constraints met, and `IDELAYCTRL/REFCLK` max-period slack at `0.000 ns` instead of `-1.667 ns`.

## Archived Artifacts

- `hdl/laser_current_ctrl_core.v`
- `tb/tb_laser_lock_core.sv`
- `reports/timing_debug_after_lock_pipeline/`
- `reports/post_impl_timing_summary.rpt`
