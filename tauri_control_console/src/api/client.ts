import type { ApiError, ApiOk, RawCapture, Spectrum, SystemStatus } from "./types";

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

  settings(): Promise<{ ok: true; path: string; settings: Record<string, unknown> }> {
    return this.get("/api/settings");
  }

  spectrum(points = 16384): Promise<{ ok: true; spectrum: Spectrum }> {
    return this.get(`/api/ada/spectrum?points=${encodeURIComponent(points)}&release=true`);
  }

  rawCapture(length = 16384, decim = 1): Promise<{ ok: true; capture: Record<string, unknown>; raw: RawCapture }> {
    return this.post("/api/ada/raw-capture", { length, decim, timeout: 1.0 });
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

  stopAll(): Promise<{ ok: true; status: SystemStatus }> {
    return this.post("/api/stop-all");
  }
}
