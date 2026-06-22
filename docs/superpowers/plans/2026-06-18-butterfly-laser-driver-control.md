# Butterfly Laser Driver Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a complete usage manual and Python control layer for the Butterfly Laser Driver system.

**Architecture:** Keep the deliverables in `/home/qian/Portable_System_Project/Butterfly_Laser_Driver`. `butterfly_laser_control.py` owns local `/dev/mem` register access, conversions, CLI commands, and decoded status. `butterfly_laser_server.py` imports the control module and exposes a trusted-lab HTTP JSON API. `butterfly_laser_panel.html` is a lightweight browser panel for common operations.

**Tech Stack:** Python 3 standard library only (`argparse`, `mmap`, `http.server`, `json`, `threading`), AXI4-Lite register access through `/dev/mem`, Markdown documentation.

---

### Task 1: Unified Manual

**Files:**
- Create: `/home/qian/Portable_System_Project/Butterfly_Laser_Driver/BUTTERFLY_LASER_DRIVER_MANUAL.md`

- [ ] Document system architecture, fixed base addresses, TEC/AD4170 register map, laser current register map, status bits, fault bits, conversions, startup/shutdown workflows, CLI examples, HTTP API examples, and safety notes.

### Task 2: Python Control Library And CLI

**Files:**
- Create: `/home/qian/Portable_System_Project/Butterfly_Laser_Driver/butterfly_laser_control.py`

- [ ] Implement `AxiMap` for `/dev/mem` read/write.
- [ ] Implement `TecController` with init, closed-loop start, open-loop start, stop, clear fault, target temperature, and decoded status.
- [ ] Implement `LaserCurrentController` with static output, fine scan, stop, emergency stop, clear fault, decoded status, and code conversion.
- [ ] Implement `ButterflyLaserSystem` combining both controllers with `status`, `start-tec`, `laser-static`, `laser-fine-scan`, `stop-all`, and raw register access commands.
- [ ] Validate syntax with `python3 -m py_compile butterfly_laser_control.py`.

### Task 3: HTTP Remote Control Server

**Files:**
- Create: `/home/qian/Portable_System_Project/Butterfly_Laser_Driver/butterfly_laser_server.py`

- [ ] Expose JSON endpoints for full status, TEC control, laser static/fine scan control, stop-all, raw read, and raw write.
- [ ] Validate syntax with `python3 -m py_compile butterfly_laser_server.py`.

### Task 4: Browser Panel

**Files:**
- Create: `/home/qian/Portable_System_Project/Butterfly_Laser_Driver/butterfly_laser_panel.html`

- [ ] Provide a simple lab-use UI for status polling, TEC target/start/stop, laser static output, fine scan, stop-all, and raw register read/write.

### Task 5: Final Verification

- [ ] Run Python syntax checks for both Python files.
- [ ] List generated files.
- [ ] Provide board-side run commands and first-use sequence.
