import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch } from "react";
import type { PanelProps } from "./types";
import type { AppAction } from "../state/store";
import PlotCanvas from "./PlotCanvas";
import { parseNumber } from "../utils/format";
import { storageMetadataFile, storageTextFile, storageWriteRecord } from "../utils/storage";
import {
  DEFAULT_PD_ZERO_ADC_CODE,
  DEFAULT_TZ_OHM,
  adcCodeToInputCurrentMicroamp,
  formatMicroamp,
  inputCurrentMicroampToSignedAdcCode,
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
  pdZeroAdcCode = DEFAULT_PD_ZERO_ADC_CODE,
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
  const recordingSavingRef = useRef(false);

  const inputCurrent = useMemo(
    () => (spectrum?.points ?? []).map((value) => adcCodeToInputCurrentMicroamp(value & 0xffff, tzOhm, pdZeroAdcCode)),
    [pdZeroAdcCode, spectrum, tzOhm],
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

  const exportCurrentSpectrum = async () => {
    if (!spectrum) return;
    const result = await storageWriteRecord({
      dataType: "spectrum_snapshot",
      name: `spectrum_${spectrum.frame_counter}`,
      files: [
        storageMetadataFile({
          kind: "spectrum_snapshot",
          saved_at: new Date().toISOString(),
          frame_counter: spectrum.frame_counter,
          count: spectrum.count,
          duration_ms: spectrum.duration_ms,
          tz_ohm: tzOhm,
          pd_zero_adc_code: pdZeroAdcCode,
        }),
        storageTextFile(
          "spectrum.csv",
          recordedSpectrumCsv([
            { recordIndex: 0, frameCounter: spectrum.frame_counter, rows: createSpectrumRecordRows(spectrum, 0, tzOhm, pdZeroAdcCode) },
          ]),
        ),
      ],
    });
    dispatch({ type: "log", message: `Spectrum CSV saved: ${result.path}` });
  };

  const saveSpectrumRecording = useCallback(async (frames: SpectrumRecordingState["frames"], eventKind = "spectrum_recording") => {
    if (frames.length === 0) return null;
    return storageWriteRecord({
      dataType: "spectrum_recording",
      name: eventKind === "spectrum_recording_partial" ? "spectrum_record_partial" : "spectrum_record",
      files: [
        storageMetadataFile({
          kind: eventKind,
          saved_at: new Date().toISOString(),
          requested_frames: safeRecordTarget,
          saved_frames: frames.length,
          refresh_ms: safeRecordRefreshMs,
          tz_ohm: tzOhm,
          pd_zero_adc_code: pdZeroAdcCode,
        }),
        storageTextFile("spectra.csv", recordedSpectrumCsv(frames)),
      ],
    });
  }, [pdZeroAdcCode, safeRecordRefreshMs, safeRecordTarget, tzOhm]);

  const startRecording = () => {
    completedDownloadRef.current = false;
    recordingSavingRef.current = false;
    setRecordState({ frames: [] });
    setRecording(true);
  };

  const stopRecording = async () => {
    if (recordingSavingRef.current) return;
    recordingSavingRef.current = true;
    completedDownloadRef.current = true;
    if (recordState.frames.length > 0) {
      const result = await saveSpectrumRecording(recordState.frames, "spectrum_recording_partial");
      if (result) dispatch({ type: "log", message: `Spectrum recording saved: ${result.path}` });
    }
    recordingSavingRef.current = false;
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
        zeroAdcCode: pdZeroAdcCode,
      });
    });
  }, [active, pdZeroAdcCode, recording, safeRecordRefreshMs, safeRecordTarget, spectrum, tzOhm]);

  useEffect(() => {
    if (!active || !recording || completedDownloadRef.current || recordingSavingRef.current || recordState.frames.length < safeRecordTarget) return;
    completedDownloadRef.current = true;
    recordingSavingRef.current = true;
    saveSpectrumRecording(recordState.frames, "spectrum_recording")
      .then((result) => dispatch({ type: "log", message: result ? `Spectrum recording saved: ${result.path}` : "Spectrum recording export cancelled" }))
      .catch((error) => dispatch({ type: "log", message: `Spectrum recording save failed: ${(error as Error).message}` }))
      .finally(() => {
        recordingSavingRef.current = false;
      });
    setRecording(false);
  }, [active, dispatch, recordState.frames, recording, safeRecordTarget, saveSpectrumRecording]);

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
        rightAxisLabel="signed ADC code"
        rightTickFormatter={(value) => String(inputCurrentMicroampToSignedAdcCode(value, tzOhm, pdZeroAdcCode))}
        active={active}
      />
      <div className="spectrum-controls">
        <div className="axis-controls below-plot">
          <div className="muted">ADA4355 gain {tzOhm.toLocaleString()} ohm; zero ADC {pdZeroAdcCode} from ADA controls</div>
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
