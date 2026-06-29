`timescale 1ns / 1ps

module axis_frame_packer (
    input  wire         pl_clk,
    input  wire         rst_n,
    input  wire         start_pulse,
    input  wire [255:0] meta_in,
    input  wire [15:0]  sample_count_in,

    output reg          fifo_rd_en,
    input  wire         fifo_empty,
    input  wire [63:0]  fifo_rd_data,
    input  wire         fifo_rd_valid,   // 保留端口，但本版本不使用

    output reg  [63:0]  m_axis_tdata,
    output reg  [7:0]   m_axis_tkeep,
    output reg          m_axis_tvalid,
    input  wire         m_axis_tready,
    output reg          m_axis_tlast,

    output reg          busy,
    output reg          done_pulse
);

    localparam ST_IDLE         = 3'd0;
    localparam ST_META_LOAD    = 3'd1;
    localparam ST_META_SEND    = 3'd2;
    localparam ST_PAYLOAD_REQ  = 3'd3;
    localparam ST_PAYLOAD_WAIT = 3'd4;
    localparam ST_PAYLOAD_SEND = 3'd5;

    reg [2:0]   state;

    reg [255:0] meta_latched;
    reg [15:0]  sample_count_latched;

    reg [2:0]   meta_idx;
    reg [15:0]  payload_words_total;
    reg [15:0]  payload_words_sent;
    reg [7:0]   last_keep;

    reg [63:0]  payload_buf;

    wire axis_fire;
    assign axis_fire = m_axis_tvalid && m_axis_tready;

    function [7:0] calc_last_keep;
        input [15:0] sample_count;
        begin
            case (sample_count[1:0])
                2'd0: calc_last_keep = 8'hFF;
                2'd1: calc_last_keep = 8'h03;
                2'd2: calc_last_keep = 8'h0F;
                2'd3: calc_last_keep = 8'h3F;
                default: calc_last_keep = 8'hFF;
            endcase
        end
    endfunction

    function [63:0] select_meta_word;
        input [255:0] meta_data;
        input [2:0]   idx;
        begin
            case (idx)
                3'd0: select_meta_word = meta_data[ 63:  0];
                3'd1: select_meta_word = meta_data[127: 64];
                3'd2: select_meta_word = meta_data[191:128];
                3'd3: select_meta_word = meta_data[255:192];
                default: select_meta_word = 64'd0;
            endcase
        end
    endfunction

    always @(posedge pl_clk or negedge rst_n) begin
        if (!rst_n) begin
            state                <= ST_IDLE;
            fifo_rd_en           <= 1'b0;

            m_axis_tdata         <= 64'd0;
            m_axis_tkeep         <= 8'd0;
            m_axis_tvalid        <= 1'b0;
            m_axis_tlast         <= 1'b0;

            busy                 <= 1'b0;
            done_pulse           <= 1'b0;

            meta_latched         <= 256'd0;
            sample_count_latched <= 16'd0;
            meta_idx             <= 3'd0;
            payload_words_total  <= 16'd0;
            payload_words_sent   <= 16'd0;
            last_keep            <= 8'hFF;
            payload_buf          <= 64'd0;
        end else begin
            fifo_rd_en   <= 1'b0;
            done_pulse   <= 1'b0;

            case (state)

                ST_IDLE: begin
                    m_axis_tvalid <= 1'b0;
                    m_axis_tlast  <= 1'b0;
                    busy          <= 1'b0;

                    if (start_pulse) begin
                        meta_latched         <= meta_in;
                        sample_count_latched <= sample_count_in;
                        payload_words_total  <= (sample_count_in + 16'd3) >> 2;
                        payload_words_sent   <= 16'd0;
                        meta_idx             <= 3'd0;
                        last_keep            <= calc_last_keep(sample_count_in);
                        busy                 <= 1'b1;
                        state                <= ST_META_LOAD;
                    end
                end

                ST_META_LOAD: begin
                    m_axis_tdata  <= select_meta_word(meta_latched, meta_idx);
                    m_axis_tkeep  <= 8'hFF;
                    m_axis_tlast  <= 1'b0;
                    m_axis_tvalid <= 1'b1;
                    state         <= ST_META_SEND;
                end

                ST_META_SEND: begin
                    if (axis_fire) begin
                        m_axis_tvalid <= 1'b0;

                        if (meta_idx == 3'd3) begin
                            if (payload_words_total == 16'd0) begin
                                done_pulse <= 1'b1;
                                busy       <= 1'b0;
                                state      <= ST_IDLE;
                            end else begin
                                state <= ST_PAYLOAD_REQ;
                            end
                        end else begin
                            meta_idx <= meta_idx + 3'd1;
                            state    <= ST_META_LOAD;
                        end
                    end
                end

                ST_PAYLOAD_REQ: begin
                    if (payload_words_sent >= payload_words_total) begin
                        done_pulse <= 1'b1;
                        busy       <= 1'b0;
                        state      <= ST_IDLE;
                    end else if (!fifo_empty) begin
                        fifo_rd_en <= 1'b1;
                        state      <= ST_PAYLOAD_WAIT;
                    end
                end

                // 固定等待 1 拍，对应 FIFO_READ_LATENCY = 1
                ST_PAYLOAD_WAIT: begin
                    payload_buf <= fifo_rd_data;
                    state       <= ST_PAYLOAD_SEND;
                end

                ST_PAYLOAD_SEND: begin
                    m_axis_tdata  <= payload_buf;
                    m_axis_tvalid <= 1'b1;

                    if (payload_words_sent == payload_words_total - 1) begin
                        m_axis_tkeep <= last_keep;
                        m_axis_tlast <= 1'b1;
                    end else begin
                        m_axis_tkeep <= 8'hFF;
                        m_axis_tlast <= 1'b0;
                    end

                    if (axis_fire) begin
                        m_axis_tvalid      <= 1'b0;
                        m_axis_tlast       <= 1'b0;
                        payload_words_sent <= payload_words_sent + 16'd1;

                        if (payload_words_sent == payload_words_total - 1) begin
                            done_pulse <= 1'b1;
                            busy       <= 1'b0;
                            state      <= ST_IDLE;
                        end else begin
                            state <= ST_PAYLOAD_REQ;
                        end
                    end
                end

                default: begin
                    state <= ST_IDLE;
                end
            endcase
        end
    end

endmodule