set project_path "/home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/hardware/xilinx-k26-som-2023.2/xilinx-k26-som-2023.2.xpr"

open_project $project_path

puts "IP_REPO_PATHS=[get_property ip_repo_paths [current_project]]"
update_ip_catalog

set required_ips {
  analog.com:user:axi_ada4355:1.0
  analog.com:user:axi_ad3552r:1.0
  analog.com:user:axi_clkgen:1.0
  analog.com:user:axi_dmac:1.0
  user.org:user:axi_laser_current_ctrl:1.0
  user.org:user:ad4170_tec_ctrl:1.0
  user.org:user:axi_ada4355_capture:1.0
  user.org:user:axi_pam_image_acq:1.0
}

foreach vlnv $required_ips {
  set defs [get_ipdefs -quiet $vlnv]
  puts "IPDEF_COUNT $vlnv [llength $defs]"
  if {[llength $defs] == 0} {
    error "Missing required IP definition: $vlnv"
  }
}

close_project
