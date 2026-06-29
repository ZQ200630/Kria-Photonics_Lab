set dcp_path [lindex $argv 0]
if {$dcp_path eq ""} {
  error "usage: vivado -mode batch -source patch_axi_quad_spi_dcp.tcl -tclargs <dcp_path>"
}

open_checkpoint $dcp_path

set sck_cells [get_cells -hierarchical -quiet -filter {NAME =~*RATIO_NOT_EQUAL_4_GENERATE.SCK_O_NQ_4_NO_STARTUP_USED.SCK_O_NE_4_FDRE_INST}]
puts "SCK_CELL_COUNT=[llength $sck_cells]"
if {[llength $sck_cells] != 1} {
  error "Expected exactly one AXI Quad SPI SCK output FF, found [llength $sck_cells]"
}

foreach cell $sck_cells {
  puts "SCK_CELL_BEFORE=$cell IOB=[get_property IOB $cell]"
}
set_property IOB false $sck_cells
foreach cell $sck_cells {
  puts "SCK_CELL_AFTER=$cell IOB=[get_property IOB $cell]"
}

write_checkpoint -force $dcp_path
close_design
