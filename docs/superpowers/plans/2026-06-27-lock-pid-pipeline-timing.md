# Lock PID Pipeline Timing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a bounded-latency pipeline to the laser lock PI feedback path so the `clk_pl_0` timing path from ADA4355 monitor feedback into CH1 request calculation is broken into shorter stages.

**Architecture:** Modify only the lock feedback calculation inside `laser_current_ctrl_core.v`. Use a one-sample-at-a-time pipeline because the integral accumulator is stateful; accept a new feedback sample only when no previous lock sample is in flight. Update the existing lock testbench to expect a 4-6 cycle response instead of immediate feedback response.

**Tech Stack:** Verilog/SystemVerilog RTL, Vivado Simulator (`xvlog`, `xelab`, `xsim`), Vivado batch synthesis/implementation scripts.

---

## File Structure

- Modify: `/home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/IPs/ip_repo/axi_laser_current_ctrl_1_0/hdl/laser_current_ctrl_core.v`
  - Adds lock feedback pipeline registers and flush control.
  - Replaces the immediate PI calculation in `ST_LOCK_HOLD`.
- Modify: `/home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/IPs/ip_repo/axi_laser_current_ctrl_1_0/tb/tb_laser_lock_core.sv`
  - Adds bounded-latency wait helpers.
  - Updates lock response assertions to require 4-6 cycle latency.
  - Adds stale in-flight sample flush coverage.
- Existing verification scripts:
  - `/home/qian/Portable_System_Project/Butterfly_Laser_Driver/tools/vivado_warning_cleanup/run_synth_impl_reports.tcl`
  - `/home/qian/Portable_System_Project/Butterfly_Laser_Driver/tools/vivado_warning_cleanup/timing_debug_reports.tcl`

### Task 1: Make The Lock Test Express Pipeline Latency

**Files:**
- Modify: `/home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/IPs/ip_repo/axi_laser_current_ctrl_1_0/tb/tb_laser_lock_core.sv`

- [ ] **Step 1: Add pipeline latency constants and helper tasks**

Insert after the existing `feedback` task:

```systemverilog
  localparam integer LOCK_PIPE_MIN_LATENCY_CYCLES = 4;
  localparam integer LOCK_PIPE_MAX_LATENCY_CYCLES = 6;

  task feedback_sample;
    input [15:0] adc_code;
    begin
      fb_adc_data = adc_code;
      fb_adc_valid = 1'b1;
      tick();
      fb_adc_valid = 1'b0;
    end
  endtask

  task expect_target_after_lock_latency;
    input [15:0] old_code;
    input [15:0] expected_code;
    integer i;
    reg seen;
    begin
      for (i = 1; i < LOCK_PIPE_MIN_LATENCY_CYCLES; i = i + 1) begin
        tick();
        if (target_ch1_code !== old_code) begin
          $fatal(1,
                 "Lock feedback updated too early at cycle %0d: target=%0d old=%0d expected=%0d",
                 i, target_ch1_code, old_code, expected_code);
        end
      end

      seen = 1'b0;
      for (i = LOCK_PIPE_MIN_LATENCY_CYCLES; i <= LOCK_PIPE_MAX_LATENCY_CYCLES; i = i + 1) begin
        tick();
        if (target_ch1_code === expected_code) begin
          seen = 1'b1;
          i = LOCK_PIPE_MAX_LATENCY_CYCLES + 1;
        end
      end

      if (!seen) begin
        $fatal(1,
               "Lock feedback did not update within %0d cycles: target=%0d expected=%0d",
               LOCK_PIPE_MAX_LATENCY_CYCLES, target_ch1_code, expected_code);
      end
    end
  endtask

  task wait_for_lock_status_bit;
    input integer bit_index;
    input integer max_cycles;
    integer i;
    reg seen;
    begin
      seen = 1'b0;
      for (i = 0; i < max_cycles; i = i + 1) begin
        tick();
        if (lock_status[bit_index]) begin
          seen = 1'b1;
          i = max_cycles;
        end
      end
      if (!seen) begin
        $fatal(1,
               "lock_status[%0d] was not asserted within %0d cycles, lock_status=0x%08x",
               bit_index, max_cycles, lock_status);
      end
    end
  endtask

  task expect_no_stale_target;
    input [15:0] stale_code;
    input integer cycles;
    integer i;
    begin
      for (i = 0; i < cycles; i = i + 1) begin
        tick();
        if (target_ch1_code === stale_code) begin
          $fatal(1,
                 "Stale in-flight feedback committed after flush at cycle %0d: target=%0d",
                 i, target_ch1_code);
        end
      end
    end
  endtask
```

- [ ] **Step 2: Replace the immediate step-limit assertion**

Replace:

```systemverilog
    feedback(16'd9990);
    repeat (8) tick();
    if (target_ch1_code !== 16'd20004) begin
      $fatal(1, "MODE_LOCK must step CH1 by lock_max_step toward PI output, got target %0d", target_ch1_code);
    end
```

with:

```systemverilog
    feedback_sample(16'd9990);
    expect_target_after_lock_latency(16'd20000, 16'd20004);
```

- [ ] **Step 3: Replace locked/lost immediate checks with bounded waits**

Replace:

```systemverilog
    feedback(16'd10000);
    feedback(16'd10000);
    repeat (4) tick();
    if (!lock_status[2]) begin
      $fatal(1, "MODE_LOCK must assert locked after consecutive small errors, lock_status=0x%08x", lock_status);
    end

    feedback(16'd9500);
    feedback(16'd9500);
    feedback(16'd9500);
    feedback(16'd9500);
    repeat (4) tick();
    if (!lock_status[4]) begin
      $fatal(1, "MODE_LOCK must latch lock_lost after consecutive large errors, lock_status=0x%08x", lock_status);
    end
```

with:

```systemverilog
    feedback_sample(16'd10000);
    wait_for_lock_status_bit(2, 12);
    feedback_sample(16'd10000);
    wait_for_lock_status_bit(2, 12);

    feedback_sample(16'd9500);
    wait_for_lock_status_bit(4, 12);
    feedback_sample(16'd9500);
    wait_for_lock_status_bit(4, 12);
    feedback_sample(16'd9500);
    wait_for_lock_status_bit(4, 12);
    feedback_sample(16'd9500);
    wait_for_lock_status_bit(4, 12);
```

- [ ] **Step 4: Add stale in-flight flush coverage before scan restart**

Insert before `pulse_start_scan();`:

```systemverilog
    fault_clear_pulse = 1'b1;
    tick();
    fault_clear_pulse = 1'b0;
    repeat (2) tick();

    pulse_start_lock();
    repeat (20) tick();
    feedback_sample(16'd9990);
    ctrl_stop_pulse = 1'b1;
    tick();
    ctrl_stop_pulse = 1'b0;
    expect_no_stale_target(16'd20004, LOCK_PIPE_MAX_LATENCY_CYCLES + 4);
```

- [ ] **Step 5: Run the updated test and verify it fails before RTL changes**

Run:

```bash
cd /home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/IPs/ip_repo/axi_laser_current_ctrl_1_0
xvlog -sv hdl/laser_current_ctrl_core.v tb/tb_laser_lock_core.sv
xelab tb_laser_lock_core -s tb_laser_lock_core
xsim tb_laser_lock_core -runall
```

Expected before RTL pipeline:

```text
Lock feedback updated too early
```

- [ ] **Step 6: Commit the failing test**

```bash
git add /home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/IPs/ip_repo/axi_laser_current_ctrl_1_0/tb/tb_laser_lock_core.sv
git commit -m "test: require bounded lock PID pipeline latency" -- /home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/IPs/ip_repo/axi_laser_current_ctrl_1_0/tb/tb_laser_lock_core.sv
```

If `/home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013` is not a git repository, copy the diff into the milestone and continue without committing the external IP file.

### Task 2: Add Lock Pipeline State And Flush Control

**Files:**
- Modify: `/home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/IPs/ip_repo/axi_laser_current_ctrl_1_0/hdl/laser_current_ctrl_core.v`

- [ ] **Step 1: Add pipeline declarations near existing lock registers**

Insert after `reg        lock_next_saturated;`:

```verilog
    localparam integer LOCK_PIPE_STAGES = 5;

    reg [LOCK_PIPE_STAGES-1:0] lock_pipe_valid;

    reg [15:0] lock_pipe_req_ch1_s0;
    reg [15:0] lock_pipe_fb_adc_s0;
    reg [15:0] lock_pipe_target_adc_s0;
    reg        lock_pipe_polarity_invert_s0;
    reg [31:0] lock_pipe_kp_q16_s0;
    reg [31:0] lock_pipe_ki_q16_s0;
    reg [31:0] lock_pipe_integral_limit_s0;
    reg [15:0] lock_pipe_runtime_bias_s0;
    reg [15:0] lock_pipe_lock_min_s0;
    reg [15:0] lock_pipe_lock_max_s0;
    reg [15:0] lock_pipe_ch1_min_s0;
    reg [15:0] lock_pipe_ch1_max_s0;
    reg [15:0] lock_pipe_max_step_s0;
    reg [15:0] lock_pipe_locked_threshold_s0;
    reg [15:0] lock_pipe_loss_threshold_s0;
    reg [15:0] lock_pipe_adc_min_valid_s0;
    reg [15:0] lock_pipe_adc_max_valid_s0;
    reg [15:0] lock_pipe_locked_count_eff_s0;
    reg [15:0] lock_pipe_loss_count_eff_s0;
    reg [31:0] lock_pipe_sat_count_eff_s0;
    reg [31:0] lock_pipe_sat_count_cfg_s0;

    reg signed [31:0] lock_pipe_error_s1;
    reg [31:0] lock_pipe_abs_error_s1;
    reg lock_pipe_adc_invalid_s1;
    reg [15:0] lock_pipe_req_ch1_s1;
    reg [31:0] lock_pipe_kp_q16_s1;
    reg [31:0] lock_pipe_ki_q16_s1;
    reg [31:0] lock_pipe_integral_limit_s1;
    reg [15:0] lock_pipe_runtime_bias_s1;
    reg [15:0] lock_pipe_lock_min_s1;
    reg [15:0] lock_pipe_lock_max_s1;
    reg [15:0] lock_pipe_ch1_min_s1;
    reg [15:0] lock_pipe_ch1_max_s1;
    reg [15:0] lock_pipe_max_step_s1;
    reg [15:0] lock_pipe_locked_threshold_s1;
    reg [15:0] lock_pipe_loss_threshold_s1;
    reg [15:0] lock_pipe_locked_count_eff_s1;
    reg [15:0] lock_pipe_loss_count_eff_s1;
    reg [31:0] lock_pipe_sat_count_eff_s1;
    reg [31:0] lock_pipe_sat_count_cfg_s1;

    reg signed [31:0] lock_pipe_error_s2;
    reg [31:0] lock_pipe_abs_error_s2;
    reg lock_pipe_adc_invalid_s2;
    reg signed [31:0] lock_pipe_integral_next_s2;
    reg [15:0] lock_pipe_req_ch1_s2;
    reg [31:0] lock_pipe_kp_q16_s2;
    reg [31:0] lock_pipe_ki_q16_s2;
    reg [15:0] lock_pipe_runtime_bias_s2;
    reg [15:0] lock_pipe_lock_min_s2;
    reg [15:0] lock_pipe_lock_max_s2;
    reg [15:0] lock_pipe_ch1_min_s2;
    reg [15:0] lock_pipe_ch1_max_s2;
    reg [15:0] lock_pipe_max_step_s2;
    reg [15:0] lock_pipe_locked_threshold_s2;
    reg [15:0] lock_pipe_loss_threshold_s2;
    reg [15:0] lock_pipe_locked_count_eff_s2;
    reg [15:0] lock_pipe_loss_count_eff_s2;
    reg [31:0] lock_pipe_sat_count_eff_s2;
    reg [31:0] lock_pipe_sat_count_cfg_s2;

    reg signed [31:0] lock_pipe_error_s3;
    reg [31:0] lock_pipe_abs_error_s3;
    reg lock_pipe_adc_invalid_s3;
    reg signed [31:0] lock_pipe_integral_next_s3;
    reg signed [63:0] lock_pipe_p_calc_s3;
    reg signed [63:0] lock_pipe_i_calc_s3;
    reg [15:0] lock_pipe_req_ch1_s3;
    reg [15:0] lock_pipe_runtime_bias_s3;
    reg [15:0] lock_pipe_lock_min_s3;
    reg [15:0] lock_pipe_lock_max_s3;
    reg [15:0] lock_pipe_ch1_min_s3;
    reg [15:0] lock_pipe_ch1_max_s3;
    reg [15:0] lock_pipe_max_step_s3;
    reg [15:0] lock_pipe_locked_threshold_s3;
    reg [15:0] lock_pipe_loss_threshold_s3;
    reg [15:0] lock_pipe_locked_count_eff_s3;
    reg [15:0] lock_pipe_loss_count_eff_s3;
    reg [31:0] lock_pipe_sat_count_eff_s3;
    reg [31:0] lock_pipe_sat_count_cfg_s3;

    reg signed [31:0] lock_pipe_error_s4;
    reg [31:0] lock_pipe_abs_error_s4;
    reg lock_pipe_adc_invalid_s4;
    reg signed [31:0] lock_pipe_integral_next_s4;
    reg signed [31:0] lock_pipe_pid_delta_s4;
    reg signed [31:0] lock_pipe_next_code_s4;
    reg lock_pipe_saturated_s4;
    reg [15:0] lock_pipe_locked_threshold_s4;
    reg [15:0] lock_pipe_loss_threshold_s4;
    reg [15:0] lock_pipe_locked_count_eff_s4;
    reg [15:0] lock_pipe_loss_count_eff_s4;
    reg [31:0] lock_pipe_sat_count_eff_s4;
    reg [31:0] lock_pipe_sat_count_cfg_s4;

    reg signed [31:0] lock_pipe_pid_delta_calc;
    reg signed [31:0] lock_pipe_next_code_calc;
    reg lock_pipe_saturated_calc;
```

- [ ] **Step 2: Add combinational Stage 4 clamp calculation**

Insert after the helper functions and before the main clocked `always` block:

```verilog
    always @* begin
        lock_pipe_pid_delta_calc = $signed(lock_pipe_p_calc_s3[47:16]) +
                                   $signed(lock_pipe_i_calc_s3[47:16]);
        lock_pipe_next_code_calc = clamp_signed32(
            $signed({16'd0, lock_pipe_runtime_bias_s3}) + lock_pipe_pid_delta_calc,
            32'sd0,
            32'sd65535
        );
        lock_pipe_saturated_calc = 1'b0;

        if ((lock_pipe_lock_min_s3 != 16'd0) || (lock_pipe_lock_max_s3 != 16'd0)) begin
            if (lock_pipe_next_code_calc < $signed({16'd0, lock_pipe_lock_min_s3})) begin
                lock_pipe_next_code_calc = $signed({16'd0, lock_pipe_lock_min_s3});
                lock_pipe_saturated_calc = 1'b1;
            end else if (lock_pipe_next_code_calc > $signed({16'd0, lock_pipe_lock_max_s3})) begin
                lock_pipe_next_code_calc = $signed({16'd0, lock_pipe_lock_max_s3});
                lock_pipe_saturated_calc = 1'b1;
            end
        end

        if ((lock_pipe_ch1_min_s3 != 16'd0) || (lock_pipe_ch1_max_s3 != 16'd0)) begin
            if (lock_pipe_next_code_calc < $signed({16'd0, lock_pipe_ch1_min_s3})) begin
                lock_pipe_next_code_calc = $signed({16'd0, lock_pipe_ch1_min_s3});
                lock_pipe_saturated_calc = 1'b1;
            end else if (lock_pipe_next_code_calc > $signed({16'd0, lock_pipe_ch1_max_s3})) begin
                lock_pipe_next_code_calc = $signed({16'd0, lock_pipe_ch1_max_s3});
                lock_pipe_saturated_calc = 1'b1;
            end
        end

        if (lock_pipe_max_step_s3 != 16'd0) begin
            if (lock_pipe_next_code_calc >
                ($signed({16'd0, lock_pipe_req_ch1_s3}) + $signed({16'd0, lock_pipe_max_step_s3}))) begin
                lock_pipe_next_code_calc = $signed({16'd0, lock_pipe_req_ch1_s3}) +
                                           $signed({16'd0, lock_pipe_max_step_s3});
            end else if (lock_pipe_next_code_calc <
                         ($signed({16'd0, lock_pipe_req_ch1_s3}) - $signed({16'd0, lock_pipe_max_step_s3}))) begin
                lock_pipe_next_code_calc = $signed({16'd0, lock_pipe_req_ch1_s3}) -
                                           $signed({16'd0, lock_pipe_max_step_s3});
            end
        end
    end
```

- [ ] **Step 3: Add pipeline control wires**

Insert after `assign actual_matches_safe_target = ...`:

```verilog
    wire lock_pipe_busy;
    wire lock_pipe_flush;
    wire lock_pipe_accept;
    wire lock_adc_invalid_now;

    assign lock_pipe_busy = |lock_pipe_valid;
    assign lock_pipe_flush = stop_or_disable || fault_latched || hard_emergency ||
                             lock_lost || (state != ST_LOCK_HOLD);
    assign lock_adc_invalid_now = ((lock_adc_min_valid != 16'd0) || (lock_adc_max_valid != 16'd0)) &&
                                  ((fb_adc_data < lock_adc_min_valid) ||
                                   (fb_adc_data > lock_adc_max_valid));
    assign lock_pipe_accept = (state == ST_LOCK_HOLD) && lock_control_enabled &&
                              fb_adc_valid && !lock_adc_invalid_now &&
                              !lock_pipe_busy && !lock_pipe_flush;
```

- [ ] **Step 4: Reset all pipeline registers**

Inside the reset branch, after `lock_next_saturated <= 1'b0;`, add:

```verilog
            lock_pipe_valid <= {LOCK_PIPE_STAGES{1'b0}};
            lock_pipe_req_ch1_s0 <= 16'd0;
            lock_pipe_fb_adc_s0 <= 16'd0;
            lock_pipe_target_adc_s0 <= 16'd0;
            lock_pipe_polarity_invert_s0 <= 1'b0;
            lock_pipe_kp_q16_s0 <= 32'd0;
            lock_pipe_ki_q16_s0 <= 32'd0;
            lock_pipe_integral_limit_s0 <= 32'd0;
            lock_pipe_runtime_bias_s0 <= 16'd0;
            lock_pipe_lock_min_s0 <= 16'd0;
            lock_pipe_lock_max_s0 <= 16'd0;
            lock_pipe_ch1_min_s0 <= 16'd0;
            lock_pipe_ch1_max_s0 <= 16'd0;
            lock_pipe_max_step_s0 <= 16'd0;
            lock_pipe_locked_threshold_s0 <= 16'd0;
            lock_pipe_loss_threshold_s0 <= 16'd0;
            lock_pipe_adc_min_valid_s0 <= 16'd0;
            lock_pipe_adc_max_valid_s0 <= 16'd0;
            lock_pipe_locked_count_eff_s0 <= 16'd0;
            lock_pipe_loss_count_eff_s0 <= 16'd0;
            lock_pipe_sat_count_eff_s0 <= 32'd0;
            lock_pipe_sat_count_cfg_s0 <= 32'd0;

            lock_pipe_error_s1 <= 32'sd0;
            lock_pipe_abs_error_s1 <= 32'd0;
            lock_pipe_adc_invalid_s1 <= 1'b0;
            lock_pipe_req_ch1_s1 <= 16'd0;
            lock_pipe_kp_q16_s1 <= 32'd0;
            lock_pipe_ki_q16_s1 <= 32'd0;
            lock_pipe_integral_limit_s1 <= 32'd0;
            lock_pipe_runtime_bias_s1 <= 16'd0;
            lock_pipe_lock_min_s1 <= 16'd0;
            lock_pipe_lock_max_s1 <= 16'd0;
            lock_pipe_ch1_min_s1 <= 16'd0;
            lock_pipe_ch1_max_s1 <= 16'd0;
            lock_pipe_max_step_s1 <= 16'd0;
            lock_pipe_locked_threshold_s1 <= 16'd0;
            lock_pipe_loss_threshold_s1 <= 16'd0;
            lock_pipe_locked_count_eff_s1 <= 16'd0;
            lock_pipe_loss_count_eff_s1 <= 16'd0;
            lock_pipe_sat_count_eff_s1 <= 32'd0;
            lock_pipe_sat_count_cfg_s1 <= 32'd0;

            lock_pipe_error_s2 <= 32'sd0;
            lock_pipe_abs_error_s2 <= 32'd0;
            lock_pipe_adc_invalid_s2 <= 1'b0;
            lock_pipe_integral_next_s2 <= 32'sd0;
            lock_pipe_req_ch1_s2 <= 16'd0;
            lock_pipe_kp_q16_s2 <= 32'd0;
            lock_pipe_ki_q16_s2 <= 32'd0;
            lock_pipe_runtime_bias_s2 <= 16'd0;
            lock_pipe_lock_min_s2 <= 16'd0;
            lock_pipe_lock_max_s2 <= 16'd0;
            lock_pipe_ch1_min_s2 <= 16'd0;
            lock_pipe_ch1_max_s2 <= 16'd0;
            lock_pipe_max_step_s2 <= 16'd0;
            lock_pipe_locked_threshold_s2 <= 16'd0;
            lock_pipe_loss_threshold_s2 <= 16'd0;
            lock_pipe_locked_count_eff_s2 <= 16'd0;
            lock_pipe_loss_count_eff_s2 <= 16'd0;
            lock_pipe_sat_count_eff_s2 <= 32'd0;
            lock_pipe_sat_count_cfg_s2 <= 32'd0;

            lock_pipe_error_s3 <= 32'sd0;
            lock_pipe_abs_error_s3 <= 32'd0;
            lock_pipe_adc_invalid_s3 <= 1'b0;
            lock_pipe_integral_next_s3 <= 32'sd0;
            lock_pipe_p_calc_s3 <= 64'sd0;
            lock_pipe_i_calc_s3 <= 64'sd0;
            lock_pipe_req_ch1_s3 <= 16'd0;
            lock_pipe_runtime_bias_s3 <= 16'd0;
            lock_pipe_lock_min_s3 <= 16'd0;
            lock_pipe_lock_max_s3 <= 16'd0;
            lock_pipe_ch1_min_s3 <= 16'd0;
            lock_pipe_ch1_max_s3 <= 16'd0;
            lock_pipe_max_step_s3 <= 16'd0;
            lock_pipe_locked_threshold_s3 <= 16'd0;
            lock_pipe_loss_threshold_s3 <= 16'd0;
            lock_pipe_locked_count_eff_s3 <= 16'd0;
            lock_pipe_loss_count_eff_s3 <= 16'd0;
            lock_pipe_sat_count_eff_s3 <= 32'd0;
            lock_pipe_sat_count_cfg_s3 <= 32'd0;

            lock_pipe_error_s4 <= 32'sd0;
            lock_pipe_abs_error_s4 <= 32'd0;
            lock_pipe_adc_invalid_s4 <= 1'b0;
            lock_pipe_integral_next_s4 <= 32'sd0;
            lock_pipe_pid_delta_s4 <= 32'sd0;
            lock_pipe_next_code_s4 <= 32'sd0;
            lock_pipe_saturated_s4 <= 1'b0;
            lock_pipe_locked_threshold_s4 <= 16'd0;
            lock_pipe_loss_threshold_s4 <= 16'd0;
            lock_pipe_locked_count_eff_s4 <= 16'd0;
            lock_pipe_loss_count_eff_s4 <= 16'd0;
            lock_pipe_sat_count_eff_s4 <= 32'd0;
            lock_pipe_sat_count_cfg_s4 <= 32'd0;
```

### Task 3: Implement The Lock Feedback Pipeline

**Files:**
- Modify: `/home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/IPs/ip_repo/axi_laser_current_ctrl_1_0/hdl/laser_current_ctrl_core.v`

- [ ] **Step 1: Add pipeline stage advancement near the top of the non-reset branch**

Insert after the one-clock pulse defaults:

```verilog
            if (lock_pipe_flush) begin
                lock_pipe_valid <= {LOCK_PIPE_STAGES{1'b0}};
            end else begin
                lock_pipe_valid <= {lock_pipe_valid[LOCK_PIPE_STAGES-2:0], lock_pipe_accept};

                if (lock_pipe_accept) begin
                    lock_pipe_req_ch1_s0 <= req_ch1_code;
                    lock_pipe_fb_adc_s0 <= fb_adc_data;
                    lock_pipe_target_adc_s0 <= lock_target_adc;
                    lock_pipe_polarity_invert_s0 <= lock_polarity_invert;
                    lock_pipe_kp_q16_s0 <= lock_kp_q16;
                    lock_pipe_ki_q16_s0 <= lock_ki_q16;
                    lock_pipe_integral_limit_s0 <= lock_integral_limit;
                    lock_pipe_runtime_bias_s0 <= lock_runtime_bias_ch1_code;
                    lock_pipe_lock_min_s0 <= lock_ch1_min_code;
                    lock_pipe_lock_max_s0 <= lock_ch1_max_code;
                    lock_pipe_ch1_min_s0 <= ch1_min_code;
                    lock_pipe_ch1_max_s0 <= ch1_max_code;
                    lock_pipe_max_step_s0 <= lock_max_step;
                    lock_pipe_locked_threshold_s0 <= lock_locked_threshold;
                    lock_pipe_loss_threshold_s0 <= lock_loss_threshold;
                    lock_pipe_adc_min_valid_s0 <= lock_adc_min_valid;
                    lock_pipe_adc_max_valid_s0 <= lock_adc_max_valid;
                    lock_pipe_locked_count_eff_s0 <= lock_locked_count_eff;
                    lock_pipe_loss_count_eff_s0 <= lock_loss_count_eff;
                    lock_pipe_sat_count_eff_s0 <= lock_sat_count_eff;
                    lock_pipe_sat_count_cfg_s0 <= lock_sat_count_cfg;
                end
```

- [ ] **Step 2: Add Stage 1 error and ADC validity calculation**

Continue inside the same `else` block:

```verilog
                lock_pipe_error_s1 <= $signed({16'd0, lock_pipe_target_adc_s0}) -
                                      $signed({16'd0, lock_pipe_fb_adc_s0});
                if (lock_pipe_polarity_invert_s0) begin
                    lock_pipe_error_s1 <= -($signed({16'd0, lock_pipe_target_adc_s0}) -
                                            $signed({16'd0, lock_pipe_fb_adc_s0}));
                end
                lock_pipe_abs_error_s1 <= abs_signed32(
                    lock_pipe_polarity_invert_s0 ?
                    -($signed({16'd0, lock_pipe_target_adc_s0}) - $signed({16'd0, lock_pipe_fb_adc_s0})) :
                     ($signed({16'd0, lock_pipe_target_adc_s0}) - $signed({16'd0, lock_pipe_fb_adc_s0}))
                );
                lock_pipe_adc_invalid_s1 <= ((lock_pipe_adc_min_valid_s0 != 16'd0) ||
                                             (lock_pipe_adc_max_valid_s0 != 16'd0)) &&
                                            ((lock_pipe_fb_adc_s0 < lock_pipe_adc_min_valid_s0) ||
                                             (lock_pipe_fb_adc_s0 > lock_pipe_adc_max_valid_s0));
                lock_pipe_req_ch1_s1 <= lock_pipe_req_ch1_s0;
                lock_pipe_kp_q16_s1 <= lock_pipe_kp_q16_s0;
                lock_pipe_ki_q16_s1 <= lock_pipe_ki_q16_s0;
                lock_pipe_integral_limit_s1 <= lock_pipe_integral_limit_s0;
                lock_pipe_runtime_bias_s1 <= lock_pipe_runtime_bias_s0;
                lock_pipe_lock_min_s1 <= lock_pipe_lock_min_s0;
                lock_pipe_lock_max_s1 <= lock_pipe_lock_max_s0;
                lock_pipe_ch1_min_s1 <= lock_pipe_ch1_min_s0;
                lock_pipe_ch1_max_s1 <= lock_pipe_ch1_max_s0;
                lock_pipe_max_step_s1 <= lock_pipe_max_step_s0;
                lock_pipe_locked_threshold_s1 <= lock_pipe_locked_threshold_s0;
                lock_pipe_loss_threshold_s1 <= lock_pipe_loss_threshold_s0;
                lock_pipe_locked_count_eff_s1 <= lock_pipe_locked_count_eff_s0;
                lock_pipe_loss_count_eff_s1 <= lock_pipe_loss_count_eff_s0;
                lock_pipe_sat_count_eff_s1 <= lock_pipe_sat_count_eff_s0;
                lock_pipe_sat_count_cfg_s1 <= lock_pipe_sat_count_cfg_s0;
```

- [ ] **Step 3: Add Stage 2 integral calculation**

Continue inside the same `else` block:

```verilog
                lock_pipe_error_s2 <= lock_pipe_error_s1;
                lock_pipe_abs_error_s2 <= lock_pipe_abs_error_s1;
                lock_pipe_adc_invalid_s2 <= lock_pipe_adc_invalid_s1;
                lock_pipe_integral_next_s2 <= clamp_signed32(
                    lock_integral_s + lock_pipe_error_s1,
                    -$signed(lock_pipe_integral_limit_s1),
                    $signed(lock_pipe_integral_limit_s1)
                );
                lock_pipe_req_ch1_s2 <= lock_pipe_req_ch1_s1;
                lock_pipe_kp_q16_s2 <= lock_pipe_kp_q16_s1;
                lock_pipe_ki_q16_s2 <= lock_pipe_ki_q16_s1;
                lock_pipe_runtime_bias_s2 <= lock_pipe_runtime_bias_s1;
                lock_pipe_lock_min_s2 <= lock_pipe_lock_min_s1;
                lock_pipe_lock_max_s2 <= lock_pipe_lock_max_s1;
                lock_pipe_ch1_min_s2 <= lock_pipe_ch1_min_s1;
                lock_pipe_ch1_max_s2 <= lock_pipe_ch1_max_s1;
                lock_pipe_max_step_s2 <= lock_pipe_max_step_s1;
                lock_pipe_locked_threshold_s2 <= lock_pipe_locked_threshold_s1;
                lock_pipe_loss_threshold_s2 <= lock_pipe_loss_threshold_s1;
                lock_pipe_locked_count_eff_s2 <= lock_pipe_locked_count_eff_s1;
                lock_pipe_loss_count_eff_s2 <= lock_pipe_loss_count_eff_s1;
                lock_pipe_sat_count_eff_s2 <= lock_pipe_sat_count_eff_s1;
                lock_pipe_sat_count_cfg_s2 <= lock_pipe_sat_count_cfg_s1;
```

- [ ] **Step 4: Add Stage 3 registered DSP multipliers**

Continue inside the same `else` block:

```verilog
                lock_pipe_error_s3 <= lock_pipe_error_s2;
                lock_pipe_abs_error_s3 <= lock_pipe_abs_error_s2;
                lock_pipe_adc_invalid_s3 <= lock_pipe_adc_invalid_s2;
                lock_pipe_integral_next_s3 <= lock_pipe_integral_next_s2;
                lock_pipe_p_calc_s3 <= $signed(lock_pipe_kp_q16_s2) * lock_pipe_error_s2;
                lock_pipe_i_calc_s3 <= $signed(lock_pipe_ki_q16_s2) * lock_pipe_integral_next_s2;
                lock_pipe_req_ch1_s3 <= lock_pipe_req_ch1_s2;
                lock_pipe_runtime_bias_s3 <= lock_pipe_runtime_bias_s2;
                lock_pipe_lock_min_s3 <= lock_pipe_lock_min_s2;
                lock_pipe_lock_max_s3 <= lock_pipe_lock_max_s2;
                lock_pipe_ch1_min_s3 <= lock_pipe_ch1_min_s2;
                lock_pipe_ch1_max_s3 <= lock_pipe_ch1_max_s2;
                lock_pipe_max_step_s3 <= lock_pipe_max_step_s2;
                lock_pipe_locked_threshold_s3 <= lock_pipe_locked_threshold_s2;
                lock_pipe_loss_threshold_s3 <= lock_pipe_loss_threshold_s2;
                lock_pipe_locked_count_eff_s3 <= lock_pipe_locked_count_eff_s2;
                lock_pipe_loss_count_eff_s3 <= lock_pipe_loss_count_eff_s2;
                lock_pipe_sat_count_eff_s3 <= lock_pipe_sat_count_eff_s2;
                lock_pipe_sat_count_cfg_s3 <= lock_pipe_sat_count_cfg_s2;
```

- [ ] **Step 5: Add Stage 4 registered clamp and step-limit results**

Continue inside the same `else` block:

```verilog
                lock_pipe_error_s4 <= lock_pipe_error_s3;
                lock_pipe_abs_error_s4 <= lock_pipe_abs_error_s3;
                lock_pipe_adc_invalid_s4 <= lock_pipe_adc_invalid_s3;
                lock_pipe_integral_next_s4 <= lock_pipe_integral_next_s3;
                lock_pipe_pid_delta_s4 <= lock_pipe_pid_delta_calc;
                lock_pipe_next_code_s4 <= lock_pipe_next_code_calc;
                lock_pipe_saturated_s4 <= lock_pipe_saturated_calc;
                lock_pipe_locked_threshold_s4 <= lock_pipe_locked_threshold_s3;
                lock_pipe_loss_threshold_s4 <= lock_pipe_loss_threshold_s3;
                lock_pipe_locked_count_eff_s4 <= lock_pipe_locked_count_eff_s3;
                lock_pipe_loss_count_eff_s4 <= lock_pipe_loss_count_eff_s3;
                lock_pipe_sat_count_eff_s4 <= lock_pipe_sat_count_eff_s3;
                lock_pipe_sat_count_cfg_s4 <= lock_pipe_sat_count_cfg_s3;
            end
```

- [ ] **Step 6: Run syntax compile after adding registers/stages**

Run:

```bash
cd /home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/IPs/ip_repo/axi_laser_current_ctrl_1_0
xvlog -sv hdl/laser_current_ctrl_core.v tb/tb_laser_lock_core.sv
```

Expected: `xvlog` exits 0 with no syntax errors.

### Task 4: Replace Immediate ST_LOCK_HOLD PI Commit With Pipeline Commit

**Files:**
- Modify: `/home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/IPs/ip_repo/axi_laser_current_ctrl_1_0/hdl/laser_current_ctrl_core.v`

- [ ] **Step 1: Remove direct PI calculation from `ST_LOCK_HOLD`**

In `ST_LOCK_HOLD`, replace the `else begin` branch that starts with:

```verilog
                                lock_fb_timeout_cnt <= 32'd0;
                                lock_fb_timeout     <= 1'b0;

                                lock_raw_error_s = $signed({16'd0, lock_target_adc}) -
                                                   $signed({16'd0, fb_adc_data});
```

and ends after the saturation counter update block with:

```verilog
                                lock_fb_timeout_cnt <= 32'd0;
                                lock_fb_timeout     <= 1'b0;
```

The existing immediate invalid-ADC branch remains as a short safety path. The pipeline commit block in the next step owns PI updates, lock counters, saturation counters, and loss-threshold decisions for valid feedback samples.

- [ ] **Step 2: Add pipeline commit block after the FSM case statement**

Insert after the `case (state)` block but before the enclosing non-reset branch ends:

```verilog
            if (!lock_pipe_flush && lock_pipe_valid[LOCK_PIPE_STAGES-1]) begin
                if (lock_pipe_adc_invalid_s4) begin
                    lock_adc_invalid     <= 1'b1;
                    lock_lost            <= 1'b1;
                    lock_control_enabled <= 1'b0;
                    lock_active          <= 1'b0;
                    lock_hold_ch1_code   <= req_ch1_code;
                    lock_loss_cnt        <= lock_pipe_loss_count_eff_s4;
                end else begin
                    lock_next_ch1_code   = lock_pipe_next_code_s4[15:0];
                    req_ch1_code         <= lock_next_ch1_code;
                    lock_last_output_ch1 <= lock_next_ch1_code;
                    lock_hold_ch1_code   <= lock_next_ch1_code;
                    lock_error_s         <= lock_pipe_error_s4;
                    lock_integral_s      <= lock_pipe_integral_next_s4;
                    lock_pid_code_s      <= lock_pipe_pid_delta_s4;

                    if (lock_pipe_abs_error_s4 <= {16'd0, lock_pipe_locked_threshold_s4}) begin
                        lock_loss_cnt <= 16'd0;
                        if (lock_locked_cnt + 16'd1 >= lock_pipe_locked_count_eff_s4) begin
                            lock_locked_cnt <= lock_pipe_locked_count_eff_s4;
                            lock_locked     <= 1'b1;
                        end else begin
                            lock_locked_cnt <= lock_locked_cnt + 16'd1;
                        end
                    end else begin
                        lock_locked_cnt <= 16'd0;
                        lock_locked     <= 1'b0;
                        if ((lock_pipe_loss_threshold_s4 != 16'd0) &&
                            (lock_pipe_abs_error_s4 > {16'd0, lock_pipe_loss_threshold_s4})) begin
                            if (lock_loss_cnt + 16'd1 >= lock_pipe_loss_count_eff_s4) begin
                                lock_loss_cnt        <= lock_pipe_loss_count_eff_s4;
                                lock_lost            <= 1'b1;
                                lock_control_enabled <= 1'b0;
                                lock_active          <= 1'b0;
                                lock_hold_ch1_code   <= lock_next_ch1_code;
                            end else begin
                                lock_loss_cnt <= lock_loss_cnt + 16'd1;
                            end
                        end else begin
                            lock_loss_cnt <= 16'd0;
                        end
                    end

                    if (lock_pipe_saturated_s4) begin
                        lock_saturated <= 1'b1;
                        if (lock_pipe_sat_count_cfg_s4 != 32'd0) begin
                            if (lock_sat_cnt + 32'd1 >= lock_pipe_sat_count_eff_s4) begin
                                lock_sat_cnt         <= lock_pipe_sat_count_eff_s4;
                                lock_lost            <= 1'b1;
                                lock_control_enabled <= 1'b0;
                                lock_active          <= 1'b0;
                                lock_hold_ch1_code   <= lock_next_ch1_code;
                            end else begin
                                lock_sat_cnt <= lock_sat_cnt + 32'd1;
                            end
                        end
                    end else begin
                        lock_saturated <= 1'b0;
                        lock_sat_cnt   <= 32'd0;
                    end
                end
            end
```

- [ ] **Step 3: Compile and run the lock test**

Run:

```bash
cd /home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/IPs/ip_repo/axi_laser_current_ctrl_1_0
xvlog -sv hdl/laser_current_ctrl_core.v tb/tb_laser_lock_core.sv
xelab tb_laser_lock_core -s tb_laser_lock_core
xsim tb_laser_lock_core -runall
```

Expected:

```text
tb_laser_lock_core PASS
```

- [ ] **Step 4: Compile the full IP wrapper**

Run:

```bash
cd /home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/IPs/ip_repo/axi_laser_current_ctrl_1_0
xvlog -sv hdl/laser_current_ctrl_core.v hdl/axi_laser_current_ctrl_v1_0_S00_AXI.v hdl/axi_laser_current_ctrl_v1_0.v tb/tb_laser_lock_core.sv
```

Expected: `xvlog` exits 0. Existing warnings about unused or unconnected testbench ports are acceptable.

- [ ] **Step 5: Commit RTL and passing test**

```bash
git add /home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/IPs/ip_repo/axi_laser_current_ctrl_1_0/hdl/laser_current_ctrl_core.v /home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/IPs/ip_repo/axi_laser_current_ctrl_1_0/tb/tb_laser_lock_core.sv
git commit -m "fix: pipeline lock PID feedback path" -- /home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/IPs/ip_repo/axi_laser_current_ctrl_1_0/hdl/laser_current_ctrl_core.v /home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/IPs/ip_repo/axi_laser_current_ctrl_1_0/tb/tb_laser_lock_core.sv
```

If `/home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013` is not a git repository, copy the source diff into the milestone and continue without committing external IP files.

### Task 5: Re-run Vivado Synthesis/Implementation And Timing Reports

**Files:**
- Read/execute: `/home/qian/Portable_System_Project/Butterfly_Laser_Driver/tools/vivado_warning_cleanup/run_synth_impl_reports.tcl`
- Read/execute: `/home/qian/Portable_System_Project/Butterfly_Laser_Driver/tools/vivado_warning_cleanup/timing_debug_reports.tcl`

- [ ] **Step 1: Run synthesis and implementation**

Run:

```bash
cd /home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013
vivado -mode batch -source /home/qian/Portable_System_Project/Butterfly_Laser_Driver/tools/vivado_warning_cleanup/run_synth_impl_reports.tcl
```

Expected:

```text
RUN_STATUS synth_1 synth_design Complete!
RUN_STATUS impl_1 write_bitstream Complete!
```

- [ ] **Step 2: Regenerate timing debug reports**

Run:

```bash
vivado -mode batch \
  -source /home/qian/Portable_System_Project/Butterfly_Laser_Driver/tools/vivado_warning_cleanup/timing_debug_reports.tcl \
  -tclargs /home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/hardware/xilinx-k26-som-2023.2/xilinx-k26-som-2023.2.xpr \
  /home/qian/Portable_System_Project/Butterfly_Laser_Driver/milestones/vivado_warning_cleanup_20260626_180839/timing_debug_after_lock_pipeline
```

Expected:

```text
TIMING_DEBUG_REPORT_DIR=/home/qian/Portable_System_Project/Butterfly_Laser_Driver/milestones/vivado_warning_cleanup_20260626_180839/timing_debug_after_lock_pipeline
```

- [ ] **Step 3: Compare old and new worst setup path**

Run:

```bash
rg -n "Slack \\(VIOLATED\\)|Source:|Destination:|Data Path Delay:|Logic Levels:" \
  /home/qian/Portable_System_Project/Butterfly_Laser_Driver/milestones/vivado_warning_cleanup_20260626_180839/timing_debug_after_lock_pipeline/worst_setup_paths.rpt | sed -n '1,40p'
```

Expected: the top failing path is no longer `monitor_avg_reg[7]` to `req_ch1_code` with 47 logic levels. If the same path remains, inspect whether the old immediate calculation block was fully removed or whether another `fb_adc_data` path still bypasses the pipeline.

- [ ] **Step 4: Record final timing summary**

Run:

```bash
sed -n '236,246p' /home/qian/Portable_System_Project/Butterfly_Laser_Driver/milestones/vivado_warning_cleanup_20260626_180839/timing_debug_after_lock_pipeline/timing_summary_debug.rpt
```

Expected: WNS/TNS improve compared with baseline WNS `-5.028ns` and TNS `-683.037ns`.

- [ ] **Step 5: Archive diffs and reports**

Run:

```bash
mkdir -p /home/qian/Portable_System_Project/Butterfly_Laser_Driver/milestones/vivado_warning_cleanup_20260626_180839/lock_pid_pipeline
cp /home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/IPs/ip_repo/axi_laser_current_ctrl_1_0/hdl/laser_current_ctrl_core.v /home/qian/Portable_System_Project/Butterfly_Laser_Driver/milestones/vivado_warning_cleanup_20260626_180839/lock_pid_pipeline/laser_current_ctrl_core.after_lock_pipeline.v
cp /home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/IPs/ip_repo/axi_laser_current_ctrl_1_0/tb/tb_laser_lock_core.sv /home/qian/Portable_System_Project/Butterfly_Laser_Driver/milestones/vivado_warning_cleanup_20260626_180839/lock_pid_pipeline/tb_laser_lock_core.after_lock_pipeline.sv
cp -r /home/qian/Portable_System_Project/Butterfly_Laser_Driver/milestones/vivado_warning_cleanup_20260626_180839/timing_debug_after_lock_pipeline /home/qian/Portable_System_Project/Butterfly_Laser_Driver/milestones/vivado_warning_cleanup_20260626_180839/lock_pid_pipeline/
```

Expected: archive files exist under `milestones/vivado_warning_cleanup_20260626_180839/lock_pid_pipeline/`.
