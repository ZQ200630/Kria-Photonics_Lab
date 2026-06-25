import { useEffect, useMemo, useRef, useState, type Dispatch } from "react";
import type { PanelProps } from "./types";
import type { AppAction } from "../state/store";
import PlotCanvas from "./PlotCanvas";
import { parseNumber } from "../utils/format";
import { saveTextFile } from "../utils/saveText";
import {
  DEFAULT_TZ_OHM,
  adcCodeToInputCurrentMicroamp,
  formatMicroamp,
  inputCurrentMicroampToAdcCode,
} from "../utils/ada4355";
import {
  appendSpectrumFrame,
  createSpectrumRecordRows,
  recordedSpectrumCsv,
  type SpectrumRecordingState,
} from "../utils/spectrumRecording";

type Props = PanelProps & {
  dispatch: Dispatch<AppAction>;
};

export default function SpectrumPanel({
  state,
  client,
  command,
  dispatch,
  active = true,
  tzOhm = DEFAULT_TZ_OHM,
  tzOhmText = String(DEFAULT_TZ_OHM),
  setTzOhmText,
  pdCurrentOffsetMicroamp = 0,
}: Props) {
  const spectrum = state.lastSpectrum;
  const [autoY, setAutoY] = useState(true);
  const [yMin, setYMin] = useState("");
  const [yMax, setYMax] = useState("");
  const [framesToRecord, setFramesToRecord] = useState("100");
  const [recordRefreshMs, setRecordRefreshMs] = useState("200");
  const [recording, setRecording] = useState(false);
  const [recordState, setRecordState] = useState<SpectrumRecordingState>({ frames: [] });
  const completedDownloadRef = useRef(false);

  const inputCurrent = useMemo(
    () => (spectrum?.points ?? []).map((value) => adcCodeToInputCurrentMicroamp(value & 0xffff, tzOhm, pdCurrentOffsetMicroamp)),
    [pdCurrentOffsetMicroamp, spectrum, tzOhm],
  );
  const duration = spectrum?.duration_ms ?? 0;
  const count = spectrum?.count ?? 0;
  const mid = count > 1 ? Math.floor((count - 1) / 2) : 0;
  const xLabel =
    count > 1
      ? `idx 0 / 0.000 ms    idx ${mid} / ${(duration / 2).toFixed(3)} ms    idx ${count - 1} / ${duration.toFixed(3)} ms`
      : "no spectrum";

  const safeRecordTarget = Math.max(1, Math.floor(parseNumber(framesToRecord) || 1));
  const safeRecordRefreshMs = Math.max(0, Math.floor(parseNumber(recordRefreshMs) || 0));

  const makeCsvFilename = (prefix: string) => `${prefix}-${new Date().toISOString().replace(/[:.]/g, "-")}.csv`;

  const exportCurrentSpectrum = async () => {
    if (!spectrum) return;
    const path = await saveTextFile(
      makeCsvFilename(`spectrum-${spectrum.frame_counter}`),
      recordedSpectrumCsv([
        { recordIndex: 0, frameCounter: spectrum.frame_counter, rows: createSpectrumRecordRows(spectrum, 0, tzOhm, pdCurrentOffsetMicroamp) },
      ]),
    );
    dispatch({ type: "log", message: path ? `Spectrum CSV saved: ${path}` : "Spectrum CSV export cancelled" });
  };

  const startRecording = () => {
    completedDownloadRef.current = false;
    setRecordState({ frames: [] });
    setRecording(true);
  };

  const stopRecording = async () => {
    if (recordState.frames.length > 0) {
      const path = await saveTextFile(makeCsvFilename("spectrum-record-partial"), recordedSpectrumCsv(recordState.frames));
      dispatch({ type: "log", message: path ? `Spectrum recording saved: ${path}` : "Spectrum recording export cancelled" });
    }
    setRecording(false);
  };

  useEffect(() => {
    if (!active || !recording || !spectrum) return;
    setRecordState((current) => {
      if (current.frames.length >= safeRecordTarget) return current;
      return appendSpectrumFrame(current, spectrum, {
        nowMs: performance.now(),
        minIntervalMs: safeRecordRefreshMs,
        tzOhm,
        currentOffsetMicroamp: pdCurrentOffsetMicroamp,
      });
    });
  }, [active, pdCurrentOffsetMicroamp, recording, safeRecordRefreshMs, safeRecordTarget, spectrum, tzOhm]);

  useEffect(() => {
    if (!active || !recording || completedDownloadRef.current || recordState.frames.length < safeRecordTarget) return;
    completedDownloadRef.current = true;
    saveTextFile(makeCsvFilename("spectrum-record"), recordedSpectrumCsv(recordState.frames))
      .then((path) => dispatch({ type: "log", message: path ? `Spectrum recording saved: ${path}` : "Spectrum recording export cancelled" }))
      .catch((error) => dispatch({ type: "log", message: `Spectrum recording save failed: ${(error as Error).message}` }));
    setRecording(false);
  }, [active, recordState.frames, recording, safeRecordTarget]);

  const manualYRange = autoY
    ? undefined
    : {
        min: Number(yMin),
        max: Number(yMax),
      };

  return (
    <section className="panel">
      <h2>Latest Spectrum</h2>
      <PlotCanvas
        values={inputCurrent}
        color="#7c3aed"
        label="input current"
        xLabel={xLabel}
        yRange={manualYRange}
        yTickFormatter={(value) => `${formatMicroamp(value)} uA`}
        rightAxisLabel="ADC code"
        rightTickFormatter={(value) => String(inputCurrentMicroampToAdcCode(value, tzOhm, pdCurrentOffsetMicroamp))}
        active={active}
      />
      <div className="spectrum-controls">
        <div className="axis-controls below-plot">
          <label>
            Tz Ohm
            <input value={tzOhmText} onChange={(event) => setTzOhmText?.(event.target.value)} />
          </label>
          <label className="checkbox-field">
            <input type="checkbox" checked={autoY} onChange={(event) => setAutoY(event.target.checked)} />
            Auto Scale
          </label>
          <label>
            Y Min uA
            <input value={yMin} disabled={autoY} onChange={(event) => setYMin(event.target.value)} placeholder="auto" />
          </label>
          <label>
            Y Max uA
            <input value={yMax} disabled={autoY} onChange={(event) => setYMax(event.target.value)} placeholder="auto" />
          </label>
        </div>
        <div className="record-controls">
          <label>
            Frames to Record
            <input value={framesToRecord} disabled={recording} onChange={(event) => setFramesToRecord(event.target.value)} />
          </label>
          <label>
            Record Refresh ms
            <input value={recordRefreshMs} disabled={recording} onChange={(event) => setRecordRefreshMs(event.target.value)} />
          </label>
        </div>
      </div>
      <div className="actions spectrum-actions">
        <button className="command" disabled={!spectrum} onClick={() => command("Export Current Spectrum CSV", exportCurrentSpectrum)}>
          Export Current Spectrum CSV
        </button>
        {!recording ? (
          <button className="command primary" onClick={startRecording}>
            Start Recording CSV
          </button>
        ) : (
          <button className="command danger" onClick={() => command("Stop Spectrum Recording", stopRecording)}>
            Stop Recording
          </button>
        )}
        <span className={`recording-status ${recording ? "active" : ""}`}>
          {recording ? `Recording ${recordState.frames.length} / ${safeRecordTarget} frames` : `${recordState.frames.length} frames ready`}
        </span>
      </div>
    </section>
  );
}
