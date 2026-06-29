set project_path "/home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/hardware/xilinx-k26-som-2023.2/xilinx-k26-som-2023.2.xpr"
set out_dir "/home/qian/Portable_System_Project/Butterfly_Laser_Driver/milestones/vivado_warning_cleanup_20260626_180839/axi_ada4355_delay_clk_300"
file mkdir $out_dir

open_project $project_path
report_ip_status -file [file join $out_dir ip_status.rpt]
puts "IP_STATUS_REPORT=[file join $out_dir ip_status.rpt]"
