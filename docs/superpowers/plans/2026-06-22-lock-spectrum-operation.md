# Lock Spectrum Operation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the Lock page into a scan monitoring workspace with nudge controls and a draggable spectrum threshold/crossing view.

**Architecture:** Add pure utility helpers for numeric nudging and level crossing detection. Extend PlotCanvas with optional threshold and crosshair rendering. Refactor LockPanel to include Spectrum Operation, Spectrum View, and existing Lock Parameters.

**Tech Stack:** React, TypeScript, Vitest, existing Tauri frontend.

---

### Task 1: Utility Helpers

**Files:**
- Create: `/home/qian/Portable_System_Project/Butterfly_Laser_Driver/tauri_control_console/src/utils/lockSpectrum.ts`
- Test: `/home/qian/Portable_System_Project/Butterfly_Laser_Driver/tauri_control_console/src/__tests__/lockSpectrum.test.ts`

- [ ] Add tests for level crossings and numeric nudging.
- [ ] Implement `findLevelCrossings` and `nudgeNumberText`.
- [ ] Run the focused test.

### Task 2: PlotCanvas Threshold Support

**Files:**
- Modify: `/home/qian/Portable_System_Project/Butterfly_Laser_Driver/tauri_control_console/src/components/PlotCanvas.tsx`
- Test: `/home/qian/Portable_System_Project/Butterfly_Laser_Driver/tauri_control_console/src/__tests__/plot.test.ts`

- [ ] Add optional threshold rendering.
- [ ] Add optional threshold drag callback.
- [ ] Add crosshair marker drawing from crossing points.

### Task 3: LockPanel Redesign

**Files:**
- Modify: `/home/qian/Portable_System_Project/Butterfly_Laser_Driver/tauri_control_console/src/components/LockPanel.tsx`
- Modify: `/home/qian/Portable_System_Project/Butterfly_Laser_Driver/tauri_control_console/src/styles.css`

- [ ] Add Monitoring On/Off behavior.
- [ ] Add active nudge controls for target temperature and scan current settings.
- [ ] Add keyboard left/right handling for the active control.
- [ ] Add spectrum view with draggable threshold and crossing markers.
- [ ] Keep existing lock parameters and actions.

### Task 4: Verification

**Files:**
- No new files.

- [ ] Run `npm test`.
- [ ] Run `npm run build`.
