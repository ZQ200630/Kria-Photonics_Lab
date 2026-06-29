set project_path "/home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/hardware/xilinx-k26-som-2023.2/xilinx-k26-som-2023.2.xpr"
set bd_path "/home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/hardware/xilinx-k26-som-2023.2/xilinx-k26-som-2023.2.srcs/sources_1/bd/project_1/project_1.bd"

proc fail {msg} {
  puts "SET_DELAY_CLK_FAIL $msg"
  exit 1
}

open_project $project_path
set_property ip_repo_paths [list \
  /home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/hdl/library \
  /home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/IPs \
  /home/qian/xilinx/Xilinx/Vivado_Projects/ADI_HDL/hdl/library \
] [current_project]
update_ip_catalog -rebuild

open_bd_design $bd_path

set ps [get_bd_cells -quiet K26_SOM]
if {[llength $ps] != 1} {
  fail "expected one K26_SOM cell, got [llength $ps]"
}

set delay_pin [get_bd_pins -quiet AXI_ADA4355/delay_clk]
if {[llength $delay_pin] != 1} {
  fail "expected AXI_ADA4355/delay_clk pin"
}

puts "BEFORE_PL1_FREQ_MHZ=[get_property CONFIG.PSU__CRL_APB__PL1_REF_CTRL__FREQMHZ $ps]"
puts "BEFORE_PL1_ACTUAL_MHZ=[get_property CONFIG.PSU__CRL_APB__PL1_REF_CTRL__ACT_FREQMHZ $ps]"
puts "BEFORE_DELAY_FREQ_HZ=[get_property -quiet CONFIG.FREQ_HZ $delay_pin]"

set_property -dict [list \
  CONFIG.PSU__CRL_APB__PL1_REF_CTRL__FREQMHZ {300} \
] $ps
set_property -dict [list CONFIG.FREQ_HZ {299997009}] $delay_pin

if {[catch {validate_bd_design} validate_msg validate_opts]} {
  puts "WARNING_VALIDATE_BD_DESIGN_FAILED=$validate_msg"
}
save_bd_design

set bd_file [get_files $bd_path]
reset_target all $bd_file
generate_target all $bd_file

export_ip_user_files -of_objects $bd_file -no_script -sync -force -quiet
update_compile_order -fileset sources_1

puts "AFTER_PL1_FREQ_MHZ=[get_property CONFIG.PSU__CRL_APB__PL1_REF_CTRL__FREQMHZ $ps]"
puts "AFTER_PL1_ACTUAL_MHZ=[get_property CONFIG.PSU__CRL_APB__PL1_REF_CTRL__ACT_FREQMHZ $ps]"
puts "AFTER_DELAY_FREQ_HZ=[get_property -quiet CONFIG.FREQ_HZ $delay_pin]"
puts "SET_DELAY_CLK_OK"
