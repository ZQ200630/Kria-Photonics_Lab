`timescale 1ns / 1ps
//////////////////////////////////////////////////////////////////////////////////
// Module Name: laser_current_ctrl_core
// Description:
//   Laser diode current-control core for a butterfly laser.
//
//   This module sits between an AXI4-Lite register bank and a 2-channel DAC
//   driver.  It generates coarse/fine DAC codes for laser current tuning,
//   supports static/fine-scan/nested-scan/side-fringe-lock modes, and adds a
//   safety output stage with arm/TEC/external-fault interlocks, soft start,
//   soft stop, slew-rate limiting, DAC timeout, watchdog, current-limit check,
//   and latched fault reporting.
//
// Important safety note:
//   FPGA safety logic should not be the only protection for a laser diode.
//   Use analog/hardware current limiting, current-source enable control,
//   TEC interlock, and external fault comparators whenever possible.
//////////////////////////////////////////////////////////////////////////////////

module laser_current_ctrl_core(
    input  wire        clk,
    input  wire        resetn,

    // Main control pulses/register bits from AXI register bank
    input  wire        ctrl_enable,
    input  wire        ctrl_start_pulse,
    input  wire        ctrl_stop_pulse,
    input  wire        ctrl_continuous,
    input  wire [2:0]  mode,
    input  wire        laser_arm,
    input  wire        fault_clear_pulse,
    input  wire        watchdog_kick_pulse,
    input  wire        emergency_stop_pulse,

    // Safety interlocks
    input  wire        tec_locked,
    input  wire        ext_fault_n,
    input  wire        emergency_stop_ext,

    // Static DAC codes
    input  wire [15:0] ch0_static_code,
    input  wire [15:0] ch1_static_code,

    // CH0 slow/coarse scan
    input  wire [15:0] ch0_start_code,
    input  wire [15:0] ch0_stop_code,
    input  wire [15:0] ch0_step_code,
    input  wire [31:0] ch0_dwell_frames,

    // CH1 fast/fine scan
    input  wire [15:0] ch1_start_code,
    input  wire [15:0] ch1_stop_code,
    input  wire [15:0] ch1_step_code,
    input  wire [31:0] ch1_dwell_ticks,

    // Scan timing
    input  wire [31:0] frame_count,
    input  wire [31:0] dac_settle_ticks,

    // DAC-code limits.  If min=max=0, the corresponding clamp is disabled.
    input  wire [15:0] ch0_min_code,
    input  wire [15:0] ch0_max_code,
    input  wire [15:0] ch1_min_code,
    input  wire [15:0] ch1_max_code,

    // Soft-ramp/slew-rate configuration
    input  wire [15:0] ch0_soft_step,
    input  wire [15:0] ch1_soft_step,
    input  wire [31:0] ramp_interval_ticks,
    input  wire [31:0] enable_delay_ticks,

    // Timeout/watchdog configuration.  0 disables the corresponding function.
    input  wire [31:0] dac_timeout_ticks,
    input  wire [31:0] watchdog_timeout_ticks,

    // Optional combined-current estimate:
    // estimated_current = current_offset + ch0_gain_coeff*CH0 + ch1_gain_coeff*CH1
    // If current_limit_code is 0, the combined-current limit is disabled.
    input  wire [31:0] current_limit_code,
    input  wire [15:0] ch0_gain_coeff,
    input  wire [15:0] ch1_gain_coeff,
    input  wire [31:0] current_offset,

    // Side-fringe lock configuration.  Kp/Ki are signed Q16.16 values that
    // convert ADC-code error into CH1 internal DAC-code correction.
    input  wire [15:0] lock_target_adc,
    input  wire        lock_polarity_invert,
    input  wire [15:0] lock_bias_ch1_code,
    input  wire [15:0] lock_ch1_min_code,
    input  wire [15:0] lock_ch1_max_code,
    input  wire [31:0] lock_kp_q16,
    input  wire [31:0] lock_ki_q16,
    input  wire [31:0] lock_integral_limit,
    input  wire [15:0] lock_max_step,
    input  wire [15:0] lock_locked_threshold,
    input  wire [15:0] lock_loss_threshold,
    input  wire [15:0] lock_locked_count_cfg,
    input  wire [15:0] lock_loss_count_cfg,
    input  wire [31:0] lock_sat_count_cfg,
    input  wire [31:0] lock_fb_timeout_ticks,
    input  wire [15:0] lock_adc_min_valid,
    input  wire [15:0] lock_adc_max_valid,

    // Board-side live crossing acquire.  This scans first, then switches to
    // lock mode at the live crossing found inside the configured CH1 window.
    input  wire        acquire_enable,
    input  wire        acquire_arm_pulse,
    input  wire        acquire_cancel_pulse,
    input  wire [15:0] acquire_search_min_code,
    input  wire [15:0] acquire_search_max_code,
    input  wire [15:0] acquire_threshold,

    // DAC driver handshake
    input  wire        dac_data_ready,
    output reg  [15:0] dac_ch0_code,
    output reg  [15:0] dac_ch1_code,
    output reg         dac_ch0_valid,
    output reg         dac_ch1_valid,
    output reg         laser_enable,

    // Feedback input for side-fringe lock mode
    input  wire [15:0] fb_adc_data,
    input  wire        fb_adc_valid,
    output reg  [15:0] last_fb_adc,

    // ADC synchronization outputs
    output reg         frame_start_pulse,
    output reg         frame_end_pulse,
    output reg         frame_active,
    output reg         point_strobe,
    output reg  [15:0] fast_index,
    output reg  [15:0] slow_index,
    output reg  [31:0] frame_index,

    // Status/debug outputs
    output reg         busy,
    output reg         done_latched,
    output reg         lock_active,
    output reg         scan_active,
    output reg         ramping,
    output reg         dac_waiting,
    output reg         output_at_target,
    output reg         fault_latched,
    output reg  [31:0] fault_status,
    output reg  [15:0] actual_ch0_code,
    output reg  [15:0] actual_ch1_code,
    output reg  [15:0] target_ch0_code,
    output reg  [15:0] target_ch1_code,
    output reg  [31:0] current_estimate,
    output reg  [31:0] lock_status,
    output reg  [31:0] lock_error,
    output reg  [31:0] lock_integral,
    output reg  [31:0] lock_output_ch1_code,
    output reg  [31:0] lock_counters,
    output reg  [31:0] acquire_status,
    output reg  [31:0] acquire_match_code,
    output reg  [31:0] acquire_match_adc,
    output reg  [31:0] acquire_match_error,
    output wire        error
);

    // ------------------------------------------------------------
    // Mode definition
    // ------------------------------------------------------------
    localparam [2:0] MODE_IDLE        = 3'd0;
    localparam [2:0] MODE_STATIC      = 3'd1;
    localparam [2:0] MODE_FINE_SCAN   = 3'd2;
    localparam [2:0] MODE_NESTED_SCAN = 3'd3;
    localparam [2:0] MODE_LOCK        = 3'd4;

    // ------------------------------------------------------------
    // Scan/control FSM state definition
    // ------------------------------------------------------------
    localparam [3:0] ST_IDLE        = 4'd0;
    localparam [3:0] ST_STATIC_RAMP = 4'd1;
    localparam [3:0] ST_STATIC_HOLD = 4'd2;
    localparam [3:0] ST_FRAME_INIT  = 4'd3;
    localparam [3:0] ST_WAIT_TARGET = 4'd4;
    localparam [3:0] ST_SETTLE      = 4'd5;
    localparam [3:0] ST_DWELL       = 4'd6;
    localparam [3:0] ST_ADVANCE     = 4'd7;
    localparam [3:0] ST_LOCK_RAMP   = 4'd8;
    localparam [3:0] ST_LOCK_HOLD   = 4'd9;
    localparam [3:0] ST_STOPPING    = 4'd10;
    localparam [3:0] ST_RETURN_SCAN = 4'd11;
    localparam [3:0] ST_SCAN_HOLD   = 4'd12;

    reg [3:0] state;

    // Requested target from scan/static/lock engine before safety clamp.
    reg [15:0] req_ch0_code;
    reg [15:0] req_ch1_code;

    // Internal counters
    reg [31:0] settle_cnt;
    reg [31:0] dwell_cnt;
    reg [31:0] ch0_dwell_cnt;
    reg [31:0] ramp_interval_cnt;
    reg [31:0] enable_delay_cnt;
    reg [31:0] dac_timeout_cnt;
    reg [31:0] watchdog_cnt;
    reg [31:0] lock_fb_timeout_cnt;
    reg [31:0] lock_sat_cnt;
    reg [15:0] lock_locked_cnt;
    reg [15:0] lock_loss_cnt;

    reg        run_requested;
    reg        pending_dac_update;
    reg        force_zero_sent;
    reg        lock_control_enabled;
    reg        lock_locked;
    reg        lock_lost;
    reg        lock_saturated;
    reg        lock_fb_timeout;
    reg        lock_adc_invalid;
    reg [15:0] lock_hold_ch1_code;
    reg [15:0] lock_last_output_ch1;
    reg [15:0] lock_runtime_bias_ch1_code;
    reg        acquire_active;
    reg        acquire_matched;
    reg        acquire_cancelled;
    reg        acquire_prev_valid;
    reg [15:0] acquire_prev_adc;
    reg [15:0] acquire_prev_code;
    reg signed [31:0] acquire_prev_error_s;

    reg signed [31:0] lock_error_s;
    reg signed [31:0] lock_integral_s;
    reg signed [31:0] lock_pid_code_s;
    reg signed [31:0] lock_limited_code_s;
    reg signed [31:0] lock_step_limited_code_s;
    reg signed [31:0] lock_raw_error_s;
    reg signed [31:0] lock_integral_next_s;
    reg signed [31:0] lock_pid_delta_s;
    reg signed [31:0] lock_desired_code_s;
    reg signed [63:0] lock_p_calc_s;
    reg signed [63:0] lock_i_calc_s;
    reg [31:0] lock_abs_error;
    reg [15:0] lock_next_ch1_code;
    reg        lock_next_saturated;

    localparam integer LOCK_PIPE_STAGES = 5;

    reg [LOCK_PIPE_STAGES-1:0] lock_pipe_valid;
    reg [15:0] lock_pipe_s0_req_ch1_code;
    reg [15:0] lock_pipe_s0_fb_adc;
    reg [15:0] lock_pipe_s0_target_adc;
    reg        lock_pipe_s0_polarity_invert;
    reg [15:0] lock_pipe_s0_bias_ch1_code;
    reg [15:0] lock_pipe_s0_lock_ch1_min_code;
    reg [15:0] lock_pipe_s0_lock_ch1_max_code;
    reg [15:0] lock_pipe_s0_ch1_min_code;
    reg [15:0] lock_pipe_s0_ch1_max_code;
    reg [31:0] lock_pipe_s0_kp_q16;
    reg [31:0] lock_pipe_s0_ki_q16;
    reg [31:0] lock_pipe_s0_integral_limit;
    reg [15:0] lock_pipe_s0_max_step;
    reg [15:0] lock_pipe_s0_locked_threshold;
    reg [15:0] lock_pipe_s0_loss_threshold;
    reg [15:0] lock_pipe_s0_locked_count_eff;
    reg [15:0] lock_pipe_s0_loss_count_eff;
    reg [31:0] lock_pipe_s0_sat_count_eff;
    reg        lock_pipe_s0_sat_count_enabled;

    reg [15:0] lock_pipe_s1_req_ch1_code;
    reg [15:0] lock_pipe_s1_bias_ch1_code;
    reg [15:0] lock_pipe_s1_lock_ch1_min_code;
    reg [15:0] lock_pipe_s1_lock_ch1_max_code;
    reg [15:0] lock_pipe_s1_ch1_min_code;
    reg [15:0] lock_pipe_s1_ch1_max_code;
    reg [31:0] lock_pipe_s1_kp_q16;
    reg [31:0] lock_pipe_s1_ki_q16;
    reg [31:0] lock_pipe_s1_integral_limit;
    reg [15:0] lock_pipe_s1_max_step;
    reg [15:0] lock_pipe_s1_locked_threshold;
    reg [15:0] lock_pipe_s1_loss_threshold;
    reg [15:0] lock_pipe_s1_locked_count_eff;
    reg [15:0] lock_pipe_s1_loss_count_eff;
    reg [31:0] lock_pipe_s1_sat_count_eff;
    reg        lock_pipe_s1_sat_count_enabled;
    reg signed [31:0] lock_pipe_s1_raw_error_s;
    reg [31:0] lock_pipe_s1_abs_error;

    reg [15:0] lock_pipe_s2_req_ch1_code;
    reg [15:0] lock_pipe_s2_bias_ch1_code;
    reg [15:0] lock_pipe_s2_lock_ch1_min_code;
    reg [15:0] lock_pipe_s2_lock_ch1_max_code;
    reg [15:0] lock_pipe_s2_ch1_min_code;
    reg [15:0] lock_pipe_s2_ch1_max_code;
    reg [31:0] lock_pipe_s2_kp_q16;
    reg [31:0] lock_pipe_s2_ki_q16;
    reg [15:0] lock_pipe_s2_max_step;
    reg [15:0] lock_pipe_s2_locked_threshold;
    reg [15:0] lock_pipe_s2_loss_threshold;
    reg [15:0] lock_pipe_s2_locked_count_eff;
    reg [15:0] lock_pipe_s2_loss_count_eff;
    reg [31:0] lock_pipe_s2_sat_count_eff;
    reg        lock_pipe_s2_sat_count_enabled;
    reg signed [31:0] lock_pipe_s2_raw_error_s;
    reg [31:0] lock_pipe_s2_abs_error;
    reg signed [31:0] lock_pipe_s2_integral_next_s;

    reg [15:0] lock_pipe_s3_req_ch1_code;
    reg [15:0] lock_pipe_s3_bias_ch1_code;
    reg [15:0] lock_pipe_s3_lock_ch1_min_code;
    reg [15:0] lock_pipe_s3_lock_ch1_max_code;
    reg [15:0] lock_pipe_s3_ch1_min_code;
    reg [15:0] lock_pipe_s3_ch1_max_code;
    reg [15:0] lock_pipe_s3_max_step;
    reg [15:0] lock_pipe_s3_locked_threshold;
    reg [15:0] lock_pipe_s3_loss_threshold;
    reg [15:0] lock_pipe_s3_locked_count_eff;
    reg [15:0] lock_pipe_s3_loss_count_eff;
    reg [31:0] lock_pipe_s3_sat_count_eff;
    reg        lock_pipe_s3_sat_count_enabled;
    reg signed [31:0] lock_pipe_s3_raw_error_s;
    reg [31:0] lock_pipe_s3_abs_error;
    reg signed [31:0] lock_pipe_s3_integral_next_s;
    reg signed [63:0] lock_pipe_s3_p_calc_s;
    reg signed [63:0] lock_pipe_s3_i_calc_s;

    reg [15:0] lock_pipe_s4_next_ch1_code;
    reg [15:0] lock_pipe_s4_locked_threshold;
    reg [15:0] lock_pipe_s4_loss_threshold;
    reg [15:0] lock_pipe_s4_locked_count_eff;
    reg [15:0] lock_pipe_s4_loss_count_eff;
    reg [31:0] lock_pipe_s4_sat_count_eff;
    reg        lock_pipe_s4_sat_count_enabled;
    reg signed [31:0] lock_pipe_s4_raw_error_s;
    reg [31:0] lock_pipe_s4_abs_error;
    reg signed [31:0] lock_pipe_s4_integral_next_s;
    reg signed [31:0] lock_pipe_s4_pid_delta_s;
    reg signed [31:0] lock_pipe_s4_desired_code_s;
    reg signed [31:0] lock_pipe_s4_limited_code_s;
    reg signed [31:0] lock_pipe_s4_step_limited_code_s;
    reg        lock_pipe_s4_saturated;

    reg signed [31:0] lock_pipe_raw_error_calc;
    reg [31:0] lock_pipe_abs_error_calc;
    reg signed [31:0] lock_pipe_pid_delta_calc;
    reg signed [31:0] lock_pipe_desired_code_calc;
    reg signed [31:0] lock_pipe_limited_code_calc;
    reg signed [31:0] lock_pipe_step_limited_code_calc;
    reg [15:0] lock_pipe_next_ch1_code_calc;
    reg        lock_pipe_next_saturated_calc;

    // Fault status bit mapping
    localparam integer FAULT_TEC_UNLOCKED          = 0;
    localparam integer FAULT_EXT_FAULT             = 1;
    localparam integer FAULT_EMERGENCY_STOP        = 2;
    localparam integer FAULT_CH0_LIMIT             = 3;
    localparam integer FAULT_CH1_LIMIT             = 4;
    localparam integer FAULT_COMBINED_CURRENT      = 5;
    localparam integer FAULT_DAC_TIMEOUT           = 6;
    localparam integer FAULT_WATCHDOG_TIMEOUT      = 7;
    localparam integer FAULT_ILLEGAL_MODE          = 8;
    localparam integer FAULT_TEC_LOST_DURING_RUN   = 9;

    localparam integer LOCK_STATUS_ACTIVE          = 0;
    localparam integer LOCK_STATUS_CONTROL_ENABLED = 1;
    localparam integer LOCK_STATUS_LOCKED          = 2;
    localparam integer LOCK_STATUS_SATURATED       = 3;
    localparam integer LOCK_STATUS_LOST            = 4;
    localparam integer LOCK_STATUS_FB_TIMEOUT      = 5;
    localparam integer LOCK_STATUS_ADC_INVALID     = 6;
    localparam integer LOCK_STATUS_HOLD            = 7;
    localparam integer LOCK_STATUS_ACQUIRING       = 8;

    assign error = fault_latched;

    wire [31:0] ch0_dwell_frames_eff;
    assign ch0_dwell_frames_eff = (ch0_dwell_frames == 32'd0) ? 32'd1 : ch0_dwell_frames;

    wire stop_or_disable;
    assign stop_or_disable = ctrl_stop_pulse | ~ctrl_enable | ~laser_arm;

    wire hard_emergency;
    assign hard_emergency = emergency_stop_pulse | emergency_stop_ext;

    wire [15:0] lock_locked_count_eff;
    wire [15:0] lock_loss_count_eff;
    wire [31:0] lock_sat_count_eff;
    assign lock_locked_count_eff = (lock_locked_count_cfg == 16'd0) ? 16'd1 : lock_locked_count_cfg;
    assign lock_loss_count_eff   = (lock_loss_count_cfg == 16'd0) ? 16'd1 : lock_loss_count_cfg;
    assign lock_sat_count_eff    = (lock_sat_count_cfg == 32'd0) ? 32'd1 : lock_sat_count_cfg;

    wire signed [31:0] acquire_target_error_w;
    wire signed [31:0] acquire_error_w;
    wire signed [17:0] acquire_code_delta_w;
    wire signed [17:0] acquire_raw_delta_w;
    wire acquire_slope_valid_w;
    wire acquire_slope_invert_w;
    wire acquire_same_polarity_w;
    wire acquire_range_enabled;
    wire acquire_in_range_w;
    wire acquire_cross_w;
    wire acquire_match_w;
    assign acquire_target_error_w = $signed({16'd0, lock_target_adc}) -
                                    $signed({16'd0, fb_adc_data});
    assign acquire_error_w = lock_polarity_invert ? -acquire_target_error_w :
                                                   acquire_target_error_w;
    assign acquire_code_delta_w = $signed({2'b00, req_ch1_code}) -
                                  $signed({2'b00, acquire_prev_code});
    assign acquire_raw_delta_w = $signed({2'b00, fb_adc_data}) -
                                 $signed({2'b00, acquire_prev_adc});
    assign acquire_slope_valid_w = acquire_prev_valid &&
                                   (acquire_code_delta_w != 18'sd0) &&
                                   (acquire_raw_delta_w != 18'sd0);
    assign acquire_slope_invert_w = acquire_code_delta_w[17] ^ acquire_raw_delta_w[17];
    assign acquire_same_polarity_w = acquire_slope_valid_w &&
                                     (acquire_slope_invert_w == lock_polarity_invert);
    assign acquire_range_enabled = (acquire_search_min_code != 16'd0) ||
                                   (acquire_search_max_code != 16'd0);
    assign acquire_in_range_w = !acquire_range_enabled ||
                                ((req_ch1_code >= acquire_search_min_code) &&
                                 (req_ch1_code <= acquire_search_max_code));
    assign acquire_cross_w = acquire_prev_valid &&
                             ((acquire_prev_error_s[31] != acquire_target_error_w[31]) ||
                              (acquire_target_error_w == 32'sd0));
    assign acquire_match_w = acquire_enable && acquire_active && scan_active &&
                             fb_adc_valid && acquire_in_range_w &&
                             acquire_same_polarity_w && acquire_cross_w;

    // ------------------------------------------------------------
    // Clamp helper
    // If min=max=0, clamp is disabled.
    // ------------------------------------------------------------
    function [15:0] clamp_code;
        input [15:0] code;
        input [15:0] min_code;
        input [15:0] max_code;
        begin
            if ((min_code == 16'd0) && (max_code == 16'd0)) begin
                clamp_code = code;
            end else if (code < min_code) begin
                clamp_code = min_code;
            end else if (code > max_code) begin
                clamp_code = max_code;
            end else begin
                clamp_code = code;
            end
        end
    endfunction

    function signed [31:0] clamp_signed32;
        input signed [31:0] value;
        input signed [31:0] min_value;
        input signed [31:0] max_value;
        begin
            if (value < min_value)
                clamp_signed32 = min_value;
            else if (value > max_value)
                clamp_signed32 = max_value;
            else
                clamp_signed32 = value;
        end
    endfunction

    function [31:0] abs_signed32;
        input signed [31:0] value;
        begin
            abs_signed32 = value[31] ? (~value + 32'd1) : value;
        end
    endfunction

    always @* begin
        lock_pipe_raw_error_calc = $signed({16'd0, lock_pipe_s0_target_adc}) -
                                   $signed({16'd0, lock_pipe_s0_fb_adc});
        if (lock_pipe_s0_polarity_invert)
            lock_pipe_raw_error_calc = -lock_pipe_raw_error_calc;
        lock_pipe_abs_error_calc = abs_signed32(lock_pipe_raw_error_calc);
    end

    always @* begin
        lock_pipe_pid_delta_calc = $signed(lock_pipe_s3_p_calc_s[47:16]) +
                                   $signed(lock_pipe_s3_i_calc_s[47:16]);
        lock_pipe_desired_code_calc = $signed({16'd0, lock_pipe_s3_bias_ch1_code}) +
                                      lock_pipe_pid_delta_calc;

        lock_pipe_limited_code_calc = clamp_signed32(lock_pipe_desired_code_calc,
                                                     32'sd0,
                                                     32'sd65535);
        lock_pipe_next_saturated_calc = (lock_pipe_limited_code_calc != lock_pipe_desired_code_calc);

        if ((lock_pipe_s3_lock_ch1_min_code != 16'd0) ||
            (lock_pipe_s3_lock_ch1_max_code != 16'd0)) begin
            if (lock_pipe_limited_code_calc < $signed({16'd0, lock_pipe_s3_lock_ch1_min_code})) begin
                lock_pipe_limited_code_calc = $signed({16'd0, lock_pipe_s3_lock_ch1_min_code});
                lock_pipe_next_saturated_calc = 1'b1;
            end else if (lock_pipe_limited_code_calc > $signed({16'd0, lock_pipe_s3_lock_ch1_max_code})) begin
                lock_pipe_limited_code_calc = $signed({16'd0, lock_pipe_s3_lock_ch1_max_code});
                lock_pipe_next_saturated_calc = 1'b1;
            end
        end

        if ((lock_pipe_s3_ch1_min_code != 16'd0) ||
            (lock_pipe_s3_ch1_max_code != 16'd0)) begin
            if (lock_pipe_limited_code_calc < $signed({16'd0, lock_pipe_s3_ch1_min_code})) begin
                lock_pipe_limited_code_calc = $signed({16'd0, lock_pipe_s3_ch1_min_code});
                lock_pipe_next_saturated_calc = 1'b1;
            end else if (lock_pipe_limited_code_calc > $signed({16'd0, lock_pipe_s3_ch1_max_code})) begin
                lock_pipe_limited_code_calc = $signed({16'd0, lock_pipe_s3_ch1_max_code});
                lock_pipe_next_saturated_calc = 1'b1;
            end
        end

        lock_pipe_step_limited_code_calc = lock_pipe_limited_code_calc;
        if (lock_pipe_s3_max_step != 16'd0) begin
            if (lock_pipe_limited_code_calc >
                ($signed({16'd0, lock_pipe_s3_req_ch1_code}) +
                 $signed({16'd0, lock_pipe_s3_max_step}))) begin
                lock_pipe_step_limited_code_calc =
                    $signed({16'd0, lock_pipe_s3_req_ch1_code}) +
                    $signed({16'd0, lock_pipe_s3_max_step});
            end else if (lock_pipe_limited_code_calc <
                         ($signed({16'd0, lock_pipe_s3_req_ch1_code}) -
                          $signed({16'd0, lock_pipe_s3_max_step}))) begin
                lock_pipe_step_limited_code_calc =
                    $signed({16'd0, lock_pipe_s3_req_ch1_code}) -
                    $signed({16'd0, lock_pipe_s3_max_step});
            end
        end

        lock_pipe_next_ch1_code_calc = lock_pipe_step_limited_code_calc[15:0];
    end

    // ------------------------------------------------------------
    // Ramp helper.  step=0 means immediate jump to target.
    // ------------------------------------------------------------
    function [15:0] ramp_towards;
        input [15:0] actual;
        input [15:0] target;
        input [15:0] step;
        reg [16:0] diff;
        reg [16:0] tmp;
        begin
            if (step == 16'd0) begin
                ramp_towards = target;
            end else if (actual < target) begin
                diff = {1'b0, target} - {1'b0, actual};
                if (diff <= {1'b0, step}) begin
                    ramp_towards = target;
                end else begin
                    tmp = {1'b0, actual} + {1'b0, step};
                    ramp_towards = tmp[15:0];
                end
            end else if (actual > target) begin
                diff = {1'b0, actual} - {1'b0, target};
                if (diff <= {1'b0, step}) begin
                    ramp_towards = target;
                end else begin
                    tmp = {1'b0, actual} - {1'b0, step};
                    ramp_towards = tmp[15:0];
                end
            end else begin
                ramp_towards = actual;
            end
        end
    endfunction

    // ------------------------------------------------------------
    // DAC output encoding helper.
    //
    // The internal control code is an unsigned physical setpoint:
    //   0x0000 -> intended 0 V / zero current
    //   0xFFFF -> intended positive full scale
    //
    // The downstream DAC path used in this project treats raw code 0x0000 as
    // midscale (Vmax/2), which matches a signed two's-complement DAC input
    // convention.  Convert the internal offset-binary setpoint to two's
    // complement by flipping the MSB:
    //   internal 0x0000 -> raw 0x8000 -> physical 0 V
    //   internal 0x8000 -> raw 0x0000 -> physical midscale
    //   internal 0xFFFF -> raw 0x7FFF -> physical near full scale
    // ------------------------------------------------------------
    function [15:0] encode_dac_code;
        input [15:0] internal_code;
        begin
            encode_dac_code = internal_code ^ 16'h8000;
        end
    endfunction

    // ------------------------------------------------------------
    // Check whether current code is the last code in scan.
    // Supports both upward and downward scans.
    // ------------------------------------------------------------
    function is_last_code;
        input [15:0] cur;
        input [15:0] start_code;
        input [15:0] stop_code;
        input [15:0] step_code;
        reg [16:0] step_eff;
        begin
            step_eff = (step_code == 16'd0) ? 17'd1 : {1'b0, step_code};
            if (start_code <= stop_code) begin
                is_last_code = (({1'b0, cur} + step_eff) >= {1'b0, stop_code});
            end else begin
                is_last_code = ({1'b0, cur} <= ({1'b0, stop_code} + step_eff));
            end
        end
    endfunction

    // ------------------------------------------------------------
    // Generate next scan code. Supports both upward and downward scans.
    // ------------------------------------------------------------
    function [15:0] next_code;
        input [15:0] cur;
        input [15:0] start_code;
        input [15:0] stop_code;
        input [15:0] step_code;
        reg [16:0] step_eff;
        reg [16:0] tmp;
        begin
            step_eff = (step_code == 16'd0) ? 17'd1 : {1'b0, step_code};
            if (start_code <= stop_code) begin
                tmp = {1'b0, cur} + step_eff;
                if (tmp >= {1'b0, stop_code})
                    next_code = stop_code;
                else
                    next_code = tmp[15:0];
            end else begin
                if ({1'b0, cur} <= ({1'b0, stop_code} + step_eff))
                    next_code = stop_code;
                else
                    next_code = cur - step_eff[15:0];
            end
        end
    endfunction

    wire [15:0] clamped_req_ch0;
    wire [15:0] clamped_req_ch1;
    assign clamped_req_ch0 = clamp_code(req_ch0_code, ch0_min_code, ch0_max_code);
    assign clamped_req_ch1 = clamp_code(req_ch1_code, ch1_min_code, ch1_max_code);

    wire ch0_limit_violation;
    wire ch1_limit_violation;
    assign ch0_limit_violation = (clamped_req_ch0 != req_ch0_code);
    assign ch1_limit_violation = (clamped_req_ch1 != req_ch1_code);

    wire [63:0] current_calc;
    assign current_calc = {32'd0, current_offset} +
                          ({48'd0, ch0_gain_coeff} * {48'd0, req_ch0_code}) +
                          ({48'd0, ch1_gain_coeff} * {48'd0, req_ch1_code});

    wire combined_current_violation;
    assign combined_current_violation = (current_limit_code != 32'd0) &&
                                        (current_calc > {32'd0, current_limit_code});

    wire [15:0] safe_target_ch0;
    wire [15:0] safe_target_ch1;
    assign safe_target_ch0 = (fault_latched || hard_emergency || !ctrl_enable || !laser_arm || !tec_locked) ?
                             16'd0 : clamped_req_ch0;
    assign safe_target_ch1 = (fault_latched || hard_emergency || !ctrl_enable || !laser_arm || !tec_locked) ?
                             16'd0 : clamped_req_ch1;

    wire output_is_zero;
    assign output_is_zero = (actual_ch0_code == 16'd0) &&
                            (actual_ch1_code == 16'd0) &&
                            !pending_dac_update;

    wire ramp_tick;
    assign ramp_tick = (ramp_interval_ticks == 32'd0) ||
                       (ramp_interval_cnt >= ramp_interval_ticks);

    wire actual_matches_safe_target;
    assign actual_matches_safe_target = (actual_ch0_code == safe_target_ch0) &&
                                        (actual_ch1_code == safe_target_ch1) &&
                                        !pending_dac_update;

    wire lock_fb_sample_adc_valid;
    wire lock_pipe_busy;
    wire lock_pipe_flush;
    wire lock_pipe_immediate_adc_invalid;
    wire lock_pipe_immediate_fb_timeout;
    wire lock_pipe_command_start;
    wire same_cycle_watchdog_timeout;
    wire same_cycle_dac_timeout;
    wire same_cycle_fault_latch;
    wire lock_pipe_abort;
    wire lock_pipe_accept;
    assign lock_fb_sample_adc_valid =
        !(((lock_adc_min_valid != 16'd0) || (lock_adc_max_valid != 16'd0)) &&
          ((fb_adc_data < lock_adc_min_valid) || (fb_adc_data > lock_adc_max_valid)));
    assign lock_pipe_busy = |lock_pipe_valid;
    assign lock_pipe_flush = stop_or_disable || fault_latched || hard_emergency ||
                             lock_lost || (state != ST_LOCK_HOLD);

    wire should_enable_laser;
    assign should_enable_laser = run_requested && ctrl_enable && laser_arm &&
                                 tec_locked && !fault_latched && !hard_emergency;

    assign lock_pipe_immediate_adc_invalid =
        (state == ST_LOCK_HOLD) && !stop_or_disable && !lock_lost &&
        fb_adc_valid && !lock_fb_sample_adc_valid;
    assign lock_pipe_immediate_fb_timeout =
        (state == ST_LOCK_HOLD) && !stop_or_disable && !lock_lost &&
        !fb_adc_valid && (lock_fb_timeout_ticks != 32'd0) &&
        (lock_fb_timeout_cnt >= lock_fb_timeout_ticks);
    assign lock_pipe_command_start = ctrl_start_pulse && ctrl_enable && laser_arm;
    assign same_cycle_watchdog_timeout =
        (watchdog_timeout_ticks != 32'd0) && run_requested && !fault_latched &&
        !watchdog_kick_pulse && !ctrl_start_pulse &&
        (watchdog_cnt >= watchdog_timeout_ticks);
    assign same_cycle_dac_timeout =
        pending_dac_update && !dac_data_ready && (dac_timeout_ticks != 32'd0) &&
        (dac_timeout_cnt >= dac_timeout_ticks);
    assign same_cycle_fault_latch =
        !ext_fault_n || hard_emergency ||
        (!tec_locked && (run_requested || laser_enable || busy)) ||
        (ch0_limit_violation && should_enable_laser) ||
        (ch1_limit_violation && should_enable_laser) ||
        (combined_current_violation && should_enable_laser) ||
        same_cycle_watchdog_timeout ||
        same_cycle_dac_timeout;
    assign lock_pipe_abort = lock_pipe_flush ||
                             lock_pipe_immediate_adc_invalid ||
                             lock_pipe_immediate_fb_timeout ||
                             lock_pipe_command_start ||
                             same_cycle_fault_latch;
    assign lock_pipe_accept = (state == ST_LOCK_HOLD) &&
                              lock_control_enabled &&
                              fb_adc_valid &&
                              lock_fb_sample_adc_valid &&
                              !lock_pipe_busy &&
                              !lock_pipe_abort;

    // ------------------------------------------------------------
    // Main sequential logic
    // ------------------------------------------------------------
    always @(posedge clk) begin
        if (!resetn) begin
            state                  <= ST_IDLE;
            req_ch0_code           <= 16'd0;
            req_ch1_code           <= 16'd0;
            target_ch0_code        <= 16'd0;
            target_ch1_code        <= 16'd0;
            actual_ch0_code        <= 16'd0;
            actual_ch1_code        <= 16'd0;
            dac_ch0_code           <= encode_dac_code(16'd0);
            dac_ch1_code           <= encode_dac_code(16'd0);
            dac_ch0_valid          <= 1'b0;
            dac_ch1_valid          <= 1'b0;
            laser_enable           <= 1'b0;
            // After reset, actively commit the encoded zero-output code to
            // the downstream DAC driver as soon as it reports ready.
            pending_dac_update     <= 1'b1;
            force_zero_sent        <= 1'b0;

            frame_start_pulse      <= 1'b0;
            frame_end_pulse        <= 1'b0;
            frame_active           <= 1'b0;
            point_strobe           <= 1'b0;
            fast_index             <= 16'd0;
            slow_index             <= 16'd0;
            frame_index            <= 32'd0;

            settle_cnt             <= 32'd0;
            dwell_cnt              <= 32'd0;
            ch0_dwell_cnt          <= 32'd0;
            ramp_interval_cnt      <= 32'd0;
            enable_delay_cnt       <= 32'd0;
            dac_timeout_cnt        <= 32'd0;
            watchdog_cnt           <= 32'd0;

            run_requested          <= 1'b0;
            busy                   <= 1'b0;
            done_latched           <= 1'b0;
            lock_active            <= 1'b0;
            scan_active            <= 1'b0;
            ramping                <= 1'b0;
            dac_waiting            <= 1'b0;
            output_at_target       <= 1'b1;
            fault_latched          <= 1'b0;
            fault_status           <= 32'd0;
            last_fb_adc            <= 16'd0;
            current_estimate       <= 32'd0;
            lock_fb_timeout_cnt    <= 32'd0;
            lock_sat_cnt           <= 32'd0;
            lock_locked_cnt        <= 16'd0;
            lock_loss_cnt          <= 16'd0;
            lock_control_enabled   <= 1'b0;
            lock_locked            <= 1'b0;
            lock_lost              <= 1'b0;
            lock_saturated         <= 1'b0;
            lock_fb_timeout        <= 1'b0;
            lock_adc_invalid       <= 1'b0;
            lock_hold_ch1_code     <= 16'd0;
            lock_last_output_ch1   <= 16'd0;
            lock_runtime_bias_ch1_code <= 16'd0;
            acquire_active         <= 1'b0;
            acquire_matched        <= 1'b0;
            acquire_cancelled      <= 1'b0;
            acquire_prev_valid     <= 1'b0;
            acquire_prev_adc       <= 16'd0;
            acquire_prev_code      <= 16'd0;
            acquire_prev_error_s   <= 32'sd0;
            lock_error_s           <= 32'sd0;
            lock_integral_s        <= 32'sd0;
            lock_pid_code_s        <= 32'sd0;
            lock_limited_code_s    <= 32'sd0;
            lock_step_limited_code_s <= 32'sd0;
            lock_raw_error_s       <= 32'sd0;
            lock_integral_next_s   <= 32'sd0;
            lock_pid_delta_s       <= 32'sd0;
            lock_desired_code_s    <= 32'sd0;
            lock_p_calc_s          <= 64'sd0;
            lock_i_calc_s          <= 64'sd0;
            lock_abs_error         <= 32'd0;
            lock_next_ch1_code     <= 16'd0;
            lock_next_saturated    <= 1'b0;
            lock_pipe_valid        <= {LOCK_PIPE_STAGES{1'b0}};
            lock_pipe_s0_req_ch1_code <= 16'd0;
            lock_pipe_s0_fb_adc    <= 16'd0;
            lock_pipe_s0_target_adc <= 16'd0;
            lock_pipe_s0_polarity_invert <= 1'b0;
            lock_pipe_s0_bias_ch1_code <= 16'd0;
            lock_pipe_s0_lock_ch1_min_code <= 16'd0;
            lock_pipe_s0_lock_ch1_max_code <= 16'd0;
            lock_pipe_s0_ch1_min_code <= 16'd0;
            lock_pipe_s0_ch1_max_code <= 16'd0;
            lock_pipe_s0_kp_q16    <= 32'd0;
            lock_pipe_s0_ki_q16    <= 32'd0;
            lock_pipe_s0_integral_limit <= 32'd0;
            lock_pipe_s0_max_step  <= 16'd0;
            lock_pipe_s0_locked_threshold <= 16'd0;
            lock_pipe_s0_loss_threshold <= 16'd0;
            lock_pipe_s0_locked_count_eff <= 16'd0;
            lock_pipe_s0_loss_count_eff <= 16'd0;
            lock_pipe_s0_sat_count_eff <= 32'd0;
            lock_pipe_s0_sat_count_enabled <= 1'b0;
            lock_pipe_s1_req_ch1_code <= 16'd0;
            lock_pipe_s1_bias_ch1_code <= 16'd0;
            lock_pipe_s1_lock_ch1_min_code <= 16'd0;
            lock_pipe_s1_lock_ch1_max_code <= 16'd0;
            lock_pipe_s1_ch1_min_code <= 16'd0;
            lock_pipe_s1_ch1_max_code <= 16'd0;
            lock_pipe_s1_kp_q16    <= 32'd0;
            lock_pipe_s1_ki_q16    <= 32'd0;
            lock_pipe_s1_integral_limit <= 32'd0;
            lock_pipe_s1_max_step  <= 16'd0;
            lock_pipe_s1_locked_threshold <= 16'd0;
            lock_pipe_s1_loss_threshold <= 16'd0;
            lock_pipe_s1_locked_count_eff <= 16'd0;
            lock_pipe_s1_loss_count_eff <= 16'd0;
            lock_pipe_s1_sat_count_eff <= 32'd0;
            lock_pipe_s1_sat_count_enabled <= 1'b0;
            lock_pipe_s1_raw_error_s <= 32'sd0;
            lock_pipe_s1_abs_error <= 32'd0;
            lock_pipe_s2_req_ch1_code <= 16'd0;
            lock_pipe_s2_bias_ch1_code <= 16'd0;
            lock_pipe_s2_lock_ch1_min_code <= 16'd0;
            lock_pipe_s2_lock_ch1_max_code <= 16'd0;
            lock_pipe_s2_ch1_min_code <= 16'd0;
            lock_pipe_s2_ch1_max_code <= 16'd0;
            lock_pipe_s2_kp_q16    <= 32'd0;
            lock_pipe_s2_ki_q16    <= 32'd0;
            lock_pipe_s2_max_step  <= 16'd0;
            lock_pipe_s2_locked_threshold <= 16'd0;
            lock_pipe_s2_loss_threshold <= 16'd0;
            lock_pipe_s2_locked_count_eff <= 16'd0;
            lock_pipe_s2_loss_count_eff <= 16'd0;
            lock_pipe_s2_sat_count_eff <= 32'd0;
            lock_pipe_s2_sat_count_enabled <= 1'b0;
            lock_pipe_s2_raw_error_s <= 32'sd0;
            lock_pipe_s2_abs_error <= 32'd0;
            lock_pipe_s2_integral_next_s <= 32'sd0;
            lock_pipe_s3_req_ch1_code <= 16'd0;
            lock_pipe_s3_bias_ch1_code <= 16'd0;
            lock_pipe_s3_lock_ch1_min_code <= 16'd0;
            lock_pipe_s3_lock_ch1_max_code <= 16'd0;
            lock_pipe_s3_ch1_min_code <= 16'd0;
            lock_pipe_s3_ch1_max_code <= 16'd0;
            lock_pipe_s3_max_step  <= 16'd0;
            lock_pipe_s3_locked_threshold <= 16'd0;
            lock_pipe_s3_loss_threshold <= 16'd0;
            lock_pipe_s3_locked_count_eff <= 16'd0;
            lock_pipe_s3_loss_count_eff <= 16'd0;
            lock_pipe_s3_sat_count_eff <= 32'd0;
            lock_pipe_s3_sat_count_enabled <= 1'b0;
            lock_pipe_s3_raw_error_s <= 32'sd0;
            lock_pipe_s3_abs_error <= 32'd0;
            lock_pipe_s3_integral_next_s <= 32'sd0;
            lock_pipe_s3_p_calc_s <= 64'sd0;
            lock_pipe_s3_i_calc_s <= 64'sd0;
            lock_pipe_s4_next_ch1_code <= 16'd0;
            lock_pipe_s4_locked_threshold <= 16'd0;
            lock_pipe_s4_loss_threshold <= 16'd0;
            lock_pipe_s4_locked_count_eff <= 16'd0;
            lock_pipe_s4_loss_count_eff <= 16'd0;
            lock_pipe_s4_sat_count_eff <= 32'd0;
            lock_pipe_s4_sat_count_enabled <= 1'b0;
            lock_pipe_s4_raw_error_s <= 32'sd0;
            lock_pipe_s4_abs_error <= 32'd0;
            lock_pipe_s4_integral_next_s <= 32'sd0;
            lock_pipe_s4_pid_delta_s <= 32'sd0;
            lock_pipe_s4_desired_code_s <= 32'sd0;
            lock_pipe_s4_limited_code_s <= 32'sd0;
            lock_pipe_s4_step_limited_code_s <= 32'sd0;
            lock_pipe_s4_saturated <= 1'b0;
            lock_status            <= 32'd0;
            lock_error             <= 32'd0;
            lock_integral          <= 32'd0;
            lock_output_ch1_code   <= 32'd0;
            lock_counters          <= 32'd0;
            acquire_status         <= 32'd0;
            acquire_match_code     <= 32'd0;
            acquire_match_adc      <= 32'd0;
            acquire_match_error    <= 32'd0;
        end else begin
            // Default one-clock pulses
            dac_ch0_valid     <= 1'b0;
            dac_ch1_valid     <= 1'b0;
            frame_start_pulse <= 1'b0;
            frame_end_pulse   <= 1'b0;
            point_strobe      <= 1'b0;
            dac_waiting       <= 1'b0;

            if (lock_pipe_abort) begin
                lock_pipe_valid <= {LOCK_PIPE_STAGES{1'b0}};
            end else begin
                lock_pipe_valid <= {lock_pipe_valid[LOCK_PIPE_STAGES-2:0], lock_pipe_accept};

                if (lock_pipe_accept) begin
                    lock_pipe_s0_req_ch1_code <= req_ch1_code;
                    lock_pipe_s0_fb_adc <= fb_adc_data;
                    lock_pipe_s0_target_adc <= lock_target_adc;
                    lock_pipe_s0_polarity_invert <= lock_polarity_invert;
                    lock_pipe_s0_bias_ch1_code <= lock_runtime_bias_ch1_code;
                    lock_pipe_s0_lock_ch1_min_code <= lock_ch1_min_code;
                    lock_pipe_s0_lock_ch1_max_code <= lock_ch1_max_code;
                    lock_pipe_s0_ch1_min_code <= ch1_min_code;
                    lock_pipe_s0_ch1_max_code <= ch1_max_code;
                    lock_pipe_s0_kp_q16 <= lock_kp_q16;
                    lock_pipe_s0_ki_q16 <= lock_ki_q16;
                    lock_pipe_s0_integral_limit <= lock_integral_limit;
                    lock_pipe_s0_max_step <= lock_max_step;
                    lock_pipe_s0_locked_threshold <= lock_locked_threshold;
                    lock_pipe_s0_loss_threshold <= lock_loss_threshold;
                    lock_pipe_s0_locked_count_eff <= lock_locked_count_eff;
                    lock_pipe_s0_loss_count_eff <= lock_loss_count_eff;
                    lock_pipe_s0_sat_count_eff <= lock_sat_count_eff;
                    lock_pipe_s0_sat_count_enabled <= (lock_sat_count_cfg != 32'd0);
                end

                if (lock_pipe_valid[0]) begin
                    lock_pipe_s1_req_ch1_code <= lock_pipe_s0_req_ch1_code;
                    lock_pipe_s1_bias_ch1_code <= lock_pipe_s0_bias_ch1_code;
                    lock_pipe_s1_lock_ch1_min_code <= lock_pipe_s0_lock_ch1_min_code;
                    lock_pipe_s1_lock_ch1_max_code <= lock_pipe_s0_lock_ch1_max_code;
                    lock_pipe_s1_ch1_min_code <= lock_pipe_s0_ch1_min_code;
                    lock_pipe_s1_ch1_max_code <= lock_pipe_s0_ch1_max_code;
                    lock_pipe_s1_kp_q16 <= lock_pipe_s0_kp_q16;
                    lock_pipe_s1_ki_q16 <= lock_pipe_s0_ki_q16;
                    lock_pipe_s1_integral_limit <= lock_pipe_s0_integral_limit;
                    lock_pipe_s1_max_step <= lock_pipe_s0_max_step;
                    lock_pipe_s1_locked_threshold <= lock_pipe_s0_locked_threshold;
                    lock_pipe_s1_loss_threshold <= lock_pipe_s0_loss_threshold;
                    lock_pipe_s1_locked_count_eff <= lock_pipe_s0_locked_count_eff;
                    lock_pipe_s1_loss_count_eff <= lock_pipe_s0_loss_count_eff;
                    lock_pipe_s1_sat_count_eff <= lock_pipe_s0_sat_count_eff;
                    lock_pipe_s1_sat_count_enabled <= lock_pipe_s0_sat_count_enabled;
                    lock_pipe_s1_raw_error_s <= lock_pipe_raw_error_calc;
                    lock_pipe_s1_abs_error <= lock_pipe_abs_error_calc;
                end

                if (lock_pipe_valid[1]) begin
                    lock_pipe_s2_req_ch1_code <= lock_pipe_s1_req_ch1_code;
                    lock_pipe_s2_bias_ch1_code <= lock_pipe_s1_bias_ch1_code;
                    lock_pipe_s2_lock_ch1_min_code <= lock_pipe_s1_lock_ch1_min_code;
                    lock_pipe_s2_lock_ch1_max_code <= lock_pipe_s1_lock_ch1_max_code;
                    lock_pipe_s2_ch1_min_code <= lock_pipe_s1_ch1_min_code;
                    lock_pipe_s2_ch1_max_code <= lock_pipe_s1_ch1_max_code;
                    lock_pipe_s2_kp_q16 <= lock_pipe_s1_kp_q16;
                    lock_pipe_s2_ki_q16 <= lock_pipe_s1_ki_q16;
                    lock_pipe_s2_max_step <= lock_pipe_s1_max_step;
                    lock_pipe_s2_locked_threshold <= lock_pipe_s1_locked_threshold;
                    lock_pipe_s2_loss_threshold <= lock_pipe_s1_loss_threshold;
                    lock_pipe_s2_locked_count_eff <= lock_pipe_s1_locked_count_eff;
                    lock_pipe_s2_loss_count_eff <= lock_pipe_s1_loss_count_eff;
                    lock_pipe_s2_sat_count_eff <= lock_pipe_s1_sat_count_eff;
                    lock_pipe_s2_sat_count_enabled <= lock_pipe_s1_sat_count_enabled;
                    lock_pipe_s2_raw_error_s <= lock_pipe_s1_raw_error_s;
                    lock_pipe_s2_abs_error <= lock_pipe_s1_abs_error;
                    lock_pipe_s2_integral_next_s <= clamp_signed32(
                        lock_integral_s + lock_pipe_s1_raw_error_s,
                        -$signed(lock_pipe_s1_integral_limit),
                        $signed(lock_pipe_s1_integral_limit)
                    );
                end

                if (lock_pipe_valid[2]) begin
                    lock_pipe_s3_req_ch1_code <= lock_pipe_s2_req_ch1_code;
                    lock_pipe_s3_bias_ch1_code <= lock_pipe_s2_bias_ch1_code;
                    lock_pipe_s3_lock_ch1_min_code <= lock_pipe_s2_lock_ch1_min_code;
                    lock_pipe_s3_lock_ch1_max_code <= lock_pipe_s2_lock_ch1_max_code;
                    lock_pipe_s3_ch1_min_code <= lock_pipe_s2_ch1_min_code;
                    lock_pipe_s3_ch1_max_code <= lock_pipe_s2_ch1_max_code;
                    lock_pipe_s3_max_step <= lock_pipe_s2_max_step;
                    lock_pipe_s3_locked_threshold <= lock_pipe_s2_locked_threshold;
                    lock_pipe_s3_loss_threshold <= lock_pipe_s2_loss_threshold;
                    lock_pipe_s3_locked_count_eff <= lock_pipe_s2_locked_count_eff;
                    lock_pipe_s3_loss_count_eff <= lock_pipe_s2_loss_count_eff;
                    lock_pipe_s3_sat_count_eff <= lock_pipe_s2_sat_count_eff;
                    lock_pipe_s3_sat_count_enabled <= lock_pipe_s2_sat_count_enabled;
                    lock_pipe_s3_raw_error_s <= lock_pipe_s2_raw_error_s;
                    lock_pipe_s3_abs_error <= lock_pipe_s2_abs_error;
                    lock_pipe_s3_integral_next_s <= lock_pipe_s2_integral_next_s;
                    lock_pipe_s3_p_calc_s <= $signed(lock_pipe_s2_kp_q16) * lock_pipe_s2_raw_error_s;
                    lock_pipe_s3_i_calc_s <= $signed(lock_pipe_s2_ki_q16) * lock_pipe_s2_integral_next_s;
                end

                if (lock_pipe_valid[3]) begin
                    lock_pipe_s4_next_ch1_code <= lock_pipe_next_ch1_code_calc;
                    lock_pipe_s4_locked_threshold <= lock_pipe_s3_locked_threshold;
                    lock_pipe_s4_loss_threshold <= lock_pipe_s3_loss_threshold;
                    lock_pipe_s4_locked_count_eff <= lock_pipe_s3_locked_count_eff;
                    lock_pipe_s4_loss_count_eff <= lock_pipe_s3_loss_count_eff;
                    lock_pipe_s4_sat_count_eff <= lock_pipe_s3_sat_count_eff;
                    lock_pipe_s4_sat_count_enabled <= lock_pipe_s3_sat_count_enabled;
                    lock_pipe_s4_raw_error_s <= lock_pipe_s3_raw_error_s;
                    lock_pipe_s4_abs_error <= lock_pipe_s3_abs_error;
                    lock_pipe_s4_integral_next_s <= lock_pipe_s3_integral_next_s;
                    lock_pipe_s4_pid_delta_s <= lock_pipe_pid_delta_calc;
                    lock_pipe_s4_desired_code_s <= lock_pipe_desired_code_calc;
                    lock_pipe_s4_limited_code_s <= lock_pipe_limited_code_calc;
                    lock_pipe_s4_step_limited_code_s <= lock_pipe_step_limited_code_calc;
                    lock_pipe_s4_saturated <= lock_pipe_next_saturated_calc;
                end
            end

            lock_status <= {
                23'd0,
                (acquire_active || (lock_control_enabled && !lock_locked && !lock_lost)), // bit 8 acquiring
                lock_lost,                                            // bit 7 hold
                lock_adc_invalid,                                     // bit 6
                lock_fb_timeout,                                      // bit 5
                lock_lost,                                            // bit 4
                lock_saturated,                                       // bit 3
                lock_locked,                                          // bit 2
                lock_control_enabled,                                 // bit 1
                lock_active                                           // bit 0
            };
            lock_error           <= lock_error_s;
            lock_integral        <= lock_integral_s;
            lock_output_ch1_code <= {16'd0, lock_last_output_ch1};
            lock_counters        <= {lock_loss_cnt, lock_locked_cnt};
            acquire_status       <= {28'd0, acquire_enable, acquire_cancelled, acquire_matched, acquire_active};

            if (fb_adc_valid) begin
                last_fb_adc <= fb_adc_data;
                if (acquire_active && scan_active) begin
                    acquire_prev_valid   <= 1'b1;
                    acquire_prev_adc     <= fb_adc_data;
                    acquire_prev_code    <= req_ch1_code;
                    acquire_prev_error_s <= acquire_target_error_w;
                end
            end

            if (!acquire_enable) begin
                acquire_active     <= 1'b0;
                acquire_prev_valid <= 1'b0;
                acquire_prev_adc   <= 16'd0;
                acquire_prev_code  <= 16'd0;
            end else if (acquire_cancel_pulse) begin
                acquire_active     <= 1'b0;
                acquire_cancelled  <= 1'b1;
                acquire_prev_valid <= 1'b0;
                acquire_prev_adc   <= 16'd0;
                acquire_prev_code  <= 16'd0;
            end else if (acquire_arm_pulse) begin
                acquire_active       <= 1'b1;
                acquire_matched      <= 1'b0;
                acquire_cancelled    <= 1'b0;
                acquire_prev_valid   <= 1'b0;
                acquire_prev_adc     <= 16'd0;
                acquire_prev_code    <= 16'd0;
                acquire_prev_error_s <= 32'sd0;
            end

            current_estimate <= current_calc[31:0];
            target_ch0_code  <= safe_target_ch0;
            target_ch1_code  <= safe_target_ch1;
            output_at_target <= actual_matches_safe_target;
            ramping          <= !actual_matches_safe_target;

            // ----------------------------------------------------
            // Fault clear.  Only clear when hard external faults are absent.
            // ----------------------------------------------------
            if (fault_clear_pulse && ext_fault_n && !hard_emergency) begin
                fault_latched <= 1'b0;
                fault_status  <= 32'd0;
                lock_lost     <= 1'b0;
                lock_fb_timeout <= 1'b0;
                lock_adc_invalid <= 1'b0;
                lock_saturated <= 1'b0;
                lock_loss_cnt  <= 16'd0;
                lock_sat_cnt   <= 32'd0;
            end

            // ----------------------------------------------------
            // Fault detection and latching
            // ----------------------------------------------------
            if (!ext_fault_n) begin
                fault_latched <= 1'b1;
                fault_status[FAULT_EXT_FAULT] <= 1'b1;
            end

            if (hard_emergency) begin
                fault_latched <= 1'b1;
                fault_status[FAULT_EMERGENCY_STOP] <= 1'b1;
            end

            if (!tec_locked && (run_requested || laser_enable || busy)) begin
                fault_latched <= 1'b1;
                fault_status[FAULT_TEC_LOST_DURING_RUN] <= 1'b1;
            end

            if (ch0_limit_violation && should_enable_laser) begin
                fault_latched <= 1'b1;
                fault_status[FAULT_CH0_LIMIT] <= 1'b1;
            end

            if (ch1_limit_violation && should_enable_laser) begin
                fault_latched <= 1'b1;
                fault_status[FAULT_CH1_LIMIT] <= 1'b1;
            end

            if (combined_current_violation && should_enable_laser) begin
                fault_latched <= 1'b1;
                fault_status[FAULT_COMBINED_CURRENT] <= 1'b1;
            end

            // Watchdog: disabled when watchdog_timeout_ticks == 0.
            if (watchdog_kick_pulse || ctrl_start_pulse) begin
                watchdog_cnt <= 32'd0;
            end else if (watchdog_timeout_ticks != 32'd0 && run_requested && !fault_latched) begin
                if (watchdog_cnt >= watchdog_timeout_ticks) begin
                    fault_latched <= 1'b1;
                    fault_status[FAULT_WATCHDOG_TIMEOUT] <= 1'b1;
                end else begin
                    watchdog_cnt <= watchdog_cnt + 32'd1;
                end
            end

            // ----------------------------------------------------
            // Laser enable management
            // Current source enable is asserted only after arm/interlocks pass
            // and an optional enable delay has elapsed.  On fault/emergency it
            // is dropped immediately.
            // ----------------------------------------------------
            if (!should_enable_laser) begin
                laser_enable     <= 1'b0;
                enable_delay_cnt <= 32'd0;
            end else if (!laser_enable) begin
                if (enable_delay_cnt >= enable_delay_ticks) begin
                    laser_enable <= 1'b1;
                end else begin
                    enable_delay_cnt <= enable_delay_cnt + 32'd1;
                end
            end

            // ----------------------------------------------------
            // DAC timeout while waiting for DAC driver readiness.
            // ----------------------------------------------------
            if (pending_dac_update && !dac_data_ready) begin
                dac_waiting <= 1'b1;
                if (dac_timeout_ticks != 32'd0) begin
                    if (dac_timeout_cnt >= dac_timeout_ticks) begin
                        fault_latched <= 1'b1;
                        fault_status[FAULT_DAC_TIMEOUT] <= 1'b1;
                    end else begin
                        dac_timeout_cnt <= dac_timeout_cnt + 32'd1;
                    end
                end
            end else begin
                dac_timeout_cnt <= 32'd0;
            end

            // ----------------------------------------------------
            // DAC send stage.  The actual_ch*_code registers represent the
            // next code that must be committed to the DAC driver.
            // ----------------------------------------------------
            if (pending_dac_update && dac_data_ready) begin
                dac_ch0_code       <= encode_dac_code(actual_ch0_code);
                dac_ch1_code       <= encode_dac_code(actual_ch1_code);
                dac_ch0_valid      <= 1'b1;
                dac_ch1_valid      <= 1'b1;
                pending_dac_update <= 1'b0;
            end

            // ----------------------------------------------------
            // Soft-ramp output stage.  Do not advance ramp while a previous
            // DAC update is still pending.
            // ----------------------------------------------------
            if (!pending_dac_update) begin
                if (ramp_interval_ticks == 32'd0) begin
                    ramp_interval_cnt <= 32'd0;
                end else if (ramp_interval_cnt >= ramp_interval_ticks) begin
                    ramp_interval_cnt <= 32'd0;
                end else begin
                    ramp_interval_cnt <= ramp_interval_cnt + 32'd1;
                end

                if (fault_latched || hard_emergency) begin
                    // Emergency path: drop laser_enable immediately and force
                    // internal DAC code to zero.  If DAC is ready this zero code
                    // will be committed immediately by setting pending update.
                    laser_enable <= 1'b0;
                    if ((actual_ch0_code != 16'd0) || (actual_ch1_code != 16'd0) || !force_zero_sent) begin
                        actual_ch0_code    <= 16'd0;
                        actual_ch1_code    <= 16'd0;
                        pending_dac_update <= 1'b1;
                        force_zero_sent    <= 1'b1;
                    end
                end else if (laser_enable || safe_target_ch0 == 16'd0 && safe_target_ch1 == 16'd0) begin
                    force_zero_sent <= 1'b0;
                    if (ramp_tick &&
                        ((actual_ch0_code != safe_target_ch0) ||
                         (actual_ch1_code != safe_target_ch1))) begin
                        actual_ch0_code    <= ramp_towards(actual_ch0_code, safe_target_ch0, ch0_soft_step);
                        actual_ch1_code    <= ramp_towards(actual_ch1_code, safe_target_ch1, ch1_soft_step);
                        pending_dac_update <= 1'b1;
                    end
                end
            end

            // ----------------------------------------------------
            // Scan/static/lock control FSM
            // ----------------------------------------------------
            if (fault_latched || hard_emergency) begin
                state          <= ST_STOPPING;
                req_ch0_code   <= 16'd0;
                req_ch1_code   <= 16'd0;
                run_requested  <= 1'b0;
                frame_active   <= 1'b0;
                scan_active    <= 1'b0;
                lock_active    <= 1'b0;
                lock_control_enabled <= 1'b0;
                acquire_active <= 1'b0;
                acquire_prev_valid <= 1'b0;
                acquire_prev_adc <= 16'd0;
                acquire_prev_code <= 16'd0;
                busy           <= 1'b0;
            end else if (acquire_match_w) begin
                acquire_active       <= 1'b0;
                acquire_matched      <= 1'b1;
                acquire_cancelled    <= 1'b0;
                acquire_prev_valid   <= 1'b0;
                acquire_prev_adc     <= 16'd0;
                acquire_prev_code    <= 16'd0;
                acquire_match_code   <= {16'd0, req_ch1_code};
                acquire_match_adc    <= {16'd0, fb_adc_data};
                acquire_match_error  <= acquire_error_w;

                frame_end_pulse      <= 1'b1;
                frame_active         <= 1'b0;
                scan_active          <= 1'b0;
                req_ch0_code         <= ch0_static_code;
                req_ch1_code         <= req_ch1_code;
                run_requested        <= 1'b1;
                busy                 <= 1'b0;
                done_latched         <= 1'b1;
                lock_active          <= 1'b1;
                lock_control_enabled <= 1'b1;
                lock_locked          <= 1'b0;
                lock_lost            <= 1'b0;
                lock_saturated       <= 1'b0;
                lock_fb_timeout      <= 1'b0;
                lock_adc_invalid     <= 1'b0;
                lock_integral_s      <= 32'sd0;
                lock_error_s         <= acquire_error_w;
                lock_locked_cnt      <= 16'd0;
                lock_loss_cnt        <= 16'd0;
                lock_sat_cnt         <= 32'd0;
                lock_fb_timeout_cnt  <= 32'd0;
                lock_hold_ch1_code   <= req_ch1_code;
                lock_last_output_ch1 <= req_ch1_code;
                lock_runtime_bias_ch1_code <= req_ch1_code;
                lock_output_ch1_code <= {16'd0, req_ch1_code};
                state                <= ST_LOCK_HOLD;
            end else if (ctrl_start_pulse && ctrl_enable && laser_arm &&
                         (mode == MODE_LOCK) && (state != ST_IDLE)) begin
                done_latched         <= 1'b0;
                if (!tec_locked) begin
                    fault_latched <= 1'b1;
                    fault_status[FAULT_TEC_UNLOCKED] <= 1'b1;
                end else begin
                    req_ch0_code         <= ch0_static_code;
                    req_ch1_code         <= lock_bias_ch1_code;
                    run_requested        <= 1'b1;
                    busy                 <= 1'b1;
                    scan_active          <= 1'b0;
                    lock_active          <= 1'b1;
                    lock_control_enabled <= 1'b0;
                    lock_locked          <= 1'b0;
                    lock_lost            <= 1'b0;
                    lock_saturated       <= 1'b0;
                    lock_fb_timeout      <= 1'b0;
                    lock_adc_invalid     <= 1'b0;
                    lock_integral_s      <= 32'sd0;
                    lock_error_s         <= 32'sd0;
                    lock_locked_cnt      <= 16'd0;
                    lock_loss_cnt        <= 16'd0;
                    lock_sat_cnt         <= 32'd0;
                    lock_fb_timeout_cnt  <= 32'd0;
                    lock_hold_ch1_code   <= lock_bias_ch1_code;
                    lock_last_output_ch1 <= lock_bias_ch1_code;
                    lock_runtime_bias_ch1_code <= lock_bias_ch1_code;
                    lock_output_ch1_code <= {16'd0, lock_bias_ch1_code};
                    frame_active         <= 1'b0;
                    state                <= ST_LOCK_RAMP;
                end
            end else if (ctrl_start_pulse && ctrl_enable && laser_arm &&
                         (mode == MODE_STATIC) && (state != ST_IDLE)) begin
                done_latched <= 1'b0;
                if (!tec_locked) begin
                    fault_latched <= 1'b1;
                    fault_status[FAULT_TEC_UNLOCKED] <= 1'b1;
                end else begin
                    req_ch0_code  <= ch0_static_code;
                    req_ch1_code  <= ch1_static_code;
                    run_requested <= 1'b1;
                    busy          <= 1'b1;
                    scan_active   <= 1'b0;
                    lock_active   <= 1'b0;
                    frame_active  <= 1'b0;
                    state         <= ST_STATIC_RAMP;
                end
            end else if (ctrl_start_pulse && ctrl_enable && laser_arm &&
                         (mode == MODE_FINE_SCAN) && (state != ST_IDLE)) begin
                done_latched <= 1'b0;
                if (!tec_locked) begin
                    fault_latched <= 1'b1;
                    fault_status[FAULT_TEC_UNLOCKED] <= 1'b1;
                end else begin
                    req_ch0_code         <= ch0_static_code;
                    req_ch1_code         <= ch1_start_code;
                    run_requested        <= 1'b1;
                    busy                 <= 1'b1;
                    scan_active          <= 1'b1;
                    lock_active          <= 1'b0;
                    lock_control_enabled <= 1'b0;
                    lock_locked          <= 1'b0;
                    frame_active         <= 1'b0;
                    fast_index           <= 16'd0;
                    slow_index           <= 16'd0;
                    frame_index          <= 32'd0;
                    ch0_dwell_cnt        <= 32'd0;
                    state                <= ST_FRAME_INIT;
                end
            end else begin
                case (state)
                    ST_IDLE: begin
                        busy          <= 1'b0;
                        scan_active   <= 1'b0;
                        lock_active   <= 1'b0;
                        frame_active  <= 1'b0;
                        run_requested <= 1'b0;
                        req_ch0_code  <= 16'd0;
                        req_ch1_code  <= 16'd0;
                        fast_index    <= 16'd0;
                        slow_index    <= 16'd0;
                        frame_index   <= 32'd0;
                        ch0_dwell_cnt <= 32'd0;

                        if (ctrl_start_pulse && ctrl_enable && laser_arm) begin
                            done_latched <= 1'b0;
                            if (!tec_locked) begin
                                fault_latched <= 1'b1;
                                fault_status[FAULT_TEC_UNLOCKED] <= 1'b1;
                            end else begin
                                case (mode)
                                    MODE_IDLE: begin
                                        state <= ST_STOPPING;
                                    end

                                    MODE_STATIC: begin
                                        req_ch0_code  <= ch0_static_code;
                                        req_ch1_code  <= ch1_static_code;
                                        run_requested <= 1'b1;
                                        busy          <= 1'b1;
                                        state         <= ST_STATIC_RAMP;
                                    end

                                    MODE_FINE_SCAN: begin
                                        req_ch0_code  <= ch0_static_code;
                                        req_ch1_code  <= ch1_start_code;
                                        run_requested <= 1'b1;
                                        busy          <= 1'b1;
                                        scan_active   <= 1'b1;
                                        fast_index    <= 16'd0;
                                        slow_index    <= 16'd0;
                                        frame_index   <= 32'd0;
                                        state         <= ST_FRAME_INIT;
                                    end

                                    MODE_NESTED_SCAN: begin
                                        req_ch0_code  <= ch0_start_code;
                                        req_ch1_code  <= ch1_start_code;
                                        run_requested <= 1'b1;
                                        busy          <= 1'b1;
                                        scan_active   <= 1'b1;
                                        fast_index    <= 16'd0;
                                        slow_index    <= 16'd0;
                                        frame_index   <= 32'd0;
                                        ch0_dwell_cnt <= 32'd0;
                                        state         <= ST_FRAME_INIT;
                                    end

                                    MODE_LOCK: begin
                                        req_ch0_code         <= ch0_static_code;
                                        req_ch1_code         <= lock_bias_ch1_code;
                                        run_requested        <= 1'b1;
                                        busy                 <= 1'b1;
                                        lock_active          <= 1'b1;
                                        lock_control_enabled <= 1'b0;
                                        lock_locked          <= 1'b0;
                                        lock_lost            <= 1'b0;
                                        lock_saturated       <= 1'b0;
                                        lock_fb_timeout      <= 1'b0;
                                        lock_adc_invalid     <= 1'b0;
                                        lock_integral_s      <= 32'sd0;
                                        lock_error_s         <= 32'sd0;
                                        lock_locked_cnt      <= 16'd0;
                                        lock_loss_cnt        <= 16'd0;
                                        lock_sat_cnt         <= 32'd0;
                                        lock_fb_timeout_cnt  <= 32'd0;
                                        lock_hold_ch1_code   <= lock_bias_ch1_code;
                                        lock_last_output_ch1 <= lock_bias_ch1_code;
                                        lock_runtime_bias_ch1_code <= lock_bias_ch1_code;
                                        lock_output_ch1_code <= {16'd0, lock_bias_ch1_code};
                                        state                <= ST_LOCK_RAMP;
                                    end

                                    default: begin
                                        fault_latched <= 1'b1;
                                        fault_status[FAULT_ILLEGAL_MODE] <= 1'b1;
                                    end
                                endcase
                            end
                        end
                    end

                    ST_STATIC_RAMP: begin
                        busy <= 1'b1;
                        if (stop_or_disable) begin
                            state <= ST_STOPPING;
                        end else if (actual_matches_safe_target) begin
                            busy         <= 1'b0;
                            done_latched <= 1'b1;
                            state        <= ST_STATIC_HOLD;
                        end
                    end

                    ST_STATIC_HOLD: begin
                        busy <= 1'b0;
                        if (stop_or_disable) begin
                            busy  <= 1'b1;
                            state <= ST_STOPPING;
                        end else if (ctrl_start_pulse && ctrl_enable && laser_arm && (mode == MODE_FINE_SCAN)) begin
                            req_ch0_code  <= ch0_static_code;
                            req_ch1_code  <= ch1_start_code;
                            busy          <= 1'b1;
                            scan_active   <= 1'b1;
                            fast_index    <= 16'd0;
                            slow_index    <= 16'd0;
                            frame_index   <= 32'd0;
                            state         <= ST_FRAME_INIT;
                        end else begin
                            // Allow static code updates while holding static mode.
                            req_ch0_code <= ch0_static_code;
                            req_ch1_code <= ch1_static_code;
                        end
                    end

                    ST_FRAME_INIT: begin
                        busy              <= 1'b1;
                        frame_active      <= 1'b1;
                        frame_start_pulse <= 1'b1;
                        acquire_prev_valid <= 1'b0;
                        acquire_prev_adc   <= 16'd0;
                        acquire_prev_code  <= 16'd0;
                        settle_cnt        <= 32'd0;
                        dwell_cnt         <= 32'd0;
                        state             <= ST_WAIT_TARGET;
                    end

                    ST_WAIT_TARGET: begin
                        busy <= 1'b1;
                        if (stop_or_disable) begin
                            frame_active <= 1'b0;
                            scan_active  <= 1'b0;
                            state        <= ST_STOPPING;
                        end else if (actual_matches_safe_target) begin
                            settle_cnt <= 32'd0;
                            state      <= ST_SETTLE;
                        end
                    end

                    ST_SETTLE: begin
                        busy <= 1'b1;
                        if (stop_or_disable) begin
                            frame_active <= 1'b0;
                            scan_active  <= 1'b0;
                            state        <= ST_STOPPING;
                        end else if (settle_cnt >= dac_settle_ticks) begin
                            point_strobe <= 1'b1;
                            dwell_cnt    <= 32'd0;
                            state        <= ST_DWELL;
                        end else begin
                            settle_cnt <= settle_cnt + 32'd1;
                        end
                    end

                    ST_DWELL: begin
                        busy <= 1'b1;
                        if (stop_or_disable) begin
                            frame_active <= 1'b0;
                            scan_active  <= 1'b0;
                            state        <= ST_STOPPING;
                        end else if (dwell_cnt >= ch1_dwell_ticks) begin
                            state <= ST_ADVANCE;
                        end else begin
                            dwell_cnt <= dwell_cnt + 32'd1;
                        end
                    end

                    ST_ADVANCE: begin
                        busy <= 1'b1;
                        if (is_last_code(req_ch1_code, ch1_start_code, ch1_stop_code, ch1_step_code)) begin
                            frame_end_pulse <= 1'b1;
                            frame_active    <= 1'b0;

                            if (mode == MODE_FINE_SCAN) begin
                                req_ch0_code <= ch0_static_code;
                                req_ch1_code <= ch1_start_code;
                                state        <= ST_RETURN_SCAN;
                                if (frame_count != 32'd0)
                                    frame_index <= frame_index + 32'd1;
                            end else if (mode == MODE_NESTED_SCAN) begin
                                frame_index <= frame_index + 32'd1;

                                if ((ch0_dwell_cnt + 32'd1) < ch0_dwell_frames_eff) begin
                                    ch0_dwell_cnt <= ch0_dwell_cnt + 32'd1;
                                    fast_index    <= 16'd0;
                                    req_ch1_code  <= ch1_start_code;
                                    state         <= ST_FRAME_INIT;
                                end else begin
                                    ch0_dwell_cnt <= 32'd0;

                                    if (is_last_code(req_ch0_code, ch0_start_code, ch0_stop_code, ch0_step_code)) begin
                                        if (ctrl_continuous) begin
                                            req_ch0_code <= ch0_start_code;
                                            req_ch1_code <= ch1_start_code;
                                            slow_index   <= 16'd0;
                                            fast_index   <= 16'd0;
                                            state        <= ST_FRAME_INIT;
                                        end else begin
                                            scan_active <= 1'b0;
                                            state       <= ST_STOPPING;
                                        end
                                    end else begin
                                        req_ch0_code <= next_code(req_ch0_code, ch0_start_code, ch0_stop_code, ch0_step_code);
                                        req_ch1_code <= ch1_start_code;
                                        slow_index   <= slow_index + 16'd1;
                                        fast_index   <= 16'd0;
                                        state        <= ST_FRAME_INIT;
                                    end
                                end
                            end else begin
                                scan_active <= 1'b0;
                                state       <= ST_STOPPING;
                            end
                        end else begin
                            req_ch1_code <= next_code(req_ch1_code, ch1_start_code, ch1_stop_code, ch1_step_code);
                            fast_index   <= fast_index + 16'd1;
                            settle_cnt   <= 32'd0;
                            dwell_cnt    <= 32'd0;
                            state        <= ST_WAIT_TARGET;
                        end
                    end

                    ST_RETURN_SCAN: begin
                        busy         <= 1'b1;
                        frame_active <= 1'b0;
                        if (stop_or_disable) begin
                            scan_active <= 1'b0;
                            state       <= ST_STOPPING;
                        end else if (actual_matches_safe_target) begin
                            if (ctrl_continuous ||
                                ((frame_count != 32'd0) && (frame_index < frame_count))) begin
                                fast_index  <= 16'd0;
                                state       <= ST_FRAME_INIT;
                            end else begin
                                scan_active  <= 1'b0;
                                busy         <= 1'b0;
                                done_latched <= 1'b1;
                                state        <= ST_SCAN_HOLD;
                            end
                        end
                    end

                    ST_SCAN_HOLD: begin
                        busy         <= 1'b0;
                        scan_active  <= 1'b0;
                        frame_active <= 1'b0;
                        req_ch0_code <= ch0_static_code;
                        req_ch1_code <= ch1_start_code;
                        if (stop_or_disable) begin
                            busy  <= 1'b1;
                            state <= ST_STOPPING;
                        end else if (ctrl_start_pulse && ctrl_enable && laser_arm) begin
                            done_latched <= 1'b0;
                            if (mode == MODE_STATIC) begin
                                req_ch0_code <= ch0_static_code;
                                req_ch1_code <= ch1_static_code;
                                busy         <= 1'b1;
                                state        <= ST_STATIC_RAMP;
                            end else if (mode == MODE_FINE_SCAN) begin
                                scan_active <= 1'b1;
                                fast_index  <= 16'd0;
                                slow_index  <= 16'd0;
                                frame_index <= 32'd0;
                                state       <= ST_FRAME_INIT;
                            end
                        end
                    end

                    ST_LOCK_RAMP: begin
                        busy                 <= 1'b1;
                        lock_active          <= 1'b1;
                        lock_control_enabled <= 1'b0;
                        req_ch0_code         <= ch0_static_code;
                        req_ch1_code         <= lock_bias_ch1_code;
                        lock_last_output_ch1 <= lock_bias_ch1_code;
                        lock_runtime_bias_ch1_code <= lock_bias_ch1_code;
                        if (stop_or_disable) begin
                            lock_active          <= 1'b0;
                            lock_control_enabled <= 1'b0;
                            state                <= ST_STOPPING;
                        end else if (actual_matches_safe_target) begin
                            busy                 <= 1'b0;
                            done_latched         <= 1'b1;
                            lock_control_enabled <= 1'b1;
                            state                <= ST_LOCK_HOLD;
                        end
                    end

                    ST_LOCK_HOLD: begin
                        busy <= 1'b0;
                        if (stop_or_disable) begin
                            busy                 <= 1'b1;
                            lock_active          <= 1'b0;
                            lock_control_enabled <= 1'b0;
                            state                <= ST_STOPPING;
                        end else if (lock_lost) begin
                            lock_active          <= 1'b0;
                            lock_control_enabled <= 1'b0;
                            req_ch0_code         <= ch0_static_code;
                            req_ch1_code         <= lock_hold_ch1_code;
                        end else begin
                            lock_active          <= 1'b1;
                            lock_control_enabled <= 1'b1;
                            req_ch0_code         <= ch0_static_code;

                            if (!fb_adc_valid) begin
                                if (lock_fb_timeout_ticks != 32'd0) begin
                                    if (lock_fb_timeout_cnt >= lock_fb_timeout_ticks) begin
                                        lock_fb_timeout      <= 1'b1;
                                        lock_lost            <= 1'b1;
                                        lock_control_enabled <= 1'b0;
                                        lock_active          <= 1'b0;
                                        lock_hold_ch1_code   <= req_ch1_code;
                                    end else begin
                                        lock_fb_timeout_cnt <= lock_fb_timeout_cnt + 32'd1;
                                    end
                                end
                            end else if (((lock_adc_min_valid != 16'd0) || (lock_adc_max_valid != 16'd0)) &&
                                         ((fb_adc_data < lock_adc_min_valid) ||
                                          (fb_adc_data > lock_adc_max_valid))) begin
                                lock_adc_invalid     <= 1'b1;
                                lock_lost            <= 1'b1;
                                lock_control_enabled <= 1'b0;
                                lock_active          <= 1'b0;
                                lock_hold_ch1_code   <= req_ch1_code;
                                lock_loss_cnt        <= lock_loss_count_eff;
                            end else begin
                                lock_fb_timeout_cnt <= 32'd0;
                                lock_fb_timeout     <= 1'b0;
                            end
                        end
                    end

                    ST_STOPPING: begin
                        busy          <= 1'b1;
                        scan_active   <= 1'b0;
                        frame_active  <= 1'b0;
                        lock_active   <= 1'b0;
                        lock_control_enabled <= 1'b0;
                        acquire_active <= 1'b0;
                        acquire_prev_valid <= 1'b0;
                        run_requested <= 1'b0;
                        req_ch0_code  <= 16'd0;
                        req_ch1_code  <= 16'd0;

                        if (output_is_zero) begin
                            laser_enable <= 1'b0;
                            busy         <= 1'b0;
                            done_latched <= 1'b1;
                            state        <= ST_IDLE;
                        end
                    end

                    default: begin
                        state <= ST_IDLE;
                    end
                endcase
            end

            if (!lock_pipe_abort && lock_pipe_valid[LOCK_PIPE_STAGES-1]) begin
                req_ch1_code <= lock_pipe_s4_next_ch1_code;
                lock_last_output_ch1 <= lock_pipe_s4_next_ch1_code;
                lock_hold_ch1_code <= lock_pipe_s4_next_ch1_code;
                lock_error_s <= lock_pipe_s4_raw_error_s;
                lock_integral_s <= lock_pipe_s4_integral_next_s;
                lock_pid_code_s <= lock_pipe_s4_pid_delta_s;

                if (lock_pipe_s4_abs_error <= {16'd0, lock_pipe_s4_locked_threshold}) begin
                    lock_loss_cnt <= 16'd0;
                    if (lock_locked_cnt + 16'd1 >= lock_pipe_s4_locked_count_eff) begin
                        lock_locked_cnt <= lock_pipe_s4_locked_count_eff;
                        lock_locked     <= 1'b1;
                    end else begin
                        lock_locked_cnt <= lock_locked_cnt + 16'd1;
                    end
                end else begin
                    lock_locked_cnt <= 16'd0;
                    lock_locked     <= 1'b0;
                    if ((lock_pipe_s4_loss_threshold != 16'd0) &&
                        (lock_pipe_s4_abs_error > {16'd0, lock_pipe_s4_loss_threshold})) begin
                        if (lock_loss_cnt + 16'd1 >= lock_pipe_s4_loss_count_eff) begin
                            lock_loss_cnt        <= lock_pipe_s4_loss_count_eff;
                            lock_lost            <= 1'b1;
                            lock_control_enabled <= 1'b0;
                            lock_active          <= 1'b0;
                            lock_hold_ch1_code   <= lock_pipe_s4_next_ch1_code;
                        end else begin
                            lock_loss_cnt <= lock_loss_cnt + 16'd1;
                        end
                    end else begin
                        lock_loss_cnt <= 16'd0;
                    end
                end

                if (lock_pipe_s4_saturated) begin
                    lock_saturated <= 1'b1;
                    if (lock_pipe_s4_sat_count_enabled) begin
                        if (lock_sat_cnt + 32'd1 >= lock_pipe_s4_sat_count_eff) begin
                            lock_sat_cnt         <= lock_pipe_s4_sat_count_eff;
                            lock_lost            <= 1'b1;
                            lock_control_enabled <= 1'b0;
                            lock_active          <= 1'b0;
                            lock_hold_ch1_code   <= lock_pipe_s4_next_ch1_code;
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
    end

endmodule
