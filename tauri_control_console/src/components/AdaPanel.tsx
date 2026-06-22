import { useMemo, useState } from "react";
import type { RawCapture } from "../api/types";
import type { PanelProps } from "./types";
import PlotCanvas from "./PlotCanvas";
import { downloadText, samplesCsv } from "../utils/csv";
import { fmtInt, fmtNumber, inputInt, inputNumber, parseNumber } from "../utils/format";
import { useSyncedInput } from "../utils/syncedInput";

export default function AdaPanel({ state, client, command, compact = false }: PanelProps) {
  const ada = state.lastStatus?.ada4355;
  const monitorHz = useSyncedInput(inputNumber(ada?.monitor_rate_hz, 0), "100000");
  const threshold = useSyncedInput(inputInt(ada?.filter?.glitch_threshold), "3000");
  const lpShift = useSyncedInput(inputInt(ada?.filter?.lp_shift), "13");
  const rawLength = useSyncedInput(inputInt(ada?.raw?.length), "16384");
  const rawDecim = useSyncedInput(inputInt(ada?.raw?.decim), "1");
  const [raw, setRaw] = useState<RawCapture | null>(null);
  const rawValues = useMemo(() => raw?.samples ?? [], [raw]);

  return (
    <section className="panel">
      <h2>Photodiode / ADA4355</h2>
      <div className="readouts">
        <div className="readout">
          <span>PD Monitor ADC Code</span>
          <strong>{fmtInt(ada?.monitor_avg)}</strong>
          <div className="muted">min {fmtInt(ada?.monitor_min)} max {fmtInt(ada?.monitor_max)}</div>
        </div>
        <div className="readout">
          <span>Frame Counter</span>
          <strong>{fmtInt(ada?.total_frame_counter)}</strong>
          <div className="muted">points {fmtInt(ada?.read_points_written)}</div>
        </div>
        <div className="readout">
          <span>Filter</span>
          <strong>LP shift {String(ada?.filter?.lp_shift ?? "--")}</strong>
          <div className="muted">threshold {String(ada?.filter?.glitch_threshold ?? "--")}</div>
        </div>
      </div>

      {!compact && (
        <>
          <div className="fields">
            <label>
              Monitor Rate Hz
              <input {...monitorHz.bind} />
            </label>
            <label>
              Glitch Threshold
              <input {...threshold.bind} />
            </label>
            <label>
              LP Shift
              <input {...lpShift.bind} />
            </label>
            <label>
              Raw Length
              <input {...rawLength.bind} />
            </label>
            <label>
              Raw Decim
              <input {...rawDecim.bind} />
            </label>
          </div>
          <PlotCanvas values={rawValues} color="#2563eb" label="raw ADC snapshot" xLabel={`samples ${raw?.count ?? 0}, decim ${raw?.decim ?? rawDecim.value}`} height={280} />
        </>
      )}

      <div className="actions">
        <button className="command primary" onClick={() => command("Start ADA", () => client.post("/api/ada/start", { clear_counters: false }))}>
          Start ADA
        </button>
        <button className="command" onClick={() => command("Clear ADA Counters", () => client.post("/api/ada/clear"))}>
          Clear ADA
        </button>
        <button className="command" onClick={() => command("Set Monitor Rate", () => client.post("/api/ada/monitor-rate", { hz: Number(monitorHz.value) }))}>
          Set Monitor Rate
        </button>
        <button
          className="command"
          onClick={() =>
            command("Apply ADA Filter", () =>
              client.post("/api/ada/filter", {
                threshold: parseNumber(threshold.value),
                lp_shift: parseNumber(lpShift.value),
                enable: true,
                glitch_reject: true,
                raw_filtered: true,
                spectrum_filtered: true,
                monitor_filtered: true,
              }),
            )
          }
        >
          Apply Filter
        </button>
        <button
          className="command"
          onClick={() =>
            command("Capture Raw ADC", async () => {
              const response = await client.rawCapture(parseNumber(rawLength.value), parseNumber(rawDecim.value));
              setRaw(response.raw);
            })
          }
        >
          Capture Raw ADC
        </button>
        <button
          className="command"
          onClick={() => {
            if (raw) downloadText("raw-adc-snapshot.csv", samplesCsv(raw.samples, 125000000 / Math.max(1, raw.decim ?? 1)));
          }}
        >
          Export Raw CSV
        </button>
        <button className="command danger" onClick={() => command("Stop ADA", () => client.post("/api/ada/stop"))}>
          Stop ADA
        </button>
      </div>
    </section>
  );
}
