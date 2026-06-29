`timescale 1ns / 1ps

module tb_frame_capture_axis_top_verify;

    // =========================================================
    // parameters
    // =========================================================
    localparam integer FIFO_WRITE_DEPTH = 2048;
    localparam integer ADC_START_DELAY  = 3;

    localparam integer MAX_AXIS_BEATS   = 256;
    localparam integer MAX_FIFO_WORDS   = 256;
    localparam integer TIMEOUT_NS       = 200000;

    // =========================================================
    // DUT I/O
    // =========================================================
    reg         rst_n;
    reg         adc_clk;
    reg         pl_clk;
    reg  [15:0] adc_data;

    reg         trigger_pulse_pl;
    reg  [15:0] sample_n_pl;
    reg  [255:0] meta_in_pl;

    wire [63:0] m_axis_tdata;
    wire [7:0]  m_axis_tkeep;
    wire        m_axis_tvalid;
    reg         m_axis_tready;
    wire        m_axis_tlast;

    wire        overall_busy_pl;
    wire        capture_done_pl;
    wire        tx_done_pl;
    wire        overflow_error_adc;

    // =========================================================
    // DUT
    // =========================================================
    frame_capture_axis_top #(
        .FIFO_WRITE_DEPTH(FIFO_WRITE_DEPTH),
        .ADC_START_DELAY (ADC_START_DELAY)
    ) dut (
        .rst_n             (rst_n),
        .adc_clk           (adc_clk),
        .adc_data          (adc_data),
        .pl_clk            (pl_clk),
        .trigger_pulse_pl  (trigger_pulse_pl),
        .sample_n_pl       (sample_n_pl),
        .meta_in_pl        (meta_in_pl),
        .m_axis_tdata      (m_axis_tdata),
        .m_axis_tkeep      (m_axis_tkeep),
        .m_axis_tvalid     (m_axis_tvalid),
        .m_axis_tready     (m_axis_tready),
        .m_axis_tlast      (m_axis_tlast),
        .overall_busy_pl   (overall_busy_pl),
        .capture_done_pl   (capture_done_pl),
        .tx_done_pl        (tx_done_pl),
        .overflow_error_adc(overflow_error_adc)
    );

    // =========================================================
    // clocks
    // =========================================================
    initial begin
        adc_clk = 1'b0;
        forever #4 adc_clk = ~adc_clk;   // 125 MHz
    end

    initial begin
        pl_clk = 1'b0;
        forever #5 pl_clk = ~pl_clk;     // 100 MHz
    end

    // =========================================================
    // ADC stimulus: monotonic counter
    // =========================================================
    reg [31:0] adc_counter;

    always @(posedge adc_clk or negedge rst_n) begin
        if (!rst_n) begin
            adc_counter <= 32'd0;
            adc_data    <= 16'd0;
        end else begin
            adc_counter <= adc_counter + 1'b1;
            adc_data    <= adc_counter[15:0];
        end
    end

    // =========================================================
    // AXIS sink: always ready
    // =========================================================
    initial begin
        m_axis_tready = 1'b1;
    end

    // =========================================================
    // bookkeeping memories
    // =========================================================
    integer axis_count;
    integer fifo_word_count;
    integer i;
    integer err_cnt;

    reg [63:0] axis_data_mem [0:MAX_AXIS_BEATS-1];
    reg [7:0]  axis_keep_mem [0:MAX_AXIS_BEATS-1];
    reg        axis_last_mem [0:MAX_AXIS_BEATS-1];

    reg [63:0] fifo_word_mem [0:MAX_FIFO_WORDS-1];

    reg [255:0] meta_expected;
    reg [15:0]  sample_n_expected;

    integer payload_words_expected;
    integer total_axis_beats_expected;

    // =========================================================
    // helpers
    // =========================================================
    function [7:0] calc_last_keep;
        input [15:0] sample_count;
        begin
            case (sample_count[1:0])
                2'd0: calc_last_keep = 8'hFF; // 4 samples = 8 bytes
                2'd1: calc_last_keep = 8'h03; // 1 sample  = 2 bytes
                2'd2: calc_last_keep = 8'h0F; // 2 samples = 4 bytes
                2'd3: calc_last_keep = 8'h3F; // 3 samples = 6 bytes
            endcase
        end
    endfunction

    task send_trigger;
        begin
            @(posedge pl_clk);
            trigger_pulse_pl <= 1'b1;
            @(posedge pl_clk);
            trigger_pulse_pl <= 1'b0;
        end
    endtask

    task wait_fifo_ready;
        begin
            // 等 reset 释放
            wait(rst_n === 1'b1);

            // 等 XPM FIFO 两侧 busy 清零
            while ((dut.fifo_wr_rst_busy !== 1'b0) || (dut.fifo_rd_rst_busy !== 1'b0))
                @(posedge pl_clk);

            // 再额外等一小段，避免边沿邻近
            repeat (20) @(posedge pl_clk);
        end
    endtask

    task check_results;
        reg [7:0] expected_last_keep;
        begin
            err_cnt = 0;

            payload_words_expected   = (sample_n_expected + 3) / 4;
            total_axis_beats_expected = 4 + payload_words_expected;
            expected_last_keep       = calc_last_keep(sample_n_expected);

            $display("--------------------------------------------------");
            $display("sample_n_expected        = %0d", sample_n_expected);
            $display("payload_words_expected   = %0d", payload_words_expected);
            $display("total_axis_beats_expected= %0d", total_axis_beats_expected);
            $display("fifo_word_count          = %0d", fifo_word_count);
            $display("axis_count               = %0d", axis_count);
            $display("overflow_error_adc       = %0b", overflow_error_adc);
            $display("--------------------------------------------------");

            if (overflow_error_adc !== 1'b0) begin
                $display("ERROR: overflow_error_adc should be 0");
                err_cnt = err_cnt + 1;
            end

            if (fifo_word_count !== payload_words_expected) begin
                $display("ERROR: fifo_word_count mismatch. got=%0d exp=%0d",
                         fifo_word_count, payload_words_expected);
                err_cnt = err_cnt + 1;
            end

            if (axis_count !== total_axis_beats_expected) begin
                $display("ERROR: axis_count mismatch. got=%0d exp=%0d",
                         axis_count, total_axis_beats_expected);
                err_cnt = err_cnt + 1;
            end

            // -------------------------
            // check 4 metadata beats
            // -------------------------
            if (axis_data_mem[0] !== meta_expected[ 63:  0]) begin
                $display("ERROR: metadata beat0 mismatch. got=%h exp=%h",
                         axis_data_mem[0], meta_expected[ 63:  0]);
                err_cnt = err_cnt + 1;
            end

            if (axis_data_mem[1] !== meta_expected[127: 64]) begin
                $display("ERROR: metadata beat1 mismatch. got=%h exp=%h",
                         axis_data_mem[1], meta_expected[127: 64]);
                err_cnt = err_cnt + 1;
            end

            if (axis_data_mem[2] !== meta_expected[191:128]) begin
                $display("ERROR: metadata beat2 mismatch. got=%h exp=%h",
                         axis_data_mem[2], meta_expected[191:128]);
                err_cnt = err_cnt + 1;
            end

            if (axis_data_mem[3] !== meta_expected[255:192]) begin
                $display("ERROR: metadata beat3 mismatch. got=%h exp=%h",
                         axis_data_mem[3], meta_expected[255:192]);
                err_cnt = err_cnt + 1;
            end

            for (i = 0; i < 4; i = i + 1) begin
                if (axis_keep_mem[i] !== 8'hFF) begin
                    $display("ERROR: metadata beat%0d keep mismatch. got=%h exp=FF",
                             i, axis_keep_mem[i]);
                    err_cnt = err_cnt + 1;
                end
                if (axis_last_mem[i] !== 1'b0) begin
                    $display("ERROR: metadata beat%0d last should be 0", i);
                    err_cnt = err_cnt + 1;
                end
            end

            // -------------------------
            // check payload beats == fifo writes
            // -------------------------
            for (i = 0; i < payload_words_expected; i = i + 1) begin
                if (axis_data_mem[4+i] !== fifo_word_mem[i]) begin
                    $display("ERROR: payload beat%0d mismatch. got=%h exp=%h",
                             i, axis_data_mem[4+i], fifo_word_mem[i]);
                    err_cnt = err_cnt + 1;
                end

                if (i < payload_words_expected-1) begin
                    if (axis_keep_mem[4+i] !== 8'hFF) begin
                        $display("ERROR: payload beat%0d keep mismatch. got=%h exp=FF",
                                 i, axis_keep_mem[4+i]);
                        err_cnt = err_cnt + 1;
                    end
                    if (axis_last_mem[4+i] !== 1'b0) begin
                        $display("ERROR: payload beat%0d last should be 0", i);
                        err_cnt = err_cnt + 1;
                    end
                end else begin
                    if (axis_keep_mem[4+i] !== expected_last_keep) begin
                        $display("ERROR: last payload keep mismatch. got=%h exp=%h",
                                 axis_keep_mem[4+i], expected_last_keep);
                        err_cnt = err_cnt + 1;
                    end
                    if (axis_last_mem[4+i] !== 1'b1) begin
                        $display("ERROR: last payload beat last should be 1");
                        err_cnt = err_cnt + 1;
                    end
                end
            end

            if (err_cnt == 0)
                $display("PASS: metadata + payload + tkeep/tlast all matched.");
            else
                $display("FAIL: total %0d mismatches detected.", err_cnt);
        end
    endtask

    // =========================================================
    // capture AXIS output
    // =========================================================
    always @(posedge pl_clk) begin
        if (m_axis_tvalid && m_axis_tready) begin
            axis_data_mem[axis_count] <= m_axis_tdata;
            axis_keep_mem[axis_count] <= m_axis_tkeep;
            axis_last_mem[axis_count] <= m_axis_tlast;
            axis_count                <= axis_count + 1;

            $display("[%0t] AXIS beat=%0d data=%h keep=%h last=%b",
                     $time, axis_count, m_axis_tdata, m_axis_tkeep, m_axis_tlast);
        end
    end

    // =========================================================
    // capture actual FIFO writes inside DUT
    // 这一步非常关键：payload 以这个为准
    // =========================================================
    always @(posedge adc_clk) begin
        if (dut.fifo_wr_en) begin
            fifo_word_mem[fifo_word_count] <= dut.fifo_wr_data;
            fifo_word_count                <= fifo_word_count + 1;

            $display("[%0t] FIFO_WR word=%0d data=%h",
                     $time, fifo_word_count, dut.fifo_wr_data);
        end
    end

    // =========================================================
    // main test
    // =========================================================
    initial begin
        rst_n             = 1'b0;
        trigger_pulse_pl  = 1'b0;
        sample_n_pl       = 16'd0;
        meta_in_pl        = 256'd0;

        axis_count        = 0;
        fifo_word_count   = 0;
        err_cnt           = 0;

        meta_expected     = 256'h0706050403020100_F0E0D0C0B0A09080_7766554433221100_123456789ABCDEF0;
        sample_n_expected = 16'd18;

        // dump wave
        $dumpfile("tb_frame_capture_axis_top_verify.vcd");
        $dumpvars(0, tb_frame_capture_axis_top_verify);

        // reset
        #60;
        rst_n = 1'b1;

        // 等 FIFO ready
        wait_fifo_ready();

        // 配置测试向量
        sample_n_pl = sample_n_expected;
        meta_in_pl  = meta_expected;

        // 发 trigger
        $display("[%0t] Sending trigger", $time);
        send_trigger();

        // 等正常结束 or 超时
        begin : wait_done_or_timeout
            fork
                begin
                    wait(tx_done_pl === 1'b1);
                    $display("[%0t] tx_done_pl observed", $time);
                    disable wait_done_or_timeout;
                end
                begin
                    #TIMEOUT_NS;
                    $display("[%0t] ERROR: timeout waiting for tx_done_pl", $time);
                    $finish;
                end
            join
        end

        // 多等几拍，确保最后状态稳定
        repeat (20) @(posedge pl_clk);

        // 检查结果
        check_results();

        #100;
        $finish;
    end

endmodule
