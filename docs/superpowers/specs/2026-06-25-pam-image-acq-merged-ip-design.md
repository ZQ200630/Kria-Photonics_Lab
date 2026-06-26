# PAM Image Acquisition Merged IP Design

Date: 2026-06-25

## Goal

Merge the current `PAM_Parameters_v1.0` AXI-Lite register IP and the `image_acq_controller` module-ref into one packaged Vivado IP. The merged IP should remove the large bundle of parameter wires in the block design while preserving the existing software-visible register map at `0xA0110000`.

This design covers only the hardware IP merge. PA capture TCP streaming in the Python server and Tauri application will be designed and implemented separately after this hardware cleanup.

## Current State

The Vivado project currently has two separate blocks:

- `PAM_Parameters_0`
  - Packaged custom IP in `IPs/ip_repo/PAM_Parameters_1_0`.
  - AXI-Lite slave at `0xA0110000`.
  - Exposes parameter outputs such as `x_start_out`, `x_step_out`, `frame_number_out`, timing values, `start_out`, and `scan_mode`.

- `image_acq_controller_0`
  - Module reference from `hardware/xilinx-k26-som-2023.2/rtl/image_acq_controller.v`.
  - Samples the scan parameters on `start` rising edge.
  - Drives image timing outputs, galvo values, trigger pulses, and metadata.

Both blocks use the same PL clock and active-low reset. The current block design connects the parameter outputs from `PAM_Parameters_0` directly to `image_acq_controller_0`, creating a large and fragile wire bundle.

## Proposed IP

Create a new packaged IP named `axi_pam_image_acq_1_0`.

The top-level module will contain:

- An AXI-Lite register bank derived from the current `PAM_Parameters_v1_0_S00_AXI`.
- One instance of the existing `image_acq_controller`.
- Internal wires from the register bank to the controller.

The old `PAM_Parameters_1_0` IP and original `image_acq_controller.v` source should not be deleted. The new IP will reuse the controller source or a copied core file, so the old design remains available for rollback.

## External Interface

The merged IP exposes one AXI-Lite slave interface:

- `S00_AXI`
- `s00_axi_aclk`
- `s00_axi_aresetn`

It also exposes only the image acquisition runtime ports that connect to other PL logic:

- `overall_busy_pl`
- `busy`
- `image_start_pulse`
- `image_end_pulse`
- `pixel_start_pulse`
- `frame_start_pulse`
- `laser_trigger`
- `adc_trigger`
- `galvo_x[15:0]`
- `galvo_y[15:0]`
- `meta_data[255:0]`
- `meta_valid`

The scan parameter ports from `PAM_Parameters_0` are removed from the block design because they become internal to the merged IP.

## Register Map

The software-visible register map remains unchanged:

| Offset | Register | Width | Notes |
| --- | --- | --- | --- |
| `0x00` | `START` | bit 0 | Controller starts on rising edge. |
| `0x04` | `X_START` | 16-bit signed | Galvo X start coordinate. |
| `0x08` | `X_STEP` | 16-bit signed | Galvo X step. |
| `0x0C` | `X_POINTS` | 16-bit unsigned | Points per row. |
| `0x10` | `Y_START` | 16-bit signed | Galvo Y start coordinate. |
| `0x14` | `Y_STEP` | 16-bit signed | Galvo Y step. |
| `0x18` | `Y_POINTS` | 16-bit unsigned | Rows per image. |
| `0x1C` | `FRAME_NUMBER` | 16-bit unsigned | Frames per pixel. |
| `0x20` | `TASK_ID` | 32-bit | Metadata task id. |
| `0x24` | `GAP_TIME` | 32-bit | Frame slot minimum duration in PL clock cycles. |
| `0x28` | `GALVO_SETTLE_TIME` | 32-bit | Pixel settle delay in PL clock cycles. |
| `0x2C` | `LD_TRIGGER_TIME` | 32-bit | Laser trigger offset inside the frame slot. |
| `0x30` | `ADC_TRIGGER_TIME` | 32-bit | ADC trigger offset inside the frame slot. |
| `0x34` | `LD_TIME` | 32-bit | Laser trigger width. |
| `0x38` | `SCAN_MODE` | bit 0 | `0` flyback, `1` serpentine raster. |

Additional reserved registers can remain implemented but unused to preserve the current 8-bit AXI address width.

## Addressing

The merged IP should replace `PAM_Parameters_0` at `0xA0110000`. Keeping the same base address avoids changes in existing user-space code, including `axis-capture-app.c`, and avoids churn in the planned Python server PA capture integration.

The device tree compatible string may change to the new IP name when the hardware export is regenerated, but the register base and span should remain `0xA0110000` and `0x10000`.

## Block Design Migration

The block design should change from:

```text
PAM_Parameters_0 -> image_acq_controller_0 -> downstream PL
```

to:

```text
axi_pam_image_acq_0 -> downstream PL
```

The existing downstream connections should move from `image_acq_controller_0` to the merged IP outputs:

- frame/image/pixel pulses
- laser and ADC triggers
- galvo X/Y
- metadata
- busy

The existing upstream `overall_busy_pl` connection should move to the merged IP input.

## Implementation Notes

The wrapper should keep the controller's start semantics unchanged. The controller samples all scan parameters on `START` rising edge, so software should continue to write all parameter registers first, write `START=1`, then clear `START=0` when appropriate.

The signed 16-bit values must remain two's-complement bit-preserving paths from the AXI registers into `image_acq_controller`.

The first implementation should avoid changing scan behavior. Any later improvements, such as adding status readback or auto-clear start, should be separate changes.

## Verification

Before using the new IP in the full Vivado design:

1. Compile the merged RTL with `xvlog`.
2. Run or adapt the existing `tb_image_acq_controller.v` behavior test so the merged wrapper can drive the controller through AXI register writes.
3. Confirm the new IP package exposes the expected AXI interface and runtime ports in Vivado.
4. Replace the two old BD blocks with the merged IP and validate the block design.
5. Regenerate HDL wrapper and bitstream as the final hardware validation step.

## Rollback

The old `PAM_Parameters_1_0` IP directory and standalone `image_acq_controller.v` module-ref remain available. If the merged IP causes timing, packaging, or integration issues, the block design can be restored to the previous two-block structure using the current base address and original parameter-wire connections.

