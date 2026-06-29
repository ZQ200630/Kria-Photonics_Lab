set script_dir [file dirname [file normalize [info script]]]

if {[info exists ::env(DEMO1013_ROOT)]} {
  set vivado_root [file normalize $::env(DEMO1013_ROOT)]
} else {
  set vivado_root /home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013
}

set xpr_path [file join $vivado_root hardware xilinx-k26-som-2023.2 xilinx-k26-som-2023.2.xpr]
set policy_path [file join $vivado_root tools message_severity_policy.tcl]

source $policy_path
open_project $xpr_path
apply_reviewed_message_policy

foreach msg_id {
  {Common 17-1361}
  {Synth 8-7071}
  {Synth 8-7023}
  {Synth 8-7129}
  {Synth 8-7080}
  {Power 33-332}
  {Timing 38-436}
  {DRC XDCB-5}
  {DRC PDCN-1569}
  {DRC RTSTAT-10}
  {DRC AVAL-155}
  {DRC REQP-1701}
} {
  puts "VERIFY_MSG_POLICY_ID=$msg_id"
}

foreach generated_width_fragment {
  {port connection 's_axi_awready' does not match port width (3) of module 'project_1_xbar_1'}
  {port connection 's_axi_bresp' does not match port width (6) of module 'project_1_xbar_1'}
  {port connection 's_axi_bvalid' does not match port width (3) of module 'project_1_xbar_1'}
  {port connection 's_axi_wready' does not match port width (3) of module 'project_1_xbar_1'}
  {port connection 'm_axi_arprot' does not match port width (24) of module 'project_1_tier2_xbar_0_0'}
  {port connection 'm_axi_awprot' does not match port width (24) of module 'project_1_tier2_xbar_0_0'}
  {port connection 'm_axi_arprot' does not match port width (24) of module 'project_1_tier2_xbar_1_0'}
  {port connection 'm_axi_awprot' does not match port width (24) of module 'project_1_tier2_xbar_1_0'}
} {
  puts "VERIFY_GENERATED_WIDTH_POLICY=$generated_width_fragment"
}

foreach static_top_port_fragment {
  {design design_top has port ad3552r_qspi_sel driven by constant 1}
  {design design_top has port ad3552r_qspi_sel_b driven by constant 1}
  {design design_top has port SPI_CS[0] driven by constant 0}
} {
  puts "VERIFY_STATIC_TOP_PORT_POLICY=$static_top_port_fragment"
}

foreach unused_bd_instance_fragment {
  {project_1.gen/sources_1/bd/project_1/synth/project_1.v:5910}
  {project_1.gen/sources_1/bd/project_1/synth/project_1.v:6465}
  {project_1.gen/sources_1/bd/project_1/synth/project_1.v:6480}
} {
  puts "VERIFY_UNUSED_BD_INSTANCE_POLICY=$unused_bd_instance_fragment"
}

foreach generated_srl_fragment {
  {u_ila_0/inst/ila_core_inst}
  {u_project_1_wrapper/project_1_i/axi_interconnect_0}
  {u_project_1_wrapper/project_1_i/ps8_0_axi_periph}
} {
  puts "VERIFY_GENERATED_SRL_POLICY=$generated_srl_fragment"
}

puts "VERIFY_XPM_SAME_CLOCK_POLICY=AXI_ADA4355_SPI"

foreach duplicate_ip_vlnv {
  {analog.com:user:sysid_rom:1.0}
  {analog.com:user:util_i2c_mixer:1.0}
  {analog.com:user:util_cdc:1.0}
  {analog.com:user:axi_ad35xxr:1.0}
  {analog.com:user:axi_clkgen:1.0}
  {analog.com:user:axi_hdmi_tx:1.0}
  {analog.com:user:axi_dmac:1.0}
  {analog.com:user:axi_sysid:1.0}
  {analog.com:user:util_axis_fifo:1.0}
  {analog.com:user:axi_i2s_adi:1.0}
  {analog.com:user:axi_spdif_tx:1.0}
} {
  puts "VERIFY_DUPLICATE_IP_POLICY=$duplicate_ip_vlnv"
}

foreach duplicate_interface_vlnv {
  {analog.com:interface:if_framelock:1.0}
  {analog.com:interface:i2s:1.0}
  {analog.com:interface:fifo_wr:1.0}
  {analog.com:interface:fifo_rd:1.0}
} {
  puts "VERIFY_DUPLICATE_INTERFACE_POLICY=$duplicate_interface_vlnv"
}

foreach check_id {XDCB-5 PDCN-1569 RTSTAT-10 AVAL-155 REQP-1701} {
  set checks [get_drc_checks -quiet $check_id]
  puts "VERIFY_DRC_CHECK $check_id COUNT=[llength $checks]"
  foreach check $checks {
    puts "VERIFY_DRC_CHECK $check_id SEVERITY=[get_property SEVERITY $check]"
  }
}

if {[llength [info commands get_methodology_checks]] > 0} {
  foreach check_id {XDCB-5} {
    set checks [get_methodology_checks -quiet $check_id]
    puts "VERIFY_METHODOLOGY_CHECK_PROJECT $check_id COUNT=[llength $checks]"
    foreach check $checks {
      puts "VERIFY_METHODOLOGY_CHECK_PROJECT $check_id SEVERITY=[get_property SEVERITY $check]"
    }
  }
} else {
  puts "VERIFY_METHODOLOGY_CHECK_COMMAND=UNAVAILABLE_BEFORE_OPEN_RUN"
}

if {[llength [get_runs -quiet impl_margin_perf_explore]] > 0} {
  if {[catch {open_run impl_margin_perf_explore} open_run_msg]} {
    puts "VERIFY_OPEN_RUN_SKIPPED=impl_margin_perf_explore MSG=$open_run_msg"
  } else {
    if {[llength [info commands get_methodology_checks]] > 0} {
      foreach check_id {XDCB-5} {
        set checks [get_methodology_checks -quiet $check_id]
        puts "VERIFY_METHODOLOGY_CHECK_OPEN_RUN $check_id COUNT=[llength $checks]"
        foreach check $checks {
          puts "VERIFY_METHODOLOGY_CHECK_OPEN_RUN $check_id SEVERITY=[get_property SEVERITY $check]"
        }
      }
    } else {
      puts "VERIFY_METHODOLOGY_CHECK_COMMAND=UNAVAILABLE_AFTER_OPEN_RUN"
    }
  }
}

close_project
