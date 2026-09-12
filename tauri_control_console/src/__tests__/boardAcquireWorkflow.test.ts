import { describe, expect, it, vi } from "vitest";
import { boardAcquireClickBlocked, boardAcquirePhaseLabel, runBoardAcquireWorkflow } from "../utils/boardAcquireWorkflow";

describe("runBoardAcquireWorkflow", () => {
  it("starts monitoring before uploading and arming when the scan is idle", async () => {
    const calls: string[] = [];

    await runBoardAcquireWorkflow({
      monitoringOn: false,
      startMonitoring: vi.fn(async () => {
        calls.push("monitor");
      }),
      uploadTemplate: vi.fn(async () => {
        calls.push("template");
      }),
      armAcquire: vi.fn(async () => {
        calls.push("arm");
      }),
    });

    expect(calls).toEqual(["monitor", "template", "arm"]);
  });

  it("does not restart an active scan and always arms last", async () => {
    const calls: string[] = [];
    const startMonitoring = vi.fn(async () => {
      calls.push("monitor");
    });

    await runBoardAcquireWorkflow({
      monitoringOn: true,
      startMonitoring,
      uploadTemplate: vi.fn(async () => {
        calls.push("template");
      }),
      armAcquire: vi.fn(async () => {
        calls.push("arm");
      }),
    });

    expect(startMonitoring).not.toHaveBeenCalled();
    expect(calls).toEqual(["template", "arm"]);
  });

  it("blocks only concurrent requests and lets an active board search be re-armed", () => {
    expect(boardAcquireClickBlocked({ requestInFlight: true, acquireActive: false })).toBe(true);
    expect(boardAcquireClickBlocked({ requestInFlight: false, acquireActive: true })).toBe(false);
    expect(boardAcquireClickBlocked({ requestInFlight: false, acquireActive: false })).toBe(false);
  });

  it("reports the board acquire phase from hardware status", () => {
    expect(boardAcquirePhaseLabel(undefined, false)).toBe("Unavailable");
    expect(boardAcquirePhaseLabel({ supported: true }, false)).toBe("Idle");
    expect(boardAcquirePhaseLabel({ supported: true, enabled: true }, false)).toBe("Armed");
    expect(boardAcquirePhaseLabel({ supported: true, enabled: true, active: true }, false)).toBe("Searching");
    expect(boardAcquirePhaseLabel({ supported: true, enabled: true, matched: true }, false)).toBe("Matched");
    expect(boardAcquirePhaseLabel({ supported: true, enabled: true, matched: true }, true)).toBe("Locked");
    expect(boardAcquirePhaseLabel({ supported: true, enabled: true, cancelled: true }, false)).toBe("Cancelled");
  });
});
