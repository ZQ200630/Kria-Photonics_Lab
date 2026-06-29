`timescale 1ns / 1ps

module tb_image_acq_controller;

    reg         clk;
    reg         rst_n;
    reg         start;

    reg [15:0]  x_start;
    reg [15:0]  x_step;
    reg [15:0]  x_points;

    reg [15:0]  y_start;
    reg [15:0]  y_step;
    reg [15:0]  y_points;

    reg [15:0]  frame_number;
    reg [31:0]  task_id;

    reg [31:0]  gap_time;
    reg [31:0]  galvo_settle_time;
    reg [31:0]  ld_trigger_time;
    reg [31:0]  adc_trigger_time;
    reg [31:0]  ld_time;

    wire        busy;

    wire        image_start_pulse;
    wire        image_end_pulse;
    wire        pixel_start_pulse;
    wire        frame_start_pulse;

    wire        laser_trigger;
    wire        adc_trigger;

    wire [15:0] galvo_x;
    wire [15:0] galvo_y;

    
    wire [255:0] meta_data;
    wire         meta_valid;

    integer image_start_cnt;
    integer image_end_cnt;
    integer pixel_start_cnt;
    integer frame_start_cnt;
    integer adc_trigger_cnt;
    integer meta_valid_cnt;
    integer error_cnt;

    // ------------------------------------------------------------------------
    // DUT
    // ------------------------------------------------------------------------
    image_acq_controller dut (
        .clk               (clk),
        .rst_n             (rst_n),
        .start             (start),

        .x_start           (x_start),
        .x_step            (x_step),
        .x_points          (x_points),
        .y_start           (y_start),
        .y_step            (y_step),
        .y_points          (y_points),

        .frame_number      (frame_number),
        .task_id           (task_id),

        .gap_time          (gap_time),
        .galvo_settle_time (galvo_settle_time),
        .ld_trigger_time   (ld_trigger_time),
        .adc_trigger_time  (adc_trigger_time),
        .ld_time           (ld_time),

        .busy              (busy),

        .image_start_pulse (image_start_pulse),
        .image_end_pulse   (image_end_pulse),
        .pixel_start_pulse (pixel_start_pulse),
        .frame_start_pulse (frame_start_pulse),

        .laser_trigger     (laser_trigger),
        .adc_trigger       (adc_trigger),

        .galvo_x           (galvo_x),
        .galvo_y           (galvo_y),

        .meta_data         (meta_data),
        .meta_valid        (meta_valid)
    );

    // ------------------------------------------------------------------------
    // Clock: 100 MHz
    // ------------------------------------------------------------------------
    initial begin
        clk = 1'b0;
        forever #5 clk = ~clk;
    end

    // ------------------------------------------------------------------------
    // Dump waveform
    // ------------------------------------------------------------------------
    initial begin
        $dumpfile("tb_image_acq_controller.vcd");
        $dumpvars(0, tb_image_acq_controller);
    end

    // ------------------------------------------------------------------------
    // Utility tasks
    // ------------------------------------------------------------------------
    task clear_counters;
    begin
        image_start_cnt = 0;
        image_end_cnt   = 0;
        pixel_start_cnt = 0;
        frame_start_cnt = 0;
        adc_trigger_cnt = 0;
        meta_valid_cnt  = 0;
    end
    endtask

    task send_start_pulse;
    begin
        @(negedge clk);
        start = 1'b1;
        @(negedge clk);
        start = 1'b0;
    end
    endtask

    task check_equal;
        input [255:0] name;
        input integer actual;
        input integer expected;
    begin
        if (actual != expected) begin
            $display("[ERROR] %0s: actual=%0d expected=%0d", name, actual, expected);
            error_cnt = error_cnt + 1;
        end else begin
            $display("[OK]    %0s: %0d", name, actual);
        end
    end
    endtask

    // ------------------------------------------------------------------------
    // Monitor
    // 用 #1 是为了等 DUT 里的 nonblocking assignment 生效后再观察
    // ------------------------------------------------------------------------
    always @(posedge clk) begin
        #1;

        if (image_start_pulse) begin
            image_start_cnt = image_start_cnt + 1;
            $display("[%0t] IMAGE_START, busy=%0d", $time, busy);
        end

        if (image_end_pulse) begin
            image_end_cnt = image_end_cnt + 1;
            $display("[%0t] IMAGE_END, busy=%0d", $time, busy);
        end

        if (pixel_start_pulse) begin
            pixel_start_cnt = pixel_start_cnt + 1;
            $display("[%0t] PIXEL_START, galvo_x=%0d, galvo_y=%0d",
                     $time, galvo_x, galvo_y);
        end

        if (frame_start_pulse) begin
            frame_start_cnt = frame_start_cnt + 1;
            $display("[%0t] FRAME_START", $time);
        end

        if (adc_trigger) begin
            adc_trigger_cnt = adc_trigger_cnt + 1;
            $display("[%0t] ADC_TRIGGER", $time);
        end

        if (meta_valid) begin
            meta_valid_cnt = meta_valid_cnt + 1;
            $display("[%0t] META_VALID: task_id=0x%08h x=%0d y=%0d x_idx=%0d y_idx=%0d frame_idx=%0d frame_number=%0d global_shot_idx=%0d",
                     $time,
                     meta_data[223:192],
                     meta_data[191:176],
                     meta_data[175:160],
                     meta_data[159:144],
                     meta_data[143:128],
                     meta_data[127:112],
                     meta_data[111:96],
                     meta_data[63:32]);
        end
    end

    // ------------------------------------------------------------------------
    // Timeout protection
    // ------------------------------------------------------------------------
    initial begin
        #200000;
        $display("[ERROR] Simulation timeout.");
        $finish;
    end

    // ------------------------------------------------------------------------
    // Main stimulus
    // ------------------------------------------------------------------------
    initial begin
        error_cnt = 0;

        rst_n = 1'b0;
        start = 1'b0;

        x_start = 16'd0;
        x_step  = 16'd0;
        x_points = 16'd0;

        y_start = 16'd0;
        y_step  = 16'd0;
        y_points = 16'd0;

        frame_number = 16'd0;
        task_id      = 32'd0;

        gap_time          = 32'd0;
        galvo_settle_time = 32'd0;
        ld_trigger_time   = 32'd0;
        adc_trigger_time  = 32'd0;
        ld_time           = 32'd0;

        clear_counters();

        repeat (5) @(posedge clk);
        rst_n = 1'b1;
        repeat (2) @(posedge clk);

        // ================================================================
        // IMAGE 1
        // 3 x-points, 2 y-points, 2 frames per pixel
        // total pixels = 3 * 2 = 6
        // total frames = 6 * 2 = 12
        // ================================================================
        x_start      = 16'd1000;
        x_step       = 16'd10;
        x_points     = 16'd3;

        y_start      = 16'd2000;
        y_step       = 16'd20;
        y_points     = 16'd2;

        frame_number = 16'd2;
        task_id      = 32'h1234_5678;

        gap_time          = 32'd8;
        galvo_settle_time = 32'd3;
        ld_trigger_time   = 32'd2;
        adc_trigger_time  = 32'd5;
        ld_time           = 32'd2;

        clear_counters();

        $display("========================================================");
        $display("START IMAGE 1");
        $display("========================================================");

        send_start_pulse();

        // 在 busy 期间再发一次 start，应该被忽略
        repeat (10) @(posedge clk);
        $display("[%0t] Try another start pulse while busy=1. It should be ignored.", $time);
        send_start_pulse();

        wait (image_end_pulse == 1'b1);
        #2;

        $display("--------------------------------------------------------");
        $display("CHECK IMAGE 1");
        $display("--------------------------------------------------------");

        check_equal("image_start_cnt", image_start_cnt, 1);
        check_equal("image_end_cnt",   image_end_cnt,   1);
        check_equal("pixel_start_cnt", pixel_start_cnt, 6);
        check_equal("frame_start_cnt", frame_start_cnt, 12);
        check_equal("adc_trigger_cnt", adc_trigger_cnt, 12);
        check_equal("meta_valid_cnt",  meta_valid_cnt,  12);

        // ================================================================
        // IMAGE 2
        // 再次启动，验证 start 拉低后再拉高可以重新采集
        // 2 x-points, 1 y-point, 1 frame per pixel
        // total pixels = 2
        // total frames = 2
        // ================================================================
        repeat (5) @(posedge clk);

        x_start      = 16'd300;
        x_step       = 16'd5;
        x_points     = 16'd2;

        y_start      = 16'd500;
        y_step       = 16'd7;
        y_points     = 16'd1;

        frame_number = 16'd1;
        task_id      = 32'hCAFE_BEEF;

        gap_time          = 32'd6;
        galvo_settle_time = 32'd2;
        ld_trigger_time   = 32'd1;
        adc_trigger_time  = 32'd3;
        ld_time           = 32'd2;

        clear_counters();

        $display("========================================================");
        $display("START IMAGE 2");
        $display("========================================================");

        send_start_pulse();

        wait (image_end_pulse == 1'b1);
        #2;

        $display("--------------------------------------------------------");
        $display("CHECK IMAGE 2");
        $display("--------------------------------------------------------");

        check_equal("image_start_cnt", image_start_cnt, 1);
        check_equal("image_end_cnt",   image_end_cnt,   1);
        check_equal("pixel_start_cnt", pixel_start_cnt, 2);
        check_equal("frame_start_cnt", frame_start_cnt, 2);
        check_equal("adc_trigger_cnt", adc_trigger_cnt, 2);
        check_equal("meta_valid_cnt",  meta_valid_cnt,  2);

        // ================================================================
        // Final result
        // ================================================================
        $display("========================================================");
        if (error_cnt == 0) begin
            $display("TEST PASSED");
        end else begin
            $display("TEST FAILED, error_cnt = %0d", error_cnt);
        end
        $display("========================================================");

        #20;
        $finish;
    end

endmodule
