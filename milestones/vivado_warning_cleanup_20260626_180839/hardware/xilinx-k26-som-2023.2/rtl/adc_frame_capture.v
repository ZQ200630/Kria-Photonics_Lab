`timescale 1ns / 1ps
/*
 * adc_frame_capture.v
 *
 * 功能：
 *   - 在 adc_clk 域收到 trigger_pulse 后，连续采集 sample_count_cfg 个 16-bit sample。
 *   - 每 4 个 sample 打成 1 个 64-bit word。
 *   - 若最后不足 4 个 sample，则高位自动补 0。
 *   - 当需要写 word 但 fifo_full=1 时，置 overflow_error。
 *
 * 打包顺序：
 *   第 1 个 sample -> [15:0]
 *   第 2 个 sample -> [31:16]
 *   第 3 个 sample -> [47:32]
 *   第 4 个 sample -> [63:48]
 */
module adc_frame_capture (
    input  wire        adc_clk,
    input  wire        rst_n,

    input  wire        trigger_pulse,
    input  wire [15:0] sample_count_cfg,
    input  wire [15:0] adc_data,

    input  wire        fifo_full,
    output reg         fifo_wr_en,
    output reg  [63:0] fifo_wr_data,

    output reg         capture_active,
    output reg         capture_done_pulse,
    output reg         overflow_error
);

    reg [15:0] total_samples;
    reg [15:0] sample_index;
    reg [1:0]  pack_count;
    reg [63:0] pack_reg;

    reg [63:0] pack_next;

    function [63:0] insert_sample;
        input [63:0] base_word;
        input [1:0]  idx;
        input [15:0] sample;
        begin
            case (idx)
                2'd0: insert_sample = {base_word[63:16], sample};
                2'd1: insert_sample = {base_word[63:32], sample, base_word[15:0]};
                2'd2: insert_sample = {base_word[63:48], sample, base_word[31:0]};
                2'd3: insert_sample = {sample, base_word[47:0]};
                default: insert_sample = base_word;
            endcase
        end
    endfunction

    always @(posedge adc_clk or negedge rst_n) begin
        if (!rst_n) begin
            fifo_wr_en         <= 1'b0;
            fifo_wr_data       <= 64'd0;
            capture_active     <= 1'b0;
            capture_done_pulse <= 1'b0;
            overflow_error     <= 1'b0;
            total_samples      <= 16'd0;
            sample_index       <= 16'd0;
            pack_count         <= 2'd0;
            pack_reg           <= 64'd0;
            pack_next          <= 64'd0;
        end else begin
            fifo_wr_en         <= 1'b0;
            capture_done_pulse <= 1'b0;

            if (trigger_pulse && !capture_active) begin
                total_samples  <= sample_count_cfg;
                sample_index   <= 16'd0;
                pack_count     <= 2'd0;
                pack_reg       <= 64'd0;
                pack_next      <= 64'd0;
                overflow_error <= 1'b0;

                if (sample_count_cfg == 16'd0) begin
                    capture_active     <= 1'b0;
                    capture_done_pulse <= 1'b1;
                end else begin
                    capture_active <= 1'b1;
                end
            end else if (capture_active) begin
                pack_next <= insert_sample(pack_reg, pack_count, adc_data);

                if ((pack_count == 2'd3) || (sample_index == total_samples - 16'd1)) begin
                    if (!fifo_full) begin
                        fifo_wr_en   <= 1'b1;
                        fifo_wr_data <= insert_sample(pack_reg, pack_count, adc_data);
                    end else begin
                        overflow_error <= 1'b1;
                    end
                    pack_reg   <= 64'd0;
                    pack_count <= 2'd0;
                end else begin
                    pack_reg   <= insert_sample(pack_reg, pack_count, adc_data);
                    pack_count <= pack_count + 2'd1;
                end

                if (sample_index == total_samples - 16'd1) begin
                    capture_active     <= 1'b0;
                    capture_done_pulse <= 1'b1;
                    sample_index       <= 16'd0;
                end else begin
                    sample_index <= sample_index + 16'd1;
                end
            end
        end
    end

endmodule
