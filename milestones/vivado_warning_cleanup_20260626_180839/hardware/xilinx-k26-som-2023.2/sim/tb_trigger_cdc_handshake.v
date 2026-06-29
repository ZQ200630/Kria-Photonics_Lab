`timescale 1ns / 1ps

module tb_trigger_cdc_handshake;

    reg src_clk;
    reg dst_clk;
    reg rst_n;
    reg src_pulse;
    reg dst_done_pulse;
    wire src_busy;
    wire src_done_pulse;
    wire dst_pulse;

    integer done_countdown;

    trigger_cdc_handshake dut (
        .src_clk        (src_clk),
        .dst_clk        (dst_clk),
        .rst_n          (rst_n),
        .src_pulse      (src_pulse),
        .src_busy       (src_busy),
        .src_done_pulse (src_done_pulse),
        .dst_pulse      (dst_pulse),
        .dst_done_pulse (dst_done_pulse)
    );

    initial begin
        src_clk = 1'b0;
        forever #5 src_clk = ~src_clk;
    end

    initial begin
        dst_clk = 1'b0;
        forever #3.5 dst_clk = ~dst_clk;
    end

    always @(posedge dst_clk or negedge rst_n) begin
        if (!rst_n) begin
            done_countdown <= -1;
            dst_done_pulse <= 1'b0;
        end else begin
            dst_done_pulse <= 1'b0;
            if (dst_pulse) begin
                $display("[%0t] dst_pulse detected", $time);
                done_countdown <= 4;
            end else if (done_countdown >= 0) begin
                if (done_countdown == 0) begin
                    dst_done_pulse <= 1'b1;
                    done_countdown <= -1;
                    $display("[%0t] dst_done_pulse asserted", $time);
                end else begin
                    done_countdown <= done_countdown - 1;
                end
            end
        end
    end

    always @(posedge src_clk) begin
        if (src_done_pulse)
            $display("[%0t] src_done_pulse detected", $time);
    end

    task fire_src_pulse;
        begin
            @(posedge src_clk);
            src_pulse <= 1'b1;
            @(posedge src_clk);
            src_pulse <= 1'b0;
        end
    endtask

    initial begin
        rst_n = 1'b0;
        src_pulse = 1'b0;
        dst_done_pulse = 1'b0;
        #40;
        rst_n = 1'b1;

        fire_src_pulse();
        repeat (3) @(posedge src_clk);
        fire_src_pulse();

        wait (src_done_pulse);
        repeat (2) @(posedge src_clk);
        fire_src_pulse();

        #300;
        $finish;
    end

endmodule
