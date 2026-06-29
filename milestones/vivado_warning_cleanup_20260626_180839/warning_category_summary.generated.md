# Generated Vivado Warning Category Summary

Generated: 2026-06-27T19:54:48

Sources:
- `/home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/hardware/xilinx-k26-som-2023.2/xilinx-k26-som-2023.2.runs/synth_1/runme.log`
- `/home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/hardware/xilinx-k26-som-2023.2/xilinx-k26-som-2023.2.runs/impl_margin_perf_explore/runme.log`
- `/home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/hardware/xilinx-k26-som-2023.2/xilinx-k26-som-2023.2.runs/impl_margin_perf_explore/design_top_drc_routed.rpt`
- `/home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/hardware/xilinx-k26-som-2023.2/xilinx-k26-som-2023.2.runs/impl_margin_perf_explore/design_top_methodology_drc_routed.rpt`
- `milestones/vivado_warning_cleanup_20260626_180839/timing_methodology_details/cdc_details.rpt`

## Effective Remaining Count

| Source | Raw count | Remaining/actionable count |
| --- | --- | --- |
| Synthesis log warning lines | 68 | 0 |
| Implementation log warning lines | 171 | 165 |
| Routed DRC rules | 101 | 81 |
| Methodology DRC rules | 163 | 155 |

## Synthesis Log Warning Lines

| ID/rule | Count | Priority | Decision | Classification | Recommended action |
| --- | --- | --- | --- | --- | --- |
| Common 17-1361 | 65 | P2 | handled-info | Duplicate Vivado message-control rule | Keep INFO policy; this is emitted when the same reviewed set_msg_config rule is reapplied. |
| Synth 8-4446 | 3 | P2 | handled-info-scoped | Reviewed unused generated BD placeholders | Keep generated-wrapper line-scoped INFO policy; new unused instances remain warnings. |

## Implementation Log Warning Lines

| ID/rule | Count | Priority | Decision | Classification | Recommended action |
| --- | --- | --- | --- | --- | --- |
| DRC DPOP-4 | 54 | P1 | remaining-fix | DSP MREG multiplier pipeline missing | Add post-multiply pipeline stages or instantiate DSP with MREG/PREG enabled. |
| DRC DPIP-2 | 52 | P1 | remaining-fix | DSP input pipeline missing | Add DSP input pipeline stages where latency permits. |
| DRC DPOP-3 | 48 | P1 | remaining-fix | DSP PREG output pipeline missing | Add DSP output registers or instantiate DSP with PREG enabled. |
| Common 17-1361 | 6 | P2 | handled-info | Duplicate Vivado message-control rule | Keep INFO policy; this is emitted when the same reviewed set_msg_config rule is reapplied. |
| DRC REQP-1769 | 4 | P1 | remaining-fix | BRAM WEA bit advisory | In axi_ada4355_capture spectrum0/1 BRAMs; prefer explicit XPM/simple-dual-port RAM coding so narrow BRAM WEA[1] is inactive. |
| NO_ID | 4 | P1 | remaining-review | Device-name utility warning without message ID | No bracketed Vivado ID for set_msg_config; confirm bitstream/export/hardware support for xck26-sfvc784-2LVI-i or filter externally. |
| DRC REQP-1858 | 2 | P1 | remaining-review | BRAM WRITE_FIRST collision advisory | ADI DMAC store-and-forward RAM; verify no same-address read/write collision, or change generated IP RAM mode/buffering. |
| Vivado 12-23575 | 1 | P0 | remaining-review | Methodology critical-violation summary | Do not hide; use report_methodology details as the root-cause source and clear the underlying P0/P1 rules. |

## Routed DRC Rule Counts

| ID/rule | Count | Priority | Decision | Classification | Recommended action |
| --- | --- | --- | --- | --- | --- |
| DPOP-4 | 27 | P1 | remaining-fix | DSP MREG multiplier pipeline missing | Add post-multiply pipeline stages or instantiate DSP with MREG/PREG enabled. |
| DPIP-2 | 26 | P1 | remaining-fix | DSP input pipeline missing | Add DSP input pipeline stages where latency permits. |
| DPOP-3 | 24 | P1 | remaining-fix | DSP PREG output pipeline missing | Add DSP output registers or instantiate DSP with PREG enabled. |
| AVAL-155 | 8 | P2 | handled-advisory | ADI AD3552 DDS DSP power-control advisory | Keep INFO log policy and DRC Advisory severity; optional power cleanup only. |
| REQP-1701 | 8 | P2 | handled-advisory | ADI AD3552 DDS DSP CED power advisory | Keep INFO log policy and DRC Advisory severity; optional power cleanup only. |
| PDCN-1569 | 3 | P2 | handled-advisory | Generated/debug LUT equation pin not used | Keep DRC Advisory severity for current generated/debug hits. |
| REQP-1769 | 2 | P1 | remaining-fix | BRAM WEA bit advisory | In axi_ada4355_capture spectrum0/1 BRAMs; prefer explicit XPM/simple-dual-port RAM coding so narrow BRAM WEA[1] is inactive. |
| REQP-1858 | 1 | P1 | remaining-review | BRAM WRITE_FIRST collision advisory | ADI DMAC store-and-forward RAM; verify no same-address read/write collision, or change generated IP RAM mode/buffering. |
| RPBF-3 | 1 | P1 | remaining-fix | Incomplete IO buffering on switch_in | Source changed to output for BD laser_enable_0; rerun synth/impl to clear old routed report, or instantiate a real IOBUF if board use is bidirectional. |
| RTSTAT-10 | 1 | P2 | handled-advisory | Generated/debug no-routable-load nets | Keep DRC Advisory severity for current generated/debug hits. |

## Methodology Rule Counts

| ID/rule | Count | Priority | Decision | Classification | Recommended action |
| --- | --- | --- | --- | --- | --- |
| DPIR-2 | 98 | P1 | remaining-fix | DSP inputs driven by async-reset registers | Use synchronous reset or no reset on DSP-adjacent registers where safe. |
| TIMING-18 | 30 | P0 | remaining-fix | Missing IO delays | Prioritize ADA4355 source-synchronous input delays; classify SPI/GPIO as timed or explicit exceptions. |
| TIMING-17 | 8 | P0 | remaining-fix | ADA4355 SPI fabric clock feedback | Remove SPI_CLK-as-fabric-clock architecture or add a temporary scoped generated clock. |
| XDCB-5 | 6 | P2 | handled-advisory | Generated ADI XDC query efficiency warning | Keep methodology Advisory severity; patch generated constraints only if build time matters. |
| TIMING-24 | 5 | P0 | remaining-fix | Broad clock group overrides FIFO pointer max-delay constraints | Replace broad ADA4355 clock group with point-to-point CDC exceptions. |
| TIMING-47 | 4 | P0 | remaining-fix | Max-delay/false-path between synchronous clocks | Same root family as TIMING-54; narrow or remove broad exceptions. |
| TIMING-54 | 4 | P0 | remaining-fix | Scoped max-delay between clk_pl_0 and mmcm_clk_0_s | Trace ADI DMAC constraints and narrow or remove broad between-clock exceptions. |
| LUTAR-1 | 3 | P1 | remaining-review | LUT drives asynchronous reset | Do not globally downgrade; use exact waivers only for reviewed generated/debug hits. |
| CLKC-30 | 1 | P2 | advisory-low | AXI clockgen MMCM feedback BUFG advisory | Already Advisory; generated ADI axi_clkgen feedback BUFG, only fix if power/clock resources matter. |
| CLKC-56 | 1 | P2 | advisory-low | AXI clockgen MMCM has no LOC | Already Advisory; LOC the generated axi_clkgen MMCM only if placement stability becomes a concern. |
| HPDR-1 | 1 | P1 | remaining-fix | switch_in direction mismatch | Source changed to output for BD laser_enable_0; rerun synth/impl to clear old methodology report, or instantiate a real IOBUF if board use is bidirectional. |
| TIMING-10 | 1 | P0 | remaining-fix | Missing ASYNC_REG on synchronizer | Add ASYNC_REG or replace simple sync chains with XPM_CDC. |
| TIMING-9 | 1 | P0 | remaining-fix | Unknown CDC logic | Fix custom CDC with XPM CDC, ASYNC_REG, or handshake/snapshot protocols. |

## CDC Summary

| Rule | Severity | Count | Description |
| --- | --- | --- | --- |
| CDC-1 | Critical | 764 | 1-bit unknown CDC circuitry |
| CDC-2 | Warning | 34 | 1-bit synchronized with missing ASYNC_REG property |
| CDC-3 | Info | 51 | 1-bit synchronized with ASYNC_REG property |
| CDC-5 | Warning | 3 | Multi-bit synchronized with missing ASYNC_REG property |
| CDC-6 | Warning | 5 | Multi-bit synchronized with ASYNC_REG property |
| CDC-7 | Critical | 7 | Asynchronous reset unknown CDC circuitry |
| CDC-9 | Info | 4 | Asynchronous reset synchronized with ASYNC_REG property |
| CDC-10 | Critical | 2 | Combinational logic detected before a synchronizer |
| CDC-13 | Critical | 1284 | 1-bit CDC path on a non-FD primitive |
| CDC-14 | Critical | 1 | Multi-bit CDC path on a non-FD primitive |
| CDC-15 | Warning | 1918 | Clock enable controlled CDC structure detected |
| CDC-17 | Warning | 3 | MUX hold controlled CDC structure detected |

## DSP Warning Concentration

| Rule | Module | Count |
| --- | --- | --- |
| DPIP-2 | ad4170_tec_ctrl_0 | 40 |
| DPIP-2 | axi_pam_image_acq_0 | 12 |
| DPOP-3 | ad4170_tec_ctrl_0 | 32 |
| DPOP-3 | axi_laser_current_ct_0 | 10 |
| DPOP-3 | axi_pam_image_acq_0 | 6 |
| DPOP-4 | ad4170_tec_ctrl_0 | 30 |
| DPOP-4 | axi_laser_current_ct_0 | 18 |
| DPOP-4 | axi_pam_image_acq_0 | 6 |
| DPIR-2 | axi_pam_image_acq_0 | 98 |

## Notes

- Counts from old logs still show warnings that are now configured as INFO; rerun synth/impl to refresh raw log counts.
- The `Remaining/actionable count` treats `remaining-*` and `unclassified` decisions as still needing review or fixes.
- Do not downgrade P0/P1 timing, CDC, DSP, BRAM, or IO-buffer rules without a reviewed root cause and verification report.
