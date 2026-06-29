`timescale 1ns / 1ps
//////////////////////////////////////////////////////////////////////////////////
// Company: 
// Engineer: 
// 
// Create Date: 10/16/2025 03:24:12 PM
// Design Name: 
// Module Name: toggle_timer
// Project Name: 
// Target Devices: 
// Tool Versions: 
// Description: 
// 
// Dependencies: 
// 
// Revision:
// Revision 0.01 - File Created
// Additional Comments:
// 
//////////////////////////////////////////////////////////////////////////////////


module toggle_timer #(
    parameter PERIOD = 1000000  // 翻转周期计数值
)(
    input  wire clk,    // 输入时钟
    input  wire rst_n,  // 异步低电平复位
    output reg  out     // 输出信号
);

    reg [31:0] counter;

    always @(posedge clk or negedge rst_n) begin
        if (!rst_n) begin
            counter <= 0;
            out <= 1'b0;
        end else begin
            if (counter >= PERIOD - 1) begin
                counter <= 0;
                out <= ~out;   // 到期时翻转输出
            end else begin
                counter <= counter + 1;
            end
        end
    end

endmodule
