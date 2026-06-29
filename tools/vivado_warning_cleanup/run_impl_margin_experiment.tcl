set_param general.maxThreads 8

set script_dir [file dirname [file normalize [info script]]]
set workspace_root [file dirname [file dirname $script_dir]]
if {[info exists ::env(DEMO1013_ROOT)]} {
  set vivado_root $::env(DEMO1013_ROOT)
} else {
  set vivado_root /home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013
}

set run_name impl_margin_perf_explore
set strategy Performance_Explore
set enable_post_route_phys_opt 1
set post_route_phys_opt_directive AggressiveExplore

if {[llength $argv] >= 1 && [lindex $argv 0] ne ""} {
  set run_name [lindex $argv 0]
}
if {[llength $argv] >= 2 && [lindex $argv 1] ne ""} {
  set strategy [lindex $argv 1]
}
if {[llength $argv] >= 3 && [lindex $argv 2] ne ""} {
  set enable_post_route_phys_opt [lindex $argv 2]
}
if {[llength $argv] >= 4 && [lindex $argv 3] ne ""} {
  set post_route_phys_opt_directive [lindex $argv 3]
}

set xpr_path [file join $vivado_root hardware xilinx-k26-som-2023.2 xilinx-k26-som-2023.2.xpr]
set report_root [file join $workspace_root milestones vivado_warning_cleanup_20260626_180839 timing_margin_experiments]
set report_dir [file join $report_root $run_name]
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

proc try_set_property {prop value obj} {
  if {[catch {set_property $prop $value $obj} msg]} {
    puts "SET_PROPERTY_FAILED $prop=$value MSG=$msg"
    return 0
  }

  puts "SET_PROPERTY_OK $prop=$value"
  return 1
}

proc emit_run_metrics {label run_name} {
  set run [get_runs $run_name]
  foreach prop {STATS.WNS STATS.TNS STATS.WHS STATS.THS STATS.TPWS STATS.FAILED_NETS STATUS STRATEGY} {
    if {[catch {set value [get_property $prop $run]} msg]} {
      puts "METRIC $label $prop ERROR=$msg"
    } else {
      puts "METRIC $label $prop=$value"
    }
  }
}

proc copy_run_reports {run_name report_dir} {
  set run_dir [get_property DIRECTORY [get_runs $run_name]]
  foreach pattern {
    *timing_summary*.rpt
    *route_status*.rpt
    *methodology*.rpt
    *drc*.rpt
    *power*.rpt
  } {
    foreach rpt [glob -nocomplain [file join $run_dir $pattern]] {
      file copy -force $rpt [file join $report_dir [file tail $rpt]]
    }
  }
}

source [file join $script_dir empty_cdc_waiver_cleanup.tcl]
source [file join $script_dir message_severity_policy.tcl]
open_project $xpr_path
apply_reviewed_message_policy

patch_empty_cdc_waivers $vivado_root
validate_no_unsupported_cdc_waiver_patch $vivado_root

require_complete synth_1
emit_run_metrics BASELINE impl_1

if {[llength [get_runs -quiet $run_name]] == 0} {
  puts "CREATE_RUN $run_name"
  create_run $run_name \
    -parent_run synth_1 \
    -flow {Vivado Implementation 2023} \
    -strategy {Vivado Implementation Defaults} \
    -constrset constrs_1
} else {
  puts "REUSE_RUN $run_name"
}

set run [get_runs $run_name]
try_set_property STRATEGY $strategy $run
if {$enable_post_route_phys_opt} {
  try_set_property STEPS.POST_ROUTE_PHYS_OPT_DESIGN.IS_ENABLED 1 $run
  try_set_property STEPS.POST_ROUTE_PHYS_OPT_DESIGN.ARGS.DIRECTIVE $post_route_phys_opt_directive $run
}

report_property -all $run -file [file join $report_dir run_properties_before_launch.rpt]
reset_run $run_name

set to_step route_design
if {$enable_post_route_phys_opt} {
  set to_step {phys_opt_design (Post-Route)}
}
puts "LAUNCH_RUN $run_name STRATEGY=$strategy TO_STEP=$to_step POST_ROUTE_PHYS_OPT_DIRECTIVE=$post_route_phys_opt_directive"
launch_runs $run_name -to_step $to_step -jobs 8
wait_on_run $run_name
require_complete $run_name
emit_run_metrics RESULT $run_name

open_run $run_name
report_timing_summary \
  -delay_type min_max \
  -report_unconstrained \
  -check_timing_verbose \
  -max_paths 20 \
  -file [file join $report_dir timing_summary.rpt]
report_timing \
  -setup \
  -max_paths 10 \
  -sort_by slack \
  -file [file join $report_dir setup_paths.rpt]
report_timing \
  -hold \
  -max_paths 10 \
  -sort_by slack \
  -file [file join $report_dir hold_paths.rpt]
report_route_status -file [file join $report_dir route_status.rpt]
report_bus_skew -file [file join $report_dir bus_skew.rpt]
report_methodology -file [file join $report_dir methodology.rpt]
report_drc -file [file join $report_dir drc.rpt]
copy_run_reports $run_name $report_dir

puts "REPORT_DIR=$report_dir"

close_project
