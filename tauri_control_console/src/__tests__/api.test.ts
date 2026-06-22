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
});
