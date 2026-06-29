`timescale 1ns / 1ps

module tb_frame_capture_axis_top_debug6;

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

    integer axis_count;

    // =========================================================
    // DUT
    // =========================================================
    frame_capture_axis_top #(
        .FIFO_WRITE_DEPTH(2048),
        .ADC_START_DELAY (3)
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
    // simple ADC sample source
    // =========================================================
    always @(posedge adc_clk or negedge rst_n) begin
        if (!rst_n)
            adc_data <= 16'h0000;
        else
            adc_data <= adc_data + 16'h0001;
    end

    // =========================================================
    // AXIS sink always ready
    // =========================================================
    initial begin
        m_axis_tready = 1'b1;
    end

    // =========================================================
    // task: send one trigger pulse in pl_clk domain
    // =========================================================
    task send_trigger;
    begin
        @(posedge pl_clk);
        trigger_pulse_pl <= 1'b1;
        @(posedge pl_clk);
        trigger_pulse_pl <= 1'b0;
    end
    endtask

    // =========================================================
    // task: print marker
    // =========================================================
    task print_marker;
        input [255:0] msg;
    begin
        $display("");
        $display("============================================================");
        $display("[%0t] %s", $time, msg);
        $display("============================================================");
    end
    endtask

    // =========================================================
    // main stimulus
    // =========================================================
    initial begin
        rst_n            = 1'b0;
        trigger_pulse_pl = 1'b0;
        sample_n_pl      = 16'd16;   // 16 samples = 4 payload words
        meta_in_pl       = 256'h4444_3333_2222_1111_AAAA_BBBB_CCCC_DDDD_1234_5678_9ABC_DEF0_1357_2468_55AA_F00D;
        axis_count       = 0;

        // dump wave
        $dumpfile("tb_frame_capture_axis_top_debug6.vcd");
        $dumpvars(0, tb_frame_capture_axis_top_debug6);

        // reset
        #50;
        rst_n = 1'b1;

        // -----------------------------------------------------
        // Case 1: trigger too early after reset release
        // -----------------------------------------------------
        #20;
        print_marker("CASE 1: early trigger");
        send_trigger();

        // wait some time
        #2000;

        // -----------------------------------------------------
        // Case 2: trigger much later after reset release
        // -----------------------------------------------------
        sample_n_pl = 16'd20;  // 20 samples = 5 payload words
        meta_in_pl  = 256'h0001_0002_0003_0004_0005_0006_0007_0008_0009_000A_000B_000C_000D_000E_000F_0010;

        print_marker("CASE 2: delayed trigger");
        #200;
        send_trigger();

        #4000;

        print_marker("SIM DONE");
        $finish;
    end

    // =========================================================
    // monitor AXIS output
    // =========================================================
    always @(posedge pl_clk) begin
        if (m_axis_tvalid && m_axis_tready) begin
            axis_count <= axis_count + 1;
            $display("[%0t] AXIS beat=%0d data=%h keep=%h last=%b",
                     $time, axis_count, m_axis_tdata, m_axis_tkeep, m_axis_tlast);
        end
    end

    // =========================================================
    // monitor the 6 key signals
    // =========================================================
    initial begin
        $display("Watching 6 debug signals:");
        $display("  dut.fifo_wr_rst_busy");
        $display("  dut.capture_start_adc");
        $display("  dut.fifo_wr_en");
        $display("  dut.fifo_full");
        $display("  dut.capture_overflow_error_adc");
        $display("  dut.fifo_overflow");
        $display("");
    end

    always @(dut.fifo_wr_rst_busy or
             dut.capture_start_adc or
             dut.fifo_wr_en or
             dut.fifo_full or
             dut.capture_overflow_error_adc or
             dut.fifo_overflow) begin
        $display("[%0t] wr_rst_busy=%b capture_start_adc=%b fifo_wr_en=%b fifo_full=%b cap_ovf=%b fifo_ovf=%b",
                 $time,
                 dut.fifo_wr_rst_busy,
                 dut.capture_start_adc,
                 dut.fifo_wr_en,
                 dut.fifo_full,
                 dut.capture_overflow_error_adc,
                 dut.fifo_overflow);
    end

    // =========================================================
    // optional extra monitor: useful for quick diagnosis
    // =========================================================
    always @(posedge adc_clk) begin
        if (dut.capture_start_adc) begin
            $display("[%0t] ADC capture starts, sample_n_latched_adc=%0d, sample_n_sync2_adc=%0d",
                     $time,
                     dut.sample_n_latched_adc,
                     dut.sample_n_sync2_adc);
        end
    end

    always @(posedge adc_clk) begin
        if (dut.fifo_wr_en) begin
            $display("[%0t] FIFO WRITE data=%h", $time, dut.fifo_wr_data);
        end
    end

endmodule
