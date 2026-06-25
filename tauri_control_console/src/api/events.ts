import type { FaultEvent, HeartbeatEvent, SpectrumEvent, StatusEvent } from "./types";

export type BackendEvents = {
  status: StatusEvent;
  spectrum: SpectrumEvent;
  fault: FaultEvent;
  heartbeat: HeartbeatEvent;
  error: { timestamp?: number; error: string };
};

type Handler<K extends keyof BackendEvents> = (payload: BackendEvents[K]) => void;

export type BackendEventStreamOptions = {
  statusHz?: number;
  spectrumHz?: number;
  spectrumPoints?: number;
};

export class BackendEventStream {
  private source: EventSource | null = null;
  private handlers: Record<string, Array<(payload: unknown) => void>> = {};

  constructor(
    private baseUrl: string,
    private options: BackendEventStreamOptions = {},
  ) {}

  on<K extends keyof BackendEvents>(event: K, handler: Handler<K>): void {
    const key = String(event);
    const list = this.handlers[key] ?? [];
    list.push(handler as (payload: unknown) => void);
    this.handlers[key] = list;
  }

  connect(): void {
    this.close();
    this.source = new EventSource(this.eventsUrl());
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

  private eventsUrl(): string {
    const params = new URLSearchParams();
    if (this.options.statusHz !== undefined) params.set("status_hz", String(this.options.statusHz));
    if (this.options.spectrumHz !== undefined) params.set("spectrum_hz", String(this.options.spectrumHz));
    if (this.options.spectrumPoints !== undefined) params.set("spectrum_points", String(this.options.spectrumPoints));
    const query = params.toString();
    return `${this.baseUrl.replace(/\/+$/, "")}/api/events${query ? `?${query}` : ""}`;
  }

  private emit<K extends keyof BackendEvents>(event: K, payload: BackendEvents[K]): void {
    for (const handler of this.handlers[String(event)] ?? []) {
      handler(payload);
    }
  }
}
