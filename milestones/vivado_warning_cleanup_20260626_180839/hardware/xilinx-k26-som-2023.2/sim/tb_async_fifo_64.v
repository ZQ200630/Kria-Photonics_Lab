`timescale 1ns / 1ps
/*
 * 注意：本 testbench 依赖 Vivado 自带的 xpm_fifo_async。
 * 建议在 Vivado/xsim 中运行。
 */
module tb_async_fifo_64;

    reg         rst_n;
    reg         wr_clk;
    reg         rd_clk;
    reg         wr_en;
    reg  [63:0] wr_data;
    wire        full;
    wire        overflow;
    wire        wr_rst_busy;
    reg         rd_en;
    wire [63:0] rd_data;
    wire        rd_valid;
    wire        empty;
    wire        underflow;
    wire        rd_rst_busy;

    async_fifo_64 #(
        .FIFO_WRITE_DEPTH (32)
    ) dut (
        .rst_n       (rst_n),
        .wr_clk      (wr_clk),
        .wr_en       (wr_en),
        .wr_data     (wr_data),
        .full        (full),
        .overflow    (overflow),
        .wr_rst_busy (wr_rst_busy),
        .rd_clk      (rd_clk),
        .rd_en       (rd_en),
        .rd_data     (rd_data),
        .rd_valid    (rd_valid),
        .empty       (empty),
        .underflow   (underflow),
        .rd_rst_busy (rd_rst_busy)
    );

    initial begin
        wr_clk = 1'b0;
        forever #4 wr_clk = ~wr_clk;
    end

    initial begin
        rd_clk = 1'b0;
        forever #5 rd_clk = ~rd_clk;
    end

    task push_word;
        input [63:0] din;
        begin
            @(posedge wr_clk);
            if (!full && !wr_rst_busy) begin
                wr_data <= din;
                wr_en   <= 1'b1;
            end
            @(posedge wr_clk);
            wr_en   <= 1'b0;
            wr_data <= 64'd0;
        end
    endtask

    initial begin
        rst_n   = 1'b0;
        wr_en   = 1'b0;
        wr_data = 64'd0;
        rd_en   = 1'b0;

        #40;
        rst_n = 1'b1;

        wait (!wr_rst_busy && !rd_rst_busy);

        push_word(64'h1111_2222_3333_4444);
        push_word(64'hAAAA_BBBB_CCCC_DDDD);
        push_word(64'h0123_4567_89AB_CDEF);

        repeat (4) @(posedge rd_clk);

        @(posedge rd_clk);
        rd_en <= !empty && !rd_rst_busy;
        @(posedge rd_clk);
        rd_en <= !empty && !rd_rst_busy;
        @(posedge rd_clk);
        rd_en <= !empty && !rd_rst_busy;
        @(posedge rd_clk);
        rd_en <= 1'b0;

        repeat (10) @(posedge rd_clk);
        $finish;
    end

    always @(posedge rd_clk) begin
        if (rd_valid)
            $display("[%0t] rd_data=%h", $time, rd_data);
    end

endmodule
