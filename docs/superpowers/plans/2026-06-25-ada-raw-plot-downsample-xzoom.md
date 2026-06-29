# ADA Raw Plot Downsample And X Zoom Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the ADA Raw ADC plot responsive for large captures and add X-only drag zoom with right-click zoom restore.

**Architecture:** Keep full raw samples unchanged for CSV/export. Add a small raw-plot helper module that computes visible ranges, downsampled display points, and zoom Y ranges. Extend `PlotCanvas` with optional explicit X-domain point rendering and selection callbacks while preserving existing `values` behavior for Spectrum and Lock plots.

**Tech Stack:** React 18, TypeScript, Vite/Vitest, HTML canvas.

---

### Task 1: Raw Plot Helper Functions

**Files:**
- Create: `tauri_control_console/src/utils/rawPlot.ts`
- Test: `tauri_control_console/src/__tests__/rawPlot.test.ts`

- [ ] **Step 1: Write failing helper tests**

Create `tauri_control_console/src/__tests__/rawPlot.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  downsampleEnvelope,
  normalizeIndexRange,
  paddedRangeForValues,
  rawVisibleCurrentValues,
} from "../utils/rawPlot";

describe("raw plot helpers", () => {
  it("normalizes selected source index ranges", () => {
    expect(normalizeIndexRange(8, 2, 10)).toEqual({ startIndex: 2, endIndex: 8 });
    expect(normalizeIndexRange(-5, 20, 10)).toEqual({ startIndex: 0, endIndex: 9 });
    expect(normalizeIndexRange(4, 4, 10)).toEqual({ startIndex: 4, endIndex: 4 });
  });

  it("keeps all values when under the display limit", () => {
    expect(downsampleEnvelope([10, 20, 30], 8, 5)).toEqual([
      { xIndex: 5, value: 10 },
      { xIndex: 6, value: 20 },
      { xIndex: 7, value: 30 },
    ]);
  });

  it("preserves bucket minima and maxima when downsampling", () => {
    const points = downsampleEnvelope([1, 9, 2, 8, 3, 7, 4, 6], 4, 100);
    expect(points).toEqual([
      { xIndex: 100, value: 1 },
      { xIndex: 101, value: 9 },
      { xIndex: 104, value: 3 },
      { xIndex: 105, value: 7 },
    ]);
  });

  it("computes padded y range from selected visible values", () => {
    expect(paddedRangeForValues([10, 20, 30], 0.1)).toEqual({ min: 8, max: 32 });
    expect(paddedRangeForValues([12, 12], 0.1)).toEqual({ min: 11, max: 13 });
  });

  it("converts only selected raw ADC samples into current values", () => {
    const values = rawVisibleCurrentValues([0, 32768, 65535], { startIndex: 1, endIndex: 2 }, 10000, 0);
    expect(values).toHaveLength(2);
    expect(values[0]).not.toBe(values[1]);
  });
});
```

- [ ] **Step 2: Run helper tests and verify RED**

Run:

```bash
cd /home/qian/Portable_System_Project/Butterfly_Laser_Driver/tauri_control_console
env PATH=/home/qian/.local/nodejs/bin:$PATH npm test -- src/__tests__/rawPlot.test.ts
```

Expected: fail because `../utils/rawPlot` does not exist.

- [ ] **Step 3: Implement helper module**

Create `tauri_control_console/src/utils/rawPlot.ts`:

```ts
import { adcCodeToInputCurrentMicroamp } from "./ada4355";

export type SourceIndexRange = {
  startIndex: number;
  endIndex: number;
};

export type PlotPoint = {
  xIndex: number;
  value: number;
};

export function normalizeIndexRange(startIndex: number, endIndex: number, count: number): SourceIndexRange {
  const maxIndex = Math.max(0, count - 1);
  const first = Math.max(0, Math.min(maxIndex, Math.round(Math.min(startIndex, endIndex))));
  const last = Math.max(0, Math.min(maxIndex, Math.round(Math.max(startIndex, endIndex))));
  return { startIndex: first, endIndex: last };
}

export function rawVisibleCurrentValues(
  samples: number[],
  range: SourceIndexRange,
  tzOhm: number,
  currentOffsetMicroamp: number,
): number[] {
  const normalized = normalizeIndexRange(range.startIndex, range.endIndex, samples.length);
  const values: number[] = [];
  for (let index = normalized.startIndex; index <= normalized.endIndex; index += 1) {
    values.push(adcCodeToInputCurrentMicroamp(samples[index] & 0xffff, tzOhm, currentOffsetMicroamp));
  }
  return values;
}

export function paddedRangeForValues(values: number[], marginFraction = 0.1): { min: number; max: number } | undefined {
  const finite = values.filter((value) => Number.isFinite(value));
  if (finite.length === 0) return undefined;
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  const margin = max > min ? (max - min) * marginFraction : 1;
  return { min: min - margin, max: max + margin };
}

export function downsampleEnvelope(values: number[], maxPoints: number, startIndex = 0): PlotPoint[] {
  const limit = Math.max(1, Math.floor(maxPoints));
  if (values.length <= limit) {
    return values.map((value, index) => ({ xIndex: startIndex + index, value }));
  }

  const bucketCount = Math.max(1, Math.floor(limit / 2));
  const bucketSize = values.length / bucketCount;
  const points: PlotPoint[] = [];
  for (let bucket = 0; bucket < bucketCount; bucket += 1) {
    const bucketStart = Math.floor(bucket * bucketSize);
    const bucketEnd = Math.min(values.length, Math.floor((bucket + 1) * bucketSize));
    if (bucketEnd <= bucketStart) continue;

    let minIndex = bucketStart;
    let maxIndex = bucketStart;
    for (let index = bucketStart + 1; index < bucketEnd; index += 1) {
      if (values[index] < values[minIndex]) minIndex = index;
      if (values[index] > values[maxIndex]) maxIndex = index;
    }

    const ordered = minIndex <= maxIndex ? [minIndex, maxIndex] : [maxIndex, minIndex];
    ordered.forEach((index) => {
      const last = points[points.length - 1];
      const point = { xIndex: startIndex + index, value: values[index] };
      if (!last || last.xIndex !== point.xIndex || last.value !== point.value) points.push(point);
    });
  }
  return points;
}
```

- [ ] **Step 4: Run helper tests and verify GREEN**

Run:

```bash
env PATH=/home/qian/.local/nodejs/bin:$PATH npm test -- src/__tests__/rawPlot.test.ts
```

Expected: pass.

### Task 2: PlotCanvas Explicit X Domain And Selection

**Files:**
- Modify: `tauri_control_console/src/components/PlotCanvas.tsx`
- Test: `tauri_control_console/src/__tests__/plot.test.ts`

- [ ] **Step 1: Add failing PlotCanvas helper tests**

Extend `tauri_control_console/src/__tests__/plot.test.ts` imports with:

```ts
  indexFromCanvasXDomain,
```

Add tests:

```ts
  it("maps canvas x into a custom source index domain", () => {
    expect(indexFromCanvasXDomain(0, 100, { startIndex: 100, endIndex: 200 })).toBe(100);
    expect(indexFromCanvasXDomain(50, 100, { startIndex: 100, endIndex: 200 })).toBe(150);
    expect(indexFromCanvasXDomain(100, 100, { startIndex: 100, endIndex: 200 })).toBe(200);
  });

  it("clamps custom source index domain selections", () => {
    expect(indexFromCanvasXDomain(-10, 100, { startIndex: 100, endIndex: 200 })).toBe(100);
    expect(indexFromCanvasXDomain(120, 100, { startIndex: 100, endIndex: 200 })).toBe(200);
  });
```

- [ ] **Step 2: Run plot tests and verify RED**

Run:

```bash
env PATH=/home/qian/.local/nodejs/bin:$PATH npm test -- src/__tests__/plot.test.ts
```

Expected: fail because `indexFromCanvasXDomain` does not exist.

- [ ] **Step 3: Extend PlotCanvas types and helpers**

Add to `PlotCanvas.tsx`:

```ts
export type PlotXDomain = {
  startIndex: number;
  endIndex: number;
};

export type PlotPoint = {
  xIndex: number;
  value: number;
};

export function indexFromCanvasXDomain(x: number, width: number, domain: PlotXDomain): number {
  if (width <= 0) return Math.round(domain.startIndex);
  const ratio = Math.max(0, Math.min(1, x / width));
  return Math.round(domain.startIndex + ratio * (domain.endIndex - domain.startIndex));
}
```

Extend props:

```ts
  points?: PlotPoint[];
  xDomain?: PlotXDomain;
  selectionWindow?: { startIndex: number; endIndex: number; color?: string; borderColor?: string };
  onSelectionComplete?: (startIndex: number, endIndex: number) => void;
  onResetZoom?: () => void;
```

Update drawing so the primary series uses `points` when supplied:

```ts
const primaryPoints = points ?? values.map((value, index) => ({ xIndex: index, value }));
const domain = xDomain ?? { startIndex: 0, endIndex: Math.max(0, values.length - 1) };
```

The existing `values` path must keep working for all current callers.

- [ ] **Step 4: Add selection event plumbing**

Inside `PlotCanvas`, add refs/state:

```ts
const selectingX = useRef(false);
const selectionStartIndex = useRef<number | undefined>(undefined);
const [localSelectionWindow, setLocalSelectionWindow] = useState<{ startIndex: number; endIndex: number } | undefined>(undefined);
```

On left pointer down, when `onSelectionComplete` is present and threshold dragging is not active, capture the source index under the pointer and start selection.

On pointer move, update `localSelectionWindow`.

On pointer up, call `onSelectionComplete(start, end)` and clear selection.

On context menu, prevent default and call `onResetZoom`.

- [ ] **Step 5: Run plot tests and verify GREEN**

Run:

```bash
env PATH=/home/qian/.local/nodejs/bin:$PATH npm test -- src/__tests__/plot.test.ts
```

Expected: pass.

### Task 3: Wire ADA Raw Plot To Helpers

**Files:**
- Modify: `tauri_control_console/src/components/AdaPanel.tsx`
- Test: `tauri_control_console/src/__tests__/adaPanelLayout.test.tsx`

- [ ] **Step 1: Add a focused render expectation**

Extend `adaPanelLayout.test.tsx` so the static markup includes non-visible canvas accessibility/tooltip text:

```ts
expect(html).toContain("Raw ADC plot with X-only zoom");
expect(html).toContain("Left-drag to zoom X");
expect(html).toContain("right-click to restore");
```

- [ ] **Step 2: Run ADA layout test and verify RED**

Run:

```bash
env PATH=/home/qian/.local/nodejs/bin:$PATH npm test -- src/__tests__/adaPanelLayout.test.tsx
```

Expected: fail because the hint text is not present.

- [ ] **Step 3: Add raw plot state and display data**

In `AdaPanel.tsx`, import:

```ts
import type { SourceIndexRange } from "../utils/rawPlot";
import {
  downsampleEnvelope,
  normalizeIndexRange,
  paddedRangeForValues,
  rawVisibleCurrentValues,
} from "../utils/rawPlot";
```

Add constants and state:

```ts
const RAW_DISPLAY_POINT_LIMIT = 4096;
const [rawZoomRange, setRawZoomRange] = useState<SourceIndexRange | undefined>(undefined);
const [rawZoomHistory, setRawZoomHistory] = useState<SourceIndexRange[]>([]);
```

Compute visible range, visible current values, plotted points, and Y range:

```ts
const rawFullRange = rawValues.length > 0 ? { startIndex: 0, endIndex: rawValues.length - 1 } : { startIndex: 0, endIndex: 0 };
const rawVisibleRange = rawValues.length > 0 && rawZoomRange ? normalizeIndexRange(rawZoomRange.startIndex, rawZoomRange.endIndex, rawValues.length) : rawFullRange;
const visibleRawCurrentValues = useMemo(
  () => rawValues.length > 0 ? rawVisibleCurrentValues(rawValues, rawVisibleRange, tzOhm, pdCurrentOffsetMicroamp) : [],
  [pdCurrentOffsetMicroamp, rawValues, rawVisibleRange, tzOhm],
);
const rawPlotPoints = useMemo(
  () => downsampleEnvelope(visibleRawCurrentValues, RAW_DISPLAY_POINT_LIMIT, rawVisibleRange.startIndex),
  [visibleRawCurrentValues, rawVisibleRange.startIndex],
);
const rawZoomYRange = rawZoomRange ? paddedRangeForValues(visibleRawCurrentValues, 0.1) : undefined;
```

Use `rawZoomYRange ?? rawYRange` for the plot.

- [ ] **Step 4: Add zoom callbacks**

Add:

```ts
const zoomRawToRange = (startIndex: number, endIndex: number) => {
  if (rawValues.length < 2) return;
  const next = normalizeIndexRange(startIndex, endIndex, rawValues.length);
  if (next.endIndex - next.startIndex < 1) return;
  setRawZoomHistory((current) => [...current, rawVisibleRange]);
  setRawZoomRange(next);
};

const restoreRawZoom = () => {
  setRawZoomHistory((current) => {
    if (current.length === 0) {
      setRawZoomRange(undefined);
      return current;
    }
    const nextHistory = current.slice(0, -1);
    const previous = current[current.length - 1];
    setRawZoomRange(previous.startIndex === 0 && previous.endIndex === rawValues.length - 1 ? undefined : previous);
    return nextHistory;
  });
};
```

Clear zoom state when a new raw capture is stored.

- [ ] **Step 5: Pass raw plot props and hint text**

Use:

```tsx
<PlotCanvas
  values={visibleRawCurrentValues}
  points={rawPlotPoints}
  xDomain={rawVisibleRange}
  onSelectionComplete={zoomRawToRange}
  onResetZoom={restoreRawZoom}
  ...
/>
```

Add non-visible canvas accessibility/tooltip text through `PlotCanvas`:

```tsx
title="Left-drag to zoom X; right-click to restore."
ariaLabel="Raw ADC plot with X-only zoom"
```

- [ ] **Step 6: Run ADA layout test and verify GREEN**

Run:

```bash
env PATH=/home/qian/.local/nodejs/bin:$PATH npm test -- src/__tests__/adaPanelLayout.test.tsx
```

Expected: pass.

### Task 4: Full Verification

**Files:**
- No new files.

- [ ] **Step 1: Run focused frontend tests**

Run:

```bash
cd /home/qian/Portable_System_Project/Butterfly_Laser_Driver/tauri_control_console
env PATH=/home/qian/.local/nodejs/bin:$PATH npm test -- src/__tests__/rawPlot.test.ts src/__tests__/plot.test.ts src/__tests__/adaPanelLayout.test.tsx
```

Expected: all focused tests pass.

- [ ] **Step 2: Run all frontend tests**

Run:

```bash
env PATH=/home/qian/.local/nodejs/bin:$PATH npm test
```

Expected: all tests pass.

- [ ] **Step 3: Run frontend build**

Run:

```bash
env PATH=/home/qian/.local/nodejs/bin:$PATH npm run build
```

Expected: TypeScript and Vite build pass.

- [ ] **Step 4: Report changed files and behavior**

Summarize:

- Raw data is still stored/exported full resolution.
- ADA raw plot downsampled display data only.
- Left-drag zooms X.
- Right-click restores previous X zoom.
- Zoomed Y range is calculated from the selected full-resolution samples with 10 percent margin.
