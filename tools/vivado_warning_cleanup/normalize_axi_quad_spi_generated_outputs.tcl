if {$argc != 1} {
  error "Usage: normalize_axi_quad_spi_generated_outputs.tcl <project_root>"
}

set proj_root [lindex $argv 0]
set ip_dir [file join $proj_root hardware xilinx-k26-som-2023.2 project_1.gen sources_1 bd project_1 ip project_1_axi_quad_spi_1_0]

proc read_text_file {path} {
  set fp [open $path r]
  set data [read $fp]
  close $fp
  return $data
}

proc write_text_file {path data} {
  set fp [open $path w]
  puts -nonewline $fp $data
  close $fp
}

proc restore_generated_line {path from to label} {
  if {![file exists $path]} {
    puts "${label}_NOT_FOUND=$path"
    return
  }

  set data [read_text_file $path]
  set restored [string map [list $from $to] $data]
  if {$restored ne $data} {
    write_text_file $path $restored
    puts "RESTORED_${label}=$path"
  } elseif {[string first $to $data] >= 0} {
    puts "${label}_ALREADY_RESTORED=$path"
  } else {
    puts "${label}_UNEXPECTED_CONTENT=$path"
  }
}

set xdc_path [file join $ip_dir project_1_axi_quad_spi_1_0.xdc]
restore_generated_line \
  $xdc_path \
  {set_property IOB false [get_cells -hierarchical -filter {NAME =~*IO*_I_REG}]} \
  {set_property IOB true [get_cells -hierarchical -filter {NAME =~*IO*_I_REG}]} \
  AXI_QUAD_SPI_IOB_XDC

set ooc_xdc_path [file join $ip_dir project_1_axi_quad_spi_1_0_ooc.xdc]
restore_generated_line \
  $ooc_xdc_path \
  {create_clock -name all_clock -period 10.000 [get_ports {s_axi_aclk ext_spi_clk}]} \
  {create_clock -name all_clock -period 20 [get_ports {s_axi_aclk ext_spi_clk}]} \
  AXI_QUAD_SPI_OOC_XDC

set dcp_path [file join $ip_dir project_1_axi_quad_spi_1_0.dcp]
if {![file exists $dcp_path]} {
  puts "AXI_QUAD_SPI_DCP_NOT_FOUND=$dcp_path"
  return
}

open_checkpoint $dcp_path
set sck_cells [get_cells -hierarchical -quiet -filter {NAME =~*RATIO_NOT_EQUAL_4_GENERATE.SCK_O_NQ_4_NO_STARTUP_USED.SCK_O_NE_4_FDRE_INST}]
if {[llength $sck_cells] != 1} {
  close_design
  error "Expected exactly one AXI Quad SPI SCK output FF in $dcp_path, found [llength $sck_cells]"
}

set before [get_property IOB $sck_cells]
set_property IOB false $sck_cells
set after [get_property IOB $sck_cells]
write_checkpoint -force $dcp_path
close_design

puts "NORMALIZED_AXI_QUAD_SPI_DCP=$dcp_path IOB_BEFORE=$before IOB_AFTER=$after"
