# Vivado Warning Cleanup Milestone

Created: 2026-06-26 18:08:39 America/Chicago

Original project:
- `/home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013`
- Vivado hardware project: `hardware/xilinx-k26-som-2023.2`

Snapshot contents:
- `hardware/xilinx-k26-som-2023.2/xilinx-k26-som-2023.2.srcs`
- `hardware/xilinx-k26-som-2023.2/rtl`
- `hardware/xilinx-k26-som-2023.2/drivers`
- `hardware/xilinx-k26-som-2023.2/sim`
- Top-level Vivado entry/artifact files: `.xpr`, `.xsa`, `.bit`, `README.hw`, `ip_upgrade.log`
- Original `synth_1/runme.log` and `impl_1/runme.log`
- Baseline warning-count summaries
- `hdl` submodule HEAD, status, diff stat, and full uncommitted diff

Not copied:
- `.runs`, `.cache`, `.tmp`, `.gen`, Petalinux build outputs, downloads, and other generated outputs.

Important initial state:
- `Demo1013` is not a top-level git repository.
- `Demo1013/hdl` is a git repository at `d146370c1 adrv9026/zcu102: Update build parameters`.
- `Demo1013/hdl` already had uncommitted changes in:
  - `library/xilinx/common/ad_serdes_in.v`
  - `scripts/adi_env.tcl`

Baseline warning categories:
- Synthesis: see `logs/synth_warning_counts.txt`
- Implementation: see `logs/impl_warning_counts.txt`

Final verification:
- Final Vivado run completed: `synth_1 synth_design Complete!`, `impl_1 write_bitstream Complete!`
- Final logs copied to `logs/synth_1_runme.final.log`, `logs/impl_1_runme.final.log`, and `logs/vivado.final.log`
- Final warning counts are in `logs/synth_warning_counts.final.txt` and `logs/impl_warning_counts.final.txt`
- Final generated reports are copied to `reports_final/`
- `logs/handled_warning_ids.final.txt` is intentionally empty: no handled warning IDs were emitted as warnings in the final fresh logs

Handled warning families:
- Removed duplicate IP repository entries from the Vivado project file.
- Patched the generated AXI Quad SPI XDC and DCP so the internal SCK register is no longer forced into IOB placement.
- Commented generated empty CDC waiver commands before implementation while preserving non-empty waiver commands.
- Suppressed the expected DCP checksum warning caused by the deliberate generated AXI Quad SPI DCP patch.

Remaining warnings requiring design decisions:
- Timing is still not met: WNS `-5.028ns`, TNS `-683.037ns`, 246 setup failing endpoints, and 2 pulse-width failing endpoints.
- Remaining synthesis warnings are generated/unconnected/width/constant-path warnings that need design intent before changing.
- Remaining implementation warnings are DSP pipeline, XPM CDC same-clock, BRAM advisory, debug/IP LUT, route/timing, power, and unsupported device-name warnings.
