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
  private handlers: Record<string, Array<(payload: unknown) => void>> = {};

  constructor(private baseUrl: string) {}

  on<K extends keyof BackendEvents>(event: K, handler: Handler<K>): void {
    const key = String(event);
    const list = this.handlers[key] ?? [];
    list.push(handler as (payload: unknown) => void);
    this.handlers[key] = list;
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
    this.source.onerror = () => {
      this.emit("error", { error: "Event stream disconnected" });
    };
  }

  close(): void {
    this.source?.close();
    this.source = null;
  }

  private emit<K extends keyof BackendEvents>(event: K, payload: BackendEvents[K]): void {
    for (const handler of this.handlers[String(event)] ?? []) {
      handler(payload);
    }
  }
}
