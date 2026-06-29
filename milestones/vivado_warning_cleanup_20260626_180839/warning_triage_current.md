# Vivado Warning Triage - Current State

Date: 2026-06-27

Primary sources:
- Synthesis log: `/home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/hardware/xilinx-k26-som-2023.2/xilinx-k26-som-2023.2.runs/synth_1/runme.log`
- Current implementation log: `/home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/hardware/xilinx-k26-som-2023.2/xilinx-k26-som-2023.2.runs/impl_margin_perf_explore/runme.log`
- Current routed DRC: `/home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/hardware/xilinx-k26-som-2023.2/xilinx-k26-som-2023.2.runs/impl_margin_perf_explore/design_top_drc_routed.rpt`
- Current methodology DRC: `/home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/hardware/xilinx-k26-som-2023.2/xilinx-k26-som-2023.2.runs/impl_margin_perf_explore/design_top_methodology_drc_routed.rpt`
- Generated category summary: `warning_category_summary.generated.md`, produced by `tools/vivado_warning_cleanup/summarize_warning_categories.py`

Notes:
- `impl_margin_perf_explore` is the current implementation run in the XPR. The old `impl_1` run directory is not present in the current `.runs` directory.
- Synthesis counts are from the existing `runme.log`. The optional-port message policy was added after that log was produced, so those old lines still appear as `WARNING` until synthesis is rerun.
- Implementation log counts include warnings emitted while reading IP/XDC plus repeated DRC warning lines. DRC and methodology reports are listed separately because they are the authoritative per-rule summaries.
- Current INFO policy covers reviewed generated/noise messages: `Common 17-1361`, `Synth 8-7071`, `Synth 8-7023`, `Synth 8-7129`, `Synth 8-7080`, scoped generated `Synth 8-689`, scoped deliberate `Synth 8-3917`, scoped unused-placeholder `Synth 8-4446`, scoped generated `Opt 31-1131`, scoped AXI Quad SPI `XPM_CDC_GRAY: TCL-1000`, `Power 33-332`, `Timing 38-436`, `DRC XDCB-5`, `DRC PDCN-1569`, `DRC RTSTAT-10`, `DRC AVAL-155`, and `DRC REQP-1701`. The methodology rule `XDCB-5` and routed DRC rules `PDCN-1569`/`RTSTAT-10`/`AVAL-155`/`REQP-1701` are also set to `Advisory`, because Vivado DRC/methodology reports have their own severity scale.
- The current reviewed boundary has no additional broad INFO downgrade candidates. Remaining P0/P1 rules are timing/CDC/DSP/BRAM/IO-interface issues; only exact per-violation waivers should be considered after separate root-cause review.
- Before adding or copying message policy changes, run `python3 -B tools/vivado_warning_cleanup/guard_message_policy.py`. The guard allows only reviewed noise downgrades and blocks broad downgrades of timing, CDC, DSP/BRAM, or IO-buffer warnings that still need design review.
- Known duplicate ADI IP/interface messages are set to `INFO` with exact `-id` plus `-string` rules. This avoids changing IP repository resolution while still leaving any newly introduced duplicate IP as a future warning.
- Empty generated CDC waiver commands were fixed at the source for the current generated XDC files, and the margin implementation flow now reapplies that cleanup before implementation. Old logs still show the previous warnings until a rerun.
- `Vivado_Tcl 4-921` empty CDC waiver warnings are handled by `empty_cdc_waiver_cleanup.tcl`. The cleanup comments out generated AXI data-width converter CDC waiver commands whose `-to` object queries are empty; it leaves the one reviewed non-empty `auto_us` waiver in each `project_1_auto_us_*_clocks.xdc` active.
- To refresh the category table after a new synth/impl run, execute `python3 -B tools/vivado_warning_cleanup/summarize_warning_categories.py` from the repository root. The generated summary is a mechanical view; this triage document remains the reviewed rationale.

## Effective Remaining Warning View

This is the expected warning surface after the current message policy and source cleanup are applied on the next rerun. It is derived from the old logs, so it should be treated as a planning view until synthesis/implementation are rerun.

| Source | Raw warning lines/rules | Already handled | Effective remaining |
| --- | ---: | --- | ---: |
| Synthesis log | 68 lines | Duplicate message-policy reapplication and reviewed unused generated BD placeholders | 0 lines |
| Implementation log | 207 lines | Duplicate message-policy reapplication, empty generated CDC waivers, generated/debug PDCN/RTSTAT DRCs | 81 lines |
| Routed DRC report | 101 rules | `PDCN-1569`/`RTSTAT-10` moved to Advisory in the active policy; `AVAL-155`/`REQP-1701` already Advisory | 81 rules |
| Methodology report | 163 rules | `XDCB-5` moved from Warning to Advisory in the active policy; `CLKC-30`/`CLKC-56` already Advisory | 155 rules |

Effective remaining synthesis warnings:
- None expected after synthesis is rerun with the current message policy.

Effective remaining implementation warning-line groups:
- DSP DRCs: `DPIP-2` 26, `DPOP-4` 27, `DPOP-3` 24.
- BRAM advisories as warnings: `REQP-1769` 2, `REQP-1858` 1.
- Device-name utility warning: 1 no-ID warning.

## Priority

P0: Do not hide. Review/fix first.
- `TIMING-17`, `TIMING-54`, `TIMING-24`, `TIMING-47`: clock/constraint methodology risk.
- `TIMING-18` on real external timing interfaces, especially ADA4355 data clock/data and SPI buses.
- `Timing 38-282`, `Route 35-328`, `Physopt 32-745`: stage-level timing failure summaries. They are not root causes, but they must stay visible until post-route timing and pulse-width reports are clean.

P1: Real design quality or margin work.
- DSP pipeline and async-reset rules: `DPIP-2`, `DPOP-3`, `DPOP-4`, `DPIR-2`.
- `HPDR-1` / `RPBF-3` on `switch_in`.
- `REQP-1858` BRAM collision advisory.

P2: Tool/IP generated noise or hygiene.
- Duplicate Vivado message-control warnings from reapplying the same reviewed policy. Handled with `Common 17-1361` set to `INFO`.
- Duplicate IP repository warnings. Handled with exact `INFO` rules for current known duplicates.
- Empty generated CDC waiver warnings.
- XPM same-clock CDC warnings inside AXI Quad SPI. Handled with a scoped `INFO` rule for `AXI_ADA4355_SPI`.
- ILA/AXI generated SRL optimization warnings. Handled with scoped `INFO` rules for the current ILA/AXI generated paths.
- XDC query efficiency warnings.

## Remaining P0/P1 Deep Dive

These items are intentionally still warnings or critical warnings. They either affect hardware correctness, hide timing paths, or are likely to improve timing/power if fixed.

### `TIMING-17`: ADA4355 SPI fabric clock feedback

Evidence:
- Methodology reports 8 non-clocked sequential cells: `u_ada4355_spi/spi_count_reg[0..5]/C`, `u_ada4355_spi/spi_enable_reg/C`, and `u_ada4355_spi/spi_rd_wr_n_reg/C`.
- `ada4355_spi.v` clocks logic on `posedge spi_clk` and `negedge spi_clk`; `spi_csn_s` is also used as an asynchronous reset.
- `design_top.v` connects AXI Quad SPI output `ada4355_spi_clk_o` to top-level `SPI_CLK`, then feeds that same net back into `u_ada4355_spi.spi_clk`.

Root cause:
- `SPI_CLK` is an output-style/generated SPI signal, not a normal clock-tree net. Using it as a fabric clock leaves those registers outside Vivado's clock model.

Recommended fix:
- Preferred: remove the `SPI_CLK` feedback clocking architecture. Use AXI Quad SPI's intended tri-state/IOBUF structure for 3-wire SDIO, or move the SDIO direction control into a normal PL clock domain with a synchronous SPI state machine.
- Temporary only: add a carefully scoped generated clock on the internal SPI clock net and constrain the SDIO paths. This can reduce the warning, but it preserves a fragile clocking style.
- Do not downgrade this warning.

### `TIMING-24`: broad ADA4355 async clock group overrides CDC constraints

Evidence:
- `Yanglab_Laser.xdc` declares `ada4355_dco` at 2.000 ns and then groups `clk_pl_0` asynchronous to `ada4355_dco` with `set_clock_groups -asynchronous`.
- The active exceptions report expands this to clock group position 46 between `{clk_pl_0 mmcm_clk_0_s mmcm_fb_clk_s}` and `{AXI_ADA4355_adc_clk ada4355_dco ada4355_dco_DIV4_INV}`.
- `exceptions_ignored.rpt` shows XPM FIFO gray-pointer max-delay constraints at positions 100/102/106/108/110 are totally overridden by clock group 46.

Root cause:
- A broad clock-domain false path is masking more specific `set_max_delay -datapath_only` constraints used by CDC/FIFO structures.

Recommended fix:
- Replace the broad `set_clock_groups` with point-to-point exceptions only for crossings that are truly asynchronous and already synchronized.
- Preserve the XPM FIFO gray pointer max-delay/bus-skew style constraints; those are part of making async FIFO pointers safe.
- After changing constraints, rerun `report_exceptions -ignored`, `report_cdc`, `report_bus_skew`, and timing summary before accepting the result.
- Do not downgrade this warning.

### `TIMING-54` / `TIMING-47`: scoped max-delay between synchronous clocks

Evidence:
- Methodology flags constraint positions 55/59/84/88 between `clk_pl_0` and `mmcm_clk_0_s`.
- The exceptions report maps these to ADI DMAC-style scoped constraints around `i_store_and_forward/burst_len_mem_reg*` and `i_request_arb/eot_mem_dest_reg*`.
- The generated IP constraints are duplicated for two DMAC instances:
  - [project_1_axi_dmac_0_0_constr.xdc](/home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/hardware/xilinx-k26-som-2023.2/project_1.gen/sources_1/bd/project_1/ip/project_1_axi_dmac_0_0/project_1_axi_dmac_0_0_constr.xdc:70) sets `set_max_delay -datapath_only` from `$src_clk` through `*i_store_and_forward/burst_len_mem_reg*` to `$dest_clk`; [line 113](/home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/hardware/xilinx-k26-som-2023.2/project_1.gen/sources_1/bd/project_1/ip/project_1_axi_dmac_0_0/project_1_axi_dmac_0_0_constr.xdc:113) does the same through `*i_request_arb/eot_mem_dest_reg*`.
  - [project_1_axi_dmac_0_1_constr.xdc](/home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/hardware/xilinx-k26-som-2023.2/project_1.gen/sources_1/bd/project_1/ip/project_1_axi_dmac_0_1/project_1_axi_dmac_0_1_constr.xdc:70) and [line 113](/home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/hardware/xilinx-k26-som-2023.2/project_1.gen/sources_1/bd/project_1/ip/project_1_axi_dmac_0_1/project_1_axi_dmac_0_1_constr.xdc:113) contain the same two constraints.
- `exceptions.rpt` shows these positions as `max_dpo=8.333` between source-side clocks `{fifo_wr_clk s_axis_aclk m_src_axi_aclk s_axi_aclk}` and destination-side clocks `{fifo_rd_clk m_axis_aclk m_dest_axi_aclk}`. In this design those resolve to clocks Vivado treats as synchronous (`clk_pl_0` and `mmcm_clk_0_s`).

Root cause:
- A `set_max_delay -datapath_only` is applied between clocks that Vivado treats as synchronous. Methodology warns that masking broad synchronous-domain timing can hide real setup/hold failures.

Recommended fix:
- Do not edit generated XDC in-place as the permanent fix; it will be regenerated. Override or patch through a project-local post-generation/pre-implementation hook if a constraint change is accepted.
- First confirm whether each DMAC really uses independent source/destination clocks in this design. If both sides are synchronous derivatives of the same PL clock, remove or neutralize only the two through-scoped max-delay constraints for `burst_len_mem_reg*` and `eot_mem_dest_reg*`, then let normal timing analyze those paths.
- If a DMAC path is truly asynchronous in a future configuration, keep timing exceptions only around the actual CDC synchronizers/FIFOs. Do not use a broad clock-to-clock scoped max delay through an internal data/control register when Vivado sees the clocks as synchronous.
- Verification after any change: rerun `report_exceptions -ignored`, `report_methodology`, `report_timing_summary -delay_type min_max`, and `report_cdc`. The warning is resolved only when positions 55/59/84/88 no longer appear as `TIMING-54`/`TIMING-47` and no new unconstrained/ignored CDC constraints are introduced.
- Do not downgrade until the exception source is rewritten or explicitly accepted with a reviewed waiver.

### `TIMING-18`: missing IO delays by interface class

Observed unconstrained ports:
- Inputs relative to `clk_pl_0`: `AD4170_SPI_MISO`, `SPI_SDIO`, `ad3552r_alertn`, `ad3552r_alertn_b`, `ad3552r_ldacn`, `ad3552r_ldacn_b`, `switch_diag_en`, `switch_fault`.
- Inputs relative to `ada4355_dco`: `ada4355_d0_p`, `ada4355_d1_p`, `ada4355_fco_p`.
- Outputs relative to `clk_pl_0`: `AD4170_SPI_CLK`, `AD4170_SPI_CS`, `AD4170_SPI_MOSI`, `SPI_CLK`, `SPI_SDIO`, `ad3552r_alertn`, `ad3552r_alertn_b`, `ad3552r_ldacn`, `ad3552r_ldacn_b`, `ad3552r_resetn`, `ad3552r_resetn_b`, `ada4355_fsel`, `ada4355_gsel1`, `ada4355_gsel2`, `adn8833_en`, `switch_diag_en`, `switch_fault`, `switch_in`, `trig_ch1`.

Relevant source:
- [Yanglab_Laser.xdc](/home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/hardware/xilinx-k26-som-2023.2/xilinx-k26-som-2023.2.srcs/constrs_1/new/Yanglab_Laser.xdc:120) creates `ada4355_dco` but does not constrain DCO-relative data/FCO input delay.
- [Yanglab_Laser.xdc](/home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/hardware/xilinx-k26-som-2023.2/xilinx-k26-som-2023.2.srcs/constrs_1/new/Yanglab_Laser.xdc:121) currently adds a broad async clock group that also contributes to `TIMING-24`.
- [design_top.v](/home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/hardware/xilinx-k26-som-2023.2/xilinx-k26-som-2023.2.srcs/sources_1/new/design_top.v:42) declares several board-control pins as `inout`, which is why Vivado reports both input and output delay requirements for some pins that are logically output-only in this design.

Recommended fix:
- For ADA4355 data/FCO/DCO, add board/device timing based `set_input_delay` constraints relative to the correct source clock. This is the highest priority IO-delay class.
- For SPI ports, either constrain relative to the generated SPI clock if external setup/hold is meaningful, or document them as slow software-controlled GPIO/SPI with explicit false paths or conservative max delays.
- For slow GPIO/trigger/control pins, choose one policy per signal: timed with a conservative external budget, or explicitly false-pathed as asynchronous/slow control. Do not leave them accidentally unconstrained.
- Fix top-level direction first for pins that are not really bidirectional (`switch_in`, and possibly AD3552 LDAC/ALERT if they are not used bidirectionally). Otherwise the delay list will keep showing both input and output sides.

### `TIMING-9` / `TIMING-10`: CDC report shows real custom CDC cleanup

Evidence:
- `report_cdc` summary includes `CDC-1 Critical 764`, `CDC-2 Warning 34`, `CDC-10 Critical 2`, `CDC-13 Critical 1284`, and `CDC-15 Warning 1918`.
- Some high counts come from ADI/generated IP, but the custom `axi_ada4355_capture_0` paths are actionable:
  - `arm_single_frame_reg` to `arm_single_sync_adc_reg[0]` is a 2-flop sync missing `ASYNC_REG`.
  - `sample_window_reg[30]` drives many ADC-clocked average/divider enables with `CDC-1`.
  - `adc_signed_mode_reg` drives ADC-clocked average/divider data with `CDC-15`.
- In `ada4355_capture_core.v`, several 1-bit controls have 2-flop synchronizers, but `sample_window` and other multi-bit configuration values are used directly in ADC-clocked logic through `effective_sample_window`.

Relevant source:
- [ada4355_capture_core.v](/home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/IPs/ip_repo/axi_ada4355_capture_1_0/hdl/ada4355_capture_core.v:237) has 3-flop toggle synchronizers that should carry `ASYNC_REG` attributes.
- [ada4355_capture_core.v](/home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/IPs/ip_repo/axi_ada4355_capture_1_0/hdl/ada4355_capture_core.v:269) has the simple 2-flop control synchronizers including `arm_single_sync_adc`.
- [ada4355_capture_core.v](/home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/IPs/ip_repo/axi_ada4355_capture_1_0/hdl/ada4355_capture_core.v:338) directly shifts multi-bit config values such as `glitch_threshold`, `lp_shift`, and related settings into ADC-clocked regs without a full handshake.
- [ada4355_capture_core.v](/home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/IPs/ip_repo/axi_ada4355_capture_1_0/hdl/ada4355_capture_core.v:952) uses `effective_sample_window` to drive average/divider state in the ADC clock domain; report_cdc shows this is where many `sample_window_reg[30]` CDC-1 rows fan out.

Recommended fix:
- Add `ASYNC_REG` attributes or replace simple 1-bit control synchronizers with `xpm_cdc_single`.
- For multi-bit configuration such as `sample_window`, use an update handshake/snapshot protocol or `xpm_cdc_handshake` so the ADC domain sees a stable coherent value. A practical implementation is: AXI domain toggles a `cfg_update_req`, ADC domain snapshots all config regs only in `CAP_IDLE` or frame boundary, then toggles `cfg_update_ack`.
- For mode bits such as `adc_signed_mode`, synchronize before use or snapshot at an idle/capture boundary.
- Keep `report_cdc` in the verification loop and do not hide `TIMING-9/10` until custom CDC findings are resolved or explicitly waived with design rationale.

### DSP and BRAM DRCs

DSP warning concentration:
- `DPIP-2`: `ad4170_tec_ctrl_0` has 20 instances, `axi_pam_image_acq_0` has 6.
- `DPOP-4`: `ad4170_tec_ctrl_0` has 15, `axi_laser_current_ct_0` has 9, `axi_pam_image_acq_0` has 3.
- `DPOP-3`: `ad4170_tec_ctrl_0` has 16, `axi_laser_current_ct_0` has 5, `axi_pam_image_acq_0` has 3.
- `DPIR-2`: all 98 current methodology hits are in `axi_pam_image_acq_0`.

Recommended fix:
- First target `ad4170_tec_ctrl_0` for DSP input/output pipelining because it has the largest routed DRC count.
- For `axi_laser_current_ct_0`, pipeline PID/current calculation multiplies with explicit latency review.
- For `axi_pam_image_acq_0`, convert async reset on DSP-adjacent registers to synchronous reset or no reset where safe, then add pipeline stages where latency is acceptable.
- Keep these as warnings; they are not noise if the goal is more timing margin.

Source-level DSP repair targets:
- `ad4170_tec_ctrl_0`: [ad4170_tec_ctrl_v1_0_S00_AXI.v](/home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/IPs/ip_repo/ad4170_tec_ctrl_1_0/hdl/ad4170_tec_ctrl_v1_0_S00_AXI.v:880) does filter multiply/add in `ST_TEMP_APPLY`, and [line 943](/home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/IPs/ip_repo/ad4170_tec_ctrl_1_0/hdl/ad4170_tec_ctrl_v1_0_S00_AXI.v:943) starts single-cycle PID P/I/D multiply states. Split each multiply into registered `*_mul` and `*_apply` states so DSP input/MREG/PREG can be inferred. This adds a few PL clock cycles to a slow SPI/temperature loop, which is likely acceptable but should be verified against the TEC control update cadence.
- `ad4170_tec_ctrl_0` TH10K converter: [ad4170_th10k_convert.v](/home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/IPs/ip_repo/ad4170_tec_ctrl_1_0/hdl/ad4170_th10k_convert.v:244) computes `offset_reg * 1000` and immediately feeds division prep. Add a registered multiply result state before `STATE_DIV_HI`.
- `axi_laser_current_ct_0`: [laser_current_ctrl_core.v](/home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/IPs/ip_repo/axi_laser_current_ctrl_1_0/hdl/laser_current_ctrl_core.v:1008) computes `lock_pipe_s3_p_calc_s` and `lock_pipe_s3_i_calc_s`, while [line 474](/home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/IPs/ip_repo/axi_laser_current_ctrl_1_0/hdl/laser_current_ctrl_core.v:474) consumes shifted products in combinational clamp logic. Insert a registered stage for shifted P/I terms and move clamp/step-limit to the next valid stage.
- `axi_laser_current_ct_0` combined current check: [laser_current_ctrl_core.v](/home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/IPs/ip_repo/axi_laser_current_ctrl_1_0/hdl/laser_current_ctrl_core.v:640) multiplies both gain coefficients into `current_calc` and compares immediately. Register product terms or the total before `combined_current_violation`; document that over-current detection latency increases by one cycle.
- `axi_pam_image_acq_0`: [pam_image_acq_controller_core.v](/home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/IPs/ip_repo/axi_pam_image_acq_1_0/hdl/pam_image_acq_controller_core.v:185) computes `x_center_calc`/`y_center_calc`, and [line 207](/home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/IPs/ip_repo/axi_pam_image_acq_1_0/hdl/pam_image_acq_controller_core.v:207) computes `x_offset_last`. [Line 214](/home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/IPs/ip_repo/axi_pam_image_acq_1_0/hdl/pam_image_acq_controller_core.v:214) uses async reset, causing all 98 `DPIR-2` hits. Convert this controller to synchronous reset or make DSP-adjacent geometry regs no-reset/sync-reset, then add a `ST_PREP_GEOMETRY` stage after start to register geometry products before use.

BRAM warning recommendations:
- `REQP-1769` is in `axi_ada4355_capture_0` spectrum BRAMs: `spectrum0_reg_bram_14` and `spectrum1_reg_bram_14`. The source is the inferred dual-clock arrays `spectrum0` and `spectrum1` in `ada4355_capture_core.v`. Preferred fix is to replace the inference with an explicit simple-dual-port XPM memory or equivalent RAM wrapper so the write enable granularity is controlled and the narrow RAMB18E2 slice does not drive `WEA[1]` active. Do not downgrade globally; a new BRAM write-enable issue should remain visible.
- `REQP-1858` is in generated ADI DMAC store-and-forward RAM: `AXI_ADA4355_DMA/inst/i_transfer/i_request_arb/i_store_and_forward/i_mem/m_ram_reg`. Verify by simulation or DMA protocol review that read and write ports cannot hit the same address in the same cycle. If collision cannot be excluded, change the generated IP RAM mode/buffering; `READ_FIRST` is the safe collision semantics, while `NO_CHANGE` is the power-oriented option only when collisions are excluded.

Source-level BRAM repair targets:
- [ada4355_capture_core.v](/home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/IPs/ip_repo/axi_ada4355_capture_1_0/hdl/ada4355_capture_core.v:130) infers `spectrum0`/`spectrum1` as block RAM, and [line 1138](/home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/IPs/ip_repo/axi_ada4355_capture_1_0/hdl/ada4355_capture_core.v:1138) performs the ADC-domain writes. Replace just these two arrays with an explicit simple-dual-port memory wrapper or `xpm_memory_sdpram` so write width, byte enables, read latency, and clock domains are explicit.
- Keep `temp_samples` separate unless a future DRC points at it; current `REQP-1769` only names `spectrum0_reg_bram_14` and `spectrum1_reg_bram_14`.

Low-count advisory/tool items:
- `NO_ID` is `WARNING::74 - Unsupported FPGA device name 'xck26-sfvc784-2LVI-i'`. It has no bracketed Vivado message ID, so it cannot be handled with `set_msg_config -id`. Keep it visible until bitstream export/programming and hardware bring-up confirm this device string is accepted end-to-end; after that, handle it only as an external log filter if desired.
- `AVAL-155` and `REQP-1701` are already emitted as `INFO` in the implementation log and `Advisory` in the routed DRC report. All current hits are ADI AD3552 DDS scale DSP48E2 instances under `AXI_AD3552_C1` and `AXI_AD3552_C2`; they are power/control-pin hygiene, not current warning-count blockers.
- `CLKC-30` and `CLKC-56` are already `Advisory` in methodology. Both point to generated `axi_clkgen_0`: feedback BUFG on the MMCM and no MMCM LOC when driven from PS `PL_CLK_0_BUFG`. Fix only if clock resource/power or placement repeatability becomes a problem.

### `HPDR-1` / `RPBF-3`: `switch_in` direction mismatch

Evidence:
- Before the repair pass, `design_top.v` declared `switch_in` as `inout`.
- `project_1` declares `laser_enable_0` as an output and `design_top.v` connects `.laser_enable_0(switch_in)`.
- Routed DRC `RPBF-3` says `switch_in` expects both input and output buffering but both directions are not present.

Recommended fix:
- `switch_in` has been changed to `output` in the source because the top-level does not read it and it is driven by BD output `laser_enable_0`.
- Rerun synthesis/implementation to clear old routed DRC/methodology reports.
- If the board really needs bidirectional behavior, instantiate a real IOBUF and connect both input/output/tri-state paths.
- Do not downgrade; this is a top-level interface declaration mismatch, not tool noise.

### `LUTAR-1`: generated/debug async reset warning

Evidence:
- Current report has 3 hits in generated `ps8_0_axi_periph/s00_couplers/auto_ds` FIFO logic.
- Earlier runs also showed debug-hub hits; those should be handled by removing debug cores in release builds rather than by broad rule downgrade.

Recommended fix:
- For release builds, remove debug hub/ILA if debug access is not needed.
- For generated AXI downsizer FIFO logic, prefer IP regeneration or acceptance as vendor-generated implementation detail.
- Do not globally downgrade `LUTAR-1`, because the same rule would also catch a real user RTL LUT-glitch async reset. If these exact generated instances are accepted, use a reviewed per-violation waiver rather than a broad severity policy.

### Handled synthesis unused-instance warnings

The last effective synthesis warning after the earlier policy was `Synth 8-4446` on:
- `dual_ramp_generator_0`
- `trigger_gen_fixed_0`
- `xlconstant_one_5`

Recommended fix:
- Current policy: set these three generated-wrapper locations to `INFO` with exact `-id` plus `-string` rules. Vivado's warning text does not include the instance name, so the scope is intentionally limited to the current generated wrapper line fragments.
- Future cleanup: remove unused BD blocks or wire them into the intended debug/control path if these placeholders are no longer useful.
- Do not globally downgrade `Synth 8-4446`; a new unused user RTL or BD instance should still appear as a warning.

## Synthesis Log Warnings

| ID | Count | Classification | Evidence | Recommended action |
| --- | ---: | --- | --- | --- |
| `Common 17-1361` | 65 | Handled duplicate message policy rules | Current `synth_1/runme.log` shows repeated equivalent `set_msg_config` rules replacing existing rules | Set to `INFO`; this is policy reapplication noise, not a design warning. |
| `Synth 8-4446` | 3 | Handled reviewed unused generated BD placeholders | `dual_ramp_generator_0`, `trigger_gen_fixed_0`, `xlconstant_one_5` have no connected outputs in the generated BD wrapper | Set to `INFO` only for the current generated wrapper line fragments; new unused instances remain warnings. |

## Implementation Log Warnings

| ID | Count | Classification | Evidence | Recommended action |
| --- | ---: | --- | --- | --- |
| `Common 17-1361` | 65 | Handled duplicate message policy rules | Existing `runme.log` still shows repeated equivalent policy rules from the previous run | Set to `INFO`; rerun implementation/report flow to refresh the raw log count. |
| `Vivado_Tcl 4-921` | 61 | Generated empty CDC waiver commands | `project_1_auto_ds_0`, `project_1_auto_us_0/1/2` `*_clocks.xdc` | Fixed in flow, not hidden globally: patched/commented 61 generated empty `create_waiver` commands and install the cleanup as the implementation `INIT_DESIGN` pre-hook. |
| `DRC DPIP-2` | 26 | DSP input pipeline missing | `ad4170_tec_ctrl_0`, `axi_pam_image_acq_0` DSP inputs | Add pipeline stages before DSP inputs where latency permits. Best margin improvement, but requires RTL/latency review. |
| `DRC DPOP-4` | 27 | DSP multiplier output pipeline missing (`MREG=0`) | `ad4170_tec_ctrl_0`, `axi_laser_current_ct_0`, `axi_pam_image_acq_0` | Add one or two post-multiply pipeline stages or instantiate DSP with `MREG/PREG=1`. Requires latency-aware RTL change. |
| `DRC DPOP-3` | 24 | DSP output pipeline missing (`PREG=0`) | Same DSP-heavy blocks | Add output register stages after multiplies/adders. Good timing/power improvement. |
| `DRC REQP-1769` | 2 | BRAM WEA bit advisory | `axi_ada4355_capture` `spectrum0/1_reg_bram_14` | Replace inferred `spectrum0/1` RAMs with explicit XPM/simple-dual-port RAM coding so narrow BRAM write enables do not drive `WEA[1]` active. |
| `DRC REQP-1858` | 1 | BRAM WRITE_FIRST collision advisory | `AXI_ADA4355_DMA` store-and-forward RAM | Verify no same-address read/write collision in sim/protocol review. If collision is possible, use `READ_FIRST`; use `NO_CHANGE` only when collision is excluded and power matters. |
| `NO_ID` | 1 | Device-name utility warning | `WARNING::74 - Unsupported FPGA device name 'xck26-sfvc784-2LVI-i'` | No bracketed Vivado ID, so `set_msg_config` cannot target it. Keep until export/programming/hardware confirms the device string is acceptable; filter externally only after that. |

## Routed DRC Rules

| Rule | Count | Classification | Recommended action |
| --- | ---: | --- | --- |
| `DPIP-2` | 26 | DSP input pipeline | RTL pipeline stages in TEC/image acquisition datapaths. |
| `DPOP-3` | 24 | DSP PREG output pipeline | Add output registers or DSP attributes. |
| `DPOP-4` | 27 | DSP MREG output pipeline | Add post-multiply pipeline stages. |
| `PDCN-1569` | 3 | Handled generated/debug/IP LUT pin/equation mismatch | Set to `Advisory` in routed DRC reports and `INFO` in logs. |
| `REQP-1769` | 2 | BRAM write-enable width | `axi_ada4355_capture_0` `spectrum0/1_reg_bram_14`; use explicit RAM/XPM coding to control `WEA[1]`. |
| `REQP-1858` | 1 | BRAM write-first collision | ADI DMAC store-and-forward RAM; prove no same-address collision or change RAM mode/buffering. |
| `RPBF-3` | 1 | Incomplete IO buffering on `switch_in` | Source changed to `output`; rerun synth/impl to clear the old routed report, or instantiate IOBUF if board use is bidirectional. |
| `RTSTAT-10` | 1 | Handled generated/debug no-routable-load nets | Set to `Advisory` in routed DRC reports and `INFO` in logs. |
| `AVAL-155` | 8 | Handled AD3552 DDS DSP control-pin advisory | Set to `INFO` in logs and kept `Advisory` in routed DRC reports; optional power cleanup inside ADI DDS scale DSPs. |
| `REQP-1701` | 8 | Handled AD3552 DDS DSP `CED` advisory | Set to `INFO` in logs and kept `Advisory` in routed DRC reports; optional power cleanup inside ADI DDS scale DSPs. |

## Methodology DRC Rules

| Rule | Count | Severity | Classification | Recommended action |
| --- | ---: | --- | --- | --- |
| `TIMING-17` | 8 | Critical Warning | `u_ada4355_spi` sequential cells clocked by `SPI_CLK` not reached by timing clock | Do not hide. `ada4355_spi.v` clocks regs on `posedge/negedge spi_clk`, and top feeds it from AXI Quad SPI output `SPI_CLK`. Prefer removing this fabric-clock feedback by using proper SPI/IOBUF tri-state structure; alternative is a carefully scoped generated-clock constraint, but that is less robust. |
| `TIMING-54` | 4 | Critical Warning | Scoped max-delay datapath-only between `clk_pl_0` and `mmcm_clk_0_s` | See deep dive. Trace ADI DMAC constraints at positions 55/59/84/88 and replace broad between-clock exceptions with narrow point-to-point CDC constraints if they are intentional CDC paths. |
| `DPIR-2` | 98 | Warning | DSP inputs driven by async-reset registers | Convert reset style on DSP-adjacent registers to synchronous reset or no reset where safe. Improves DSP packing and timing. |
| `HPDR-1` | 1 | Warning | Old report sees `switch_in` as INOUT connected to BD output `laser_enable_0` | Source changed to `output`; rerun synth/impl to clear the old methodology report. If board use is bidirectional, replace with a real IOBUF. Do not downgrade. |
| `LUTAR-1` | 3 | Warning | LUT drives async reset in generated AXI downsizer FIFO logic | Do not globally downgrade. Use reviewed per-violation waivers only if these exact generated instances are formally accepted. |
| `TIMING-9` | 1 | Warning | Unknown CDC logic | `report_cdc` shows custom `axi_ada4355_capture_0` CDC issues. Use XPM CDC, ASYNC_REG attributes, or snapshot/handshake protocols for remaining custom CDC. |
| `TIMING-10` | 1 | Warning | Missing `ASYNC_REG` on synchronizer | Add `ASYNC_REG` attributes to `arm_single_sync_adc`-style synchronizer flops or replace with XPM_CDC. |
| `TIMING-18` | 30 | Warning | Missing IO delays | See deep dive. Prioritize ADA4355 source-synchronous data/FCO/DCO delays; then classify SPI and slow GPIO/control as timed or explicit false-path/max-delay. |
| `TIMING-24` | 5 | Warning | Max-delay datapath-only overridden by async grouping/false path | Replace the broad `clk_pl_0`/`ada4355_dco` clock group with point-to-point exceptions so XPM FIFO gray-pointer max-delay constraints are not overridden. |
| `TIMING-47` | 4 | Warning | Max-delay/false-path between synchronous clocks | Same root family as `TIMING-54`; do not hide. |
| `XDCB-5` | 6 | Warning | Inefficient generated XDC pin queries in ADI DMAC constraints | Log message set to `INFO`; methodology rule set to `Advisory`. Runtime hygiene only. Patch generated/ADI constraints only if build time matters. |
| `CLKC-30` | 1 | Advisory | Generated `axi_clkgen_0` MMCM feedback BUFG advisory | Already Advisory; fix only if power/clock resources matter. |
| `CLKC-56` | 1 | Advisory | Generated `axi_clkgen_0` MMCM has no LOC while driven by PS `PL_CLK_0_BUFG` | Already Advisory; LOC MMCM only if placement repeatability becomes a problem. |

## Suggested Iteration Order

1. Keep current message policy for reviewed noise: optional BD/IP ports, exact duplicate ADI IP/interface messages, generated AXI width adaptations, deliberate static top-level selects, generated ILA/AXI SRL retiming, AXI Quad SPI same-clock XPM CDC, power-estimate caveat, bus-skew reminder, and reviewed generated/debug DRCs.
2. Keep exact-string `INFO` rules for current duplicate ADI IP/interface messages; avoid broad `IP_Flow 19-1663/19-4830` downgrades.
3. Keep the empty-CDC-waiver cleanup in implementation/report flows so `Vivado_Tcl 4-921` stops reappearing after rerun.
4. Fix `TIMING-17` on `ada4355_spi` architecture before hiding any methodology critical warnings.
5. Replace the broad ADA4355 `set_clock_groups` with narrower CDC exceptions so `TIMING-24` goes away without masking FIFO pointer constraints.
6. Trace and narrow the ADI DMAC constraints causing `TIMING-54/47`.
7. Review `TIMING-18` IO ports by interface class: ADA4355 data, SPI/control, slow GPIO/trigger.
8. Fix custom `axi_ada4355_capture_0` CDC before waiving `TIMING-9/10`.
9. If more timing margin is desired, pipeline DSP paths in `ad4170_tec_ctrl_0`, `axi_laser_current_ct_0`, and `axi_pam_image_acq_0`.
10. After P0/P1 items are resolved or consciously accepted, only downgrade additional tool/IP noise with exact strings or scoped path fragments; avoid broad TIMING/CDC/DSP/BRAM downgrades.
