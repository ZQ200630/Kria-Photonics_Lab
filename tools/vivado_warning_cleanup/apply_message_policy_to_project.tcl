set script_dir [file dirname [file normalize [info script]]]
set workspace_root [file dirname [file dirname $script_dir]]

if {[info exists ::env(DEMO1013_ROOT)]} {
  set vivado_root [file normalize $::env(DEMO1013_ROOT)]
} else {
  set vivado_root /home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013
}

set xpr_path [file join $vivado_root hardware xilinx-k26-som-2023.2 xilinx-k26-som-2023.2.xpr]
set policy_path [file join $vivado_root tools message_severity_policy.tcl]

if {![file exists $policy_path]} {
  error "Message severity policy not found: $policy_path"
}

source $policy_path

open_project $xpr_path

if {[llength [info commands apply_reviewed_message_policy]] > 0} {
  apply_reviewed_message_policy
} else {
  source $policy_path
}
puts "APPLIED_MESSAGE_SEVERITY_POLICY=$policy_path"

close_project
