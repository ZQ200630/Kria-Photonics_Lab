`timescale 1ns/1ps

module tb_dual_ramp_generator;

    reg         clk_in;
    reg         reset_n;
    wire [15:0] output1;
    wire [15:0] output2;

    // 例化待测模块
    // 为了仿真更快，参数取小一点，便于观察
    dual_ramp_generator #(
        .N1(32'd4),       // output1 每 4 个时钟加一次
        .N2(32'd6),       // output2 每 6 个时钟加一次
        .STEP1(16'd1), // output1 每次加 1000
        .STEP2(16'd5)  // output2 每次加 5000
    ) dut (
        .clk_in  (clk_in),
        .reset_n (reset_n),
        .output1 (output1),
        .output2 (output2)
    );

    // 时钟产生：10ns 周期
    initial begin
        clk_in = 1'b0;
        forever #5 clk_in = ~clk_in;
    end

    // 激励过程
    initial begin
        // 生成波形文件
        $dumpfile("tb_dual_ramp_generator.vcd");
        $dumpvars(0, tb_dual_ramp_generator);

        // 初始状态
        reset_n = 1'b0;

        // 保持复位一段时间
        #25;
        reset_n = 1'b1;

        // 跑一段时间观察 ramp
        #500;

        // 再次复位，检查是否真的清零
        #20;
        reset_n = 1'b0;
        #20;
        reset_n = 1'b1;

        // 再继续运行
        #300;

        $finish;
    end

    // 打印关键信号
    initial begin
        $display("time\treset_n\toutput1\toutput2\tcnt1\tcnt2");
        $monitor("%0t\t%b\t%0d\t%0d\t%0d\t%0d",
                 $time,
                 reset_n,
                 output1,
                 output2,
                 dut.cnt1,
                 dut.cnt2);
    end

endmodule
