import { useCallback, useEffect, useMemo, useState } from "react";
import type { AdaAnalogConfig, AdaAnalogConfigUpdate, RawCapture } from "../api/types";
import type { PanelProps } from "./types";
import PlotCanvas from "./PlotCanvas";
import { samplesCsv } from "../utils/csv";
import { fmtInt, inputInt, inputNumber, parseNumber } from "../utils/format";
import { storageMetadataFile, storageTextFile, storageWriteRecord } from "../utils/storage";
import { useSyncedInput } from "../utils/syncedInput";
import type { SourceIndexRange } from "../utils/rawPlot";
import {
  downsampleEnvelope,
  normalizeIndexRange,
  paddedRangeForValues,
  rawVisibleCurrentValues,
  saturationWindowsForRawSamples,
} from "../utils/rawPlot";
import {
  DEFAULT_PD_ZERO_ADC_CODE,
  DEFAULT_TZ_OHM,
  adaRawCaptureFilterPayload,
  adaRawFilterReadback,
  adaRawMedianReadback,
  adaSaturationState,
  averageSignedAdcCode,
  formatAdaSaturation,
  formatAdcCodeDetail,
  formatAdcCodeSigned,
  formatMicroamp,
  inputCurrentMicroampToSignedAdcCode,
} from "../utils/ada4355";
import { safeRunName } from "../utils/lockRecording";

const RAW_DISPLAY_POINT_LIMIT = 4096;
const FALLBACK_GAIN_OPTIONS = [2000, 20000, 200000];
const FALLBACK_LOW_PASS_OPTIONS = [
  { label: "1 MHz", enabled: true },
  { label: "100 MHz", enabled: false },
];

function gainLabel(gainOhms: number): string {
  return gainOhms >= 1000 ? `${gainOhms / 1000} kOhm` : `${gainOhms} Ohm`;
}

function numberFromInput(value: string): number {
  const parsed = parseNumber(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export default function AdaPanel({
  state,
  client,
  command,
  active = true,
  compact = false,
  tzOhm = DEFAULT_TZ_OHM,
  pdZeroAdcCode = DEFAULT_PD_ZERO_ADC_CODE,
  pdZeroAdcCodeText = String(pdZeroAdcCode),
  setPdZeroAdcCodeText,
  setTzOhmText,
}: PanelProps) {
  const ada = state.lastStatus?.ada4355;
  const monitorHz = useSyncedInput(inputNumber(ada?.monitor_rate_hz, 0), "100000");
  const threshold = useSyncedInput(inputInt(ada?.filter?.glitch_threshold), "3000");
  const rawLpShift = useSyncedInput(inputInt(ada?.filter?.raw_lp_shift), "13");
  const rawLength = useSyncedInput(inputInt(ada?.raw?.length), "524288");
  const rawDecim = useSyncedInput(inputInt(ada?.raw?.decim), "1");
  const rawGlitchStatus = adaRawMedianReadback(ada?.filter);
  const rawFilterStatus = adaRawFilterReadback(ada?.filter);
  const [rawGlitchEnabled, setRawGlitchEnabled] = useState(rawGlitchStatus ?? false);
  const [rawGlitchDirty, setRawGlitchDirty] = useState(false);
  const [rawFilterEnabled, setRawFilterEnabled] = useState(rawFilterStatus ?? false);
  const [rawFilterDirty, setRawFilterDirty] = useState(false);
  const [rawName, setRawName] = useState("raw_adc");
  const [rawMessage, setRawMessage] = useState("No raw ADC capture yet.");
  const [raw, setRaw] = useState<RawCapture | null>(null);
  const [rawAutoY, setRawAutoY] = useState(true);
  const [rawYMin, setRawYMin] = useState("");
  const [rawYMax, setRawYMax] = useState("");
  const [rawZoomRange, setRawZoomRange] = useState<SourceIndexRange | undefined>(undefined);
  const [rawZoomHistory, setRawZoomHistory] = useState<SourceIndexRange[]>([]);
  const [analog, setAnalog] = useState<AdaAnalogConfig | null>(null);
  const [analogBusy, setAnalogBusy] = useState(false);
  const [analogMessage, setAnalogMessage] = useState("ADA4355 analog config is loaded when this page opens.");
  const rawValues = useMemo(() => raw?.samples ?? [], [raw]);
  const rawFullRange = useMemo(
    () => ({ startIndex: 0, endIndex: Math.max(0, rawValues.length - 1) }),
    [rawValues.length],
  );
  const rawVisibleRange = useMemo(
    () =>
      rawValues.length > 0 && rawZoomRange
        ? normalizeIndexRange(rawZoomRange.startIndex, rawZoomRange.endIndex, rawValues.length)
        : rawFullRange,
    [rawFullRange, rawValues.length, rawZoomRange],
  );
  const visibleRawCurrentValues = useMemo(
    () =>
      rawValues.length > 0
        ? rawVisibleCurrentValues(rawValues, rawVisibleRange, tzOhm, pdZeroAdcCode)
        : [],
    [pdZeroAdcCode, rawValues, rawVisibleRange, tzOhm],
  );
  const rawPlotPoints = useMemo(
    () => downsampleEnvelope(visibleRawCurrentValues, RAW_DISPLAY_POINT_LIMIT, rawVisibleRange.startIndex),
    [rawVisibleRange.startIndex, visibleRawCurrentValues],
  );
  const rawSaturationWindows = useMemo(
    () => saturationWindowsForRawSamples(rawValues, rawVisibleRange),
    [rawValues, rawVisibleRange],
  );
  const rawSaturatedSampleCount = useMemo(
    () => rawSaturationWindows.reduce((count, window) => count + window.endIndex - window.startIndex + 1, 0),
    [rawSaturationWindows],
  );
  const rawZoomActive = Boolean(rawZoomRange && rawValues.length > 0);
  const rawZoomYRange = rawZoomActive ? paddedRangeForValues(visibleRawCurrentValues, 0.1) : undefined;
  const rawYRange = rawAutoY
    ? undefined
    : {
        min: Number(rawYMin),
        max: Number(rawYMax),
      };
  const effectiveRawYRange = rawZoomYRange ?? rawYRange;
  const rawVisibleCount = rawValues.length > 0 ? rawVisibleRange.endIndex - rawVisibleRange.startIndex + 1 : 0;
  const rawDisplayLabel =
    rawValues.length > 0
      ? `samples ${rawVisibleRange.startIndex + 1}-${rawVisibleRange.endIndex + 1} / ${raw?.count ?? rawValues.length}, decim ${
          raw?.decim ?? rawDecim.value
        }${rawPlotPoints.length < rawVisibleCount ? `, display ${rawPlotPoints.length}` : ""}`
      : `samples 0, decim ${rawDecim.value}`;
  const releaseDrafts = () => {
    monitorHz.release();
    threshold.release();
    rawLpShift.release();
    rawLength.release();
    rawDecim.release();
  };
  const syncAnalog = useCallback(
    (nextAnalog: AdaAnalogConfig) => {
      setAnalog(nextAnalog);
      if (nextAnalog.available && typeof nextAnalog.gain_ohms === "number") {
        setTzOhmText?.(String(nextAnalog.gain_ohms));
      }
    },
    [setTzOhmText],
  );
  const loadAnalogConfig = useCallback(async () => {
    setAnalogBusy(true);
    try {
      const response = await client.adaAnalogConfig();
      syncAnalog(response.analog);
      if (response.analog.available) {
        setAnalogMessage(`Readback ${gainLabel(response.analog.gain_ohms ?? tzOhm)}, ${response.analog.low_pass_label ?? "--"}`);
      } else {
        setAnalogMessage(response.analog.error || "ADA4355 analog config is unavailable.");
      }
    } finally {
      setAnalogBusy(false);
    }
  }, [client, syncAnalog, tzOhm]);
  useEffect(() => {
    if (!active || compact || analog) return;
    loadAnalogConfig().catch((error) => setAnalogMessage(`Load ADA4355 analog config failed: ${(error as Error).message}`));
  }, [active, analog, compact, loadAnalogConfig]);
  const updateAnalogConfig = async (body: AdaAnalogConfigUpdate) => {
    setAnalogBusy(true);
    try {
      const response = await client.setAdaAnalogConfig(body);
      syncAnalog(response.analog);
      if (response.analog.available) {
        setAnalogMessage(`Readback ${gainLabel(response.analog.gain_ohms ?? tzOhm)}, ${response.analog.low_pass_label ?? "--"}`);
      } else {
        setAnalogMessage(response.analog.error || "ADA4355 analog config is unavailable.");
      }
    } finally {
      setAnalogBusy(false);
    }
  };
  const updateParameters = async () => {
    await client.post("/api/ada/monitor-rate", { hz: numberFromInput(monitorHz.value) });
    await client.post("/api/ada/capture-config", {
      max_points: clampNumber(ada?.max_points ?? 16384, 1, 16384),
      frame_decim: Math.max(1, ada?.frame_decim_n ?? 1000),
    });
    await client.post(
      "/api/ada/filter",
      adaRawCaptureFilterPayload({
        threshold: numberFromInput(threshold.value),
        rawLpShift: numberFromInput(rawLpShift.value),
        rawGlitchEnabled,
        rawFilterEnabled,
      }),
    );
    releaseDrafts();
  };
  const captureRaw = async () => {
    const length = clampNumber(numberFromInput(rawLength.value), 1, 524288);
    const decim = Math.max(1, numberFromInput(rawDecim.value));
    await updateParameters();
    const response = await client.rawCapture(length, decim);
    setRaw(response.raw);
    setRawZoomRange(undefined);
    setRawZoomHistory([]);
    setRawMessage(`Captured ${response.raw.count ?? response.raw.samples.length} raw ADC samples.`);
  };
  const calibrateZeroAdcCode = async () => {
    const length = clampNumber(numberFromInput(rawLength.value), 1, 524288);
    const decim = Math.max(1, numberFromInput(rawDecim.value));
    await updateParameters();
    const response = await client.rawCapture(length, decim);
    const nextZero = averageSignedAdcCode(response.raw.samples);
    if (nextZero === undefined) throw new Error("Raw ADC capture returned no samples.");
    setRaw(response.raw);
    setRawZoomRange(undefined);
    setRawZoomHistory([]);
    setPdZeroAdcCodeText?.(String(nextZero));
    setRawMessage(`Calibrated PD zero ADC code ${nextZero} from ${response.raw.count ?? response.raw.samples.length} raw ADC samples.`);
  };
  const saveRaw = async () => {
    if (!raw) throw new Error("No raw ADC capture available.");
    const decim = Math.max(1, raw.decim ?? numberFromInput(rawDecim.value));
    const sampleRateHz = 125000000 / decim;
    const result = await storageWriteRecord({
      dataType: "ada_raw",
      name: safeRunName(rawName, "raw_adc"),
      files: [
        storageMetadataFile({
          event: "raw_adc",
          saved_at: new Date().toISOString(),
          raw_name: rawName,
          raw_median_enabled: rawGlitchEnabled,
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
          lp_shift: ada?.filter?.lp_shift,
          raw_lp_shift: numberFromInput(rawLpShift.value),
          raw_storage: raw.storage,
          raw_word_count: raw.word_count,
          tz_ohm: tzOhm,
          pd_zero_adc_code: pdZeroAdcCode,
          ada4355_status: ada,
        }),
        storageTextFile("raw_adc.csv", samplesCsv(raw.samples, sampleRateHz, tzOhm, pdZeroAdcCode)),
      ],
    });
    setRawMessage(`Saved raw ADC to ${result.path}`);
  };

  useEffect(() => {
    if (!rawGlitchDirty && rawGlitchStatus !== undefined) {
      setRawGlitchEnabled(rawGlitchStatus);
    }
  }, [rawGlitchDirty, rawGlitchStatus]);

  useEffect(() => {
    if (!rawFilterDirty && rawFilterStatus !== undefined) {
      setRawFilterEnabled(rawFilterStatus);
    }
  }, [rawFilterDirty, rawFilterStatus]);

  const zoomRawToRange = (startIndex: number, endIndex: number) => {
    if (rawValues.length < 2) return;
    const next = normalizeIndexRange(startIndex, endIndex, rawValues.length);
    if (next.endIndex - next.startIndex < 1) return;
    setRawZoomHistory((current) => [...current, rawVisibleRange]);
    setRawZoomRange(next);
  };

  const restoreRawZoom = () => {
    setRawZoomHistory((current) => {
      if (current.length === 0) {
        setRawZoomRange(undefined);
        return [];
      }
      const previous = current[current.length - 1];
      const nextHistory = current.slice(0, -1);
      setRawZoomRange(previous.startIndex === 0 && previous.endIndex === Math.max(0, rawValues.length - 1) ? undefined : previous);
      return nextHistory;
    });
  };
  const gainOptions = analog?.allowed_gain_ohms?.length ? analog.allowed_gain_ohms : FALLBACK_GAIN_OPTIONS;
  const lowPassOptions = analog?.allowed_low_pass?.length ? analog.allowed_low_pass : FALLBACK_LOW_PASS_OPTIONS;
  const activeGain = analog?.available && typeof analog.gain_ohms === "number" ? analog.gain_ohms : tzOhm;
  const activeLowPass = analog?.available ? analog.low_pass_enabled : null;
  const monitorSaturation = typeof ada?.monitor_avg === "number" ? adaSaturationState(ada.monitor_avg) : undefined;

  return (
    <section className="panel">
      <h2>Photodiode / ADA4355</h2>
      <div className="readouts">
        <div className="readout">
          <span>PD Monitor ADC Code</span>
          <strong>{typeof ada?.monitor_avg === "number" ? formatAdcCodeSigned(ada.monitor_avg) : "--"}</strong>
          <div className="muted">
            {typeof ada?.monitor_avg === "number" ? formatAdcCodeDetail(ada.monitor_avg) : "raw --"} · count {fmtInt(ada?.monitor_counter)}
          </div>
          <div className={`rail-badge ${monitorSaturation ? "active" : ""}`}>{formatAdaSaturation(monitorSaturation)}</div>
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
            threshold {String(ada?.filter?.glitch_threshold ?? "--")} raw median {rawGlitchEnabled ? "on" : "off"} filter{" "}
            {rawFilterEnabled ? "on" : "off"}
          </div>
        </div>
      </div>

      {!compact && (
        <>
          <div className="readouts">
            <div className="readout settings-local-control">
              <label>
                PD Zero ADC Code
                <span className="zero-adc-control-row">
                  <input value={pdZeroAdcCodeText} onChange={(event) => setPdZeroAdcCodeText?.(event.target.value)} />
                  <button
                    type="button"
                    className="command compact zero-calibrate-button"
                    onClick={() => command("Calibrate PD Zero ADC Code", calibrateZeroAdcCode)}
                  >
                    Calibrate Zero
                  </button>
                </span>
              </label>
              <div className="muted">Displayed/exported PD current uses signed ADC {pdZeroAdcCode} as 0 uA.</div>
            </div>
            <div className="readout settings-local-control">
              <span>ADA4355 Gain / Tz</span>
              <div className="lock-method-control" role="group" aria-label="ADA4355 Gain / Tz">
                {gainOptions.map((gain) => (
                  <button
                    key={gain}
                    type="button"
                    className={`method-pill ${activeGain === gain ? "active" : ""}`}
                    disabled={analogBusy}
                    onClick={() => command(`Set ADA4355 Gain ${gain}`, () => updateAnalogConfig({ gain_ohms: gain }))}
                  >
                    {gainLabel(gain)}
                  </button>
                ))}
              </div>
              <div className="muted">Current conversion uses {activeGain.toLocaleString()} ohm from hardware readback.</div>
            </div>
            <div className="readout settings-local-control">
              <span>Analog Low-pass</span>
              <div className="lock-method-control" role="group" aria-label="Analog Low-pass">
                {lowPassOptions.map((option) => (
                  <button
                    key={option.label}
                    type="button"
                    className={`method-pill ${activeLowPass === option.enabled ? "active" : ""}`}
                    disabled={analogBusy}
                    onClick={() => command(`Set ADA4355 Low-pass ${option.label}`, () => updateAnalogConfig({ low_pass_enabled: option.enabled }))}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <div className="muted">{analogMessage}</div>
            </div>
          </div>
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
            <div className="muted">ADA4355 gain {tzOhm.toLocaleString()} ohm; zero ADC {pdZeroAdcCode} from ADA controls</div>
          </div>
          <div className="actions ada-parameter-actions">
            <label className="checkbox-field">
              <input
                type="checkbox"
                checked={rawGlitchEnabled}
                onChange={(event) => {
                  setRawGlitchDirty(true);
                  setRawGlitchEnabled(event.target.checked);
                }}
              />
              Raw Median
            </label>
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
            values={visibleRawCurrentValues}
            points={rawPlotPoints}
            xDomain={rawVisibleRange}
            color="#2563eb"
            label="input current"
            xLabel={rawDisplayLabel}
            title={
              rawSaturatedSampleCount > 0
                ? `Left-drag to zoom X; right-click to restore. Saturated samples ${rawSaturatedSampleCount}.`
                : "Left-drag to zoom X; right-click to restore."
            }
            ariaLabel="Raw ADC plot with X-only zoom"
            height={280}
            yRange={effectiveRawYRange}
            domainWindows={rawSaturationWindows}
            yTickFormatter={(value) => `${formatMicroamp(value)} uA`}
            rightAxisLabel="signed ADC code"
            rightTickFormatter={(value) => String(inputCurrentMicroampToSignedAdcCode(value, tzOhm, pdZeroAdcCode))}
            onSelectionComplete={zoomRawToRange}
            onResetZoom={restoreRawZoom}
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
