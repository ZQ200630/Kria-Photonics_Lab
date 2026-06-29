set script_dir [file dirname [file normalize [info script]]]
set proj_root [file dirname $script_dir]
set workspace_root [file dirname $proj_root]
if {[info exists ::env(DEMO1013_ROOT)]} {
  set vivado_root $::env(DEMO1013_ROOT)
} else {
  set vivado_root /home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013
}
set xpr_path [file join $vivado_root hardware xilinx-k26-som-2023.2 xilinx-k26-som-2023.2.xpr]
set report_dir [file join $workspace_root reports vivado_warning_cleanup_20260625 timing_margin_experiments]
file mkdir $report_dir

open_project $xpr_path

set impl_run [get_runs impl_1]
puts "RUN_NAME=[get_property NAME $impl_run]"
puts "RUN_STATUS=[get_property STATUS $impl_run]"
puts "RUN_STRATEGY=[get_property STRATEGY $impl_run]"
puts "RUN_FLOW=[get_property FLOW $impl_run]"
puts "RUN_DIRECTORY=[get_property DIRECTORY $impl_run]"

set prop_file [file join $report_dir impl_1_properties.rpt]
report_property -all $impl_run -file $prop_file
puts "RUN_PROPERTY_REPORT=$prop_file"

puts "RUN_STEP_PROPERTIES_BEGIN"
foreach prop [lsort [list_property $impl_run]] {
  if {[string match "STEPS.*" $prop]} {
    puts "$prop=[get_property $prop $impl_run]"
  }
}
puts "RUN_STEP_PROPERTIES_END"

puts "STRATEGIES_BEGIN"
if {[catch {
  foreach strategy [lsort [get_strategies -quiet]] {
    puts "STRATEGY=$strategy"
  }
} strategy_error]} {
  puts "STRATEGIES_ERROR=$strategy_error"
}
puts "STRATEGIES_END"

close_project
