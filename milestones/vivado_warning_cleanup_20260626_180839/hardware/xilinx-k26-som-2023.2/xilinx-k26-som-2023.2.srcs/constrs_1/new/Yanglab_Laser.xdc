# SPI Pins For AD4170

# SPI - MOSI
set_property -dict {PACKAGE_PIN H11 IOSTANDARD LVCMOS33 SLEW SLOW} [get_ports AD4170_SPI_MOSI]

# SPI - MISO
set_property PACKAGE_PIN J11 [get_ports AD4170_SPI_MISO]
set_property IOSTANDARD LVCMOS33 [get_ports AD4170_SPI_MISO]

# SPI - SCK
set_property -dict {PACKAGE_PIN E10 IOSTANDARD LVCMOS33 SLEW SLOW} [get_ports AD4170_SPI_CLK]

# SPI - CS
set_property -dict {PACKAGE_PIN F12 IOSTANDARD LVCMOS33 SLEW SLOW} [get_ports AD4170_SPI_CS]

# GPIO Pin For AND8833
set_property -dict {PACKAGE_PIN AE10 IOSTANDARD LVCMOS33 SLEW SLOW} [get_ports adn8833_en]

# SPI Pins For AD3552R - Chip1

# AD3552 QSPI
set_property -dict {PACKAGE_PIN R8 IOSTANDARD LVCMOS18 SLEW FAST} [get_ports ad3552r_qspi_sel]

# AD3552 ALERT
set_property -dict {PACKAGE_PIN K7 IOSTANDARD LVCMOS18 SLEW FAST} [get_ports ad3552r_alertn]

# AD3552 LDAC
set_property -dict {PACKAGE_PIN K8 IOSTANDARD LVCMOS18 SLEW FAST} [get_ports ad3552r_ldacn]

# AD3552 RESET
set_property -dict {PACKAGE_PIN H8 IOSTANDARD LVCMOS18 SLEW FAST} [get_ports ad3552r_resetn]

# AD3552 SPI CS
set_property -dict {PACKAGE_PIN T8 IOSTANDARD LVCMOS18 SLEW FAST} [get_ports ad3552r_spi_cs]

# AD3552 SPI SCLK
set_property -dict {PACKAGE_PIN J7 IOSTANDARD LVCMOS18 SLEW FAST} [get_ports ad3552r_spi_sclk]

# AD3552 SDIO0
set_property -dict {PACKAGE_PIN H7 IOSTANDARD LVCMOS18 SLEW FAST} [get_ports {ad3552r_spi_sdio[0]}]

# AD3552 SDIO1
set_property -dict {PACKAGE_PIN M6 IOSTANDARD LVCMOS18 SLEW FAST} [get_ports {ad3552r_spi_sdio[1]}]

# AD3552 SDIO2
set_property -dict {PACKAGE_PIN L5 IOSTANDARD LVCMOS18 SLEW FAST} [get_ports {ad3552r_spi_sdio[2]}]

# AD3552 SDIO3
set_property -dict {PACKAGE_PIN H9 IOSTANDARD LVCMOS18 SLEW FAST} [get_ports {ad3552r_spi_sdio[3]}]

# SPI Pins For AD3552R - Chip2

# AD3552 QSPI
set_property -dict {PACKAGE_PIN J2 IOSTANDARD LVCMOS18 SLEW FAST} [get_ports ad3552r_qspi_sel_b]

# AD3552 ALERT
set_property -dict {PACKAGE_PIN K9 IOSTANDARD LVCMOS18 SLEW FAST} [get_ports ad3552r_alertn_b]

# AD3552 LDAC
set_property -dict {PACKAGE_PIN J1 IOSTANDARD LVCMOS18 SLEW FAST} [get_ports ad3552r_ldacn_b]

# AD3552 RESET
set_property -dict {PACKAGE_PIN H1 IOSTANDARD LVCMOS18 SLEW FAST} [get_ports ad3552r_resetn_b]

# AD3552 SPI CS
set_property -dict {PACKAGE_PIN N7 IOSTANDARD LVCMOS18 SLEW FAST} [get_ports ad3552r_spi_cs_b]

# AD3552 SPI SCLK
set_property -dict {PACKAGE_PIN N6 IOSTANDARD LVCMOS18 SLEW FAST} [get_ports ad3552r_spi_sclk_b]

# AD3552 SDIO0
set_property -dict {PACKAGE_PIN L1 IOSTANDARD LVCMOS18 SLEW FAST} [get_ports {ad3552r_spi_sdio_b[0]}]

# AD3552 SDIO1
set_property -dict {PACKAGE_PIN K1 IOSTANDARD LVCMOS18 SLEW FAST} [get_ports {ad3552r_spi_sdio_b[1]}]

# AD3552 SDIO2
set_property -dict {PACKAGE_PIN P7 IOSTANDARD LVCMOS18 SLEW FAST} [get_ports {ad3552r_spi_sdio_b[2]}]
set_property UNAVAILABLE_DURING_CALIBRATION true [get_ports {ad3552r_spi_sdio_b[2]}]

# AD3552 SDIO3
set_property -dict {PACKAGE_PIN P6 IOSTANDARD LVCMOS18 SLEW FAST} [get_ports {ad3552r_spi_sdio_b[3]}]

# SWITCH PIN
# SWITCH - IN
set_property -dict {PACKAGE_PIN J10 IOSTANDARD LVCMOS33 SLEW SLOW} [get_ports switch_in]

# SWITCH - FAULT
set_property -dict {PACKAGE_PIN J12 IOSTANDARD LVCMOS33 SLEW SLOW} [get_ports switch_fault]

# SWITCH - DIAG_EN
set_property -dict {PACKAGE_PIN H12 IOSTANDARD LVCMOS33 SLEW SLOW} [get_ports switch_diag_en]

# Trigger CH1
set_property -dict {PACKAGE_PIN W8 IOSTANDARD LVCMOS18 SLEW FAST} [get_ports trig_ch1]

# SPI Pins For ADA4355
set_property -dict {PACKAGE_PIN U8 IOSTANDARD LVCMOS18 SLEW SLOW} [get_ports SPI_SDIO]

set_property -dict {PACKAGE_PIN V8 IOSTANDARD LVCMOS18 SLEW SLOW} [get_ports SPI_CLK]

set_property -dict {PACKAGE_PIN K2 IOSTANDARD LVCMOS18 SLEW SLOW} [get_ports SPI_CS]

# GPIO Pin For ADA4355
set_property -dict {PACKAGE_PIN AE12 IOSTANDARD LVCMOS33 SLEW SLOW} [get_ports ada4355_fsel]
set_property -dict {PACKAGE_PIN AD11 IOSTANDARD LVCMOS33 SLEW SLOW} [get_ports ada4355_gsel2]
set_property -dict {PACKAGE_PIN AA11 IOSTANDARD LVCMOS33 SLEW SLOW} [get_ports ada4355_gsel1]

# LVDS & SPI ADA4355
set_property PACKAGE_PIN L7 [get_ports ada4355_dco_p]
set_property PACKAGE_PIN L6 [get_ports ada4355_dco_n]

set_property IOSTANDARD LVDS [get_ports ada4355_dco_p]
set_property IOSTANDARD LVDS [get_ports ada4355_dco_n]
set_property DIFF_TERM_ADV TERM_100 [get_ports ada4355_dco_p]
set_property DIFF_TERM_ADV TERM_100 [get_ports ada4355_dco_n]

# The ADA4355 interface divides DCO by 4 internally; 500 MHz DCO gives the
# 125 MHz adc_clk domain used by the capture logic.
create_clock -name ada4355_dco -period 2.000 [get_ports ada4355_dco_p]
set_clock_groups -quiet -asynchronous \
    -group [get_clocks -quiet -include_generated_clocks clk_pl_0] \
    -group [get_clocks -quiet -include_generated_clocks ada4355_dco]

set_property PACKAGE_PIN N9 [get_ports ada4355_fco_p]
set_property PACKAGE_PIN N8 [get_ports ada4355_fco_n]

set_property IOSTANDARD LVDS [get_ports ada4355_fco_p]
set_property IOSTANDARD LVDS [get_ports ada4355_fco_n]
set_property DIFF_TERM_ADV TERM_100 [get_ports ada4355_fco_p]
set_property DIFF_TERM_ADV TERM_100 [get_ports ada4355_fco_n]

set_property PACKAGE_PIN K4 [get_ports ada4355_d1_p]
set_property PACKAGE_PIN K3 [get_ports ada4355_d1_n]

set_property IOSTANDARD LVDS [get_ports ada4355_d1_p]
set_property IOSTANDARD LVDS [get_ports ada4355_d1_n]
set_property DIFF_TERM_ADV TERM_100 [get_ports ada4355_d1_p]
set_property DIFF_TERM_ADV TERM_100 [get_ports ada4355_d1_n]

set_property PACKAGE_PIN H4 [get_ports ada4355_d0_p]
set_property PACKAGE_PIN H3 [get_ports ada4355_d0_n]

set_property IOSTANDARD LVDS [get_ports ada4355_d0_p]
set_property IOSTANDARD LVDS [get_ports ada4355_d0_n]
set_property DIFF_TERM_ADV TERM_100 [get_ports ada4355_d0_p]
set_property DIFF_TERM_ADV TERM_100 [get_ports ada4355_d0_n]


# if {0} {
# # Legacy ADA/PAM ILA constraints from an older debug setup. They refer to
# # nets and debug ports that are not present in the current implemented design.
# connect_debug_port u_ila_0/clk [get_nets [list u_ila_0_CLK]]
# connect_debug_port dbg_hub/clk [get_nets u_ila_0_CLK]
# 
# connect_debug_port u_ila_0/clk [get_nets [list u_project_1_wrapper/project_1_i/axi_ada4355_0/inst/i_ada4355_interface/CLK]]
# connect_debug_port dbg_hub/clk [get_nets u_ila_0_CLK]
# 
# 
# 
# set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/axi_dmac_2_m_axis_data[18]}]
# set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/axi_dmac_2_m_axis_data[3]}]
# set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/axi_dmac_2_m_axis_data[0]}]
# set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/axi_dmac_2_m_axis_data[1]}]
# set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/axi_dmac_2_m_axis_data[2]}]
# set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/axi_dmac_2_m_axis_data[30]}]
# set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/axi_dmac_2_m_axis_data[31]}]
# set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/axi_dmac_2_m_axis_data[24]}]
# set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/axi_dmac_2_m_axis_data[25]}]
# set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/axi_dmac_2_m_axis_data[19]}]
# set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/axi_dmac_2_m_axis_data[28]}]
# set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/axi_dmac_2_m_axis_data[29]}]
# set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/axi_dmac_2_m_axis_data[26]}]
# set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/axi_dmac_2_m_axis_data[27]}]
# set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/axi_dmac_2_m_axis_data[12]}]
# set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/axi_dmac_2_m_axis_data[13]}]
# set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/axi_dmac_2_m_axis_data[4]}]
# set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/axi_dmac_2_m_axis_data[5]}]
# set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/axi_dmac_2_m_axis_data[6]}]
# set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/axi_dmac_2_m_axis_data[7]}]
# set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/axi_dmac_2_m_axis_data[8]}]
# set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/axi_dmac_2_m_axis_data[9]}]
# set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/axi_dmac_2_m_axis_data[10]}]
# set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/axi_dmac_2_m_axis_data[11]}]
# set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/axi_dmac_2_m_axis_data[16]}]
# set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/axi_dmac_2_m_axis_data[17]}]
# set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/axi_dmac_2_m_axis_data[14]}]
# set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/axi_dmac_2_m_axis_data[15]}]
# set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/axi_dmac_2_m_axis_data[20]}]
# set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/axi_dmac_2_m_axis_data[21]}]
# set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/axi_dmac_2_m_axis_data[22]}]
# set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/axi_dmac_2_m_axis_data[23]}]
# set_property MARK_DEBUG false [get_nets u_project_1_wrapper/project_1_i/<const1>]
# set_property MARK_DEBUG false [get_nets u_project_1_wrapper/project_1_i/axi_dmac_2_m_axis_valid]
# 
# 
# set_property MARK_DEBUG false [get_nets u_project_1_wrapper/project_1_i/axi_ad3552r_1_dac_data_ready]
# set_property MARK_DEBUG false [get_nets u_project_1_wrapper/project_1_i/ad3552_c2_csn]
# set_property MARK_DEBUG false [get_nets u_project_1_wrapper/project_1_i/ad3552_c2_sclk]
# set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/dual_ramp_generator_0_output1[10]}]
# set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/dual_ramp_generator_0_output1[11]}]
# set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/dual_ramp_generator_0_output1[5]}]
# set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/dual_ramp_generator_0_output1[0]}]
# set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/dual_ramp_generator_0_output1[1]}]
# set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/dual_ramp_generator_0_output1[2]}]
# set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/dual_ramp_generator_0_output1[3]}]
# set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/dual_ramp_generator_0_output1[4]}]
# set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/dual_ramp_generator_0_output1[6]}]
# set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/dual_ramp_generator_0_output1[13]}]
# set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/dual_ramp_generator_0_output1[7]}]
# set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/dual_ramp_generator_0_output1[8]}]
# set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/dual_ramp_generator_0_output1[9]}]
# set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/dual_ramp_generator_0_output1[12]}]
# set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/dual_ramp_generator_0_output1[14]}]
# set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/dual_ramp_generator_0_output1[15]}]
# set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/dual_ramp_generator_0_output2[2]}]
# set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/dual_ramp_generator_0_output2[0]}]
# set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/dual_ramp_generator_0_output2[13]}]
# set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/dual_ramp_generator_0_output2[1]}]
# set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/dual_ramp_generator_0_output2[3]}]
# set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/dual_ramp_generator_0_output2[4]}]
# set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/dual_ramp_generator_0_output2[5]}]
# set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/dual_ramp_generator_0_output2[6]}]
# set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/dual_ramp_generator_0_output2[12]}]
# set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/dual_ramp_generator_0_output2[15]}]
# set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/dual_ramp_generator_0_output2[14]}]
# set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/dual_ramp_generator_0_output2[7]}]
# set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/dual_ramp_generator_0_output2[8]}]
# set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/dual_ramp_generator_0_output2[9]}]
# set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/dual_ramp_generator_0_output2[11]}]
# set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/dual_ramp_generator_0_output2[10]}]
# set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/ad3552_c2_sdo[0]}]
# set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/ad3552_c2_sdo[1]}]
# set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/ad3552_c2_sdo[2]}]
# set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/ad3552_c2_sdo[3]}]
# set_property MARK_DEBUG true [get_nets {u_project_1_wrapper/project_1_i/axi_ada4355_0_adc_data[0]}]
# set_property MARK_DEBUG true [get_nets {u_project_1_wrapper/project_1_i/axi_ada4355_0_adc_data[1]}]
# set_property MARK_DEBUG true [get_nets {u_project_1_wrapper/project_1_i/axi_ada4355_0_adc_data[2]}]
# set_property MARK_DEBUG true [get_nets {u_project_1_wrapper/project_1_i/axi_ada4355_0_adc_data[3]}]
# set_property MARK_DEBUG true [get_nets {u_project_1_wrapper/project_1_i/axi_ada4355_0_adc_data[12]}]
# set_property MARK_DEBUG true [get_nets {u_project_1_wrapper/project_1_i/axi_ada4355_0_adc_data[4]}]
# set_property MARK_DEBUG true [get_nets {u_project_1_wrapper/project_1_i/axi_ada4355_0_adc_data[5]}]
# set_property MARK_DEBUG true [get_nets {u_project_1_wrapper/project_1_i/axi_ada4355_0_adc_data[11]}]
# set_property MARK_DEBUG true [get_nets {u_project_1_wrapper/project_1_i/axi_ada4355_0_adc_data[6]}]
# set_property MARK_DEBUG true [get_nets {u_project_1_wrapper/project_1_i/axi_ada4355_0_adc_data[7]}]
# set_property MARK_DEBUG true [get_nets {u_project_1_wrapper/project_1_i/axi_ada4355_0_adc_data[8]}]
# set_property MARK_DEBUG true [get_nets {u_project_1_wrapper/project_1_i/axi_ada4355_0_adc_data[9]}]
# set_property MARK_DEBUG true [get_nets {u_project_1_wrapper/project_1_i/axi_ada4355_0_adc_data[10]}]
# set_property MARK_DEBUG true [get_nets {u_project_1_wrapper/project_1_i/axi_ada4355_0_adc_data[13]}]
# set_property MARK_DEBUG true [get_nets {u_project_1_wrapper/project_1_i/axi_ada4355_0_adc_data[15]}]
# set_property MARK_DEBUG true [get_nets {u_project_1_wrapper/project_1_i/axi_ada4355_0_adc_data[14]}]
# set_property MARK_DEBUG false [get_nets u_project_1_wrapper/project_1_i/axi_ada4355_0_adc_clk]
# connect_debug_port u_ila_0/probe0 [get_nets [list {u_project_1_wrapper/project_1_i/axi_ada4355_0_adc_data[0]} {u_project_1_wrapper/project_1_i/axi_ada4355_0_adc_data[1]} {u_project_1_wrapper/project_1_i/axi_ada4355_0_adc_data[2]} {u_project_1_wrapper/project_1_i/axi_ada4355_0_adc_data[3]} {u_project_1_wrapper/project_1_i/axi_ada4355_0_adc_data[4]} {u_project_1_wrapper/project_1_i/axi_ada4355_0_adc_data[5]} {u_project_1_wrapper/project_1_i/axi_ada4355_0_adc_data[6]} {u_project_1_wrapper/project_1_i/axi_ada4355_0_adc_data[7]} {u_project_1_wrapper/project_1_i/axi_ada4355_0_adc_data[8]} {u_project_1_wrapper/project_1_i/axi_ada4355_0_adc_data[9]} {u_project_1_wrapper/project_1_i/axi_ada4355_0_adc_data[10]} {u_project_1_wrapper/project_1_i/axi_ada4355_0_adc_data[11]} {u_project_1_wrapper/project_1_i/axi_ada4355_0_adc_data[12]} {u_project_1_wrapper/project_1_i/axi_ada4355_0_adc_data[13]} {u_project_1_wrapper/project_1_i/axi_ada4355_0_adc_data[14]} {u_project_1_wrapper/project_1_i/axi_ada4355_0_adc_data[15]}]]
# 
# set_property MARK_DEBUG true [get_nets u_project_1_wrapper/project_1_i/trigger_gen_fixed_0_pulse]
# connect_debug_port u_ila_0/probe1 [get_nets [list u_project_1_wrapper/project_1_i/frame_capture_axis_t_0_m_axis_TREADY]]
# 
# 
# set_property MARK_DEBUG true [get_nets u_project_1_wrapper/project_1_i/axi_dmac_1_irq]
# 
# 
# connect_debug_port u_ila_0/probe8 [get_nets [list u_project_1_wrapper/project_1_i/trigger_gen_fixed_0_pulse]]
# 
# 
# 
# connect_debug_port u_ila_0/probe5 [get_nets [list u_project_1_wrapper/project_1_i/axi_dmac_1_irq]]
# 
# connect_debug_port u_ila_0/probe3 [get_nets [list {u_project_1_wrapper/project_1_i/axi_pam_image_acq_0_galvo_x[0]} {u_project_1_wrapper/project_1_i/axi_pam_image_acq_0_galvo_x[1]} {u_project_1_wrapper/project_1_i/axi_pam_image_acq_0_galvo_x[2]} {u_project_1_wrapper/project_1_i/axi_pam_image_acq_0_galvo_x[3]} {u_project_1_wrapper/project_1_i/axi_pam_image_acq_0_galvo_x[4]} {u_project_1_wrapper/project_1_i/axi_pam_image_acq_0_galvo_x[5]} {u_project_1_wrapper/project_1_i/axi_pam_image_acq_0_galvo_x[6]} {u_project_1_wrapper/project_1_i/axi_pam_image_acq_0_galvo_x[7]} {u_project_1_wrapper/project_1_i/axi_pam_image_acq_0_galvo_x[8]} {u_project_1_wrapper/project_1_i/axi_pam_image_acq_0_galvo_x[9]} {u_project_1_wrapper/project_1_i/axi_pam_image_acq_0_galvo_x[10]} {u_project_1_wrapper/project_1_i/axi_pam_image_acq_0_galvo_x[11]} {u_project_1_wrapper/project_1_i/axi_pam_image_acq_0_galvo_x[12]} {u_project_1_wrapper/project_1_i/axi_pam_image_acq_0_galvo_x[13]} {u_project_1_wrapper/project_1_i/axi_pam_image_acq_0_galvo_x[14]} {u_project_1_wrapper/project_1_i/axi_pam_image_acq_0_galvo_x[15]}]]
# }


set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/axi_pam_image_acq_0_galvo_x[3]}]
set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/axi_pam_image_acq_0_galvo_x[0]}]
set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/axi_pam_image_acq_0_galvo_x[1]}]
set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/axi_pam_image_acq_0_galvo_x[2]}]
set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/axi_pam_image_acq_0_galvo_x[4]}]
set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/axi_pam_image_acq_0_galvo_x[5]}]
set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/axi_pam_image_acq_0_galvo_x[6]}]
set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/axi_pam_image_acq_0_galvo_x[7]}]
set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/axi_pam_image_acq_0_galvo_x[8]}]
set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/axi_pam_image_acq_0_galvo_x[14]}]
set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/axi_pam_image_acq_0_galvo_x[15]}]
set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/axi_pam_image_acq_0_galvo_x[13]}]
set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/axi_pam_image_acq_0_galvo_x[9]}]
set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/axi_pam_image_acq_0_galvo_x[10]}]
set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/axi_pam_image_acq_0_galvo_x[11]}]
set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/axi_pam_image_acq_0_galvo_x[12]}]
set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/axi_pam_image_acq_0_galvo_y[7]}]
set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/axi_pam_image_acq_0_galvo_y[0]}]
set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/axi_pam_image_acq_0_galvo_y[1]}]
set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/axi_pam_image_acq_0_galvo_y[2]}]
set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/axi_pam_image_acq_0_galvo_y[14]}]
set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/axi_pam_image_acq_0_galvo_y[15]}]
set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/axi_pam_image_acq_0_galvo_y[3]}]
set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/axi_pam_image_acq_0_galvo_y[4]}]
set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/axi_pam_image_acq_0_galvo_y[5]}]
set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/axi_pam_image_acq_0_galvo_y[6]}]
set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/axi_pam_image_acq_0_galvo_y[8]}]
set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/axi_pam_image_acq_0_galvo_y[9]}]
set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/axi_pam_image_acq_0_galvo_y[10]}]
set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/axi_pam_image_acq_0_galvo_y[11]}]
set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/axi_pam_image_acq_0_galvo_y[12]}]
set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/axi_pam_image_acq_0_galvo_y[13]}]
set_property MARK_DEBUG false [get_nets u_project_1_wrapper/project_1_i/laser_trigger_0]
set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/axi_dmac_1_m_dest_axi_WDATA[14]}]
set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/axi_dmac_1_m_dest_axi_WDATA[10]}]
set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/axi_dmac_1_m_dest_axi_WDATA[21]}]
set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/axi_dmac_1_m_dest_axi_WDATA[37]}]
set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/axi_dmac_1_m_dest_axi_WDATA[63]}]
set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/axi_dmac_1_m_dest_axi_WDATA[38]}]
set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/axi_dmac_1_m_dest_axi_WDATA[57]}]
set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/axi_dmac_1_m_dest_axi_WDATA[20]}]
set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/axi_dmac_1_m_dest_axi_WDATA[12]}]
set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/axi_dmac_1_m_dest_axi_WDATA[42]}]
set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/axi_dmac_1_m_dest_axi_WDATA[36]}]
set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/axi_dmac_1_m_dest_axi_WDATA[27]}]
set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/axi_dmac_1_m_dest_axi_WDATA[44]}]
set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/axi_dmac_1_m_dest_axi_WDATA[46]}]
set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/axi_dmac_1_m_dest_axi_WDATA[13]}]
set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/axi_dmac_1_m_dest_axi_WDATA[30]}]
set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/axi_dmac_1_m_dest_axi_WDATA[31]}]
set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/axi_dmac_1_m_dest_axi_WDATA[28]}]
set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/axi_dmac_1_m_dest_axi_WDATA[39]}]
set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/axi_dmac_1_m_dest_axi_WDATA[29]}]
set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/axi_dmac_1_m_dest_axi_WDATA[49]}]
set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/axi_dmac_1_m_dest_axi_WDATA[48]}]
set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/axi_dmac_1_m_dest_axi_WDATA[34]}]
set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/axi_dmac_1_m_dest_axi_WDATA[35]}]
set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/axi_dmac_1_m_dest_axi_WDATA[23]}]
set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/axi_dmac_1_m_dest_axi_WDATA[41]}]
set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/axi_dmac_1_m_dest_axi_WDATA[16]}]
set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/axi_dmac_1_m_dest_axi_WDATA[18]}]
set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/axi_dmac_1_m_dest_axi_WDATA[52]}]
set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/axi_dmac_1_m_dest_axi_WDATA[54]}]
set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/axi_dmac_1_m_dest_axi_WDATA[43]}]
set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/axi_dmac_1_m_dest_axi_WDATA[1]}]
set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/axi_dmac_1_m_dest_axi_WDATA[2]}]
set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/axi_dmac_1_m_dest_axi_WDATA[3]}]
set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/axi_dmac_1_m_dest_axi_WDATA[5]}]
set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/axi_dmac_1_m_dest_axi_WDATA[6]}]
set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/axi_dmac_1_m_dest_axi_WDATA[9]}]
set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/axi_dmac_1_m_dest_axi_WDATA[32]}]
set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/axi_dmac_1_m_dest_axi_WDATA[25]}]
set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/axi_dmac_1_m_dest_axi_WDATA[8]}]
set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/axi_dmac_1_m_dest_axi_WDATA[22]}]
set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/axi_dmac_1_m_dest_axi_WDATA[19]}]
set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/axi_dmac_1_m_dest_axi_WDATA[58]}]
set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/axi_dmac_1_m_dest_axi_WDATA[56]}]
set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/axi_dmac_1_m_dest_axi_WDATA[11]}]
set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/axi_dmac_1_m_dest_axi_WDATA[26]}]
set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/axi_dmac_1_m_dest_axi_WDATA[47]}]
set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/axi_dmac_1_m_dest_axi_WDATA[50]}]
set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/axi_dmac_1_m_dest_axi_WDATA[45]}]
set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/axi_dmac_1_m_dest_axi_WDATA[33]}]
set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/axi_dmac_1_m_dest_axi_WDATA[24]}]
set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/axi_dmac_1_m_dest_axi_WDATA[15]}]
set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/axi_dmac_1_m_dest_axi_WDATA[17]}]
set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/axi_dmac_1_m_dest_axi_WDATA[51]}]
set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/axi_dmac_1_m_dest_axi_WDATA[62]}]
set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/axi_dmac_1_m_dest_axi_WDATA[60]}]
set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/axi_dmac_1_m_dest_axi_WDATA[61]}]
set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/axi_dmac_1_m_dest_axi_WDATA[53]}]
set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/axi_dmac_1_m_dest_axi_WDATA[59]}]
set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/axi_dmac_1_m_dest_axi_WDATA[40]}]
set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/axi_dmac_1_m_dest_axi_WDATA[55]}]
set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/axi_dmac_1_m_dest_axi_WDATA[0]}]
set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/axi_dmac_1_m_dest_axi_WDATA[4]}]
set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/axi_dmac_1_m_dest_axi_WDATA[7]}]
set_property MARK_DEBUG false [get_nets u_project_1_wrapper/project_1_i/axi_dmac_1_m_dest_axi_WVALID]
set_property MARK_DEBUG false [get_nets u_project_1_wrapper/project_1_i/frame_capture_axis_t_0_m_axis_TREADY]
set_property MARK_DEBUG false [get_nets u_project_1_wrapper/project_1_i/AXI_ADA4355_DMA_s_axis_xfer_req]
set_property MARK_DEBUG false [get_nets u_project_1_wrapper/project_1_i/frame_capture_axis_t_0_m_axis_TLAST]
set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/frame_capture_axis_t_0_m_axis_TDATA[29]}]
set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/frame_capture_axis_t_0_m_axis_TDATA[10]}]
set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/frame_capture_axis_t_0_m_axis_TDATA[1]}]
set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/frame_capture_axis_t_0_m_axis_TDATA[0]}]
set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/frame_capture_axis_t_0_m_axis_TDATA[49]}]
set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/frame_capture_axis_t_0_m_axis_TDATA[24]}]
set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/frame_capture_axis_t_0_m_axis_TDATA[25]}]
set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/frame_capture_axis_t_0_m_axis_TDATA[32]}]
set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/frame_capture_axis_t_0_m_axis_TDATA[33]}]
set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/frame_capture_axis_t_0_m_axis_TDATA[37]}]
set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/frame_capture_axis_t_0_m_axis_TDATA[36]}]
set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/frame_capture_axis_t_0_m_axis_TDATA[28]}]
set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/frame_capture_axis_t_0_m_axis_TDATA[23]}]
set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/frame_capture_axis_t_0_m_axis_TDATA[46]}]
set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/frame_capture_axis_t_0_m_axis_TDATA[47]}]
set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/frame_capture_axis_t_0_m_axis_TDATA[42]}]
set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/frame_capture_axis_t_0_m_axis_TDATA[43]}]
set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/frame_capture_axis_t_0_m_axis_TDATA[22]}]
set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/frame_capture_axis_t_0_m_axis_TDATA[15]}]
set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/frame_capture_axis_t_0_m_axis_TDATA[16]}]
set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/frame_capture_axis_t_0_m_axis_TDATA[14]}]
set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/frame_capture_axis_t_0_m_axis_TDATA[3]}]
set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/frame_capture_axis_t_0_m_axis_TDATA[4]}]
set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/frame_capture_axis_t_0_m_axis_TDATA[7]}]
set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/frame_capture_axis_t_0_m_axis_TDATA[9]}]
set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/frame_capture_axis_t_0_m_axis_TDATA[27]}]
set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/frame_capture_axis_t_0_m_axis_TDATA[30]}]
set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/frame_capture_axis_t_0_m_axis_TDATA[35]}]
set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/frame_capture_axis_t_0_m_axis_TDATA[34]}]
set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/frame_capture_axis_t_0_m_axis_TDATA[31]}]
set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/frame_capture_axis_t_0_m_axis_TDATA[26]}]
set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/frame_capture_axis_t_0_m_axis_TDATA[41]}]
set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/frame_capture_axis_t_0_m_axis_TDATA[44]}]
set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/frame_capture_axis_t_0_m_axis_TDATA[48]}]
set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/frame_capture_axis_t_0_m_axis_TDATA[50]}]
set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/frame_capture_axis_t_0_m_axis_TDATA[45]}]
set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/frame_capture_axis_t_0_m_axis_TDATA[40]}]
set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/frame_capture_axis_t_0_m_axis_TDATA[17]}]
set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/frame_capture_axis_t_0_m_axis_TDATA[18]}]
set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/frame_capture_axis_t_0_m_axis_TDATA[12]}]
set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/frame_capture_axis_t_0_m_axis_TDATA[13]}]
set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/frame_capture_axis_t_0_m_axis_TDATA[2]}]
set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/frame_capture_axis_t_0_m_axis_TDATA[5]}]
set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/frame_capture_axis_t_0_m_axis_TDATA[6]}]
set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/frame_capture_axis_t_0_m_axis_TDATA[8]}]
set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/frame_capture_axis_t_0_m_axis_TDATA[11]}]
set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/frame_capture_axis_t_0_m_axis_TDATA[38]}]
set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/frame_capture_axis_t_0_m_axis_TDATA[39]}]
set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/frame_capture_axis_t_0_m_axis_TDATA[54]}]
set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/frame_capture_axis_t_0_m_axis_TDATA[19]}]
set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/frame_capture_axis_t_0_m_axis_TDATA[57]}]
set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/frame_capture_axis_t_0_m_axis_TDATA[58]}]
set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/frame_capture_axis_t_0_m_axis_TDATA[20]}]
set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/frame_capture_axis_t_0_m_axis_TDATA[21]}]
set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/frame_capture_axis_t_0_m_axis_TDATA[51]}]
set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/frame_capture_axis_t_0_m_axis_TDATA[63]}]
set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/frame_capture_axis_t_0_m_axis_TDATA[61]}]
set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/frame_capture_axis_t_0_m_axis_TDATA[62]}]
set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/frame_capture_axis_t_0_m_axis_TDATA[59]}]
set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/frame_capture_axis_t_0_m_axis_TDATA[60]}]
set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/frame_capture_axis_t_0_m_axis_TDATA[52]}]
set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/frame_capture_axis_t_0_m_axis_TDATA[53]}]
set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/frame_capture_axis_t_0_m_axis_TDATA[55]}]
set_property MARK_DEBUG false [get_nets {u_project_1_wrapper/project_1_i/frame_capture_axis_t_0_m_axis_TDATA[56]}]
set_property MARK_DEBUG false [get_nets u_project_1_wrapper/project_1_i/frame_capture_axis_t_0_m_axis_TVALID]

set_property MARK_DEBUG true [get_nets {u_project_1_wrapper/project_1_i/axi_laser_current_ct_0_dac_ch0_code[4]}]
set_property MARK_DEBUG true [get_nets {u_project_1_wrapper/project_1_i/axi_laser_current_ct_0_dac_ch0_code[0]}]
set_property MARK_DEBUG true [get_nets {u_project_1_wrapper/project_1_i/axi_laser_current_ct_0_dac_ch0_code[1]}]
set_property MARK_DEBUG true [get_nets {u_project_1_wrapper/project_1_i/axi_laser_current_ct_0_dac_ch0_code[2]}]
set_property MARK_DEBUG true [get_nets {u_project_1_wrapper/project_1_i/axi_laser_current_ct_0_dac_ch0_code[15]}]
set_property MARK_DEBUG true [get_nets {u_project_1_wrapper/project_1_i/axi_laser_current_ct_0_dac_ch0_code[13]}]
set_property MARK_DEBUG true [get_nets {u_project_1_wrapper/project_1_i/axi_laser_current_ct_0_dac_ch0_code[14]}]
set_property MARK_DEBUG true [get_nets {u_project_1_wrapper/project_1_i/axi_laser_current_ct_0_dac_ch0_code[3]}]
set_property MARK_DEBUG true [get_nets {u_project_1_wrapper/project_1_i/axi_laser_current_ct_0_dac_ch0_code[5]}]
set_property MARK_DEBUG true [get_nets {u_project_1_wrapper/project_1_i/axi_laser_current_ct_0_dac_ch0_code[6]}]
set_property MARK_DEBUG true [get_nets {u_project_1_wrapper/project_1_i/axi_laser_current_ct_0_dac_ch0_code[7]}]
set_property MARK_DEBUG true [get_nets {u_project_1_wrapper/project_1_i/axi_laser_current_ct_0_dac_ch0_code[8]}]
set_property MARK_DEBUG true [get_nets {u_project_1_wrapper/project_1_i/axi_laser_current_ct_0_dac_ch0_code[9]}]
set_property MARK_DEBUG true [get_nets {u_project_1_wrapper/project_1_i/axi_laser_current_ct_0_dac_ch0_code[12]}]
set_property MARK_DEBUG true [get_nets {u_project_1_wrapper/project_1_i/axi_laser_current_ct_0_dac_ch0_code[10]}]
set_property MARK_DEBUG true [get_nets {u_project_1_wrapper/project_1_i/axi_laser_current_ct_0_dac_ch0_code[11]}]
set_property MARK_DEBUG true [get_nets {u_project_1_wrapper/project_1_i/axi_laser_current_ct_0_dac_ch1_code[5]}]
set_property MARK_DEBUG true [get_nets {u_project_1_wrapper/project_1_i/axi_laser_current_ct_0_dac_ch1_code[0]}]
set_property MARK_DEBUG true [get_nets {u_project_1_wrapper/project_1_i/axi_laser_current_ct_0_dac_ch1_code[14]}]
set_property MARK_DEBUG true [get_nets {u_project_1_wrapper/project_1_i/axi_laser_current_ct_0_dac_ch1_code[12]}]
set_property MARK_DEBUG true [get_nets {u_project_1_wrapper/project_1_i/axi_laser_current_ct_0_dac_ch1_code[13]}]
set_property MARK_DEBUG true [get_nets {u_project_1_wrapper/project_1_i/axi_laser_current_ct_0_dac_ch1_code[1]}]
set_property MARK_DEBUG true [get_nets {u_project_1_wrapper/project_1_i/axi_laser_current_ct_0_dac_ch1_code[2]}]
set_property MARK_DEBUG true [get_nets {u_project_1_wrapper/project_1_i/axi_laser_current_ct_0_dac_ch1_code[3]}]
set_property MARK_DEBUG true [get_nets {u_project_1_wrapper/project_1_i/axi_laser_current_ct_0_dac_ch1_code[4]}]
set_property MARK_DEBUG true [get_nets {u_project_1_wrapper/project_1_i/axi_laser_current_ct_0_dac_ch1_code[6]}]
set_property MARK_DEBUG true [get_nets {u_project_1_wrapper/project_1_i/axi_laser_current_ct_0_dac_ch1_code[15]}]
set_property MARK_DEBUG true [get_nets {u_project_1_wrapper/project_1_i/axi_laser_current_ct_0_dac_ch1_code[11]}]
set_property MARK_DEBUG true [get_nets {u_project_1_wrapper/project_1_i/axi_laser_current_ct_0_dac_ch1_code[7]}]
set_property MARK_DEBUG true [get_nets {u_project_1_wrapper/project_1_i/axi_laser_current_ct_0_dac_ch1_code[8]}]
set_property MARK_DEBUG true [get_nets {u_project_1_wrapper/project_1_i/axi_laser_current_ct_0_dac_ch1_code[9]}]
set_property MARK_DEBUG true [get_nets {u_project_1_wrapper/project_1_i/axi_laser_current_ct_0_dac_ch1_code[10]}]

set_property MARK_DEBUG true [get_nets u_project_1_wrapper/project_1_i/laser_enable_0]
create_debug_core u_ila_0 ila
set_property ALL_PROBE_SAME_MU true [get_debug_cores u_ila_0]
set_property ALL_PROBE_SAME_MU_CNT 1 [get_debug_cores u_ila_0]
set_property C_ADV_TRIGGER false [get_debug_cores u_ila_0]
set_property C_DATA_DEPTH 1024 [get_debug_cores u_ila_0]
set_property C_EN_STRG_QUAL false [get_debug_cores u_ila_0]
set_property C_INPUT_PIPE_STAGES 0 [get_debug_cores u_ila_0]
set_property C_TRIGIN_EN false [get_debug_cores u_ila_0]
set_property C_TRIGOUT_EN false [get_debug_cores u_ila_0]
set_property port_width 1 [get_debug_ports u_ila_0/clk]
connect_debug_port u_ila_0/clk [get_nets [list u_project_1_wrapper/project_1_i/K26_SOM/inst/pl_clk0]]
set_property PROBE_TYPE DATA_AND_TRIGGER [get_debug_ports u_ila_0/probe0]
set_property port_width 16 [get_debug_ports u_ila_0/probe0]
connect_debug_port u_ila_0/probe0 [get_nets [list {u_project_1_wrapper/project_1_i/axi_laser_current_ct_0_dac_ch1_code[0]} {u_project_1_wrapper/project_1_i/axi_laser_current_ct_0_dac_ch1_code[1]} {u_project_1_wrapper/project_1_i/axi_laser_current_ct_0_dac_ch1_code[2]} {u_project_1_wrapper/project_1_i/axi_laser_current_ct_0_dac_ch1_code[3]} {u_project_1_wrapper/project_1_i/axi_laser_current_ct_0_dac_ch1_code[4]} {u_project_1_wrapper/project_1_i/axi_laser_current_ct_0_dac_ch1_code[5]} {u_project_1_wrapper/project_1_i/axi_laser_current_ct_0_dac_ch1_code[6]} {u_project_1_wrapper/project_1_i/axi_laser_current_ct_0_dac_ch1_code[7]} {u_project_1_wrapper/project_1_i/axi_laser_current_ct_0_dac_ch1_code[8]} {u_project_1_wrapper/project_1_i/axi_laser_current_ct_0_dac_ch1_code[9]} {u_project_1_wrapper/project_1_i/axi_laser_current_ct_0_dac_ch1_code[10]} {u_project_1_wrapper/project_1_i/axi_laser_current_ct_0_dac_ch1_code[11]} {u_project_1_wrapper/project_1_i/axi_laser_current_ct_0_dac_ch1_code[12]} {u_project_1_wrapper/project_1_i/axi_laser_current_ct_0_dac_ch1_code[13]} {u_project_1_wrapper/project_1_i/axi_laser_current_ct_0_dac_ch1_code[14]} {u_project_1_wrapper/project_1_i/axi_laser_current_ct_0_dac_ch1_code[15]}]]
create_debug_port u_ila_0 probe
set_property PROBE_TYPE DATA_AND_TRIGGER [get_debug_ports u_ila_0/probe1]
set_property port_width 16 [get_debug_ports u_ila_0/probe1]
connect_debug_port u_ila_0/probe1 [get_nets [list {u_project_1_wrapper/project_1_i/axi_laser_current_ct_0_dac_ch0_code[0]} {u_project_1_wrapper/project_1_i/axi_laser_current_ct_0_dac_ch0_code[1]} {u_project_1_wrapper/project_1_i/axi_laser_current_ct_0_dac_ch0_code[2]} {u_project_1_wrapper/project_1_i/axi_laser_current_ct_0_dac_ch0_code[3]} {u_project_1_wrapper/project_1_i/axi_laser_current_ct_0_dac_ch0_code[4]} {u_project_1_wrapper/project_1_i/axi_laser_current_ct_0_dac_ch0_code[5]} {u_project_1_wrapper/project_1_i/axi_laser_current_ct_0_dac_ch0_code[6]} {u_project_1_wrapper/project_1_i/axi_laser_current_ct_0_dac_ch0_code[7]} {u_project_1_wrapper/project_1_i/axi_laser_current_ct_0_dac_ch0_code[8]} {u_project_1_wrapper/project_1_i/axi_laser_current_ct_0_dac_ch0_code[9]} {u_project_1_wrapper/project_1_i/axi_laser_current_ct_0_dac_ch0_code[10]} {u_project_1_wrapper/project_1_i/axi_laser_current_ct_0_dac_ch0_code[11]} {u_project_1_wrapper/project_1_i/axi_laser_current_ct_0_dac_ch0_code[12]} {u_project_1_wrapper/project_1_i/axi_laser_current_ct_0_dac_ch0_code[13]} {u_project_1_wrapper/project_1_i/axi_laser_current_ct_0_dac_ch0_code[14]} {u_project_1_wrapper/project_1_i/axi_laser_current_ct_0_dac_ch0_code[15]}]]
create_debug_port u_ila_0 probe
set_property PROBE_TYPE DATA_AND_TRIGGER [get_debug_ports u_ila_0/probe2]
set_property port_width 1 [get_debug_ports u_ila_0/probe2]
connect_debug_port u_ila_0/probe2 [get_nets [list u_project_1_wrapper/project_1_i/laser_enable_0]]
set_property C_CLK_INPUT_FREQ_HZ 300000000 [get_debug_cores dbg_hub]
set_property C_ENABLE_CLK_DIVIDER false [get_debug_cores dbg_hub]
set_property C_USER_SCAN_CHAIN 1 [get_debug_cores dbg_hub]
connect_debug_port dbg_hub/clk [get_nets u_ila_0_pl_clk0]
