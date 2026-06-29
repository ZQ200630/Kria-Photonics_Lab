`timescale 1ns / 1ps

module tb_axis_frame_packer;

    reg         pl_clk;
    reg         rst_n;
    reg         start_pulse;
    reg [255:0] meta_in;
    reg [15:0]  sample_count_in;
    wire        fifo_rd_en;
    reg         fifo_empty;
    reg [63:0]  fifo_rd_data;
    reg         fifo_rd_valid;
    wire [63:0] m_axis_tdata;
    wire [7:0]  m_axis_tkeep;
    wire        m_axis_tvalid;
    reg         m_axis_tready;
    wire        m_axis_tlast;
    wire        busy;
    wire        done_pulse;

    reg [63:0] payload_mem [0:7];
    integer rd_ptr;
    integer available_words;
    integer delay_counter;

    axis_frame_packer dut (
        .pl_clk          (pl_clk),
        .rst_n           (rst_n),
        .start_pulse     (start_pulse),
        .meta_in         (meta_in),
        .sample_count_in (sample_count_in),
        .fifo_rd_en      (fifo_rd_en),
        .fifo_empty      (fifo_empty),
        .fifo_rd_data    (fifo_rd_data),
        .fifo_rd_valid   (fifo_rd_valid),
        .m_axis_tdata    (m_axis_tdata),
        .m_axis_tkeep    (m_axis_tkeep),
        .m_axis_tvalid   (m_axis_tvalid),
        .m_axis_tready   (m_axis_tready),
        .m_axis_tlast    (m_axis_tlast),
        .busy            (busy),
        .done_pulse      (done_pulse)
    );

    initial begin
        pl_clk = 1'b0;
        forever #5 pl_clk = ~pl_clk;
    end

    always @(posedge pl_clk or negedge rst_n) begin
        if (!rst_n) begin
            fifo_rd_valid   <= 1'b0;
            fifo_rd_data    <= 64'd0;
            rd_ptr          <= 0;
            available_words <= 0;
            delay_counter   <= -1;
        end else begin
            fifo_rd_valid <= 1'b0;

            if (start_pulse) begin
                available_words <= 3;
            end

            if (fifo_rd_en && !fifo_empty) begin
                delay_counter <= 1;
            end

            if (delay_counter >= 0) begin
                if (delay_counter == 0) begin
                    fifo_rd_data    <= payload_mem[rd_ptr];
                    fifo_rd_valid   <= 1'b1;
                    rd_ptr          <= rd_ptr + 1;
                    delay_counter   <= -1;
                end else begin
                    delay_counter <= delay_counter - 1;
                end
            end
        end
    end

    always @(*) begin
        fifo_empty = (rd_ptr >= available_words);
    end

    always @(posedge pl_clk) begin
        if (m_axis_tvalid && m_axis_tready)
            $display("[%0t] AXIS data=%h keep=%h last=%b", $time, m_axis_tdata, m_axis_tkeep, m_axis_tlast);
        if (done_pulse)
            $display("[%0t] done_pulse asserted", $time);
    end

    initial begin
        payload_mem[0] = 64'h0003_0002_0001_0000;
        payload_mem[1] = 64'h0007_0006_0005_0004;
        payload_mem[2] = 64'h0000_0000_0009_0008;

        rst_n = 1'b0;
        start_pulse = 1'b0;
        sample_count_in = 16'd10;
        meta_in = 256'h0706_0504_0302_0100_F0E0_D0C0_B0A0_9080_7766_5544_3322_1100_0123_4567_89AB_CDEF;
        m_axis_tready = 1'b1;

        #30;
        rst_n = 1'b1;

        @(posedge pl_clk);
        start_pulse <= 1'b1;
        @(posedge pl_clk);
        start_pulse <= 1'b0;

        repeat (6) @(posedge pl_clk);
        m_axis_tready <= 1'b0;
        repeat (3) @(posedge pl_clk);
        m_axis_tready <= 1'b1;

        #350;
        $finish;
    end

endmodule
