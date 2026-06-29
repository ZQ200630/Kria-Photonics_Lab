`timescale 1ns / 1ps

module async_fifo_64_xpm #(
    parameter FIFO_WRITE_DEPTH = 2048
) (
    input  wire         rst_n,

    input  wire         wr_clk,
    input  wire         wr_en,
    input  wire [63:0]  wr_data,
    output wire         full,
    output wire         overflow,

    input  wire         rd_clk,
    input  wire         rd_en,
    output wire [63:0]  rd_data,
    output wire         rd_valid,
    output wire         empty,
    output wire         underflow,

    output wire         wr_rst_busy,
    output wire         rd_rst_busy
);

    xpm_fifo_async #(
        .CASCADE_HEIGHT      (0),
        .CDC_SYNC_STAGES     (2),
        .DOUT_RESET_VALUE    ("0"),
        .ECC_MODE            ("no_ecc"),
        .FIFO_MEMORY_TYPE    ("block"),
        .FIFO_READ_LATENCY   (1),
        .FIFO_WRITE_DEPTH    (FIFO_WRITE_DEPTH),
        .FULL_RESET_VALUE    (0),
        .PROG_EMPTY_THRESH   (10),
        .PROG_FULL_THRESH    (10),
        .RD_DATA_COUNT_WIDTH (1),
        .READ_DATA_WIDTH     (64),
        .READ_MODE           ("std"),
        .RELATED_CLOCKS      (0),
        .SIM_ASSERT_CHK      (1),
        .USE_ADV_FEATURES    ("1002"), // underflow + overflow + data_valid
        .WAKEUP_TIME         (0),
        .WRITE_DATA_WIDTH    (64),
        .WR_DATA_COUNT_WIDTH (1)
    ) xpm_fifo_async_inst (
        .sleep          (1'b0),
        .rst            (~rst_n),

        .wr_clk         (wr_clk),
        .wr_en          (wr_en),
        .din            (wr_data),
        .full           (full),
        .overflow       (overflow),
        .wr_ack         (),
        .almost_full    (),
        .prog_full      (),
        .wr_data_count  (),
        .wr_rst_busy    (wr_rst_busy),

        .rd_clk         (rd_clk),
        .rd_en          (rd_en),
        .dout           (rd_data),
        .data_valid     (rd_valid),
        .empty          (empty),
        .underflow      (underflow),
        .almost_empty   (),
        .prog_empty     (),
        .rd_data_count  (),
        .rd_rst_busy    (rd_rst_busy),

        .injectdbiterr  (1'b0),
        .injectsbiterr  (1'b0),
        .dbiterr        (),
        .sbiterr        ()
    );

endmodule
