# Lock PID Pipeline Timing Design

Date: 2026-06-27

## Context

Vivado timing debug reports show the main setup failure is a real same-clock path in
`clk_pl_0`, not a cross-clock constraint issue.

Worst path:
- Source: `axi_ada4355_capture.monitor_avg_reg[7]`
- Destination: `axi_laser_current_ctrl.u_laser_current_ctrl_core.req_ch1_code`
- Requirement: `10.000ns`
- Data path delay: `14.860ns`
- Logic levels: `47`
- Logic: `8.306ns`
- Route: `6.554ns`

The path enters `laser_current_ctrl_core.v` through `fb_adc_data` and currently
computes the lock feedback update in one clocked block:

`error -> abs -> integral clamp -> P/I multiply -> PID sum -> range clamp -> step limit -> req_ch1_code`

The accepted behavior change is adding 4 to 6 `clk_pl_0` cycles of latency from
`fb_adc_valid` to the corresponding `req_ch1_code` update.

## Goals

- Break the long lock feedback calculation path in `ST_LOCK_HOLD`.
- Preserve the existing module ports and AXI register map.
- Keep scan, static mode, DAC safety output, and acquire logic behavior unchanged except for the lock feedback latency.
- Flush pending pipeline work on stop, fault, lock lost, or exit from lock hold.
- Update tests so they verify bounded lock-loop latency instead of same-cycle behavior.

## Non-Goals

- Do not change clock frequencies or clocking topology in this change.
- Do not add false-path or multi-cycle constraints to hide this same-clock path.
- Do not rewrite the whole laser current controller FSM.
- Do not change the IDELAYCTRL `clk_pl_1` pulse-width/refclk issue in this change.

## Proposed Architecture

Add a small lock feedback pipeline inside `laser_current_ctrl_core.v`, active only
while the FSM is in `ST_LOCK_HOLD` and a valid feedback sample is accepted.

The existing immediate calculation block will be replaced by staged registers:

1. Stage 0: capture `fb_adc_data`, current `req_ch1_code`, runtime bias, limits, gains, thresholds, and control bits when `fb_adc_valid` is asserted in lock hold.
2. Stage 1: calculate signed raw error, optional polarity inversion, absolute error, and ADC valid-range result.
3. Stage 2: calculate and clamp the next integral value.
4. Stage 3: register P and I multiply results so DSP inference has a register boundary.
5. Stage 4: calculate PID delta, desired code, range clamps, step limit, and saturation flag.
6. Commit stage: update `req_ch1_code`, `lock_last_output_ch1`, `lock_hold_ch1_code`, `lock_error_s`, `lock_integral_s`, `lock_pid_code_s`, locked/loss counters, and saturation/lost state.

The exact stage count may be adjusted within the approved 4-6 cycle budget if
synthesis shows one stage still has excessive logic.

## Pipeline Control

The pipeline will use a valid shift register such as `lock_pipe_valid`.

The pipeline is flushed when any of these is true:
- `resetn` is deasserted.
- `stop_or_disable` is asserted.
- `fault_latched` or `hard_emergency` is active.
- `lock_lost` is already set.
- The FSM leaves `ST_LOCK_HOLD`.

When flushed, no pending sample may update `req_ch1_code` later.

While a sample is in flight, newer `fb_adc_valid` samples may be accepted each
cycle if the pipeline is fully streaming. If that makes control interaction too
complex during implementation, accepting only when Stage 0 is free is acceptable;
the test must document the resulting bounded response.

## Behavioral Details

- `last_fb_adc` should still update immediately on `fb_adc_valid`.
- Feedback timeout behavior remains based on missing `fb_adc_valid`, not pipeline commit.
- ADC invalid/loss detection should take effect through the pipeline commit path or an earlier safe short path, but invalid feedback must not update the DAC request.
- `lock_locked_cnt`, `lock_loss_cnt`, and `lock_sat_cnt` update when the processed sample commits, not when the raw sample arrives.
- `lock_output_ch1_code` continues to report `lock_last_output_ch1`.
- `lock_hold_ch1_code` tracks the committed lock output, so lock-lost hold behavior remains stable.

## Testing

Update `tb_laser_lock_core.sv`:
- Keep the current lock startup, step-limit, locked, lock-lost, and scan-return coverage.
- Replace immediate post-feedback assertions with helper tasks that wait up to 6 cycles for the expected target/output/status.
- Add an assertion that a stop or lock-lost flush prevents a stale in-flight feedback sample from changing `target_ch1_code` later.

Run the lock test before and after RTL changes. The current test may fail after
adding pipeline latency until it is updated to use bounded waits.

## Verification

After simulation passes:

1. Run synthesis and implementation using the existing warning-cleanup flow.
2. Regenerate timing debug reports.
3. Confirm the previous worst path from `monitor_avg_reg[7]` to `req_ch1_code` is no longer the top setup failure.
4. Record WNS/TNS and the new worst path.

## Risks

- The lock loop response will be delayed by 4-6 cycles.
- If PI gains are tuned close to the stability limit, extra latency can slightly reduce phase margin.
- Counter/status timing will move from feedback-arrival time to processed-sample commit time.
- Additional registers may change debug waveform expectations.

These risks are acceptable for the first timing-closure attempt because the
approved latency is small relative to the physical laser-current loop timing.
