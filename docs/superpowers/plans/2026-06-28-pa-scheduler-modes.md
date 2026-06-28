# PA Scheduler Modes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand `axi_pam_image_acq` into a shared PA scheduler with auto scan capture, continuous point capture, manual galvo, manual pulse, waveform modes, richer AXI status, server APIs, and Tauri controls.

**Architecture:** Keep the existing legacy scan register map compatible, add a write-one-pulse scheduler command/register region at `0x40-0x7C`, and expose extended status/counters at `0xB8-0xFC`. Server code wraps the new register map in scheduler-specific dataclasses/controllers while existing `/api/pa/start` remains the auto scan capture compatibility path. Tauri adds a scheduler-oriented PA UI with clear capture-required and no-capture mode separation.

**Tech Stack:** Verilog RTL for Vivado IP, Vivado `xvlog/xelab/xsim`, Python `unittest` server tests, TypeScript/Vitest Tauri tests, React/Tauri UI.

---

## File Structure

- Modify `/home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/IPs/ip_repo/axi_pam_image_acq_1_0/hdl/pam_image_acq_controller_core.v`: scheduler FSM, new modes, command semantics, counters, status fields.
- Modify `/home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/IPs/ip_repo/axi_pam_image_acq_1_0/hdl/axi_pam_image_acq_v1_0_S00_AXI.v`: new AXI fields at `0x40-0x7C`, read-only status mux at `0xB8-0xFC`, command pulse decode.
- Modify `/home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/IPs/ip_repo/axi_pam_image_acq_1_0/hdl/axi_pam_image_acq_v1_0.v`: wire new register bank signals into the core.
- Create `/home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/IPs/ip_repo/axi_pam_image_acq_1_0/tb/tb_pam_scheduler_modes.sv`: behavior simulation for legacy scan, manual hold, no-capture pulse, continuous point capture, waveform, downstream busy fault, and abort park.
- Modify generated copies only after canonical HDL is verified:
  - `/home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/hardware/xilinx-k26-som-2023.2/xilinx-k26-som-2023.2.gen/sources_1/bd/project_1/ipshared/3aba/hdl/`
  - `/home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/hardware/xilinx-k26-som-2023.2/xilinx-k26-som-2023.2.ip_user_files/bd/project_1/ipshared/3aba/hdl/`
- Modify `/home/qian/Portable_System_Project/Butterfly_Laser_Driver/pa_imaging_capture.py`: register constants, scheduler dataclasses, status decoding, command helpers, capture worker start/stop integration.
- Modify `/home/qian/Portable_System_Project/Butterfly_Laser_Driver/butterfly_laser_server.py`: `/api/pa/scheduler/*` endpoints and compatibility mapping from `/api/pa/start`.
- Modify `/home/qian/Portable_System_Project/Butterfly_Laser_Driver/tests/test_pa_imaging_capture.py`: low-level register packing/status/controller tests.
- Modify `/home/qian/Portable_System_Project/Butterfly_Laser_Driver/tests/test_tauri_server_defaults.py`: endpoint and service orchestration tests.
- Modify `/home/qian/Portable_System_Project/Butterfly_Laser_Driver/tauri_control_console/src/api/types.ts`: scheduler mode/config/status TypeScript types.
- Modify `/home/qian/Portable_System_Project/Butterfly_Laser_Driver/tauri_control_console/src/api/client.ts`: scheduler endpoint methods.
- Create `/home/qian/Portable_System_Project/Butterfly_Laser_Driver/tauri_control_console/src/utils/paScheduler.ts`: UI-side formatting and status helpers.
- Modify `/home/qian/Portable_System_Project/Butterfly_Laser_Driver/tauri_control_console/src/components/PaImagingPanel.tsx`: scheduler tabs and mode controls while preserving existing scan/timing subpages.
- Modify `/home/qian/Portable_System_Project/Butterfly_Laser_Driver/tauri_control_console/src/styles.css`: mode tab/status styling.
- Create `/home/qian/Portable_System_Project/Butterfly_Laser_Driver/tauri_control_console/src/__tests__/paScheduler.test.ts`: utility and client payload tests.
- Modify `/home/qian/Portable_System_Project/Butterfly_Laser_Driver/tauri_control_console/src/__tests__/paImagingPanelLayout.test.tsx`: rendered UI assertions for scheduler modes.

---

### Task 1: HDL Scheduler Testbench

**Files:**
- Create: `/home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/IPs/ip_repo/axi_pam_image_acq_1_0/tb/tb_pam_scheduler_modes.sv`
- Read: `/home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/IPs/ip_repo/axi_pam_image_acq_1_0/hdl/pam_image_acq_controller_core.v`

- [ ] **Step 1: Create a failing behavior testbench**

Create `/home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/IPs/ip_repo/axi_pam_image_acq_1_0/tb/tb_pam_scheduler_modes.sv` with this content:

```systemverilog
`timescale 1ns / 1ps

module tb_pam_scheduler_modes;
  localparam integer CLK_PERIOD_NS = 10;

  reg clk = 1'b0;
  reg rst_n = 1'b0;
  always #(CLK_PERIOD_NS / 2) clk = ~clk;

  reg start = 1'b0;
  reg overall_busy_pl = 1'b0;
  reg signed [15:0] x_start = 16'sd0;
  reg signed [15:0] x_step = 16'sd1;
  reg [15:0] x_points = 16'd1;
  reg signed [15:0] y_start = 16'sd0;
  reg signed [15:0] y_step = 16'sd1;
  reg [15:0] y_points = 16'd1;
  reg [15:0] frame_number = 16'd1;
  reg [31:0] task_id = 32'd1;
  reg scan_mode = 1'b1;
  reg return_mode = 1'b0;
  reg [31:0] gap_time = 32'd20;
  reg [31:0] galvo_settle_time = 32'd2;
  reg [31:0] ld_trigger_time = 32'd3;
  reg [31:0] adc_trigger_time = 32'd5;
  reg [31:0] ld_time = 32'd4;

  reg [3:0] scheduler_mode = 4'd0;
  reg [6:0] scheduler_command = 7'd0;
  reg [31:0] scheduler_control = 32'd0;
  reg [31:0] scheduler_period_cycles = 32'd20;
  reg signed [15:0] manual_x = 16'sd0;
  reg signed [15:0] manual_y = 16'sd0;
  reg [31:0] shot_limit = 32'd0;
  reg [31:0] pulse_phase_cycles = 32'd0;
  reg [31:0] manual_ld_delay_cycles = 32'd0;
  reg [31:0] manual_ld_width_cycles = 32'd0;
  reg [31:0] manual_adc_delay_cycles = 32'd0;
  reg [31:0] manual_adc_width_cycles = 32'd1;
  reg [31:0] waveform_control = 32'd0;
  reg signed [15:0] waveform_x_min = 16'sd0;
  reg signed [15:0] waveform_x_max = 16'sd0;
  reg signed [15:0] waveform_y_min = 16'sd0;
  reg signed [15:0] waveform_y_max = 16'sd0;
  reg signed [15:0] waveform_x_step = 16'sd0;
  reg signed [15:0] waveform_y_step = 16'sd0;
  reg debug_clear = 1'b0;

  wire busy;
  wire image_start_pulse;
  wire image_end_pulse;
  wire pixel_start_pulse;
  wire frame_start_pulse;
  wire laser_trigger;
  wire adc_trigger;
  wire signed [15:0] galvo_x;
  wire signed [15:0] galvo_y;
  wire [255:0] meta_data;
  wire meta_valid;
  wire [31:0] debug_status;
  wire [31:0] debug_fault_code;
  wire [31:0] debug_accepted_trigger_count;
  wire [31:0] debug_rejected_trigger_busy_count;
  wire [31:0] debug_busy_hold_events;
  wire [31:0] debug_busy_hold_cycles;
  wire [31:0] debug_busy_hold_max_cycles;
  wire [31:0] debug_axis_tready_low_cycles;
  wire [31:0] debug_axis_stall_events;
  wire [31:0] debug_axis_stall_max_cycles;
  wire [31:0] debug_fifo_overflow_count;
  wire [31:0] debug_capture_done_count;
  wire [31:0] debug_tx_done_count;
  wire [31:0] sched_version;
  wire [31:0] sched_state;
  wire [31:0] sched_current_xy;
  wire [31:0] sched_current_index_xy;
  wire [31:0] sched_current_frame;
  wire [31:0] sched_shot_count;
  wire [31:0] sched_capture_count;
  wire [31:0] sched_pixel_count;
  wire [31:0] sched_command_count;
  wire [31:0] sched_last_command;
  wire [31:0] sched_stop_count;
  wire [31:0] sched_park_count;
  wire [31:0] sched_manual_update_count;
  wire [31:0] sched_waveform_cycle_count;
  wire [31:0] sched_fault_detail;
  wire [31:0] sched_control_snapshot;
  wire [31:0] sched_period_active;

  pam_image_acq_controller_core dut (
    .clk(clk),
    .rst_n(rst_n),
    .start(start),
    .overall_busy_pl(overall_busy_pl),
    .x_start(x_start),
    .x_step(x_step),
    .x_points(x_points),
    .y_start(y_start),
    .y_step(y_step),
    .y_points(y_points),
    .frame_number(frame_number),
    .task_id(task_id),
    .scan_mode(scan_mode),
    .return_mode(return_mode),
    .gap_time(gap_time),
    .galvo_settle_time(galvo_settle_time),
    .ld_trigger_time(ld_trigger_time),
    .adc_trigger_time(adc_trigger_time),
    .ld_time(ld_time),
    .scheduler_mode(scheduler_mode),
    .scheduler_command(scheduler_command),
    .scheduler_control(scheduler_control),
    .scheduler_period_cycles(scheduler_period_cycles),
    .manual_x(manual_x),
    .manual_y(manual_y),
    .shot_limit(shot_limit),
    .pulse_phase_cycles(pulse_phase_cycles),
    .manual_ld_delay_cycles(manual_ld_delay_cycles),
    .manual_ld_width_cycles(manual_ld_width_cycles),
    .manual_adc_delay_cycles(manual_adc_delay_cycles),
    .manual_adc_width_cycles(manual_adc_width_cycles),
    .waveform_control(waveform_control),
    .waveform_x_min(waveform_x_min),
    .waveform_x_max(waveform_x_max),
    .waveform_y_min(waveform_y_min),
    .waveform_y_max(waveform_y_max),
    .waveform_x_step(waveform_x_step),
    .waveform_y_step(waveform_y_step),
    .busy(busy),
    .image_start_pulse(image_start_pulse),
    .image_end_pulse(image_end_pulse),
    .pixel_start_pulse(pixel_start_pulse),
    .frame_start_pulse(frame_start_pulse),
    .laser_trigger(laser_trigger),
    .adc_trigger(adc_trigger),
    .galvo_x(galvo_x),
    .galvo_y(galvo_y),
    .meta_data(meta_data),
    .meta_valid(meta_valid),
    .debug_clear(debug_clear),
    .debug_status(debug_status),
    .debug_fault_code(debug_fault_code),
    .debug_accepted_trigger_count(debug_accepted_trigger_count),
    .debug_rejected_trigger_busy_count(debug_rejected_trigger_busy_count),
    .debug_busy_hold_events(debug_busy_hold_events),
    .debug_busy_hold_cycles(debug_busy_hold_cycles),
    .debug_busy_hold_max_cycles(debug_busy_hold_max_cycles),
    .debug_axis_tready_low_cycles(debug_axis_tready_low_cycles),
    .debug_axis_stall_events(debug_axis_stall_events),
    .debug_axis_stall_max_cycles(debug_axis_stall_max_cycles),
    .debug_fifo_overflow_count(debug_fifo_overflow_count),
    .debug_capture_done_count(debug_capture_done_count),
    .debug_tx_done_count(debug_tx_done_count),
    .sched_version(sched_version),
    .sched_state(sched_state),
    .sched_current_xy(sched_current_xy),
    .sched_current_index_xy(sched_current_index_xy),
    .sched_current_frame(sched_current_frame),
    .sched_shot_count(sched_shot_count),
    .sched_capture_count(sched_capture_count),
    .sched_pixel_count(sched_pixel_count),
    .sched_command_count(sched_command_count),
    .sched_last_command(sched_last_command),
    .sched_stop_count(sched_stop_count),
    .sched_park_count(sched_park_count),
    .sched_manual_update_count(sched_manual_update_count),
    .sched_waveform_cycle_count(sched_waveform_cycle_count),
    .sched_fault_detail(sched_fault_detail),
    .sched_control_snapshot(sched_control_snapshot),
    .sched_period_active(sched_period_active)
  );

  task tick(input integer cycles);
    integer i;
    begin
      for (i = 0; i < cycles; i = i + 1)
        @(posedge clk);
    end
  endtask

  task reset_dut;
    begin
      rst_n = 1'b0;
      start = 1'b0;
      scheduler_command = 7'd0;
      debug_clear = 1'b0;
      tick(5);
      rst_n = 1'b1;
      tick(3);
    end
  endtask

  task pulse_command(input [6:0] command_bits);
    begin
      scheduler_command = command_bits;
      tick(1);
      scheduler_command = 7'd0;
      tick(1);
    end
  endtask

  task assert_equal32(input [31:0] actual, input [31:0] expected, input [1023:0] name);
    begin
      if (actual !== expected) begin
        $display("ASSERT_FAIL %0s actual=0x%08x expected=0x%08x", name, actual, expected);
        $fatal;
      end
    end
  endtask

  task assert_true(input value, input [1023:0] name);
    begin
      if (!value) begin
        $display("ASSERT_FAIL %0s", name);
        $fatal;
      end
    end
  endtask

  initial begin
    reset_dut();

    manual_x = 16'sd123;
    manual_y = -16'sd45;
    scheduler_mode = 4'd3;
    scheduler_control = 32'h00000301;
    pulse_command(7'b0010001);
    tick(4);
    assert_equal32({galvo_y, galvo_x}, {16'hFFD3, 16'h007B}, "manual hold applies coordinates");
    assert_equal32(sched_manual_update_count, 32'd1, "manual update count");
    assert_true(!adc_trigger && !meta_valid, "manual hold does not capture");

    reset_dut();
    manual_x = 16'sd12;
    manual_y = 16'sd34;
    scheduler_mode = 4'd4;
    scheduler_control = 32'h00000011;
    scheduler_period_cycles = 32'd12;
    manual_ld_delay_cycles = 32'd2;
    manual_ld_width_cycles = 32'd3;
    shot_limit = 32'd2;
    pulse_command(7'b0000001);
    tick(40);
    assert_equal32(sched_shot_count, 32'd2, "manual pulse shot count");
    assert_equal32(sched_capture_count, 32'd0, "manual pulse capture count");
    assert_true((debug_status & 32'h20) == 0, "manual pulse ignores downstream");

    reset_dut();
    manual_x = 16'sd7;
    manual_y = 16'sd9;
    scheduler_mode = 4'd2;
    scheduler_control = 32'h0000002F;
    scheduler_period_cycles = 32'd10;
    manual_ld_delay_cycles = 32'd1;
    manual_ld_width_cycles = 32'd2;
    manual_adc_delay_cycles = 32'd3;
    manual_adc_width_cycles = 32'd1;
    shot_limit = 32'd3;
    pulse_command(7'b0000001);
    tick(50);
    assert_equal32(sched_shot_count, 32'd3, "continuous point shot count");
    assert_equal32(sched_capture_count, 32'd3, "continuous point capture count");
    assert_true(meta_data[255:224] == 32'h4D455441, "continuous point metadata magic");

    reset_dut();
    scheduler_mode = 4'd1;
    x_start = 16'sd10;
    y_start = 16'sd20;
    x_points = 16'd2;
    y_points = 16'd1;
    frame_number = 16'd1;
    start = 1'b1;
    tick(60);
    start = 1'b0;
    tick(3);
    assert_true(image_end_pulse || !busy, "legacy scan completes or aborts cleanly");
    assert_true(sched_capture_count >= 32'd1, "legacy scan captured at least one frame");

    reset_dut();
    scheduler_mode = 4'd5;
    scheduler_control = 32'h00000011;
    waveform_control = 32'h00000101;
    waveform_x_min = -16'sd5;
    waveform_x_max = 16'sd5;
    waveform_x_step = 16'sd2;
    scheduler_period_cycles = 32'd4;
    shot_limit = 32'd8;
    pulse_command(7'b0000001);
    tick(80);
    assert_true(sched_waveform_cycle_count >= 32'd1, "waveform cycles");

    reset_dut();
    scheduler_mode = 4'd2;
    scheduler_control = 32'h0000002F;
    scheduler_period_cycles = 32'd10;
    shot_limit = 32'd1;
    overall_busy_pl = 1'b1;
    pulse_command(7'b0000001);
    tick(600);
    assert_true(debug_fault_code != 32'd0, "capture mode faults on stuck downstream");
    overall_busy_pl = 1'b0;

    reset_dut();
    scheduler_mode = 4'd4;
    scheduler_control = 32'h00000011;
    scheduler_period_cycles = 32'd100;
    manual_ld_delay_cycles = 32'd0;
    manual_ld_width_cycles = 32'd80;
    pulse_command(7'b0000001);
    tick(5);
    pulse_command(7'b0000100);
    tick(2);
    assert_true(!laser_trigger && !adc_trigger && !meta_valid, "abort deasserts outputs");
    assert_true(sched_park_count >= 32'd1, "abort parks");

    $display("TB_PASS tb_pam_scheduler_modes");
    $finish;
  end
endmodule
```

- [ ] **Step 2: Run the testbench and verify it fails against the current core**

Run:

```bash
cd /home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/IPs/ip_repo/axi_pam_image_acq_1_0
xvlog -sv hdl/pam_image_acq_controller_core.v tb/tb_pam_scheduler_modes.sv
```

Expected: FAIL because `pam_image_acq_controller_core` does not yet expose the new scheduler ports.

- [ ] **Step 3: Commit the failing testbench**

```bash
git -C /home/qian/Portable_System_Project/Butterfly_Laser_Driver add /home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/IPs/ip_repo/axi_pam_image_acq_1_0/tb/tb_pam_scheduler_modes.sv
git -C /home/qian/Portable_System_Project/Butterfly_Laser_Driver commit -m "test: add PA scheduler HDL mode testbench"
```

Expected: commit contains only the new testbench. If the Vivado IP directory is outside the git repo, record the testbench path and skip this commit command.

---

### Task 2: HDL Core Scheduler Modes

**Files:**
- Modify: `/home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/IPs/ip_repo/axi_pam_image_acq_1_0/hdl/pam_image_acq_controller_core.v`
- Test: `/home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/IPs/ip_repo/axi_pam_image_acq_1_0/tb/tb_pam_scheduler_modes.sv`

- [ ] **Step 1: Extend the core port list**

Add these input ports after existing timing inputs and before main outputs:

```verilog
    input  wire [3:0]   scheduler_mode,
    input  wire [6:0]   scheduler_command,
    input  wire [31:0]  scheduler_control,
    input  wire [31:0]  scheduler_period_cycles,
    input  wire signed [15:0] manual_x,
    input  wire signed [15:0] manual_y,
    input  wire [31:0]  shot_limit,
    input  wire [31:0]  pulse_phase_cycles,
    input  wire [31:0]  manual_ld_delay_cycles,
    input  wire [31:0]  manual_ld_width_cycles,
    input  wire [31:0]  manual_adc_delay_cycles,
    input  wire [31:0]  manual_adc_width_cycles,
    input  wire [31:0]  waveform_control,
    input  wire signed [15:0] waveform_x_min,
    input  wire signed [15:0] waveform_x_max,
    input  wire signed [15:0] waveform_y_min,
    input  wire signed [15:0] waveform_y_max,
    input  wire signed [15:0] waveform_x_step,
    input  wire signed [15:0] waveform_y_step,
```

Add these output ports after existing debug outputs:

```verilog
    output wire [31:0]  sched_version,
    output wire [31:0]  sched_state,
    output wire [31:0]  sched_current_xy,
    output wire [31:0]  sched_current_index_xy,
    output wire [31:0]  sched_current_frame,
    output reg  [31:0]  sched_shot_count,
    output reg  [31:0]  sched_capture_count,
    output reg  [31:0]  sched_pixel_count,
    output reg  [31:0]  sched_command_count,
    output reg  [31:0]  sched_last_command,
    output reg  [31:0]  sched_stop_count,
    output reg  [31:0]  sched_park_count,
    output reg  [31:0]  sched_manual_update_count,
    output reg  [31:0]  sched_waveform_cycle_count,
    output reg  [31:0]  sched_fault_detail,
    output reg  [31:0]  sched_control_snapshot,
    output reg  [31:0]  sched_period_active
```

- [ ] **Step 2: Add local constants and command/control decodes**

Add these localparams and wires near the existing state localparams:

```verilog
    localparam [3:0]
        MODE_IDLE                     = 4'd0,
        MODE_AUTO_SCAN_CAPTURE        = 4'd1,
        MODE_CONTINUOUS_POINT_CAPTURE = 4'd2,
        MODE_MANUAL_GALVO_HOLD        = 4'd3,
        MODE_MANUAL_PULSE_NO_CAPTURE  = 4'd4,
        MODE_GALVO_WAVEFORM_NO_CAPTURE= 4'd5,
        MODE_GALVO_WAVEFORM_CAPTURE   = 4'd6,
        MODE_RESERVED_EXTERNAL_CAPTURE= 4'd7;

    localparam [3:0]
        SCHED_IDLE      = 4'd0,
        SCHED_SCAN      = 4'd1,
        SCHED_PULSE     = 4'd2,
        SCHED_WAVEFORM  = 4'd3,
        SCHED_PARKED    = 4'd4,
        SCHED_FAULT     = 4'd5;

    wire cmd_start        = scheduler_command[0] | start_rise;
    wire cmd_stop         = scheduler_command[1];
    wire cmd_abort_park   = scheduler_command[2] | ((!start) && (state != ST_IDLE));
    wire cmd_clear_fault  = scheduler_command[3] | debug_clear;
    wire cmd_apply_manual = scheduler_command[4];
    wire cmd_single_pulse = scheduler_command[5];
    wire cmd_soft_reset   = scheduler_command[6];

    wire ctrl_ld_enable              = scheduler_control[0];
    wire ctrl_adc_enable             = scheduler_control[1];
    wire ctrl_capture_enable         = scheduler_control[2];
    wire ctrl_respect_downstream     = scheduler_control[3];
    wire ctrl_loop_enable            = scheduler_control[4];
    wire ctrl_manual_live_update     = scheduler_control[5];
    wire [1:0] ctrl_park_mode        = scheduler_control[9:8];

    wire mode_requires_capture =
        (active_mode == MODE_AUTO_SCAN_CAPTURE) ||
        (active_mode == MODE_CONTINUOUS_POINT_CAPTURE) ||
        (active_mode == MODE_GALVO_WAVEFORM_CAPTURE);
```

- [ ] **Step 3: Add active mode and pulse/waveform state registers**

Add these registers beside the existing latched configuration:

```verilog
    reg [3:0] active_mode;
    reg [3:0] scheduler_fsm_state;
    reg graceful_stop_pending;
    reg abort_seen;
    reg parked;
    reg [31:0] pulse_slot_cnt;
    reg [31:0] pulse_period_r;
    reg [31:0] shot_limit_r;
    reg [31:0] pulse_phase_r;
    reg [31:0] pulse_ld_delay_r;
    reg [31:0] pulse_ld_width_r;
    reg [31:0] pulse_adc_delay_r;
    reg [31:0] pulse_adc_width_r;
    reg [31:0] waveform_control_r;
    reg signed [15:0] manual_x_r;
    reg signed [15:0] manual_y_r;
    reg signed [15:0] waveform_x_min_r;
    reg signed [15:0] waveform_x_max_r;
    reg signed [15:0] waveform_y_min_r;
    reg signed [15:0] waveform_y_max_r;
    reg signed [15:0] waveform_x_step_r;
    reg signed [15:0] waveform_y_step_r;
    reg signed [15:0] waveform_x_pos;
    reg signed [15:0] waveform_y_pos;
    reg waveform_x_dir;
    reg waveform_y_dir;
```

- [ ] **Step 4: Add status assignments**

Replace the existing `debug_status` assignment with one that preserves bits
`0`, `1`, `2`, `4`, and `5`, and adds high-level status bits:

```verilog
    assign debug_status = {
        16'd0,
        parked,
        (active_mode == MODE_GALVO_WAVEFORM_CAPTURE) || (active_mode == MODE_GALVO_WAVEFORM_NO_CAPTURE),
        (active_mode == MODE_MANUAL_GALVO_HOLD) || (active_mode == MODE_MANUAL_PULSE_NO_CAPTURE),
        ctrl_adc_enable,
        ctrl_ld_enable,
        ctrl_capture_enable,
        1'b0,
        1'b0,
        overall_busy_pl,
        (debug_fault_code != 32'd0),
        1'b0,
        debug_waiting_on_busy,
        busy,
        debug_fault_latched
    };
    assign sched_version = 32'h0001_007F;
    assign sched_state = {
        16'd0,
        debug_fault_latched,
        abort_seen,
        graceful_stop_pending,
        parked,
        ((active_mode != MODE_AUTO_SCAN_CAPTURE) && (active_mode != MODE_CONTINUOUS_POINT_CAPTURE) && (active_mode != MODE_GALVO_WAVEFORM_CAPTURE) && busy),
        ctrl_capture_enable,
        mode_requires_capture,
        busy,
        scheduler_fsm_state,
        active_mode
    };
    assign sched_current_xy = {galvo_y, galvo_x};
    assign sched_current_index_xy = {y_idx, x_idx};
    assign sched_current_frame = (active_mode == MODE_AUTO_SCAN_CAPTURE) ? {16'd0, frame_idx} : sched_shot_count;
```

- [ ] **Step 5: Implement common command side effects**

Inside the main sequential block, before the existing scan `case`, add a common
command section that:

```verilog
            if (cmd_clear_fault) begin
                debug_fault_latched <= 1'b0;
                debug_fault_code <= 32'd0;
                sched_fault_detail <= 32'd0;
            end

            if (scheduler_command != 7'd0) begin
                sched_command_count <= sched_command_count + 32'd1;
                sched_last_command <= {25'd0, scheduler_command};
            end

            if (cmd_abort_park) begin
                abort_seen <= 1'b1;
                sched_stop_count <= sched_stop_count + 32'd1;
                laser_trigger <= 1'b0;
                adc_trigger <= 1'b0;
                meta_valid <= 1'b0;
                busy <= 1'b0;
                scheduler_fsm_state <= SCHED_PARKED;
                parked <= 1'b1;
                sched_park_count <= sched_park_count + 32'd1;
                state <= ST_IDLE;
            end
```

Create a local task-equivalent code section named `park_outputs` by using this block in each stop/abort/completion branch:

```verilog
case (ctrl_park_mode)
    2'd0: begin
        galvo_x <= x_center_pos;
        galvo_y <= y_center_pos;
        current_x <= x_center_pos;
        current_y <= y_center_pos;
    end
    2'd1: begin
        galvo_x <= x_start_r;
        galvo_y <= y_start_r;
        current_x <= x_start_r;
        current_y <= y_start_r;
    end
    2'd2: begin
        galvo_x <= manual_x_r;
        galvo_y <= manual_y_r;
        current_x <= manual_x_r;
        current_y <= manual_y_r;
    end
    default: begin
        galvo_x <= galvo_x;
        galvo_y <= galvo_y;
        current_x <= current_x;
        current_y <= current_y;
    end
endcase
```

- [ ] **Step 6: Implement manual galvo hold**

In the `ST_IDLE` branch, add this branch before legacy auto scan start:

```verilog
if ((cmd_start && scheduler_mode == MODE_MANUAL_GALVO_HOLD) ||
    (cmd_apply_manual && ((active_mode == MODE_MANUAL_GALVO_HOLD) || (active_mode == MODE_IDLE)))) begin
    active_mode <= MODE_MANUAL_GALVO_HOLD;
    scheduler_fsm_state <= SCHED_PARKED;
    manual_x_r <= manual_x;
    manual_y_r <= manual_y;
    current_x <= manual_x;
    current_y <= manual_y;
    galvo_x <= manual_x;
    galvo_y <= manual_y;
    busy <= 1'b0;
    parked <= 1'b1;
    sched_manual_update_count <= sched_manual_update_count + 32'd1;
    sched_control_snapshot <= scheduler_control;
    sched_period_active <= 32'd0;
end
```

- [ ] **Step 7: Implement pulse modes**

Add a pulse-mode branch for `MODE_CONTINUOUS_POINT_CAPTURE`, `MODE_MANUAL_PULSE_NO_CAPTURE`, and `MODE_GALVO_WAVEFORM_CAPTURE`. Use `pulse_period_r`, `pulse_ld_delay_r`, `pulse_ld_width_r`, `pulse_adc_delay_r`, and `pulse_adc_width_r`. Emit laser when LD is enabled and the slot counter is inside the LD window. Emit ADC/meta only when capture is enabled and ADC is enabled. Increment `sched_shot_count` on every accepted pulse slot and `sched_capture_count` when ADC/meta fires. Stop when `SHOT_LIMIT` is nonzero and reached.

Use this core branch for pulse-mode timing:

```verilog
if (scheduler_fsm_state == SCHED_PULSE || scheduler_fsm_state == SCHED_WAVEFORM) begin
    if (cmd_stop) begin
        graceful_stop_pending <= 1'b1;
    end

    if ((mode_requires_capture && ctrl_respect_downstream && overall_busy_pl) &&
        (pulse_slot_cnt == 32'd0)) begin
        debug_busy_hold_current_cycles <= debug_busy_hold_current_cycles + 32'd1;
        debug_busy_hold_cycles <= debug_busy_hold_cycles + 32'd1;
        if (!debug_waiting_on_busy_d)
            debug_busy_hold_events <= debug_busy_hold_events + 32'd1;
        if (debug_busy_hold_current_cycles + 32'd1 >= BUSY_TIMEOUT_CYCLES) begin
            debug_fault_latched <= 1'b1;
            debug_fault_code <= 32'd1;
            sched_fault_detail <= active_mode;
            scheduler_fsm_state <= SCHED_FAULT;
        end
    end else begin
        debug_busy_hold_current_cycles <= 32'd0;

        if ((pulse_slot_cnt >= pulse_ld_delay_r) &&
            (pulse_slot_cnt < pulse_ld_delay_r + pulse_ld_width_r) &&
            (pulse_ld_width_r != 32'd0) &&
            ctrl_ld_enable) begin
            laser_trigger <= 1'b1;
        end

        if ((pulse_slot_cnt >= pulse_adc_delay_r) &&
            (pulse_slot_cnt < pulse_adc_delay_r + pulse_adc_width_r) &&
            (pulse_adc_width_r != 32'd0) &&
            ctrl_adc_enable &&
            ctrl_capture_enable) begin
            adc_trigger <= (pulse_slot_cnt == pulse_adc_delay_r);
            meta_valid <= (pulse_slot_cnt == pulse_adc_delay_r);
            if (pulse_slot_cnt == pulse_adc_delay_r) begin
                sched_capture_count <= sched_capture_count + 32'd1;
                meta_data <= {
                    32'h4D455441,
                    task_id_r,
                    current_x,
                    current_y,
                    16'd0,
                    16'd0,
                    sched_shot_count[15:0],
                    shot_limit_r[15:0],
                    16'd0,
                    16'd0,
                    sched_shot_count,
                    32'h00000000
                };
            end
        end

        if (pulse_slot_cnt + 32'd1 >= pulse_period_r) begin
            pulse_slot_cnt <= 32'd0;
            sched_shot_count <= sched_shot_count + 32'd1;
            if ((shot_limit_r != 32'd0) && (sched_shot_count + 32'd1 >= shot_limit_r)) begin
                busy <= 1'b0;
                scheduler_fsm_state <= SCHED_PARKED;
                parked <= 1'b1;
                sched_park_count <= sched_park_count + 32'd1;
            end else if (graceful_stop_pending) begin
                busy <= 1'b0;
                scheduler_fsm_state <= SCHED_PARKED;
                parked <= 1'b1;
                sched_park_count <= sched_park_count + 32'd1;
            end
        end else begin
            pulse_slot_cnt <= pulse_slot_cnt + 32'd1;
        end
    end
end
```

- [ ] **Step 8: Implement generated waveform movement**

For waveform modes, update X/Y at each pulse period boundary:

```verilog
if (waveform_control_r[8]) begin
    if (waveform_control_r[3:0] == 4'd1) begin
        waveform_x_pos <= (waveform_x_pos + waveform_x_step_r > waveform_x_max_r) ? waveform_x_min_r : waveform_x_pos + waveform_x_step_r;
    end else if (waveform_control_r[3:0] == 4'd2) begin
        if (!waveform_x_dir && waveform_x_pos + waveform_x_step_r >= waveform_x_max_r) begin
            waveform_x_pos <= waveform_x_max_r;
            waveform_x_dir <= 1'b1;
            sched_waveform_cycle_count <= sched_waveform_cycle_count + 32'd1;
        end else if (waveform_x_dir && waveform_x_pos - waveform_x_step_r <= waveform_x_min_r) begin
            waveform_x_pos <= waveform_x_min_r;
            waveform_x_dir <= 1'b0;
            sched_waveform_cycle_count <= sched_waveform_cycle_count + 32'd1;
        end else begin
            waveform_x_pos <= waveform_x_dir ? waveform_x_pos - waveform_x_step_r : waveform_x_pos + waveform_x_step_r;
        end
    end else if (waveform_control_r[3:0] == 4'd3) begin
        waveform_x_pos <= (waveform_x_pos == waveform_x_min_r) ? waveform_x_max_r : waveform_x_min_r;
        sched_waveform_cycle_count <= sched_waveform_cycle_count + 32'd1;
    end
end
```

For Y movement, use:

```verilog
if (waveform_control_r[9]) begin
    if (waveform_control_r[7:4] == 4'd1) begin
        waveform_y_pos <= (waveform_y_pos + waveform_y_step_r > waveform_y_max_r) ? waveform_y_min_r : waveform_y_pos + waveform_y_step_r;
    end else if (waveform_control_r[7:4] == 4'd2) begin
        if (!waveform_y_dir && waveform_y_pos + waveform_y_step_r >= waveform_y_max_r) begin
            waveform_y_pos <= waveform_y_max_r;
            waveform_y_dir <= 1'b1;
            sched_waveform_cycle_count <= sched_waveform_cycle_count + 32'd1;
        end else if (waveform_y_dir && waveform_y_pos - waveform_y_step_r <= waveform_y_min_r) begin
            waveform_y_pos <= waveform_y_min_r;
            waveform_y_dir <= 1'b0;
            sched_waveform_cycle_count <= sched_waveform_cycle_count + 32'd1;
        end else begin
            waveform_y_pos <= waveform_y_dir ? waveform_y_pos - waveform_y_step_r : waveform_y_pos + waveform_y_step_r;
        end
    end else if (waveform_control_r[7:4] == 4'd3) begin
        waveform_y_pos <= (waveform_y_pos == waveform_y_min_r) ? waveform_y_max_r : waveform_y_min_r;
        sched_waveform_cycle_count <= sched_waveform_cycle_count + 32'd1;
    end
end
galvo_x <= waveform_control_r[8] ? waveform_x_pos : manual_x_r;
galvo_y <= waveform_control_r[9] ? waveform_y_pos : manual_y_r;
current_x <= waveform_control_r[8] ? waveform_x_pos : manual_x_r;
current_y <= waveform_control_r[9] ? waveform_y_pos : manual_y_r;
```

- [ ] **Step 9: Run HDL testbench**

Run:

```bash
cd /home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/IPs/ip_repo/axi_pam_image_acq_1_0
xvlog -sv hdl/pam_image_acq_controller_core.v tb/tb_pam_scheduler_modes.sv
xelab tb_pam_scheduler_modes -s tb_pam_scheduler_modes
xsim tb_pam_scheduler_modes -runall
```

Expected: `xvlog` and `xelab` exit 0, `xsim` prints `TB_PASS tb_pam_scheduler_modes`.

- [ ] **Step 10: Commit HDL core behavior**

```bash
git -C /home/qian/Portable_System_Project/Butterfly_Laser_Driver add /home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/IPs/ip_repo/axi_pam_image_acq_1_0/hdl/pam_image_acq_controller_core.v /home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/IPs/ip_repo/axi_pam_image_acq_1_0/tb/tb_pam_scheduler_modes.sv
git -C /home/qian/Portable_System_Project/Butterfly_Laser_Driver commit -m "feat: add PA scheduler core modes"
```

Expected: commit contains the core and testbench. If HDL files are outside the repo, keep the test output in the turn summary and skip the commit command.

---

### Task 3: AXI Register Bank and Wrapper Wiring

**Files:**
- Modify: `/home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/IPs/ip_repo/axi_pam_image_acq_1_0/hdl/axi_pam_image_acq_v1_0_S00_AXI.v`
- Modify: `/home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/IPs/ip_repo/axi_pam_image_acq_1_0/hdl/axi_pam_image_acq_v1_0.v`
- Test: `/home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/IPs/ip_repo/axi_pam_image_acq_1_0/tb/tb_pam_scheduler_modes.sv`

- [ ] **Step 1: Add register bank ports**

In `axi_pam_image_acq_v1_0_S00_AXI.v`, add outputs for scheduler writable fields and inputs for extended status. Use these exact signal names so the wrapper wiring is direct:

```verilog
        output wire [3:0]  scheduler_mode_out,
        output reg  [6:0]  scheduler_command_out,
        output wire [31:0] scheduler_control_out,
        output wire [31:0] scheduler_period_cycles_out,
        output wire signed [15:0] manual_x_out,
        output wire signed [15:0] manual_y_out,
        output wire [31:0] shot_limit_out,
        output wire [31:0] pulse_phase_cycles_out,
        output wire [31:0] manual_ld_delay_cycles_out,
        output wire [31:0] manual_ld_width_cycles_out,
        output wire [31:0] manual_adc_delay_cycles_out,
        output wire [31:0] manual_adc_width_cycles_out,
        output wire [31:0] waveform_control_out,
        output wire signed [15:0] waveform_x_min_out,
        output wire signed [15:0] waveform_x_max_out,
        output wire signed [15:0] waveform_y_min_out,
        output wire signed [15:0] waveform_y_max_out,
        output wire signed [15:0] waveform_x_step_out,
        output wire signed [15:0] waveform_y_step_out,
        input wire [31:0] sched_version_in,
        input wire [31:0] sched_state_in,
        input wire [31:0] sched_current_xy_in,
        input wire [31:0] sched_current_index_xy_in,
        input wire [31:0] sched_current_frame_in,
        input wire [31:0] sched_shot_count_in,
        input wire [31:0] sched_capture_count_in,
        input wire [31:0] sched_pixel_count_in,
        input wire [31:0] sched_command_count_in,
        input wire [31:0] sched_last_command_in,
        input wire [31:0] sched_stop_count_in,
        input wire [31:0] sched_park_count_in,
        input wire [31:0] sched_manual_update_count_in,
        input wire [31:0] sched_waveform_cycle_count_in,
        input wire [31:0] sched_fault_detail_in,
        input wire [31:0] sched_control_snapshot_in,
        input wire [31:0] sched_period_active_in,
```

- [ ] **Step 2: Make command output a one-cycle pulse**

In the AXI write always block, initialize `scheduler_command_out <= 7'd0` on reset and set it to zero at the top of the non-reset branch. When address index `6'h11` (`0x44`) is written, assign:

```verilog
scheduler_command_out <= S_AXI_WDATA[6:0];
```

Keep `slv_reg17` writable for readback if desired, but command reads must return zero in the read mux.

- [ ] **Step 3: Add writable register assignments**

Add these assignments at the bottom of the register bank:

```verilog
    assign scheduler_mode_out          = slv_reg16[3:0];
    assign scheduler_control_out       = slv_reg18;
    assign scheduler_period_cycles_out = slv_reg19;
    assign manual_x_out                = slv_reg20[15:0];
    assign manual_y_out                = slv_reg21[15:0];
    assign shot_limit_out              = slv_reg22;
    assign pulse_phase_cycles_out      = slv_reg23;
    assign manual_ld_delay_cycles_out  = slv_reg24;
    assign manual_ld_width_cycles_out  = slv_reg25;
    assign manual_adc_delay_cycles_out = slv_reg26;
    assign manual_adc_width_cycles_out = slv_reg27;
    assign waveform_control_out        = slv_reg28;
    assign waveform_x_min_out          = slv_reg29[15:0];
    assign waveform_x_max_out          = slv_reg29[31:16];
    assign waveform_y_min_out          = slv_reg30[15:0];
    assign waveform_y_max_out          = slv_reg30[31:16];
    assign waveform_x_step_out         = slv_reg31[15:0];
    assign waveform_y_step_out         = slv_reg31[31:16];
```

- [ ] **Step 4: Add read-only status mux entries**

In the read mux, preserve existing `6'h20-6'h2D` debug mappings and map:

```verilog
        6'h2E   : reg_data_out <= sched_version_in;
        6'h2F   : reg_data_out <= sched_state_in;
        6'h30   : reg_data_out <= sched_current_xy_in;
        6'h31   : reg_data_out <= sched_current_index_xy_in;
        6'h32   : reg_data_out <= sched_current_frame_in;
        6'h33   : reg_data_out <= sched_shot_count_in;
        6'h34   : reg_data_out <= sched_capture_count_in;
        6'h35   : reg_data_out <= sched_pixel_count_in;
        6'h36   : reg_data_out <= sched_command_count_in;
        6'h37   : reg_data_out <= sched_last_command_in;
        6'h38   : reg_data_out <= sched_stop_count_in;
        6'h39   : reg_data_out <= sched_park_count_in;
        6'h3A   : reg_data_out <= sched_manual_update_count_in;
        6'h3B   : reg_data_out <= sched_waveform_cycle_count_in;
        6'h3C   : reg_data_out <= sched_fault_detail_in;
        6'h3D   : reg_data_out <= sched_control_snapshot_in;
        6'h3E   : reg_data_out <= sched_period_active_in;
        6'h3F   : reg_data_out <= 32'd0;
```

- [ ] **Step 5: Wire wrapper signals**

In `axi_pam_image_acq_v1_0.v`, declare all scheduler wires using the names from Step 1, connect them between `reg_bank` and `controller`, and keep existing external ports unchanged.

- [ ] **Step 6: Compile full IP**

Run:

```bash
cd /home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/IPs/ip_repo/axi_pam_image_acq_1_0
xvlog -sv hdl/pam_image_acq_controller_core.v hdl/axi_pam_image_acq_v1_0_S00_AXI.v hdl/axi_pam_image_acq_v1_0.v tb/tb_pam_scheduler_modes.sv
```

Expected: exit 0.

- [ ] **Step 7: Commit AXI wiring**

```bash
git -C /home/qian/Portable_System_Project/Butterfly_Laser_Driver add /home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/IPs/ip_repo/axi_pam_image_acq_1_0/hdl/axi_pam_image_acq_v1_0_S00_AXI.v /home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/IPs/ip_repo/axi_pam_image_acq_1_0/hdl/axi_pam_image_acq_v1_0.v
git -C /home/qian/Portable_System_Project/Butterfly_Laser_Driver commit -m "feat: expose PA scheduler AXI registers"
```

Expected: commit contains only wrapper/register bank changes if the HDL tree is tracked.

---

### Task 4: Python Scheduler Register Model

**Files:**
- Modify: `/home/qian/Portable_System_Project/Butterfly_Laser_Driver/tests/test_pa_imaging_capture.py`
- Modify: `/home/qian/Portable_System_Project/Butterfly_Laser_Driver/pa_imaging_capture.py`

- [ ] **Step 1: Add failing Python tests for scheduler constants and packing**

Append to `PaProtocolTests` in `tests/test_pa_imaging_capture.py`:

```python
    def test_scheduler_config_packs_signed_and_packed_fields(self):
        config = pa.PamSchedulerConfig(
            mode=pa.PAM_SCHED_MODE_CONTINUOUS_POINT_CAPTURE,
            control=pa.PAM_SCHED_CTRL_LD_ENABLE
            | pa.PAM_SCHED_CTRL_ADC_ENABLE
            | pa.PAM_SCHED_CTRL_CAPTURE_ENABLE
            | pa.PAM_SCHED_CTRL_RESPECT_DOWNSTREAM_BUSY,
            period_cycles=1234,
            manual_x=-12,
            manual_y=34,
            shot_limit=99,
            ld_delay_cycles=2,
            ld_width_cycles=3,
            adc_delay_cycles=4,
            adc_width_cycles=1,
            waveform_x_min=-100,
            waveform_x_max=100,
            waveform_y_min=-50,
            waveform_y_max=50,
            waveform_x_step=5,
            waveform_y_step=-6,
        )

        values = config.register_values()

        self.assertEqual(values[pa.PAM_REG_SCHED_MODE], pa.PAM_SCHED_MODE_CONTINUOUS_POINT_CAPTURE)
        self.assertEqual(values[pa.PAM_REG_MANUAL_X], 0xFFF4)
        self.assertEqual(values[pa.PAM_REG_MANUAL_Y], 34)
        self.assertEqual(values[pa.PAM_REG_WAVEFORM_X_RANGE], 0x0064FF9C)
        self.assertEqual(values[pa.PAM_REG_WAVEFORM_Y_RANGE], 0x0032FFCE)
        self.assertEqual(values[pa.PAM_REG_WAVEFORM_STEP_XY], 0xFFFA0005)

    def test_scheduler_status_decodes_mode_flags_and_signed_xy(self):
        counters = {
            "sched_version": 0x0001007F,
            "sched_state": (
                pa.PAM_SCHED_MODE_MANUAL_PULSE_NO_CAPTURE
                | (2 << 4)
                | pa.PAM_SCHED_STATE_ACTIVE
                | pa.PAM_SCHED_STATE_RUNNING_WITHOUT_CAPTURE
            ),
            "sched_current_xy": 0xFFCE0064,
            "sched_shot_count": 7,
            "sched_capture_count": 0,
            "sched_fault_detail": 0,
        }

        status = pa.decode_scheduler_status(counters)

        self.assertEqual(status["mode"], pa.PAM_SCHED_MODE_MANUAL_PULSE_NO_CAPTURE)
        self.assertEqual(status["mode_name"], "manual_pulse_no_capture")
        self.assertEqual(status["fsm_state"], 2)
        self.assertTrue(status["active"])
        self.assertFalse(status["capture_required"])
        self.assertEqual(status["current_x"], 100)
        self.assertEqual(status["current_y"], -50)
        self.assertEqual(status["shot_count"], 7)
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
cd /home/qian/Portable_System_Project/Butterfly_Laser_Driver
python -m unittest tests.test_pa_imaging_capture.PaProtocolTests -v
```

Expected: FAIL because `PamSchedulerConfig` and scheduler constants do not exist.

- [ ] **Step 3: Add scheduler constants and dataclasses**

In `pa_imaging_capture.py`, add constants after existing PA register constants:

```python
PAM_REG_SCHED_MODE = 0x40
PAM_REG_SCHED_COMMAND = 0x44
PAM_REG_SCHED_CONTROL = 0x48
PAM_REG_SCHED_PERIOD_CYCLES = 0x4C
PAM_REG_MANUAL_X = 0x50
PAM_REG_MANUAL_Y = 0x54
PAM_REG_SHOT_LIMIT = 0x58
PAM_REG_PULSE_PHASE_CYCLES = 0x5C
PAM_REG_MANUAL_LD_DELAY_CYCLES = 0x60
PAM_REG_MANUAL_LD_WIDTH_CYCLES = 0x64
PAM_REG_MANUAL_ADC_DELAY_CYCLES = 0x68
PAM_REG_MANUAL_ADC_WIDTH_CYCLES = 0x6C
PAM_REG_WAVEFORM_CONTROL = 0x70
PAM_REG_WAVEFORM_X_RANGE = 0x74
PAM_REG_WAVEFORM_Y_RANGE = 0x78
PAM_REG_WAVEFORM_STEP_XY = 0x7C

PAM_REG_SCHED_VERSION = 0xB8
PAM_REG_SCHED_STATE = 0xBC
PAM_REG_SCHED_CURRENT_XY = 0xC0
PAM_REG_SCHED_CURRENT_INDEX_XY = 0xC4
PAM_REG_SCHED_CURRENT_FRAME = 0xC8
PAM_REG_SCHED_SHOT_COUNT = 0xCC
PAM_REG_SCHED_CAPTURE_COUNT = 0xD0
PAM_REG_SCHED_PIXEL_COUNT = 0xD4
PAM_REG_SCHED_COMMAND_COUNT = 0xD8
PAM_REG_SCHED_LAST_COMMAND = 0xDC
PAM_REG_SCHED_STOP_COUNT = 0xE0
PAM_REG_SCHED_PARK_COUNT = 0xE4
PAM_REG_SCHED_MANUAL_UPDATE_COUNT = 0xE8
PAM_REG_SCHED_WAVEFORM_CYCLE_COUNT = 0xEC
PAM_REG_SCHED_FAULT_DETAIL = 0xF0
PAM_REG_SCHED_CONTROL_SNAPSHOT = 0xF4
PAM_REG_SCHED_PERIOD_ACTIVE = 0xF8

PAM_SCHED_MODE_IDLE = 0
PAM_SCHED_MODE_AUTO_SCAN_CAPTURE = 1
PAM_SCHED_MODE_CONTINUOUS_POINT_CAPTURE = 2
PAM_SCHED_MODE_MANUAL_GALVO_HOLD = 3
PAM_SCHED_MODE_MANUAL_PULSE_NO_CAPTURE = 4
PAM_SCHED_MODE_GALVO_WAVEFORM_NO_CAPTURE = 5
PAM_SCHED_MODE_GALVO_WAVEFORM_CAPTURE = 6

PAM_SCHED_CMD_START = 1 << 0
PAM_SCHED_CMD_STOP = 1 << 1
PAM_SCHED_CMD_ABORT_AND_PARK = 1 << 2
PAM_SCHED_CMD_CLEAR_FAULT = 1 << 3
PAM_SCHED_CMD_APPLY_MANUAL = 1 << 4
PAM_SCHED_CMD_SINGLE_PULSE = 1 << 5
PAM_SCHED_CMD_SOFT_RESET_FSM = 1 << 6

PAM_SCHED_CTRL_LD_ENABLE = 1 << 0
PAM_SCHED_CTRL_ADC_ENABLE = 1 << 1
PAM_SCHED_CTRL_CAPTURE_ENABLE = 1 << 2
PAM_SCHED_CTRL_RESPECT_DOWNSTREAM_BUSY = 1 << 3
PAM_SCHED_CTRL_LOOP_ENABLE = 1 << 4
PAM_SCHED_CTRL_MANUAL_LIVE_UPDATE = 1 << 5

PAM_SCHED_STATE_ACTIVE = 1 << 8
PAM_SCHED_STATE_CAPTURE_REQUIRED = 1 << 9
PAM_SCHED_STATE_CAPTURE_ENABLED = 1 << 10
PAM_SCHED_STATE_RUNNING_WITHOUT_CAPTURE = 1 << 11
PAM_SCHED_STATE_PARKED = 1 << 12
PAM_SCHED_STATE_STOP_PENDING = 1 << 13
PAM_SCHED_STATE_ABORT_OBSERVED = 1 << 14
PAM_SCHED_STATE_FAULT_LATCHED = 1 << 15
```

Add helpers and dataclass near `PamCaptureParams`:

```python
PAM_SCHED_MODE_NAMES = {
    PAM_SCHED_MODE_IDLE: "idle",
    PAM_SCHED_MODE_AUTO_SCAN_CAPTURE: "auto_scan_capture",
    PAM_SCHED_MODE_CONTINUOUS_POINT_CAPTURE: "continuous_point_capture",
    PAM_SCHED_MODE_MANUAL_GALVO_HOLD: "manual_galvo_hold",
    PAM_SCHED_MODE_MANUAL_PULSE_NO_CAPTURE: "manual_pulse_no_capture",
    PAM_SCHED_MODE_GALVO_WAVEFORM_NO_CAPTURE: "galvo_waveform_no_capture",
    PAM_SCHED_MODE_GALVO_WAVEFORM_CAPTURE: "galvo_waveform_capture",
}

PAM_SCHED_STATUS_REGS = (
    ("sched_version", PAM_REG_SCHED_VERSION),
    ("sched_state", PAM_REG_SCHED_STATE),
    ("sched_current_xy", PAM_REG_SCHED_CURRENT_XY),
    ("sched_current_index_xy", PAM_REG_SCHED_CURRENT_INDEX_XY),
    ("sched_current_frame", PAM_REG_SCHED_CURRENT_FRAME),
    ("sched_shot_count", PAM_REG_SCHED_SHOT_COUNT),
    ("sched_capture_count", PAM_REG_SCHED_CAPTURE_COUNT),
    ("sched_pixel_count", PAM_REG_SCHED_PIXEL_COUNT),
    ("sched_command_count", PAM_REG_SCHED_COMMAND_COUNT),
    ("sched_last_command", PAM_REG_SCHED_LAST_COMMAND),
    ("sched_stop_count", PAM_REG_SCHED_STOP_COUNT),
    ("sched_park_count", PAM_REG_SCHED_PARK_COUNT),
    ("sched_manual_update_count", PAM_REG_SCHED_MANUAL_UPDATE_COUNT),
    ("sched_waveform_cycle_count", PAM_REG_SCHED_WAVEFORM_CYCLE_COUNT),
    ("sched_fault_detail", PAM_REG_SCHED_FAULT_DETAIL),
    ("sched_control_snapshot", PAM_REG_SCHED_CONTROL_SNAPSHOT),
    ("sched_period_active", PAM_REG_SCHED_PERIOD_ACTIVE),
)

def _s16(value):
    value = int(value) & 0xFFFF
    return value - 0x10000 if value & 0x8000 else value

def _pack_s16_pair(low, high):
    return _u16_bits(low) | (_u16_bits(high) << 16)

@dataclass(frozen=True)
class PamSchedulerConfig:
    mode: int = PAM_SCHED_MODE_IDLE
    control: int = 0
    period_cycles: int = 1
    manual_x: int = 0
    manual_y: int = 0
    shot_limit: int = 0
    pulse_phase_cycles: int = 0
    ld_delay_cycles: int = 0
    ld_width_cycles: int = 0
    adc_delay_cycles: int = 0
    adc_width_cycles: int = 1
    waveform_control: int = 0
    waveform_x_min: int = 0
    waveform_x_max: int = 0
    waveform_y_min: int = 0
    waveform_y_max: int = 0
    waveform_x_step: int = 0
    waveform_y_step: int = 0

    @classmethod
    def from_dict(cls, body):
        return cls(**{field.name: int(body.get(field.name, getattr(cls(), field.name))) for field in fields(cls)})

    def register_values(self):
        return {
            PAM_REG_SCHED_MODE: _u32(self.mode),
            PAM_REG_SCHED_CONTROL: _u32(self.control),
            PAM_REG_SCHED_PERIOD_CYCLES: _u32(max(1, self.period_cycles)),
            PAM_REG_MANUAL_X: _u16_bits(self.manual_x),
            PAM_REG_MANUAL_Y: _u16_bits(self.manual_y),
            PAM_REG_SHOT_LIMIT: _u32(self.shot_limit),
            PAM_REG_PULSE_PHASE_CYCLES: _u32(self.pulse_phase_cycles),
            PAM_REG_MANUAL_LD_DELAY_CYCLES: _u32(self.ld_delay_cycles),
            PAM_REG_MANUAL_LD_WIDTH_CYCLES: _u32(self.ld_width_cycles),
            PAM_REG_MANUAL_ADC_DELAY_CYCLES: _u32(self.adc_delay_cycles),
            PAM_REG_MANUAL_ADC_WIDTH_CYCLES: _u32(max(1, self.adc_width_cycles)),
            PAM_REG_WAVEFORM_CONTROL: _u32(self.waveform_control),
            PAM_REG_WAVEFORM_X_RANGE: _pack_s16_pair(self.waveform_x_min, self.waveform_x_max),
            PAM_REG_WAVEFORM_Y_RANGE: _pack_s16_pair(self.waveform_y_min, self.waveform_y_max),
            PAM_REG_WAVEFORM_STEP_XY: _pack_s16_pair(self.waveform_x_step, self.waveform_y_step),
        }
```

Ensure `fields` is imported from `dataclasses`.

- [ ] **Step 4: Add scheduler status decoding**

Add:

```python
def decode_scheduler_status(counters):
    state = int(counters.get("sched_state", 0) or 0)
    current_xy = int(counters.get("sched_current_xy", 0) or 0)
    current_index_xy = int(counters.get("sched_current_index_xy", 0) or 0)
    mode = state & 0xF
    return {
        "version": int(counters.get("sched_version", 0) or 0),
        "mode": mode,
        "mode_name": PAM_SCHED_MODE_NAMES.get(mode, f"unknown_{mode}"),
        "fsm_state": (state >> 4) & 0xF,
        "active": bool(state & PAM_SCHED_STATE_ACTIVE),
        "capture_required": bool(state & PAM_SCHED_STATE_CAPTURE_REQUIRED),
        "capture_enabled": bool(state & PAM_SCHED_STATE_CAPTURE_ENABLED),
        "running_without_capture": bool(state & PAM_SCHED_STATE_RUNNING_WITHOUT_CAPTURE),
        "parked": bool(state & PAM_SCHED_STATE_PARKED),
        "stop_pending": bool(state & PAM_SCHED_STATE_STOP_PENDING),
        "abort_observed": bool(state & PAM_SCHED_STATE_ABORT_OBSERVED),
        "fault_latched": bool(state & PAM_SCHED_STATE_FAULT_LATCHED),
        "current_x": _s16(current_xy & 0xFFFF),
        "current_y": _s16((current_xy >> 16) & 0xFFFF),
        "x_idx": current_index_xy & 0xFFFF,
        "y_idx": (current_index_xy >> 16) & 0xFFFF,
        "current_frame": int(counters.get("sched_current_frame", 0) or 0),
        "shot_count": int(counters.get("sched_shot_count", 0) or 0),
        "capture_count": int(counters.get("sched_capture_count", 0) or 0),
        "pixel_count": int(counters.get("sched_pixel_count", 0) or 0),
        "command_count": int(counters.get("sched_command_count", 0) or 0),
        "last_command": int(counters.get("sched_last_command", 0) or 0),
        "stop_count": int(counters.get("sched_stop_count", 0) or 0),
        "park_count": int(counters.get("sched_park_count", 0) or 0),
        "manual_update_count": int(counters.get("sched_manual_update_count", 0) or 0),
        "waveform_cycle_count": int(counters.get("sched_waveform_cycle_count", 0) or 0),
        "fault_detail": int(counters.get("sched_fault_detail", 0) or 0),
        "control_snapshot": int(counters.get("sched_control_snapshot", 0) or 0),
        "period_active": int(counters.get("sched_period_active", 0) or 0),
        "raw": dict(counters),
    }
```

- [ ] **Step 5: Run Python protocol tests**

Run:

```bash
cd /home/qian/Portable_System_Project/Butterfly_Laser_Driver
python -m unittest tests.test_pa_imaging_capture.PaProtocolTests -v
```

Expected: PASS.

- [ ] **Step 6: Commit Python model**

```bash
cd /home/qian/Portable_System_Project/Butterfly_Laser_Driver
git add pa_imaging_capture.py tests/test_pa_imaging_capture.py
git commit -m "feat: add PA scheduler register model"
```

Expected: commit includes register constants, dataclass, status decoder, and tests.

---

### Task 5: Python Scheduler Controller Commands

**Files:**
- Modify: `/home/qian/Portable_System_Project/Butterfly_Laser_Driver/tests/test_pa_imaging_capture.py`
- Modify: `/home/qian/Portable_System_Project/Butterfly_Laser_Driver/pa_imaging_capture.py`

- [ ] **Step 1: Add failing controller tests**

Append to `PaProtocolTests`:

```python
    def test_scheduler_controller_programs_config_and_pulses_start(self):
        regs = FakeRegs()
        controller = pa.PamSchedulerController(regs)
        config = pa.PamSchedulerConfig(
            mode=pa.PAM_SCHED_MODE_MANUAL_GALVO_HOLD,
            manual_x=11,
            manual_y=-12,
        )

        controller.program(config, verify=True)
        controller.command(pa.PAM_SCHED_CMD_START)

        self.assertIn((pa.PAM_REG_SCHED_MODE, pa.PAM_SCHED_MODE_MANUAL_GALVO_HOLD), regs.writes)
        self.assertIn((pa.PAM_REG_MANUAL_X, 11), regs.writes)
        self.assertIn((pa.PAM_REG_MANUAL_Y, 0xFFF4), regs.writes)
        self.assertEqual(regs.writes[-1], (pa.PAM_REG_SCHED_COMMAND, pa.PAM_SCHED_CMD_START))

    def test_scheduler_controller_abort_and_park_uses_new_command_and_legacy_start_low(self):
        regs = FakeRegs()
        controller = pa.PamSchedulerController(regs)

        controller.abort_and_park()

        self.assertIn((pa.PAM_REG_START, 0), regs.writes)
        self.assertIn((pa.PAM_REG_SCHED_COMMAND, pa.PAM_SCHED_CMD_ABORT_AND_PARK), regs.writes)
```

- [ ] **Step 2: Run tests and verify failure**

```bash
cd /home/qian/Portable_System_Project/Butterfly_Laser_Driver
python -m unittest tests.test_pa_imaging_capture.PaProtocolTests -v
```

Expected: FAIL because `PamSchedulerController` does not exist.

- [ ] **Step 3: Add controller**

Add below `PamAxiController`:

```python
class PamSchedulerController:
    def __init__(self, regs):
        self.regs = regs

    def program(self, config, verify=True):
        values = config.register_values()
        for offset in (
            PAM_REG_SCHED_MODE,
            PAM_REG_SCHED_CONTROL,
            PAM_REG_SCHED_PERIOD_CYCLES,
            PAM_REG_MANUAL_X,
            PAM_REG_MANUAL_Y,
            PAM_REG_SHOT_LIMIT,
            PAM_REG_PULSE_PHASE_CYCLES,
            PAM_REG_MANUAL_LD_DELAY_CYCLES,
            PAM_REG_MANUAL_LD_WIDTH_CYCLES,
            PAM_REG_MANUAL_ADC_DELAY_CYCLES,
            PAM_REG_MANUAL_ADC_WIDTH_CYCLES,
            PAM_REG_WAVEFORM_CONTROL,
            PAM_REG_WAVEFORM_X_RANGE,
            PAM_REG_WAVEFORM_Y_RANGE,
            PAM_REG_WAVEFORM_STEP_XY,
        ):
            value = values[offset]
            self.regs.write32(offset, value)
            if verify:
                readback = self.regs.read32(offset)
                if readback != value:
                    raise RuntimeError(f"PAM scheduler register 0x{offset:02X} readback mismatch")

    def command(self, command_bits):
        self.regs.write32(PAM_REG_SCHED_COMMAND, _u32(command_bits))

    def start(self):
        self.command(PAM_SCHED_CMD_START)

    def stop(self):
        self.command(PAM_SCHED_CMD_STOP)

    def abort_and_park(self):
        self.regs.write32(PAM_REG_START, 0)
        self.command(PAM_SCHED_CMD_ABORT_AND_PARK)

    def clear_fault(self):
        self.command(PAM_SCHED_CMD_CLEAR_FAULT)

    def apply_manual(self):
        self.command(PAM_SCHED_CMD_APPLY_MANUAL)

    def single_pulse(self):
        self.command(PAM_SCHED_CMD_SINGLE_PULSE)

    def read_scheduler_counters(self):
        return {name: self.regs.read32(offset) for name, offset in PAM_SCHED_STATUS_REGS}

    def status(self):
        return decode_scheduler_status(self.read_scheduler_counters())
```

- [ ] **Step 4: Run Python protocol tests**

```bash
cd /home/qian/Portable_System_Project/Butterfly_Laser_Driver
python -m unittest tests.test_pa_imaging_capture.PaProtocolTests -v
```

Expected: PASS.

- [ ] **Step 5: Commit scheduler controller**

```bash
cd /home/qian/Portable_System_Project/Butterfly_Laser_Driver
git add pa_imaging_capture.py tests/test_pa_imaging_capture.py
git commit -m "feat: add PA scheduler controller commands"
```

Expected: commit includes controller and tests.

---

### Task 6: Server Scheduler Service and Endpoints

**Files:**
- Modify: `/home/qian/Portable_System_Project/Butterfly_Laser_Driver/tests/test_tauri_server_defaults.py`
- Modify: `/home/qian/Portable_System_Project/Butterfly_Laser_Driver/butterfly_laser_server.py`
- Modify: `/home/qian/Portable_System_Project/Butterfly_Laser_Driver/pa_imaging_capture.py`

- [ ] **Step 1: Add failing server endpoint tests**

Add this helper class near the other fake PA test classes in
`tests/test_tauri_server_defaults.py`:

```python
class FakeRegs:
    def __init__(self):
        self.values = {}
        self.writes = []

    def read32(self, offset):
        return self.values.get(offset, 0)

    def write32(self, offset, value):
        self.values[offset] = value & 0xFFFFFFFF
        self.writes.append((offset, value & 0xFFFFFFFF))
```

Append to `TauriServerDefaultsTests`:

```python
    def test_pa_scheduler_endpoints_are_listed(self):
        handler, _server, replies = self.make_handler("/api/endpoints")

        handler.do_GET()

        endpoints = replies[-1]["endpoints"]
        self.assertIn("/api/pa/scheduler/status", endpoints)
        self.assertIn("/api/pa/scheduler/config", endpoints)
        self.assertIn("/api/pa/scheduler/command", endpoints)
        self.assertIn("/api/pa/scheduler/manual-position", endpoints)
        self.assertIn("/api/pa/scheduler/pulse", endpoints)
        self.assertIn("/api/pa/scheduler/waveform", endpoints)

    def test_manual_scheduler_command_does_not_require_tcp_client(self):
        body = b'{"x": 123, "y": -45}'
        handler, server, replies = self.make_handler("/api/pa/scheduler/manual-position", method="POST", body=body)
        regs = FakeRegs()
        server.pa_scheduler = legacy.PaSchedulerService(regs)

        handler.do_POST()

        self.assertTrue(replies[-1]["ok"])
        self.assertIn((pa.PAM_REG_MANUAL_X, 123), regs.writes)
        self.assertIn((pa.PAM_REG_MANUAL_Y, 0xFFD3), regs.writes)
        self.assertIn((pa.PAM_REG_SCHED_COMMAND, pa.PAM_SCHED_CMD_APPLY_MANUAL), regs.writes)

    def test_auto_pa_start_programs_scheduler_mode_before_capture_worker(self):
        handler, server, replies = self.make_handler("/api/pa/start", method="POST", body=b'{"params":{"x_points":1,"y_points":1,"frame_number":1},"expected_frames":1}')
        regs = FakeRegs()
        server.pa_service.writer = FakePaWriter()
        server.pa_scheduler = legacy.PaSchedulerService(regs)

        handler.do_POST()

        self.assertTrue(replies[-1]["ok"])
        self.assertIn((pa.PAM_REG_SCHED_MODE, pa.PAM_SCHED_MODE_AUTO_SCAN_CAPTURE), regs.writes)
```

- [ ] **Step 2: Run server tests and verify failure**

```bash
cd /home/qian/Portable_System_Project/Butterfly_Laser_Driver
python -m unittest tests.test_tauri_server_defaults.TauriServerDefaultsTests -v
```

Expected: FAIL because scheduler endpoints and `PaSchedulerService` do not exist.

- [ ] **Step 3: Add `PaSchedulerService`**

In `butterfly_laser_server.py`, import `PamSchedulerConfig`, `PamSchedulerController`, and scheduler constants from `pa_imaging_capture.py`. Add:

```python
class PaSchedulerService:
    def __init__(self, pam_regs, controller_factory=PamSchedulerController):
        self.pam_regs = pam_regs
        self.controller_factory = controller_factory
        self.lock = threading.RLock()
        self.last_config = None
        self.last_error = ""

    def controller(self):
        return self.controller_factory(self.pam_regs)

    def configure(self, config):
        with self.lock:
            self.controller().program(config)
            self.last_config = config.to_dict() if hasattr(config, "to_dict") else asdict(config)
            self.last_error = ""
            return self.status()

    def command(self, command_bits):
        with self.lock:
            self.controller().command(command_bits)
            self.last_error = ""
            return self.status()

    def manual_position(self, x, y):
        config = PamSchedulerConfig(
            mode=PAM_SCHED_MODE_MANUAL_GALVO_HOLD,
            control=PAM_SCHED_CTRL_LD_ENABLE | (2 << 8),
            manual_x=int(x),
            manual_y=int(y),
        )
        with self.lock:
            ctl = self.controller()
            ctl.program(config)
            ctl.apply_manual()
            self.last_config = asdict(config)
            self.last_error = ""
            return self.status()

    def abort_and_park(self):
        with self.lock:
            self.controller().abort_and_park()
            self.last_error = ""
            return self.status()

    def status(self):
        with self.lock:
            try:
                status = self.controller().status()
            except Exception as exc:
                self.last_error = str(exc)
                status = {"available": False, "error": str(exc)}
            status["last_error"] = self.last_error
            status["last_config"] = self.last_config
            return status
```

Import `asdict` from `dataclasses` if not already present.

- [ ] **Step 4: Initialize scheduler service**

Where `pa_service` is created on the server object, add:

```python
self.pa_scheduler = PaSchedulerService(self.pam_regs)
```

Use the same register object passed to `PaCaptureService`.

- [ ] **Step 5: Add endpoints to `/api/endpoints` and handlers**

Add the six scheduler endpoint strings to the endpoint list. Extend `handle_pa_post`:

```python
        elif path == "/api/pa/scheduler/config":
            config = PamSchedulerConfig.from_dict(body.get("config", body))
            self.reply_json({"ok": True, "scheduler": self.server.pa_scheduler.configure(config)})
        elif path == "/api/pa/scheduler/command":
            command = body_int(body, "command", 0)
            self.reply_json({"ok": True, "scheduler": self.server.pa_scheduler.command(command)})
        elif path == "/api/pa/scheduler/manual-position":
            self.reply_json({"ok": True, "scheduler": self.server.pa_scheduler.manual_position(body_int(body, "x", 0), body_int(body, "y", 0))})
        elif path == "/api/pa/scheduler/pulse":
            config = PamSchedulerConfig.from_dict({
                **body,
                "mode": PAM_SCHED_MODE_MANUAL_PULSE_NO_CAPTURE,
                "control": PAM_SCHED_CTRL_LD_ENABLE | PAM_SCHED_CTRL_LOOP_ENABLE | (2 << 8),
            })
            self.server.pa_scheduler.configure(config)
            command = PAM_SCHED_CMD_SINGLE_PULSE if bool_body(body, "single", False) else PAM_SCHED_CMD_START
            self.reply_json({"ok": True, "scheduler": self.server.pa_scheduler.command(command)})
        elif path == "/api/pa/scheduler/waveform":
            config = PamSchedulerConfig.from_dict({
                **body,
                "mode": body_int(body, "mode", PAM_SCHED_MODE_GALVO_WAVEFORM_NO_CAPTURE),
                "control": body_int(body, "control", PAM_SCHED_CTRL_LD_ENABLE | PAM_SCHED_CTRL_LOOP_ENABLE | (2 << 8)),
            })
            self.server.pa_scheduler.configure(config)
            self.reply_json({"ok": True, "scheduler": self.server.pa_scheduler.command(PAM_SCHED_CMD_START)})
```

In `do_GET`, add:

```python
            elif parsed.path == "/api/pa/scheduler/status":
                self.reply_json({"ok": True, "scheduler": self.server.pa_scheduler.status()})
```

- [ ] **Step 6: Integrate compatibility auto scan start and stop**

Before `pa_service.start(...)` inside `/api/pa/start`, program scheduler mode:

```python
self.server.pa_scheduler.configure(PamSchedulerConfig(
    mode=PAM_SCHED_MODE_AUTO_SCAN_CAPTURE,
    control=PAM_SCHED_CTRL_LD_ENABLE
    | PAM_SCHED_CTRL_ADC_ENABLE
    | PAM_SCHED_CTRL_CAPTURE_ENABLE
    | PAM_SCHED_CTRL_RESPECT_DOWNSTREAM_BUSY,
))
```

Before existing PA stop/disconnect and `/api/stop-all` stop path, call:

```python
self.server.pa_scheduler.abort_and_park()
```

- [ ] **Step 7: Run server tests**

```bash
cd /home/qian/Portable_System_Project/Butterfly_Laser_Driver
python -m unittest tests.test_tauri_server_defaults.TauriServerDefaultsTests -v
```

Expected: PASS.

- [ ] **Step 8: Commit server scheduler API**

```bash
cd /home/qian/Portable_System_Project/Butterfly_Laser_Driver
git add butterfly_laser_server.py pa_imaging_capture.py tests/test_tauri_server_defaults.py
git commit -m "feat: add PA scheduler server API"
```

Expected: commit includes server service, endpoint tests, and compatibility start/stop integration.

---

### Task 7: Tauri API Types and Client

**Files:**
- Modify: `/home/qian/Portable_System_Project/Butterfly_Laser_Driver/tauri_control_console/src/api/types.ts`
- Modify: `/home/qian/Portable_System_Project/Butterfly_Laser_Driver/tauri_control_console/src/api/client.ts`
- Create: `/home/qian/Portable_System_Project/Butterfly_Laser_Driver/tauri_control_console/src/__tests__/paScheduler.test.ts`

- [ ] **Step 1: Add failing TypeScript API tests**

Create `tauri_control_console/src/__tests__/paScheduler.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";
import { ApiClient } from "../api/client";

describe("PA scheduler API client", () => {
  it("sends manual position without PA capture fields", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, scheduler: { mode_name: "manual_galvo_hold" } }),
    });
    const client = new ApiClient("http://board", fetchMock as unknown as typeof fetch);

    await client.paSchedulerManualPosition(12, -34);

    expect(fetchMock).toHaveBeenCalledWith(
      "http://board/api/pa/scheduler/manual-position",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ x: 12, y: -34 }),
      }),
    );
  });

  it("formats scheduler config for point capture", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, scheduler: { mode_name: "continuous_point_capture" } }),
    });
    const client = new ApiClient("http://board", fetchMock as unknown as typeof fetch);

    await client.paSchedulerConfig({
      mode: 2,
      control: 15,
      period_cycles: 30000,
      manual_x: 100,
      manual_y: 200,
      shot_limit: 10,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://board/api/pa/scheduler/config",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          config: {
            mode: 2,
            control: 15,
            period_cycles: 30000,
            manual_x: 100,
            manual_y: 200,
            shot_limit: 10,
          },
        }),
      }),
    );
  });
});
```

- [ ] **Step 2: Run tests and verify failure**

```bash
cd /home/qian/Portable_System_Project/Butterfly_Laser_Driver/tauri_control_console
PATH=/home/qian/.local/nodejs/bin:$PATH npm test -- paScheduler.test.ts
```

Expected: FAIL because scheduler client methods do not exist.

- [ ] **Step 3: Add TypeScript types**

In `types.ts`, add:

```typescript
export type PaSchedulerConfig = {
  mode: number;
  control?: number;
  period_cycles?: number;
  manual_x?: number;
  manual_y?: number;
  shot_limit?: number;
  pulse_phase_cycles?: number;
  ld_delay_cycles?: number;
  ld_width_cycles?: number;
  adc_delay_cycles?: number;
  adc_width_cycles?: number;
  waveform_control?: number;
  waveform_x_min?: number;
  waveform_x_max?: number;
  waveform_y_min?: number;
  waveform_y_max?: number;
  waveform_x_step?: number;
  waveform_y_step?: number;
};

export type PaSchedulerStatus = {
  available?: boolean;
  version?: number;
  mode?: number;
  mode_name?: string;
  fsm_state?: number;
  active?: boolean;
  capture_required?: boolean;
  capture_enabled?: boolean;
  running_without_capture?: boolean;
  parked?: boolean;
  stop_pending?: boolean;
  abort_observed?: boolean;
  fault_latched?: boolean;
  current_x?: number;
  current_y?: number;
  x_idx?: number;
  y_idx?: number;
  current_frame?: number;
  shot_count?: number;
  capture_count?: number;
  pixel_count?: number;
  command_count?: number;
  stop_count?: number;
  park_count?: number;
  manual_update_count?: number;
  waveform_cycle_count?: number;
  fault_detail?: number;
  last_error?: string;
  last_config?: PaSchedulerConfig | null;
  error?: string;
};
```

- [ ] **Step 4: Add client methods**

In `client.ts`, import `PaSchedulerConfig` and `PaSchedulerStatus`, then add methods:

```typescript
  paSchedulerStatus(): Promise<{ ok: true; scheduler: PaSchedulerStatus }> {
    return this.get("/api/pa/scheduler/status", { timeoutMs: 4_000 });
  }

  paSchedulerConfig(config: PaSchedulerConfig): Promise<{ ok: true; scheduler: PaSchedulerStatus }> {
    return this.post("/api/pa/scheduler/config", { config }, { timeoutMs: 8_000 });
  }

  paSchedulerCommand(command: number): Promise<{ ok: true; scheduler: PaSchedulerStatus }> {
    return this.post("/api/pa/scheduler/command", { command }, { timeoutMs: 8_000 });
  }

  paSchedulerManualPosition(x: number, y: number): Promise<{ ok: true; scheduler: PaSchedulerStatus }> {
    return this.post("/api/pa/scheduler/manual-position", { x, y }, { timeoutMs: 8_000 });
  }

  paSchedulerPulse(body: Record<string, unknown>): Promise<{ ok: true; scheduler: PaSchedulerStatus }> {
    return this.post("/api/pa/scheduler/pulse", body, { timeoutMs: 8_000 });
  }

  paSchedulerWaveform(body: Record<string, unknown>): Promise<{ ok: true; scheduler: PaSchedulerStatus }> {
    return this.post("/api/pa/scheduler/waveform", body, { timeoutMs: 8_000 });
  }
```

- [ ] **Step 5: Run API tests**

```bash
cd /home/qian/Portable_System_Project/Butterfly_Laser_Driver/tauri_control_console
PATH=/home/qian/.local/nodejs/bin:$PATH npm test -- paScheduler.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Tauri API**

```bash
cd /home/qian/Portable_System_Project/Butterfly_Laser_Driver
git add tauri_control_console/src/api/types.ts tauri_control_console/src/api/client.ts tauri_control_console/src/__tests__/paScheduler.test.ts
git commit -m "feat: add PA scheduler Tauri API"
```

Expected: commit includes types, client methods, and tests.

---

### Task 8: Tauri Scheduler UI

**Files:**
- Create: `/home/qian/Portable_System_Project/Butterfly_Laser_Driver/tauri_control_console/src/utils/paScheduler.ts`
- Modify: `/home/qian/Portable_System_Project/Butterfly_Laser_Driver/tauri_control_console/src/components/PaImagingPanel.tsx`
- Modify: `/home/qian/Portable_System_Project/Butterfly_Laser_Driver/tauri_control_console/src/styles.css`
- Modify: `/home/qian/Portable_System_Project/Butterfly_Laser_Driver/tauri_control_console/src/__tests__/paImagingPanelLayout.test.tsx`

- [ ] **Step 1: Add failing layout tests**

In `paImagingPanelLayout.test.tsx`, add tests that render `PaImagingPanel` and assert:

```typescript
it("renders PA scheduler mode tabs and abort park action", () => {
  const html = renderToStaticMarkup(<PaImagingPanel state={state} client={client} command={command} />);

  expect(html).toContain("PA Scheduler");
  expect(html).toContain("Auto Scan Capture");
  expect(html).toContain("Point Capture");
  expect(html).toContain("Manual Control");
  expect(html).toContain("Waveform");
  expect(html).toContain("Diagnostics");
  expect(html).toContain("Abort &amp; Park");
});

it("explains that manual control does not require capture", () => {
  const html = renderToStaticMarkup(<PaImagingPanel state={state} client={client} command={command} initialSchedulerTab="manual" />);

  expect(html).toContain("Capture chain not required");
  expect(html).toContain("Manual X");
  expect(html).toContain("Manual Y");
  expect(html).toContain("Single Pulse");
});
```

The implementation step below adds `initialSchedulerTab` to `PaImagingPanelProps`; the second test depends on that prop.

- [ ] **Step 2: Run layout tests and verify failure**

```bash
cd /home/qian/Portable_System_Project/Butterfly_Laser_Driver/tauri_control_console
PATH=/home/qian/.local/nodejs/bin:$PATH npm test -- paImagingPanelLayout.test.tsx
```

Expected: FAIL because scheduler tabs are not rendered.

- [ ] **Step 3: Add scheduler utility helpers**

Create `src/utils/paScheduler.ts`:

```typescript
import type { PaSchedulerStatus } from "../api/types";

export const PA_SCHED_CMD_ABORT_AND_PARK = 1 << 2;
export const PA_SCHED_CMD_START = 1 << 0;
export const PA_SCHED_CMD_STOP = 1 << 1;
export const PA_SCHED_CMD_SINGLE_PULSE = 1 << 5;

export const PA_SCHED_CTRL_LD_ENABLE = 1 << 0;
export const PA_SCHED_CTRL_ADC_ENABLE = 1 << 1;
export const PA_SCHED_CTRL_CAPTURE_ENABLE = 1 << 2;
export const PA_SCHED_CTRL_RESPECT_DOWNSTREAM_BUSY = 1 << 3;
export const PA_SCHED_CTRL_LOOP_ENABLE = 1 << 4;
export const PA_SCHED_CTRL_MANUAL_LIVE_UPDATE = 1 << 5;

export function schedulerModeLabel(status: PaSchedulerStatus | null | undefined): string {
  const name = status?.mode_name;
  if (!name) return "unknown";
  return name
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function schedulerCaptureText(status: PaSchedulerStatus | null | undefined): string {
  if (status?.capture_required) return "Capture chain required";
  return "Capture chain not required";
}

export function formatSchedulerPosition(status: PaSchedulerStatus | null | undefined): string {
  const x = status?.current_x ?? 0;
  const y = status?.current_y ?? 0;
  return `X ${x}, Y ${y}`;
}
```

- [ ] **Step 4: Add scheduler state and polling to `PaImagingPanel`**

In `PaImagingPanel.tsx`, add:

```typescript
type PaSchedulerTab = "auto" | "point" | "manual" | "waveform" | "diagnostics";
```

Extend props:

```typescript
initialSchedulerTab?: PaSchedulerTab;
```

Add state:

```typescript
const [schedulerTab, setSchedulerTab] = useState<PaSchedulerTab>(initialSchedulerTab ?? "auto");
const [schedulerStatus, setSchedulerStatus] = useState<PaSchedulerStatus | null>(null);
const [manualX, setManualX] = useState("0");
const [manualY, setManualY] = useState("0");
const [pointRateHz, setPointRateHz] = useState("3000");
const [pointShots, setPointShots] = useState("0");
const [waveformXMin, setWaveformXMin] = useState("-100");
const [waveformXMax, setWaveformXMax] = useState("100");
const [waveformYMin, setWaveformYMin] = useState("0");
const [waveformYMax, setWaveformYMax] = useState("0");
const [waveformXStep, setWaveformXStep] = useState("1");
const [waveformYStep, setWaveformYStep] = useState("0");
const [waveformRateHz, setWaveformRateHz] = useState("1000");
```

Poll status beside existing PA diagnostics polling:

```typescript
const schedulerResponse = await client.paSchedulerStatus();
setSchedulerStatus(schedulerResponse.scheduler);
```

- [ ] **Step 5: Add top scheduler band and tabs**

Render a top section with:

```tsx
<section className="pa-scheduler-shell">
  <div className="pa-scheduler-header">
    <div>
      <h2>PA Scheduler</h2>
      <small>{schedulerCaptureText(schedulerStatus)} · {formatSchedulerPosition(schedulerStatus)}</small>
    </div>
    <button className="danger" onClick={() => client.paSchedulerCommand(PA_SCHED_CMD_ABORT_AND_PARK)}>
      Abort &amp; Park
    </button>
  </div>
  <div className="segmented pa-scheduler-tabs">
    <button className={schedulerTab === "auto" ? "active" : ""} onClick={() => setSchedulerTab("auto")}>Auto Scan Capture</button>
    <button className={schedulerTab === "point" ? "active" : ""} onClick={() => setSchedulerTab("point")}>Point Capture</button>
    <button className={schedulerTab === "manual" ? "active" : ""} onClick={() => setSchedulerTab("manual")}>Manual Control</button>
    <button className={schedulerTab === "waveform" ? "active" : ""} onClick={() => setSchedulerTab("waveform")}>Waveform</button>
    <button className={schedulerTab === "diagnostics" ? "active" : ""} onClick={() => setSchedulerTab("diagnostics")}>Diagnostics</button>
  </div>
</section>
```

Keep the current scan settings under `schedulerTab === "auto"`.

- [ ] **Step 6: Add Manual Control tab controls**

Render manual controls when `schedulerTab === "manual"`:

```tsx
<section className="pa-mode-panel">
  <div className="field-grid">
    <label>
      <span>Manual X</span>
      <input value={manualX} onChange={(event) => setManualX(event.target.value)} />
    </label>
    <label>
      <span>Manual Y</span>
      <input value={manualY} onChange={(event) => setManualY(event.target.value)} />
    </label>
  </div>
  <div className="button-row">
    <button onClick={() => client.paSchedulerManualPosition(numberFromText(manualX), numberFromText(manualY))}>Apply Position</button>
    <button onClick={() => client.paSchedulerPulse({ manual_x: numberFromText(manualX), manual_y: numberFromText(manualY), single: true })}>Single Pulse</button>
    <button onClick={() => client.paSchedulerCommand(PA_SCHED_CMD_STOP)}>Stop</button>
  </div>
  <p className="muted">Capture chain not required</p>
</section>
```

- [ ] **Step 7: Add Point Capture and Waveform tab controls**

For Point Capture, render manual X/Y, repetition rate, shot limit, start, and stop. Use:

```typescript
const pointPeriodCycles = Math.max(1, Math.round(100_000_000 / Math.max(1, Number(pointRateHz) || 1)));
```

Start with:

```typescript
client.paSchedulerConfig({
  mode: 2,
  control: PA_SCHED_CTRL_LD_ENABLE | PA_SCHED_CTRL_ADC_ENABLE | PA_SCHED_CTRL_CAPTURE_ENABLE | PA_SCHED_CTRL_RESPECT_DOWNSTREAM_BUSY | PA_SCHED_CTRL_LOOP_ENABLE | PA_SCHED_CTRL_MANUAL_LIVE_UPDATE,
  period_cycles: pointPeriodCycles,
  manual_x: numberFromText(manualX),
  manual_y: numberFromText(manualY),
  shot_limit: Math.max(0, numberFromText(pointShots)),
  ld_delay_cycles: timingCounts.ld_trigger_time,
  ld_width_cycles: timingCounts.ld_time,
  adc_delay_cycles: timingCounts.adc_trigger_time,
  adc_width_cycles: 1,
}).then(() => client.paSchedulerCommand(PA_SCHED_CMD_START));
```

For Waveform, render numeric inputs for X/Y min/max, X/Y step, and rate. Add Start/Stop buttons with:

```tsx
const waveformPeriodCycles = Math.max(1, Math.round(100_000_000 / Math.max(1, Number(waveformRateHz) || 1)));

const startWaveform = () =>
  client.paSchedulerWaveform({
    mode: 5,
    control: PA_SCHED_CTRL_LD_ENABLE | PA_SCHED_CTRL_LOOP_ENABLE | (2 << 8),
    period_cycles: waveformPeriodCycles,
    waveform_control: 0x00000101,
    waveform_x_min: numberFromText(waveformXMin),
    waveform_x_max: numberFromText(waveformXMax),
    waveform_y_min: numberFromText(waveformYMin),
    waveform_y_max: numberFromText(waveformYMax),
    waveform_x_step: numberFromText(waveformXStep),
    waveform_y_step: numberFromText(waveformYStep),
  });
```

Render the panel:

```tsx
<section className="pa-mode-panel">
  <div className="field-grid">
    <label><span>X Min</span><input value={waveformXMin} onChange={(event) => setWaveformXMin(event.target.value)} /></label>
    <label><span>X Max</span><input value={waveformXMax} onChange={(event) => setWaveformXMax(event.target.value)} /></label>
    <label><span>Y Min</span><input value={waveformYMin} onChange={(event) => setWaveformYMin(event.target.value)} /></label>
    <label><span>Y Max</span><input value={waveformYMax} onChange={(event) => setWaveformYMax(event.target.value)} /></label>
    <label><span>X Step</span><input value={waveformXStep} onChange={(event) => setWaveformXStep(event.target.value)} /></label>
    <label><span>Y Step</span><input value={waveformYStep} onChange={(event) => setWaveformYStep(event.target.value)} /></label>
    <label><span>Rate Hz</span><input value={waveformRateHz} onChange={(event) => setWaveformRateHz(event.target.value)} /></label>
  </div>
  <div className="button-row">
    <button onClick={startWaveform}>Start Waveform</button>
    <button onClick={() => client.paSchedulerCommand(PA_SCHED_CMD_STOP)}>Stop</button>
  </div>
  <p className="muted">Capture chain not required</p>
</section>
```

- [ ] **Step 8: Add Diagnostics tab**

Render `schedulerStatus` fields:

```tsx
<dl className="diagnostic-grid">
  <dt>Mode</dt><dd>{schedulerModeLabel(schedulerStatus)}</dd>
  <dt>State</dt><dd>{schedulerStatus?.fsm_state ?? 0}</dd>
  <dt>Shots</dt><dd>{schedulerStatus?.shot_count ?? 0}</dd>
  <dt>Captures</dt><dd>{schedulerStatus?.capture_count ?? 0}</dd>
  <dt>Fault</dt><dd>{schedulerStatus?.fault_latched ? schedulerStatus.fault_detail ?? 0 : "none"}</dd>
</dl>
```

- [ ] **Step 9: Add CSS**

In `styles.css`, add:

```css
.pa-scheduler-shell {
  border: 1px solid #c8d6ea;
  border-radius: 8px;
  padding: 12px;
  background: #f8fbff;
}

.pa-scheduler-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.pa-scheduler-tabs {
  margin-top: 12px;
  flex-wrap: wrap;
}

.pa-mode-panel {
  border: 1px solid #d4e0f0;
  border-radius: 8px;
  padding: 12px;
  background: #fff;
}

.button-row {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  align-items: center;
}

.diagnostic-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(120px, 1fr));
  gap: 8px 14px;
}
```

- [ ] **Step 10: Run UI tests**

```bash
cd /home/qian/Portable_System_Project/Butterfly_Laser_Driver/tauri_control_console
PATH=/home/qian/.local/nodejs/bin:$PATH npm test -- paScheduler.test.ts paImagingPanelLayout.test.tsx
```

Expected: PASS.

- [ ] **Step 11: Commit scheduler UI**

```bash
cd /home/qian/Portable_System_Project/Butterfly_Laser_Driver
git add tauri_control_console/src/utils/paScheduler.ts tauri_control_console/src/components/PaImagingPanel.tsx tauri_control_console/src/styles.css tauri_control_console/src/__tests__/paImagingPanelLayout.test.tsx
git commit -m "feat: add PA scheduler UI modes"
```

Expected: commit includes UI and layout tests.

---

### Task 9: Sync Generated HDL Copies

**Files:**
- Copy from: `/home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/IPs/ip_repo/axi_pam_image_acq_1_0/hdl/`
- Copy to: `/home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/hardware/xilinx-k26-som-2023.2/xilinx-k26-som-2023.2.gen/sources_1/bd/project_1/ipshared/3aba/hdl/`
- Copy to: `/home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/hardware/xilinx-k26-som-2023.2/xilinx-k26-som-2023.2.ip_user_files/bd/project_1/ipshared/3aba/hdl/`

- [ ] **Step 1: Copy canonical HDL into generated IP shared trees**

Run:

```bash
cp /home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/IPs/ip_repo/axi_pam_image_acq_1_0/hdl/pam_image_acq_controller_core.v /home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/hardware/xilinx-k26-som-2023.2/xilinx-k26-som-2023.2.gen/sources_1/bd/project_1/ipshared/3aba/hdl/pam_image_acq_controller_core.v
cp /home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/IPs/ip_repo/axi_pam_image_acq_1_0/hdl/axi_pam_image_acq_v1_0_S00_AXI.v /home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/hardware/xilinx-k26-som-2023.2/xilinx-k26-som-2023.2.gen/sources_1/bd/project_1/ipshared/3aba/hdl/axi_pam_image_acq_v1_0_S00_AXI.v
cp /home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/IPs/ip_repo/axi_pam_image_acq_1_0/hdl/axi_pam_image_acq_v1_0.v /home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/hardware/xilinx-k26-som-2023.2/xilinx-k26-som-2023.2.gen/sources_1/bd/project_1/ipshared/3aba/hdl/axi_pam_image_acq_v1_0.v
cp /home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/IPs/ip_repo/axi_pam_image_acq_1_0/hdl/pam_image_acq_controller_core.v /home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/hardware/xilinx-k26-som-2023.2/xilinx-k26-som-2023.2.ip_user_files/bd/project_1/ipshared/3aba/hdl/pam_image_acq_controller_core.v
cp /home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/IPs/ip_repo/axi_pam_image_acq_1_0/hdl/axi_pam_image_acq_v1_0_S00_AXI.v /home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/hardware/xilinx-k26-som-2023.2/xilinx-k26-som-2023.2.ip_user_files/bd/project_1/ipshared/3aba/hdl/axi_pam_image_acq_v1_0_S00_AXI.v
cp /home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/IPs/ip_repo/axi_pam_image_acq_1_0/hdl/axi_pam_image_acq_v1_0.v /home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/hardware/xilinx-k26-som-2023.2/xilinx-k26-som-2023.2.ip_user_files/bd/project_1/ipshared/3aba/hdl/axi_pam_image_acq_v1_0.v
```

Expected: all six copy commands exit 0.

- [ ] **Step 2: Compile generated copies**

Run:

```bash
timeout 20s xvlog -sv /home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/hardware/xilinx-k26-som-2023.2/xilinx-k26-som-2023.2.gen/sources_1/bd/project_1/ipshared/3aba/hdl/pam_image_acq_controller_core.v /home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/hardware/xilinx-k26-som-2023.2/xilinx-k26-som-2023.2.gen/sources_1/bd/project_1/ipshared/3aba/hdl/axi_pam_image_acq_v1_0_S00_AXI.v /home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/hardware/xilinx-k26-som-2023.2/xilinx-k26-som-2023.2.gen/sources_1/bd/project_1/ipshared/3aba/hdl/axi_pam_image_acq_v1_0.v
```

Expected: exit 0.

- [ ] **Step 3: Commit generated copy sync**

```bash
cd /home/qian/Portable_System_Project/Butterfly_Laser_Driver
git add /home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/hardware/xilinx-k26-som-2023.2/xilinx-k26-som-2023.2.gen/sources_1/bd/project_1/ipshared/3aba/hdl /home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/hardware/xilinx-k26-som-2023.2/xilinx-k26-som-2023.2.ip_user_files/bd/project_1/ipshared/3aba/hdl
git commit -m "chore: sync PA scheduler generated HDL copies"
```

Expected: commit contains generated HDL copies if they are tracked. If they are outside the repo, report the copied paths and skip commit.

---

### Task 10: Full Verification and Board-Ready Summary

**Files:**
- Read current worktree and test outputs.

- [ ] **Step 1: Run Python PA tests**

```bash
cd /home/qian/Portable_System_Project/Butterfly_Laser_Driver
python -m unittest tests.test_pa_imaging_capture tests.test_tauri_server_defaults -v
```

Expected: PASS.

- [ ] **Step 2: Run Tauri tests**

```bash
cd /home/qian/Portable_System_Project/Butterfly_Laser_Driver/tauri_control_console
PATH=/home/qian/.local/nodejs/bin:$PATH npm test
```

Expected: PASS.

- [ ] **Step 3: Run Tauri production build**

```bash
cd /home/qian/Portable_System_Project/Butterfly_Laser_Driver/tauri_control_console
PATH=/home/qian/.local/nodejs/bin:$PATH npm run build
```

Expected: PASS.

- [ ] **Step 4: Run canonical HDL compile and simulation**

```bash
cd /home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/IPs/ip_repo/axi_pam_image_acq_1_0
xvlog -sv hdl/pam_image_acq_controller_core.v hdl/axi_pam_image_acq_v1_0_S00_AXI.v hdl/axi_pam_image_acq_v1_0.v tb/tb_pam_scheduler_modes.sv
xelab tb_pam_scheduler_modes -s tb_pam_scheduler_modes
xsim tb_pam_scheduler_modes -runall
```

Expected: `xsim` prints `TB_PASS tb_pam_scheduler_modes`.

- [ ] **Step 5: Inspect git status**

```bash
git -C /home/qian/Portable_System_Project/Butterfly_Laser_Driver status --short
```

Expected: only unrelated pre-existing dirty files remain, or a clean tree if all touched files were committed.

- [ ] **Step 6: Write final board testing instructions**

In the implementation summary, include these exact board checks:

```bash
curl -sS http://192.168.8.236:8080/api/pa/scheduler/status
curl -sS -X POST http://192.168.8.236:8080/api/pa/scheduler/manual-position -H 'Content-Type: application/json' -d '{"x":0,"y":0}'
curl -sS -X POST http://192.168.8.236:8080/api/pa/scheduler/pulse -H 'Content-Type: application/json' -d '{"manual_x":0,"manual_y":0,"ld_delay_cycles":0,"ld_width_cycles":100,"single":true}'
```

Expected: manual position and single pulse commands return `ok: true` without requiring a PA TCP receiver. Auto scan capture still requires the receiver and should be tested from Tauri after bitstream rebuild/upload.
