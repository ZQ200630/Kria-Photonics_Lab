`timescale 1ns / 1ps

module image_acq_controller (
    input  wire         clk,
    input  wire         rst_n,

    // Start control
    input  wire         start,               // only rising edge is captured

    // Backpressure from PL/PS pipeline
    // When high at a frame boundary, the controller holds the current frame context
    // and does not advance to the next frame/pixel until this signal goes low.
    input  wire         overall_busy_pl,

    // Scan configuration (sampled on start rising edge)
    // Signed 16-bit two's complement coordinates/steps for galvo
    input  wire signed [15:0] x_start,
    input  wire signed [15:0] x_step,
    input  wire        [15:0] x_points,

    input  wire signed [15:0] y_start,
    input  wire signed [15:0] y_step,
    input  wire        [15:0] y_points,

    input  wire [15:0]  frame_number,        // number of frames per pixel
    input  wire [31:0]  task_id,

    // scan_mode:
    //   0 = flyback   : each row always scans from x_start to x_end
    //   1 = raster    : serpentine scan, odd/even rows reverse direction
    input  wire         scan_mode,

    // All time parameters are in clk cycles
    input  wire [31:0]  gap_time,            // minimum time between consecutive frames
    input  wire [31:0]  galvo_settle_time,   // wait time after moving to a new pixel
    input  wire [31:0]  ld_trigger_time,     // laser trigger start offset inside one frame
    input  wire [31:0]  adc_trigger_time,    // adc trigger pulse offset inside one frame
    input  wire [31:0]  ld_time,             // laser trigger width

    // Main outputs
    output reg          busy,

    output reg          image_start_pulse,
    output reg          image_end_pulse,
    output reg          pixel_start_pulse,
    output reg          frame_start_pulse,

    output reg          laser_trigger,
    output reg          adc_trigger,

    output reg signed [15:0] galvo_x,
    output reg signed [15:0] galvo_y,

    (* X_INTERFACE_IGNORE = "TRUE" *)
    output reg [255:0]  meta_data,
    (* X_INTERFACE_IGNORE = "TRUE" *)
    output reg          meta_valid
);

    // -------------------------------------------------------------------------
    // State machine
    // -------------------------------------------------------------------------
    localparam [2:0]
        ST_IDLE             = 3'd0,
        ST_PREP_PIXEL       = 3'd1,
        ST_SETTLE           = 3'd2,
        ST_WAIT_FRAME_START = 3'd3,
        ST_FRAME_RUN        = 3'd4,
        ST_HOLD_LAST_FRAME  = 3'd5,
        ST_ADVANCE          = 3'd6,
        ST_END_IMAGE        = 3'd7;

    reg [2:0] state;

    // -------------------------------------------------------------------------
    // Start edge detect
    // -------------------------------------------------------------------------
    reg start_d;

    wire start_rise;
    assign start_rise = start & ~start_d;

    // -------------------------------------------------------------------------
    // Latched configuration for one image task
    // -------------------------------------------------------------------------
    reg signed [15:0] x_start_r;
    reg signed [15:0] x_step_r;
    reg        [15:0] x_points_r;

    reg signed [15:0] y_start_r;
    reg signed [15:0] y_step_r;
    reg        [15:0] y_points_r;

    reg [15:0] frame_number_r;
    reg [31:0] task_id_r;
    reg        scan_mode_r;

    reg [31:0] gap_time_r;
    reg [31:0] galvo_settle_time_r;
    reg [31:0] ld_trigger_time_r;
    reg [31:0] adc_trigger_time_r;
    reg [31:0] ld_time_r;

    // -------------------------------------------------------------------------
    // Current scan position / indices
    // -------------------------------------------------------------------------
    reg signed [15:0] current_x;
    reg signed [15:0] current_y;

    reg [15:0] x_idx;
    reg [15:0] y_idx;
    reg [15:0] frame_idx;        // 0-based frame index inside one pixel

    // -------------------------------------------------------------------------
    // Counters
    // -------------------------------------------------------------------------
    reg [31:0] settle_cnt;
    reg [31:0] slot_cnt;
    reg [31:0] global_shot_idx;  // counts total ADC-triggered shots in this image

    // -------------------------------------------------------------------------
    // Helper function
    // -------------------------------------------------------------------------
    function [31:0] max2_32;
        input [31:0] a;
        input [31:0] b;
        begin
            if (a >= b)
                max2_32 = a;
            else
                max2_32 = b;
        end
    endfunction

    // -------------------------------------------------------------------------
    // One frame length
    // frame_total_time = max(gap_time, ld_trigger_time + ld_time, adc_trigger_time + 1)
    // Force minimum 1 cycle
    // -------------------------------------------------------------------------
    wire [31:0] laser_end_time;
    wire [31:0] adc_end_time;
    wire [31:0] raw_frame_total_time;
    wire [31:0] frame_total_time;

    assign laser_end_time       = ld_trigger_time_r + ld_time_r;
    assign adc_end_time         = adc_trigger_time_r + 32'd1;
    assign raw_frame_total_time = max2_32(gap_time_r, max2_32(laser_end_time, adc_end_time));
    assign frame_total_time     = (raw_frame_total_time == 32'd0) ? 32'd1 : raw_frame_total_time;

    // -------------------------------------------------------------------------
    // Scan helpers
    // -------------------------------------------------------------------------
    // Current row direction:
    //   flyback: all rows forward
    //   raster : even rows forward, odd rows reverse
    wire row_reverse_cur;
    assign row_reverse_cur = scan_mode_r & y_idx[0];

    // End coordinate of one row: x_start + (x_points-1)*x_step
    // All done in signed arithmetic so negative coordinates work correctly.
    wire signed [31:0] x_points_minus1_s;
    wire signed [31:0] x_step_ext_s;
    wire signed [31:0] x_start_ext_s;
    wire signed [31:0] x_offset_last;
    wire signed [31:0] x_last_calc;
    wire signed [15:0] x_last_pos;
    
    wire signed [31:0] y_points_minus1_s;
    wire signed [31:0] y_step_ext_s;
    wire signed [31:0] y_start_ext_s;

    wire signed [31:0] x_center_calc;
    wire signed [31:0] y_center_calc;
    wire signed [15:0] x_center_pos;
    wire signed [15:0] y_center_pos;

    assign y_points_minus1_s = (y_points_r <= 16'd1) ? 32'sd0 :
                               ($signed({16'd0, y_points_r}) - 32'sd1);

    assign y_step_ext_s  = {{16{y_step_r[15]}}, y_step_r};
    assign y_start_ext_s = {{16{y_start_r[15]}}, y_start_r};

    // 几何中心：start + step * points / 2
    // 对你的例子：-2000 + 20*200/2 = 0
    assign x_center_calc = x_start_ext_s + ((x_step_ext_s * $signed({16'd0, x_points_r})) >>> 1);
    assign y_center_calc = y_start_ext_s + ((y_step_ext_s * $signed({16'd0, y_points_r})) >>> 1);

    assign x_center_pos = x_center_calc[15:0];
    assign y_center_pos = y_center_calc[15:0];
    
    // Metadata x index:
    //   flyback: same as logical x_idx
    //   raster forward row : same as logical x_idx
    //   raster reverse row : flip x_idx so metadata follows physical position
    wire [15:0] x_idx_meta;

    assign x_idx_meta = row_reverse_cur ?
                        ((x_points_r <= 16'd1) ? 16'd0 : (x_points_r - 16'd1 - x_idx)) :
                        x_idx;

    assign x_points_minus1_s = (x_points_r <= 16'd1) ? 32'sd0 :
                               ($signed({16'd0, x_points_r}) - 32'sd1);

    assign x_step_ext_s = {{16{x_step_r[15]}}, x_step_r};
    assign x_start_ext_s = {{16{x_start_r[15]}}, x_start_r};

    assign x_offset_last = x_step_ext_s * x_points_minus1_s;
    assign x_last_calc   = x_start_ext_s + x_offset_last;
    assign x_last_pos    = x_last_calc[15:0];

    // -------------------------------------------------------------------------
    // Main sequential logic
    // -------------------------------------------------------------------------
    always @(posedge clk or negedge rst_n) begin
        if (!rst_n) begin
            start_d             <= 1'b0;

            busy                <= 1'b0;
            image_start_pulse   <= 1'b0;
            image_end_pulse     <= 1'b0;
            pixel_start_pulse   <= 1'b0;
            frame_start_pulse   <= 1'b0;

            laser_trigger       <= 1'b0;
            adc_trigger         <= 1'b0;

            galvo_x             <= 16'sd0;
            galvo_y             <= 16'sd0;

            meta_data           <= 256'd0;
            meta_valid          <= 1'b0;

            state               <= ST_IDLE;

            x_start_r           <= 16'sd0;
            x_step_r            <= 16'sd0;
            x_points_r          <= 16'd0;
            y_start_r           <= 16'sd0;
            y_step_r            <= 16'sd0;
            y_points_r          <= 16'd0;
            frame_number_r      <= 16'd0;
            task_id_r           <= 32'd0;
            scan_mode_r         <= 1'b0;
            gap_time_r          <= 32'd0;
            galvo_settle_time_r <= 32'd0;
            ld_trigger_time_r   <= 32'd0;
            adc_trigger_time_r  <= 32'd0;
            ld_time_r           <= 32'd0;

            current_x           <= 16'sd0;
            current_y           <= 16'sd0;
            x_idx               <= 16'd0;
            y_idx               <= 16'd0;
            frame_idx           <= 16'd0;

            settle_cnt          <= 32'd0;
            slot_cnt            <= 32'd0;
            global_shot_idx     <= 32'd0;
        end else begin
            // edge detect register
            start_d <= start;

            // default pulse outputs: one-cycle unless set below
            image_start_pulse <= 1'b0;
            image_end_pulse   <= 1'b0;
            pixel_start_pulse <= 1'b0;
            frame_start_pulse <= 1'b0;
            adc_trigger       <= 1'b0;
            meta_valid        <= 1'b0;

            // default level outputs
            laser_trigger     <= 1'b0;

            case (state)
                // -----------------------------------------------------------------
                // IDLE
                // -----------------------------------------------------------------
                ST_IDLE: begin
                    busy <= 1'b0;

                    if (start_rise) begin
                        // Latch all configuration at the start edge
                        x_start_r           <= x_start;
                        x_step_r            <= x_step;
                        x_points_r          <= x_points;
                        y_start_r           <= y_start;
                        y_step_r            <= y_step;
                        y_points_r          <= y_points;
                        frame_number_r      <= frame_number;
                        task_id_r           <= task_id;
                        scan_mode_r         <= scan_mode;
                        gap_time_r          <= gap_time;
                        galvo_settle_time_r <= galvo_settle_time;
                        ld_trigger_time_r   <= ld_trigger_time;
                        adc_trigger_time_r  <= adc_trigger_time;
                        ld_time_r           <= ld_time;

                        // Empty task protection
                        if ((x_points == 16'd0) || (y_points == 16'd0) || (frame_number == 16'd0)) begin
                            busy              <= 1'b0;
                            image_start_pulse <= 1'b1;
                            image_end_pulse   <= 1'b1;
                            state             <= ST_IDLE;
                        end else begin
                            busy              <= 1'b1;
                            image_start_pulse <= 1'b1;

                            current_x         <= x_start;
                            current_y         <= y_start;
                            galvo_x           <= x_start;
                            galvo_y           <= y_start;

                            x_idx             <= 16'd0;
                            y_idx             <= 16'd0;
                            frame_idx         <= 16'd0;

                            settle_cnt        <= 32'd0;
                            slot_cnt          <= 32'd0;
                            global_shot_idx   <= 32'd0;

                            state             <= ST_PREP_PIXEL;
                        end
                    end
                end

                // -----------------------------------------------------------------
                // Load a new pixel coordinate to galvo
                // -----------------------------------------------------------------
                ST_PREP_PIXEL: begin
                    pixel_start_pulse <= 1'b1;

                    galvo_x <= current_x;
                    galvo_y <= current_y;

                    settle_cnt <= 32'd0;
                    slot_cnt   <= 32'd0;

                    if (galvo_settle_time_r == 32'd0)
                        state <= ST_WAIT_FRAME_START;
                    else
                        state <= ST_SETTLE;
                end

                // -----------------------------------------------------------------
                // Wait for galvo settling after coordinate update
                // -----------------------------------------------------------------
                ST_SETTLE: begin
                    if (settle_cnt + 32'd1 >= galvo_settle_time_r) begin
                        settle_cnt <= 32'd0;
                        slot_cnt   <= 32'd0;
                        state      <= ST_WAIT_FRAME_START;
                    end else begin
                        settle_cnt <= settle_cnt + 32'd1;
                    end
                end

                // -----------------------------------------------------------------
                // Before starting any frame, check backpressure once.
                // If overall_busy_pl is high, hold current frame/pixel context.
                // -----------------------------------------------------------------
                ST_WAIT_FRAME_START: begin
                    slot_cnt <= 32'd0;

                    if (!overall_busy_pl)
                        state <= ST_FRAME_RUN;
                end

                // -----------------------------------------------------------------
                // One frame timing slot
                // -----------------------------------------------------------------
                ST_FRAME_RUN: begin
                    if (slot_cnt == 32'd0)
                        frame_start_pulse <= 1'b1;

                    // Laser trigger width control
                    if ((slot_cnt >= ld_trigger_time_r) &&
                        (slot_cnt <  ld_trigger_time_r + ld_time_r) &&
                        (ld_time_r != 32'd0)) begin
                        laser_trigger <= 1'b1;
                    end

                    // ADC trigger pulse and metadata generation
                    if (slot_cnt == adc_trigger_time_r) begin
                        adc_trigger <= 1'b1;
                        meta_valid  <= 1'b1;

                        meta_data <= {
                            32'h4D455441,     // "META"
                            task_id_r,
                            current_x,
                            current_y,
                            x_idx_meta,
                            y_idx,
                            frame_idx,
                            frame_number_r,
                            x_points_r,
                            y_points_r,
                            global_shot_idx,
                            32'h00000000
                        };

                        global_shot_idx <= global_shot_idx + 32'd1;
                    end

                    if (slot_cnt + 32'd1 >= frame_total_time) begin
                        if (overall_busy_pl) begin
                            state <= ST_HOLD_LAST_FRAME;
                        end else begin
                            slot_cnt <= 32'd0;
                            state    <= ST_ADVANCE;
                        end
                    end else begin
                        slot_cnt <= slot_cnt + 32'd1;
                    end
                end

                // -----------------------------------------------------------------
                // Hold the just-finished frame context until downstream is ready.
                // -----------------------------------------------------------------
                ST_HOLD_LAST_FRAME: begin
                    if (!overall_busy_pl) begin
                        slot_cnt <= 32'd0;
                        state    <= ST_ADVANCE;
                    end
                end

                // -----------------------------------------------------------------
                // Advance frame / pixel / row / image
                // -----------------------------------------------------------------
                ST_ADVANCE: begin
                    // More frames at the same pixel?
                    if (frame_idx + 16'd1 < frame_number_r) begin
                        frame_idx <= frame_idx + 16'd1;
                        slot_cnt  <= 32'd0;
                        state     <= ST_WAIT_FRAME_START;
                    end else begin
                        // Frame loop finished for this pixel
                        frame_idx <= 16'd0;

                        // More x pixels in current row?
                        if (x_idx + 16'd1 < x_points_r) begin
                            x_idx <= x_idx + 16'd1;

                            if (row_reverse_cur)
                                current_x <= current_x - x_step_r;
                            else
                                current_x <= current_x + x_step_r;

                            state <= ST_PREP_PIXEL;
                        end else begin
                            // End of row
                            x_idx <= 16'd0;

                            if (y_idx + 16'd1 < y_points_r) begin
                                y_idx     <= y_idx + 16'd1;
                                current_y <= current_y + y_step_r;

                                // Choose starting x of next row
                                // flyback: always x_start
                                // raster : alternate between x_start and x_last_pos
                                if (scan_mode_r) begin
                                    if (!y_idx[0])
                                        current_x <= x_last_pos; // next row is odd -> reverse row
                                    else
                                        current_x <= x_start_r;  // next row is even -> forward row
                                end else begin
                                    current_x <= x_start_r;
                                end

                                state <= ST_PREP_PIXEL;
                            end else begin
                                // Entire image finished
                                state <= ST_END_IMAGE;
                            end
                        end
                    end
                end

                // -----------------------------------------------------------------
                // Image done
                // Added:
                //   1) return galvo to x_start / y_start
                //   2) keep outputs parked there after completion
                // -----------------------------------------------------------------
                ST_END_IMAGE: begin
                    busy            <= 1'b0;
                    image_end_pulse <= 1'b1;

                    current_x       <= x_center_pos;
                    current_y       <= y_center_pos;
                    galvo_x         <= x_center_pos;
                    galvo_y         <= y_center_pos;

                    x_idx           <= 16'd0;
                    y_idx           <= 16'd0;
                    frame_idx       <= 16'd0;

                    state           <= ST_IDLE;
                end

                default: begin
                    state <= ST_IDLE;
                end
            endcase
        end
    end

endmodule