# Board-Matched Acquire Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the GUI/backend preparation layer for board-matched lock acquire without changing the existing direct lock path.

**Architecture:** Phase 1 creates code-domain template extraction in TypeScript, adds backend/API placeholders, and shows disabled GUI controls for `Board-Matched Acquire`. No HDL registers are changed in this phase, so existing direct lock, static output, fine scan, and lock parameter update behavior stays intact.

**Tech Stack:** React 18, TypeScript, Vitest, Python HTTP server.

---

### Task 1: Code-Domain Acquire Template Utility

**Files:**
- Create: `tauri_control_console/src/utils/acquireTemplate.ts`
- Test: `tauri_control_console/src/__tests__/acquireTemplate.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tauri_control_console/src/__tests__/acquireTemplate.test.ts` with tests for:

```ts
import { describe, expect, it } from "vitest";
import { buildAcquireTemplate } from "../utils/acquireTemplate";

describe("buildAcquireTemplate", () => {
  it("builds a causal CH1-code-domain template ending at the selected marker", () => {
    const template = buildAcquireTemplate({
      relativeValues: [100, 110, 120, 130, 140],
      crossing: { index: 3, leftIndex: 2, rightIndex: 3, value: 130 },
      ch1StartCode: 20000,
      ch1StopCode: 30000,
      lookbehindPoints: 3,
      searchHalfspanCode: 500,
    });

    expect(template.displayCount).toBe(5);
    expect(template.displayMarkerIndex).toBe(3);
    expect(template.markerCh1Code).toBe(27500);
    expect(template.targetAdc).toBe(65405);
    expect(template.points.map((point) => point.codeOffset)).toEqual([-5000, -2500, 0]);
    expect(template.points.map((point) => point.rawDelta)).toEqual([20, 10, 0]);
    expect(template.searchMinCode).toBe(27000);
    expect(template.searchMaxCode).toBe(28000);
  });

  it("keeps the template in CH1 code domain when sweep direction is reversed", () => {
    const template = buildAcquireTemplate({
      relativeValues: [100, 110, 120, 130, 140],
      crossing: { index: 3, leftIndex: 2, rightIndex: 3, value: 130 },
      ch1StartCode: 30000,
      ch1StopCode: 20000,
      lookbehindPoints: 3,
      searchHalfspanCode: 500,
    });

    expect(template.markerCh1Code).toBe(22500);
    expect(template.points.map((point) => point.codeOffset)).toEqual([5000, 2500, 0]);
  });
});
```

- [ ] **Step 2: Run failing tests**

Run:

```bash
cd tauri_control_console
PATH=/home/qian/.local/nodejs/bin:$PATH npm test -- src/__tests__/acquireTemplate.test.ts
```

Expected: FAIL because `../utils/acquireTemplate` does not exist.

- [ ] **Step 3: Implement utility**

Create `tauri_control_console/src/utils/acquireTemplate.ts` defining:

```ts
export type AcquireTemplatePoint = {
  codeOffset: number;
  rawDelta: number;
};

export type AcquireTemplate = {
  displayCount: number;
  displayMarkerIndex: number;
  markerCh1Code: number;
  targetAdc: number;
  polarityInvert: boolean;
  templateSpacingCode: number;
  searchMinCode: number;
  searchMaxCode: number;
  points: AcquireTemplatePoint[];
};

export function buildAcquireTemplate(args: {
  relativeValues: number[];
  crossing: LevelCrossing;
  ch1StartCode: number;
  ch1StopCode: number;
  lookbehindPoints: number;
  searchHalfspanCode: number;
}): AcquireTemplate
```

Implementation must use `scanCodeAtSpectrumIndex`, `relativeIntensityToRawAdc`, and `inferPolarityInvertForMarker` from `lockSpectrum.ts`.

- [ ] **Step 4: Run passing tests**

Run:

```bash
cd tauri_control_console
PATH=/home/qian/.local/nodejs/bin:$PATH npm test -- src/__tests__/acquireTemplate.test.ts
```

Expected: PASS.

### Task 2: API Placeholder Methods

**Files:**
- Modify: `tauri_control_console/src/api/client.ts`
- Modify: `tauri_control_console/src/__tests__/api.test.ts`
- Modify: `butterfly_laser_server.py`

- [ ] **Step 1: Write failing API client tests**

Add tests that `ApiClient.acquireTemplate(body)`, `ApiClient.acquireArm(body)`, and `ApiClient.acquireCancel()` post to:

```text
/api/laser/acquire-template
/api/laser/acquire-arm
/api/laser/acquire-cancel
```

- [ ] **Step 2: Implement client methods**

Add methods in `ApiClient` using existing `post()`.

- [ ] **Step 3: Add backend placeholders**

Add endpoints that return:

```json
{"ok": false, "error": "board-matched acquire is not supported by this bitstream yet"}
```

with HTTP 501 until HDL/register support exists. This makes GUI wiring explicit without pretending board support is present.

### Task 3: Lock Page Disabled Board-Matched Acquire Panel

**Files:**
- Modify: `tauri_control_console/src/components/LockPanel.tsx`
- Modify: `tauri_control_console/src/styles.css`

- [ ] **Step 1: Create selected template state**

When a highlighted marker is clicked, continue direct locking exactly as today for now, and also compute a selected acquire template with `buildAcquireTemplate`.

- [ ] **Step 2: Add disabled panel**

Add a `Board-Matched Acquire` card showing:

```text
Selected marker index
Marker CH1 code
Target ADC
Auto polarity
Template length
Template spacing code
Search range
Status: Waiting for HDL support
```

Buttons:

```text
Arm Board Match
Cancel Acquire
```

Both buttons remain disabled in Phase 1.

- [ ] **Step 3: Verify existing direct lock remains unchanged**

Run existing tests and build:

```bash
cd tauri_control_console
PATH=/home/qian/.local/nodejs/bin:$PATH npm test
PATH=/home/qian/.local/nodejs/bin:$PATH npm run build
```

Expected: all tests pass and build succeeds.

### Task 4: Commit Phase 1

**Files:**
- All modified Phase 1 files.

- [ ] **Step 1: Run final verification**

Run:

```bash
cd tauri_control_console
PATH=/home/qian/.local/nodejs/bin:$PATH npm test
PATH=/home/qian/.local/nodejs/bin:$PATH npm run build
cd ..
python3 -m py_compile butterfly_laser_server.py butterfly_laser_control.py butterfly_laser_server_tauri.py
```

- [ ] **Step 2: Commit**

```bash
git add .
git commit -m "Add board matched acquire phase 1 UI scaffolding"
```

