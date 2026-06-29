set script_dir [file dirname [file normalize [info script]]]
set workspace_root [file dirname [file dirname $script_dir]]

if {[info exists ::env(DEMO1013_ROOT)]} {
  set vivado_root [file normalize $::env(DEMO1013_ROOT)]
} else {
  set vivado_root /home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013
}

set xpr_path [file join $vivado_root hardware xilinx-k26-som-2023.2 xilinx-k26-som-2023.2.xpr]
set report_dir [file join $workspace_root milestones vivado_warning_cleanup_20260626_180839 timing_methodology_details]
file mkdir $report_dir

open_project $xpr_path
source [file join $script_dir message_severity_policy.tcl]
open_run impl_margin_perf_explore
apply_reviewed_message_policy

report_methodology -file [file join $report_dir methodology.rpt]
report_timing_summary \
  -delay_type min_max \
  -report_unconstrained \
  -check_timing_verbose \
  -file [file join $report_dir timing_summary.rpt]
report_clock_interaction -file [file join $report_dir clock_interaction.rpt]

if {[catch {
  report_exceptions -file [file join $report_dir exceptions.rpt]
} msg]} {
  puts "REPORT_EXCEPTIONS_SKIPPED=$msg"
}

if {[catch {
  report_exceptions -ignored -file [file join $report_dir exceptions_ignored.rpt]
} msg]} {
  puts "REPORT_EXCEPTIONS_IGNORED_SKIPPED=$msg"
}

if {[catch {
  report_cdc -details -file [file join $report_dir cdc_details.rpt]
} msg]} {
  puts "REPORT_CDC_SKIPPED=$msg"
}

puts "TIMING_METHODOLOGY_DETAILS_DIR=$report_dir"
close_project
