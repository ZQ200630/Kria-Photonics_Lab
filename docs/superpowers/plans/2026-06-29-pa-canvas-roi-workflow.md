# PA Canvas ROI Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a persistent PA Canvas reference workflow with separate Idle, Zoom, and Fine Scan interactions.

**Architecture:** Keep scan-coordinate math in `tauri_control_console/src/utils/paImaging.ts`, keep canvas drawing and pointer behavior in `tauri_control_console/src/components/PaImageHeatmap.tsx`, and keep PA workflow state in `tauri_control_console/src/components/PaImagingPanel.tsx`. Canvas should persist until explicitly replaced or cleared; live/current image updates must not overwrite it.

**Tech Stack:** React, TypeScript, Vitest, canvas 2D rendering.

---

### Task 1: ROI Geometry Helpers

**Files:**
- Modify: `tauri_control_console/src/utils/paImaging.ts`
- Test: `tauri_control_console/src/__tests__/paImaging.test.ts`

- [ ] **Step 1: Write failing tests**

Add tests proving a fine-scan ROI converts to scan params using a requested step, and proving saved default scan params can be restored.

- [ ] **Step 2: Run focused tests**

Run: `PATH=/home/qian/.local/nodejs/bin:$PATH npm test -- paImaging.test.ts`

Expected: tests fail because the helper exports do not exist.

- [ ] **Step 3: Implement helpers**

Add typed helpers for:
- converting a `PaImageZoomDomain` on a reference image into start/step/points scan axes;
- serializing current scan params as the canvas default;
- restoring those params without touching timing.

- [ ] **Step 4: Run focused tests**

Run: `PATH=/home/qian/.local/nodejs/bin:$PATH npm test -- paImaging.test.ts`

Expected: tests pass.

### Task 2: Heatmap Interaction Modes

**Files:**
- Modify: `tauri_control_console/src/components/PaImageHeatmap.tsx`
- Test: `tauri_control_console/src/__tests__/paImageHeatmap.test.ts`

- [ ] **Step 1: Write failing tests**

Add tests for ROI rectangle aspect-ratio constraints and for preserving rectangle bounds inside the plotted image.

- [ ] **Step 2: Run focused tests**

Run: `PATH=/home/qian/.local/nodejs/bin:$PATH npm test -- paImageHeatmap.test.ts`

Expected: tests fail because the constrained rectangle helper does not exist.

- [ ] **Step 3: Implement heatmap props and drawing**

Add props for `interactionMode`, `roi`, `roiAspectRatio`, `onRoiChange`, and `onRoiCommit`. Draw persistent ROI overlays with handle markers, allow drag-to-create ROI in Zoom/Fine Scan modes, keep single-click pixel selection available in all modes, and keep right-click as zoom reset.

- [ ] **Step 4: Run focused tests**

Run: `PATH=/home/qian/.local/nodejs/bin:$PATH npm test -- paImageHeatmap.test.ts`

Expected: tests pass.

### Task 3: PA Imaging Panel Workflow

**Files:**
- Modify: `tauri_control_console/src/components/PaImagingPanel.tsx`
- Modify: `tauri_control_console/src/styles.css`
- Test: `tauri_control_console/src/__tests__/paImagingPanelLayout.test.tsx`

- [ ] **Step 1: Write failing layout tests**

Add tests asserting the capture page renders `Show Current`, `Show Canvas`, `Idle`, `Zoom`, `Fine Scan`, `Aspect`, `Fine Step`, `Apply ROI To Scan`, `To Default`, and `Save Default`.

- [ ] **Step 2: Run layout tests**

Run: `PATH=/home/qian/.local/nodejs/bin:$PATH npm test -- paImagingPanelLayout.test.tsx`

Expected: tests fail because the new controls are not rendered.

- [ ] **Step 3: Implement panel state**

Track `current/canvas` display mode, persistent canvas image, ROI interaction mode, ROI domain, ROI source, fine step, scan default params, and selected canvas pixel. `Set Current As Canvas` stores the current image as reference; new captures update only Current. `Apply ROI To Scan` updates scan settings and records that the fine scan came from Canvas. `Show Canvas` draws the linked fine-scan ROI only when it was produced from Canvas.

- [ ] **Step 4: Add styling**

Use compact segmented controls and small action rows. Avoid nested cards; keep controls close to the PA image.

- [ ] **Step 5: Run layout tests**

Run: `PATH=/home/qian/.local/nodejs/bin:$PATH npm test -- paImagingPanelLayout.test.tsx`

Expected: tests pass.

### Task 4: Full Verification

**Files:**
- No new files.

- [ ] **Step 1: Run all frontend tests**

Run: `PATH=/home/qian/.local/nodejs/bin:$PATH npm test`

Expected: all Vitest tests pass.

- [ ] **Step 2: Run production build**

Run: `PATH=/home/qian/.local/nodejs/bin:$PATH npm run build`

Expected: TypeScript and Vite build pass.
