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

  it("throws backend JSON errors", async () => {
    const client = new ApiClient("http://board");
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ ok: false, error: "bad command" }),
    } as Response);
    await expect(client.get("/api/status")).rejects.toThrow("bad command");
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
});
