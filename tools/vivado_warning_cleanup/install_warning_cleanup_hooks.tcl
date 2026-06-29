set script_dir [file dirname [file normalize [info script]]]

if {[info exists ::env(DEMO1013_ROOT)]} {
  set vivado_root [file normalize $::env(DEMO1013_ROOT)]
} else {
  set vivado_root /home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013
}

set xpr_path [file join $vivado_root hardware xilinx-k26-som-2023.2 xilinx-k26-som-2023.2.xpr]
set pre_hook [file join $vivado_root tools apply_empty_cdc_waiver_cleanup.tcl]

if {![file exists $pre_hook]} {
  error "Empty CDC waiver cleanup pre-hook not found: $pre_hook"
}

open_project $xpr_path

foreach run_name {impl_1 impl_margin_perf_explore impl_margin_perf_holdfix} {
  set runs [get_runs -quiet $run_name]
  if {[llength $runs] == 0} {
    puts "WARNING_CLEANUP_HOOK_RUN_NOT_FOUND=$run_name"
    continue
  }

  set_property STEPS.INIT_DESIGN.TCL.PRE $pre_hook $runs
  puts "WARNING_CLEANUP_HOOK_INSTALLED=$run_name PRE=$pre_hook"
}

close_project
