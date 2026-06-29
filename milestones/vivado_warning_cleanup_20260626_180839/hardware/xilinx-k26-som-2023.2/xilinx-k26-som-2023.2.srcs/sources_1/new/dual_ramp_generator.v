module dual_ramp_generator #(
    parameter [31:0] N1      = 32'd10,
    parameter [31:0] N2      = 32'd10,
    parameter [15:0] STEP1   = 16'd1,
    parameter [15:0] STEP2   = 16'd1,
    parameter [15:0] CH1_MAX = 16'd32768,
    parameter [15:0] CH2_MAX = 16'd32768
)(
    input  wire        clk_in,
    input  wire        reset_n,
    output reg [15:0]  output1,
    output reg [15:0]  output2
);

    reg [31:0] cnt1;
    reg [31:0] cnt2;

    // 扩展 1 bit，便于做比较
    wire [16:0] next_output1 = {1'b0, output1} + {1'b0, STEP1};
    wire [16:0] next_output2 = {1'b0, output2} + {1'b0, STEP2};

    always @(posedge clk_in or negedge reset_n) begin
        if (!reset_n) begin
            cnt1    <= 32'd0;
            cnt2    <= 32'd0;
            output1 <= 16'd0;
            output2 <= 16'd0;
        end else begin
            // -------------------------
            // output1 对应逻辑
            // -------------------------
            if (cnt1 == N1 - 1) begin
                cnt1 <= 32'd0;

                // 到达或超过 CH1_MAX 就归零
                if (next_output1 >= {1'b0, CH1_MAX})
                    output1 <= 16'd0;
                else
                    output1 <= next_output1[15:0];
            end else begin
                cnt1 <= cnt1 + 1'b1;
            end

            // -------------------------
            // output2 对应逻辑
            // -------------------------
            if (cnt2 == N2 - 1) begin
                cnt2 <= 32'd0;

                // 到达或超过 CH2_MAX 就归零
                if (next_output2 >= {1'b0, CH2_MAX})
                    output2 <= 16'd0;
                else
                    output2 <= next_output2[15:0];
            end else begin
                cnt2 <= cnt2 + 1'b1;
            end
        end
    end

endmodule