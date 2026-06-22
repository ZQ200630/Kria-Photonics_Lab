# Tauri 2 Butterfly Laser Control Console Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a modern Tauri 2 desktop control console that connects to the K26 board, receives live telemetry through SSE, sends commands through HTTP, and keeps the existing browser GUI available as a fallback.

**Architecture:** Add a separate Python server, `butterfly_laser_server_tauri.py`, that reuses the existing `butterfly_laser_control.py` hardware layer and keeps the current HTTP API compatible while adding `/api/events`. Add a new `tauri_control_console/` app using Tauri 2, TypeScript, React, Vite, and canvas plots. The PL continues to perform all real-time TEC, scan, ADA4355 capture, and laser locking behavior.

**Tech Stack:** Python 3 standard library HTTP server, Server-Sent Events, Tauri 2, Rust stable, Node.js LTS, TypeScript, React, Vite, CSS, Canvas 2D.

---

## Source References

- Design spec: `docs/superpowers/specs/2026-06-20-tauri-control-console-design.md`
- Existing server: `butterfly_laser_server.py`
- Existing hardware/control layer: `butterfly_laser_control.py`
- Legacy fallback backup: `legacy_web_gui_2026-06-20/`
- Existing tests: `tests/test_panel_click_to_lock.py`
- Tauri 2 prerequisites: `https://v2.tauri.app/start/prerequisites/`
- Tauri 2 project creation: `https://v2.tauri.app/start/create-project/`

## File Structure

### Existing Files Kept Compatible

- `butterfly_laser_control.py`
  - Direct `/dev/mem` register access and typed controller helpers.
  - Do not rewrite hardware access in this plan.
- `butterfly_laser_server.py`
  - Existing browser server and legacy API implementation.
  - Keep usable. Small compatibility-safe imports are allowed only if tests prove the legacy server still works.
- `butterfly_laser_panel.html`
  - Existing browser GUI.
  - Do not redesign in this plan.

### New Backend Files

- `butterfly_laser_server_tauri.py`
  - New Tauri-oriented server.
  - Imports `ButterflyLaserSystem`, settings helpers, parsing helpers, and command behavior from existing Python code.
  - Adds `/api/events` SSE.
  - Uses `ThreadingHTTPServer`, `daemon_threads = True`, `block_on_close = False`, and explicit signal handling so Ctrl-C exits.
- `tests/test_tauri_server_sse.py`
  - Tests SSE formatting, spectrum-change keys, fault signatures, and handler helper behavior without real hardware.
- `tests/test_tauri_server_defaults.py`
  - Verifies the new server shares the same default settings and migration behavior as the legacy server.

### New Tauri Frontend Files

- `tauri_control_console/package.json`
  - Node scripts and dependencies.
- `tauri_control_console/index.html`
  - Vite entry HTML.
- `tauri_control_console/src/main.tsx`
  - React entry point.
- `tauri_control_console/src/App.tsx`
  - Top-level layout and route/tab state.
- `tauri_control_console/src/styles.css`
  - App styling.
- `tauri_control_console/src/api/client.ts`
  - HTTP command client and URL handling.
- `tauri_control_console/src/api/events.ts`
  - EventSource lifecycle wrapper.
- `tauri_control_console/src/api/types.ts`
  - Shared TypeScript payload types.
- `tauri_control_console/src/state/store.ts`
  - Lightweight React state reducer/context.
- `tauri_control_console/src/components/StatusBar.tsx`
  - Connection, emergency stop, stale-status warning, key readbacks.
- `tauri_control_console/src/components/TecPanel.tsx`
  - TEC controls, PID, protection, temperature trend.
- `tauri_control_console/src/components/LaserPanel.tsx`
  - Laser on/off, static setpoint, fine scan, protection.
- `tauri_control_console/src/components/SpectrumPanel.tsx`
  - Live spectrum plot, axis labels, click-to-lock field population, CSV export.
- `tauri_control_console/src/components/LockPanel.tsx`
  - Side-fringe lock controls and lock readback.
- `tauri_control_console/src/components/AdaPanel.tsx`
  - PD monitor ADC code, ADA filter config, raw snapshot.
- `tauri_control_console/src/components/SettingsPanel.tsx`
  - Load, save, apply, export settings.
- `tauri_control_console/src/components/DebugPanel.tsx`
  - Raw register read/write, JSON/event log.
- `tauri_control_console/src/components/PlotCanvas.tsx`
  - Reusable canvas plot component.
- `tauri_control_console/src/utils/format.ts`
  - Numeric formatting and current conversion helpers.
- `tauri_control_console/src/utils/csv.ts`
  - CSV generation helpers.
- `tauri_control_console/src/__tests__/api.test.ts`
  - API client tests with mocked fetch.
- `tauri_control_console/src/__tests__/events.test.ts`
  - SSE wrapper behavior tests using a mock EventSource.
- `tauri_control_console/src/__tests__/plot.test.ts`
  - Spectrum click-to-lock coordinate math tests.
- `tauri_control_console/src-tauri/Cargo.toml`
  - Tauri Rust package.
- `tauri_control_console/src-tauri/tauri.conf.json`
  - Tauri app config.
- `tauri_control_console/src-tauri/src/main.rs`
  - Minimal Tauri bootstrap.

---

## Task 1: Backend SSE Helper Tests

**Files:**
- Create: `tests/test_tauri_server_sse.py`
- Create: `tests/test_tauri_server_defaults.py`
- Read: `butterfly_laser_server.py`

- [ ] **Step 1: Add helper tests before implementation**

Create `tests/test_tauri_server_sse.py` with these tests:

```python
import json
import unittest

import butterfly_laser_server_tauri as server


class SseHelperTests(unittest.TestCase):
    def test_sse_event_encodes_event_name_and_json_payload(self):
        payload = {"ok": True, "value": 3}
        encoded = server.format_sse("status", payload)
        self.assertTrue(encoded.endswith("\n\n"))
        self.assertIn("event: status\n", encoded)
        data_line = next(line for line in encoded.splitlines() if line.startswith("data: "))
        self.assertEqual(json.loads(data_line[6:]), payload)

    def test_spectrum_key_uses_frame_buffer_and_count(self):
        first = {"frame_counter": 12, "buffer_id": 0, "count": 16384}
        same = {"frame_counter": 12, "buffer_id": 0, "count": 16384}
        next_frame = {"frame_counter": 13, "buffer_id": 0, "count": 16384}
        self.assertEqual(server.spectrum_key(first), server.spectrum_key(same))
        self.assertNotEqual(server.spectrum_key(first), server.spectrum_key(next_frame))

    def test_fault_signature_changes_on_laser_fault(self):
        clean = {
            "tec": {"status_hex": "0x00000000", "main_error_status_hex": "0x00000000"},
            "laser": {"status_hex": "0x00000000", "fault_status_hex": "0x00000000"},
            "ada4355": {"status_hex": "0x00000000"},
        }
        faulted = {
            "tec": {"status_hex": "0x00000000", "main_error_status_hex": "0x00000000"},
            "laser": {"status_hex": "0x00000000", "fault_status_hex": "0x00000004"},
            "ada4355": {"status_hex": "0x00000000"},
        }
        self.assertNotEqual(server.fault_signature(clean), server.fault_signature(faulted))


if __name__ == "__main__":
    unittest.main()
```

Create `tests/test_tauri_server_defaults.py` with this test:

```python
import unittest

import butterfly_laser_server as legacy
import butterfly_laser_server_tauri as tauri_server


class TauriServerDefaultsTests(unittest.TestCase):
    def test_tauri_server_reuses_legacy_defaults(self):
        self.assertIs(tauri_server.DEFAULT_SETTINGS, legacy.DEFAULT_SETTINGS)
        self.assertEqual(tauri_server.DEFAULT_SETTINGS["laser"]["lock"]["kp"], "0.5")
        self.assertEqual(tauri_server.DEFAULT_SETTINGS["laser"]["lock"]["ki"], "0.01")
        self.assertEqual(tauri_server.DEFAULT_SETTINGS["laser"]["lock"]["max_step"], "10")
        self.assertEqual(tauri_server.DEFAULT_SETTINGS["ada4355"]["lp_shift"], "13")


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run tests and confirm they fail because the new server does not exist yet**

Run:

```sh
python3 -m unittest tests.test_tauri_server_sse tests.test_tauri_server_defaults
```

Expected:

```text
ModuleNotFoundError: No module named 'butterfly_laser_server_tauri'
```

---

## Task 2: New Python Tauri Server With SSE

**Files:**
- Create: `butterfly_laser_server_tauri.py`
- Test: `tests/test_tauri_server_sse.py`
- Test: `tests/test_tauri_server_defaults.py`

- [ ] **Step 1: Implement import-compatible server helpers**

Create `butterfly_laser_server_tauri.py` with these top-level helpers and imports:

```python
#!/usr/bin/env python3
"""
Tauri/SSE HTTP JSON server for the Butterfly Laser Driver.

Run on the board:
  sudo python3 butterfly_laser_server_tauri.py --host 0.0.0.0 --port 8080

This server is intended for a trusted lab network. It exposes direct hardware
control and does not implement authentication.
"""

import json
import signal
import threading
import time
from http.server import ThreadingHTTPServer
from urllib.parse import urlparse

from butterfly_laser_control import ButterflyLaserSystem, parse_int
from butterfly_laser_server import (
    DEFAULT_ADA_BASE,
    DEFAULT_ADA_BUF0_BASE,
    DEFAULT_ADA_BUF1_BASE,
    DEFAULT_BUFFER_SPAN,
    DEFAULT_LASER_BASE,
    DEFAULT_SETTINGS,
    DEFAULT_SPAN,
    DEFAULT_TEC_BASE,
    ButterflyHandler,
    build_parser as build_legacy_parser,
    load_settings,
)


def format_sse(event, payload):
    data = json.dumps(payload, separators=(",", ":"), sort_keys=True)
    return f"event: {event}\ndata: {data}\n\n"


def spectrum_key(spectrum):
    return (
        int(spectrum.get("frame_counter", -1)),
        int(spectrum.get("buffer_id", -1)),
        int(spectrum.get("count", -1)),
    )


def fault_signature(status):
    tec = status.get("tec", {})
    laser = status.get("laser", {})
    ada = status.get("ada4355", {})
    return (
        tec.get("status_hex", ""),
        tec.get("main_error_status_hex", ""),
        laser.get("status_hex", ""),
        laser.get("fault_status_hex", ""),
        laser.get("lock", {}).get("status_hex", ""),
        ada.get("status_hex", ""),
        ada.get("read_status_hex", ""),
    )
```

- [ ] **Step 2: Add the SSE handler subclass**

Add this class to `butterfly_laser_server_tauri.py`:

```python
class ButterflyTauriHandler(ButterflyHandler):
    server_version = "ButterflyLaserTauriServer/1.0"

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/events":
            self.handle_events()
            return
        super().do_GET()

    def handle_events(self):
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "keep-alive")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.close_connection = True

        last_spectrum_key = None
        last_fault_signature = None
        last_heartbeat = 0.0

        while not self.server.stop_event.is_set():
            now = time.time()
            try:
                with self.server.lock:
                    status = self.server.system.status()
                self.write_event("status", {"timestamp": now, "status": status})

                current_fault_signature = fault_signature(status)
                if current_fault_signature != last_fault_signature:
                    last_fault_signature = current_fault_signature
                    self.write_event("fault", {"timestamp": now, "signature": current_fault_signature, "status": status})

                try:
                    with self.server.lock:
                        spectrum = self.server.system.ada.read_spectrum(
                            count=self.server.sse_spectrum_points,
                            release=True,
                        )
                except RuntimeError as exc:
                    if "no readable ADA4355 spectrum buffer" not in str(exc):
                        raise
                else:
                    current_spectrum_key = spectrum_key(spectrum)
                    if current_spectrum_key != last_spectrum_key:
                        last_spectrum_key = current_spectrum_key
                        self.write_event("spectrum", {"timestamp": now, "spectrum": spectrum})

                if now - last_heartbeat >= self.server.sse_heartbeat_interval:
                    last_heartbeat = now
                    self.write_event("heartbeat", {"timestamp": now})

                time.sleep(self.server.sse_status_interval)
            except (BrokenPipeError, ConnectionResetError):
                break
            except Exception as exc:
                try:
                    self.write_event("error", {"timestamp": time.time(), "error": str(exc)})
                except Exception:
                    pass
                time.sleep(self.server.sse_status_interval)

    def write_event(self, event, payload):
        data = format_sse(event, payload).encode("utf-8")
        self.wfile.write(data)
        self.wfile.flush()
```

- [ ] **Step 3: Add parser and server startup**

Add this parser and `main()` function:

```python
def build_parser():
    parser = build_legacy_parser()
    parser.description = "Tauri/SSE HTTP server for Butterfly Laser Driver"
    parser.add_argument("--sse-status-hz", type=float, default=10.0, help="SSE status event rate")
    parser.add_argument("--sse-heartbeat-s", type=float, default=2.0, help="SSE heartbeat interval")
    parser.add_argument("--sse-spectrum-points", type=int, default=16384, help="Max points per SSE spectrum event")
    return parser


def main():
    args = build_parser().parse_args()
    system = ButterflyLaserSystem(
        args.tec_base,
        args.laser_base,
        args.span,
        args.ada_base,
        args.ada_buf0_base,
        args.ada_buf1_base,
        args.buffer_span,
    )
    settings = load_settings(args.settings)
    httpd = ThreadingHTTPServer((args.host, args.port), ButterflyTauriHandler)
    httpd.system = system
    httpd.lock = threading.RLock()
    httpd.verbose = args.verbose
    httpd.settings = settings
    httpd.settings_path = args.settings
    httpd.stop_event = threading.Event()
    httpd.sse_status_interval = 1.0 / max(float(args.sse_status_hz), 0.1)
    httpd.sse_heartbeat_interval = max(float(args.sse_heartbeat_s), 0.2)
    httpd.sse_spectrum_points = max(1, min(int(args.sse_spectrum_points), 16384))
    httpd.daemon_threads = True
    httpd.block_on_close = False

    def request_stop(signum, _frame):
        name = signal.Signals(signum).name
        print(f"\n{name} received, shutting down Tauri server...", flush=True)
        httpd.stop_event.set()
        raise KeyboardInterrupt

    signal.signal(signal.SIGTERM, request_stop)
    signal.signal(signal.SIGINT, request_stop)

    print(
        f"Listening on http://{args.host}:{args.port} "
        f"tec=0x{parse_int(args.tec_base):08X} laser=0x{parse_int(args.laser_base):08X} "
        f"ada=0x{parse_int(args.ada_base):08X} settings={args.settings} sse=on",
        flush=True,
    )
    try:
        httpd.serve_forever(poll_interval=0.2)
    except KeyboardInterrupt:
        pass
    finally:
        httpd.stop_event.set()
        httpd.server_close()
        system.close()
        print("Tauri server stopped.", flush=True)


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Run backend tests**

Run:

```sh
python3 -m unittest tests.test_tauri_server_sse tests.test_tauri_server_defaults
python3 -m py_compile butterfly_laser_control.py butterfly_laser_server.py butterfly_laser_server_tauri.py
```

Expected:

```text
OK
```

---

## Task 3: Tauri Environment And Project Skeleton

**Files:**
- Create directory: `tauri_control_console/`
- Create: `tauri_control_console/package.json`
- Create: `tauri_control_console/index.html`
- Create: `tauri_control_console/tsconfig.json`
- Create: `tauri_control_console/vite.config.ts`
- Create: `tauri_control_console/src-tauri/Cargo.toml`
- Create: `tauri_control_console/src-tauri/tauri.conf.json`
- Create: `tauri_control_console/src-tauri/src/main.rs`

- [ ] **Step 1: Check local toolchain**

Run:

```sh
node -v
npm -v
rustc --version
cargo --version
```

Expected if already installed:

```text
node v20.x or newer
npm 10.x or newer
rustc 1.x stable
cargo 1.x stable
```

If missing, install Node.js LTS, Rust stable, and Linux Tauri prerequisites following the official Tauri 2 prerequisite page. On Debian/Ubuntu-like Linux, the relevant system packages are:

```sh
sudo apt update
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
```

Install Rust using `rustup` from the official Rust/Tauri instructions:

```sh
curl --proto '=https' --tlsv1.2 https://sh.rustup.rs -sSf | sh
```

Install Node.js LTS from `https://nodejs.org/`, then restart the shell and rerun the version checks.

- [ ] **Step 2: Create minimal package files manually**

Create `tauri_control_console/package.json`:

```json
{
  "name": "butterfly-laser-control-console",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview",
    "tauri": "tauri",
    "tauri:dev": "tauri dev",
    "tauri:build": "tauri build",
    "test": "vitest run"
  },
  "dependencies": {
    "@tauri-apps/api": "^2.0.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@tauri-apps/cli": "^2.0.0",
    "@types/react": "^18.3.3",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.1",
    "typescript": "^5.5.4",
    "vite": "^5.4.0",
    "vitest": "^2.0.5"
  }
}
```

Create `tauri_control_console/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Butterfly Laser Control</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

Create `tauri_control_console/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["DOM", "DOM.Iterable", "ES2020"],
    "allowJs": false,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "strict": true,
    "forceConsistentCasingInFileNames": true,
    "module": "ESNext",
    "moduleResolution": "Node",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx"
  },
  "include": ["src"],
  "references": []
}
```

Create `tauri_control_console/vite.config.ts`:

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    host: "127.0.0.1",
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
});
```

- [ ] **Step 3: Add minimal Tauri Rust shell**

Create `tauri_control_console/src-tauri/Cargo.toml`:

```toml
[package]
name = "butterfly_laser_control_console"
version = "0.1.0"
description = "Butterfly Laser Driver control console"
authors = ["Butterfly Laser Driver"]
edition = "2021"

[lib]
name = "butterfly_laser_control_console_lib"
crate-type = ["staticlib", "cdylib", "rlib"]

[build-dependencies]
tauri-build = { version = "2", features = [] }

[dependencies]
tauri = { version = "2", features = [] }
tauri-plugin-opener = "2"

[features]
custom-protocol = ["tauri/custom-protocol"]
```

Create `tauri_control_console/src-tauri/tauri.conf.json`:

```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "Butterfly Laser Control",
  "version": "0.1.0",
  "identifier": "com.butterfly-laser.control-console",
  "build": {
    "beforeDevCommand": "npm run dev",
    "devUrl": "http://127.0.0.1:1420",
    "beforeBuildCommand": "npm run build",
    "frontendDist": "../dist"
  },
  "app": {
    "windows": [
      {
        "title": "Butterfly Laser Control",
        "width": 1440,
        "height": 960,
        "minWidth": 1180,
        "minHeight": 760
      }
    ],
    "security": {
      "csp": null
    }
  },
  "bundle": {
    "active": true,
    "targets": "all",
    "icon": []
  }
}
```

Create `tauri_control_console/src-tauri/src/main.rs`:

```rust
fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .run(tauri::generate_context!())
        .expect("error while running Butterfly Laser Control");
}
```

- [ ] **Step 4: Install frontend dependencies**

Run:

```sh
cd tauri_control_console
npm install
```

Expected:

```text
added ... packages
```

---

## Task 4: TypeScript API, SSE, And State Core

**Files:**
- Create: `tauri_control_console/src/api/types.ts`
- Create: `tauri_control_console/src/api/client.ts`
- Create: `tauri_control_console/src/api/events.ts`
- Create: `tauri_control_console/src/state/store.ts`
- Create: `tauri_control_console/src/utils/format.ts`
- Test: `tauri_control_console/src/__tests__/api.test.ts`
- Test: `tauri_control_console/src/__tests__/events.test.ts`

- [ ] **Step 1: Define shared API types**

Create `tauri_control_console/src/api/types.ts` with these exported types:

```ts
export type ApiOk<T> = T & { ok: true };
export type ApiError = { ok: false; error: string };

export type TecStatus = {
  status_hex?: string;
  status_flags?: string[];
  main_error_status_hex?: string;
  error_flags?: string[];
  temp_measured_c?: number;
  temp_filtered_c?: number;
  target_c?: number;
  error_c?: number;
  active_dac_code?: number;
};

export type LaserStatus = {
  status_hex?: string;
  status_flags?: string[];
  fault_status_hex?: string;
  fault_flags?: string[];
  actual?: {
    ch0_internal?: number;
    ch1_internal?: number;
    ch0_current_mA?: number;
    ch1_current_mA?: number;
  };
  target?: {
    ch0_internal?: number;
    ch1_internal?: number;
    ch0_current_mA?: number;
    ch1_current_mA?: number;
  };
  fine_scan_setpoint?: {
    ch0_internal?: number;
    ch1_start_internal?: number;
    ch1_stop_internal?: number;
    ch0_current_mA?: number;
    ch1_start_current_mA?: number;
    ch1_stop_current_mA?: number;
  };
  lock?: Record<string, unknown>;
  last_fb_adc?: number;
};

export type AdaStatus = {
  status_hex?: string;
  status_flags?: string[];
  monitor_avg?: number;
  monitor_min?: number;
  monitor_max?: number;
  relative_intensity_code?: number;
  total_frame_counter?: number;
  read_frame_counter?: number;
  read_buffer_id?: number;
  read_points_written?: number;
  filter?: Record<string, unknown>;
  raw?: Record<string, unknown>;
};

export type SystemStatus = {
  tec: TecStatus;
  laser: LaserStatus;
  ada4355: AdaStatus;
};

export type Spectrum = {
  buffer_id: number;
  frame_counter: number;
  slow_index: number;
  count: number;
  duration_ms: number;
  dt_us_per_point: number;
  points: number[];
};

export type StatusEvent = { timestamp: number; status: SystemStatus };
export type SpectrumEvent = { timestamp: number; spectrum: Spectrum };
export type FaultEvent = { timestamp: number; signature: unknown[]; status: SystemStatus };
export type HeartbeatEvent = { timestamp: number };
```

- [ ] **Step 2: Implement HTTP client**

Create `tauri_control_console/src/api/client.ts`:

```ts
import type { ApiError, ApiOk, Spectrum, SystemStatus } from "./types";

export const DEFAULT_BACKEND_URL = "http://192.168.8.236:8080";

export class ApiClient {
  constructor(public baseUrl: string) {}

  url(path: string): string {
    return `${this.baseUrl.replace(/\/+$/, "")}${path}`;
  }

  async get<T>(path: string): Promise<T> {
    const response = await fetch(this.url(path));
    return this.parse<T>(response);
  }

  async post<T>(path: string, body: Record<string, unknown> = {}): Promise<T> {
    const response = await fetch(this.url(path), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return this.parse<T>(response);
  }

  async parse<T>(response: Response): Promise<T> {
    const payload = (await response.json()) as ApiOk<T> | ApiError;
    if (!response.ok || payload.ok === false) {
      throw new Error("error" in payload ? payload.error : `HTTP ${response.status}`);
    }
    return payload as T;
  }

  status(): Promise<{ ok: true; status: SystemStatus }> {
    return this.get("/api/status");
  }

  spectrum(points = 16384): Promise<{ ok: true; spectrum: Spectrum }> {
    return this.get(`/api/ada/spectrum?points=${encodeURIComponent(points)}&release=true`);
  }

  stopAll(): Promise<{ ok: true; status: SystemStatus }> {
    return this.post("/api/stop-all");
  }
}
```

- [ ] **Step 3: Implement SSE wrapper**

Create `tauri_control_console/src/api/events.ts`:

```ts
import type { FaultEvent, HeartbeatEvent, SpectrumEvent, StatusEvent } from "./types";

export type BackendEvents = {
  status: StatusEvent;
  spectrum: SpectrumEvent;
  fault: FaultEvent;
  heartbeat: HeartbeatEvent;
  error: { timestamp?: number; error: string };
};

type Handler<K extends keyof BackendEvents> = (payload: BackendEvents[K]) => void;

export class BackendEventStream {
  private source: EventSource | null = null;
  private handlers: { [K in keyof BackendEvents]?: Handler<K>[] } = {};

  constructor(private baseUrl: string) {}

  on<K extends keyof BackendEvents>(event: K, handler: Handler<K>): void {
    const list = (this.handlers[event] ?? []) as Handler<K>[];
    list.push(handler);
    this.handlers[event] = list as never;
  }

  connect(): void {
    this.close();
    this.source = new EventSource(`${this.baseUrl.replace(/\/+$/, "")}/api/events`);
    (["status", "spectrum", "fault", "heartbeat", "error"] as const).forEach((event) => {
      this.source?.addEventListener(event, (message) => {
        const payload = JSON.parse((message as MessageEvent).data);
        this.emit(event, payload);
      });
    });
  }

  close(): void {
    this.source?.close();
    this.source = null;
  }

  private emit<K extends keyof BackendEvents>(event: K, payload: BackendEvents[K]): void {
    for (const handler of this.handlers[event] ?? []) {
      (handler as Handler<K>)(payload);
    }
  }
}
```

- [ ] **Step 4: Add state reducer**

Create `tauri_control_console/src/state/store.ts`:

```ts
import type { Spectrum, SystemStatus } from "../api/types";

export type AppState = {
  backendUrl: string;
  connected: boolean;
  stale: boolean;
  lastStatus: SystemStatus | null;
  lastSpectrum: Spectrum | null;
  commandLog: string[];
  trend: Array<{ t: number; temp?: number; target?: number; error?: number; dac?: number; pd?: number }>;
};

export type AppAction =
  | { type: "connection"; connected: boolean }
  | { type: "status"; timestamp: number; status: SystemStatus }
  | { type: "spectrum"; spectrum: Spectrum }
  | { type: "log"; message: string }
  | { type: "stale"; stale: boolean }
  | { type: "backendUrl"; backendUrl: string };

export const initialState = (backendUrl: string): AppState => ({
  backendUrl,
  connected: false,
  stale: true,
  lastStatus: null,
  lastSpectrum: null,
  commandLog: [],
  trend: [],
});

export function reducer(state: AppState, action: AppAction): AppState {
  if (action.type === "connection") return { ...state, connected: action.connected };
  if (action.type === "stale") return { ...state, stale: action.stale };
  if (action.type === "backendUrl") return { ...state, backendUrl: action.backendUrl };
  if (action.type === "spectrum") return { ...state, lastSpectrum: action.spectrum };
  if (action.type === "log") return { ...state, commandLog: [action.message, ...state.commandLog].slice(0, 200) };
  if (action.type === "status") {
    const tec = action.status.tec;
    const ada = action.status.ada4355;
    const nextTrend = [
      ...state.trend,
      {
        t: action.timestamp,
        temp: tec.temp_filtered_c,
        target: tec.target_c,
        error: tec.error_c,
        dac: tec.active_dac_code,
        pd: ada.monitor_avg,
      },
    ].slice(-600);
    return { ...state, connected: true, stale: false, lastStatus: action.status, trend: nextTrend };
  }
  return state;
}
```

- [ ] **Step 5: Add formatting utilities**

Create `tauri_control_console/src/utils/format.ts`:

```ts
export function fmtNumber(value: unknown, digits = 3): string {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(digits) : "--";
}

export function fmtInt(value: unknown): string {
  return typeof value === "number" && Number.isFinite(value) ? String(Math.round(value)) : "--";
}

export function ch0CodeToMa(code: number): number {
  return (code / 65535) * 100.0;
}

export function ch1CodeToMa(code: number): number {
  return (code / 65535) * 10.0;
}
```

- [ ] **Step 6: Add API tests**

Create `tauri_control_console/src/__tests__/api.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { ApiClient, DEFAULT_BACKEND_URL } from "../api/client";

describe("ApiClient", () => {
  it("uses the K26 default backend URL", () => {
    expect(DEFAULT_BACKEND_URL).toBe("http://192.168.8.236:8080");
  });

  it("builds paths without double slashes", () => {
    const client = new ApiClient("http://192.168.8.236:8080/");
    expect(client.url("/api/status")).toBe("http://192.168.8.236:8080/api/status");
  });

  it("throws backend JSON errors", async () => {
    const client = new ApiClient("http://board");
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ ok: false, error: "bad command" }),
    } as Response);
    await expect(client.get("/api/status")).rejects.toThrow("bad command");
  });
});
```

Create `tauri_control_console/src/__tests__/events.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { BackendEventStream } from "../api/events";

class MockEventSource {
  static last: MockEventSource | null = null;
  listeners = new Map<string, (event: MessageEvent) => void>();
  constructor(public url: string) {
    MockEventSource.last = this;
  }
  addEventListener(name: string, cb: EventListener): void {
    this.listeners.set(name, cb as (event: MessageEvent) => void);
  }
  close = vi.fn();
  emit(name: string, payload: unknown): void {
    this.listeners.get(name)?.({ data: JSON.stringify(payload) } as MessageEvent);
  }
}

describe("BackendEventStream", () => {
  it("connects to /api/events and dispatches status payloads", () => {
    vi.stubGlobal("EventSource", MockEventSource);
    const stream = new BackendEventStream("http://board:8080/");
    const status = vi.fn();
    stream.on("status", status);
    stream.connect();
    expect(MockEventSource.last?.url).toBe("http://board:8080/api/events");
    MockEventSource.last?.emit("status", { timestamp: 1, status: { tec: {}, laser: {}, ada4355: {} } });
    expect(status).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 7: Run frontend tests**

Run:

```sh
cd tauri_control_console
npm test
```

Expected:

```text
Test Files 2 passed
```

---

## Task 5: Main App Layout And Control Panels

**Files:**
- Create: `tauri_control_console/src/main.tsx`
- Create: `tauri_control_console/src/App.tsx`
- Create: `tauri_control_console/src/styles.css`
- Create: `tauri_control_console/src/components/StatusBar.tsx`
- Create: `tauri_control_console/src/components/TecPanel.tsx`
- Create: `tauri_control_console/src/components/LaserPanel.tsx`
- Create: `tauri_control_console/src/components/LockPanel.tsx`
- Create: `tauri_control_console/src/components/AdaPanel.tsx`
- Create: `tauri_control_console/src/components/SettingsPanel.tsx`
- Create: `tauri_control_console/src/components/DebugPanel.tsx`

- [ ] **Step 1: Add React entry point**

Create `tauri_control_console/src/main.tsx`:

```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

- [ ] **Step 2: Implement top-level app wiring**

Create `tauri_control_console/src/App.tsx` with:

```tsx
import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { ApiClient, DEFAULT_BACKEND_URL } from "./api/client";
import { BackendEventStream } from "./api/events";
import { initialState, reducer } from "./state/store";
import StatusBar from "./components/StatusBar";
import TecPanel from "./components/TecPanel";
import LaserPanel from "./components/LaserPanel";
import SpectrumPanel from "./components/SpectrumPanel";
import LockPanel from "./components/LockPanel";
import AdaPanel from "./components/AdaPanel";
import SettingsPanel from "./components/SettingsPanel";
import DebugPanel from "./components/DebugPanel";

const tabs = ["Overview", "TEC", "Laser", "Spectrum", "Lock", "ADA", "Settings", "Debug"] as const;
type Tab = (typeof tabs)[number];

export default function App() {
  const savedUrl = localStorage.getItem("backendUrl") || DEFAULT_BACKEND_URL;
  const [state, dispatch] = useReducer(reducer, savedUrl, initialState);
  const [tab, setTab] = useState<Tab>("Overview");
  const client = useMemo(() => new ApiClient(state.backendUrl), [state.backendUrl]);
  const streamRef = useRef<BackendEventStream | null>(null);

  useEffect(() => {
    const stream = new BackendEventStream(state.backendUrl);
    stream.on("status", (payload) => dispatch({ type: "status", timestamp: payload.timestamp, status: payload.status }));
    stream.on("spectrum", (payload) => dispatch({ type: "spectrum", spectrum: payload.spectrum }));
    stream.on("fault", () => dispatch({ type: "log", message: "Fault state changed" }));
    stream.on("error", (payload) => dispatch({ type: "log", message: `SSE error: ${payload.error}` }));
    stream.connect();
    streamRef.current = stream;
    return () => stream.close();
  }, [state.backendUrl]);

  const command = async (label: string, action: () => Promise<unknown>) => {
    try {
      await action();
      dispatch({ type: "log", message: `${label}: ok` });
    } catch (error) {
      dispatch({ type: "log", message: `${label}: ${(error as Error).message}` });
    }
  };

  const setBackendUrl = (url: string) => {
    localStorage.setItem("backendUrl", url);
    dispatch({ type: "backendUrl", backendUrl: url });
  };

  return (
    <div className="app">
      <StatusBar state={state} client={client} command={command} setBackendUrl={setBackendUrl} />
      <nav className="tabs">
        {tabs.map((item) => (
          <button key={item} className={item === tab ? "active" : ""} onClick={() => setTab(item)}>
            {item}
          </button>
        ))}
      </nav>
      <main>
        {tab === "Overview" && (
          <div className="grid two">
            <TecPanel state={state} client={client} command={command} compact />
            <LaserPanel state={state} client={client} command={command} compact />
            <SpectrumPanel state={state} client={client} command={command} />
            <AdaPanel state={state} client={client} command={command} compact />
          </div>
        )}
        {tab === "TEC" && <TecPanel state={state} client={client} command={command} />}
        {tab === "Laser" && <LaserPanel state={state} client={client} command={command} />}
        {tab === "Spectrum" && <SpectrumPanel state={state} client={client} command={command} />}
        {tab === "Lock" && <LockPanel state={state} client={client} command={command} />}
        {tab === "ADA" && <AdaPanel state={state} client={client} command={command} />}
        {tab === "Settings" && <SettingsPanel state={state} client={client} command={command} />}
        {tab === "Debug" && <DebugPanel state={state} client={client} command={command} />}
      </main>
    </div>
  );
}
```

- [ ] **Step 3: Implement panels with explicit button semantics**

Each panel must use clear labels:

```text
Laser On
Laser Off
Set Static
Start Fine Scan
Stop Scan / Hold Start
Start Lock
Hold Current
Emergency Stop
```

For each command button, call `command(label, () => client.post(...))`. Use POST bodies matching `butterfly_laser_server.py` field names:

```ts
client.post("/api/laser/fine-scan", {
  ch0,
  start,
  stop,
  step,
  dwell,
  settle,
  frames,
  continuous,
  ch0_max,
  ch1_max,
});
```

Use default form values:

```ts
const defaults = {
  tecTarget: "31.0",
  tecTempMin: "20.0",
  tecTempMax: "40.0",
  tecIntegralLimit: "500000",
  laserCh0: "26000",
  scanStart: "20000",
  scanStop: "30000",
  scanStep: "10",
  scanDwell: "100",
  scanSettle: "100",
  scanFrames: "1",
  scanContinuous: true,
  ch0Max: "40000",
  ch1Max: "50000",
  lockKp: "0.5",
  lockKi: "0.01",
  lockMaxStep: "10",
  adaLpShift: "13",
};
```

- [ ] **Step 4: Add styling**

Create `tauri_control_console/src/styles.css` with a restrained instrument-console style:

```css
:root {
  font-family: Inter, Segoe UI, system-ui, sans-serif;
  color: #162033;
  background: #edf2f7;
}

body {
  margin: 0;
}

button, input, select {
  font: inherit;
}

.app {
  min-height: 100vh;
}

.status-bar {
  position: sticky;
  top: 0;
  z-index: 10;
  display: grid;
  grid-template-columns: 1fr auto auto;
  gap: 12px;
  align-items: center;
  padding: 12px 16px;
  background: #172235;
  color: white;
}

.tabs {
  display: flex;
  gap: 4px;
  padding: 10px 16px;
  background: #dbe4ee;
  border-bottom: 1px solid #c6d2df;
}

.tabs button, .command {
  min-height: 36px;
  border: 1px solid #9fb0c3;
  background: white;
  border-radius: 6px;
  padding: 0 12px;
  cursor: pointer;
}

.tabs button.active, .primary {
  color: white;
  background: #2563eb;
  border-color: #2563eb;
}

.danger {
  color: white;
  background: #dc2626;
  border-color: #dc2626;
}

main {
  padding: 16px;
}

.panel {
  background: white;
  border: 1px solid #cbd7e5;
  border-radius: 8px;
  padding: 14px;
  margin-bottom: 14px;
}

.grid {
  display: grid;
  gap: 14px;
}

.grid.two {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.fields {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 10px;
}

label {
  display: grid;
  gap: 4px;
  font-size: 12px;
  font-weight: 700;
  color: #53657a;
}

input, select {
  min-height: 34px;
  border: 1px solid #b8c6d8;
  border-radius: 5px;
  padding: 0 8px;
  color: #162033;
  background: white;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
}

.readouts {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 10px;
}

.readout {
  border: 1px solid #d5dfeb;
  background: #f8fafc;
  border-radius: 6px;
  padding: 10px;
}

.plot {
  width: 100%;
  height: 360px;
  border: 1px solid #ccd7e5;
  border-radius: 6px;
  background: white;
}

@media (max-width: 980px) {
  .grid.two {
    grid-template-columns: 1fr;
  }
}
```

- [ ] **Step 5: Run TypeScript build**

Run:

```sh
cd tauri_control_console
npm run build
```

Expected:

```text
vite build ... built
```

---

## Task 6: Canvas Plots, Spectrum Interaction, And CSV Export

**Files:**
- Create: `tauri_control_console/src/components/PlotCanvas.tsx`
- Modify: `tauri_control_console/src/components/SpectrumPanel.tsx`
- Modify: `tauri_control_console/src/components/TecPanel.tsx`
- Create: `tauri_control_console/src/utils/csv.ts`
- Test: `tauri_control_console/src/__tests__/plot.test.ts`

- [ ] **Step 1: Add plot coordinate tests**

Create `tauri_control_console/src/__tests__/plot.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { indexFromCanvasX } from "../components/PlotCanvas";

describe("indexFromCanvasX", () => {
  it("maps left edge to first point and right edge to last point", () => {
    expect(indexFromCanvasX(0, 100, 10)).toBe(0);
    expect(indexFromCanvasX(100, 100, 10)).toBe(9);
  });

  it("clamps out-of-range clicks", () => {
    expect(indexFromCanvasX(-50, 100, 10)).toBe(0);
    expect(indexFromCanvasX(150, 100, 10)).toBe(9);
  });
});
```

- [ ] **Step 2: Implement reusable canvas plot**

Create `tauri_control_console/src/components/PlotCanvas.tsx`:

```tsx
import { useEffect, useRef } from "react";

export function indexFromCanvasX(x: number, width: number, count: number): number {
  if (count <= 1 || width <= 0) return 0;
  const ratio = Math.max(0, Math.min(1, x / width));
  return Math.max(0, Math.min(count - 1, Math.round(ratio * (count - 1))));
}

type Props = {
  values: number[];
  color?: string;
  label?: string;
  xLabel?: string;
  height?: number;
  onPickIndex?: (index: number) => void;
};

export default function PlotCanvas({ values, color = "#7c3aed", label, xLabel, height = 360, onPickIndex }: Props) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const scale = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(rect.width * scale));
    canvas.height = Math.max(1, Math.floor(height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.clearRect(0, 0, rect.width, height);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, rect.width, height);
    ctx.strokeStyle = "#e2e8f0";
    ctx.lineWidth = 1;
    for (let i = 0; i <= 5; i += 1) {
      const y = 24 + ((height - 48) * i) / 5;
      ctx.beginPath();
      ctx.moveTo(48, y);
      ctx.lineTo(rect.width - 16, y);
      ctx.stroke();
    }
    if (values.length === 0) return;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = Math.max(1, max - min);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    values.forEach((value, index) => {
      const x = 48 + ((rect.width - 64) * index) / Math.max(1, values.length - 1);
      const y = 24 + (height - 48) * (1 - (value - min) / span);
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.fillStyle = "#64748b";
    ctx.font = "12px Segoe UI, sans-serif";
    ctx.fillText(String(max), 8, 28);
    ctx.fillText(String(min), 8, height - 14);
    if (label) ctx.fillText(label, rect.width - 150, 18);
    if (xLabel) ctx.fillText(xLabel, 48, height - 6);
  }, [values, color, label, xLabel, height]);

  return (
    <canvas
      ref={ref}
      className="plot"
      style={{ height }}
      onClick={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        const localX = event.clientX - rect.left - 48;
        const plotWidth = rect.width - 64;
        onPickIndex?.(indexFromCanvasX(localX, plotWidth, values.length));
      }}
    />
  );
}
```

- [ ] **Step 3: Spectrum panel shows relative intensity only**

In `SpectrumPanel.tsx`, compute:

```ts
const points = state.lastSpectrum?.points ?? [];
const relative = points.map((value) => Math.max(0, 0xffff - (value & 0xffff)));
```

Render only the `relative` line by default, and show x-axis text:

```ts
const duration = state.lastSpectrum?.duration_ms ?? 0;
const count = state.lastSpectrum?.count ?? 0;
const xLabel = count > 1
  ? `idx 0 / 0.000 ms    idx ${Math.floor((count - 1) / 2)} / ${(duration / 2).toFixed(3)} ms    idx ${count - 1} / ${duration.toFixed(3)} ms`
  : "no spectrum";
```

When the user clicks the plot, populate lock target fields:

```ts
function pickLockPoint(index: number) {
  const adc = points[index] & 0xffff;
  const ch1Start = Number(scanStart);
  const ch1Stop = Number(scanStop);
  const ratio = count > 1 ? index / (count - 1) : 0;
  const bias = Math.round(ch1Start + (ch1Stop - ch1Start) * ratio);
  setLockTarget(String(adc));
  setLockBias(String(bias));
}
```

- [ ] **Step 4: CSV helpers**

Create `tauri_control_console/src/utils/csv.ts`:

```ts
import type { Spectrum } from "../api/types";

export function spectrumCsv(spectrum: Spectrum): string {
  const lines = ["index,time_ms,adc_code,relative_intensity"];
  const dtMs = spectrum.count > 1 ? spectrum.duration_ms / (spectrum.count - 1) : 0;
  spectrum.points.forEach((word, index) => {
    const adc = word & 0xffff;
    lines.push(`${index},${(index * dtMs).toFixed(6)},${adc},${Math.max(0, 0xffff - adc)}`);
  });
  return `${lines.join("\n")}\n`;
}

export function downloadText(filename: string, text: string): void {
  const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
```

- [ ] **Step 5: Run tests and build**

Run:

```sh
cd tauri_control_console
npm test
npm run build
```

Expected:

```text
Test Files 3 passed
vite build ... built
```

---

## Task 7: Settings, Debug, And Backend Compatibility Checks

**Files:**
- Modify: `tauri_control_console/src/components/SettingsPanel.tsx`
- Modify: `tauri_control_console/src/components/DebugPanel.tsx`
- Modify: `tests/test_panel_click_to_lock.py`
- Test: `tests/test_tauri_server_defaults.py`

- [ ] **Step 1: Settings panel command behavior**

Implement Settings buttons using existing endpoints:

```ts
client.get("/api/settings");
client.post("/api/settings", { settings: currentSettingsObject });
client.post("/api/settings/apply");
```

The UI must display:

```text
Settings file path
Load Settings
Save Settings
Apply Saved Settings
Export Settings JSON
```

- [ ] **Step 2: Debug panel raw register access**

Implement raw read/write with the existing API:

```ts
client.get(`/api/read?block=${block}&offset=${offset}`);
client.post("/api/write", { block, offset, value });
```

The block selector must have exactly:

```text
tec
laser
ada
```

- [ ] **Step 3: Extend Python tests to ensure old GUI remains present**

Append this test to `tests/test_panel_click_to_lock.py`:

```python
class LegacyBackupTests(unittest.TestCase):
    def test_legacy_gui_backup_files_exist(self):
        backup = ROOT / "legacy_web_gui_2026-06-20"
        self.assertTrue((backup / "butterfly_laser_server.py").exists())
        self.assertTrue((backup / "butterfly_laser_control.py").exists())
        self.assertTrue((backup / "butterfly_laser_panel.html").exists())
```

- [ ] **Step 4: Run compatibility tests**

Run:

```sh
python3 -m unittest tests.test_panel_click_to_lock tests.test_tauri_server_defaults
python3 -m py_compile butterfly_laser_control.py butterfly_laser_server.py butterfly_laser_server_tauri.py
```

Expected:

```text
OK
```

---

## Task 8: Desktop Build And Hardware Smoke Test

**Files:**
- Read: `butterfly_laser_server_tauri.py`
- Read: `tauri_control_console/`

- [ ] **Step 1: Build frontend and Tauri shell**

Run:

```sh
cd tauri_control_console
npm run build
npm run tauri build
```

Expected:

```text
Finished release
```

- [ ] **Step 2: Start the new server on the K26 board**

On the board:

```sh
python3 butterfly_laser_server_tauri.py --host 0.0.0.0 --port 8080
```

Expected:

```text
Listening on http://0.0.0.0:8080 ... sse=on
```

- [ ] **Step 3: Verify Ctrl-C exits**

Press `Ctrl-C` in the terminal running `butterfly_laser_server_tauri.py`.

Expected:

```text
SIGINT received, shutting down Tauri server...
Tauri server stopped.
```

- [ ] **Step 4: Verify backend endpoints**

Run on the board or PC:

```sh
curl http://192.168.8.236:8080/api/status
curl http://192.168.8.236:8080/api/settings
curl http://192.168.8.236:8080/api/events
```

Expected:

```text
/api/status returns JSON with ok=true
/api/settings returns JSON with settings_schema_version=3
/api/events streams event: status and event: heartbeat
```

- [ ] **Step 5: Hardware GUI smoke test**

Open the Tauri app and verify:

```text
Backend URL defaults to http://192.168.8.236:8080
StatusBar changes to connected
TEC temperature updates at about 10 Hz
PD Monitor shows only ADC code
Start Fine Scan enters scan mode and does not toggle to off
Stop Scan / Hold Start stops scan and holds the start current
Latest Spectrum updates continuously while continuous scan is enabled
Spectrum x-axis shows index and time
Clicking a spectrum point populates lock target ADC and CH1 bias
Start Lock starts PL lock mode
Hold Current exits lock mode without forcing Laser Off
Emergency Stop disables laser output
```

---

## Task 9: Final Verification

**Files:**
- Read: all new files

- [ ] **Step 1: Run full Python verification**

Run:

```sh
python3 -m unittest discover -s tests -p 'test_*.py'
python3 -m py_compile butterfly_laser_control.py butterfly_laser_server.py butterfly_laser_server_tauri.py
```

Expected:

```text
OK
```

- [ ] **Step 2: Run full frontend verification**

Run:

```sh
cd tauri_control_console
npm test
npm run build
```

Expected:

```text
Test Files 3 passed
vite build ... built
```

- [ ] **Step 3: Document run commands for daily use**

Add this short section to `BUTTERFLY_LASER_DRIVER_MANUAL.md`:

```markdown
## Tauri Desktop Console

Start the Tauri/SSE backend on the K26 board:

```sh
python3 butterfly_laser_server_tauri.py --host 0.0.0.0 --port 8080
```

Open the desktop console and connect to:

```text
http://192.168.8.236:8080
```

The legacy browser GUI remains available through:

```sh
python3 butterfly_laser_server.py --host 0.0.0.0 --port 8080
```
```

- [ ] **Step 4: Check git availability**

Run:

```sh
git rev-parse --is-inside-work-tree
```

Expected in the current folder:

```text
fatal: not a git repository
```

Because this directory is not a git repository, do not run commit commands in this workspace. If the project is later moved into git, commit the new server, tests, Tauri app, and manual update together.

---

## Self-Review Checklist

- Spec coverage:
  - Scheme B preserved: new server and new Tauri folder, legacy files retained.
  - SSE specified and implemented through `/api/events`.
  - HTTP command compatibility covered by subclassing legacy handler.
  - GUI sections cover TEC, laser, spectrum, side-fringe lock, ADA, settings, debug.
  - Safety labels and emergency stop included.
  - Defaults match validated lab setup.
- Placeholder scan:
  - No open requirement is left without a concrete task.
  - No task relies on an undefined file path.
- Type consistency:
  - `SystemStatus`, `Spectrum`, and SSE payload names match backend JSON names.
  - Frontend command endpoints match existing `butterfly_laser_server.py` endpoint names.
- Scope:
  - This plan builds a PC-side GUI plus board-side SSE server.
  - It does not change PL logic, AD4170/ADA4355 RTL, or the current browser fallback.
