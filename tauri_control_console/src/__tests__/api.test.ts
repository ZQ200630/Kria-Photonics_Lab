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

  it("requests 512K raw samples by default", async () => {
    const client = new ApiClient("http://127.0.0.1:8080");
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, capture: {}, raw: { samples: [] } }),
    } as Response);

    await client.rawCapture();

    expect(globalThis.fetch).toHaveBeenCalledWith(
      "http://127.0.0.1:8080/api/ada/raw-capture",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ length: 524288, decim: 1, timeout: 1.0 }),
      }),
    );
  });

  it("reads ADA4355 analog config", async () => {
    const client = new ApiClient("http://board");
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        analog: { available: true, gain_ohms: 2000, low_pass_enabled: false, low_pass_label: "100 MHz" },
      }),
    } as Response);

    const response = await client.adaAnalogConfig();

    expect(globalThis.fetch).toHaveBeenCalledWith(
      "http://board/api/ada/analog-config",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(response.analog.gain_ohms).toBe(2000);
    expect(response.analog.low_pass_label).toBe("100 MHz");
  });

  it("writes ADA4355 analog config", async () => {
    const client = new ApiClient("http://board");
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        analog: { available: true, gain_ohms: 20000, low_pass_enabled: true, low_pass_label: "1 MHz" },
      }),
    } as Response);

    const response = await client.setAdaAnalogConfig({ gain_ohms: 20000, low_pass_enabled: true });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      "http://board/api/ada/analog-config",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ gain_ohms: 20000, low_pass_enabled: true }),
      }),
    );
    expect(response.analog.gain_ohms).toBe(20000);
    expect(response.analog.low_pass_label).toBe("1 MHz");
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

  it("uses the request timeout even when an external signal is provided", async () => {
    vi.useFakeTimers();
    const client = new ApiClient("http://board");
    const external = new AbortController();
    globalThis.fetch = vi.fn((_url, init) => {
      const signal = (init as RequestInit).signal as AbortSignal;
      expect(signal).not.toBe(external.signal);
      return new Promise((_resolve, reject) => {
        signal.addEventListener(
          "abort",
          () => {
            const error = new Error("aborted");
            error.name = "AbortError";
            reject(error);
          },
          { once: true },
        );
      });
    }) as unknown as typeof fetch;

    try {
      const request = client.get("/api/status", { timeoutMs: 123, signal: external.signal });
      const assertion = expect(request).rejects.toThrow("Request to /api/status timed out after 123ms");
      await vi.advanceTimersByTimeAsync(123);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it("posts lock parameter updates without using the lock-start endpoint", async () => {
    const client = new ApiClient("http://board");
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    } as Response);

    await client.laserLockParams({ target_adc: 42000 });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      "http://board/api/laser/lock-params",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ target_adc: 42000 }),
      }),
    );
  });

  it("posts board-matched acquire template payloads", async () => {
    const client = new ApiClient("http://board");
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    } as Response);

    await client.acquireTemplate({ marker_ch1_code: 25000 });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      "http://board/api/laser/acquire-template",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ marker_ch1_code: 25000 }),
      }),
    );
  });

  it("posts board-matched acquire arm and cancel commands", async () => {
    const client = new ApiClient("http://board");
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    } as Response);

    await client.acquireArm({ frames: 1 });
    await client.acquireCancel();

    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      1,
      "http://board/api/laser/acquire-arm",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ frames: 1 }) }),
    );
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      2,
      "http://board/api/laser/acquire-cancel",
      expect.objectContaining({ method: "POST", body: JSON.stringify({}) }),
    );
  });

  it("posts laser lock hold command", async () => {
    const client = new ApiClient("http://board");
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    } as Response);

    await client.laserLockHold();

    expect(globalThis.fetch).toHaveBeenCalledWith(
      "http://board/api/laser/lock-hold",
      expect.objectContaining({ method: "POST", body: JSON.stringify({}) }),
    );
  });

  it("posts PA expected frames when starting PA imaging", async () => {
    const client = new ApiClient("http://board");
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, pa: { connected: true, running: true, last_error: "" } }),
    } as Response);

    await client.paStart({ x_points: 2, y_points: 3, frame_number: 4 }, -1, 0, 24);

    expect(globalThis.fetch).toHaveBeenCalledWith(
      "http://board/api/pa/start",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          params: { x_points: 2, y_points: 3, frame_number: 4 },
          max_blocks: -1,
          capture_time_sec: 0,
          expected_frames: 24,
        }),
      }),
    );
  });

  it("posts point capture settings to the point capture endpoint", async () => {
    const client = new ApiClient("http://board");
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, pa: { connected: true, running: true, last_error: "", expected_frames: 3000 } }),
    } as Response);

    await client.paPointStart(
      {
        manual_x: 12,
        manual_y: -34,
        period_cycles: 33333,
        shot_limit: 3000,
        pulse_enabled: true,
        capture_enabled: true,
        ld_delay_cycles: 200,
        ld_width_cycles: 400,
        adc_delay_cycles: 100,
        adc_width_cycles: 1,
      },
      6000,
    );

    expect(globalThis.fetch).toHaveBeenCalledWith(
      "http://board/api/pa/point/start",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          config: {
            manual_x: 12,
            manual_y: -34,
            period_cycles: 33333,
            shot_limit: 3000,
            pulse_enabled: true,
            capture_enabled: true,
            ld_delay_cycles: 200,
            ld_width_cycles: 400,
            adc_delay_cycles: 100,
            adc_width_cycles: 1,
          },
        }),
      }),
    );
  });
});
