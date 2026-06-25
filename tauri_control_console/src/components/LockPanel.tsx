import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PanelProps } from "./types";
import PlotCanvas from "./PlotCanvas";
import { fmtInt, fmtNumber, inputInt, inputNumber, parseNumber } from "../utils/format";
import { classifyLaserStatus, lockStopStaticCh1Code, scanFrequencyHz } from "../utils/laser";
import {
  estimateSlidingFrameMatch,
  findLevelCrossings,
  inferPolarityInvertForMarker,
  nudgeNumberText,
  normalizeLevelForSeries,
  paddedRangeForSeries,
  relativeIntensityToRawAdc,
  scanCodeAtSpectrumIndex,
  scanIndexAtCode,
  searchHalfspanToIndexSpan,
  type LevelCrossing,
  type PlotRange,
  type SlidingFrameMatch,
} from "../utils/lockSpectrum";
import { buildAcquireTemplate, type AcquireTemplate } from "../utils/acquireTemplate";
import { makeTecRampPayload, rampEnabledInput } from "../utils/tecRamp";
import { useSyncedInput } from "../utils/syncedInput";
import { isTecRunning } from "../utils/tec";
import { monitorModeWindows, monitorRecordingWindows, type MonitorDisplayMode } from "../utils/monitorSamples";
import {
  DEFAULT_TZ_OHM,
  adcCodeToInputCurrentMicroamp,
  formatMicroamp,
  inputCurrentMicroampToAdcCode,
} from "../utils/ada4355";
import type { Spectrum } from "../api/types";
import { chooseDataDirectory, saveExperimentBundle } from "../utils/saveText";
import {
  lockSweepPartialCsv,
  monitorCsv,
  safeRunName,
  spectrumFrameCsv,
  spectrumFramesCsv,
  type ExperimentFile,
  type RecordingTrendSample,
} from "../utils/lockRecording";

type OperationControl = "temperature" | "scanCh0" | "scanStart" | "scanStop";
type LockMethod = "direct" | "board";

const DEFAULT_RECORD_BASE_DIR_LABEL = "./Data";
const LIVE_PD_MODE_HIGHLIGHTS: Record<MonitorDisplayMode, { color: string; borderColor: string }> = {
  static: { color: "rgba(100, 116, 139, 0.1)", borderColor: "rgba(100, 116, 139, 0.22)" },
  scan: { color: "rgba(245, 158, 11, 0.13)", borderColor: "rgba(217, 119, 6, 0.28)" },
  lock: { color: "rgba(34, 197, 94, 0.13)", borderColor: "rgba(22, 163, 74, 0.3)" },
};

type SpectrumFrame = {
  key: string;
  values: number[];
  count: number;
  frameCounter: number;
  durationMs: number;
};

type FrameHistory = {
  previous: SpectrumFrame | null;
  current: SpectrumFrame | null;
};

type LockAcquisitionSnapshot = {
  reference: SpectrumFrame;
  current: SpectrumFrame;
  match: SlidingFrameMatch;
  selectedIndex: number;
  selectedReferenceIndex: number;
  selectedCode: number;
  actualCode: number;
  currentStopIndex: number;
  referenceStopIndex: number;
};

type MarkerLockSelection = {
  targetAdc: number;
  biasCh1: number;
  polarityInvert: boolean;
  template: AcquireTemplate;
  body: Record<string, unknown>;
};

function numberFromInput(value: string): number {
  const parsed = parseNumber(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function spectrumKey(spectrum: Spectrum): string {
  return `${spectrum.frame_counter}:${spectrum.buffer_id}:${spectrum.count}:${spectrum.points.length}`;
}

function spectrumToFrame(spectrum: Spectrum): SpectrumFrame {
  return {
    key: spectrumKey(spectrum),
    values: (spectrum.points ?? []).map((value) => Math.max(0, 0xffff - (value & 0xffff))),
    count: spectrum.count || spectrum.points.length,
    frameCounter: spectrum.frame_counter,
    durationMs: spectrum.duration_ms,
  };
}

function relativeIntensityToCurrentMicroamp(relativeIntensity: number, tzOhm: number, currentOffsetMicroamp: number): number {
  return adcCodeToInputCurrentMicroamp(relativeIntensityToRawAdc(relativeIntensity), tzOhm, currentOffsetMicroamp);
}

function clampIndex(index: number, count: number): number {
  return Math.max(0, Math.min(Math.max(0, count - 1), Math.round(index)));
}

function timestampSlug(date = new Date()): string {
  return date.toISOString().replace(/[:.]/g, "-");
}

function Field({ label, input, disabled = false }: { label: string; input: ReturnType<typeof useSyncedInput>; disabled?: boolean }) {
  return (
    <label>
      {label}
      <input {...input.bind} disabled={disabled} />
    </label>
  );
}

function OperationRow({
  active,
  label,
  value,
  step,
  unit,
  onSelect,
  onStepChange,
  onNudge,
  disabled = false,
}: {
  active: boolean;
  label: string;
  value: ReturnType<typeof useSyncedInput>;
  step: string;
  unit: string;
  onSelect: () => void;
  onStepChange: (value: string) => void;
  onNudge: (direction: -1 | 1) => void;
  disabled?: boolean;
}) {
  return (
    <div className={`operation-row ${active ? "active" : ""} ${disabled ? "disabled-section" : ""}`} onMouseDown={() => !disabled && onSelect()}>
      <label>
        {label}
        <input {...value.bind} onFocus={(event) => {
          if (disabled) return;
          value.bind.onFocus();
          onSelect();
          event.currentTarget.select();
        }} disabled={disabled} />
      </label>
      <label>
        Step {unit}
        <input value={step} onChange={(event) => onStepChange(event.target.value)} disabled={disabled} />
      </label>
      <div className="operation-nudge-buttons">
        <button type="button" className="command compact" disabled={disabled} onClick={() => onNudge(-1)}>
          &lt;
        </button>
        <button type="button" className="command compact" disabled={disabled} onClick={() => onNudge(1)}>
          &gt;
        </button>
      </div>
    </div>
  );
}

export default function LockPanel({
  state,
  client,
  command,
  active = true,
  tzOhm = DEFAULT_TZ_OHM,
  tzOhmText = String(DEFAULT_TZ_OHM),
  setTzOhmText,
  pdCurrentOffsetMicroamp = 0,
  monitorSamplesRef,
}: PanelProps) {
  const tec = state.lastStatus?.tec;
  const laser = state.lastStatus?.laser;
  const lock = laser?.lock;
  const laserStatus = classifyLaserStatus(laser);
  const monitoringOn = laserStatus.mode === "scan";
  const boardAcquireSupported = Boolean(laser?.acquire?.supported);
  const lockBlockedByTec = !isTecRunning(tec?.status_flags);

  const lockHalfspan =
    typeof lock?.ch1_min_internal === "number" && typeof lock?.ch1_max_internal === "number"
      ? Math.round((lock.ch1_max_internal - lock.ch1_min_internal) / 2)
      : undefined;
  const acquireSearchHalfspan =
    typeof laser?.acquire?.search_min === "number" && typeof laser?.acquire?.search_max === "number"
      ? Math.round((laser.acquire.search_max - laser.acquire.search_min) / 2)
      : undefined;
  const targetReadback = tec?.ramp?.active ? tec.ramp.target_celsius : tec?.target_celsius;
  const targetTemp = useSyncedInput(inputNumber(targetReadback, 3), "31.000");
  const rampEnabled = useSyncedInput(rampEnabledInput(tec?.ramp?.enabled), "yes");
  const rampRate = useSyncedInput(inputNumber(tec?.ramp?.rate_c_per_s, 3), "0.050");
  const rampInterval = useSyncedInput(inputInt(tec?.ramp?.interval_ms), "200");

  const scanCh0 = useSyncedInput(inputInt(laser?.fine_scan_setpoint?.ch0_internal), "26000");
  const scanStart = useSyncedInput(inputInt(laser?.fine_scan_setpoint?.ch1_start_internal), "20000");
  const scanStop = useSyncedInput(inputInt(laser?.fine_scan_setpoint?.ch1_stop_internal), "30000");
  const scanStep = useSyncedInput(inputInt(laser?.fine_scan_setpoint?.ch1_step_internal), "10");
  const dwell = useSyncedInput(inputInt(laser?.fine_scan_setpoint?.dwell_ticks), "100");
  const settle = useSyncedInput(inputInt(laser?.fine_scan_setpoint?.settle_ticks), "100");
  const frames = useSyncedInput(inputInt(laser?.fine_scan_setpoint?.frames), "1");

  const targetAdc = useSyncedInput(inputInt(lock?.target_adc), "42000");
  const biasCh1 = useSyncedInput(inputInt(lock?.bias_ch1_internal), "25000");
  const halfspan = useSyncedInput(inputInt(lockHalfspan), "5000");
  const searchHalfspan = useSyncedInput(inputInt(acquireSearchHalfspan), "1000");
  const kp = useSyncedInput(inputNumber(lock?.kp, 6), "0.5");
  const ki = useSyncedInput(inputNumber(lock?.ki, 6), "0.01");
  const maxStep = useSyncedInput(inputInt(lock?.max_step), "3");
  const integralLimit = useSyncedInput(inputInt(lock?.integral_limit), "500000");
  const lockedThreshold = useSyncedInput(inputInt(lock?.locked_threshold), "1000");
  const lossThreshold = useSyncedInput(inputInt(lock?.loss_threshold), "10000");
  const polarity = useSyncedInput(lock?.polarity_invert === undefined ? undefined : lock.polarity_invert ? "invert" : "normal", "normal");

  const [activeControl, setActiveControl] = useState<OperationControl>("temperature");
  const [tempStep, setTempStep] = useState("0.010");
  const [ch0Step, setCh0Step] = useState("100");
  const [scanStartStep, setScanStartStep] = useState("100");
  const [scanStopStep, setScanStopStep] = useState("100");
  const [threshold, setThreshold] = useState<number | undefined>(undefined);
  const [selectedAcquireTemplate, setSelectedAcquireTemplate] = useState<AcquireTemplate | null>(null);
  const [lockMethod, setLockMethod] = useState<LockMethod>("board");
  const [frameHistory, setFrameHistory] = useState<FrameHistory>({ previous: null, current: null });
  const [lockSnapshot, setLockSnapshot] = useState<LockAcquisitionSnapshot | null>(null);
  const [autoYContinuous, setAutoYContinuous] = useState(false);
  const [lockedYRange, setLockedYRange] = useState<PlotRange | undefined>(undefined);
  const [idleSpectrumName, setIdleSpectrumName] = useState("idle_spectrum");
  const [spectrumRecordCount, setSpectrumRecordCount] = useState("100");
  const [spectrumRecording, setSpectrumRecording] = useState(false);
  const [recordedSpectra, setRecordedSpectra] = useState<SpectrumFrame[]>([]);
  const [lockSpectrumName, setLockSpectrumName] = useState("lock_spectrum_pair");
  const [pdMonitorName, setPdMonitorName] = useState("pd_monitor");
  const [pdMonitorStartTime, setPdMonitorStartTime] = useState<number | null>(null);
  const [pdMonitorRecordedWindows, setPdMonitorRecordedWindows] = useState<Array<{ startedAt: number; finishedAt: number }>>([]);
  const [recordBaseDir, setRecordBaseDir] = useState<string | null>(null);
  const [recordingMessage, setRecordingMessage] = useState("Ready.");
  const previousLaserMode = useRef(laserStatus.mode);
  const trendRef = useRef(state.trend);
  const lockSnapshotRef = useRef<LockAcquisitionSnapshot | null>(null);
  const spectrumRecordingSaving = useRef(false);

  const liveFrame = useMemo(() => (state.lastSpectrum ? spectrumToFrame(state.lastSpectrum) : null), [state.lastSpectrum]);
  const spectrumValues = liveFrame?.values ?? frameHistory.current?.values ?? [];
  const crossings = useMemo(() => (threshold === undefined ? [] : findLevelCrossings(spectrumValues, threshold)), [spectrumValues, threshold]);
  const scanRate = scanFrequencyHz({
    start: numberFromInput(scanStart.value),
    stop: numberFromInput(scanStop.value),
    step: numberFromInput(scanStep.value),
    dwell: numberFromInput(dwell.value),
    settle: numberFromInput(settle.value),
  });
  const scanStartCode = numberFromInput(scanStart.value);
  const scanStopCode = numberFromInput(scanStop.value);
  const spectrumRecordTarget = Math.max(1, Math.floor(numberFromInput(spectrumRecordCount)));
  const lockingActive = laserStatus.mode === "lock";
  const pdMonitorActive = pdMonitorStartTime !== null;
  const relativeTickToCurrentLabel = useCallback(
    (value: number) => `${formatMicroamp(relativeIntensityToCurrentMicroamp(value, tzOhm, pdCurrentOffsetMicroamp))} uA`,
    [pdCurrentOffsetMicroamp, tzOhm],
  );
  const relativeTickToAdcCodeLabel = useCallback((value: number) => String(relativeIntensityToRawAdc(value)), []);
  const currentTickToAdcCodeLabel = useCallback(
    (value: number) => String(inputCurrentMicroampToAdcCode(value, tzOhm, pdCurrentOffsetMicroamp)),
    [pdCurrentOffsetMicroamp, tzOhm],
  );
  const searchWindowIndexSpan = searchHalfspanToIndexSpan(
    numberFromInput(searchHalfspan.value),
    scanStartCode,
    scanStopCode,
    spectrumValues.length,
  );
  useEffect(() => {
    trendRef.current = state.trend;
  }, [state.trend]);

  useEffect(() => {
    lockSnapshotRef.current = lockSnapshot;
  }, [lockSnapshot]);

  useEffect(() => {
    if (!liveFrame) return;
    setFrameHistory((previous) => {
      if (previous.current?.key === liveFrame.key) return previous;
      return { previous: previous.current, current: liveFrame };
    });
  }, [liveFrame]);

  useEffect(() => {
    if (spectrumValues.length === 0) return;
    setThreshold((current) => normalizeLevelForSeries(current, spectrumValues));
  }, [liveFrame?.key, spectrumValues]);

  useEffect(() => {
    if (laserStatus.mode === "scan" && previousLaserMode.current !== "scan") {
      setLockSnapshot(null);
    }
    previousLaserMode.current = laserStatus.mode;
  }, [laserStatus.mode]);

  const ySeries = useMemo(() => {
    if (lockSnapshot) {
      return [lockSnapshot.reference.values, lockSnapshot.current.values.slice(0, lockSnapshot.currentStopIndex + 1)];
    }
    return [spectrumValues];
  }, [lockSnapshot, spectrumValues]);

  const autoYOnce = useCallback(() => {
    setLockedYRange(paddedRangeForSeries(ySeries, 0.1));
  }, [ySeries]);

  useEffect(() => {
    if (!autoYContinuous || ySeries.every((series) => series.length === 0)) return;
    setLockedYRange(paddedRangeForSeries(ySeries, 0.1));
  }, [autoYContinuous, ySeries]);

  useEffect(() => {
    if (lockedYRange || ySeries.every((series) => series.length === 0)) return;
    setLockedYRange(paddedRangeForSeries(ySeries, 0.1));
  }, [lockedYRange, ySeries]);

  const releaseDrafts = useCallback(() => {
    targetTemp.release();
    rampEnabled.release();
    rampRate.release();
    rampInterval.release();
    scanCh0.release();
    scanStart.release();
    scanStop.release();
    scanStep.release();
    dwell.release();
    settle.release();
    frames.release();
    targetAdc.release();
    biasCh1.release();
    halfspan.release();
    searchHalfspan.release();
    kp.release();
    ki.release();
    maxStep.release();
    integralLimit.release();
    lockedThreshold.release();
    lossThreshold.release();
    polarity.release();
  }, [targetTemp, rampEnabled, rampRate, rampInterval, scanCh0, scanStart, scanStop, scanStep, dwell, settle, frames, targetAdc, biasCh1, halfspan, searchHalfspan, kp, ki, maxStep, integralLimit, lockedThreshold, lossThreshold, polarity]);

  const safety = useCallback(
    () => ({
      ch0_min: laser?.safety?.ch0_min ?? 0,
      ch0_max: laser?.safety?.ch0_max ?? 40000,
      ch1_min: laser?.safety?.ch1_min ?? 0,
      ch1_max: laser?.safety?.ch1_max ?? 40000,
    }),
    [laser?.safety?.ch0_min, laser?.safety?.ch0_max, laser?.safety?.ch1_min, laser?.safety?.ch1_max],
  );

  const scanPayload = useCallback(
    (override: Partial<Record<OperationControl, string>> = {}) => ({
      ch0: numberFromInput(override.scanCh0 ?? scanCh0.value),
      start: numberFromInput(override.scanStart ?? scanStart.value),
      stop: numberFromInput(override.scanStop ?? scanStop.value),
      step: numberFromInput(scanStep.value),
      dwell: numberFromInput(dwell.value),
      settle: numberFromInput(settle.value),
      frames: numberFromInput(frames.value),
      continuous: true,
      ...safety(),
    }),
    [scanCh0.value, scanStart.value, scanStop.value, scanStep.value, dwell.value, settle.value, frames.value, safety],
  );

  const startMonitoring = useCallback(
    async (override: Partial<Record<OperationControl, string>> = {}) => {
      if (lockBlockedByTec) {
        throw new Error("TEC must be On before side-fringe locking.");
      }
      setLockSnapshot(null);
      await client.post("/api/laser/fine-scan", scanPayload(override));
      releaseDrafts();
    },
    [client, lockBlockedByTec, scanPayload, releaseDrafts],
  );

  const stopMonitoring = useCallback(async () => {
    if (lockBlockedByTec) {
      await client.post("/api/laser/off");
      releaseDrafts();
      return;
    }
    await client.post("/api/laser/static", {
      ch0: numberFromInput(scanCh0.value),
      ch1: numberFromInput(scanStart.value),
      ...safety(),
    });
    releaseDrafts();
  }, [client, lockBlockedByTec, scanCh0.value, scanStart.value, safety, releaseDrafts]);

  const toggleMonitoring = () => {
    if (monitoringOn) return stopMonitoring();
    return startMonitoring();
  };

  const applyTargetTemperature = useCallback(
    async (nextTarget = targetTemp.value) => {
      await client.post("/api/tec/ramp-target", makeTecRampPayload(nextTarget, rampEnabled.value, rampRate.value, rampInterval.value));
      releaseDrafts();
    },
    [client, targetTemp.value, rampEnabled.value, rampRate.value, rampInterval.value, releaseDrafts],
  );

  const nudgeControl = useCallback(
    async (control: OperationControl, direction: -1 | 1) => {
      if (control === "temperature") {
        const next = nudgeNumberText(targetTemp.value, tempStep, direction, {
          min: tec?.temp_min_celsius ?? 0,
          max: tec?.temp_max_celsius ?? 80,
          digits: 3,
        });
        targetTemp.setDraftValue(next);
        await applyTargetTemperature(next);
        return;
      }

      const input = control === "scanCh0" ? scanCh0 : control === "scanStart" ? scanStart : scanStop;
      const stepText = control === "scanCh0" ? ch0Step : control === "scanStart" ? scanStartStep : scanStopStep;
      const next = nudgeNumberText(input.value, stepText, direction, { min: 0, max: 65535, digits: 0 });
      input.setDraftValue(next);
      if (monitoringOn) {
        await startMonitoring({ [control]: next });
      }
    },
    [
      targetTemp,
      tempStep,
      tec?.temp_min_celsius,
      tec?.temp_max_celsius,
      applyTargetTemperature,
      scanCh0,
      scanStart,
      scanStop,
      ch0Step,
      scanStartStep,
      scanStopStep,
      monitoringOn,
      startMonitoring,
    ],
  );

  useEffect(() => {
    if (!active) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      if (lockBlockedByTec) return;
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      event.preventDefault();
      void command(`Nudge ${activeControl}`, () => nudgeControl(activeControl, event.key === "ArrowRight" ? 1 : -1));
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [active, activeControl, command, lockBlockedByTec, nudgeControl]);

  const buildLockSnapshot = useCallback(
    ({
      selectedIndex,
      selectedCode,
      actualCode,
    }: {
      selectedIndex: number;
      selectedCode: number;
      actualCode?: number;
    }): LockAcquisitionSnapshot | null => {
      const current = frameHistory.current ?? liveFrame;
      const reference = frameHistory.previous ?? current;
      if (!current || !reference || current.values.length === 0 || reference.values.length === 0) return null;

      const maxShift = Math.min(1024, Math.max(16, Math.round(reference.values.length * 0.08)));
      const match = estimateSlidingFrameMatch(reference.values, current.values, maxShift);
      const finalCode = typeof actualCode === "number" && Number.isFinite(actualCode) ? actualCode : selectedCode;
      const currentStopIndex = scanIndexAtCode(finalCode, current.count || current.values.length, scanStartCode, scanStopCode);
      const referenceStopIndex = clampIndex(currentStopIndex + match.shift, reference.values.length);
      const selectedReferenceIndex = clampIndex(selectedIndex + match.shift, reference.values.length);

      return {
        reference,
        current,
        match,
        selectedIndex,
        selectedReferenceIndex,
        selectedCode,
        actualCode: finalCode,
        currentStopIndex,
        referenceStopIndex,
      };
    },
    [frameHistory.current, frameHistory.previous, liveFrame, scanStartCode, scanStopCode],
  );

  const freezeLockSnapshot = useCallback(
    (selectedIndex: number, selectedCode: number, actualCode?: number) => {
      const snapshot = buildLockSnapshot({ selectedIndex, selectedCode, actualCode });
      if (!snapshot) return null;
      setLockSnapshot(snapshot);
      return snapshot;
    },
    [buildLockSnapshot],
  );

  const recordingMetadata = useCallback(
    (kind: string, extra: Record<string, unknown> = {}) => ({
      saved_at: new Date().toISOString(),
      kind,
      scan_start_code: scanStartCode,
      scan_stop_code: scanStopCode,
      ada4355_tz_ohm: tzOhm,
      pd_current_offset_uA: pdCurrentOffsetMicroamp,
      lock_method: lockMethod,
      laser_mode: laserStatus.mode,
      tec_status: state.lastStatus?.tec,
      laser_status: state.lastStatus?.laser,
      ada4355_status: state.lastStatus?.ada4355,
      ...extra,
    }),
    [
      laserStatus.mode,
      lockMethod,
      pdCurrentOffsetMicroamp,
      scanStartCode,
      scanStopCode,
      state.lastStatus?.ada4355,
      state.lastStatus?.laser,
      state.lastStatus?.tec,
      tzOhm,
    ],
  );

  const saveBundle = useCallback(
    async ({
      category,
      name,
      fallbackName,
      eventKind,
      files,
    }: {
      category: string;
      name: string;
      fallbackName: string;
      eventKind: string;
      files: ExperimentFile[];
    }) => {
      const runName = safeRunName(name, fallbackName);
      const eventName = `${timestampSlug()}_${eventKind}`;
      const savedPath = await saveExperimentBundle({
        baseDir: recordBaseDir,
        category,
        runName,
        eventName,
        files,
      });
      setRecordingMessage(`Saved ${eventKind.replace(/_/g, " ")} to ${savedPath}`);
    },
    [recordBaseDir],
  );

  const saveCurrentSpectrum = useCallback(async () => {
    if (lockingActive) throw new Error("Current spectrum capture is for non-locking mode.");
    if (!liveFrame) throw new Error("No spectrum frame available.");
    await saveBundle({
      category: "Idle_Spectrum",
      name: idleSpectrumName,
      fallbackName: "idle_spectrum",
      eventKind: "current_spectrum",
      files: [
        {
          path: "metadata.json",
          contents: `${JSON.stringify(
            recordingMetadata("current_spectrum", {
              frame_counter: liveFrame.frameCounter,
              spectrum_count: liveFrame.count,
            }),
            null,
            2,
          )}\n`,
        },
        { path: "current_spectrum.csv", contents: spectrumFrameCsv(liveFrame, scanStartCode, scanStopCode, tzOhm, pdCurrentOffsetMicroamp) },
      ],
    });
  }, [idleSpectrumName, liveFrame, lockingActive, pdCurrentOffsetMicroamp, recordingMetadata, saveBundle, scanStartCode, scanStopCode, tzOhm]);

  const saveSpectrumRecording = useCallback(
    async (frames: SpectrumFrame[]) => {
      if (frames.length === 0) throw new Error("No spectrum frames recorded.");
      await saveBundle({
        category: "Idle_Spectrum",
        name: idleSpectrumName,
        fallbackName: "idle_spectrum",
        eventKind: "spectrum_recording",
        files: [
          {
            path: "metadata.json",
            contents: `${JSON.stringify(
              recordingMetadata("spectrum_recording", {
                requested_frames: spectrumRecordTarget,
                saved_frames: frames.length,
                frame_counters: frames.map((frame) => frame.frameCounter),
              }),
              null,
              2,
            )}\n`,
          },
          { path: "spectra.csv", contents: spectrumFramesCsv(frames, scanStartCode, scanStopCode, tzOhm, pdCurrentOffsetMicroamp) },
        ],
      });
    },
    [idleSpectrumName, pdCurrentOffsetMicroamp, recordingMetadata, saveBundle, scanStartCode, scanStopCode, spectrumRecordTarget, tzOhm],
  );

  const startSpectrumRecording = useCallback(async () => {
    if (lockingActive) throw new Error("Spectrum recording is for non-locking mode.");
    if (!liveFrame) throw new Error("No spectrum frame available.");
    spectrumRecordingSaving.current = false;
    setRecordedSpectra([]);
    setSpectrumRecording(true);
    setRecordingMessage(`Recording 0 / ${spectrumRecordTarget} spectra.`);
  }, [liveFrame, lockingActive, spectrumRecordTarget]);

  useEffect(() => {
    if (!spectrumRecording || !liveFrame) return;
    setRecordedSpectra((current) => {
      if (current.length >= spectrumRecordTarget) return current;
      if (current.some((frame) => frame.key === liveFrame.key)) return current;
      return [...current, liveFrame];
    });
  }, [liveFrame, spectrumRecordTarget, spectrumRecording]);

  useEffect(() => {
    if (!spectrumRecording) return;
    setRecordingMessage(`Recording ${Math.min(recordedSpectra.length, spectrumRecordTarget)} / ${spectrumRecordTarget} spectra.`);
  }, [recordedSpectra.length, spectrumRecordTarget, spectrumRecording]);

  useEffect(() => {
    if (!spectrumRecording || recordedSpectra.length < spectrumRecordTarget || spectrumRecordingSaving.current) return;
    spectrumRecordingSaving.current = true;
    void saveSpectrumRecording(recordedSpectra)
      .catch((error) => setRecordingMessage(`Spectrum recording save failed: ${(error as Error).message}`))
      .finally(() => {
        setSpectrumRecording(false);
        spectrumRecordingSaving.current = false;
      });
  }, [recordedSpectra, saveSpectrumRecording, spectrumRecordTarget, spectrumRecording]);

  const saveLockSpectrumPair = useCallback(async () => {
    const snapshot = lockSnapshotRef.current ?? lockSnapshot;
    if (!snapshot) throw new Error("No lock spectrum pair is available yet.");
    await saveBundle({
      category: "Lock_Spectrum",
      name: lockSpectrumName,
      fallbackName: "lock_spectrum_pair",
      eventKind: "lock_spectrum_pair",
      files: [
        {
          path: "metadata.json",
          contents: `${JSON.stringify(
            recordingMetadata("lock_spectrum_pair", {
              selected_code: snapshot.selectedCode,
              actual_code: snapshot.actualCode,
              selected_index: snapshot.selectedIndex,
              selected_reference_index: snapshot.selectedReferenceIndex,
              actual_reference_index: snapshot.referenceStopIndex,
              current_stop_index: snapshot.currentStopIndex,
              reference_frame_counter: snapshot.reference.frameCounter,
              locked_frame_counter: snapshot.current.frameCounter,
              sliding_match: snapshot.match,
              search_halfspan_code: numberFromInput(searchHalfspan.value),
              threshold,
            }),
            null,
            2,
          )}\n`,
        },
        { path: "reference_spectrum.csv", contents: spectrumFrameCsv(snapshot.reference, scanStartCode, scanStopCode, tzOhm, pdCurrentOffsetMicroamp) },
        { path: "locked_spectrum.csv", contents: spectrumFrameCsv(snapshot.current, scanStartCode, scanStopCode, tzOhm, pdCurrentOffsetMicroamp) },
        {
          path: "locked_sweep_partial_estimated.csv",
          contents: lockSweepPartialCsv(
            snapshot.current,
            scanStartCode,
            scanStopCode,
            snapshot.currentStopIndex,
            snapshot.match.shift,
            tzOhm,
            pdCurrentOffsetMicroamp,
          ),
        },
      ],
    });
  }, [lockSnapshot, lockSpectrumName, pdCurrentOffsetMicroamp, recordingMetadata, saveBundle, scanStartCode, scanStopCode, searchHalfspan.value, threshold, tzOhm]);

  const togglePdMonitorRecording = useCallback(async () => {
    if (pdMonitorStartTime === null) {
      const startedAt = Date.now() / 1000;
      setPdMonitorStartTime(startedAt);
      setRecordingMessage(`Recording live PD monitor from ${new Date(startedAt * 1000).toLocaleTimeString()}.`);
      return;
    }

    const finishedAt = Date.now() / 1000;
    const startedAt = pdMonitorStartTime;
    const sseSamples = (monitorSamplesRef?.current ?? []).filter((sample) => sample.t >= startedAt && sample.t <= finishedAt);
    const trendSamples = (trendRef.current as RecordingTrendSample[]).filter((sample) => sample.t >= startedAt && sample.t <= finishedAt);
    const samples = sseSamples.length >= trendSamples.length ? sseSamples : trendSamples;
    const source = sseSamples.length >= trendSamples.length ? "sse_status_50hz" : "ui_trend_fallback";
    const durationS = Math.max(0, finishedAt - startedAt);
    await saveBundle({
      category: "Live PD Monitor",
      name: pdMonitorName,
      fallbackName: "pd_monitor",
      eventKind: "pd_temperature_monitor",
      files: [
        {
          path: "metadata.json",
          contents: `${JSON.stringify(
            recordingMetadata("pd_temperature_monitor", {
              started_at: new Date(startedAt * 1000).toISOString(),
              finished_at: new Date(finishedAt * 1000).toISOString(),
              duration_s: durationS,
              samples: samples.length,
              monitor_source: source,
              target_status_hz: source === "sse_status_50hz" ? 50 : undefined,
              actual_status_hz: durationS > 0 ? samples.length / durationS : undefined,
              includes_live_pd_monitor: true,
              includes_temperature_monitor: true,
            }),
            null,
            2,
          )}\n`,
        },
        { path: "live_pd_temperature_monitor.csv", contents: monitorCsv(samples, startedAt, tzOhm, pdCurrentOffsetMicroamp) },
        { path: "trend_samples.json", contents: `${JSON.stringify(samples, null, 2)}\n` },
      ],
    });
    setPdMonitorRecordedWindows((previous) => [...previous, { startedAt, finishedAt }]);
    setPdMonitorStartTime(null);
  }, [monitorSamplesRef, pdMonitorName, pdMonitorStartTime, pdCurrentOffsetMicroamp, recordingMetadata, saveBundle, tzOhm]);

  useEffect(() => {
    if (laserStatus.mode !== "lock" || lockSnapshot) return;
    const code = laser?.acquire?.match_code ?? lock?.bias_ch1_internal ?? numberFromInput(biasCh1.value);
    const index = scanIndexAtCode(code, spectrumValues.length, scanStartCode, scanStopCode);
    freezeLockSnapshot(index, code, laser?.acquire?.match_code);
  }, [
    biasCh1.value,
    freezeLockSnapshot,
    laser?.acquire?.match_code,
    laserStatus.mode,
    lock?.bias_ch1_internal,
    lockSnapshot,
    scanStartCode,
    scanStopCode,
    spectrumValues.length,
  ]);

  useEffect(() => {
    const matchCode = laser?.acquire?.match_code;
    if (!lockSnapshot || typeof matchCode !== "number" || !Number.isFinite(matchCode) || matchCode === lockSnapshot.actualCode) return;
    const next = buildLockSnapshot({
      selectedIndex: lockSnapshot.selectedIndex,
      selectedCode: lockSnapshot.selectedCode,
      actualCode: matchCode,
    });
    if (next) {
      setLockSnapshot(next);
    }
  }, [buildLockSnapshot, laser?.acquire?.match_code, lockSnapshot]);

  const lockBody = (override: { target_adc?: number; bias_ch1?: number; ch0?: number; polarity_invert?: boolean } = {}) => {
    const bias = override.bias_ch1 ?? numberFromInput(biasCh1.value);
    const span = Math.max(0, numberFromInput(halfspan.value));
    return {
      ch0: override.ch0 ?? numberFromInput(scanCh0.value),
      target_adc: override.target_adc ?? numberFromInput(targetAdc.value),
      bias_ch1: bias,
      lock_ch1_min: Math.max(0, bias - span),
      lock_ch1_max: Math.min(65535, bias + span),
      lock_kp: Number(kp.value),
      lock_ki: Number(ki.value),
      lock_max_step: numberFromInput(maxStep.value),
      lock_integral_limit: numberFromInput(integralLimit.value),
      locked_threshold: numberFromInput(lockedThreshold.value),
      loss_threshold: numberFromInput(lossThreshold.value),
      polarity_invert: override.polarity_invert ?? polarity.value === "invert",
      ...safety(),
    };
  };

  const updateLockParameters = async () => {
    if (lockBlockedByTec) {
      throw new Error("TEC must be On before side-fringe locking.");
    }
    await client.laserLockParams(lockBody());
    releaseDrafts();
  };

  const stopLockingAtCurrentPoint = async () => {
    await client.post("/api/laser/static", {
      ch0: laser?.static_setpoint?.ch0_internal ?? numberFromInput(scanCh0.value),
      ch1: lockStopStaticCh1Code(lock, numberFromInput(biasCh1.value)),
      ...safety(),
    });
    setLockSnapshot(null);
    setSelectedAcquireTemplate(null);
    releaseDrafts();
  };

  const buildMarkerLockSelection = (crossing: LevelCrossing): MarkerLockSelection => {
    const nextTargetAdc = relativeIntensityToRawAdc(crossing.value);
    const scanStartCode = numberFromInput(scanStart.value);
    const scanStopCode = numberFromInput(scanStop.value);
    const nextBiasCh1 = scanCodeAtSpectrumIndex(
      crossing.index,
      state.lastSpectrum?.count ?? spectrumValues.length,
      scanStartCode,
      scanStopCode,
    );
    const nextPolarityInvert = inferPolarityInvertForMarker(spectrumValues, crossing, scanStartCode, scanStopCode);
    const template = buildAcquireTemplate({
      relativeValues: spectrumValues,
      crossing,
      ch1StartCode: scanStartCode,
      ch1StopCode: scanStopCode,
      lookbehindPoints: 64,
      searchHalfspanCode: numberFromInput(searchHalfspan.value),
    });
    const body = lockBody({
      target_adc: nextTargetAdc,
      bias_ch1: nextBiasCh1,
      polarity_invert: nextPolarityInvert,
    });
    return {
      targetAdc: nextTargetAdc,
      biasCh1: nextBiasCh1,
      polarityInvert: nextPolarityInvert,
      template,
      body,
    };
  };

  const acquireTemplateBody = (template: AcquireTemplate) => ({
    ...lockBody({
      target_adc: template.targetAdc,
      bias_ch1: template.markerCh1Code,
      polarity_invert: template.polarityInvert,
    }),
    marker_ch1_code: template.markerCh1Code,
    search_halfspan_code: numberFromInput(searchHalfspan.value),
    search_min_code: template.searchMinCode,
    search_max_code: template.searchMaxCode,
    acquire_threshold: numberFromInput(lockedThreshold.value),
    template_points: template.points,
  });

  const startLockFromMarker = async (crossing: LevelCrossing) => {
    if (lockBlockedByTec) {
      throw new Error("TEC must be On before side-fringe locking.");
    }
    const selection = buildMarkerLockSelection(crossing);
    setSelectedAcquireTemplate(selection.template);
    targetAdc.setDraftValue(String(selection.targetAdc));
    biasCh1.setDraftValue(String(selection.biasCh1));
    polarity.setDraftValue(selection.polarityInvert ? "invert" : "normal");
    freezeLockSnapshot(crossing.index, selection.biasCh1);

    if (lockMethod === "direct") {
      await client.post("/api/laser/lock-start", selection.body);
      releaseDrafts();
      return;
    }

    if (lockMethod === "board") {
      if (!boardAcquireSupported) {
        throw new Error("Board Match Lock requires updated laser-current HDL support.");
      }
      await client.acquireTemplate(acquireTemplateBody(selection.template));
      await client.acquireArm({});
      if (!monitoringOn) {
        await startMonitoring();
      }
      releaseDrafts();
    }
  };

  const showLockAcquisition = laserStatus.mode === "lock" && lockSnapshot !== null;
  const livePdSamples = useMemo(
    () =>
      state.trend
        .filter((sample) => typeof sample.pd === "number" && Number.isFinite(sample.pd))
        .slice(-1000),
    [state.trend],
  );
  const livePdValues = useMemo(() => livePdSamples.map((sample) => sample.pd as number), [livePdSamples]);
  const livePdCurrentValues = useMemo(
    () => livePdValues.map((value) => adcCodeToInputCurrentMicroamp(value, tzOhm, pdCurrentOffsetMicroamp)),
    [livePdValues, pdCurrentOffsetMicroamp, tzOhm],
  );
  const livePdModeWindows = useMemo(() => monitorModeWindows(livePdSamples), [livePdSamples]);
  const livePdModeHighlights = useMemo(
    () =>
      livePdModeWindows.map((window) => ({
        startIndex: window.startIndex,
        endIndex: window.endIndex,
        ...LIVE_PD_MODE_HIGHLIGHTS[window.mode],
      })),
    [livePdModeWindows],
  );
  const livePdRecordingWindows = useMemo(
    () =>
      monitorRecordingWindows(livePdSamples, [
        ...pdMonitorRecordedWindows,
        ...(pdMonitorStartTime !== null ? [{ startedAt: pdMonitorStartTime }] : []),
      ]),
    [livePdSamples, pdMonitorRecordedWindows, pdMonitorStartTime],
  );
  const livePdRecordingHighlights = useMemo(
    () =>
      livePdRecordingWindows.map((window) => ({
        startIndex: window.startIndex,
        endIndex: window.endIndex,
        color: "rgba(239, 68, 68, 0.17)",
        borderColor: "rgba(220, 38, 38, 0.6)",
      })),
    [livePdRecordingWindows],
  );
  const livePdHighlights = useMemo(
    () => [...livePdModeHighlights, ...livePdRecordingHighlights],
    [livePdModeHighlights, livePdRecordingHighlights],
  );
  const monitorRange = useMemo(() => {
    const series = [livePdCurrentValues];
    if (typeof lock?.target_adc === "number" && Number.isFinite(lock.target_adc)) {
      series.push([adcCodeToInputCurrentMicroamp(lock.target_adc, tzOhm, pdCurrentOffsetMicroamp)]);
    }
    return paddedRangeForSeries(series, 0.1);
  }, [lock?.target_adc, livePdCurrentValues, pdCurrentOffsetMicroamp, tzOhm]);
  const acquisitionMarkers = useMemo(() => {
    if (!lockSnapshot) return [];
    const markers = [
      {
        index: lockSnapshot.selectedReferenceIndex,
        color: "#f59e0b",
        label: `selected ${fmtInt(lockSnapshot.selectedCode)}`,
      },
    ];
    markers.push({
      index: lockSnapshot.referenceStopIndex,
      color: "#16a34a",
      label: `locked ${fmtInt(lockSnapshot.actualCode)}`,
    });
    return markers;
  }, [lockSnapshot]);

  const selectRecordingDirectory = async () => {
    const directory = await chooseDataDirectory();
    if (directory) setRecordBaseDir(directory);
  };

  const livePdMonitorPlot = (
    <div>
      <div className="plot-caption live-pd-caption">
        <span>Live PD monitor, latest {fmtInt(livePdValues.length)} status samples</span>
        <span className="monitor-mode-legend">
          <span><i className="mode-swatch static" />Static</span>
          <span><i className="mode-swatch scan" />Scan</span>
          <span><i className="mode-swatch lock" />Locking</span>
          <span><i className="mode-swatch recording" />Recorded</span>
        </span>
      </div>
      <PlotCanvas
        values={livePdCurrentValues}
        color="#2563eb"
        label="PD current"
        height={360}
        yRange={monitorRange}
        yTickFormatter={(value) => `${formatMicroamp(value)} uA`}
        rightAxisLabel="ADC code"
        rightTickFormatter={currentTickToAdcCodeLabel}
        highlightWindows={livePdHighlights}
        active={active}
      />
    </div>
  );

  return (
    <section className="panel lock-panel">
      <div className="panel-title-row">
        <h2>Side-Fringe Lock</h2>
        <div className="lock-mode-pill">
          <span className={`status-light ${laserStatus.level}`} />
          <strong>{laserStatus.label}</strong>
        </div>
      </div>

      <div className="lock-workbench">
        <div className="lock-card lock-operation-card">
          <div className="lock-card-header">
            <div>
              <h3>Spectrum Operation</h3>
              <p>Use Left / Right buttons or keyboard arrows on the selected row.</p>
            </div>
            <button
              className={`command monitor-toggle ${monitoringOn ? "monitor-on" : "monitor-off"}`}
              disabled={lockBlockedByTec && !monitoringOn}
              onClick={() => command(monitoringOn ? "Stop Spectrum Monitor" : "Start Spectrum Monitor", toggleMonitoring)}
            >
              {monitoringOn ? "Monitoring On" : "Monitoring Off"}
            </button>
          </div>
          {lockBlockedByTec && <div className="interlock-note">TEC must be On before side-fringe locking.</div>}

          <div className="operation-grid operation-grid-two-column">
            <OperationRow
              active={activeControl === "temperature"}
              label="Target Temperature C"
              value={targetTemp}
              step={tempStep}
              unit="C"
              onSelect={() => setActiveControl("temperature")}
              onStepChange={setTempStep}
              onNudge={(direction) => command("Adjust Target Temperature", () => nudgeControl("temperature", direction))}
              disabled={lockBlockedByTec}
            />
            <OperationRow
              active={activeControl === "scanCh0"}
              label="Scan CH0 Code"
              value={scanCh0}
              step={ch0Step}
              unit="code"
              onSelect={() => setActiveControl("scanCh0")}
              onStepChange={setCh0Step}
              onNudge={(direction) => command("Adjust Scan CH0", () => nudgeControl("scanCh0", direction))}
              disabled={lockBlockedByTec}
            />
            <OperationRow
              active={activeControl === "scanStart"}
              label="CH1 Start Code"
              value={scanStart}
              step={scanStartStep}
              unit="code"
              onSelect={() => setActiveControl("scanStart")}
              onStepChange={setScanStartStep}
              onNudge={(direction) => command("Adjust CH1 Start", () => nudgeControl("scanStart", direction))}
              disabled={lockBlockedByTec}
            />
            <OperationRow
              active={activeControl === "scanStop"}
              label="CH1 End Code"
              value={scanStop}
              step={scanStopStep}
              unit="code"
              onSelect={() => setActiveControl("scanStop")}
              onStepChange={setScanStopStep}
              onNudge={(direction) => command("Adjust CH1 End", () => nudgeControl("scanStop", direction))}
              disabled={lockBlockedByTec}
            />
          </div>

          <div className="operation-summary">
            <span>Scan rate {fmtNumber(scanRate, 3)} Hz</span>
            <span>Dwell {fmtInt(numberFromInput(dwell.value))}</span>
            <span>Settle {fmtInt(numberFromInput(settle.value))}</span>
          </div>

        </div>

        <div className="lock-card lock-spectrum-card">
          <div className="lock-card-header">
            <div>
              <h3>Spectrum View</h3>
              <p>Drag the right-side level handle. Click a highlighted green marker to lock with auto polarity.</p>
            </div>
            <div className="lock-view-controls lock-spectrum-toolbar">
              <button type="button" className="command compact" onClick={autoYOnce}>
                Auto Y Once
              </button>
              <label className="compact-field lock-toolbar-field">
                Tz Ohm
                <input value={tzOhmText} onChange={(event) => setTzOhmText?.(event.target.value)} />
              </label>
              <label className="inline-toggle">
                <input type="checkbox" checked={autoYContinuous} onChange={(event) => setAutoYContinuous(event.target.checked)} />
                Auto Update Y
              </label>
              <div className="lock-method-control lock-method-segmented" role="group" aria-label="Lock Method">
                <span>Lock Method</span>
                <button
                  type="button"
                  className={`method-pill ${lockMethod === "direct" ? "active" : ""}`}
                  disabled={lockBlockedByTec}
                  onClick={() => setLockMethod("direct")}
                >
                  Direct Lock
                </button>
                <button
                  type="button"
                  className={`method-pill ${lockMethod === "board" ? "active" : ""}`}
                  disabled={lockBlockedByTec || !boardAcquireSupported}
                  onClick={() => setLockMethod("board")}
                >
                  Board Match Lock
                </button>
              </div>
              <div className="candidate-counter lock-toolbar-counter">
                <strong>{fmtInt(crossings.length)}</strong>
                <span>candidates</span>
              </div>
            </div>
          </div>
          {showLockAcquisition && lockSnapshot ? (
            <div className="lock-acquisition-grid">
              <div>
                <div className="plot-caption">
                  acquisition frame {fmtInt(lockSnapshot.current.frameCounter)}, shift {fmtInt(lockSnapshot.match.shift)}, score{" "}
                  {fmtNumber(lockSnapshot.match.score, 3)}
                </div>
                <PlotCanvas
                  values={lockSnapshot.reference.values}
                  color="#7c3aed"
                  label="reference spectrum"
                  height={360}
                  yRange={lockedYRange}
                  yTickFormatter={relativeTickToCurrentLabel}
                  rightAxisLabel="ADC code"
                  rightTickFormatter={relativeTickToAdcCodeLabel}
                  active={active}
                  overlays={[
                    {
                      values: lockSnapshot.current.values,
                      color: "#0ea5e9",
                      label: "lock sweep",
                      lineWidth: 2.5,
                      alpha: 0.85,
                      xOffset: lockSnapshot.match.shift,
                      maxIndex: lockSnapshot.currentStopIndex,
                    },
                  ]}
                  verticalMarkers={acquisitionMarkers}
                  searchWindowHalfspan={searchWindowIndexSpan}
                />
              </div>
              {livePdMonitorPlot}
            </div>
          ) : (
            <div className="lock-acquisition-grid">
              <PlotCanvas
                values={spectrumValues}
                color="#7c3aed"
                label="input current"
                height={380}
                yRange={lockedYRange}
                yTickFormatter={relativeTickToCurrentLabel}
                rightAxisLabel="ADC code"
                rightTickFormatter={relativeTickToAdcCodeLabel}
                thresholdFormatter={relativeTickToCurrentLabel}
                threshold={threshold}
                onThresholdChange={setThreshold}
                crossings={crossings}
                searchWindowHalfspan={searchWindowIndexSpan}
                active={active}
                onCrossingClick={(crossing) => {
                  if (lockBlockedByTec) return;
                  void command(lockMethod === "direct" ? "Direct Lock From Marker" : "Board Match Lock From Marker", () =>
                    startLockFromMarker(crossing),
                  );
                }}
              />
              {livePdMonitorPlot}
            </div>
          )}
          <div className="recording-controls spectrum-recording-controls lock-data-recorder">
            <div className="recording-block">
              <h4>Idle Spectrum</h4>
              <label>
                Spectrum Name
                <input value={idleSpectrumName} onChange={(event) => setIdleSpectrumName(event.target.value)} />
              </label>
              <label>
                Spectrum Count
                <input value={spectrumRecordCount} disabled={spectrumRecording} onChange={(event) => setSpectrumRecordCount(event.target.value)} />
              </label>
              <div className="recording-actions">
                <button
                  type="button"
                  className="command compact"
                  disabled={lockingActive || !liveFrame || spectrumRecording}
                  onClick={() => command("Save Current Spectrum", saveCurrentSpectrum)}
                >
                  Save Current Spectrum
                </button>
                <button
                  type="button"
                  className={`command compact ${spectrumRecording ? "primary" : ""}`}
                  disabled={lockingActive || !liveFrame || spectrumRecording}
                  onClick={() => command("Record Spectra", startSpectrumRecording)}
                >
                  Record Spectra
                </button>
              </div>
              <span className={`recording-progress ${spectrumRecording ? "active" : ""}`}>
                {spectrumRecording ? `${recordedSpectra.length} / ${spectrumRecordTarget} spectra` : `${recordedSpectra.length} spectra ready`}
              </span>
            </div>

            <div className="recording-block">
              <h4>Lock Spectrum Pair</h4>
              <label>
                Pair Name
                <input value={lockSpectrumName} onChange={(event) => setLockSpectrumName(event.target.value)} />
              </label>
              <div className="recording-actions">
                <button
                  type="button"
                  className="command compact"
                  disabled={!lockSnapshot}
                  onClick={() => command("Save Lock Spectra", saveLockSpectrumPair)}
                >
                  Save Lock Spectra
                </button>
              </div>
              <span className="recording-progress">
                {lockSnapshot
                  ? `reference ${fmtInt(lockSnapshot.reference.frameCounter)}, locked ${fmtInt(lockSnapshot.current.frameCounter)}`
                  : "No lock pair captured yet"}
              </span>
            </div>

            <div className="recording-block">
              <h4>PD + Temperature Monitor</h4>
              <label>
                Monitor Name
                <input value={pdMonitorName} onChange={(event) => setPdMonitorName(event.target.value)} />
              </label>
              <div className="recording-actions">
                <button
                  type="button"
                  className={`command compact ${pdMonitorActive ? "danger" : ""}`}
                  onClick={() => command(pdMonitorActive ? "Finish Monitor" : "Start Monitor", togglePdMonitorRecording)}
                >
                  {pdMonitorActive ? "Finish Monitor" : "Start Monitor"}
                </button>
              </div>
              <span className={`recording-progress ${pdMonitorActive ? "active" : ""}`}>
                {pdMonitorActive
                  ? `Recording 50 Hz status since ${new Date((pdMonitorStartTime ?? 0) * 1000).toLocaleTimeString()}`
                  : "Saves PD and temperature from 50 Hz SSE status"}
              </span>
            </div>

            <div className="recording-footer">
              <button type="button" className="command compact" onClick={() => command("Select Recording Directory", selectRecordingDirectory)}>
                Save Directory
              </button>
              <div className="recording-status">
                <strong>{recordBaseDir || DEFAULT_RECORD_BASE_DIR_LABEL}</strong>
                <span>{recordingMessage}</span>
              </div>
            </div>
          </div>
        </div>

        <div className="lock-card lock-parameters-card">
          <div className="lock-card-header">
            <div>
              <h3>Lock Parameters</h3>
              <p>Update writes lock registers without entering lock mode. Marker clicks use these parameters when starting Direct or Board Match lock.</p>
            </div>
          </div>

          <div className="readouts lock-readouts">
            <div className="readout">
              <span>Lock Status</span>
              <strong>{lock?.status_hex ?? "--"}</strong>
              <div className="muted">{lock?.status_flags?.join(", ") || "none"}</div>
            </div>
            <div className="readout">
              <span>Target / Error</span>
              <strong>
                {fmtInt(lock?.target_adc)} / {fmtInt(lock?.error)}
              </strong>
            </div>
            <div className="readout">
              <span>Output CH1</span>
              <strong>{fmtInt(lock?.output_ch1_internal)}</strong>
              <div className="muted">{fmtNumber(lock?.output_ch1_current_mA, 4)} mA</div>
            </div>
            <div className="readout">
              <span>Counters</span>
              <strong>
                {fmtInt(lock?.locked_counter)} / {fmtInt(lock?.loss_counter)}
              </strong>
              <div className="muted">locked / loss</div>
            </div>
          </div>

          <div className="parameter-section">
            <h3>Setpoint</h3>
            <div className="parameter-row scan-row">
              <Field label="CH0 Coarse Code" input={scanCh0} disabled={lockBlockedByTec} />
              <Field label="Target ADC" input={targetAdc} disabled={lockBlockedByTec} />
              <Field label="CH1 Bias" input={biasCh1} disabled={lockBlockedByTec} />
              <Field label="CH1 Range Halfspan" input={halfspan} disabled={lockBlockedByTec} />
            </div>
          </div>

          <div className="parameter-section">
            <h3>PID</h3>
            <div className="parameter-row pid-row">
              <Field label="Kp" input={kp} disabled={lockBlockedByTec} />
              <Field label="Ki" input={ki} disabled={lockBlockedByTec} />
              <Field label="Max Step" input={maxStep} disabled={lockBlockedByTec} />
              <Field label="Integral Limit" input={integralLimit} disabled={lockBlockedByTec} />
            </div>
          </div>

          <div className="parameter-section">
            <h3>Lock Detection</h3>
            <div className="parameter-row scan-row">
              <Field label="Locked Threshold" input={lockedThreshold} disabled={lockBlockedByTec} />
              <Field label="Loss Threshold" input={lossThreshold} disabled={lockBlockedByTec} />
              <label>
                Polarity
                <select {...polarity.bind} disabled={lockBlockedByTec}>
                  <option value="normal">Normal</option>
                  <option value="invert">Invert</option>
                </select>
              </label>
            </div>
          </div>

          <div className="actions">
            <button className="command primary" disabled={lockBlockedByTec} onClick={() => command("Update Lock Parameters", updateLockParameters)}>
              Update Parameters
            </button>
            <button
              className="command neutral"
              disabled={laserStatus.mode !== "lock"}
              onClick={() => command("Stop Locking At Current Static Point", stopLockingAtCurrentPoint)}
            >
              Stop Locking
            </button>
          </div>
        </div>

        <div className="lock-card lock-acquire-card">
          <div className="lock-card-header">
            <div>
              <h3>Board-Matched Acquire</h3>
              <p>When Board Match Lock is selected, clicking a marker uploads its code window and polarity, then the PL locks at the next matching live crossing.</p>
            </div>
            <span className={`feature-pill ${boardAcquireSupported ? "ready" : "pending"}`}>
              {boardAcquireSupported ? "Hardware Ready" : "Waiting for HDL"}
            </span>
          </div>

          <div className="parameter-section">
            <h3>Search Window</h3>
            <div className="parameter-row scan-row">
              <Field label="Board Search Halfspan" input={searchHalfspan} disabled={lockBlockedByTec} />
            </div>
          </div>

          <div className="readouts lock-readouts">
            <div className="readout">
              <span>Selected Marker</span>
              <strong>{selectedAcquireTemplate ? fmtInt(selectedAcquireTemplate.displayMarkerIndex) : "--"}</strong>
              <div className="muted">display index</div>
            </div>
            <div className="readout">
              <span>Marker CH1 Code</span>
              <strong>{selectedAcquireTemplate ? fmtInt(selectedAcquireTemplate.markerCh1Code) : "--"}</strong>
              <div className="muted">code-domain anchor</div>
            </div>
            <div className="readout">
              <span>Target ADC</span>
              <strong>{selectedAcquireTemplate ? fmtInt(selectedAcquireTemplate.targetAdc) : "--"}</strong>
              <div className="muted">{selectedAcquireTemplate?.polarityInvert ? "invert polarity" : "normal polarity"}</div>
            </div>
            <div className="readout">
              <span>Template</span>
              <strong>{selectedAcquireTemplate ? fmtInt(selectedAcquireTemplate.points.length) : "--"}</strong>
              <div className="muted">
                spacing {selectedAcquireTemplate ? fmtInt(selectedAcquireTemplate.templateSpacingCode) : "--"} code
              </div>
            </div>
          </div>

          <div className="acquire-summary">
            {selectedAcquireTemplate ? (
              <>
                <span>
                  Search {fmtInt(selectedAcquireTemplate.searchMinCode)} to {fmtInt(selectedAcquireTemplate.searchMaxCode)}
                </span>
                <span>
                  Code offsets {fmtInt(selectedAcquireTemplate.points[0]?.codeOffset)} to{" "}
                  {fmtInt(selectedAcquireTemplate.points[selectedAcquireTemplate.points.length - 1]?.codeOffset)}
                </span>
              </>
            ) : (
              <span>Click a green marker to select a lock point. The selected Lock Method controls what happens immediately.</span>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
