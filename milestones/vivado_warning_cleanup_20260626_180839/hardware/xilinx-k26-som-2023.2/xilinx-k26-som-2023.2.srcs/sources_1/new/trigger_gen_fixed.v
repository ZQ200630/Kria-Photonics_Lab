`timescale 1ns / 1ps

module trigger_gen_fixed #(
    parameter COUNTER_WIDTH = 32,
    parameter PERIOD        = 100000000
) (
    input  wire         clk,
    input  wire         resetn,
    output reg          pulse,
    (* X_INTERFACE_IGNORE = "TRUE" *)
    output reg [255:0]  data
);

    reg [COUNTER_WIDTH-1:0] counter;

    always @(posedge clk or negedge resetn) begin
        if (!resetn) begin
            counter <= {COUNTER_WIDTH{1'b0}};
            pulse   <= 1'b0;
            data    <= 256'd0;
        end else begin
            if (counter == PERIOD - 1) begin
                counter <= {COUNTER_WIDTH{1'b0}};
                pulse   <= 1'b1;
                data    <= data + 256'd1;
            end else begin
                counter <= counter + 1'b1;
                pulse   <= 1'b0;
                data    <= data;
            end
        end
    end

endmodule