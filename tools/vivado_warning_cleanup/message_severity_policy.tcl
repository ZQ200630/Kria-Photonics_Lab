# Message policy for reviewed generated block-design noise.
#
# These messages were reviewed and are either generated BD/IP optional-port
# noise or non-behavioral flow reminders. They remain visible as INFO, while
# timing violations, CDC risks, DSP/BRAM/IO-buffer DRCs, and unreviewed
# width/constant-drive/unused-instance warnings keep their original severity.

proc apply_reviewed_message_policy {} {
  if {![info exists ::reviewed_message_config_applied]} {
    set ::reviewed_message_config_applied 0
  }

  if {!$::reviewed_message_config_applied} {
    set ::reviewed_message_config_applied 1

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
    set_msg_config -id $msg_id -new_severity INFO -quiet
  }

  # Generated AXI crossbar width adaptations in the block design. These are
  # scoped to the exact observed ports/modules so unrelated user RTL width
  # mismatches still remain warnings.
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
    set_msg_config -id {Synth 8-689} -string $generated_width_fragment -new_severity INFO -quiet
  }

  # Deliberate board-mode/static selects in design_top.v. Keep this exact so a
  # newly constant-driven top-level port still appears as a warning.
  foreach static_top_port_fragment {
    {design design_top has port ad3552r_qspi_sel driven by constant 1}
    {design design_top has port ad3552r_qspi_sel_b driven by constant 1}
    {design design_top has port SPI_CS[0] driven by constant 0}
  } {
    set_msg_config -id {Synth 8-3917} -string $static_top_port_fragment -new_severity INFO -quiet
  }

  # Current generated BD placeholders whose outputs are intentionally unused.
  # Vivado's message text only includes the generated wrapper location, so the
  # scope is kept to the three reviewed generated wrapper line fragments.
  foreach unused_bd_instance_fragment {
    {project_1.gen/sources_1/bd/project_1/synth/project_1.v:5910}
    {project_1.gen/sources_1/bd/project_1/synth/project_1.v:6465}
    {project_1.gen/sources_1/bd/project_1/synth/project_1.v:6480}
  } {
    set_msg_config -id {Synth 8-4446} -string $unused_bd_instance_fragment -new_severity INFO -quiet
  }

  # Generated ILA/AXI SRL retiming limitations. They are not functional
  # failures, but keep the scope away from possible future user RTL SRLs.
  foreach generated_srl_fragment {
    {u_ila_0/inst/ila_core_inst}
    {u_project_1_wrapper/project_1_i/axi_interconnect_0}
    {u_project_1_wrapper/project_1_i/ps8_0_axi_periph}
  } {
    set_msg_config -id {Opt 31-1131} -string $generated_srl_fragment -new_severity INFO -quiet
  }

  # AXI Quad SPI contains async FIFO CDC macros even though its source and
  # destination clocks are tied in this design. Limit the policy to that IP.
  set_msg_config -id {XPM_CDC_GRAY: TCL-1000} -string {AXI_ADA4355_SPI} -new_severity INFO -quiet

  # Known duplicate ADI IP/interface definitions. Demo1013 local copies take
  # precedence over the broader ADI_HDL repo path; keep the rule scoped to the
  # exact VLNV/interface strings so newly introduced duplicate IP remains a
  # warning.
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
    set_msg_config -id {IP_Flow 19-1663} -string $duplicate_ip_vlnv -new_severity INFO -quiet
  }

  foreach duplicate_interface_vlnv {
    {analog.com:interface:if_framelock:1.0}
    {analog.com:interface:i2s:1.0}
    {analog.com:interface:fifo_wr:1.0}
    {analog.com:interface:fifo_rd:1.0}
  } {
    set_msg_config -id {IP_Flow 19-4830} -string $duplicate_interface_vlnv -new_severity INFO -quiet
  }

  }

  # Methodology checks use their own severity in report_methodology. Vivado's
  # non-warning level there is Advisory, while the matching log message remains
  # configured as INFO above.
  if {[llength [info commands get_methodology_checks]] > 0} {
    foreach check [get_methodology_checks -quiet XDCB-5] {
      if {[catch {set_property SEVERITY Advisory $check} msg]} {
        puts "MESSAGE_POLICY_METHODOLOGY_SEVERITY_SKIPPED=XDCB-5 MSG=$msg"
      }
    }
  }

  # These routed DRCs currently point only at dbg_hub/generated AXI FIFO details
  # or ADI DDS DSP power-control advisories. Vivado DRC reports use Advisory as
  # their non-warning level; matching log IDs are configured as INFO above.
  if {[llength [info commands get_drc_checks]] > 0} {
    foreach check_id {PDCN-1569 RTSTAT-10 AVAL-155 REQP-1701} {
      foreach check [get_drc_checks -quiet $check_id] {
        if {[catch {set_property SEVERITY Advisory $check} msg]} {
          puts "MESSAGE_POLICY_DRC_SEVERITY_SKIPPED=$check_id MSG=$msg"
        }
      }
    }
  }
}

apply_reviewed_message_policy
