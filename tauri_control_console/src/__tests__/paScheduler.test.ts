import { describe, expect, it, vi } from "vitest";
import { ApiClient } from "../api/client";

describe("PA scheduler API client", () => {
  it("reads scheduler status", async () => {
    const client = new ApiClient("http://board");
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, scheduler: { mode_name: "idle" } }),
    } as Response);

    const response = await client.paSchedulerStatus();

    expect(globalThis.fetch).toHaveBeenCalledWith(
      "http://board/api/pa/scheduler/status",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(response.scheduler.mode_name).toBe("idle");
  });

  it("sends manual position without PA capture fields", async () => {
    const client = new ApiClient("http://board");
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, scheduler: { mode_name: "manual_galvo_hold" } }),
    } as Response);

    await client.paSchedulerManualPosition(12, -34);

    expect(globalThis.fetch).toHaveBeenCalledWith(
      "http://board/api/pa/scheduler/manual-position",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ x: 12, y: -34 }),
      }),
    );
  });

  it("formats scheduler config for point capture", async () => {
    const client = new ApiClient("http://board");
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, scheduler: { mode_name: "continuous_point_capture" } }),
    } as Response);

    await client.paSchedulerConfig({
      mode: 2,
      control: 15,
      period_cycles: 30000,
      manual_x: 100,
      manual_y: 200,
      shot_limit: 10,
    });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      "http://board/api/pa/scheduler/config",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          config: {
            mode: 2,
            control: 15,
            period_cycles: 30000,
            manual_x: 100,
            manual_y: 200,
            shot_limit: 10,
          },
        }),
      }),
    );
  });

  it("posts scheduler command, pulse, and waveform payloads", async () => {
    const client = new ApiClient("http://board");
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, scheduler: { mode_name: "manual_pulse_no_capture" } }),
    } as Response);

    await client.paSchedulerCommand(4);
    await client.paSchedulerPulse({ manual_x: 1, manual_y: 2, single: true });
    await client.paSchedulerWaveform({ waveform_x_min: -1, waveform_x_max: 1, waveform_x_step: 1 });

    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      1,
      "http://board/api/pa/scheduler/command",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ command: 4 }),
      }),
    );
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      2,
      "http://board/api/pa/scheduler/pulse",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ manual_x: 1, manual_y: 2, single: true }),
      }),
    );
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      3,
      "http://board/api/pa/scheduler/waveform",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ waveform_x_min: -1, waveform_x_max: 1, waveform_x_step: 1 }),
      }),
    );
  });
});
