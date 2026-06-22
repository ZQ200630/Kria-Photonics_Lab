# Spectrum Overview CSV Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Simplify the Tauri Overview spectrum panel and add local current/continuous spectrum CSV export.

**Architecture:** Keep spectrum acquisition unchanged through existing SSE and `/api/ada/spectrum`. Move presentation and recording behavior into the Tauri frontend. Use a small pure utility module for CSV recording so tests cover frame de-duplication and refresh gating.

**Tech Stack:** React, TypeScript, Vitest, existing Tauri frontend utilities.

---

### Task 1: Spectrum Recording Utility

**Files:**
- Create: `/home/qian/Portable_System_Project/Butterfly_Laser_Driver/tauri_control_console/src/utils/spectrumRecording.ts`
- Test: `/home/qian/Portable_System_Project/Butterfly_Laser_Driver/tauri_control_console/src/__tests__/spectrumRecording.test.ts`

- [ ] Write tests for unique frame recording, refresh interval gating, and CSV output columns.
- [ ] Implement `createSpectrumRecordRows`, `appendSpectrumFrame`, and `recordedSpectrumCsv`.
- [ ] Run `npm test -- src/__tests__/spectrumRecording.test.ts`.

### Task 2: Simplify Spectrum Panel UI

**Files:**
- Modify: `/home/qian/Portable_System_Project/Butterfly_Laser_Driver/tauri_control_console/src/components/SpectrumPanel.tsx`
- Modify: `/home/qian/Portable_System_Project/Butterfly_Laser_Driver/tauri_control_console/src/styles.css`

- [ ] Remove header metadata cards for frame, duration, lock target ADC, and scan CH1 range.
- [ ] Move Y controls below the plot.
- [ ] Add current CSV export and recording controls.
- [ ] Use recording utility to record unique frames from live SSE state.

### Task 3: Remove Standalone Spectrum Page

**Files:**
- Modify: `/home/qian/Portable_System_Project/Butterfly_Laser_Driver/tauri_control_console/src/App.tsx`

- [ ] Remove the Spectrum tab.
- [ ] Keep the Overview Spectrum panel as the single spectrum UI entry point.

### Task 4: Verification

**Files:**
- No new files.

- [ ] Run `npm test`.
- [ ] Run `npm run build`.
- [ ] Report any limitations or commands that could not be run.
