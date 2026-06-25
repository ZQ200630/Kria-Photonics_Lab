import { useEffect, useMemo, useState } from "react";
import type { AdaFilterStatus, RawCapture } from "../api/types";
import type { PanelProps } from "./types";
import PlotCanvas from "./PlotCanvas";
import { samplesCsv } from "../utils/csv";
import { fmtInt, inputInt, inputNumber, parseNumber } from "../utils/format";
import { saveExperimentBundle } from "../utils/saveText";
import { useSyncedInput } from "../utils/syncedInput";
import {
  DEFAULT_TZ_OHM,
  adcCodeToInputCurrentMicroamp,
  formatMicroamp,
  inputCurrentMicroampToAdcCode,
} from "../utils/ada4355";
import { safeRunName } from "../utils/lockRecording";

function numberFromInput(value: string): number {
  const parsed = parseNumber(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function timestampSlug(date = new Date()): string {
  return date.toISOString().replace(/[:.]/g, "-");
}

function rawFilterReadback(filter: AdaFilterStatus | undefined): boolean | undefined {
  return typeof filter?.raw_use_filtered === "boolean" ? filter.raw_use_filtered : undefined;
}

export default function AdaPanel({
  state,
  client,
  command,
  active = true,
  compact = false,
  tzOhm = DEFAULT_TZ_OHM,
  tzOhmText = String(DEFAULT_TZ_OHM),
  setTzOhmText,
  pdCurrentOffsetMicroamp = 0,
}: PanelProps) {
  const ada = state.lastStatus?.ada4355;
  const monitorHz = useSyncedInput(inputNumber(ada?.monitor_rate_hz, 0), "100000");
  const threshold = useSyncedInput(inputInt(ada?.filter?.glitch_threshold), "3000");
  const lpShift = useSyncedInput(inputInt(ada?.filter?.lp_shift), "13");
  const rawLpShift = useSyncedInput(inputInt(ada?.filter?.raw_lp_shift), "13");
  const rawLength = useSyncedInput(inputInt(ada?.raw?.length), "524288");
  const rawDecim = useSyncedInput(inputInt(ada?.raw?.decim), "1");
  const rawFilterStatus = rawFilterReadback(ada?.filter);
  const [rawFilterEnabled, setRawFilterEnabled] = useState(rawFilterStatus ?? false);
  const [rawFilterDirty, setRawFilterDirty] = useState(false);
  const [rawName, setRawName] = useState("raw_adc");
  const [rawMessage, setRawMessage] = useState("No raw ADC capture yet.");
  const [raw, setRaw] = useState<RawCapture | null>(null);
  const [rawAutoY, setRawAutoY] = useState(true);
  const [rawYMin, setRawYMin] = useState("");
  const [rawYMax, setRawYMax] = useState("");
  const rawValues = useMemo(() => raw?.samples ?? [], [raw]);
  const rawCurrentValues = useMemo(
    () => rawValues.map((value) => adcCodeToInputCurrentMicroamp(value & 0xffff, tzOhm, pdCurrentOffsetMicroamp)),
    [pdCurrentOffsetMicroamp, rawValues, tzOhm],
  );
  const rawYRange = rawAutoY
    ? undefined
    : {
        min: Number(rawYMin),
        max: Number(rawYMax),
      };
  const releaseDrafts = () => {
    monitorHz.release();
    threshold.release();
    lpShift.release();
    rawLpShift.release();
    rawLength.release();
    rawDecim.release();
  };
  const updateParameters = async () => {
    await client.post("/api/ada/monitor-rate", { hz: numberFromInput(monitorHz.value) });
    await client.post("/api/ada/capture-config", {
      max_points: clampNumber(ada?.max_points ?? 16384, 1, 16384),
      frame_decim: Math.max(1, ada?.frame_decim_n ?? 1000),
    });
    await client.post("/api/ada/filter", {
      threshold: numberFromInput(threshold.value),
      lp_shift: numberFromInput(lpShift.value),
      raw_lp_shift: numberFromInput(rawLpShift.value),
      enable: true,
      glitch_reject: true,
      raw_filtered: rawFilterEnabled,
      spectrum_filtered: true,
      monitor_filtered: true,
    });
    releaseDrafts();
  };
  const captureRaw = async () => {
    const length = clampNumber(numberFromInput(rawLength.value), 1, 524288);
    const decim = Math.max(1, numberFromInput(rawDecim.value));
    const response = await client.rawCapture(length, decim);
    setRaw(response.raw);
    setRawMessage(`Captured ${response.raw.count ?? response.raw.samples.length} raw ADC samples.`);
  };
  const saveRaw = async () => {
    if (!raw) throw new Error("No raw ADC capture available.");
    const decim = Math.max(1, raw.decim ?? numberFromInput(rawDecim.value));
    const sampleRateHz = 125000000 / decim;
    const savedPath = await saveExperimentBundle({
      category: "Raw",
      runName: safeRunName(rawName, "raw_adc"),
      eventName: `${timestampSlug()}_raw_adc`,
      files: [
        {
          path: "metadata.json",
          contents: `${JSON.stringify(
            {
              event: "raw_adc",
              saved_at: new Date().toISOString(),
              raw_name: rawName,
              raw_filter_enabled: rawFilterEnabled,
              count: raw.count,
              decim,
              sample_rate_hz: sampleRateHz,
              raw_status: raw.raw_status,
              raw_status_hex: raw.raw_status_hex,
              raw_write_count: raw.raw_write_count,
              requested_length: numberFromInput(rawLength.value),
              monitor_rate_hz: numberFromInput(monitorHz.value),
              glitch_threshold: numberFromInput(threshold.value),
              lp_shift: numberFromInput(lpShift.value),
              raw_lp_shift: numberFromInput(rawLpShift.value),
              raw_storage: raw.storage,
              raw_word_count: raw.word_count,
              tz_ohm: tzOhm,
              pd_current_offset_uA: pdCurrentOffsetMicroamp,
              ada4355_status: ada,
            },
            null,
            2,
          )}\n`,
        },
        { path: "raw_adc.csv", contents: samplesCsv(raw.samples, sampleRateHz, tzOhm, pdCurrentOffsetMicroamp) },
      ],
    });
    setRawMessage(`Saved raw ADC to ${savedPath}`);
  };

  useEffect(() => {
    if (!rawFilterDirty && rawFilterStatus !== undefined) {
      setRawFilterEnabled(rawFilterStatus);
    }
  }, [rawFilterDirty, rawFilterStatus]);

  return (
    <section className="panel">
      <h2>Photodiode / ADA4355</h2>
      <div className="readouts">
        <div className="readout">
          <span>PD Monitor ADC Code</span>
          <strong>{fmtInt(ada?.monitor_avg)}</strong>
          <div className="muted">
            min {fmtInt(ada?.monitor_min)} max {fmtInt(ada?.monitor_max)} count {fmtInt(ada?.monitor_counter)}
          </div>
        </div>
        <div className="readout">
          <span>Frame Counter</span>
          <strong>{fmtInt(ada?.total_frame_counter)}</strong>
          <div className="muted">points {fmtInt(ada?.read_points_written)}</div>
        </div>
        <div className="readout">
          <span>Filter</span>
          <strong>LP shift {String(ada?.filter?.lp_shift ?? "--")}</strong>
          <div className="muted">
            threshold {String(ada?.filter?.glitch_threshold ?? "--")} raw {rawFilterEnabled ? "filtered" : "unfiltered"}
          </div>
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
              Spectrum/Monitor LP Shift
              <input {...lpShift.bind} />
            </label>
            <label>
              Raw LP Shift
              <input {...rawLpShift.bind} />
            </label>
            <label>
              Raw Length
              <input {...rawLength.bind} />
            </label>
            <label>
              Raw Decim
              <input {...rawDecim.bind} />
            </label>
            <label>
              Tz Ohm
              <input value={tzOhmText} onChange={(event) => setTzOhmText?.(event.target.value)} />
            </label>
          </div>
          <div className="actions ada-parameter-actions">
            <label className="checkbox-field">
              <input
                type="checkbox"
                checked={rawFilterEnabled}
                onChange={(event) => {
                  setRawFilterDirty(true);
                  setRawFilterEnabled(event.target.checked);
                }}
              />
              Raw Filter
            </label>
            <button className="command primary" onClick={() => command("Update ADA Parameters", updateParameters)}>
              Update Parameters
            </button>
          </div>
          <PlotCanvas
            values={rawCurrentValues}
            color="#2563eb"
            label="input current"
            xLabel={`samples ${raw?.count ?? 0}, decim ${raw?.decim ?? rawDecim.value}`}
            height={280}
            yRange={rawYRange}
            yTickFormatter={(value) => `${formatMicroamp(value)} uA`}
            rightAxisLabel="ADC code"
            rightTickFormatter={(value) => String(inputCurrentMicroampToAdcCode(value, tzOhm, pdCurrentOffsetMicroamp))}
            active={active}
          />
          <div className="axis-controls below-plot">
            <label className="checkbox-field">
              <input type="checkbox" checked={rawAutoY} onChange={(event) => setRawAutoY(event.target.checked)} />
              Auto Raw Y
            </label>
            <label>
              Raw Y Min uA
              <input value={rawYMin} disabled={rawAutoY} onChange={(event) => setRawYMin(event.target.value)} placeholder="auto" />
            </label>
            <label>
              Raw Y Max uA
              <input value={rawYMax} disabled={rawAutoY} onChange={(event) => setRawYMax(event.target.value)} placeholder="auto" />
            </label>
          </div>
          <div className="ada-raw-recorder">
            <label>
              Raw Name
              <input value={rawName} onChange={(event) => setRawName(event.target.value)} />
            </label>
            <button className="command" onClick={() => command("Capture Raw ADC", captureRaw)}>
              Capture Raw ADC
            </button>
            <button className="command primary" disabled={!raw} onClick={() => command("Save Raw ADC", saveRaw)}>
              Save Raw
            </button>
            <span className={`recording-status ${raw ? "active" : ""}`}>{rawMessage}</span>
          </div>
        </>
      )}

      {compact && (
        <div className="actions">
          <button className="command primary" onClick={() => command("Update ADA Parameters", updateParameters)}>
            Update Parameters
          </button>
          <button className="command" onClick={() => command("Capture Raw ADC", captureRaw)}>
            Capture Raw ADC
          </button>
          <button className="command" disabled={!raw} onClick={() => command("Save Raw ADC", saveRaw)}>
            Save Raw
          </button>
          <span className={`recording-status ${raw ? "active" : ""}`}>{rawMessage}</span>
        </div>
      )}
    </section>
  );
}
