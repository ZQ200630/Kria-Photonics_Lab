set_param general.maxThreads 8

set run_name impl_margin_perf_explore
if {[llength $argv] >= 1 && [lindex $argv 0] ne ""} {
  set run_name [lindex $argv 0]
}

if {[info exists ::env(DEMO1013_ROOT)]} {
  set vivado_root $::env(DEMO1013_ROOT)
} else {
  set vivado_root /home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013
}

set xpr_path [file join $vivado_root hardware xilinx-k26-som-2023.2 xilinx-k26-som-2023.2.xpr]

proc emit_run_metrics {label run_name} {
  set run [get_runs $run_name]
  foreach prop {STATS.WNS STATS.TNS STATS.WHS STATS.THS STATS.TPWS STATS.FAILED_NETS STATUS STRATEGY DIRECTORY} {
    if {[catch {set value [get_property $prop $run]} msg]} {
      puts "METRIC $label $prop ERROR=$msg"
    } else {
      puts "METRIC $label $prop=$value"
    }
  }
}

open_project $xpr_path
if {[llength [get_runs -quiet $run_name]] == 0} {
  error "Run not found: $run_name"
}

emit_run_metrics BEFORE $run_name
launch_runs $run_name -to_step write_bitstream -jobs 8
wait_on_run $run_name
emit_run_metrics AFTER $run_name

set status [get_property STATUS [get_runs $run_name]]
if {[string first "Complete" $status] < 0} {
  error "$run_name did not complete: $status"
}

close_project
