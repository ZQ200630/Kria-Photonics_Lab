set dcp_path [lindex $argv 0]
if {$dcp_path eq ""} {
  error "usage: vivado -mode batch -source inspect_axi_quad_spi_dcp.tcl -tclargs <dcp_path>"
}

open_checkpoint $dcp_path

set clocks [get_clocks -quiet all_clock]
puts "CLOCK_COUNT=[llength $clocks]"
foreach clock $clocks {
  puts "CLOCK=$clock PERIOD=[get_property PERIOD $clock]"
}

set sck_cells [get_cells -hierarchical -quiet -filter {NAME =~*RATIO_NOT_EQUAL_4_GENERATE.SCK_O_NQ_4_NO_STARTUP_USED.SCK_O_NE_4_FDRE_INST}]
puts "SCK_CELL_COUNT=[llength $sck_cells]"
foreach cell $sck_cells {
  puts "SCK_CELL=$cell IOB=[get_property IOB $cell]"
}

close_design
