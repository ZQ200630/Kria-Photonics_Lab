import type {
  AdaAnalogConfig,
  AdaAnalogConfigUpdate,
  ApiError,
  ApiOk,
  PaCaptureParams,
  PaCaptureStatus,
  PaDiagnostics,
  PaPointCaptureConfig,
  PaSchedulerConfig,
  PaSchedulerStatus,
  RawCapture,
  Spectrum,
  SystemStatus,
} from "./types";

export const DEFAULT_BACKEND_URL = "http://192.168.8.236:8080";
const DEFAULT_FETCH_TIMEOUT_MS = 12_000;

type FetchOptions = {
  signal?: AbortSignal;
  timeoutMs?: number;
};

const withTimeout = async <T>(
  request: (signal: AbortSignal) => Promise<T>,
  timeoutMs = DEFAULT_FETCH_TIMEOUT_MS,
): Promise<T> => {
  const controller = new AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await request(controller.signal);
  } finally {
    globalThis.clearTimeout(timer);
  }
};

const formatFetchError = (error: unknown, endpoint: string, timeoutMs: number): Error => {
  if (error instanceof Error && error.name === "AbortError") {
    return new Error(`Request to ${endpoint} timed out after ${timeoutMs}ms`);
  }
  return error instanceof Error ? error : new Error(`Request to ${endpoint} failed`);
};

const combineSignals = (primary: AbortSignal, secondary?: AbortSignal): AbortSignal => {
  if (!secondary) return primary;
  if (primary.aborted || secondary.aborted) {
    const controller = new AbortController();
    controller.abort();
    return controller.signal;
  }
  const controller = new AbortController();
  const abort = () => controller.abort();
  primary.addEventListener("abort", abort, { once: true });
  secondary.addEventListener("abort", abort, { once: true });
  return controller.signal;
};

export class ApiClient {
  constructor(public baseUrl: string) {}

  url(path: string): string {
    return `${this.baseUrl.replace(/\/+$/, "")}${path}`;
  }

  async get<T>(path: string, options: FetchOptions = {}): Promise<T> {
    const timeoutMs = options.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
    try {
      return await withTimeout(
        async (innerSignal) => {
          const response = await fetch(this.url(path), {
            signal: combineSignals(innerSignal, options.signal),
          });
          return this.parse<T>(response);
        },
        timeoutMs,
      );
    } catch (error) {
      throw formatFetchError(error, path, timeoutMs);
    }
  }

  async post<T>(path: string, body: Record<string, unknown> = {}, options: FetchOptions = {}): Promise<T> {
    const timeoutMs = options.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
    try {
      return await withTimeout(
        async (innerSignal) => {
          const response = await fetch(this.url(path), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            signal: combineSignals(innerSignal, options.signal),
          });
          return this.parse<T>(response);
        },
        timeoutMs,
      );
    } catch (error) {
      throw formatFetchError(error, path, timeoutMs);
    }
  }

  async parse<T>(response: Response): Promise<T> {
    const payload = (await response.json()) as ApiOk<T> | ApiError;
    if (!response.ok || payload.ok === false) {
      throw new Error("error" in payload ? payload.error : `HTTP ${response.status}`);
    }
    return payload as T;
  }

  status(): Promise<{ ok: true; status: SystemStatus }> {
    return this.get("/api/status", { timeoutMs: 4_000 });
  }

  settings(): Promise<{ ok: true; path: string; settings: Record<string, unknown> }> {
    return this.get("/api/settings", { timeoutMs: 4_000 });
  }

  spectrum(points = 16384): Promise<{ ok: true; spectrum: Spectrum }> {
    return this.get(`/api/ada/spectrum?points=${encodeURIComponent(points)}&release=true`, { timeoutMs: 8_000 });
  }

  rawCapture(length = 524288, decim = 1): Promise<{ ok: true; capture: Record<string, unknown>; raw: RawCapture }> {
    return this.post("/api/ada/raw-capture", { length, decim, timeout: 1.0 }, { timeoutMs: 15_000 });
  }

  adaAnalogConfig(): Promise<{ ok: true; analog: AdaAnalogConfig }> {
    return this.get("/api/ada/analog-config", { timeoutMs: 4_000 });
  }

  setAdaAnalogConfig(body: AdaAnalogConfigUpdate): Promise<{ ok: true; analog: AdaAnalogConfig }> {
    return this.post("/api/ada/analog-config", body, { timeoutMs: 4_000 });
  }

  laserLockParams(body: Record<string, unknown>): Promise<{ ok: true; laser?: unknown }> {
    return this.post("/api/laser/lock-params", body);
  }

  acquireTemplate(body: Record<string, unknown>): Promise<{ ok: true; laser?: unknown }> {
    return this.post("/api/laser/acquire-template", body);
  }

  acquireArm(body: Record<string, unknown>): Promise<{ ok: true; laser?: unknown }> {
    return this.post("/api/laser/acquire-arm", body);
  }

  acquireCancel(): Promise<{ ok: true; laser?: unknown }> {
    return this.post("/api/laser/acquire-cancel");
  }

  laserLockHold(): Promise<{ ok: true; laser?: unknown }> {
    return this.post("/api/laser/lock-hold");
  }

  stopAll(): Promise<{ ok: true; status: SystemStatus }> {
    return this.post("/api/stop-all");
  }

  paStatus(): Promise<{ ok: true; pa: PaCaptureStatus }> {
    return this.get("/api/pa/status", { timeoutMs: 4_000 });
  }

  paDiagnostics(): Promise<PaDiagnostics> {
    return this.get("/api/pa/diagnostics", { timeoutMs: 4_000 });
  }

  paStart(
    params: PaCaptureParams,
    maxBlocks = -1,
    captureTimeSec = 0,
    expectedFrames = 0,
    extraBody: Record<string, unknown> = {},
    timeoutMs = 12_000,
  ): Promise<{ ok: true; pa: PaCaptureStatus }> {
    return this.post<{ ok: true; pa: PaCaptureStatus }>(
      "/api/pa/start",
      {
        params,
        max_blocks: maxBlocks,
        capture_time_sec: captureTimeSec,
        expected_frames: expectedFrames,
        ...extraBody,
      },
      { timeoutMs },
    );
  }

  paPointStart(config: PaPointCaptureConfig, timeoutMs = 12_000): Promise<{ ok: true; pa: PaCaptureStatus }> {
    return this.post<{ ok: true; pa: PaCaptureStatus }>("/api/pa/point/start", { config }, { timeoutMs });
  }

  paStop(timeoutMs = 12_000, joinTimeoutMs?: number): Promise<{ ok: true; pa: PaCaptureStatus }> {
    return this.post(
      "/api/pa/stop",
      joinTimeoutMs != null ? { join_timeout_s: joinTimeoutMs / 1000 } : {},
      { timeoutMs },
    );
  }

  paDisconnect(timeoutMs = 12_000, joinTimeoutMs?: number): Promise<{ ok: true; pa: PaCaptureStatus }> {
    return this.post(
      "/api/pa/disconnect",
      joinTimeoutMs != null ? { join_timeout_s: joinTimeoutMs / 1000 } : {},
      { timeoutMs },
    );
  }

  paSchedulerStatus(): Promise<{ ok: true; scheduler: PaSchedulerStatus }> {
    return this.get("/api/pa/scheduler/status", { timeoutMs: 4_000 });
  }

  paSchedulerConfig(config: PaSchedulerConfig): Promise<{ ok: true; scheduler: PaSchedulerStatus }> {
    return this.post("/api/pa/scheduler/config", { config }, { timeoutMs: 8_000 });
  }

  paSchedulerCommand(command: number): Promise<{ ok: true; scheduler: PaSchedulerStatus }> {
    return this.post("/api/pa/scheduler/command", { command }, { timeoutMs: 8_000 });
  }

  paSchedulerManualPosition(x: number, y: number): Promise<{ ok: true; scheduler: PaSchedulerStatus }> {
    return this.post("/api/pa/scheduler/manual-position", { x, y }, { timeoutMs: 8_000 });
  }

  paSchedulerPulse(body: Record<string, unknown>): Promise<{ ok: true; scheduler: PaSchedulerStatus }> {
    return this.post("/api/pa/scheduler/pulse", body, { timeoutMs: 8_000 });
  }

  paSchedulerWaveform(body: Record<string, unknown>): Promise<{ ok: true; scheduler: PaSchedulerStatus }> {
    return this.post("/api/pa/scheduler/waveform", body, { timeoutMs: 8_000 });
  }
}
