`timescale 1ns / 1ps

module tb_adc_frame_capture;

    reg         adc_clk;
    reg         rst_n;
    reg         trigger_pulse;
    reg [15:0]  sample_count_cfg;
    reg [15:0]  adc_data;
    reg         fifo_full;
    wire        fifo_wr_en;
    wire [63:0] fifo_wr_data;
    wire        capture_active;
    wire        capture_done_pulse;
    wire        overflow_error;

    integer adc_counter;

    adc_frame_capture dut (
        .adc_clk            (adc_clk),
        .rst_n              (rst_n),
        .trigger_pulse      (trigger_pulse),
        .sample_count_cfg   (sample_count_cfg),
        .adc_data           (adc_data),
        .fifo_full          (fifo_full),
        .fifo_wr_en         (fifo_wr_en),
        .fifo_wr_data       (fifo_wr_data),
        .capture_active     (capture_active),
        .capture_done_pulse (capture_done_pulse),
        .overflow_error     (overflow_error)
    );

    initial begin
        adc_clk = 1'b0;
        forever #4 adc_clk = ~adc_clk;
    end

    always @(posedge adc_clk or negedge rst_n) begin
        if (!rst_n) begin
            adc_counter <= 0;
            adc_data    <= 16'd0;
        end else begin
            adc_data    <= adc_counter[15:0];
            adc_counter <= adc_counter + 1;
        end
    end

    always @(posedge adc_clk) begin
        if (fifo_wr_en)
            $display("[%0t] fifo_wr_data=%h", $time, fifo_wr_data);
        if (capture_done_pulse)
            $display("[%0t] capture_done_pulse", $time);
    end

    task fire_trigger;
        input [15:0] n;
        begin
            @(posedge adc_clk);
            sample_count_cfg <= n;
            trigger_pulse    <= 1'b1;
            @(posedge adc_clk);
            trigger_pulse    <= 1'b0;
        end
    endtask

    initial begin
        rst_n = 1'b0;
        trigger_pulse = 1'b0;
        sample_count_cfg = 16'd0;
        fifo_full = 1'b0;
        adc_data = 16'd0;

        #25;
        rst_n = 1'b1;

        fire_trigger(16'd8);
        repeat (8) @(posedge adc_clk);

        fire_trigger(16'd5);
        repeat (8) @(posedge adc_clk);

        fire_trigger(16'd0);
        repeat (4) @(posedge adc_clk);

        $finish;
    end

endmodule
