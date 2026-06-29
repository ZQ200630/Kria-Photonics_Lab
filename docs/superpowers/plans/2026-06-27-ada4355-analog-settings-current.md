# ADA4355 Analog Settings Current Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a single Settings-controlled ADA4355 analog configuration path for Tz, analog low-pass, and current bias, then make ADA and PA displays use consistent current conversion settings.

**Architecture:** The server exposes a small sysfs-backed analog configuration API. Tauri reads and writes that API from Settings and only updates global Tz from server readback. ADA panels use existing unsigned conversion; PA image keeps signed-i16 voltage conversion but receives the same global Tz and current offset.

**Tech Stack:** Python `http.server`, sysfs file IO, React/TypeScript, Tauri Rust commands, Vitest, Cargo tests, pytest.

---

### Task 1: Server ADA4355 Analog Config API

**Files:**
- Modify: `butterfly_laser_server.py`
- Modify: `tests/test_tauri_server_defaults.py`

- [ ] **Step 1: Write failing pytest coverage**

Add tests that use a temporary sysfs directory:

```python
def test_ada4355_analog_config_read_write(tmp_path, monkeypatch):
    sysfs = tmp_path / "ada4355-gpio-ctrl"
    sysfs.mkdir()
    (sysfs / "gain_ohms").write_text("2000\n")
    (sysfs / "low_pass_enabled").write_text("0\n")
    monkeypatch.setenv("ADA4355_GPIO_CTRL_DIR", str(sysfs))

    import butterfly_laser_server as server

    analog = server.read_ada4355_analog_config()
    assert analog["available"] is True
    assert analog["gain_ohms"] == 2000
    assert analog["low_pass_enabled"] is False
    assert analog["low_pass_label"] == "100 MHz"

    analog = server.write_ada4355_analog_config({"gain_ohms": 20000, "low_pass_enabled": True})
    assert analog["gain_ohms"] == 20000
    assert analog["low_pass_enabled"] is True
    assert analog["low_pass_label"] == "1 MHz"
    assert (sysfs / "gain_ohms").read_text().strip() == "20000"
    assert (sysfs / "low_pass_enabled").read_text().strip() == "1"
```

Also add invalid value coverage:

```python
def test_ada4355_analog_config_rejects_invalid_gain(tmp_path, monkeypatch):
    sysfs = tmp_path / "ada4355-gpio-ctrl"
    sysfs.mkdir()
    (sysfs / "gain_ohms").write_text("2000\n")
    (sysfs / "low_pass_enabled").write_text("0\n")
    monkeypatch.setenv("ADA4355_GPIO_CTRL_DIR", str(sysfs))

    import butterfly_laser_server as server

    with pytest.raises(ValueError, match="gain_ohms"):
        server.write_ada4355_analog_config({"gain_ohms": 1234})
```

- [ ] **Step 2: Run failing tests**

Run:

```bash
pytest tests/test_tauri_server_defaults.py -k ada4355_analog_config -q
```

Expected: FAIL because `read_ada4355_analog_config` and `write_ada4355_analog_config` do not exist.

- [ ] **Step 3: Implement server helpers and endpoints**

Add constants and helpers to `butterfly_laser_server.py`:

```python
ADA4355_ALLOWED_GAIN_OHMS = (2000, 20000, 200000)
ADA4355_LOW_PASS_OPTIONS = (
    {"label": "1 MHz", "enabled": True},
    {"label": "100 MHz", "enabled": False},
)

def ada4355_gpio_ctrl_dir():
    return os.environ.get("ADA4355_GPIO_CTRL_DIR", "/sys/bus/platform/devices/ada4355-gpio-ctrl")

def read_ada4355_analog_config():
    sysfs_dir = ada4355_gpio_ctrl_dir()
    gain_path = os.path.join(sysfs_dir, "gain_ohms")
    low_pass_path = os.path.join(sysfs_dir, "low_pass_enabled")
    if not os.path.exists(gain_path) or not os.path.exists(low_pass_path):
        return {
            "available": False,
            "gain_ohms": None,
            "low_pass_enabled": None,
            "low_pass_label": None,
            "allowed_gain_ohms": list(ADA4355_ALLOWED_GAIN_OHMS),
            "allowed_low_pass": list(ADA4355_LOW_PASS_OPTIONS),
            "sysfs_dir": sysfs_dir,
            "error": "ADA4355 GPIO control sysfs files are not available",
        }
    gain_ohms = int(open(gain_path, "r", encoding="ascii").read().strip())
    low_pass_enabled = bool(int(open(low_pass_path, "r", encoding="ascii").read().strip()))
    return {
        "available": True,
        "gain_ohms": gain_ohms,
        "low_pass_enabled": low_pass_enabled,
        "low_pass_label": "1 MHz" if low_pass_enabled else "100 MHz",
        "allowed_gain_ohms": list(ADA4355_ALLOWED_GAIN_OHMS),
        "allowed_low_pass": list(ADA4355_LOW_PASS_OPTIONS),
        "sysfs_dir": sysfs_dir,
    }

def write_ada4355_analog_config(body):
    sysfs_dir = ada4355_gpio_ctrl_dir()
    if "gain_ohms" in body:
        gain_ohms = body_int(body, "gain_ohms")
        if gain_ohms not in ADA4355_ALLOWED_GAIN_OHMS:
            raise ValueError(f"gain_ohms must be one of {ADA4355_ALLOWED_GAIN_OHMS}")
        with open(os.path.join(sysfs_dir, "gain_ohms"), "w", encoding="ascii") as f:
            f.write(f"{gain_ohms}\n")
    if "low_pass_enabled" in body:
        enabled = bool_body(body, "low_pass_enabled")
        with open(os.path.join(sysfs_dir, "low_pass_enabled"), "w", encoding="ascii") as f:
            f.write("1\n" if enabled else "0\n")
    return read_ada4355_analog_config()
```

Add GET and POST routes:

```python
elif parsed.path == "/api/ada/analog-config":
    self.reply_json({"ok": True, "analog": read_ada4355_analog_config()})
```

```python
elif parsed.path == "/api/ada/analog-config":
    analog = write_ada4355_analog_config(body)
    self.reply_json({"ok": True, "analog": analog})
```

- [ ] **Step 4: Run pytest**

Run:

```bash
pytest tests/test_tauri_server_defaults.py -k ada4355_analog_config -q
```

Expected: PASS.

### Task 2: Tauri API Types and Client

**Files:**
- Modify: `tauri_control_console/src/api/types.ts`
- Modify: `tauri_control_console/src/api/client.ts`
- Modify: `tauri_control_console/src/__tests__/api.test.ts`

- [ ] **Step 1: Write failing API tests**

Add a mocked fetch test that validates endpoint names and shape:

```ts
it("reads ADA4355 analog config", async () => {
  const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify({ ok: true, analog: { available: true, gain_ohms: 2000, low_pass_enabled: false, low_pass_label: "100 MHz" } })),
  );
  const client = new ApiClient("http://server");
  const response = await client.adaAnalogConfig();
  expect(fetchMock).toHaveBeenCalledWith("http://server/api/ada/analog-config", expect.objectContaining({ signal: expect.any(AbortSignal) }));
  expect(response.analog.gain_ohms).toBe(2000);
});

it("writes ADA4355 analog config", async () => {
  const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify({ ok: true, analog: { available: true, gain_ohms: 20000, low_pass_enabled: true, low_pass_label: "1 MHz" } })),
  );
  const client = new ApiClient("http://server");
  const response = await client.setAdaAnalogConfig({ gain_ohms: 20000, low_pass_enabled: true });
  expect(fetchMock).toHaveBeenCalledWith(
    "http://server/api/ada/analog-config",
    expect.objectContaining({ method: "POST", body: JSON.stringify({ gain_ohms: 20000, low_pass_enabled: true }) }),
  );
  expect(response.analog.low_pass_label).toBe("1 MHz");
});
```

- [ ] **Step 2: Run failing tests**

Run:

```bash
cd tauri_control_console
npm test -- --run src/__tests__/api.test.ts
```

Expected: FAIL because client methods/types do not exist.

- [ ] **Step 3: Add TypeScript types and client methods**

Add `AdaAnalogConfig` and `AdaAnalogConfigUpdate`:

```ts
export type AdaAnalogConfig = {
  available: boolean;
  gain_ohms: number | null;
  low_pass_enabled: boolean | null;
  low_pass_label: string | null;
  allowed_gain_ohms?: number[];
  allowed_low_pass?: Array<{ label: string; enabled: boolean }>;
  sysfs_dir?: string;
  error?: string;
};

export type AdaAnalogConfigUpdate = {
  gain_ohms?: number;
  low_pass_enabled?: boolean;
};
```

Add methods to `ApiClient`:

```ts
adaAnalogConfig(): Promise<{ ok: true; analog: AdaAnalogConfig }> {
  return this.get("/api/ada/analog-config", { timeoutMs: 4_000 });
}

setAdaAnalogConfig(body: AdaAnalogConfigUpdate): Promise<{ ok: true; analog: AdaAnalogConfig }> {
  return this.post("/api/ada/analog-config", body, { timeoutMs: 4_000 });
}
```

- [ ] **Step 4: Run API tests**

Run:

```bash
cd tauri_control_console
npm test -- --run src/__tests__/api.test.ts
```

Expected: PASS.

### Task 3: Settings Owns Tz and Analog Low-Pass

**Files:**
- Modify: `tauri_control_console/src/App.tsx`
- Modify: `tauri_control_console/src/components/SettingsPanel.tsx`
- Modify: `tauri_control_console/src/components/AdaPanel.tsx`
- Modify: `tauri_control_console/src/components/SpectrumPanel.tsx`
- Modify: `tauri_control_console/src/components/LockPanel.tsx`
- Modify: `tauri_control_console/src/components/PaImagingPanel.tsx`
- Modify: `tauri_control_console/src/components/PaImageViewer.tsx`
- Modify: `tauri_control_console/src/components/types.ts`
- Modify: relevant layout tests under `tauri_control_console/src/__tests__/`

- [ ] **Step 1: Add or update layout tests**

Assert Settings contains analog controls and ADA/Lock/Spectrum do not expose local Tz inputs:

```ts
expect(settingsHtml).toContain("ADA4355 Gain / Tz");
expect(settingsHtml).toContain("2 kOhm");
expect(settingsHtml).toContain("20 kOhm");
expect(settingsHtml).toContain("200 kOhm");
expect(settingsHtml).toContain("Analog Low-pass");
expect(settingsHtml).toContain("1 MHz");
expect(settingsHtml).toContain("100 MHz");
expect(adaHtml).not.toContain("Tz Ohm");
expect(lockHtml).not.toContain("Tz Ohm");
expect(spectrumHtml).not.toContain("Tz Ohm");
```

- [ ] **Step 2: Run failing frontend layout tests**

Run:

```bash
cd tauri_control_console
npm test -- --run src/__tests__/adaPanelLayout.test.tsx src/__tests__/lockSpectrum.test.ts src/__tests__/appTabs.test.tsx
```

Expected: FAIL until Settings owns the controls and local inputs are removed.

- [ ] **Step 3: Implement global state flow**

In `App.tsx`, keep `tzOhmText` as global state, add analog config state, and pass:

```tsx
<SettingsPanel
  state={state}
  client={client}
  command={command}
  active={tab === "Settings"}
  tzOhm={tzOhm}
  tzOhmText={tzOhmText}
  setTzOhmText={setTzOhmText}
  pdCurrentOffsetMicroamp={pdCurrentOffsetMicroamp}
  pdCurrentOffsetText={pdCurrentOffsetText}
  setPdCurrentOffsetText={setPdCurrentOffsetText}
/>
```

Also pass `pdCurrentOffsetMicroamp` into PA imaging:

```tsx
<PaImagingPanel state={state} client={client} command={command} active={tab === "PA Imaging"} tzOhm={tzOhm} pdCurrentOffsetMicroamp={pdCurrentOffsetMicroamp} />
```

- [ ] **Step 4: Implement Settings analog controls**

Settings loads analog config on active load:

```tsx
const loadAnalogConfig = useCallback(async () => {
  const response = await client.adaAnalogConfig();
  setAnalog(response.analog);
  if (response.analog.available && response.analog.gain_ohms) {
    setTzOhmText?.(String(response.analog.gain_ohms));
  }
}, [client, setTzOhmText]);
```

Gain buttons call:

```tsx
const setAnalogGain = async (gain_ohms: number) => {
  const response = await client.setAdaAnalogConfig({ gain_ohms });
  setAnalog(response.analog);
  if (response.analog.available && response.analog.gain_ohms) {
    setTzOhmText?.(String(response.analog.gain_ohms));
  }
};
```

Low-pass buttons call:

```tsx
const setAnalogLowPass = async (low_pass_enabled: boolean) => {
  const response = await client.setAdaAnalogConfig({ low_pass_enabled });
  setAnalog(response.analog);
};
```

- [ ] **Step 5: Remove local Tz inputs from panels**

Delete the editable `Tz Ohm` input blocks from `AdaPanel.tsx`, `SpectrumPanel.tsx`, `LockPanel.tsx`, and `PaImageViewer.tsx`. Keep read-only text where useful:

```tsx
<div className="muted">Tz {tzOhm.toLocaleString()} ohm; current offset {pdCurrentOffsetMicroamp.toFixed(3)} uA from Settings</div>
```

- [ ] **Step 6: Run frontend tests**

Run:

```bash
cd tauri_control_console
npm test -- --run
```

Expected: PASS or only failures unrelated to this task.

### Task 4: PA Image Current Offset and Signed Conversion Consistency

**Files:**
- Modify: `tauri_control_console/src/utils/paImage.ts`
- Modify: `tauri_control_console/src/utils/paImageTauri.ts`
- Modify: `tauri_control_console/src/components/PaImageViewer.tsx`
- Modify: `tauri_control_console/src/components/PaImagingPanel.tsx`
- Modify: `tauri_control_console/src-tauri/src/pa_image.rs`
- Modify: `tauri_control_console/src-tauri/src/pa_stream.rs`
- Modify: `tauri_control_console/src-tauri/src/main.rs`
- Modify: `tauri_control_console/src/__tests__/paImage.test.ts`
- Modify: Rust tests inside `pa_image.rs`

- [ ] **Step 1: Write failing TS conversion test**

Add:

```ts
expect(signedAdcCodeToCurrentMicroamp(27034, 2000, 1, 0)).toBeCloseTo(0, 1);
expect(signedAdcCodeToCurrentMicroamp(27034, 2000, 1, -36)).toBeCloseTo(36, 1);
```

- [ ] **Step 2: Write failing Rust conversion test**

Add:

```rust
#[test]
fn signed_code_to_current_applies_offset() {
    let zero_like = signed_code_to_current_ua(27034, 2000.0, 1.0, 0.0);
    assert!(zero_like.abs() < 1.0);
    let offset = signed_code_to_current_ua(27034, 2000.0, 1.0, -36.0);
    assert!((offset - 36.0).abs() < 1.0);
}
```

- [ ] **Step 3: Run failing TS and Rust tests**

Run:

```bash
cd tauri_control_console
npm test -- --run src/__tests__/paImage.test.ts
cd src-tauri
cargo test signed_code_to_current_applies_offset -- --nocapture
```

Expected: FAIL because current offset is not accepted by PA conversion.

- [ ] **Step 4: Implement TS PA conversion config**

Update type and function:

```ts
export type PaImageProcessing = {
  sampleIntervalNs: number;
  sampleStartIndex: number;
  sampleEndTrim: number;
  baselineStartNs: number;
  baselineEndNs: number;
  ptpStartNs: number;
  ptpEndNs: number;
  tzOhm: number;
  vfs: number;
  currentOffsetMicroamp: number;
};

export function signedAdcCodeToCurrentMicroamp(code: number, tzOhm = 2000, vfs = 1, currentOffsetMicroamp = 0): number {
  const signed = Math.max(-32768, Math.min(32767, Math.round(code)));
  const vAdc = (signed / 32768) * vfs;
  return ((0.825 - vAdc) / Math.max(1, tzOhm)) * 1_000_000 - currentOffsetMicroamp;
}
```

- [ ] **Step 5: Implement Rust PA conversion config**

Add `current_offset_ua` to `PaImageProcessingConfig` and update:

```rust
pub fn signed_code_to_current_ua(code: i16, tz_ohm: f64, vfs: f64, current_offset_ua: f64) -> f64 {
    let v_adc = (code as f64) / 32768.0 * vfs;
    ((0.825 - v_adc) / tz_ohm) * 1_000_000.0 - current_offset_ua
}
```

Update all callers to pass `config.current_offset_ua` or the trace command argument.

- [ ] **Step 6: Update Tauri command signatures**

Change `readPaFrameTrace` to include current offset:

```ts
export const readPaFrameTrace = (path: string, frameIndex: number, tzOhm: number, vfs: number, currentOffsetMicroamp: number) =>
  invoke<PaFrameTrace>("pa_image_read_frame_path", { path, frameIndex, tzOhm, vfs, currentOffsetMicroamp });
```

Map processing config:

```ts
current_offset_ua: config.currentOffsetMicroamp,
```

- [ ] **Step 7: Run PA tests**

Run:

```bash
cd tauri_control_console
npm test -- --run src/__tests__/paImage.test.ts src/__tests__/paImageViewerLayout.test.tsx
cd src-tauri
cargo test pa_image -- --nocapture
```

Expected: PASS.

### Task 5: Full Verification

**Files:**
- No new files.

- [ ] **Step 1: Run Python tests**

Run:

```bash
pytest tests/test_tauri_server_defaults.py tests/test_ada4355_raw_buffer.py tests/test_pa_imaging_capture.py -q
```

Expected: PASS.

- [ ] **Step 2: Run frontend tests**

Run:

```bash
cd tauri_control_console
npm test -- --run
```

Expected: PASS.

- [ ] **Step 3: Run Rust tests**

Run:

```bash
cd tauri_control_console/src-tauri
cargo test -- --nocapture
```

Expected: PASS.

- [ ] **Step 4: Run static checks**

Run:

```bash
git diff --check
```

Expected: no output.

- [ ] **Step 5: Manual board check**

Use Settings to set:

- Tz `2 kOhm`, `20 kOhm`, `200 kOhm`, verifying sysfs readback each time.
- Low-pass `1 MHz` and `100 MHz`, verifying sysfs readback.
- PA image viewer trace readout confirms code around `27000` maps close to zero current before user offset.
