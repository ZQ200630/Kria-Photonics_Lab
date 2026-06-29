set project_path "/home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/hardware/xilinx-k26-som-2023.2/xilinx-k26-som-2023.2.xpr"
set bd_path "/home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/hardware/xilinx-k26-som-2023.2/xilinx-k26-som-2023.2.srcs/sources_1/bd/project_1/project_1.bd"
set hardware_path "/home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/hardware/xilinx-k26-som-2023.2"
set gen_bd_path "$hardware_path/project_1.gen/sources_1/bd/project_1"
set src_bd_path "$hardware_path/xilinx-k26-som-2023.2.srcs/sources_1/bd/project_1"
set ps_xdc "$gen_bd_path/ip/project_1_zynq_ultra_ps_e_0_0/project_1_zynq_ultra_ps_e_0_0.xdc"
set ada_shared_serdes "$gen_bd_path/ipshared/bcca/_1/xilinx/common/ad_serdes_in.v"
set ada_ip_dir "$gen_bd_path/ip/project_1_axi_ada4355_0_0"
set ada_synth "$ada_ip_dir/synth/project_1_axi_ada4355_0_0.v"
set ada_sim "$ada_ip_dir/sim/project_1_axi_ada4355_0_0.v"
set ada_xml "$ada_ip_dir/project_1_axi_ada4355_0_0.xml"
set ada_xci "$src_bd_path/ip/project_1_axi_ada4355_0_0/project_1_axi_ada4355_0_0.xci"

proc fail {msg} {
  puts "CHECK_FAIL $msg"
  exit 1
}

proc read_file {path} {
  set fd [open $path r]
  set data [read $fd]
  close $fd
  return $data
}

proc assert_close {name actual expected tolerance} {
  if {$actual eq ""} {
    fail "$name is empty"
  }
  set delta [expr {abs(double($actual) - double($expected))}]
  if {$delta > $tolerance} {
    fail "$name expected $expected, got $actual"
  }
}

proc assert_file_matches {path pattern description} {
  if {![file exists $path]} {
    fail "missing $description: $path"
  }
  set data [read_file $path]
  if {![regexp -- $pattern $data]} {
    fail "$description does not match required pattern: $pattern"
  }
}

proc assert_file_not_matches {path pattern description} {
  if {![file exists $path]} {
    fail "missing $description: $path"
  }
  set data [read_file $path]
  if {[regexp -- $pattern $data]} {
    fail "$description still matches forbidden pattern: $pattern"
  }
}

proc assert_file_contains {path needle description} {
  if {![file exists $path]} {
    fail "missing $description: $path"
  }
  set data [read_file $path]
  if {[string first $needle $data] < 0} {
    fail "$description does not contain required text: $needle"
  }
}

proc assert_file_not_contains {path needle description} {
  if {![file exists $path]} {
    fail "missing $description: $path"
  }
  set data [read_file $path]
  if {[string first $needle $data] >= 0} {
    fail "$description still contains forbidden text: $needle"
  }
}

open_project $project_path
open_bd_design $bd_path

set ps [get_bd_cells -quiet K26_SOM]
if {[llength $ps] != 1} {
  fail "expected one K26_SOM cell, got [llength $ps]"
}

set delay_pin [get_bd_pins -quiet AXI_ADA4355/delay_clk]
if {[llength $delay_pin] != 1} {
  fail "expected AXI_ADA4355/delay_clk pin"
}

set pl1_freq_mhz [get_property CONFIG.PSU__CRL_APB__PL1_REF_CTRL__FREQMHZ $ps]
set pl1_actual_mhz [get_property CONFIG.PSU__CRL_APB__PL1_REF_CTRL__ACT_FREQMHZ $ps]
set delay_freq_hz [get_property -quiet CONFIG.FREQ_HZ $delay_pin]

puts "PL1_FREQ_MHZ=$pl1_freq_mhz"
puts "PL1_ACTUAL_MHZ=$pl1_actual_mhz"
puts "AXI_ADA4355_DELAY_FREQ_HZ=$delay_freq_hz"

assert_close "PL1_FREQ_MHZ" $pl1_freq_mhz 300 0.5
assert_close "PL1_ACTUAL_MHZ" $pl1_actual_mhz 300 0.5
assert_close "AXI_ADA4355_DELAY_FREQ_HZ" $delay_freq_hz 300000000 1000000

assert_file_matches $ps_xdc {create_clock -name clk_pl_1 -period "3\.333"} "PS PL1 generated XDC"
assert_file_not_matches $ps_xdc {create_clock -name clk_pl_1 -period "5(\.000)?\"} "PS PL1 generated XDC"

assert_file_matches $ada_shared_serdes {REFCLK_FREQUENCY[[:space:]]*=[[:space:]]*\(FPGA_TECHNOLOGY == 2 \|\| FPGA_TECHNOLOGY == 3\) \? 300 : 200} "generated ADI ad_serdes_in"
assert_file_not_matches $ada_shared_serdes {REFCLK_FREQUENCY[[:space:]]*=[[:space:]]*200[[:space:]]*,} "generated ADI ad_serdes_in"

foreach path [list $ada_synth $ada_sim $ada_xml $ada_xci] {
  assert_file_contains $path "299997009" $path
  assert_file_not_contains $path "199998001" $path
}

assert_file_matches $ada_synth {\.FPGA_TECHNOLOGY\(3\)} "AXI_ADA4355 synth wrapper"
assert_file_matches $ada_sim {\.FPGA_TECHNOLOGY\(3\)} "AXI_ADA4355 sim wrapper"

set stale_cache_count 0
foreach cache_netlist [glob -nocomplain "$hardware_path/xilinx-k26-som-2023.2.cache/ip/2023.2.2/*/*/*/project_1_axi_ada4355_0_0_sim_netlist.v"] {
  set cache_data [read_file $cache_netlist]
  if {[regexp {\.REFCLK_FREQUENCY\(200\.0*} $cache_data]} {
    incr stale_cache_count
  }
}
if {$stale_cache_count > 0} {
  puts "CHECK_WARN found $stale_cache_count stale cached AXI_ADA4355 sim netlist file(s) with REFCLK_FREQUENCY(200.x); generated project files are 300 MHz"
}

puts "CHECK_OK AXI_ADA4355 delay clock project files are configured for 300 MHz"
