`timescale 1ns / 1ps

module frame_capture_axis_top #(
    parameter integer FIFO_WRITE_DEPTH = 8192,
    parameter integer ADC_START_DELAY  = 3
) (
    (* X_INTERFACE_INFO = "xilinx.com:signal:reset:1.0 rst_n RST" *)
    (* X_INTERFACE_PARAMETER = "POLARITY ACTIVE_LOW" *)
    input  wire         rst_n,

    input  wire         adc_clk,
    (* X_INTERFACE_IGNORE = "TRUE" *)
    input  wire [15:0]  adc_data,

    (* X_INTERFACE_INFO = "xilinx.com:signal:clock:1.0 pl_clk CLK" *)
    (* X_INTERFACE_PARAMETER = "ASSOCIATED_BUSIF m_axis, ASSOCIATED_RESET rst_n, FREQ_HZ 99999001" *)
    input  wire         pl_clk,

    (* X_INTERFACE_IGNORE = "TRUE" *)
    input  wire         trigger_pulse_pl,
    (* X_INTERFACE_IGNORE = "TRUE" *)
    input  wire [15:0]  sample_n_pl,
    (* X_INTERFACE_IGNORE = "TRUE" *)
    input  wire [255:0] meta_in_pl,

    (* X_INTERFACE_INFO = "xilinx.com:interface:axis:1.0 m_axis TDATA" *)
    output wire [63:0]  m_axis_tdata,
    (* X_INTERFACE_INFO = "xilinx.com:interface:axis:1.0 m_axis TKEEP" *)
    output wire [7:0]   m_axis_tkeep,
    (* X_INTERFACE_INFO = "xilinx.com:interface:axis:1.0 m_axis TVALID" *)
    output wire         m_axis_tvalid,
    (* X_INTERFACE_INFO = "xilinx.com:interface:axis:1.0 m_axis TREADY" *)
    input  wire         m_axis_tready,
    (* X_INTERFACE_INFO = "xilinx.com:interface:axis:1.0 m_axis TLAST" *)
    output wire         m_axis_tlast,

    output reg          overall_busy_pl,
    output wire         capture_done_pl,
    output wire         tx_done_pl,
    output wire         overflow_error_adc
);

    // =========================================================================
    // pl_clk domain
    // =========================================================================
    reg [255:0] meta_latched_pl;
    reg [15:0]  sample_n_latched_pl;
    reg         packet_start_pl;

    wire accepted_trigger_pl;

    assign accepted_trigger_pl = trigger_pulse_pl && !overall_busy_pl;

    always @(posedge pl_clk or negedge rst_n) begin
        if (!rst_n) begin
            meta_latched_pl     <= 256'd0;
            sample_n_latched_pl <= 16'd0;
            packet_start_pl     <= 1'b0;
            overall_busy_pl     <= 1'b0;
        end else begin
            // 只打一拍，且比锁存 metadata 晚一拍
            packet_start_pl <= accepted_trigger_pl;

            if (accepted_trigger_pl) begin
                meta_latched_pl     <= meta_in_pl;
                sample_n_latched_pl <= sample_n_pl;
                overall_busy_pl     <= 1'b1;
            end else if (tx_done_pl) begin
                overall_busy_pl <= 1'b0;
            end
        end
    end

    // =========================================================================
    // trigger CDC
    // =========================================================================
    wire cdc_src_busy_unused;
    wire trigger_pulse_adc_raw;
    wire capture_done_adc;

    trigger_cdc_handshake u_trigger_cdc_handshake (
        .src_clk        (pl_clk),
        .dst_clk        (adc_clk),
        .rst_n          (rst_n),
        .src_pulse      (accepted_trigger_pl),
        .src_busy       (cdc_src_busy_unused),
        .src_done_pulse (capture_done_pl),
        .dst_pulse      (trigger_pulse_adc_raw),
        .dst_done_pulse (capture_done_adc)
    );

    // =========================================================================
    // sample_n sync into adc_clk
    // =========================================================================
    reg [15:0] sample_n_sync0_adc;
    reg [15:0] sample_n_sync1_adc;
    reg [15:0] sample_n_sync2_adc;

    always @(posedge adc_clk or negedge rst_n) begin
        if (!rst_n) begin
            sample_n_sync0_adc <= 16'd0;
            sample_n_sync1_adc <= 16'd0;
            sample_n_sync2_adc <= 16'd0;
        end else begin
            sample_n_sync0_adc <= sample_n_latched_pl;
            sample_n_sync1_adc <= sample_n_sync0_adc;
            sample_n_sync2_adc <= sample_n_sync1_adc;
        end
    end

    // =========================================================================
    // adc side delayed start:
    // wait a few adc_clk cycles after trigger arrives, then latch stable sample_n
    // and generate one-cycle capture_start_adc
    // =========================================================================
    localparam integer ADC_DELAY_CNT_W = (ADC_START_DELAY <= 1) ? 1 : $clog2(ADC_START_DELAY + 1);

    reg [ADC_DELAY_CNT_W-1:0] adc_delay_cnt;
    reg                       adc_start_pending;
    reg                       capture_start_adc;
    reg [15:0]                sample_n_latched_adc;

    always @(posedge adc_clk or negedge rst_n) begin
        if (!rst_n) begin
            adc_delay_cnt        <= {ADC_DELAY_CNT_W{1'b0}};
            adc_start_pending    <= 1'b0;
            capture_start_adc    <= 1'b0;
            sample_n_latched_adc <= 16'd0;
        end else begin
            capture_start_adc <= 1'b0;

            if (trigger_pulse_adc_raw) begin
                adc_start_pending <= 1'b1;
                adc_delay_cnt     <= ADC_START_DELAY[ADC_DELAY_CNT_W-1:0];
            end else if (adc_start_pending) begin
                if (adc_delay_cnt != {ADC_DELAY_CNT_W{1'b0}}) begin
                    adc_delay_cnt <= adc_delay_cnt - {{(ADC_DELAY_CNT_W-1){1'b0}}, 1'b1};
                end else begin
                    sample_n_latched_adc <= sample_n_sync2_adc;
                    capture_start_adc    <= 1'b1;
                    adc_start_pending    <= 1'b0;
                end
            end
        end
    end

    // =========================================================================
    // FIFO signals
    // =========================================================================
    wire        fifo_full;
    wire        fifo_empty;
    wire        fifo_wr_en;
    wire [63:0] fifo_wr_data;
    wire        fifo_rd_en;
    wire [63:0] fifo_rd_data;
    wire        fifo_rd_valid;
    wire        fifo_overflow;
    wire        fifo_underflow;
    wire        fifo_wr_rst_busy;
    wire        fifo_rd_rst_busy;

    wire        capture_active_adc;
    wire        capture_overflow_error_adc;

    wire fifo_write_block;
    wire fifo_empty_safe;

    assign fifo_write_block   = fifo_full || fifo_wr_rst_busy;
    assign fifo_empty_safe    = fifo_empty || fifo_rd_rst_busy;
    assign overflow_error_adc = capture_overflow_error_adc || fifo_overflow;

    // =========================================================================
    // adc frame capture
    // =========================================================================
    adc_frame_capture u_adc_frame_capture (
        .adc_clk            (adc_clk),
        .rst_n              (rst_n),
        .trigger_pulse      (capture_start_adc),
        .sample_count_cfg   (sample_n_latched_adc),
        .adc_data           (adc_data),
        .fifo_full          (fifo_write_block),
        .fifo_wr_en         (fifo_wr_en),
        .fifo_wr_data       (fifo_wr_data),
        .capture_active     (capture_active_adc),
        .capture_done_pulse (capture_done_adc),
        .overflow_error     (capture_overflow_error_adc)
    );

    // =========================================================================
    // async fifo (XPM wrapper)
    // =========================================================================
    async_fifo_64 #(
        .FIFO_WRITE_DEPTH (FIFO_WRITE_DEPTH)
    ) u_async_fifo_64 (
        .rst_n       (rst_n),

        .wr_clk      (adc_clk),
        .wr_en       (fifo_wr_en),
        .wr_data     (fifo_wr_data),
        .full        (fifo_full),
        .overflow    (fifo_overflow),
        .wr_rst_busy (fifo_wr_rst_busy),

        .rd_clk      (pl_clk),
        .rd_en       (fifo_rd_en),
        .rd_data     (fifo_rd_data),
        .rd_valid    (fifo_rd_valid),
        .empty       (fifo_empty),
        .underflow   (fifo_underflow),
        .rd_rst_busy (fifo_rd_rst_busy)
    );

    // =========================================================================
    // packetizer
    // =========================================================================
    axis_frame_packer u_axis_frame_packer (
        .pl_clk          (pl_clk),
        .rst_n           (rst_n),
        .start_pulse     (packet_start_pl),
        .meta_in         (meta_latched_pl),
        .sample_count_in (sample_n_latched_pl),

        .fifo_rd_en      (fifo_rd_en),
        .fifo_empty      (fifo_empty_safe),
        .fifo_rd_data    (fifo_rd_data),
        .fifo_rd_valid   (fifo_rd_valid),

        .m_axis_tdata    (m_axis_tdata),
        .m_axis_tkeep    (m_axis_tkeep),
        .m_axis_tvalid   (m_axis_tvalid),
        .m_axis_tready   (m_axis_tready),
        .m_axis_tlast    (m_axis_tlast),

        .busy            (),
        .done_pulse      (tx_done_pl)
    );

endmodule