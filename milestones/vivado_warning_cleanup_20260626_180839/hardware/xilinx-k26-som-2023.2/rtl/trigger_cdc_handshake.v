`timescale 1ns / 1ps
/*
 * trigger_cdc_handshake.v
 *
 * 单次请求 / 单次完成握手机制：
 *   src_pulse(src_clk) -> dst_pulse(dst_clk) -> dst_done_pulse(dst_clk) -> src_done_pulse(src_clk)
 *
 * 说明：
 *   - src_busy=1 表示本轮请求已发出，但目的域还未返回 done。
 *   - src_busy=1 时，新的 src_pulse 会被忽略。
 */
module trigger_cdc_handshake (
    input  wire src_clk,
    input  wire dst_clk,
    input  wire rst_n,

    input  wire src_pulse,
    output reg  src_busy,
    output reg  src_done_pulse,

    output reg  dst_pulse,
    input  wire dst_done_pulse
);

    reg req_toggle_src;
    reg done_toggle_dst;

    reg [2:0] req_sync_dst;
    reg [2:0] done_sync_src;

    always @(posedge src_clk or negedge rst_n) begin
        if (!rst_n) begin
            req_toggle_src <= 1'b0;
            src_busy       <= 1'b0;
        end else begin
            if (src_pulse && !src_busy) begin
                req_toggle_src <= ~req_toggle_src;
                src_busy       <= 1'b1;
            end else if (src_done_pulse) begin
                src_busy <= 1'b0;
            end
        end
    end

    always @(posedge dst_clk or negedge rst_n) begin
        if (!rst_n) begin
            req_sync_dst <= 3'b000;
            dst_pulse    <= 1'b0;
        end else begin
            req_sync_dst <= {req_sync_dst[1:0], req_toggle_src};
            dst_pulse    <= req_sync_dst[2] ^ req_sync_dst[1];
        end
    end

    always @(posedge dst_clk or negedge rst_n) begin
        if (!rst_n) begin
            done_toggle_dst <= 1'b0;
        end else if (dst_done_pulse) begin
            done_toggle_dst <= ~done_toggle_dst;
        end
    end

    always @(posedge src_clk or negedge rst_n) begin
        if (!rst_n) begin
            done_sync_src  <= 3'b000;
            src_done_pulse <= 1'b0;
        end else begin
            done_sync_src  <= {done_sync_src[1:0], done_toggle_dst};
            src_done_pulse <= done_sync_src[2] ^ done_sync_src[1];
        end
    end

endmodule
