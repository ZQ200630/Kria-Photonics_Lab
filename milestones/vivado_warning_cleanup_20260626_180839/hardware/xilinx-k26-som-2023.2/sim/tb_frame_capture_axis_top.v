`timescale 1ns / 1ps
/*
 * 注意：本 top testbench 依赖 XPM FIFO，建议在 Vivado/xsim 中运行。
 */
module tb_frame_capture_axis_top;

    reg         rst_n;
    reg         adc_clk;
    reg         pl_clk;
    reg [15:0]  adc_data;
    reg         trigger_pulse_pl;
    reg [15:0]  sample_n_pl;
    reg [255:0] meta_in_pl;
    wire [63:0] m_axis_tdata;
    wire [7:0]  m_axis_tkeep;
    wire        m_axis_tvalid;
    reg         m_axis_tready;
    wire        m_axis_tlast;
    wire        overall_busy_pl;
    wire        capture_done_pl;
    wire        tx_done_pl;
    wire        overflow_error_adc;

    integer adc_counter;
    integer beat_count;
    integer active_sample_count;
    integer i;
    reg [15:0] captured_samples [0:127];

    frame_capture_axis_top #(
        .FIFO_WRITE_DEPTH (128)
    ) dut (
        .rst_n              (rst_n),
        .adc_clk            (adc_clk),
        .adc_data           (adc_data),
        .pl_clk             (pl_clk),
        .trigger_pulse_pl   (trigger_pulse_pl),
        .sample_n_pl        (sample_n_pl),
        .meta_in_pl         (meta_in_pl),
        .m_axis_tdata       (m_axis_tdata),
        .m_axis_tkeep       (m_axis_tkeep),
        .m_axis_tvalid      (m_axis_tvalid),
        .m_axis_tready      (m_axis_tready),
        .m_axis_tlast       (m_axis_tlast),
        .overall_busy_pl    (overall_busy_pl),
        .capture_done_pl    (capture_done_pl),
        .tx_done_pl         (tx_done_pl),
        .overflow_error_adc (overflow_error_adc)
    );

    initial begin
        adc_clk = 1'b0;
        forever #4 adc_clk = ~adc_clk;
    end

    initial begin
        pl_clk = 1'b0;
        forever #5 pl_clk = ~pl_clk;
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

    always @(posedge adc_clk or negedge rst_n) begin
        if (!rst_n) begin
            active_sample_count <= 0;
        end else if (dut.u_adc_frame_capture.capture_active) begin
            captured_samples[active_sample_count] <= adc_data;
            active_sample_count <= active_sample_count + 1;
        end
    end

    always @(posedge pl_clk) begin
        if (capture_done_pl)
            $display("[%0t] capture_done_pl asserted", $time);
        if (m_axis_tvalid && m_axis_tready) begin
            beat_count = beat_count + 1;
            $display("[%0t] AXIS beat %0d: data=%h keep=%h last=%b", $time, beat_count, m_axis_tdata, m_axis_tkeep, m_axis_tlast);
        end
        if (tx_done_pl)
            $display("[%0t] tx_done_pl asserted", $time);
    end

    initial begin
        rst_n = 1'b0;
        adc_data = 16'd0;
        trigger_pulse_pl = 1'b0;
        sample_n_pl = 16'd18;
        meta_in_pl = 256'h0706_0504_0302_0100_F0E0_D0C0_B0A0_9080_7766_5544_3322_1100_0123_4567_89AB_CDEF;
        m_axis_tready = 1'b1;
        beat_count = 0;
        active_sample_count = 0;

        #40;
        rst_n = 1'b1;

        # 600
        @(posedge pl_clk);
        trigger_pulse_pl <= 1'b1;
        @(posedge pl_clk);
        trigger_pulse_pl <= 1'b0;

//        repeat (30) @(posedge pl_clk);
        m_axis_tready <= 1'b0;
        repeat (50) @(posedge pl_clk);
        m_axis_tready <= 1'b1;

        repeat (10) @(posedge pl_clk);
        m_axis_tready <= 1'b0;
        repeat (4) @(posedge pl_clk);
        m_axis_tready <= 1'b1;

        #5000;

        $display("\nCaptured samples in adc domain:");
        for (i = 0; i < sample_n_pl; i = i + 1) begin
            $display("sample[%0d] = %0d (0x%04h)", i, captured_samples[i], captured_samples[i]);
        end

        $finish;
    end

endmodule
