set_param general.maxThreads 8

set script_dir [file dirname [file normalize [info script]]]
set proj_root [file dirname $script_dir]
set xpr_path [file join $proj_root hardware xilinx-k26-som-2023.2 xilinx-k26-som-2023.2.xpr]
set report_dir [file join $proj_root reports vivado_warning_cleanup_20260625]
file mkdir $report_dir

proc run_status {run_name} {
  set run [get_runs $run_name]
  return [get_property STATUS $run]
}

proc require_complete {run_name} {
  set status [run_status $run_name]
  puts "RUN_STATUS $run_name $status"
  if {[string first "Complete" $status] < 0} {
    error "$run_name did not complete: $status"
  }
}

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

proc patch_axi_quad_spi_iob_xdc {proj_root} {
  set xdc_path [file join $proj_root hardware xilinx-k26-som-2023.2 project_1.gen sources_1 bd project_1 ip project_1_axi_quad_spi_1_0 project_1_axi_quad_spi_1_0.xdc]
  if {![file exists $xdc_path]} {
    puts "AXI_QUAD_SPI_IOB_XDC_NOT_FOUND=$xdc_path"
    return
  }

  set data [read_text_file $xdc_path]
  set from {set_property IOB true [get_cells -hierarchical -filter {NAME =~*IO*_I_REG}]}
  set to {set_property IOB false [get_cells -hierarchical -filter {NAME =~*IO*_I_REG}]}
  set patched [string map [list $from $to] $data]

  if {$patched ne $data} {
    write_text_file $xdc_path $patched
    puts "PATCHED_AXI_QUAD_SPI_IOB_XDC=$xdc_path"
  } elseif {[string first $to $data] >= 0} {
    puts "AXI_QUAD_SPI_IOB_XDC_ALREADY_PATCHED=$xdc_path"
  } else {
    puts "AXI_QUAD_SPI_IOB_XDC_UNEXPECTED_CONTENT=$xdc_path"
  }
}

proc patch_empty_cdc_waivers {proj_root} {
  set ip_dir [file join $proj_root hardware xilinx-k26-som-2023.2 project_1.gen sources_1 bd project_1 ip]
  set xdc_paths [glob -nocomplain -type f -directory $ip_dir -tails */*_clocks.xdc]
  set total_patched 0

  foreach rel_path [lsort $xdc_paths] {
    set xdc_path [file join $ip_dir $rel_path]
    set file_name [file tail $xdc_path]
    set data [read_text_file $xdc_path]

    if {[string first "SKIP_EMPTY_CDC_WAIVER_BEGIN" $data] >= 0} {
      puts "EMPTY_CDC_WAIVER_XDC_ALREADY_PATCHED=$xdc_path"
      continue
    }

    set lines [split $data "\n"]
    set out_lines {}
    set patched_in_file 0
    set waiver_index 0

    for {set i 0} {$i < [llength $lines]} {incr i} {
      set line [lindex $lines $i]
      if {[regexp {^create_waiver -type CDC .*\\$} $line] && $i + 1 < [llength $lines]} {
        set next_line [string trim [lindex $lines [expr {$i + 1}]]]
        if {[regexp {^-to \[(.*)\]$} $next_line -> to_expr]} {
          set skip_patch [expr {[string match {project_1_auto_us_*_clocks.xdc} $file_name] && $waiver_index == 7}]
          incr waiver_index

          if {!$skip_patch} {
            lappend out_lines "# SKIP_EMPTY_CDC_WAIVER_BEGIN"
            lappend out_lines "# $line"
            lappend out_lines "# [lindex $lines [expr {$i + 1}]]"
            lappend out_lines "# SKIP_EMPTY_CDC_WAIVER_END"
            incr i
            incr patched_in_file
            continue
          }
        }
      }

      lappend out_lines $line
    }

    if {$patched_in_file > 0} {
      write_text_file $xdc_path [join $out_lines "\n"]
      incr total_patched $patched_in_file
      puts "PATCHED_EMPTY_CDC_WAIVERS=$xdc_path COUNT=$patched_in_file"
    }
  }

  puts "PATCHED_EMPTY_CDC_WAIVERS_TOTAL=$total_patched"
}

proc validate_no_unsupported_cdc_waiver_patch {proj_root} {
  set ip_dir [file join $proj_root hardware xilinx-k26-som-2023.2 project_1.gen sources_1 bd project_1 ip]
  set xdc_paths [glob -nocomplain -type f -directory $ip_dir -tails */*_clocks.xdc]

  foreach rel_path [lsort $xdc_paths] {
    set xdc_path [file join $ip_dir $rel_path]
    set data [read_text_file $xdc_path]
    if {[regexp -line {^(set __cdc_to|if \{|unset __cdc_to)} $data]} {
      error "Unsupported Tcl command remains in generated XDC after CDC waiver patch: $xdc_path"
    }
  }
}

proc patch_axi_quad_spi_dcp {proj_root} {
  set dcp_path [file join $proj_root hardware xilinx-k26-som-2023.2 project_1.gen sources_1 bd project_1 ip project_1_axi_quad_spi_1_0 project_1_axi_quad_spi_1_0.dcp]
  if {![file exists $dcp_path]} {
    puts "AXI_QUAD_SPI_DCP_NOT_FOUND=$dcp_path"
    return
  }

  set_msg_config -id {Vivado 12-8410} -suppress -quiet
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

  puts "PATCHED_AXI_QUAD_SPI_DCP=$dcp_path IOB_BEFORE=$before IOB_AFTER=$after"
}

source [file join $script_dir message_severity_policy.tcl]
open_project $xpr_path
apply_reviewed_message_policy

set bd_path [file join $proj_root hardware xilinx-k26-som-2023.2 xilinx-k26-som-2023.2.srcs sources_1 bd project_1 project_1.bd]
set bd_file [get_files -quiet $bd_path]
if {[llength $bd_file] > 0} {
  reset_target all $bd_file
  generate_target all $bd_file
}
patch_axi_quad_spi_iob_xdc $proj_root
patch_empty_cdc_waivers $proj_root
validate_no_unsupported_cdc_waiver_patch $proj_root

reset_run synth_1
reset_run impl_1

launch_runs synth_1 -jobs 8
wait_on_run synth_1
require_complete synth_1
patch_axi_quad_spi_dcp $proj_root

launch_runs impl_1 -to_step write_bitstream -jobs 8
wait_on_run impl_1
set impl_status [run_status impl_1]
puts "RUN_STATUS impl_1 $impl_status"

if {[string first "Complete" $impl_status] >= 0} {
  open_run impl_1
  report_timing_summary -delay_type max -report_unconstrained -check_timing_verbose -file [file join $report_dir timing_summary.rpt]
  report_clock_interaction -file [file join $report_dir clock_interaction.rpt]
  report_bus_skew -file [file join $report_dir bus_skew.rpt]
  report_power -file [file join $report_dir power.rpt]
  if {[catch {report_power -advisory -file [file join $report_dir power_advisory.rpt]} power_advisory_msg]} {
    puts "POWER_ADVISORY_SKIPPED=$power_advisory_msg"
  }
  report_utilization -hierarchical -file [file join $report_dir utilization_hierarchical.rpt]
  report_route_status -file [file join $report_dir route_status.rpt]
  report_drc -file [file join $report_dir drc.rpt]
  report_methodology -file [file join $report_dir methodology.rpt]
  puts "REPORT_DIR=$report_dir"
} else {
  puts "IMPL_NOT_COMPLETE_REPORTS_SKIPPED"
}

close_project
