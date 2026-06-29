`timescale 1ns / 1ps

module tb_laser_lock_core;
  localparam [2:0] MODE_FINE_SCAN = 3'd2;
  localparam [2:0] MODE_LOCK = 3'd4;

  reg clk = 1'b0;
  reg resetn = 1'b0;

  always #5 clk = ~clk;

  reg        ctrl_enable = 1'b0;
  reg        ctrl_start_pulse = 1'b0;
  reg        ctrl_stop_pulse = 1'b0;
  reg        ctrl_continuous = 1'b0;
  reg [2:0]  mode = MODE_LOCK;
  reg        laser_arm = 1'b1;
  reg        fault_clear_pulse = 1'b0;
  reg        watchdog_kick_pulse = 1'b0;
  reg        emergency_stop_pulse = 1'b0;
  reg        tec_locked = 1'b1;
  reg        ext_fault_n = 1'b1;
  reg        emergency_stop_ext = 1'b0;
  reg        dac_data_ready = 1'b1;
  reg [15:0] fb_adc_data = 16'd10000;
  reg        fb_adc_valid = 1'b0;
  reg [31:0] lock_fb_timeout_ticks_cfg = 32'd0;
  reg [15:0] lock_adc_min_valid_cfg = 16'd0;
  reg [15:0] lock_adc_max_valid_cfg = 16'd0;
  reg [15:0] ch0_static_code = 16'd24000;
  reg [15:0] ch1_start_code = 16'd1000;
  reg [15:0] ch1_stop_code = 16'd1010;
  reg [15:0] ch1_step_code = 16'd10;
  reg [31:0] frame_count = 32'd1;

  wire [15:0] dac_ch0_code;
  wire [15:0] dac_ch1_code;
  wire        dac_ch0_valid;
  wire        dac_ch1_valid;
  wire        laser_enable;
  wire [15:0] last_fb_adc;
  wire        frame_start_pulse;
  wire        frame_end_pulse;
  wire        frame_active;
  wire        point_strobe;
  wire [15:0] fast_index;
  wire [15:0] slow_index;
  wire [31:0] frame_index;
  wire        busy;
  wire        done_latched;
  wire        lock_active;
  wire        scan_active;
  wire        ramping;
  wire        dac_waiting;
  wire        output_at_target;
  wire        fault_latched;
  wire [31:0] fault_status;
  wire [15:0] actual_ch0_code;
  wire [15:0] actual_ch1_code;
  wire [15:0] target_ch0_code;
  wire [15:0] target_ch1_code;
  wire [31:0] current_estimate;
  wire [31:0] lock_status;
  wire [31:0] lock_error;
  wire [31:0] lock_integral;
  wire [31:0] lock_output_ch1_code;
  wire [31:0] lock_counters;
  wire [31:0] acquire_status;
  wire [31:0] acquire_match_code;
  wire [31:0] acquire_match_adc;
  wire [31:0] acquire_match_error;
  wire        error;

  laser_current_ctrl_core dut (
    .clk(clk),
    .resetn(resetn),
    .ctrl_enable(ctrl_enable),
    .ctrl_start_pulse(ctrl_start_pulse),
    .ctrl_stop_pulse(ctrl_stop_pulse),
    .ctrl_continuous(ctrl_continuous),
    .mode(mode),
    .laser_arm(laser_arm),
    .fault_clear_pulse(fault_clear_pulse),
    .watchdog_kick_pulse(watchdog_kick_pulse),
    .emergency_stop_pulse(emergency_stop_pulse),
    .tec_locked(tec_locked),
    .ext_fault_n(ext_fault_n),
    .emergency_stop_ext(emergency_stop_ext),
    .ch0_static_code(ch0_static_code),
    .ch1_static_code(16'd0),
    .ch0_start_code(16'd0),
    .ch0_stop_code(16'd0),
    .ch0_step_code(16'd1),
    .ch0_dwell_frames(32'd1),
    .ch1_start_code(ch1_start_code),
    .ch1_stop_code(ch1_stop_code),
    .ch1_step_code(ch1_step_code),
    .ch1_dwell_ticks(32'd1),
    .frame_count(frame_count),
    .dac_settle_ticks(32'd0),
    .ch0_min_code(16'd0),
    .ch0_max_code(16'd0),
    .ch1_min_code(16'd0),
    .ch1_max_code(16'd0),
    .ch0_soft_step(16'd0),
    .ch1_soft_step(16'd0),
    .ramp_interval_ticks(32'd0),
    .enable_delay_ticks(32'd0),
    .dac_timeout_ticks(32'd0),
    .watchdog_timeout_ticks(32'd0),
    .current_limit_code(32'd0),
    .ch0_gain_coeff(16'd0),
    .ch1_gain_coeff(16'd0),
    .current_offset(32'd0),
    .lock_target_adc(16'd10000),
    .lock_polarity_invert(1'b0),
    .lock_bias_ch1_code(16'd20000),
    .lock_ch1_min_code(16'd19000),
    .lock_ch1_max_code(16'd21000),
    .lock_kp_q16(32'h0001_0000),
    .lock_ki_q16(32'd0),
    .lock_integral_limit(32'd1000),
    .lock_max_step(16'd4),
    .lock_locked_threshold(16'd2),
    .lock_loss_threshold(16'd200),
    .lock_locked_count_cfg(16'd2),
    .lock_loss_count_cfg(16'd3),
    .lock_sat_count_cfg(32'd3),
    .lock_fb_timeout_ticks(lock_fb_timeout_ticks_cfg),
    .lock_adc_min_valid(lock_adc_min_valid_cfg),
    .lock_adc_max_valid(lock_adc_max_valid_cfg),
    .acquire_enable(1'b0),
    .acquire_arm_pulse(1'b0),
    .acquire_cancel_pulse(1'b0),
    .acquire_search_min_code(16'd0),
    .acquire_search_max_code(16'd0),
    .acquire_threshold(16'd0),
    .dac_data_ready(dac_data_ready),
    .dac_ch0_code(dac_ch0_code),
    .dac_ch1_code(dac_ch1_code),
    .dac_ch0_valid(dac_ch0_valid),
    .dac_ch1_valid(dac_ch1_valid),
    .laser_enable(laser_enable),
    .fb_adc_data(fb_adc_data),
    .fb_adc_valid(fb_adc_valid),
    .last_fb_adc(last_fb_adc),
    .frame_start_pulse(frame_start_pulse),
    .frame_end_pulse(frame_end_pulse),
    .frame_active(frame_active),
    .point_strobe(point_strobe),
    .fast_index(fast_index),
    .slow_index(slow_index),
    .frame_index(frame_index),
    .busy(busy),
    .done_latched(done_latched),
    .lock_active(lock_active),
    .scan_active(scan_active),
    .ramping(ramping),
    .dac_waiting(dac_waiting),
    .output_at_target(output_at_target),
    .fault_latched(fault_latched),
    .fault_status(fault_status),
    .actual_ch0_code(actual_ch0_code),
    .actual_ch1_code(actual_ch1_code),
    .target_ch0_code(target_ch0_code),
    .target_ch1_code(target_ch1_code),
    .current_estimate(current_estimate),
    .lock_status(lock_status),
    .lock_error(lock_error),
    .lock_integral(lock_integral),
    .lock_output_ch1_code(lock_output_ch1_code),
    .lock_counters(lock_counters),
    .acquire_status(acquire_status),
    .acquire_match_code(acquire_match_code),
    .acquire_match_adc(acquire_match_adc),
    .acquire_match_error(acquire_match_error),
    .error(error)
  );

  task tick;
    begin
      @(posedge clk);
      #1;
    end
  endtask

  task pulse_start_lock;
    begin
      mode = MODE_LOCK;
      ctrl_enable = 1'b1;
      ctrl_start_pulse = 1'b1;
      tick();
      ctrl_start_pulse = 1'b0;
    end
  endtask

  task pulse_start_scan;
    begin
      mode = MODE_FINE_SCAN;
      ctrl_continuous = 1'b1;
      ctrl_enable = 1'b1;
      ctrl_start_pulse = 1'b1;
      tick();
      ctrl_start_pulse = 1'b0;
    end
  endtask

  task feedback;
    input [15:0] adc_code;
    begin
      fb_adc_data = adc_code;
      fb_adc_valid = 1'b1;
      tick();
      fb_adc_valid = 1'b0;
      tick();
    end
  endtask

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

  task expect_no_stale_commit_overlap;
    input [15:0] stale_code;
    input integer cycles;
    integer i;
    begin
      for (i = 0; i < cycles; i = i + 1) begin
        tick();
        if ((target_ch1_code === stale_code) ||
            (lock_output_ch1_code[15:0] === stale_code)) begin
          $fatal(1,
                 "stale commit overlap: in-flight lock sample committed after same-cycle abort at cycle %0d, target=%0d lock_output=%0d stale=%0d",
                 i, target_ch1_code, lock_output_ch1_code[15:0], stale_code);
        end
      end
    end
  endtask

  task clear_lock_fault_state;
    begin
      ext_fault_n = 1'b1;
      emergency_stop_pulse = 1'b0;
      emergency_stop_ext = 1'b0;
      ctrl_stop_pulse = 1'b0;
      fb_adc_valid = 1'b0;
      lock_fb_timeout_ticks_cfg = 32'd0;
      lock_adc_min_valid_cfg = 16'd0;
      lock_adc_max_valid_cfg = 16'd0;
      fault_clear_pulse = 1'b1;
      tick();
      fault_clear_pulse = 1'b0;
      repeat (2) tick();
    end
  endtask

  task restart_lock_at_bias;
    begin
      clear_lock_fault_state();
      pulse_start_lock();
      repeat (20) tick();
      if ((target_ch1_code !== 16'd20000) ||
          (lock_output_ch1_code[15:0] !== 16'd20000)) begin
        $fatal(1,
               "restart lock did not return to bias before stale commit overlap test, target=%0d lock_output=%0d",
               target_ch1_code, lock_output_ch1_code[15:0]);
      end
    end
  endtask

  initial begin
    repeat (4) tick();
    resetn = 1'b1;
    repeat (4) tick();

    pulse_start_lock();
    repeat (20) tick();

    if (actual_ch1_code !== 16'd20000) begin
      $fatal(1, "MODE_LOCK must ramp CH1 to lock_bias_ch1_code, got %0d", actual_ch1_code);
    end

    feedback_sample(16'd9990);
    expect_target_after_lock_latency(16'd20000, 16'd20004);

    feedback_sample(16'd10000);
    repeat (LOCK_PIPE_MAX_LATENCY_CYCLES + 1) tick();
    feedback_sample(16'd10000);
    wait_for_lock_status_bit(2, 12);

    feedback_sample(16'd9500);
    repeat (LOCK_PIPE_MAX_LATENCY_CYCLES + 1) tick();
    feedback_sample(16'd9500);
    repeat (LOCK_PIPE_MAX_LATENCY_CYCLES + 1) tick();
    feedback_sample(16'd9500);
    wait_for_lock_status_bit(4, 12);
    if (target_ch1_code !== lock_output_ch1_code[15:0]) begin
      $fatal(1, "MODE_LOCK lost state must hold output, target=%0d output=%0d", target_ch1_code, lock_output_ch1_code[15:0]);
    end

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

    restart_lock_at_bias();
    feedback_sample(16'd9990);
    repeat (LOCK_PIPE_MIN_LATENCY_CYCLES) tick();
    lock_adc_min_valid_cfg = 16'd9000;
    lock_adc_max_valid_cfg = 16'd11000;
    feedback_sample(16'd12000);
    expect_no_stale_commit_overlap(16'd20004, LOCK_PIPE_MAX_LATENCY_CYCLES + 4);

    restart_lock_at_bias();
    lock_fb_timeout_ticks_cfg = 32'd4;
    feedback_sample(16'd9990);
    expect_no_stale_commit_overlap(16'd20004, LOCK_PIPE_MAX_LATENCY_CYCLES + 6);

    restart_lock_at_bias();
    feedback_sample(16'd9990);
    repeat (LOCK_PIPE_MIN_LATENCY_CYCLES) tick();
    ext_fault_n = 1'b0;
    tick();
    expect_no_stale_commit_overlap(16'd20004, LOCK_PIPE_MAX_LATENCY_CYCLES + 4);
    ext_fault_n = 1'b1;
    clear_lock_fault_state();

    restart_lock_at_bias();
    feedback_sample(16'd9990);
    repeat (LOCK_PIPE_MIN_LATENCY_CYCLES) tick();
    pulse_start_scan();
    repeat (2) tick();
    if ((target_ch1_code === 16'd20004) ||
        (lock_output_ch1_code[15:0] === 16'd20004)) begin
      $fatal(1,
             "stale start overlap: in-flight lock sample committed after start command, target=%0d lock_output=%0d stale=%0d",
             target_ch1_code, lock_output_ch1_code[15:0], 16'd20004);
    end
    repeat (8) tick();
    if (!scan_active || lock_active || target_ch1_code !== ch1_start_code) begin
      $fatal(1, "Start fine scan with in-flight lock sample must switch to scan, scan_active=%0b lock_active=%0b target_ch1=%0d",
             scan_active, lock_active, target_ch1_code);
    end

    restart_lock_at_bias();
    pulse_start_scan();
    repeat (8) tick();
    if (!scan_active || lock_active || target_ch1_code !== ch1_start_code) begin
      $fatal(1, "Start fine scan from lock hold must switch to scan, scan_active=%0b lock_active=%0b target_ch1=%0d",
             scan_active, lock_active, target_ch1_code);
    end

    $display("tb_laser_lock_core PASS");
    $finish;
  end
endmodule
