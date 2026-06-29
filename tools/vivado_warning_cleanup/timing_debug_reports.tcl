if {$argc != 2} {
  puts "usage: timing_debug_reports.tcl <project.xpr> <report_dir>"
  exit 2
}

set project_path [lindex $argv 0]
set report_dir [lindex $argv 1]
file mkdir $report_dir

open_project $project_path
open_run impl_1

report_timing_summary \
  -delay_type max \
  -report_unconstrained \
  -check_timing_verbose \
  -file [file join $report_dir timing_summary_debug.rpt]

report_timing \
  -setup \
  -max_paths 30 \
  -nworst 1 \
  -path_type full_clock_expanded \
  -input_pins \
  -nets \
  -file [file join $report_dir worst_setup_paths.rpt]

report_timing \
  -setup \
  -max_paths 100 \
  -nworst 10 \
  -slack_lesser_than 0 \
  -file [file join $report_dir failing_setup_paths_short.rpt]

if {[catch {report_pulse_width -file [file join $report_dir pulse_width_paths.rpt]} pulse_msg]} {
  puts "PULSE_WIDTH_DETAIL_SKIPPED=$pulse_msg"
}

report_clock_interaction \
  -file [file join $report_dir clock_interaction_debug.rpt]

report_design_analysis \
  -timing \
  -logic_level_distribution \
  -congestion \
  -file [file join $report_dir design_analysis_timing.rpt]

if {[catch {report_qor_suggestions -file [file join $report_dir qor_suggestions.rpt]} qor_msg]} {
  puts "QOR_SUGGESTIONS_SKIPPED=$qor_msg"
}

puts "TIMING_DEBUG_REPORT_DIR=$report_dir"
close_project
