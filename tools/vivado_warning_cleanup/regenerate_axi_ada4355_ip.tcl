set project_path "/home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/hardware/xilinx-k26-som-2023.2/xilinx-k26-som-2023.2.xpr"

proc try_step {description command} {
  puts "TRY_BEGIN=$description"
  if {[catch {uplevel 1 $command} msg opts]} {
    puts "TRY_FAIL=$description :: $msg"
  } else {
    puts "TRY_OK=$description"
  }
  puts "TRY_END=$description"
}

open_project $project_path
set_property ip_repo_paths [list \
  /home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/hdl/library \
  /home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/IPs \
  /home/qian/xilinx/Xilinx/Vivado_Projects/ADI_HDL/hdl/library \
] [current_project]
update_ip_catalog -rebuild

set ip [get_ips -quiet project_1_axi_ada4355_0_0]
if {[llength $ip] != 1} {
  puts "REGENERATE_AXI_ADA4355_FAIL expected one project_1_axi_ada4355_0_0 IP, got [llength $ip]"
  exit 1
}

puts "IP_IS_LOCKED=[get_property IS_LOCKED $ip]"
puts "IP_USER_LOCKED=[get_property USER_LOCKED $ip]"
puts "IP_UPGRADE_VERSIONS=[get_property -quiet UPGRADE_VERSIONS $ip]"

try_step "clear USER_LOCKED" {set_property USER_LOCKED false $ip}
try_step "reset IP target" {reset_target all $ip}
try_step "generate IP target" {generate_target all $ip}
try_step "synth_ip force" {synth_ip $ip -force}
try_step "export IP user files" {export_ip_user_files -of_objects $ip -no_script -sync -force -quiet}

puts "REGENERATE_AXI_ADA4355_DONE"
