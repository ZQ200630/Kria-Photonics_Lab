`timescale 1ns / 1ps
//////////////////////////////////////////////////////////////////////////////////
// Company: 
// Engineer: 
// 
// Create Date: 10/15/2025 11:26:08 PM
// Design Name: 
// Module Name: design_top
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


module design_top(
       output AD4170_SPI_CS,
       output AD4170_SPI_MOSI,
       input  AD4170_SPI_MISO,
       output AD4170_SPI_CLK,
       inout           ad3552r_ldacn,
       inout           ad3552r_alertn,
       output          ad3552r_resetn,
       output          ad3552r_qspi_sel,
       inout   [ 3:0]  ad3552r_spi_sdio,
       output          ad3552r_spi_cs,
       output          ad3552r_spi_sclk,
       inout           ad3552r_ldacn_b,
       inout           ad3552r_alertn_b,
       output          ad3552r_resetn_b,
       output          ad3552r_qspi_sel_b,
       inout   [ 3:0]  ad3552r_spi_sdio_b,
       output          ad3552r_spi_cs_b,
       output          ad3552r_spi_sclk_b,
       inout           switch_diag_en,
       inout           switch_fault,
       inout           switch_in,
       output          adn8833_en,
       output           trig_ch1,
       output [0:0]  SPI_CS,
       output        SPI_CLK,
       inout         SPI_SDIO,
       input ada4355_dco_n,
       input ada4355_dco_p,
       input ada4355_fco_n,
       input ada4355_fco_p,
       input ada4355_d0_n,
       input ada4355_d0_p,
       input ada4355_d1_n,
       input ada4355_d1_p,
       output ada4355_fsel,
       output ada4355_gsel1,
       output ada4355_gsel2
    );
    
    wire clk;
    wire rst_n;
    
    wire    [ 3:0]  ad3552r_spi_sdo;
    wire    [ 3:0]  ad3552r_spi_sdi;
    wire            ad3552r_spi_t;
    wire    [ 1:0]  ad3552r_gpio; 
    
    wire    [ 3:0]  ad3552r_spi_sdo_b;
    wire    [ 3:0]  ad3552r_spi_sdi_b;
    wire            ad3552r_spi_t_b;
    wire    [ 1:0]  ad3552r_gpio_b; 
    
    wire    [ 1:0]  switch_io;
    wire    [ 0:0]  trig_io;
    
    wire    [0:0]   spi_csn;
    wire            spi_miso;
    wire            spi_mosi;
    
    wire    [ 2:0] ada4355_gpio;
    
    
    ad_iobuf #(
    .DATA_WIDTH(4)
      ) i_dac_0_spi_iobuf (
        .dio_t({4{ad3552r_spi_t}}),
        .dio_i(ad3552r_spi_sdo),
        .dio_o(ad3552r_spi_sdi),
        .dio_p(ad3552r_spi_sdio));
        
    ad_iobuf #(
    .DATA_WIDTH(4)
      ) i_dac_0_spi_iobuf_b (
        .dio_t({4{ad3552r_spi_t_b}}),
        .dio_i(ad3552r_spi_sdo_b),
        .dio_o(ad3552r_spi_sdi_b),
        .dio_p(ad3552r_spi_sdio_b));
        
    
    assign ad3552r_ldacn = ad3552r_gpio[0];
    assign ad3552r_alertn = ad3552r_gpio[1];
    assign ad3552r_qspi_sel = 1'b1;
    
    assign ad3552r_ldacn_b = ad3552r_gpio_b[0];
    assign ad3552r_alertn_b = ad3552r_gpio_b[1];
    assign ad3552r_qspi_sel_b = 1'b1;
    
    assign switch_diag_en = switch_io[0];
    assign switch_fault   = switch_io[1];
    
    
    assign ada4355_fsel = ada4355_gpio[0];
    assign ada4355_gsel1 = ada4355_gpio[1];
    assign ada4355_gsel2 = ada4355_gpio[2];
    
    assign trig_ch1       = trig_io[0];
    assign SPI_CS         = 1'b0;
    
    project_1_wrapper u_project_1_wrapper (
        .AD4170_SPI_CLK(AD4170_SPI_CLK),
        .AD4170_SPI_CS(AD4170_SPI_CS),
        .AD4170_SPI_MISO(AD4170_SPI_MISO),
        .AD4170_SPI_MOSI(AD4170_SPI_MOSI),
        .adn8833_en(adn8833_en),
        .PS_CLOCK(clk),
        .PS_RST(rst_n),
        .ad3552_c1_csn(ad3552r_spi_cs),
        .ad3552_c1_gpio_tri_io(ad3552r_gpio),
        .ad3552_c1_sclk(ad3552r_spi_sclk),
        .ad3552_c1_sdi(ad3552r_spi_sdi),
        .ad3552_c1_sdo(ad3552r_spi_sdo),
        .ad3552_c1_sdo_t(ad3552r_spi_t),
        .ad3552_c1_rst_tri_o(ad3552r_resetn),
        .ad3552_c2_csn(ad3552r_spi_cs_b),
        .ad3552_c2_gpio_tri_io(ad3552r_gpio_b),
        .ad3552_c2_sclk(ad3552r_spi_sclk_b),
        .ad3552_c2_sdi(ad3552r_spi_sdi_b),
        .ad3552_c2_sdo(ad3552r_spi_sdo_b),
        .ad3552_c2_sdo_t(ad3552r_spi_t_b),
        .ad3552_c2_rst_tri_o(ad3552r_resetn_b),
        .tps1h000_gpio_tri_io(switch_io),
        .laser_trigger_0(trig_io),
        .laser_enable_0(switch_in),
        .ada4355_gpio_tri_o(ada4355_gpio),
        .ada4355_spi_clk_i     (1'b0),
        .ada4355_spi_clk_o     (SPI_CLK),
        .ada4355_spi_csn       (1'b1),
        .ada4355_spi_csn_o     (spi_csn),
        .ada4355_spi_sdi_i     (spi_miso),
        .ada4355_spi_sdo_i     (1'b0),
        .ada4355_spi_sdo_o     (spi_mosi),
        .ada4355_dco_n         (ada4355_dco_n),
        .ada4355_dco_p         (ada4355_dco_p),
        .ada4355_fco_n         (ada4355_fco_n),
        .ada4355_fco_p         (ada4355_fco_p),
        .ada4355_d0a_n         (ada4355_d0_n),
        .ada4355_d0a_p         (ada4355_d0_p),
        .ada4355_d1a_n         (ada4355_d1_n),
        .ada4355_d1a_p         (ada4355_d1_p)
    );
    
    ada4355_spi u_ada4355_spi (
    .spi_csn     (spi_csn[0]),
    .spi_clk     (SPI_CLK),
    .spi_mosi    (spi_mosi),
    .spi_miso    (spi_miso),
    .spi_sdio    (SPI_SDIO)
  );
    
//    toggle_timer #(
//        .PERIOD(100)
//    ) dut (
//        .clk(clk),
//        .rst_n(rst_n),
//        .out(AD4170_SPI_CLK)
//    );
    
    
endmodule
