import { describe, expect, it, vi } from "vitest";
import { BackendEventStream } from "../api/events";

class MockEventSource {
  static last: MockEventSource | null = null;
  listeners = new Map<string, (event: MessageEvent) => void>();
  onerror: (() => void) | null = null;

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
    stream.close();
  });

  it("adds SSE rate options to the event stream URL", () => {
    vi.stubGlobal("EventSource", MockEventSource);
    const stream = new BackendEventStream("http://board:8080/", {
      statusHz: 50,
      spectrumHz: 5,
      spectrumPoints: 16384,
    });
    stream.connect();
    expect(MockEventSource.last?.url).toBe("http://board:8080/api/events?status_hz=50&spectrum_hz=5&spectrum_points=16384");
    stream.close();
  });
});
