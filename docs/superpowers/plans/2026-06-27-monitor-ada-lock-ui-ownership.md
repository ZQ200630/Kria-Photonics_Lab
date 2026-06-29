# Monitor ADA Lock UI Ownership Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `Overview` with a read-only `Monitor` page and move ADA4355/lock controls to their owning pages.

**Architecture:** Keep shared conversion state in `App`, but move visible controls to owning panels. Add a dedicated `MonitorPanel` for read-only temperature, PD, and spectrum monitoring. Reuse existing `PlotCanvas`, monitor samples, and ADA API helpers rather than changing server protocols.

**Tech Stack:** React/TypeScript, Vitest static markup tests, existing Tauri API client and plotting utilities.

---

### Task 1: Ownership Layout Tests

**Files:**
- Modify: `tauri_control_console/src/__tests__/appTabs.test.tsx`
- Modify: `tauri_control_console/src/__tests__/adaPanelLayout.test.tsx`
- Modify: `tauri_control_console/src/__tests__/lockPanelLayout.test.tsx`

- [ ] **Step 1: Write failing layout expectations**

Update tests to assert:

```ts
expect(html).toContain('data-tab="Monitor"');
expect(html).not.toContain('data-tab="Overview"');
expect(html).toContain("Temperature Monitor");
expect(html).toContain("PD Monitor");
expect(html).toContain("Spectrum Monitor");
expect(html).toContain("ADA4355 Gain / Tz");
expect(html).toContain("PD Current Offset uA");
expect(html).toContain("Analog Low-pass");
expect(html).toContain("Live/Spectrum LP Shift");
expect(html).not.toContain("Spectrum/Monitor LP Shift");
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
cd tauri_control_console
PATH=/home/qian/.local/nodejs/bin:$PATH npm test -- --run src/__tests__/appTabs.test.tsx src/__tests__/adaPanelLayout.test.tsx src/__tests__/lockPanelLayout.test.tsx
```

Expected: FAIL because `MonitorPanel` does not exist, `Overview` still exists, and controls are in old panels.

### Task 2: Monitor Panel

**Files:**
- Create: `tauri_control_console/src/components/MonitorPanel.tsx`
- Modify: `tauri_control_console/src/App.tsx`

- [ ] **Step 1: Create `MonitorPanel`**

Create a read-only panel with temperature, PD, and spectrum sections using `PlotCanvas`. It accepts `PanelProps`, `monitorSamplesRef`, `tzOhm`, and `pdCurrentOffsetMicroamp`.

- [ ] **Step 2: Replace `Overview` tab**

In `App.tsx`:

```ts
const tabs = ["Monitor", "TEC", "Laser", "Lock", "ADA", "PA Imaging", "Settings", "Debug"] as const;
const [tab, setTab] = useState<Tab>("Monitor");
```

Render `MonitorPanel` for the `Monitor` tab and stop rendering compact TEC/Laser/Spectrum/ADA panels in an overview grid.

- [ ] **Step 3: Run App layout test**

Run:

```bash
cd tauri_control_console
PATH=/home/qian/.local/nodejs/bin:$PATH npm test -- --run src/__tests__/appTabs.test.tsx
```

Expected: PASS.

### Task 3: Move ADA4355 Analog Controls to ADA

**Files:**
- Modify: `tauri_control_console/src/components/AdaPanel.tsx`
- Modify: `tauri_control_console/src/components/SettingsPanel.tsx`
- Modify: `tauri_control_console/src/App.tsx`
- Modify: `tauri_control_console/src/components/types.ts` if needed

- [ ] **Step 1: Move Settings analog UI into ADA**

Move the PD current offset input, ADA4355 gain segmented control, and analog low-pass segmented control from `SettingsPanel` into `AdaPanel`.

- [ ] **Step 2: Simplify Settings**

Remove analog state/effects from `SettingsPanel`; keep only settings file workflow and settings table.

- [ ] **Step 3: Run ADA/Settings layout tests**

Run:

```bash
cd tauri_control_console
PATH=/home/qian/.local/nodejs/bin:$PATH npm test -- --run src/__tests__/adaPanelLayout.test.tsx src/__tests__/appTabs.test.tsx
```

Expected: PASS.

### Task 4: Move Live/Spectrum LP Shift to Lock

**Files:**
- Modify: `tauri_control_console/src/components/AdaPanel.tsx`
- Modify: `tauri_control_console/src/components/LockPanel.tsx`

- [ ] **Step 1: Remove Spectrum/Monitor LP Shift from ADA**

Delete the visible `Spectrum/Monitor LP Shift` control from `AdaPanel`. Keep `Raw LP Shift`.

- [ ] **Step 2: Add Live/Spectrum LP Shift to Lock**

Add an input near `Spectrum View` that edits the existing ADA `lp_shift` value through `/api/ada/filter`, preserving `raw_lp_shift` and other filter settings.

- [ ] **Step 3: Run lock/ADA tests**

Run:

```bash
cd tauri_control_console
PATH=/home/qian/.local/nodejs/bin:$PATH npm test -- --run src/__tests__/adaPanelLayout.test.tsx src/__tests__/lockPanelLayout.test.tsx
```

Expected: PASS.

### Task 5: Verification

**Files:**
- No new files.

- [ ] **Step 1: Run frontend tests**

```bash
cd tauri_control_console
PATH=/home/qian/.local/nodejs/bin:$PATH npm test -- --run
```

Expected: PASS.

- [ ] **Step 2: Run frontend build**

```bash
cd tauri_control_console
PATH=/home/qian/.local/nodejs/bin:$PATH npm run build
```

Expected: PASS.

- [ ] **Step 3: Run Python unittest discovery**

```bash
python3 -m unittest discover tests
```

Expected: PASS.

- [ ] **Step 4: Run diff whitespace check**

```bash
git diff --check
```

Expected: no output.
