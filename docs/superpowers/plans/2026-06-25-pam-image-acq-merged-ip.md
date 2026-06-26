# PAM Image Acquisition Merged IP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a new packaged Vivado IP that merges the existing `PAM_Parameters_v1.0` AXI-Lite register bank with the `image_acq_controller` RTL module while preserving the `0xA0110000` software register map.

**Architecture:** The new `axi_pam_image_acq_1_0` IP owns the AXI-Lite registers and instantiates a renamed copy of the image acquisition controller core internally. The Vivado block design will replace `PAM_Parameters_0` and `image_acq_controller_0` with one `axi_pam_image_acq_0` cell and reconnect the existing downstream trigger, galvo, metadata, and busy/backpressure nets.

**Tech Stack:** Verilog RTL, Vivado 2023.2 IP Packager, AXI4-Lite, XSIM/XVLOG, Vivado block-design Tcl.

---

## File Structure

- Create `/home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/IPs/ip_repo/axi_pam_image_acq_1_0/hdl/axi_pam_image_acq_v1_0.v`
  - Top-level packaged IP wrapper. Exposes AXI-Lite plus runtime image-acquisition ports.
- Create `/home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/IPs/ip_repo/axi_pam_image_acq_1_0/hdl/axi_pam_image_acq_v1_0_S00_AXI.v`
  - Register bank copied from `PAM_Parameters_v1_0_S00_AXI.v` with module name changed.
- Create `/home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/IPs/ip_repo/axi_pam_image_acq_1_0/hdl/pam_image_acq_controller_core.v`
  - Renamed copy of `image_acq_controller.v`, avoiding duplicate module names while the old module-ref remains in the project.
- Create `/home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/IPs/ip_repo/axi_pam_image_acq_1_0/tb/tb_axi_pam_image_acq_compile.sv`
  - Minimal AXI-driven behavior test for the merged wrapper.
- Create `/home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/IPs/ip_repo/axi_pam_image_acq_1_0/scripts/package_axi_pam_image_acq.tcl`
  - Vivado batch script that packages the new IP and writes `component.xml`.
- Create `/home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/tools/replace_pam_image_acq_with_merged_ip.tcl`
  - Vivado batch migration helper for replacing the two old BD cells with the merged IP.
- Create `/home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/tools/validate_project_1_bd.tcl`
  - Vivado batch helper for repeat block-design validation after migration.

The Vivado project is not a git repository, so use filesystem milestones for hardware rollback. The software repository will commit only this plan and related docs.

---

### Task 1: Create Hardware Milestone

**Files:**
- Backup: `/home/qian/Portable_System_Project/milestones/pam_image_acq_pre_merge_20260625_merged_ip/`

- [ ] **Step 1: Create a timestamped milestone directory**

Run:

```bash
mkdir -p /home/qian/Portable_System_Project/milestones/pam_image_acq_pre_merge_20260625_merged_ip
```

Expected: the milestone directory exists under `/home/qian/Portable_System_Project/milestones`.

- [ ] **Step 2: Copy the relevant Vivado project sources into the milestone**

Run from `/home/qian/Portable_System_Project/milestones` after identifying the newest `pam_image_acq_pre_merge_*` directory:

```bash
rsync -a /home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/IPs /home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/hardware/xilinx-k26-som-2023.2/rtl /home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/hardware/xilinx-k26-som-2023.2/xilinx-k26-som-2023.2.srcs/sources_1/bd /home/qian/Portable_System_Project/milestones/pam_image_acq_pre_merge_20260625_merged_ip/
```

Expected: the milestone contains `IPs`, `rtl`, and `bd` directories.

- [ ] **Step 3: Record checksums for the milestone**

Run:

```bash
find /home/qian/Portable_System_Project/milestones/pam_image_acq_pre_merge_20260625_merged_ip -type f -print0 | sort -z | xargs -0 sha256sum > /home/qian/Portable_System_Project/milestones/pam_image_acq_pre_merge_20260625_merged_ip/SHA256SUMS.txt
```

Expected: `SHA256SUMS.txt` is created in the milestone directory.

---

### Task 2: Create the New IP HDL Skeleton

**Files:**
- Create: `/home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/IPs/ip_repo/axi_pam_image_acq_1_0/hdl/axi_pam_image_acq_v1_0.v`
- Create: `/home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/IPs/ip_repo/axi_pam_image_acq_1_0/hdl/axi_pam_image_acq_v1_0_S00_AXI.v`
- Create: `/home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/IPs/ip_repo/axi_pam_image_acq_1_0/hdl/pam_image_acq_controller_core.v`

- [ ] **Step 1: Create the new IP directory structure**

Run:

```bash
mkdir -p /home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/IPs/ip_repo/axi_pam_image_acq_1_0/hdl /home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/IPs/ip_repo/axi_pam_image_acq_1_0/tb /home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/IPs/ip_repo/axi_pam_image_acq_1_0/scripts
```

Expected: `hdl`, `tb`, and `scripts` directories exist.

- [ ] **Step 2: Copy and rename the AXI register bank**

Run:

```bash
cp /home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/IPs/ip_repo/PAM_Parameters_1_0/hdl/PAM_Parameters_v1_0_S00_AXI.v /home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/IPs/ip_repo/axi_pam_image_acq_1_0/hdl/axi_pam_image_acq_v1_0_S00_AXI.v
perl -0pi -e 's/module PAM_Parameters_v1_0_S00_AXI/module axi_pam_image_acq_v1_0_S00_AXI/' /home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/IPs/ip_repo/axi_pam_image_acq_1_0/hdl/axi_pam_image_acq_v1_0_S00_AXI.v
```

Expected: the copied register bank defines `module axi_pam_image_acq_v1_0_S00_AXI`.

- [ ] **Step 3: Copy and rename the image acquisition controller core**

Run:

```bash
cp /home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/hardware/xilinx-k26-som-2023.2/rtl/image_acq_controller.v /home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/IPs/ip_repo/axi_pam_image_acq_1_0/hdl/pam_image_acq_controller_core.v
perl -0pi -e 's/module image_acq_controller\\s*\\(/module pam_image_acq_controller_core (/s' /home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/IPs/ip_repo/axi_pam_image_acq_1_0/hdl/pam_image_acq_controller_core.v
```

Expected: the copied controller defines `module pam_image_acq_controller_core`.

- [ ] **Step 4: Write the merged top-level wrapper**

Create `/home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/IPs/ip_repo/axi_pam_image_acq_1_0/hdl/axi_pam_image_acq_v1_0.v` with this content:

```verilog
`timescale 1 ns / 1 ps

module axi_pam_image_acq_v1_0 #
(
    parameter integer C_S00_AXI_DATA_WIDTH = 32,
    parameter integer C_S00_AXI_ADDR_WIDTH = 8
)
(
    input  wire        overall_busy_pl,
    output wire        busy,
    output wire        image_start_pulse,
    output wire        image_end_pulse,
    output wire        pixel_start_pulse,
    output wire        frame_start_pulse,
    output wire        laser_trigger,
    output wire        adc_trigger,
    output wire signed [15:0] galvo_x,
    output wire signed [15:0] galvo_y,
    output wire [255:0] meta_data,
    output wire        meta_valid,

    input  wire  s00_axi_aclk,
    input  wire  s00_axi_aresetn,
    input  wire [C_S00_AXI_ADDR_WIDTH-1 : 0] s00_axi_awaddr,
    input  wire [2 : 0] s00_axi_awprot,
    input  wire  s00_axi_awvalid,
    output wire  s00_axi_awready,
    input  wire [C_S00_AXI_DATA_WIDTH-1 : 0] s00_axi_wdata,
    input  wire [(C_S00_AXI_DATA_WIDTH/8)-1 : 0] s00_axi_wstrb,
    input  wire  s00_axi_wvalid,
    output wire  s00_axi_wready,
    output wire [1 : 0] s00_axi_bresp,
    output wire  s00_axi_bvalid,
    input  wire  s00_axi_bready,
    input  wire [C_S00_AXI_ADDR_WIDTH-1 : 0] s00_axi_araddr,
    input  wire [2 : 0] s00_axi_arprot,
    input  wire  s00_axi_arvalid,
    output wire  s00_axi_arready,
    output wire [C_S00_AXI_DATA_WIDTH-1 : 0] s00_axi_rdata,
    output wire [1 : 0] s00_axi_rresp,
    output wire  s00_axi_rvalid,
    input  wire  s00_axi_rready
);

wire signed [15:0] x_start;
wire signed [15:0] x_step;
wire        [15:0] x_points;
wire signed [15:0] y_start;
wire signed [15:0] y_step;
wire        [15:0] y_points;
wire        [15:0] frame_number;
wire        [31:0] task_id;
wire        [31:0] gap_time;
wire        [31:0] galvo_settle_time;
wire        [31:0] ld_trigger_time;
wire        [31:0] adc_trigger_time;
wire        [31:0] ld_time;
wire               start;
wire               scan_mode;

axi_pam_image_acq_v1_0_S00_AXI # (
    .C_S_AXI_DATA_WIDTH(C_S00_AXI_DATA_WIDTH),
    .C_S_AXI_ADDR_WIDTH(C_S00_AXI_ADDR_WIDTH)
) reg_bank (
    .x_start_out           (x_start),
    .x_step_out            (x_step),
    .x_points_out          (x_points),
    .y_start_out           (y_start),
    .y_step_out            (y_step),
    .y_points_out          (y_points),
    .frame_number_out      (frame_number),
    .task_id_out           (task_id),
    .gap_time_out          (gap_time),
    .galvo_settle_time_out (galvo_settle_time),
    .ld_trigger_time_out   (ld_trigger_time),
    .adc_trigger_time_out  (adc_trigger_time),
    .ld_time_out           (ld_time),
    .start_out             (start),
    .scan_mode             (scan_mode),

    .S_AXI_ACLK            (s00_axi_aclk),
    .S_AXI_ARESETN         (s00_axi_aresetn),
    .S_AXI_AWADDR          (s00_axi_awaddr),
    .S_AXI_AWPROT          (s00_axi_awprot),
    .S_AXI_AWVALID         (s00_axi_awvalid),
    .S_AXI_AWREADY         (s00_axi_awready),
    .S_AXI_WDATA           (s00_axi_wdata),
    .S_AXI_WSTRB           (s00_axi_wstrb),
    .S_AXI_WVALID          (s00_axi_wvalid),
    .S_AXI_WREADY          (s00_axi_wready),
    .S_AXI_BRESP           (s00_axi_bresp),
    .S_AXI_BVALID          (s00_axi_bvalid),
    .S_AXI_BREADY          (s00_axi_bready),
    .S_AXI_ARADDR          (s00_axi_araddr),
    .S_AXI_ARPROT          (s00_axi_arprot),
    .S_AXI_ARVALID         (s00_axi_arvalid),
    .S_AXI_ARREADY         (s00_axi_arready),
    .S_AXI_RDATA           (s00_axi_rdata),
    .S_AXI_RRESP           (s00_axi_rresp),
    .S_AXI_RVALID          (s00_axi_rvalid),
    .S_AXI_RREADY          (s00_axi_rready)
);

pam_image_acq_controller_core controller (
    .clk               (s00_axi_aclk),
    .rst_n             (s00_axi_aresetn),
    .start             (start),
    .overall_busy_pl   (overall_busy_pl),
    .x_start           (x_start),
    .x_step            (x_step),
    .x_points          (x_points),
    .y_start           (y_start),
    .y_step            (y_step),
    .y_points          (y_points),
    .frame_number      (frame_number),
    .task_id           (task_id),
    .scan_mode         (scan_mode),
    .gap_time          (gap_time),
    .galvo_settle_time (galvo_settle_time),
    .ld_trigger_time   (ld_trigger_time),
    .adc_trigger_time  (adc_trigger_time),
    .ld_time           (ld_time),
    .busy              (busy),
    .image_start_pulse (image_start_pulse),
    .image_end_pulse   (image_end_pulse),
    .pixel_start_pulse (pixel_start_pulse),
    .frame_start_pulse (frame_start_pulse),
    .laser_trigger     (laser_trigger),
    .adc_trigger       (adc_trigger),
    .galvo_x           (galvo_x),
    .galvo_y           (galvo_y),
    .meta_data         (meta_data),
    .meta_valid        (meta_valid)
);

endmodule
```

---

### Task 3: Add a Merged-IP Compile and Behavior Test

**Files:**
- Create: `/home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/IPs/ip_repo/axi_pam_image_acq_1_0/tb/tb_axi_pam_image_acq_compile.sv`

- [ ] **Step 1: Write the AXI-driven testbench**

Create `/home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/IPs/ip_repo/axi_pam_image_acq_1_0/tb/tb_axi_pam_image_acq_compile.sv` with this content:

```systemverilog
`timescale 1ns / 1ps

module tb_axi_pam_image_acq_compile;
  reg clk = 1'b0;
  reg rst_n = 1'b0;
  reg overall_busy_pl = 1'b0;

  reg  [7:0]  awaddr = 8'd0;
  reg  [2:0]  awprot = 3'd0;
  reg         awvalid = 1'b0;
  wire        awready;
  reg  [31:0] wdata = 32'd0;
  reg  [3:0]  wstrb = 4'hF;
  reg         wvalid = 1'b0;
  wire        wready;
  wire [1:0]  bresp;
  wire        bvalid;
  reg         bready = 1'b0;
  reg  [7:0]  araddr = 8'd0;
  reg  [2:0]  arprot = 3'd0;
  reg         arvalid = 1'b0;
  wire        arready;
  wire [31:0] rdata;
  wire [1:0]  rresp;
  wire        rvalid;
  reg         rready = 1'b0;

  wire busy;
  wire image_start_pulse;
  wire image_end_pulse;
  wire pixel_start_pulse;
  wire frame_start_pulse;
  wire laser_trigger;
  wire adc_trigger;
  wire signed [15:0] galvo_x;
  wire signed [15:0] galvo_y;
  wire [255:0] meta_data;
  wire meta_valid;

  integer image_start_cnt = 0;
  integer image_end_cnt = 0;
  integer pixel_start_cnt = 0;
  integer frame_start_cnt = 0;
  integer adc_trigger_cnt = 0;
  integer meta_valid_cnt = 0;
  integer error_cnt = 0;

  axi_pam_image_acq_v1_0 dut (
    .overall_busy_pl(overall_busy_pl),
    .busy(busy),
    .image_start_pulse(image_start_pulse),
    .image_end_pulse(image_end_pulse),
    .pixel_start_pulse(pixel_start_pulse),
    .frame_start_pulse(frame_start_pulse),
    .laser_trigger(laser_trigger),
    .adc_trigger(adc_trigger),
    .galvo_x(galvo_x),
    .galvo_y(galvo_y),
    .meta_data(meta_data),
    .meta_valid(meta_valid),
    .s00_axi_aclk(clk),
    .s00_axi_aresetn(rst_n),
    .s00_axi_awaddr(awaddr),
    .s00_axi_awprot(awprot),
    .s00_axi_awvalid(awvalid),
    .s00_axi_awready(awready),
    .s00_axi_wdata(wdata),
    .s00_axi_wstrb(wstrb),
    .s00_axi_wvalid(wvalid),
    .s00_axi_wready(wready),
    .s00_axi_bresp(bresp),
    .s00_axi_bvalid(bvalid),
    .s00_axi_bready(bready),
    .s00_axi_araddr(araddr),
    .s00_axi_arprot(arprot),
    .s00_axi_arvalid(arvalid),
    .s00_axi_arready(arready),
    .s00_axi_rdata(rdata),
    .s00_axi_rresp(rresp),
    .s00_axi_rvalid(rvalid),
    .s00_axi_rready(rready)
  );

  always #5 clk = ~clk;

  always @(posedge clk) begin
    #1;
    if (image_start_pulse) image_start_cnt = image_start_cnt + 1;
    if (image_end_pulse) image_end_cnt = image_end_cnt + 1;
    if (pixel_start_pulse) pixel_start_cnt = pixel_start_cnt + 1;
    if (frame_start_pulse) frame_start_cnt = frame_start_cnt + 1;
    if (adc_trigger) adc_trigger_cnt = adc_trigger_cnt + 1;
    if (meta_valid) meta_valid_cnt = meta_valid_cnt + 1;
  end

  task axi_write;
    input [7:0] addr;
    input [31:0] data;
    begin
      @(negedge clk);
      awaddr = addr;
      wdata = data;
      awvalid = 1'b1;
      wvalid = 1'b1;
      bready = 1'b1;
      wait (awready && wready);
      @(negedge clk);
      awvalid = 1'b0;
      wvalid = 1'b0;
      wait (bvalid);
      @(negedge clk);
      bready = 1'b0;
    end
  endtask

  task check_equal;
    input [255:0] name;
    input integer actual;
    input integer expected;
    begin
      if (actual !== expected) begin
        $display("[ERROR] %0s actual=%0d expected=%0d", name, actual, expected);
        error_cnt = error_cnt + 1;
      end else begin
        $display("[OK] %0s=%0d", name, actual);
      end
    end
  endtask

  initial begin
    repeat (5) @(posedge clk);
    rst_n = 1'b1;
    repeat (2) @(posedge clk);

    axi_write(8'h04, 32'd100);       // X_START
    axi_write(8'h08, 32'd5);         // X_STEP
    axi_write(8'h0C, 32'd2);         // X_POINTS
    axi_write(8'h10, 32'd200);       // Y_START
    axi_write(8'h14, 32'd7);         // Y_STEP
    axi_write(8'h18, 32'd1);         // Y_POINTS
    axi_write(8'h1C, 32'd1);         // FRAME_NUMBER
    axi_write(8'h20, 32'hCAFE_BEEF); // TASK_ID
    axi_write(8'h24, 32'd6);         // GAP_TIME
    axi_write(8'h28, 32'd2);         // GALVO_SETTLE_TIME
    axi_write(8'h2C, 32'd1);         // LD_TRIGGER_TIME
    axi_write(8'h30, 32'd3);         // ADC_TRIGGER_TIME
    axi_write(8'h34, 32'd2);         // LD_TIME
    axi_write(8'h38, 32'd0);         // SCAN_MODE

    axi_write(8'h00, 32'd1);
    axi_write(8'h00, 32'd0);

    wait (image_end_pulse == 1'b1);
    repeat (4) @(posedge clk);

    check_equal("image_start_cnt", image_start_cnt, 1);
    check_equal("image_end_cnt", image_end_cnt, 1);
    check_equal("pixel_start_cnt", pixel_start_cnt, 2);
    check_equal("frame_start_cnt", frame_start_cnt, 2);
    check_equal("adc_trigger_cnt", adc_trigger_cnt, 2);
    check_equal("meta_valid_cnt", meta_valid_cnt, 2);

    if (error_cnt == 0) begin
      $display("TEST PASSED");
    end else begin
      $display("TEST FAILED error_cnt=%0d", error_cnt);
    end
    $finish;
  end

  initial begin
    #200000;
    $display("[ERROR] Simulation timeout");
    $finish;
  end
endmodule
```

- [ ] **Step 2: Run compile-only verification**

Run:

```bash
cd /home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/IPs/ip_repo/axi_pam_image_acq_1_0
xvlog -sv hdl/pam_image_acq_controller_core.v hdl/axi_pam_image_acq_v1_0_S00_AXI.v hdl/axi_pam_image_acq_v1_0.v tb/tb_axi_pam_image_acq_compile.sv
```

Expected: `xvlog` exits with code 0 and no syntax errors.

- [ ] **Step 3: Elaborate and simulate the testbench**

Run:

```bash
cd /home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/IPs/ip_repo/axi_pam_image_acq_1_0
xelab tb_axi_pam_image_acq_compile -s tb_axi_pam_image_acq_compile
xsim tb_axi_pam_image_acq_compile -runall
```

Expected: simulation output includes `TEST PASSED`.

---

### Task 4: Package the New IP

**Files:**
- Create: `/home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/IPs/ip_repo/axi_pam_image_acq_1_0/scripts/package_axi_pam_image_acq.tcl`
- Generate: `/home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/IPs/ip_repo/axi_pam_image_acq_1_0/component.xml`

- [ ] **Step 1: Create the Vivado packaging script**

Create `/home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/IPs/ip_repo/axi_pam_image_acq_1_0/scripts/package_axi_pam_image_acq.tcl` with this content:

```tcl
set script_dir [file dirname [file normalize [info script]]]
set ip_root [file normalize [file join $script_dir ..]]
set work_dir [file join $ip_root .vivado_packaging]
set part_name xck26-sfvc784-2LV-c

file delete -force $work_dir
file mkdir $work_dir

create_project -force axi_pam_image_acq_pkg $work_dir -part $part_name
set_property target_language Verilog [current_project]

add_files -norecurse [list \
  [file join $ip_root hdl pam_image_acq_controller_core.v] \
  [file join $ip_root hdl axi_pam_image_acq_v1_0_S00_AXI.v] \
  [file join $ip_root hdl axi_pam_image_acq_v1_0.v] \
]
set_property top axi_pam_image_acq_v1_0 [current_fileset]
update_compile_order -fileset sources_1

ipx::package_project -root_dir $ip_root -vendor user.org -library user -taxonomy /UserIP -import_files -force
set core [ipx::current_core]

set_property name axi_pam_image_acq $core
set_property display_name {AXI PAM Image Acquisition} $core
set_property description {AXI-Lite PAM parameter registers merged with image acquisition controller} $core
set_property vendor_display_name {user.org} $core
set_property version 1.0 $core
set_property core_revision 1 $core
set_property supported_families {zynquplus Production} $core

ipx::infer_bus_interface s00_axi_aclk xilinx.com:signal:clock_rtl:1.0 $core
ipx::infer_bus_interface s00_axi_aresetn xilinx.com:signal:reset_rtl:1.0 $core
ipx::infer_bus_interface S00_AXI xilinx.com:interface:aximm_rtl:1.0 $core

set_property value 32 [ipx::get_bus_parameters WIZ_DATA_WIDTH -of_objects [ipx::get_bus_interfaces S00_AXI -of_objects $core]]
set_property value 64 [ipx::get_bus_parameters WIZ_NUM_REG -of_objects [ipx::get_bus_interfaces S00_AXI -of_objects $core]]

ipx::associate_bus_interfaces -busif S00_AXI -clock s00_axi_aclk $core
ipx::associate_bus_interfaces -clock s00_axi_aclk -reset s00_axi_aresetn $core

set_property value 8 [ipx::get_user_parameters C_S00_AXI_ADDR_WIDTH -of_objects $core]
set_property value 32 [ipx::get_user_parameters C_S00_AXI_DATA_WIDTH -of_objects $core]

ipx::update_checksums $core
ipx::check_integrity -quiet $core
ipx::save_core $core

close_project
puts "Packaged AXI PAM Image Acquisition IP at $ip_root"
```

- [ ] **Step 2: Run the packaging script**

Run:

```bash
/opt/pkg/Xilinx/Vivado/2023.2/bin/vivado -mode batch -source /home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/IPs/ip_repo/axi_pam_image_acq_1_0/scripts/package_axi_pam_image_acq.tcl
```

Expected: Vivado exits with code 0 and prints `Packaged AXI PAM Image Acquisition IP`.

- [ ] **Step 3: Validate generated metadata**

Run:

```bash
rg "axi_pam_image_acq|AXI PAM Image Acquisition|S00_AXI|overall_busy_pl|meta_data" /home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/IPs/ip_repo/axi_pam_image_acq_1_0/component.xml
```

Expected: matches include the IP name, display name, AXI interface, and runtime ports.

---

### Task 5: Create the Block Design Migration Script

**Files:**
- Create: `/home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/tools/replace_pam_image_acq_with_merged_ip.tcl`

- [ ] **Step 1: Create the tools directory**

Run:

```bash
mkdir -p /home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/tools
```

Expected: the `tools` directory exists.

- [ ] **Step 2: Write the BD migration script**

Create `/home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/tools/replace_pam_image_acq_with_merged_ip.tcl` with this content:

```tcl
set project_path /home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/hardware/xilinx-k26-som-2023.2/xilinx-k26-som-2023.2.xpr
set bd_path /home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/hardware/xilinx-k26-som-2023.2/xilinx-k26-som-2023.2.srcs/sources_1/bd/project_1/project_1.bd
set ip_repo /home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/IPs/ip_repo

open_project $project_path
set_property ip_repo_paths $ip_repo [current_project]
update_ip_catalog
open_bd_design $bd_path

if {[llength [get_bd_cells -quiet axi_pam_image_acq_0]] != 0} {
  error "axi_pam_image_acq_0 already exists; aborting to avoid double migration"
}

set axi_net [get_bd_intf_nets -of_objects [get_bd_intf_pins PAM_Parameters_0/S00_AXI]]
set clk_net [get_bd_nets -of_objects [get_bd_pins PAM_Parameters_0/s00_axi_aclk]]
set rst_net [get_bd_nets -of_objects [get_bd_pins PAM_Parameters_0/s00_axi_aresetn]]
set busy_net [get_bd_nets -quiet -of_objects [get_bd_pins image_acq_controller_0/busy]]
set image_start_net [get_bd_nets -quiet -of_objects [get_bd_pins image_acq_controller_0/image_start_pulse]]
set image_end_net [get_bd_nets -quiet -of_objects [get_bd_pins image_acq_controller_0/image_end_pulse]]
set pixel_start_net [get_bd_nets -quiet -of_objects [get_bd_pins image_acq_controller_0/pixel_start_pulse]]
set frame_start_net [get_bd_nets -quiet -of_objects [get_bd_pins image_acq_controller_0/frame_start_pulse]]
set laser_trigger_net [get_bd_nets -of_objects [get_bd_pins image_acq_controller_0/laser_trigger]]
set adc_trigger_net [get_bd_nets -of_objects [get_bd_pins image_acq_controller_0/adc_trigger]]
set galvo_x_net [get_bd_nets -of_objects [get_bd_pins image_acq_controller_0/galvo_x]]
set galvo_y_net [get_bd_nets -of_objects [get_bd_pins image_acq_controller_0/galvo_y]]
set meta_data_net [get_bd_nets -of_objects [get_bd_pins image_acq_controller_0/meta_data]]
set meta_valid_net [get_bd_nets -quiet -of_objects [get_bd_pins image_acq_controller_0/meta_valid]]
set overall_busy_net [get_bd_nets -of_objects [get_bd_pins image_acq_controller_0/overall_busy_pl]]

delete_bd_objs [get_bd_cells PAM_Parameters_0] [get_bd_cells image_acq_controller_0]

set merged [create_bd_cell -type ip -vlnv user.org:user:axi_pam_image_acq:1.0 axi_pam_image_acq_0]

connect_bd_intf_net $axi_net [get_bd_intf_pins $merged/S00_AXI]
connect_bd_net $clk_net [get_bd_pins $merged/s00_axi_aclk]
connect_bd_net $rst_net [get_bd_pins $merged/s00_axi_aresetn]
connect_bd_net $overall_busy_net [get_bd_pins $merged/overall_busy_pl]
connect_bd_net $laser_trigger_net [get_bd_pins $merged/laser_trigger]
connect_bd_net $adc_trigger_net [get_bd_pins $merged/adc_trigger]
connect_bd_net $galvo_x_net [get_bd_pins $merged/galvo_x]
connect_bd_net $galvo_y_net [get_bd_pins $merged/galvo_y]
connect_bd_net $meta_data_net [get_bd_pins $merged/meta_data]

if {$busy_net ne ""} { connect_bd_net $busy_net [get_bd_pins $merged/busy] }
if {$image_start_net ne ""} { connect_bd_net $image_start_net [get_bd_pins $merged/image_start_pulse] }
if {$image_end_net ne ""} { connect_bd_net $image_end_net [get_bd_pins $merged/image_end_pulse] }
if {$pixel_start_net ne ""} { connect_bd_net $pixel_start_net [get_bd_pins $merged/pixel_start_pulse] }
if {$frame_start_net ne ""} { connect_bd_net $frame_start_net [get_bd_pins $merged/frame_start_pulse] }
if {$meta_valid_net ne ""} { connect_bd_net $meta_valid_net [get_bd_pins $merged/meta_valid] }

assign_bd_address -offset 0xA0110000 -range 0x10000 [get_bd_addr_segs $merged/S00_AXI/S00_AXI_reg]

validate_bd_design
save_bd_design
close_project
puts "Replaced PAM_Parameters_0 and image_acq_controller_0 with axi_pam_image_acq_0"
```

- [ ] **Step 3: Run the migration script only after the new IP packages cleanly**

Run:

```bash
/opt/pkg/Xilinx/Vivado/2023.2/bin/vivado -mode batch -source /home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/tools/replace_pam_image_acq_with_merged_ip.tcl
```

Expected: Vivado exits with code 0 and prints `Replaced PAM_Parameters_0 and image_acq_controller_0 with axi_pam_image_acq_0`.

---

### Task 6: Verify the Migrated Project

**Files:**
- Inspect: `/home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/hardware/xilinx-k26-som-2023.2/xilinx-k26-som-2023.2.srcs/sources_1/bd/project_1/project_1.bd`
- Inspect: `/home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/pl_related/pl.dtsi` after hardware export is regenerated.
- Create: `/home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/tools/validate_project_1_bd.tcl`

- [ ] **Step 1: Confirm the old cells are gone and the new cell exists**

Run:

```bash
rg "axi_pam_image_acq_0|PAM_Parameters_0|image_acq_controller_0" /home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/hardware/xilinx-k26-som-2023.2/xilinx-k26-som-2023.2.srcs/sources_1/bd/project_1/project_1.bd
```

Expected: `axi_pam_image_acq_0` appears. `PAM_Parameters_0` and `image_acq_controller_0` do not appear as active cell names.

- [ ] **Step 2: Confirm the assigned base address remains unchanged**

Run:

```bash
rg "A0110000|axi_pam_image_acq_0|SEG_.*pam.*image.*acq" /home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/hardware/xilinx-k26-som-2023.2/xilinx-k26-som-2023.2.srcs/sources_1/bd/project_1/project_1.bd
```

Expected: the merged IP address segment uses `0x00A0110000` or equivalent Vivado JSON formatting.

- [ ] **Step 3: Create a repeatable Vivado block-design validation script**

Create `/home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/tools/validate_project_1_bd.tcl` with this content:

```tcl
set project_path /home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/hardware/xilinx-k26-som-2023.2/xilinx-k26-som-2023.2.xpr
set bd_path /home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/hardware/xilinx-k26-som-2023.2/xilinx-k26-som-2023.2.srcs/sources_1/bd/project_1/project_1.bd
set ip_repo /home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/IPs/ip_repo

open_project $project_path
set_property ip_repo_paths $ip_repo [current_project]
update_ip_catalog
open_bd_design $bd_path
validate_bd_design
save_bd_design
close_project
puts "Validated project_1 block design"
```

- [ ] **Step 4: Run Vivado block-design validation**

Run:

```bash
/opt/pkg/Xilinx/Vivado/2023.2/bin/vivado -mode batch -source /home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013/tools/validate_project_1_bd.tcl
```

Expected: Vivado exits with code 0 and prints `Validated project_1 block design`.

- [ ] **Step 5: Tell the user what changed and what remains**

Report:

```text
Created and packaged axi_pam_image_acq_1_0.
Replaced the two old BD blocks with axi_pam_image_acq_0.
Kept the PAM register base address at 0xA0110000.
The old PAM_Parameters_1_0 IP and original image_acq_controller.v remain available for rollback.
Full bitstream generation is still the final hardware validation step.
```
