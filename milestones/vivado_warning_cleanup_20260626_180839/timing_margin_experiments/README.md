# Timing Margin Experiments

Date: 2026-06-27

## Scope

- Kept the existing `impl_1` run as the baseline.
- Added independent implementation experiment runs in the Vivado project.
- Did not change RTL, XDC timing constraints, or the block design.
- Generated a bitstream for the best experiment run: `impl_margin_perf_explore`.

## Baseline

Run: `impl_1`

Strategy: `Vivado Implementation Defaults`

Status: `write_bitstream Complete!`

Timing:

- WNS: `0.173330 ns`
- TNS: `0.000000 ns`
- WHS: `0.010378 ns`
- THS: `0.000000 ns`
- TPWS: `0.000000 ns`
- Failed nets: `0`

The worst setup path was in `ad4170_tec_ctrl_0`, from the TH10K temperature conversion register into the TEC PID integral DSP input path.

## Experiment 1

Run: `impl_margin_perf_explore`

Strategy:

- Implementation strategy: `Performance_Explore`
- Post-route physical optimization: enabled
- Post-route physical optimization directive: `AggressiveExplore`

Status: `write_bitstream Complete!`

Timing:

- WNS: `0.362377 ns`
- TNS: `0.000000 ns`
- WHS: `0.009412 ns`
- THS: `0.000000 ns`
- TPWS: `0.000000 ns`
- Failed nets: `0`

Report result:

- `All user specified timing constraints are met.`
- Route status: `63164 / 63164` routable nets fully routed, `0` routing errors.
- Worst bus skew slack: `7.379 ns`.

Worst setup path after the experiment:

- Source: `ad4170_tec_ctrl_0/.../th10k_converter/temperature_millic_reg[0]/C`
- Destination: `ad4170_tec_ctrl_0/.../pid_i_term1/DSP_A_B_DATA_INST/A[0]`
- Path group: `clk_pl_0`
- Slack: `0.362 ns`
- Data path delay: `8.824 ns`
- Logic levels: `25`

Worst hold path after the experiment:

- Source: `AXI_AD3552_C1_DMA/.../i_up_axi/up_wdata_int_reg[29]/C`
- Destination: `AXI_AD3552_C1_DMA/.../i_regmap/up_scratch_reg[29]/D`
- Path group: `clk_pl_0`
- Slack: `0.009 ns`
- Data path delay: `0.247 ns`
- Logic levels: `0`

Bitstream:

- `/home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/hardware/xilinx-k26-som-2023.2/xilinx-k26-som-2023.2.runs/impl_margin_perf_explore/design_top.bit`
- `/home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/hardware/xilinx-k26-som-2023.2/xilinx-k26-som-2023.2.runs/impl_margin_perf_explore/design_top.ltx`

## Experiment 2

Run: `impl_margin_perf_holdfix`

Strategy:

- Implementation strategy: `Performance_Explore`
- Post-route physical optimization: enabled
- Post-route physical optimization directive: `ExploreWithAggressiveHoldFix`

Status: `phys_opt_design (Post-Route) Complete!`

Timing:

- WNS: `0.362377 ns`
- TNS: `0.000000 ns`
- WHS: `0.009412 ns`
- THS: `0.000000 ns`
- TPWS: `0.000000 ns`
- Failed nets: `0`

This matched `impl_margin_perf_explore`. Because the design has no hold violations, the aggressive hold-fix directive did not increase the near-zero positive hold slack.

## Conclusion

`Performance_Explore` plus post-route physical optimization raised setup margin from `0.173 ns` to `0.362 ns` without changing RTL. The hold slack did not materially improve; the worst hold path is a short same-clock AXI regmap path and still meets timing with no THS.

Further meaningful setup margin likely requires RTL pipelining around the `ad4170_tec_ctrl_0` TEC PID/DSP chain. That would change control-loop latency, so it should be handled as a separate RTL change with simulation.

Forcing larger hold margin through artificial min-delay or hold uncertainty constraints is possible, but not recommended here because it can trade away setup margin and the current design has zero hold violations.

## Commands

Inspect current run properties:

```sh
vivado -mode batch -source tools/vivado_warning_cleanup/inspect_impl_strategies.tcl
```

Run a timing margin experiment:

```sh
vivado -mode batch -source tools/vivado_warning_cleanup/run_impl_margin_experiment.tcl -tclargs \
  impl_margin_perf_explore Performance_Explore 1 AggressiveExplore
```

Run the hold-fix comparison:

```sh
vivado -mode batch -source tools/vivado_warning_cleanup/run_impl_margin_experiment.tcl -tclargs \
  impl_margin_perf_holdfix Performance_Explore 1 ExploreWithAggressiveHoldFix
```

Generate bitstream for the best experiment run:

```sh
vivado -mode batch -source tools/vivado_warning_cleanup/complete_impl_run_bitstream.tcl -tclargs \
  impl_margin_perf_explore
```

## Archived Artifacts

- `impl_margin_perf_explore/timing_summary.rpt`
- `impl_margin_perf_explore/setup_paths.rpt`
- `impl_margin_perf_explore/hold_paths.rpt`
- `impl_margin_perf_explore/route_status.rpt`
- `impl_margin_perf_explore/design_top_timing_summary_postroute_physopted.rpt`
- `impl_margin_perf_holdfix/timing_summary.rpt`
- `impl_margin_perf_holdfix/setup_paths.rpt`
- `impl_margin_perf_holdfix/hold_paths.rpt`
- `impl_margin_perf_holdfix/route_status.rpt`
- `impl_margin_perf_holdfix/bus_skew.rpt`
