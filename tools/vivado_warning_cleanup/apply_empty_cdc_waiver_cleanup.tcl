set script_dir [file dirname [file normalize [info script]]]

if {[info exists ::env(DEMO1013_ROOT)]} {
  set vivado_root [file normalize $::env(DEMO1013_ROOT)]
} else {
  set vivado_root /home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013
}

source [file join $script_dir empty_cdc_waiver_cleanup.tcl]

patch_empty_cdc_waivers $vivado_root
validate_no_unsupported_cdc_waiver_patch $vivado_root

