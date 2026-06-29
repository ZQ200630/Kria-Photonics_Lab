import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fmtInt, parseNumber } from "../utils/format";
import {
  adcCaptureEndCounts,
  axisCenterFromStartStep,
  axisEndFromStartStep,
  axisRangeFromStartStep,
  axisStartStepFromCenterRange,
  axisStartStepFromEndpoints,
  captureTimeSecondsForServerStart,
  captureProgressSnapshot,
  constrainedTimingCounts,
  countsFromDurationDisplay,
  countsFromRateDisplay,
  DEFAULT_SCAN_SCALE_COUNTS,
  DEFAULT_SCAN_SCALE_UM,
  durationDisplayFromCounts,
  estimatedCaptureCountsFromParams,
  estimatedCaptureSecondsFromParams,
  expectedFramesFromParams,
  loadPaScanDefaults,
  laserEndCounts,
  paCanvasRoiFromScanParams,
  paFineScanParamsFromImageRoi,
  paLivePreviewIntervalMs,
  paLivePreviewMinFrameDelta,
  paImagePixelToScanPoint,
  paImageZoomToScanRange,
  paScanDefaultsFromParams,
  paPreviewSourceAfterScanComplete,
  paZoomCommitStateFromRoi,
  PAM_TIMING_CLOCK_HZ,
  PAM_ADC_CAPTURE_COUNTS,
  PAM_ADC_CAPTURE_SAMPLES,
  PAM_ADC_POST_BUFFER_COUNTS,
  PAM_ADC_SAMPLE_NS,
  PAM_LASER_EMISSION_DELAY_COUNTS,
  rateDisplayFromGapCounts,
  requiredGapCounts,
  returnModeInfo,
  runPaLivePreviewUpdate,
  scanResolutionUmFromStep,
  scanModeInfo,
  scanParamsWithDefaults,
  scanUmPerCountFromCalibration,
  savePaScanDefaults,
  shouldRefreshPaLivePreview,
  shouldShowCaptureProgress,
  timingDetailEndCounts,
  type DurationUnit,
  type PamTimingCounts,
  type PamTimingField,
  type PaScanDefaults,
  type RateUnit,
} from "../utils/paImaging";
import type {
  PaAxisCaptureStatus,
  PaCaptureParams,
  PaCaptureStatus,
  PaDiagnostics,
  PaPlCounters,
  PaSchedulerStatus,
  PaStreamDiagnostics,
} from "../api/types";
import type { PanelProps } from "./types";
import { DEFAULT_PD_ZERO_ADC_CODE } from "../utils/ada4355";
import { DEFAULT_PA_IMAGE_PROCESSING, formatUnknownError, loadPaImageProcessingDefaults } from "../utils/paImage";
import { readPaLiveImage, setPaLiveImageProcessing, type PaImageBuildResult } from "../utils/paImageTauri";
import {
  formatSchedulerPosition,
  PA_SCHED_CMD_ABORT_AND_PARK,
  PA_SCHED_CMD_STOP,
  PA_SCHED_CTRL_LD_ENABLE,
  PA_SCHED_CTRL_LOOP_ENABLE,
  schedulerCaptureText,
  schedulerModeLabel,
} from "../utils/paScheduler";
import {
  paReceiverStartWithTimeout,
  paReceiverStatusWithTimeout,
  paReceiverStopWithTimeout,
  type PaReceiverStatus,
} from "../utils/paStreamReceiver";
import { storageCopyFileToPaTmp, storageMetadataFile, storagePreparePaTmp, storageSaveMixedRecord } from "../utils/storage";
import { safeRunName } from "../utils/lockRecording";
import { useSyncedInput } from "../utils/syncedInput";
import PaImageHeatmap from "./PaImageHeatmap";
import type {
  PaImageAxisLabels,
  PaImagePixel,
  PaImageRoiAspectRatio,
  PaImageZoomDomain,
} from "./PaImageHeatmap";
import { paImageCountsOrEmpty, paImageValuesOrEmpty } from "./PaImageHeatmap";
import PaImageViewer from "./PaImageViewer";
import PaSeriesViewer from "./PaSeriesViewer";
import ErrorBoundary from "./ErrorBoundary";

type TextState = string;
type PaPanelView = "capture" | "timing" | "scan" | "image" | "series";
type PaSchedulerTab = "auto" | "point" | "manual" | "waveform" | "diagnostics";
type ScanAxisInputMode = "endpoints" | "centerRange";
type PaPreviewSource = "current" | "canvas";
type PaCanvasRoiSource = "manual" | "fineScan" | null;
type PaImagingPanelProps = PanelProps & {
  initialView?: PaPanelView;
  initialSchedulerTab?: PaSchedulerTab;
};

const DEFAULT_SCAN_TARGET_RANGE_COUNTS = 4000;
const DEFAULT_SCAN_POINTS = 400;
const DEFAULT_SCAN_AXIS = axisStartStepFromCenterRange(0, DEFAULT_SCAN_TARGET_RANGE_COUNTS, DEFAULT_SCAN_POINTS);

const DEFAULT_PARAMS: PaCaptureParams = {
  x_start: DEFAULT_SCAN_AXIS.start,
  x_step: DEFAULT_SCAN_AXIS.step,
  x_points: DEFAULT_SCAN_POINTS,
  y_start: DEFAULT_SCAN_AXIS.start,
  y_step: DEFAULT_SCAN_AXIS.step,
  y_points: DEFAULT_SCAN_POINTS,
  frame_number: 1,
  task_id: 1,
  gap_time: 33333,
  galvo_settle_time: 1000,
  ld_trigger_time: 200,
  adc_trigger_time: 100,
  ld_time: 400,
  scan_mode: 1,
  return_mode: 0,
};

const WAIT_FOR_RECEIVER_READY_MS = 1_200;
const RECEIVER_READY_POLL_MS = 100;
const PA_START_TIMEOUT_MS = 5_000;
const SERVER_PREPARE_POLL_MS = 150;
const SERVER_PREPARE_TIMEOUT_MS = 2_000;
const PA_RECEIVER_CMD_TIMEOUT_MS = 4_000;
const DEFAULT_PA_TCP_PORT = 9090;
const DEFAULT_PA_MAX_BLOCKS = -1;

function numberFromText(text: string, fallback = 0): number {
  const parsed = parseNumber(text);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clampPositiveInteger(value: number, fallback: number): number {
  return Number.isFinite(value) && Number.isInteger(value) && value > 0 ? value : fallback;
}

function clampInteger(value: number, fallback: number): number {
  return Number.isFinite(value) && Number.isInteger(value) ? value : fallback;
}

function scanKeyFromParams(params: PaCaptureParams): string {
  return [
    params.x_start,
    params.x_step,
    params.x_points,
    params.y_start,
    params.y_step,
    params.y_points,
    params.frame_number,
    params.scan_mode,
    params.return_mode,
  ].join(":");
}

function maybeText(value: number | undefined): TextState {
  return typeof value === "number" && Number.isFinite(value) ? String(Math.round(value)) : "";
}

function paImageSummary(image: PaImageBuildResult | null) {
  if (!image) return null;
  return {
    path: image.path,
    width: image.width,
    height: image.height,
    x_start: image.x_start,
    x_end: image.x_end,
    y_start: image.y_start,
    y_end: image.y_end,
    pixel_count: image.pixel_count,
    frame_count: image.frame_count,
    bad_frame_count: image.bad_frame_count,
    severity: image.severity,
    issue_count: image.issues.length,
    issues: image.issues.slice(0, 20),
  };
}

function compactNumber(value: number, digits = 4): string {
  if (!Number.isFinite(value)) return "0";
  const rounded = Math.round(value * 10 ** digits) / 10 ** digits;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded).replace(/0+$/, "").replace(/\.$/, "");
}

function physicalText(counts: number, umPerCount: number): string {
  return `${compactNumber(counts * umPerCount, 2)} um`;
}

function toDisplayStatus(pa: PaCaptureStatus | null): string {
  if (!pa) return "no status";
  if (pa.stop_requested) return "requested stop";
  if (pa.running) return "running";
  if (pa.connected) return "connected";
  if (pa.last_error) return `error: ${pa.last_error}`;
  return "idle";
}

function toReceiverStatus(status: PaReceiverStatus | null): string {
  if (!status) return "unknown";
  if (!status.running && !status.connected) return "idle";
  if (status.stop_requested) return "stopping";
  if (status.running) return "running";
  if (status.connected) return "connected";
  return "unknown";
}

function toListenerStatus(diagnostics: PaDiagnostics | null): string {
  const listener = diagnostics?.tcp_listener;
  if (!listener) return "unknown";
  if (listener.listening && listener.thread_alive) return "listening";
  if (listener.listening) return "bound";
  return "stopped";
}

function diagnosticProblemCount(diagnostics: PaStreamDiagnostics | undefined): number {
  if (!diagnostics) return 0;
  return (
    (diagnostics.record_sequence_gaps ?? 0) +
    (diagnostics.block_id_gaps ?? 0) +
    (diagnostics.frame_id_gaps ?? 0) +
    (diagnostics.global_shot_gaps ?? 0) +
    (diagnostics.frame_count_mismatches ?? 0) +
    (diagnostics.malformed_blocks ?? 0) +
    (diagnostics.malformed_frames ?? 0) +
    (diagnostics.metadata_parse_errors ?? 0)
  );
}

function diagnosticShortText(diagnostics: PaStreamDiagnostics | undefined): string {
  if (!diagnostics) return "no diagnostics";
  return `blocks ${fmtInt(diagnostics.blocks_checked)} frames ${fmtInt(diagnostics.frames_checked)} gaps ${fmtInt(
    diagnosticProblemCount(diagnostics),
  )}`;
}

function firstDiagnosticIssue(...diagnosticsList: Array<PaStreamDiagnostics | undefined>): string {
  for (const diagnostics of diagnosticsList) {
    const issue = diagnostics?.issues?.[0];
    if (issue?.message) return issue.message;
  }
  return "";
}

function axisStatusDropCount(status: PaAxisCaptureStatus | undefined | null): number {
  if (!status) return 0;
  return (status.dropped_frames ?? 0) + (status.dropped_blocks ?? 0);
}

function axisStatusFaultCount(status: PaAxisCaptureStatus | undefined | null): number {
  if (!status) return 0;
  return (
    axisStatusDropCount(status) +
    (status.done_q_overflow_count ?? 0) +
    (status.aggregate_fail_count ?? 0) +
    (status.rearm_fail_count ?? 0) +
    (status.copy_to_user_fault_count ?? 0)
  );
}

function axisStatusShortText(status: PaAxisCaptureStatus | undefined | null): string {
  if (!status) return "driver status unavailable";
  return `completed ${fmtInt(status.completed_frames)} aggregated ${fmtInt(status.aggregated_frames)} dropped ${fmtInt(
    axisStatusDropCount(status),
  )}`;
}

function driverHealthText(status: PaAxisCaptureStatus | undefined | null): string {
  if (!status) return "driver counters unavailable";
  return `rearm ${fmtInt(status.rearm_count)} overflow ${fmtInt(status.done_q_overflow_count)} active min ${fmtInt(
    status.active_dma_low_watermark,
  )}`;
}

type PaStateTone = "idle" | "running" | "complete" | "warning" | "error";

function paStateToneLabel(tone: PaStateTone): string {
  if (tone === "error") return "Error";
  if (tone === "running") return "Running";
  if (tone === "complete") return "Idle";
  if (tone === "warning") return "Attention";
  return "Idle";
}

function paStateIndicator({
  lastError,
  serverPa,
  receiverStatus,
  listenerStatus,
  acquisitionFaultCount,
  acquisitionWaitCount,
  continuityProblemCount,
  processedFrames,
  expectedFrames,
}: {
  lastError: string | undefined;
  serverPa: PaCaptureStatus | null;
  receiverStatus: PaReceiverStatus | null;
  listenerStatus: PaDiagnostics["tcp_listener"];
  acquisitionFaultCount: number;
  acquisitionWaitCount: number;
  continuityProblemCount: number;
  processedFrames: number;
  expectedFrames: number;
}): { tone: PaStateTone; label: string; summary: string } {
  const captureComplete = expectedFrames > 0 && processedFrames >= expectedFrames;
  let tone: PaStateTone = "idle";
  if (lastError || acquisitionFaultCount > 0) {
    tone = "error";
  } else if (captureComplete) {
    tone = "complete";
  } else if (serverPa?.running || receiverStatus?.running) {
    tone = "running";
  } else if (continuityProblemCount > 0 || acquisitionWaitCount > 0) {
    tone = "warning";
  }

  const captureText = expectedFrames > 0
    ? `${fmtInt(processedFrames)} / ${fmtInt(expectedFrames)} frames`
    : `${fmtInt(processedFrames)} frames`;
  const receiverText = receiverStatus?.phase || toReceiverStatus(receiverStatus);
  const listenerText = listenerStatus?.listening ? "TCP listening" : "TCP idle";
  const problemText = lastError
    ? lastError
    : acquisitionFaultCount > 0
      ? `${fmtInt(acquisitionFaultCount)} acquisition faults`
      : captureComplete
        ? `${captureText} complete`
      : continuityProblemCount > 0
        ? `${fmtInt(continuityProblemCount)} continuity issues`
        : acquisitionWaitCount > 0
          ? `${fmtInt(acquisitionWaitCount)} waits`
          : `${captureText} · ${receiverText} · ${listenerText}`;

  return {
    tone,
    label: paStateToneLabel(tone),
    summary: problemText,
  };
}

function plCounterValue(counters: PaPlCounters | undefined | null, key: keyof PaPlCounters): number {
  const value = counters?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function plCounterFaultCount(counters: PaPlCounters | undefined | null): number {
  if (!counters) return 0;
  if (counters.error) return 1;
  const hasFault = (plCounterValue(counters, "status") & 1) !== 0 || plCounterValue(counters, "fault_code") !== 0;
  return (
    (hasFault ? 1 : 0) +
    plCounterValue(counters, "axis_stall_events") +
    plCounterValue(counters, "fifo_overflow_count")
  );
}

function plCounterWaitCount(counters: PaPlCounters | undefined | null): number {
  return plCounterValue(counters, "rejected_trigger_busy_count") + plCounterValue(counters, "busy_hold_events");
}

function plHealthText(counters: PaPlCounters | undefined | null): string {
  if (!counters) return "PL counters unavailable";
  if (counters.error) return counters.error;
  return `accepted ${fmtInt(plCounterValue(counters, "accepted_trigger_count"))} waits ${fmtInt(
    plCounterWaitCount(counters),
  )} fault ${fmtInt(plCounterValue(counters, "fault_code"))}`;
}

const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

function durationText(counts: number): string {
  const display = durationDisplayFromCounts(counts);
  return `${display.value} ${display.unit}`;
}

function secondsText(seconds: number): string {
  return durationText(Math.round(Math.max(0, seconds) * PAM_TIMING_CLOCK_HZ));
}

function rateText(counts: number): string {
  const display = rateDisplayFromGapCounts(counts);
  return `${display.value} ${display.unit}`;
}

type DurationCountFieldProps = {
  label: string;
  counts: number;
  onCommit: (counts: number) => void;
};

function DurationCountField({ label, counts, onCommit }: DurationCountFieldProps) {
  const display = durationDisplayFromCounts(counts);
  const [value, setValue] = useState(display.value);
  const [unit, setUnit] = useState<DurationUnit>(display.unit);

  useEffect(() => {
    setValue(display.value);
    setUnit(display.unit);
  }, [display.value, display.unit]);

  const commit = (nextValue = value, nextUnit = unit) => {
    onCommit(countsFromDurationDisplay(nextValue, nextUnit));
  };

  return (
    <label className="unit-field">
      {label}
      <div className="unit-input-row">
        <input
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onBlur={() => commit()}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              commit();
            }
          }}
        />
        <select
          value={unit}
          onChange={(event) => {
            const nextUnit = event.target.value as DurationUnit;
            setUnit(nextUnit);
            commit(value, nextUnit);
          }}
        >
          <option value="ns">ns</option>
          <option value="us">us</option>
          <option value="ms">ms</option>
          <option value="s">s</option>
        </select>
      </div>
      <span className="field-note">{fmtInt(counts)} counts</span>
    </label>
  );
}

type RateFieldProps = {
  gapCounts: number;
  onCommit: (counts: number) => void;
};

function RateField({ gapCounts, onCommit }: RateFieldProps) {
  const display = rateDisplayFromGapCounts(gapCounts);
  const [value, setValue] = useState(display.value);
  const [unit, setUnit] = useState<RateUnit>(display.unit);

  useEffect(() => {
    setValue(display.value);
    setUnit(display.unit);
  }, [display.value, display.unit]);

  const commit = (nextValue = value, nextUnit = unit) => {
    onCommit(countsFromRateDisplay(nextValue, nextUnit));
  };

  return (
    <label className="unit-field">
      Repetition Rate
      <div className="unit-input-row">
        <input
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onBlur={() => commit()}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              commit();
            }
          }}
        />
        <select
          value={unit}
          onChange={(event) => {
            const nextUnit = event.target.value as RateUnit;
            setUnit(nextUnit);
            commit(value, nextUnit);
          }}
        >
          <option value="Hz">Hz</option>
          <option value="kHz">kHz</option>
          <option value="MHz">MHz</option>
        </select>
      </div>
      <span className="field-note">from gap_time</span>
    </label>
  );
}

type ScanModeFieldProps = {
  mode: 0 | 1;
  detail: string;
  onChange: (mode: 0 | 1) => void;
};

function ScanModeField({ mode, detail, onChange }: ScanModeFieldProps) {
  return (
    <div className="unit-field scan-mode-field">
      <span>Scan Mode</span>
      <div className="scan-mode-segmented" role="group" aria-label="PA scan mode">
        <button type="button" className={`method-pill ${mode === 1 ? "active" : ""}`} onClick={() => onChange(1)}>
          Serpentine
        </button>
        <button type="button" className={`method-pill ${mode === 0 ? "active" : ""}`} onClick={() => onChange(0)}>
          Flyback
        </button>
      </div>
      <span className="field-note">{detail}</span>
    </div>
  );
}

type ReturnModeFieldProps = {
  mode: 0 | 1;
  detail: string;
  onChange: (mode: 0 | 1) => void;
};

function ReturnModeField({ mode, detail, onChange }: ReturnModeFieldProps) {
  return (
    <div className="unit-field scan-mode-field">
      <span>Return Position</span>
      <div className="scan-mode-segmented" role="group" aria-label="PA return position">
        <button type="button" className={`method-pill ${mode === 0 ? "active" : ""}`} onClick={() => onChange(0)}>
          Center
        </button>
        <button type="button" className={`method-pill ${mode === 1 ? "active" : ""}`} onClick={() => onChange(1)}>
          Start
        </button>
      </div>
      <span className="field-note">{detail}</span>
    </div>
  );
}

type ScanAxisControlGroupProps = {
  label: string;
  mode: ScanAxisInputMode;
  startText: string;
  stepText: string;
  pointsText: string;
  rangeText?: string;
  setStartText: (value: string) => void;
  setStepText: (value: string) => void;
  setPointsText: (value: string) => void;
  setRangeText?: (value: string) => void;
  onToggleMode: () => void;
};

function ScanAxisControlGroup({
  label,
  mode,
  startText,
  stepText,
  pointsText,
  rangeText,
  setStartText,
  setStepText,
  setPointsText,
  setRangeText,
  onToggleMode,
}: ScanAxisControlGroupProps) {
  const start = numberFromText(startText, 0);
  const step = numberFromText(stepText, 0);
  const points = clampPositiveInteger(Math.round(numberFromText(pointsText, 1)), 1);
  const end = axisEndFromStartStep(start, step, points);
  const center = axisCenterFromStartStep(start, step, points);
  const range = axisRangeFromStartStep(start, step, points);
  const endInput = useSyncedInput(compactNumber(end), compactNumber(end));
  const centerInput = useSyncedInput(compactNumber(center), compactNumber(center));
  const rangeReadback = rangeText ?? compactNumber(range);
  const rangeInput = useSyncedInput(rangeReadback, rangeReadback);
  const applyEndpoints = (nextStart: number, nextEnd: number, nextPoints: number) => {
    const next = axisStartStepFromEndpoints(nextStart, nextEnd, nextPoints);
    setStartText(String(next.start));
    setStepText(String(next.step));
  };
  const applyCenterRange = (nextCenter: number, nextRange: number, nextPoints: number) => {
    const next = axisStartStepFromCenterRange(nextCenter, nextRange, nextPoints);
    setStartText(String(next.start));
    setStepText(String(next.step));
  };
  const commitEnd = () => {
    applyEndpoints(start, numberFromText(endInput.value, end), points);
    endInput.release();
  };
  const commitCenter = () => {
    applyCenterRange(numberFromText(centerInput.value, center), numberFromText(rangeInput.value, range), points);
    centerInput.release();
  };
  const commitRange = () => {
    const nextRange = rangeInput.value;
    setRangeText?.(nextRange);
    applyCenterRange(center, numberFromText(nextRange, range), points);
    rangeInput.release();
  };
  const handlePointsChange = (value: string) => {
    const nextPoints = clampPositiveInteger(Math.round(numberFromText(value, points)), points);
    setPointsText(value);
    if (mode === "endpoints") {
      applyEndpoints(start, end, nextPoints);
    } else {
      applyCenterRange(center, numberFromText(rangeInput.value, range), nextPoints);
    }
  };

  return (
    <section
      className="pa-scan-group"
      aria-label={label}
      onContextMenu={(event) => {
        event.preventDefault();
        onToggleMode();
      }}
      title="Right-click to switch input mode"
    >
      <div className="pa-scan-group-title">
        <h4>{label}</h4>
        <span>{mode === "endpoints" ? "Start / End" : "Center / Range"}</span>
      </div>
      <div className="fields pa-scan-group-fields">
        {mode === "endpoints" ? (
          <>
            <label>
              Start
              <input
                value={startText}
                onChange={(event) => {
                  const nextStart = numberFromText(event.target.value, start);
                  const nextAxis = axisStartStepFromEndpoints(nextStart, end, points);
                  setStartText(event.target.value);
                  setStepText(String(nextAxis.step));
                }}
              />
            </label>
            <label>
              End
              <input
                value={endInput.value}
                onFocus={endInput.bind.onFocus}
                onChange={endInput.bind.onChange}
                onBlur={commitEnd}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.currentTarget.blur();
                  }
                }}
              />
            </label>
          </>
        ) : (
          <>
            <label>
              Center
              <input
                value={centerInput.value}
                onFocus={centerInput.bind.onFocus}
                onChange={centerInput.bind.onChange}
                onBlur={commitCenter}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.currentTarget.blur();
                  }
                }}
              />
            </label>
            <label>
              Range
              <input
                value={rangeInput.value}
                onFocus={rangeInput.bind.onFocus}
                onChange={rangeInput.bind.onChange}
                onBlur={commitRange}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.currentTarget.blur();
                  }
                }}
              />
            </label>
          </>
        )}
        <label>
          Points
          <input value={pointsText} onChange={(event) => handlePointsChange(event.target.value)} />
        </label>
      </div>
    </section>
  );
}

type ScanPreviewProps = {
  params: PaCaptureParams;
  mode: ReturnType<typeof scanModeInfo>;
  umPerCount: number;
};

function ScanPreview({ params, mode, umPerCount }: ScanPreviewProps) {
  const xPoints = clampPositiveInteger(Number(params.x_points), 1);
  const yPoints = clampPositiveInteger(Number(params.y_points), 1);
  const frameCount = clampPositiveInteger(Number(params.frame_number), 1);
  const xStartValue = clampInteger(Number(params.x_start), 0);
  const yStartValue = clampInteger(Number(params.y_start), 0);
  const xStepValue = clampInteger(Number(params.x_step), 1);
  const yStepValue = clampInteger(Number(params.y_step), 1);
  const xEndValue = axisEndFromStartStep(xStartValue, xStepValue, xPoints);
  const yEndValue = axisEndFromStartStep(yStartValue, yStepValue, yPoints);
  const xResolutionUm = scanResolutionUmFromStep(xStepValue, umPerCount);
  const yResolutionUm = scanResolutionUmFromStep(yStepValue, umPerCount);
  const previewCols = Math.min(xPoints, 6);
  const previewRows = Math.min(yPoints, 4);
  const viewWidth = 360;
  const viewHeight = 202;
  const left = 58;
  const right = 302;
  const top = 42;
  const bottom = 134;
  const isSinglePreviewPoint = previewCols === 1 && previewRows === 1;
  const pointX = (col: number) => (previewCols === 1 ? (left + right) / 2 : left + (col / (previewCols - 1)) * (right - left));
  const pointY = (rowFromBottom: number) =>
    previewRows === 1 ? (top + bottom) / 2 : bottom - (rowFromBottom / (previewRows - 1)) * (bottom - top);
  const rowColumns = (row: number) =>
    mode.value === 1 && row % 2 === 1
      ? Array.from({ length: previewCols }, (_, index) => previewCols - 1 - index)
      : Array.from({ length: previewCols }, (_, index) => index);
  const scanRows =
    isSinglePreviewPoint
      ? null
      : previewCols === 1
        ? (
            <path
              className="scan-preview-path"
              d={`M ${pointX(0)} ${pointY(0)} L ${pointX(0)} ${pointY(previewRows - 1)}`}
            />
          )
        : Array.from({ length: previewRows }, (_, row) => {
            const cols = rowColumns(row);
            return (
              <path
                key={`scan-row-${row}`}
                className="scan-preview-path"
                d={`M ${pointX(cols[0])} ${pointY(row)} L ${pointX(cols[cols.length - 1])} ${pointY(row)}`}
              />
            );
          });
  const rowConnectors =
    isSinglePreviewPoint || previewRows <= 1
      ? null
      : Array.from({ length: previewRows - 1 }, (_, row) => {
          const cols = rowColumns(row);
          const nextCols = rowColumns(row + 1);
          return mode.value === 1 ? (
            <path
              key={`scan-connector-${row}`}
              className="scan-preview-connector"
              d={`M ${pointX(cols[cols.length - 1])} ${pointY(row)} L ${pointX(nextCols[0])} ${pointY(row + 1)}`}
            />
          ) : (
            <path
              key={`scan-return-${row}`}
              className="scan-preview-return"
              d={`M ${pointX(previewCols - 1)} ${pointY(row)} L ${pointX(0)} ${pointY(row + 1)}`}
            />
          );
        });
  const dots = Array.from({ length: previewRows }, (_, row) =>
    Array.from({ length: previewCols }, (_, col) => (
      <circle key={`scan-dot-${row}-${col}`} className="scan-preview-dot" cx={pointX(col)} cy={pointY(row)} r="3.8" />
    )),
  ).flat();
  const truncatedX = xPoints > previewCols;
  const truncatedY = yPoints > previewRows;

  return (
    <div className="pa-scan-preview">
      <div className="pa-scan-preview-heading">
        <span>Scan Preview</span>
        <strong>{mode.label}</strong>
      </div>
      <svg viewBox={`0 0 ${viewWidth} ${viewHeight}`} role="img" aria-label="PA scan grid preview">
        <defs>
          <marker id="pa-scan-arrow" markerWidth="6" markerHeight="6" refX="6" refY="3" orient="auto">
            <path d="M 0 0 L 6 3 L 0 6 z" />
          </marker>
        </defs>
        <text className="scan-preview-axis-label" x={(left + right) / 2} y="23" textAnchor="middle">
          X Axis
        </text>
        <text className="scan-preview-axis-label" x="18" y={(top + bottom) / 2} textAnchor="middle" transform={`rotate(-90 18 ${(top + bottom) / 2})`}>
          Y Axis
        </text>
        <rect className="scan-preview-frame" x={left - 20} y={top - 16} width={right - left + 40} height={bottom - top + 32} />
        {rowConnectors}
        {dots}
        {scanRows}
        {truncatedX ? <text className="scan-preview-more" x={right + 20} y={(top + bottom) / 2}>...</text> : null}
        {truncatedY ? <text className="scan-preview-more" x={(left + right) / 2} y={bottom + 30} textAnchor="middle">...</text> : null}
      </svg>
      <div className="pa-scan-preview-metrics">
        <div>
          <span>Grid</span>
          <strong>{fmtInt(xPoints)} x {fmtInt(yPoints)}</strong>
        </div>
        <div>
          <span>X Range</span>
          <strong>{physicalText(xStartValue, umPerCount)} to {physicalText(xEndValue, umPerCount)}</strong>
        </div>
        <div>
          <span>Y Range</span>
          <strong>{physicalText(yStartValue, umPerCount)} to {physicalText(yEndValue, umPerCount)}</strong>
        </div>
        <div>
          <span>Resolution</span>
          <strong>{compactNumber(xResolutionUm, 3)} / {compactNumber(yResolutionUm, 3)} um</strong>
        </div>
        <div>
          <span>Frames</span>
          <strong>{fmtInt(frameCount)}</strong>
        </div>
      </div>
    </div>
  );
}

type TimingDiagramProps = {
  timing: PamTimingCounts;
};

function TimingDiagram({ timing }: TimingDiagramProps) {
  const settle = timing.galvo_settle_time;
  const gap = timing.gap_time;
  const requiredGap = requiredGapCounts(timing);
  const laserStart = settle + timing.ld_trigger_time;
  const laserEnd = laserEndCounts(timing);
  const adcStart = settle + timing.adc_trigger_time;
  const adcEnd = adcCaptureEndCounts(timing);
  const detailEnd = timingDetailEndCounts(timing);
  const viewWidth = 1120;
  const graphWidth = 760;
  const left = (viewWidth - graphWidth) / 2;
  const right = left + graphWidth;
  const labelX = left - 154;
  const detailScale = (timeCounts: number) => left + (Math.max(0, Math.min(timeCounts, detailEnd)) / detailEnd) * (right - left);
  const overviewScale = (frameCounts: number) => left + (Math.max(0, frameCounts) / Math.max(gap, 1)) * (right - left);
  const requiredX = overviewScale(requiredGap);
  const requiredDetailX = detailScale(requiredGap);
  const settleStartX = detailScale(0);
  const settleEndX = detailScale(settle);
  const settleWidth = settleEndX - settleStartX;
  const laserEmissionX = detailScale(laserStart + PAM_LASER_EMISSION_DELAY_COUNTS);
  const y = {
    overview: 46,
    pixel: 132,
    frame: 176,
    galvo: 220,
    laser: 264,
    adc: 308,
    detailTotal: 332,
  };
  const row = (label: string, rowY: number) => (
    <>
      <text className="timing-row-label" x={labelX} y={rowY + 4}>
        {label}
      </text>
      <line className="timing-baseline" x1={left} y1={rowY} x2={right} y2={rowY} />
    </>
  );
  const pulse = (xStart: number, xEnd: number, rowY: number, className: string, minWidth = 10) => (
    <path
      className={className}
      d={`M ${xStart} ${rowY} L ${xStart} ${rowY - 24} L ${Math.max(xEnd, xStart + minWidth)} ${rowY - 24} L ${Math.max(xEnd, xStart + minWidth)} ${rowY}`}
    />
  );
  const detailMarkerLine = (timeCounts: number, className = "timing-marker") => {
    const x = detailScale(timeCounts);
    return <line className={className} x1={x} y1="108" x2={x} y2="320" />;
  };

  return (
    <div className="pa-timing-diagram">
      <svg viewBox={`0 0 ${viewWidth} 358`} role="img" aria-label="PA timing diagram">
        <defs>
          <marker id="pa-timing-arrow" markerWidth="8" markerHeight="8" refX="4" refY="4" orient="auto-start-reverse">
            <path d="M 0 0 L 8 4 L 0 8 z" />
          </marker>
        </defs>
        <text className="timing-row-label" x={labelX} y={y.overview + 4}>
          Frame Period
        </text>
        <line className="timing-baseline timing-overview-line" x1={left} y1={y.overview} x2={right} y2={y.overview} />
        <line className="timing-marker" x1={left} y1={y.overview - 28} x2={left} y2={y.overview + 24} />
        <line className="timing-marker timing-required-marker" x1={requiredX} y1={y.overview - 28} x2={requiredX} y2={y.overview + 24} />
        <line className="timing-marker" x1={right} y1={y.overview - 28} x2={right} y2={y.overview + 24} />
        <line
          className="timing-dimension"
          x1={left}
          y1={y.overview + 34}
          x2={right}
          y2={y.overview + 34}
          markerStart="url(#pa-timing-arrow)"
          markerEnd="url(#pa-timing-arrow)"
        />
        <text className="timing-dimension-label" x={(left + right) / 2} y={y.overview + 52} textAnchor="middle">
          {durationText(gap)} / {rateText(gap)}
        </text>
        {row("Pixel Start", y.pixel)}
        {row("Frame Start", y.frame)}
        {row("Galvo", y.galvo)}
        {row("Laser", y.laser)}
        {row("ADC", y.adc)}

        {detailMarkerLine(0)}
        {detailMarkerLine(settle)}
        {detailMarkerLine(requiredGap, "timing-marker timing-required-marker")}
        {gap <= detailEnd ? detailMarkerLine(gap) : null}
        <g aria-label="Laser emission">
          <title>Laser emission +1 us</title>
          <line className="timing-emission-marker" x1={laserEmissionX} y1={y.laser - 42} x2={laserEmissionX} y2={y.adc + 12} />
          <circle className="timing-emission-icon" cx={laserEmissionX} cy={y.laser - 48} r="4" />
          <path className="timing-emission-icon-stroke" d={`M ${laserEmissionX - 7} ${y.laser - 48} L ${laserEmissionX + 7} ${y.laser - 48} M ${laserEmissionX} ${y.laser - 55} L ${laserEmissionX} ${y.laser - 41}`} />
        </g>

        {pulse(detailScale(0), detailScale(0) + 10, y.pixel, "timing-pulse")}
        {pulse(detailScale(settle), detailScale(settle) + 10, y.frame, "timing-pulse")}
        {gap <= detailEnd ? pulse(detailScale(gap), detailScale(gap) + 10, y.frame, "timing-pulse muted-pulse") : null}
        <rect
          className="timing-settle"
          x={settleStartX}
          y={y.galvo - 26}
          width={Math.max(2, settleWidth)}
          height="26"
        />
        {pulse(detailScale(laserStart), detailScale(laserEnd), y.laser, "timing-laser")}
        {pulse(detailScale(adcStart), detailScale(adcEnd), y.adc, "timing-adc", 12)}
        <line
          className="timing-dimension timing-total-duration"
          x1={left}
          y1={y.detailTotal}
          x2={requiredDetailX}
          y2={y.detailTotal}
          markerStart="url(#pa-timing-arrow)"
          markerEnd="url(#pa-timing-arrow)"
        />
        <text className="timing-dimension-label" x={(left + requiredDetailX) / 2} y={y.detailTotal + 18} textAnchor="middle">
          Total {durationText(requiredGap)}
        </text>
      </svg>
      <div className="timing-metrics" aria-label="PA timing values">
        <div>
          <span>Frame period</span>
          <strong>{durationText(gap)}</strong>
          <small>
            {fmtInt(gap)} counts, {rateText(gap)}
          </small>
        </div>
        <div>
          <span>Required gap</span>
          <strong>{durationText(requiredGap)}</strong>
          <small>{fmtInt(requiredGap)} counts, ADC + {durationText(PAM_ADC_POST_BUFFER_COUNTS)} buffer</small>
        </div>
        <div>
          <span>ADC window</span>
          <strong>{durationText(PAM_ADC_CAPTURE_COUNTS)}</strong>
          <small>
            {fmtInt(PAM_ADC_CAPTURE_SAMPLES)} samples @ {fmtInt(1_000 / PAM_ADC_SAMPLE_NS)} MHz
          </small>
        </div>
        <div>
          <span>Laser</span>
          <strong>
            {durationText(laserStart)} {"->"} {durationText(laserEnd)}
          </strong>
          <small>width {durationText(timing.ld_time)}</small>
        </div>
        <div>
          <span>ADC</span>
          <strong>
            {durationText(adcStart)} {"->"} {durationText(adcEnd)}
          </strong>
          <small>start offset {durationText(timing.adc_trigger_time)}</small>
        </div>
        <div>
          <span>Clock</span>
          <strong>100 MHz</strong>
          <small>1 count = 10 ns</small>
        </div>
      </div>
    </div>
  );
}

export default function PaImagingPanel({
  state,
  client,
  command,
  active = true,
  tzOhm = 2000,
  pdZeroAdcCode = DEFAULT_PD_ZERO_ADC_CODE,
  initialView = "capture",
  initialSchedulerTab = "auto",
}: PaImagingPanelProps) {
  const [panelView, setPanelView] = useState<PaPanelView>(initialView);
  const [schedulerTab, setSchedulerTab] = useState<PaSchedulerTab>(initialSchedulerTab);
  const [xStart, setXStart] = useState(maybeText(DEFAULT_PARAMS.x_start));
  const [xStep, setXStep] = useState(maybeText(DEFAULT_PARAMS.x_step));
  const [xPoints, setXPoints] = useState(maybeText(DEFAULT_PARAMS.x_points));
  const [xRange, setXRange] = useState(String(DEFAULT_SCAN_TARGET_RANGE_COUNTS));
  const [yStart, setYStart] = useState(maybeText(DEFAULT_PARAMS.y_start));
  const [yStep, setYStep] = useState(maybeText(DEFAULT_PARAMS.y_step));
  const [yPoints, setYPoints] = useState(maybeText(DEFAULT_PARAMS.y_points));
  const [yRange, setYRange] = useState(String(DEFAULT_SCAN_TARGET_RANGE_COUNTS));
  const [frameNumber, setFrameNumber] = useState(maybeText(DEFAULT_PARAMS.frame_number));
  const [xAxisInputMode, setXAxisInputMode] = useState<ScanAxisInputMode>("centerRange");
  const [yAxisInputMode, setYAxisInputMode] = useState<ScanAxisInputMode>("centerRange");
  const [scanScaleCounts, setScanScaleCounts] = useState(String(DEFAULT_SCAN_SCALE_COUNTS));
  const [scanScaleUm, setScanScaleUm] = useState(String(DEFAULT_SCAN_SCALE_UM));
  const [timingCounts, setTimingCounts] = useState<PamTimingCounts>(() =>
    constrainedTimingCounts(
      {
        gap_time: DEFAULT_PARAMS.gap_time!,
        galvo_settle_time: DEFAULT_PARAMS.galvo_settle_time!,
        ld_trigger_time: DEFAULT_PARAMS.ld_trigger_time!,
        adc_trigger_time: DEFAULT_PARAMS.adc_trigger_time!,
        ld_time: DEFAULT_PARAMS.ld_time!,
      },
      "gap_time",
    ),
  );
  const [scanMode, setScanMode] = useState<0 | 1>(scanModeInfo(DEFAULT_PARAMS.scan_mode).value);
  const [returnMode, setReturnMode] = useState<0 | 1>(returnModeInfo(DEFAULT_PARAMS.return_mode).value);
  const [serverPa, setServerPa] = useState<PaCaptureStatus | null>(() => state.lastStatus?.pa ?? null);
  const [schedulerStatus, setSchedulerStatus] = useState<PaSchedulerStatus | null>(null);
  const [receiverStatus, setReceiverStatus] = useState<PaReceiverStatus | null>(null);
  const [paDiagnostics, setPaDiagnostics] = useState<PaDiagnostics | null>(null);
  const [manualX, setManualX] = useState("0");
  const [manualY, setManualY] = useState("0");
  const [pointRateHz, setPointRateHz] = useState("3000");
  const [pointShots, setPointShots] = useState("0");
  const [pointTmpPath, setPointTmpPath] = useState("");
  const [pointSaveName, setPointSaveName] = useState("pa_point");
  const [pointSaveMessage, setPointSaveMessage] = useState("Point capture files use the global Data Root.");
  const [manualPulseRateHz, setManualPulseRateHz] = useState("3000");
  const [manualPulseActive, setManualPulseActive] = useState(false);
  const [waveformXMin, setWaveformXMin] = useState("-100");
  const [waveformXMax, setWaveformXMax] = useState("100");
  const [waveformYMin, setWaveformYMin] = useState("0");
  const [waveformYMax, setWaveformYMax] = useState("0");
  const [waveformXStep, setWaveformXStep] = useState("1");
  const [waveformYStep, setWaveformYStep] = useState("0");
  const [waveformRateHz, setWaveformRateHz] = useState("1000");
  const [serverMessage, setServerMessage] = useState("Idle");
  const [isBusy, setIsBusy] = useState(false);
  const [captureStartedAtMs, setCaptureStartedAtMs] = useState<number | null>(null);
  const [capturePlannedSeconds, setCapturePlannedSeconds] = useState(0);
  const [captureProgressDismissed, setCaptureProgressDismissed] = useState(false);
  const [progressNowMs, setProgressNowMs] = useState(() => Date.now());
  const [livePreviewImage, setLivePreviewImage] = useState<PaImageBuildResult | null>(null);
  const [livePreviewError, setLivePreviewError] = useState("");
  const [previewSource, setPreviewSource] = useState<PaPreviewSource>("current");
  const [roiAspectRatio, setRoiAspectRatio] = useState<PaImageRoiAspectRatio>("free");
  const [fineStepCounts, setFineStepCounts] = useState("5");
  const [canvasImage, setCanvasImage] = useState<PaImageBuildResult | null>(null);
  const [previewRoi, setPreviewRoi] = useState<PaImageZoomDomain | null>(null);
  const [previewRoiSource, setPreviewRoiSource] = useState<PaPreviewSource | null>(null);
  const [previewRoiPurpose, setPreviewRoiPurpose] = useState<PaCanvasRoiSource>(null);
  const [previewRoiScanKey, setPreviewRoiScanKey] = useState("");
  const [showCurrentAfterCapture, setShowCurrentAfterCapture] = useState(false);
  const [canvasZoom, setCanvasZoom] = useState<PaImageZoomDomain | null>(null);
  const [canvasPixel, setCanvasPixel] = useState<PaImagePixel | null>(null);
  const [canvasMessage, setCanvasMessage] = useState("Canvas not set");
  const [paCurrentTmpPath, setPaCurrentTmpPath] = useState("");
  const [paCanvasTmpPath, setPaCanvasTmpPath] = useState("");
  const [paSaveName, setPaSaveName] = useState("pa_image");
  const [paSaveMessage, setPaSaveMessage] = useState("PA image files use the global Data Root.");
  const [saveCurrentSelected, setSaveCurrentSelected] = useState(true);
  const [saveCanvasSelected, setSaveCanvasSelected] = useState(false);
  const [scanDefaults, setScanDefaults] = useState<PaScanDefaults>(() => loadPaScanDefaults(paScanDefaultsFromParams(DEFAULT_PARAMS)));
  const [scanDefaultMessage, setScanDefaultMessage] = useState("Default scan ready");
  const captureProcessedFramesRef = useRef(0);
  const lastLivePreviewFrameRef = useRef(0);
  const livePreviewRequestInFlightRef = useRef(false);
  const livePreviewGenerationRef = useRef(0);

  const backendHost = useMemo(() => {
    try {
      return new URL(state.backendUrl).hostname || "192.168.8.236";
    } catch {
      return "192.168.8.236";
    }
  }, [state.backendUrl]);

  useEffect(() => {
    if (!state.connected) return;
    const refreshStatuses = async () => {
      try {
        const [diagnosticsResponse, receiverResponse] = await Promise.all([
          client.paDiagnostics(),
          paReceiverStatusWithTimeout(PA_RECEIVER_CMD_TIMEOUT_MS),
        ]);
        setServerPa(diagnosticsResponse.pa);
        setPaDiagnostics(diagnosticsResponse);
        setReceiverStatus(receiverResponse);
        const schedulerResponse = await client.paSchedulerStatus();
        setSchedulerStatus(schedulerResponse.scheduler);
      } catch {
        // best effort polling
      }
    };
    refreshStatuses();
    const id = window.setInterval(() => {
      refreshStatuses();
    }, 1200);
    return () => window.clearInterval(id);
  }, [client, state.connected]);

  useEffect(() => {
    if (!serverPa?.running || captureStartedAtMs !== null) return;
    const now = Date.now();
    setCaptureStartedAtMs(now);
    setProgressNowMs(now);
  }, [captureStartedAtMs, serverPa?.running]);

  useEffect(() => {
    if (!serverPa?.running) return;
    const id = window.setInterval(() => setProgressNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [serverPa?.running]);

  const buildParams = (): PaCaptureParams => ({
    x_start: clampInteger(numberFromText(xStart), DEFAULT_PARAMS.x_start!),
    x_step: clampInteger(numberFromText(xStep, 1), DEFAULT_PARAMS.x_step!),
    x_points: clampPositiveInteger(numberFromText(xPoints, 1), DEFAULT_PARAMS.x_points!),
    y_start: clampInteger(numberFromText(yStart), DEFAULT_PARAMS.y_start!),
    y_step: clampInteger(numberFromText(yStep, 1), DEFAULT_PARAMS.y_step!),
    y_points: clampPositiveInteger(numberFromText(yPoints, 1), DEFAULT_PARAMS.y_points!),
    frame_number: clampPositiveInteger(numberFromText(frameNumber, 1), DEFAULT_PARAMS.frame_number!),
    task_id: DEFAULT_PARAMS.task_id,
    gap_time: timingCounts.gap_time,
    galvo_settle_time: timingCounts.galvo_settle_time,
    ld_trigger_time: timingCounts.ld_trigger_time,
    adc_trigger_time: timingCounts.adc_trigger_time,
    ld_time: timingCounts.ld_time,
    scan_mode: scanMode,
    return_mode: returnMode,
  });
  const currentParams = buildParams();
  const currentScanKey = scanKeyFromParams(currentParams);
  const currentScanAxisLabels: PaImageAxisLabels = {
    xStart: currentParams.x_start,
    xEnd: axisEndFromStartStep(currentParams.x_start, currentParams.x_step, currentParams.x_points),
    yStart: currentParams.y_start,
    yEnd: axisEndFromStartStep(currentParams.y_start, currentParams.y_step, currentParams.y_points),
  };
  const currentExpectedFrames = expectedFramesFromParams(currentParams);
  const currentEstimatedCaptureCounts = estimatedCaptureCountsFromParams(currentParams);
  const currentEstimatedCaptureSeconds = estimatedCaptureSecondsFromParams(currentParams);
  const pointRateHzValue = Math.max(1, numberFromText(pointRateHz, 3000));
  const pointPeriodCycles = Math.max(1, Math.round(PAM_TIMING_CLOCK_HZ / pointRateHzValue));
  const pointShotLimit = Math.max(0, Math.round(numberFromText(pointShots)));
  const pointEstimatedCaptureSeconds = pointShotLimit > 0 ? (pointShotLimit * pointPeriodCycles) / PAM_TIMING_CLOCK_HZ : 0;
  const currentScanMode = scanModeInfo(scanMode);
  const currentReturnMode = returnModeInfo(returnMode);
  const currentUmPerCount = scanUmPerCountFromCalibration(
    numberFromText(scanScaleCounts, DEFAULT_SCAN_SCALE_COUNTS),
    numberFromText(scanScaleUm, DEFAULT_SCAN_SCALE_UM),
  );
  const captureProcessedFrames = Math.max(
    Math.max(0, serverPa?.frames_sent ?? 0),
    Math.max(0, receiverStatus?.frames_received ?? 0),
  );
  const displayedScheduler = schedulerStatus ?? state.lastStatus?.pa_scheduler ?? null;
  const schedulerModeName = (displayedScheduler?.mode_name ?? "").toLowerCase();
  const pointModeActive = schedulerTab === "point" || schedulerModeName.includes("point");
  const captureExpectedFrames = Math.max(
    0,
    (serverPa?.expected_frames ?? 0) > 0
      ? serverPa?.expected_frames ?? 0
      : pointModeActive
        ? pointShotLimit
        : currentExpectedFrames,
  );
  const captureProgressUnbounded = pointModeActive && captureExpectedFrames === 0;
  const captureElapsedMs = captureStartedAtMs === null ? 0 : Math.max(0, progressNowMs - captureStartedAtMs);
  const captureProgress = captureProgressSnapshot({
    processedFrames: captureProcessedFrames,
    expectedFrames: captureExpectedFrames,
    elapsedMs: captureElapsedMs,
    plannedSeconds: capturePlannedSeconds || (pointModeActive ? pointEstimatedCaptureSeconds : currentEstimatedCaptureSeconds),
  });
  const captureProgressVisible = shouldShowCaptureProgress({
    dismissed: captureProgressDismissed,
    serverRunning: Boolean(serverPa?.running),
    processedFrames: captureProcessedFrames,
    receiverFrames: receiverStatus?.frames_received ?? 0,
  });
  useEffect(() => {
    if (!showCurrentAfterCapture) return;
    const complete = captureProgress.complete && captureProcessedFrames > 0;
    const nextSource = paPreviewSourceAfterScanComplete({
      currentSource: previewSource,
      roiPurpose: previewRoiPurpose,
      complete,
    });
    if (!complete) return;
    if (nextSource !== previewSource) {
      setPreviewSource(nextSource);
    }
    setShowCurrentAfterCapture(false);
  }, [captureProcessedFrames, captureProgress.complete, previewRoiPurpose, previewSource, showCurrentAfterCapture]);
  const applyScanParamsToInputs = (params: PaScanDefaults, mode: ScanAxisInputMode = "centerRange") => {
    setXStart(String(params.x_start));
    setXStep(String(params.x_step));
    setXPoints(String(params.x_points));
    setXRange(String(axisRangeFromStartStep(params.x_start, params.x_step, params.x_points)));
    setYStart(String(params.y_start));
    setYStep(String(params.y_step));
    setYPoints(String(params.y_points));
    setYRange(String(axisRangeFromStartStep(params.y_start, params.y_step, params.y_points)));
    setFrameNumber(String(params.frame_number));
    setScanMode(scanModeInfo(params.scan_mode).value);
    setReturnMode(returnModeInfo(params.return_mode).value);
    setXAxisInputMode(mode);
    setYAxisInputMode(mode);
  };
  const applyDefaultScan = () => {
    applyScanParamsToInputs(paScanDefaultsFromParams(scanParamsWithDefaults(currentParams, scanDefaults)), "centerRange");
    setScanDefaultMessage("Default scan loaded");
  };
  const saveDefaultScan = () => {
    const nextDefaults = paScanDefaultsFromParams(currentParams);
    setScanDefaults(nextDefaults);
    savePaScanDefaults(nextDefaults);
    setScanDefaultMessage("Current scan saved as default");
  };
  const serverStreamDiagnostics = serverPa?.diagnostics;
  const receiverStreamDiagnostics = receiverStatus?.diagnostics;
  const finalAxisStatus =
    serverPa?.axis_status_end ??
    serverPa?.axis_status_after_drain ??
    serverPa?.axis_status_after_stop ??
    serverPa?.axis_status_before_stop ??
    serverPa?.axis_status_initial;
  const activePlCounters =
    serverPa?.pl_counters ??
    serverPa?.pl_counters_latest ??
    serverPa?.pl_counters_end ??
    serverPa?.pl_counters_initial ??
    null;
  const acquisitionFaultCount = axisStatusFaultCount(finalAxisStatus) + plCounterFaultCount(activePlCounters);
  const acquisitionWaitCount = plCounterWaitCount(activePlCounters);
  const continuityProblemCount =
    diagnosticProblemCount(serverStreamDiagnostics) +
    diagnosticProblemCount(receiverStreamDiagnostics) +
    axisStatusDropCount(finalAxisStatus);
  const continuityIssueText = firstDiagnosticIssue(serverStreamDiagnostics, receiverStreamDiagnostics);
  const setTimingCount = (field: keyof PamTimingCounts, counts: number, changedField: PamTimingField = field) => {
    setTimingCounts((prev) => constrainedTimingCounts({ ...prev, [field]: counts }, changedField));
  };

  const refreshReceiver = async () => {
    const status = await paReceiverStatusWithTimeout(PA_RECEIVER_CMD_TIMEOUT_MS);
    setReceiverStatus(status);
  };

  const refreshScheduler = async () => {
    const status = await client.paSchedulerStatus();
    setSchedulerStatus(status.scheduler);
    return status.scheduler;
  };

  const runSchedulerCommand = async (label: string, action: () => Promise<{ ok: true; scheduler: PaSchedulerStatus }>) => {
    const response = await action();
    setSchedulerStatus(response.scheduler);
    setServerMessage(label);
  };

  const applyManualPosition = () =>
    runSchedulerCommand("Manual position applied", () =>
      client.paSchedulerManualPosition(numberFromText(manualX), numberFromText(manualY)),
    );

  const manualPulseBody = () => {
    const rateHz = Math.max(1, numberFromText(manualPulseRateHz, 3000));
    const periodCycles = Math.max(1, Math.round(PAM_TIMING_CLOCK_HZ / rateHz));
    return {
      manual_x: numberFromText(manualX),
      manual_y: numberFromText(manualY),
      single: false,
      period_cycles: periodCycles,
      control: PA_SCHED_CTRL_LD_ENABLE | PA_SCHED_CTRL_LOOP_ENABLE,
      ld_delay_cycles: timingCounts.ld_trigger_time,
      ld_width_cycles: timingCounts.ld_time,
      adc_delay_cycles: timingCounts.adc_trigger_time,
      adc_width_cycles: 1,
    };
  };

  const toggleManualPulse = async () => {
    if (manualPulseActive) {
      await runSchedulerCommand("Manual pulse stopped", () => client.paSchedulerCommand(PA_SCHED_CMD_STOP));
      setManualPulseActive(false);
      return;
    }
    await runSchedulerCommand("Manual pulse started", () => client.paSchedulerPulse(manualPulseBody()));
    setManualPulseActive(true);
  };

  const startPointCapture = async () => {
    if (isBusy) {
      return;
    }
    const config = {
      manual_x: numberFromText(manualX),
      manual_y: numberFromText(manualY),
      period_cycles: pointPeriodCycles,
      shot_limit: pointShotLimit,
      pulse_enabled: true,
      capture_enabled: true,
      ld_delay_cycles: timingCounts.ld_trigger_time,
      ld_width_cycles: timingCounts.ld_time,
      adc_delay_cycles: timingCounts.adc_trigger_time,
      adc_width_cycles: 1,
    };

    setIsBusy(true);
    setServerMessage("Starting point capture receiver...");
    livePreviewGenerationRef.current += 1;
    setCaptureProgressDismissed(false);
    setCaptureStartedAtMs(null);
    setCapturePlannedSeconds(pointEstimatedCaptureSeconds);
    setProgressNowMs(Date.now());
    setPointTmpPath("");
    setPointSaveMessage("Preparing point capture temporary file...");

    try {
      const diagnosticsStatus = await client.paDiagnostics();
      setServerPa(diagnosticsStatus.pa);
      setPaDiagnostics(diagnosticsStatus);
      await ensureServerReady(diagnosticsStatus.pa);
      const port = diagnosticsStatus.tcp_listener?.port ?? DEFAULT_PA_TCP_PORT;

      await stopReceiverIfRunning();
      const pointTmp = await storagePreparePaTmp("point_current");
      await paReceiverStartWithTimeout(backendHost, port, pointTmp.path, PA_RECEIVER_CMD_TIMEOUT_MS);
      const receiverReady = await waitForReceiverReady(WAIT_FOR_RECEIVER_READY_MS);
      if (!receiverReady.connected) {
        await paReceiverStopWithTimeout(PA_RECEIVER_CMD_TIMEOUT_MS).catch(() => undefined);
        setServerMessage("Point capture receiver failed to connect within timeout");
        throw new Error("PA receiver failed to connect to server");
      }
      setPointTmpPath(pointTmp.path);

      setServerMessage("Starting point capture...");
      const status = await client.paPointStart(config, PA_START_TIMEOUT_MS);
      const startedAt = Date.now();
      setCaptureStartedAtMs(startedAt);
      setProgressNowMs(startedAt);
      setServerPa(status.pa);
      await refreshReceiver();
      setServerMessage(
        pointShotLimit > 0
          ? `Point capture started, expected ${fmtInt(pointShotLimit)} shots.`
          : "Point capture started with no shot limit.",
      );
      setPointSaveMessage("Point capture is recording to the temporary point slot.");
    } catch (error) {
      await paReceiverStopWithTimeout(PA_RECEIVER_CMD_TIMEOUT_MS).catch(() => undefined);
      await refreshReceiver().catch(() => undefined);
      setServerMessage(`Point capture start failed: ${(error as Error).message}`);
      setPointTmpPath("");
      setPointSaveMessage("Point capture start failed; no temporary point series is selected.");
      throw error;
    } finally {
      setIsBusy(false);
    }
  };

  const startWaveform = () => {
    const rateHz = Math.max(1, numberFromText(waveformRateHz, 1000));
    const periodCycles = Math.max(1, Math.round(PAM_TIMING_CLOCK_HZ / rateHz));
    return runSchedulerCommand("Waveform started", () =>
      client.paSchedulerWaveform({
        mode: 5,
        control: PA_SCHED_CTRL_LD_ENABLE | PA_SCHED_CTRL_LOOP_ENABLE | (2 << 8),
        period_cycles: periodCycles,
        waveform_control: 0x00000101,
        waveform_x_min: numberFromText(waveformXMin),
        waveform_x_max: numberFromText(waveformXMax),
        waveform_y_min: numberFromText(waveformYMin),
        waveform_y_max: numberFromText(waveformYMax),
        waveform_x_step: numberFromText(waveformXStep),
        waveform_y_step: numberFromText(waveformYStep),
      }),
    );
  };

  const waitForReceiverReady = async (timeoutMs: number) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const status = await paReceiverStatusWithTimeout(PA_RECEIVER_CMD_TIMEOUT_MS);
      if (status.connected) {
        return status;
      }
      setServerMessage(`Waiting for TCP receiver connect...`);
      await new Promise((resolve) => window.setTimeout(resolve, RECEIVER_READY_POLL_MS));
    }
    return paReceiverStatusWithTimeout(PA_RECEIVER_CMD_TIMEOUT_MS);
  };

  const stopReceiverIfRunning = async () => {
    const status = await paReceiverStatusWithTimeout(PA_RECEIVER_CMD_TIMEOUT_MS);
    if (status.running || status.connected || status.stop_requested) {
      await paReceiverStopWithTimeout(PA_RECEIVER_CMD_TIMEOUT_MS);
    }
  };

  const waitForServerNotRunning = async () => {
    const deadline = Date.now() + SERVER_PREPARE_TIMEOUT_MS;
    let status = await client.paStatus();
    while (status.pa.running && Date.now() < deadline) {
      setServerMessage("Waiting for PA capture thread to stop...");
      await sleep(SERVER_PREPARE_POLL_MS);
      status = await client.paStatus();
    }
    return status.pa;
  };

  const waitForServerDisconnected = async () => {
    const deadline = Date.now() + SERVER_PREPARE_TIMEOUT_MS;
    let status = await client.paStatus();
    while (status.pa.connected && Date.now() < deadline) {
      setServerMessage("Waiting for PA TCP socket to close...");
      await sleep(SERVER_PREPARE_POLL_MS);
      status = await client.paStatus();
    }
    return status.pa;
  };

  const ensureServerReady = async (initial: PaCaptureStatus) => {
    if (initial.running) {
      setServerMessage("Stopping previous PA capture...");
      const stopStatus = await client.paStop(PA_START_TIMEOUT_MS, 2_000);
      let nextStatus = stopStatus.pa;
      if (nextStatus.running) {
        nextStatus = await waitForServerNotRunning();
      }
      if (nextStatus.running) {
        throw new Error("PA capture did not stop in time");
      }
      setServerPa(nextStatus);
    }

    let status = await client.paStatus();
    if (status.pa.connected) {
      setServerMessage("Disconnecting stale PA TCP session...");
      const disconnectStatus = await client.paDisconnect(PA_START_TIMEOUT_MS, 2_000);
      let nextStatus = disconnectStatus.pa;
      if (nextStatus.connected) {
        nextStatus = await waitForServerDisconnected();
      }
      setServerPa(nextStatus);
      if (nextStatus.connected) {
        throw new Error("PA TCP session did not disconnect in time");
      }
    }
  };

  const start = async () => {
    if (isBusy) {
      return;
    }
    const params = buildParams();
    const expectedFrames = expectedFramesFromParams(params);
    const captureTimeSec = estimatedCaptureSecondsFromParams(params);

    setIsBusy(true);
    setServerMessage("Starting PA receiver...");
    livePreviewGenerationRef.current += 1;
    setCaptureProgressDismissed(false);
    setCaptureStartedAtMs(null);
    setCapturePlannedSeconds(captureTimeSec);
    setProgressNowMs(Date.now());
    setLivePreviewImage(null);
    setLivePreviewError("");
    setPaCurrentTmpPath("");
    setPaSaveMessage("Preparing PA temporary file...");
    lastLivePreviewFrameRef.current = 0;
    setShowCurrentAfterCapture(previewRoiPurpose === "fineScan");

    try {
      const diagnosticsStatus = await client.paDiagnostics();
      setServerPa(diagnosticsStatus.pa);
      setPaDiagnostics(diagnosticsStatus);
      await ensureServerReady(diagnosticsStatus.pa);
      const port = diagnosticsStatus.tcp_listener?.port ?? DEFAULT_PA_TCP_PORT;

      await stopReceiverIfRunning();
      await setPaLiveImageProcessing(
        loadPaImageProcessingDefaults({
          ...DEFAULT_PA_IMAGE_PROCESSING,
          tzOhm,
          zeroAdcCode: pdZeroAdcCode,
        }),
      );
      const currentTmp = await storagePreparePaTmp("current");
      await paReceiverStartWithTimeout(backendHost, port, currentTmp.path, PA_RECEIVER_CMD_TIMEOUT_MS);
      const receiverReady = await waitForReceiverReady(WAIT_FOR_RECEIVER_READY_MS);
      if (!receiverReady.connected) {
        await paReceiverStopWithTimeout(PA_RECEIVER_CMD_TIMEOUT_MS).catch(() => undefined);
        setServerMessage("PA receiver failed to connect within timeout");
        throw new Error("PA receiver failed to connect to server");
      }
      setPaCurrentTmpPath(currentTmp.path);

      setServerMessage(`Starting PA capture...`);
      const serverCaptureTimeSec = captureTimeSecondsForServerStart(params);
      const status = await client.paStart(params, DEFAULT_PA_MAX_BLOCKS, serverCaptureTimeSec, expectedFrames, {}, PA_START_TIMEOUT_MS);
      const startedAt = Date.now();
      setCaptureStartedAtMs(startedAt);
      setProgressNowMs(startedAt);
      setServerPa(status.pa);
      await refreshReceiver();
      setServerMessage(`PA imaging started, expected ${fmtInt(expectedFrames)} frames.`);
      setPaSaveMessage("Current PA image is recording to the temporary current slot.");
    } catch (error) {
      await paReceiverStopWithTimeout(PA_RECEIVER_CMD_TIMEOUT_MS).catch(() => {
        // receiver cleanup if receiver start fails
      });
      await refreshReceiver().catch(() => {
        // ignore poll failures during cleanup
      });
      setServerMessage(`PA start failed: ${(error as Error).message}`);
      setPaCurrentTmpPath("");
      setPaSaveMessage("PA start failed; no current temporary image is selected.");
      setShowCurrentAfterCapture(false);
      throw error;
    } finally {
      setIsBusy(false);
    }
  };

  const stop = async () => {
    let serverError: Error | null = null;
    try {
      const status = await client.paStop(PA_START_TIMEOUT_MS, 2_000);
      setServerPa(status.pa);
      setServerMessage("PA imaging stopped");
    } catch (error) {
      serverError = error as Error;
      setServerMessage(`Server stop failed: ${serverError.message}`);
    }

    try {
      await paReceiverStopWithTimeout(PA_RECEIVER_CMD_TIMEOUT_MS);
      await refreshReceiver();
    } catch (error) {
      const receiverError = error as Error;
      setServerMessage(`Receiver stop failed: ${receiverError.message}`);
      if (!serverError) {
        serverError = receiverError;
      }
    }

    if (serverError) {
      throw serverError;
    }
  };

  const disconnect = async () => {
    let serverError: Error | null = null;
    try {
      const status = await client.paDisconnect(PA_START_TIMEOUT_MS, 2_000);
      setServerPa(status.pa);
      setServerMessage("PA socket disconnected");
    } catch (error) {
      serverError = error as Error;
      setServerMessage(`Server disconnect failed: ${serverError.message}`);
    }

    try {
      await paReceiverStopWithTimeout(PA_RECEIVER_CMD_TIMEOUT_MS);
      await refreshReceiver();
    } catch (error) {
      const receiverError = error as Error;
      setServerMessage(`Receiver stop failed: ${receiverError.message}`);
      if (!serverError) {
        serverError = receiverError;
      }
    }

    if (serverError) {
      throw serverError;
    }
  };

  const abortAndPark = async () => {
    if (isBusy) return;
    let firstError: Error | null = null;
    setIsBusy(true);
    setServerMessage("Aborting scheduler and stopping PA capture...");
    livePreviewGenerationRef.current += 1;
    livePreviewRequestInFlightRef.current = false;
    lastLivePreviewFrameRef.current = 0;
    setCaptureProgressDismissed(true);
    setCaptureStartedAtMs(null);
    setCapturePlannedSeconds(0);
    setProgressNowMs(Date.now());
    setLivePreviewImage(null);
    setLivePreviewError("");
    setPaCurrentTmpPath("");
    setPointTmpPath("");
    setManualPulseActive(false);
    setPaSaveMessage("Current PA capture was aborted; no current temporary image is selected.");
    setPointSaveMessage("Point capture was aborted; no temporary point series is selected.");
    setPreviewSource("current");
    setShowCurrentAfterCapture(false);
    setCanvasZoom(null);
    setCanvasPixel(null);
    try {
      const schedulerResponse = await client.paSchedulerCommand(PA_SCHED_CMD_ABORT_AND_PARK);
      setSchedulerStatus(schedulerResponse.scheduler);
    } catch (error) {
      firstError = error as Error;
      setServerMessage(`Scheduler abort failed: ${firstError.message}`);
    }

    try {
      const stopStatus = await client.paStop(PA_START_TIMEOUT_MS, 2_000);
      let nextStatus = stopStatus.pa;
      if (nextStatus.running) {
        nextStatus = await waitForServerNotRunning();
      }
      setServerPa(nextStatus);
    } catch (error) {
      const stopError = error as Error;
      setServerMessage(`Server stop failed after abort: ${stopError.message}`);
      if (!firstError) {
        firstError = stopError;
      }
    }

    try {
      await paReceiverStopWithTimeout(PA_RECEIVER_CMD_TIMEOUT_MS);
      await refreshReceiver();
    } catch (error) {
      const receiverError = error as Error;
      setServerMessage(`Receiver stop failed after abort: ${receiverError.message}`);
      if (!firstError) {
        firstError = receiverError;
      }
    } finally {
      setProgressNowMs(Date.now());
      setIsBusy(false);
    }

    if (firstError) {
      throw firstError;
    }
    setServerMessage("Scheduler aborted and parked; PA capture and receiver stopped.");
  };

  const lastError = serverPa?.last_error || receiverStatus?.last_error || displayedScheduler?.last_error;
  const livePreviewPixelCount = Math.max(
    1,
    Math.round(Number(currentParams.x_points || 1)) * Math.round(Number(currentParams.y_points || 1)),
  );
  const livePreviewIntervalMs = paLivePreviewIntervalMs(livePreviewPixelCount);
  const livePreviewFrameDelta = paLivePreviewMinFrameDelta(livePreviewPixelCount);
  const captureModeRunning = Boolean(serverPa?.running && !captureProgress.complete);
  const pointCaptureRunning = Boolean(
    captureModeRunning && (schedulerTab === "point" || schedulerModeName.includes("point")),
  );
  const scanCaptureRunning = Boolean(
    captureModeRunning &&
      !pointCaptureRunning &&
      (schedulerTab === "auto" || schedulerModeName.includes("auto") || schedulerModeName.includes("scan")),
  );
  const lockedSchedulerTab: PaSchedulerTab | null = pointCaptureRunning ? "point" : scanCaptureRunning ? "auto" : null;
  const paState = paStateIndicator({
    lastError,
    serverPa,
    receiverStatus,
    listenerStatus: paDiagnostics?.tcp_listener ?? null,
    acquisitionFaultCount,
    acquisitionWaitCount,
    continuityProblemCount,
    processedFrames: captureProcessedFrames,
    expectedFrames: captureExpectedFrames,
  });

  useEffect(() => {
    captureProcessedFramesRef.current = captureProcessedFrames;
  }, [captureProcessedFrames]);

  useEffect(() => {
    if (!active || !scanCaptureRunning) return;
    let cancelled = false;

    const refreshLivePreview = async () => {
      const generation = livePreviewGenerationRef.current;
      const processedFrames = captureProcessedFramesRef.current;
      if (!shouldRefreshPaLivePreview({
        running: true,
        processedFrames,
        lastSnapshotFrameCount: lastLivePreviewFrameRef.current,
        pixelCount: livePreviewPixelCount,
        requestInFlight: livePreviewRequestInFlightRef.current,
      })) {
        return;
      }

      livePreviewRequestInFlightRef.current = true;
      try {
        const snapshot = await readPaLiveImage();
        if (cancelled || generation !== livePreviewGenerationRef.current) return;
        lastLivePreviewFrameRef.current = Math.max(processedFrames, Math.round(snapshot.frame_count ?? 0));
        runPaLivePreviewUpdate(() => {
          setLivePreviewImage(snapshot);
          setLivePreviewError("");
        }, startTransition);
      } catch (error) {
        if (!cancelled && generation === livePreviewGenerationRef.current) {
          setLivePreviewError(`Live preview failed: ${formatUnknownError(error)}`);
        }
      } finally {
        livePreviewRequestInFlightRef.current = false;
      }
    };

    void refreshLivePreview();
    const id = window.setInterval(() => {
      void refreshLivePreview();
    }, livePreviewIntervalMs);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [active, livePreviewIntervalMs, livePreviewPixelCount, scanCaptureRunning]);

  useEffect(() => {
    if (!active || !captureProgress.complete || captureProcessedFrames <= 0) return;
    if (lastLivePreviewFrameRef.current >= captureProcessedFrames || livePreviewRequestInFlightRef.current) return;
    let cancelled = false;
    const generation = livePreviewGenerationRef.current;
    livePreviewRequestInFlightRef.current = true;
    readPaLiveImage()
      .then((snapshot) => {
        if (cancelled || generation !== livePreviewGenerationRef.current) return;
        lastLivePreviewFrameRef.current = Math.max(captureProcessedFrames, Math.round(snapshot.frame_count ?? 0));
        runPaLivePreviewUpdate(() => {
          setLivePreviewImage(snapshot);
          setLivePreviewError("");
        }, startTransition);
      })
      .catch((error) => {
        if (!cancelled && generation === livePreviewGenerationRef.current) {
          setLivePreviewError(`Live preview failed: ${formatUnknownError(error)}`);
        }
      })
      .finally(() => {
        livePreviewRequestInFlightRef.current = false;
      });
    return () => {
      cancelled = true;
    };
  }, [active, captureProcessedFrames, captureProgress.complete]);

  const schedulerTabs: Array<[PaSchedulerTab, string]> = [
    ["auto", "Scan Capture"],
    ["point", "Point Capture"],
    ["manual", "Manual Control"],
    ["diagnostics", "Diagnostics"],
  ];

  const emptyPreviewWidth = Math.max(1, Math.min(96, Math.round(currentParams.x_points || 1)));
  const emptyPreviewHeight = Math.max(1, Math.min(96, Math.round(currentParams.y_points || 1)));
  const livePreviewReady = Boolean(livePreviewImage && livePreviewImage.width > 0 && livePreviewImage.height > 0);
  const showingCanvas = previewSource === "canvas" && Boolean(canvasImage);
  const displayedPreviewSource: PaPreviewSource = showingCanvas ? "canvas" : "current";
  const displayedPreviewImage = showingCanvas ? canvasImage : livePreviewImage;
  const displayedPreviewReady = Boolean(displayedPreviewImage && displayedPreviewImage.width > 0 && displayedPreviewImage.height > 0);
  const displayedPreviewWidth = displayedPreviewReady ? Math.max(1, displayedPreviewImage!.width) : emptyPreviewWidth;
  const displayedPreviewHeight = displayedPreviewReady ? Math.max(1, displayedPreviewImage!.height) : emptyPreviewHeight;
  const displayedPreviewAxisLabels: PaImageAxisLabels = displayedPreviewReady
    ? {
        xStart: displayedPreviewImage!.x_start ?? currentScanAxisLabels.xStart,
        xEnd: displayedPreviewImage!.x_end ?? currentScanAxisLabels.xEnd,
        yStart: displayedPreviewImage!.y_start ?? currentScanAxisLabels.yStart,
        yEnd: displayedPreviewImage!.y_end ?? currentScanAxisLabels.yEnd,
      }
    : currentScanAxisLabels;
  const livePreviewStatusText = livePreviewReady
    ? `Live image ${fmtInt(livePreviewImage!.frame_count)} frames`
    : "Live image pending";
  const livePreviewThrottleText = `${compactNumber(livePreviewIntervalMs / 1000, 2)} s refresh / ${fmtInt(livePreviewFrameDelta)} frames`;
  const livePreviewMessage = livePreviewError || "Uses current ROI settings";
  const canvasStatusText = canvasImage ? `Canvas ${fmtInt(canvasImage.frame_count)} frames` : "Canvas not set";
  const canvasAxisLabels: PaImageAxisLabels | null = canvasImage
    ? {
        xStart: canvasImage.x_start ?? currentScanAxisLabels.xStart,
        xEnd: canvasImage.x_end ?? currentScanAxisLabels.xEnd,
        yStart: canvasImage.y_start ?? currentScanAxisLabels.yStart,
        yEnd: canvasImage.y_end ?? currentScanAxisLabels.yEnd,
      }
    : null;
  const canvasScanRoi = canvasImage && canvasAxisLabels
    ? paCanvasRoiFromScanParams({
        params: currentParams,
        width: canvasImage.width,
        height: canvasImage.height,
        axisLabels: canvasAxisLabels,
      })
    : null;
  const activeManualPreviewRoi =
    previewRoiSource === displayedPreviewSource && previewRoiPurpose === "manual" && previewRoiScanKey === currentScanKey
      ? previewRoi
      : null;
  const displayedPreviewRoi =
    activeManualPreviewRoi ??
    (displayedPreviewSource === "canvas" && canvasScanRoi?.status === "inside" ? canvasScanRoi.roi : null);
  const canvasScanRegionOutside = displayedPreviewSource === "canvas" && canvasScanRoi?.status === "outside";
  const selectedCanvasPoint = canvasPixel && displayedPreviewReady
    ? paImagePixelToScanPoint({
        pixel: canvasPixel,
        width: displayedPreviewWidth,
        height: displayedPreviewHeight,
        axisLabels: displayedPreviewAxisLabels,
      })
    : null;
  const paCurrentSourcePath = paCurrentTmpPath;
  const paCanvasSourcePath = paCanvasTmpPath;
  const canSaveCurrentPaImage = Boolean(paCurrentSourcePath && !isBusy && !captureModeRunning && captureProcessedFrames > 0);
  const canSavePointSeries = Boolean(pointTmpPath && !isBusy && !serverPa?.running && captureProcessedFrames > 0);
  const canSetCurrentAsCanvas = Boolean(livePreviewReady && canSaveCurrentPaImage);
  const canSaveCanvasPaImage = Boolean(paCanvasSourcePath && canvasImage);
  const canSaveCurrentAndCanvasPaImage = canSaveCurrentPaImage && canSaveCanvasPaImage;

  const setCurrentPreviewAsCanvas = async () => {
    if (!livePreviewImage || !canSetCurrentAsCanvas) {
      setPaSaveMessage("Current PA image is not ready to become Canvas yet.");
      return;
    }
    const canvasTmp = await storageCopyFileToPaTmp("canvas", paCurrentSourcePath);
    setPaCanvasTmpPath(canvasTmp.path);
    setPaSaveMessage("Canvas temporary PA image updated.");
    setCanvasImage(livePreviewImage);
    setCanvasZoom(null);
    setCanvasPixel(null);
    setPreviewRoi(null);
    setPreviewRoiSource(null);
    setPreviewRoiPurpose(null);
    setPreviewRoiScanKey("");
    setPreviewSource("canvas");
    setCanvasMessage(`Canvas set from ${fmtInt(livePreviewImage.frame_count)} live frames.`);
  };
  const clearCanvas = () => {
    setCanvasImage(null);
    setPaCanvasTmpPath("");
    if (previewSource === "canvas") {
      setPreviewSource("current");
    }
    if (previewRoiSource === "canvas") {
      setPreviewRoi(null);
      setPreviewRoiSource(null);
      setPreviewRoiPurpose(null);
      setPreviewRoiScanKey("");
    }
    setCanvasZoom(null);
    setCanvasPixel(null);
    setCanvasMessage("Canvas not set");
  };
  const displayedPreviewXStart = displayedPreviewAxisLabels.xStart;
  const displayedPreviewXEnd = displayedPreviewAxisLabels.xEnd;
  const displayedPreviewYStart = displayedPreviewAxisLabels.yStart;
  const displayedPreviewYEnd = displayedPreviewAxisLabels.yEnd;
  const selectCanvasPixel = useCallback((pixel: PaImagePixel) => {
    if (!displayedPreviewReady) return;
    const point = paImagePixelToScanPoint({
      pixel,
      width: displayedPreviewWidth,
      height: displayedPreviewHeight,
      axisLabels: {
        xStart: displayedPreviewXStart,
        xEnd: displayedPreviewXEnd,
        yStart: displayedPreviewYStart,
        yEnd: displayedPreviewYEnd,
      },
    });
    setCanvasPixel(pixel);
    setManualX(String(point.x));
    setManualY(String(point.y));
    setCanvasMessage(`Point/Manual target set to X ${point.x}, Y ${point.y}.`);
  }, [
    displayedPreviewHeight,
    displayedPreviewReady,
    displayedPreviewWidth,
    displayedPreviewXEnd,
    displayedPreviewXStart,
    displayedPreviewYEnd,
    displayedPreviewYStart,
  ]);
  const updatePreviewRoi = useCallback((roi: PaImageZoomDomain | null) => {
    setPreviewRoi(roi);
    setPreviewRoiSource(roi ? displayedPreviewSource : null);
    setPreviewRoiPurpose(roi ? "manual" : null);
    setPreviewRoiScanKey(roi ? currentScanKey : "");
  }, [currentScanKey, displayedPreviewSource]);
  const resetCanvasZoom = useCallback(() => setCanvasZoom(null), []);
  const zoomToPreviewRoi = () => {
    const zoomCommit = paZoomCommitStateFromRoi(displayedPreviewRoi);
    if (!zoomCommit) return;
    setCanvasZoom(zoomCommit.zoom);
    setPreviewRoi(zoomCommit.roi);
    setPreviewRoiSource(zoomCommit.roiSource);
    setPreviewRoiPurpose(zoomCommit.roiPurpose);
    setPreviewRoiScanKey("");
    setCanvasMessage(`${displayedPreviewSource === "canvas" ? "Canvas" : "Current image"} zoom set from ROI.`);
  };
  const applyPreviewRoiToScan = () => {
    if (!displayedPreviewImage || !displayedPreviewRoi) return;
    const next = paFineScanParamsFromImageRoi({
      roi: displayedPreviewRoi,
      width: displayedPreviewWidth,
      height: displayedPreviewHeight,
      axisLabels: displayedPreviewAxisLabels,
      stepCounts: fineStepCounts,
      baseParams: currentParams,
    });
    applyScanParamsToInputs(next, "centerRange");
    setPreviewRoi(displayedPreviewRoi);
    setPreviewRoiSource(displayedPreviewSource);
    setPreviewRoiPurpose("fineScan");
    setPreviewRoiScanKey(scanKeyFromParams(next));
    setSchedulerTab("auto");
    setCanvasMessage(`Fine scan set from ${displayedPreviewSource === "canvas" ? "Canvas" : "Current image"} ROI at step ${next.x_step} counts.`);
  };

  const currentPaImageProcessing = () =>
    loadPaImageProcessingDefaults({
      ...DEFAULT_PA_IMAGE_PROCESSING,
      tzOhm,
      zeroAdcCode: pdZeroAdcCode,
    });
  const paImageStorageMetadata = (
    kind: "current" | "canvas" | "current_canvas",
    sourcePaths: Record<string, string>,
    images: Record<string, PaImageBuildResult | null>,
  ) => ({
    kind: `pa_image_${kind}`,
    saved_at: new Date().toISOString(),
    source_paths: sourcePaths,
    images: Object.fromEntries(Object.entries(images).map(([key, image]) => [key, paImageSummary(image)])),
    scan: {
      params: currentParams,
      scan_key: currentScanKey,
      expected_frames: currentExpectedFrames,
      estimated_capture_seconds: currentEstimatedCaptureSeconds,
      mode: { value: scanMode, label: currentScanMode.label },
      return_mode: { value: returnMode, label: currentReturnMode.label },
    },
    timing_counts: timingCounts,
    calibration: {
      counts: numberFromText(scanScaleCounts, DEFAULT_SCAN_SCALE_COUNTS),
      um: numberFromText(scanScaleUm, DEFAULT_SCAN_SCALE_UM),
      um_per_count: currentUmPerCount,
    },
    processing: currentPaImageProcessing(),
    ada4355: {
      tz_ohm: tzOhm,
      pd_zero_adc_code: pdZeroAdcCode,
    },
  });
  const pointSeriesStorageMetadata = () => ({
    kind: "pa_point_capture",
    saved_at: new Date().toISOString(),
    source_path: pointTmpPath,
    point_capture: {
      manual_x: numberFromText(manualX),
      manual_y: numberFromText(manualY),
      pulse_repetition_rate_hz: pointRateHzValue,
      period_cycles: pointPeriodCycles,
      requested_shots: pointShotLimit,
      pulse_enabled: true,
      capture_enabled: true,
      actual_frames: captureProcessedFrames,
      unbounded: pointShotLimit === 0,
    },
    timing_counts: {
      ld_trigger_time: timingCounts.ld_trigger_time,
      ld_time: timingCounts.ld_time,
      adc_trigger_time: timingCounts.adc_trigger_time,
      adc_width_cycles: 1,
    },
    processing: currentPaImageProcessing(),
    ada4355: {
      tz_ohm: tzOhm,
      pd_zero_adc_code: pdZeroAdcCode,
    },
    continuity: {
      server: serverStreamDiagnostics ?? null,
      receiver: receiverStreamDiagnostics ?? null,
    },
  });
  const savePointSeries = async () => {
    if (!canSavePointSeries) {
      throw new Error("Point capture series is not ready to save");
    }
    const result = await storageSaveMixedRecord({
      dataType: "pa_point_capture",
      name: safeRunName(pointSaveName, "pa_point_capture"),
      textFiles: [storageMetadataFile(pointSeriesStorageMetadata())],
      sourceFiles: [{ sourcePath: pointTmpPath, targetPath: "legacy.bin" }],
    });
    setPointSaveMessage(`Point series saved: ${result.path}`);
  };
  const saveCurrentPaImage = async () => {
    if (!canSaveCurrentPaImage) {
      throw new Error("Current PA image is not ready to save");
    }
    const result = await storageSaveMixedRecord({
      dataType: "pa_image",
      name: safeRunName(paSaveName, "pa_image"),
      textFiles: [storageMetadataFile(paImageStorageMetadata("current", { current: paCurrentSourcePath }, { current: livePreviewImage }))],
      sourceFiles: [{ sourcePath: paCurrentSourcePath, targetPath: "legacy.bin" }],
    });
    setPaSaveMessage(`Current PA image saved: ${result.path}`);
  };
  const saveCanvasPaImage = async () => {
    if (!canSaveCanvasPaImage) {
      throw new Error("No Canvas PA image temporary file is available");
    }
    const result = await storageSaveMixedRecord({
      dataType: "pa_image",
      name: safeRunName(paSaveName, "pa_canvas"),
      textFiles: [storageMetadataFile(paImageStorageMetadata("canvas", { canvas: paCanvasSourcePath }, { canvas: canvasImage }))],
      sourceFiles: [{ sourcePath: paCanvasSourcePath, targetPath: "legacy.bin" }],
    });
    setPaSaveMessage(`Canvas PA image saved: ${result.path}`);
  };
  const saveCurrentAndCanvasPaImage = async () => {
    if (!canSaveCurrentAndCanvasPaImage) {
      throw new Error("Both current and Canvas PA temporary files are required");
    }
    const result = await storageSaveMixedRecord({
      dataType: "pa_image",
      name: safeRunName(paSaveName, "pa_image"),
      textFiles: [
        storageMetadataFile(
          paImageStorageMetadata(
            "current_canvas",
            { current: paCurrentSourcePath, canvas: paCanvasSourcePath },
            { current: livePreviewImage, canvas: canvasImage },
          ),
        ),
      ],
      sourceFiles: [
        { sourcePath: paCurrentSourcePath, targetPath: "current_legacy.bin" },
        { sourcePath: paCanvasSourcePath, targetPath: "canvas_legacy.bin" },
      ],
    });
    setPaSaveMessage(`Current and Canvas PA images saved: ${result.path}`);
  };
  const canRunPaSaveSelection =
    (saveCurrentSelected && canSaveCurrentPaImage) || (saveCanvasSelected && canSaveCanvasPaImage);
  const saveSelectedPaImages = async () => {
    if (saveCurrentSelected && saveCanvasSelected) {
      return saveCurrentAndCanvasPaImage();
    }
    if (saveCurrentSelected) {
      return saveCurrentPaImage();
    }
    if (saveCanvasSelected) {
      return saveCanvasPaImage();
    }
    throw new Error("Select Current or Canvas before saving");
  };

  if (panelView === "image") {
    return (
      <ErrorBoundary title="PA Image Viewer crashed" resetLabel="Back to PA Imaging" resetKey={panelView} onReset={() => setPanelView("capture")}>
        <PaImageViewer
          active={active}
          tzOhm={tzOhm}
          zeroAdcCode={pdZeroAdcCode}
          umPerCount={currentUmPerCount}
          scanAxisLabels={currentScanAxisLabels}
          onBack={() => setPanelView("capture")}
        />
      </ErrorBoundary>
    );
  }

  if (panelView === "series") {
    return (
      <ErrorBoundary title="PA Series Viewer crashed" resetLabel="Back to PA Imaging" resetKey={panelView} onReset={() => setPanelView("capture")}>
        <PaSeriesViewer
          active={active}
          tzOhm={tzOhm}
          zeroAdcCode={pdZeroAdcCode}
          onBack={() => setPanelView("capture")}
        />
      </ErrorBoundary>
    );
  }

  if (panelView === "timing") {
    return (
      <section className="panel pa-imaging-panel">
        <div className="pa-panel-heading">
          <h2>PA Timing & Scan</h2>
          <button type="button" className="command compact" onClick={() => setPanelView("capture")}>
            Back
          </button>
        </div>

        <h3>Timing Parameters</h3>
        <div className="fields pa-timing-fields">
          <DurationCountField
            label="gap_time / Frame Period"
            counts={timingCounts.gap_time}
            onCommit={(counts) => setTimingCount("gap_time", counts, "gap_time")}
          />
          <RateField
            gapCounts={timingCounts.gap_time}
            onCommit={(counts) => setTimingCount("gap_time", counts, "repetition_rate")}
          />
          <DurationCountField
            label="galvo_settle_time"
            counts={timingCounts.galvo_settle_time}
            onCommit={(counts) => setTimingCount("galvo_settle_time", counts)}
          />
          <DurationCountField
            label="ld_trigger_time"
            counts={timingCounts.ld_trigger_time}
            onCommit={(counts) => setTimingCount("ld_trigger_time", counts)}
          />
          <DurationCountField
            label="ld_time"
            counts={timingCounts.ld_time}
            onCommit={(counts) => setTimingCount("ld_time", counts)}
          />
          <DurationCountField
            label="adc_trigger_time"
            counts={timingCounts.adc_trigger_time}
            onCommit={(counts) => setTimingCount("adc_trigger_time", counts)}
          />
        </div>

        <TimingDiagram timing={timingCounts} />
      </section>
    );
  }

  if (panelView === "scan") {
    return (
      <section className="panel pa-imaging-panel">
        <div className="pa-panel-heading">
          <h2>PA Scan Settings</h2>
          <button type="button" className="command compact" onClick={() => setPanelView("capture")}>
            Back
          </button>
        </div>

        <div className="pa-scan-workbench">
          <div className="pa-scan-controls">
            <section className="pa-scan-group pa-scan-run-group" aria-label="Run">
              <div className="fields pa-scan-run-fields">
                <ScanModeField mode={scanMode} detail={currentScanMode.detail} onChange={setScanMode} />
                <ReturnModeField mode={returnMode} detail={currentReturnMode.detail} onChange={setReturnMode} />
                <label>
                  Frames
                  <input value={frameNumber} onChange={(event) => setFrameNumber(event.target.value)} />
                </label>
              </div>
              <div className="fields pa-scan-summary-fields">
                <label>
                  Expected Frames
                  <input value={fmtInt(currentExpectedFrames)} readOnly />
                </label>
                <label>
                  Estimated Capture Time
                  <input value={durationText(currentEstimatedCaptureCounts)} readOnly />
                </label>
              </div>
              <div className="button-row pa-scan-default-actions">
                <button type="button" className="command compact" onClick={applyDefaultScan}>
                  To Default
                </button>
                <button type="button" className="command compact" onClick={saveDefaultScan}>
                  Save Default
                </button>
                <span className="field-note">{scanDefaultMessage}</span>
              </div>
            </section>
            <div className="pa-scan-axis-grid">
              <ScanAxisControlGroup
                label="X Axis"
                mode={xAxisInputMode}
                startText={xStart}
                stepText={xStep}
                pointsText={xPoints}
                rangeText={xRange}
                setStartText={setXStart}
                setStepText={setXStep}
                setPointsText={setXPoints}
                setRangeText={setXRange}
                onToggleMode={() => setXAxisInputMode((value) => (value === "endpoints" ? "centerRange" : "endpoints"))}
              />
              <ScanAxisControlGroup
                label="Y Axis"
                mode={yAxisInputMode}
                startText={yStart}
                stepText={yStep}
                pointsText={yPoints}
                rangeText={yRange}
                setStartText={setYStart}
                setStepText={setYStep}
                setPointsText={setYPoints}
                setRangeText={setYRange}
                onToggleMode={() => setYAxisInputMode((value) => (value === "endpoints" ? "centerRange" : "endpoints"))}
              />
            </div>
          </div>
          <div className="pa-scan-preview-stack">
            <ScanPreview params={currentParams} mode={currentScanMode} umPerCount={currentUmPerCount} />
            <div className="pa-scan-settings">
              <label>
                Calibration Counts
                <input value={scanScaleCounts} onChange={(event) => setScanScaleCounts(event.target.value)} />
              </label>
              <label>
                Calibration um
                <input value={scanScaleUm} onChange={(event) => setScanScaleUm(event.target.value)} />
              </label>
              <label>
                um / count
                <input value={compactNumber(currentUmPerCount, 6)} readOnly />
              </label>
            </div>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="panel pa-imaging-panel">
      <div className="pa-imaging-toolbar">
        <div className="pa-imaging-title">
          <h2>PA Imaging</h2>
          <small>{serverMessage}</small>
        </div>
        <div className="pa-imaging-setup-actions" aria-label="PA imaging setup views">
          <button type="button" className="command compact" onClick={() => setPanelView("series")} disabled={isBusy}>
            PA Series Viewer
          </button>
          <button type="button" className="command compact" onClick={() => setPanelView("image")} disabled={isBusy}>
            PA Image Viewer
          </button>
          <button type="button" className="command compact" onClick={() => setPanelView("timing")} disabled={isBusy}>
            Timing
          </button>
        </div>
      </div>

      <div className={`pa-state-indicator ${paState.tone}`} aria-label="PA State">
        <span className="pa-state-dot" aria-hidden="true" />
        <div>
          <span>PA State</span>
          <strong>{paState.label}</strong>
          <small>{paState.summary}</small>
        </div>
      </div>

      <div className="pa-imaging-workbench">
        <section className="pa-live-image-preview" aria-label="PA Image Preview">
          <div className="pa-preview-header">
            <div>
              <h3>PA Image Preview</h3>
              <small>
                {fmtInt(currentParams.x_points)} x {fmtInt(currentParams.y_points)} · {fmtInt(currentExpectedFrames)} expected frames
              </small>
            </div>
            <div className="pa-preview-actions">
              <div className="scan-mode-segmented pa-preview-source-toggle" role="group" aria-label="PA preview source">
                <button
                  type="button"
                  className={`method-pill ${displayedPreviewSource === "current" ? "active" : ""}`}
                  onClick={() => setPreviewSource("current")}
                >
                  Current
                </button>
                <button
                  type="button"
                  className={`method-pill ${displayedPreviewSource === "canvas" ? "active" : ""}`}
                  onClick={() => setPreviewSource("canvas")}
                  disabled={!canvasImage}
                >
                  Canvas
                </button>
              </div>
              <div className="pa-preview-main-actions">
                <button
                  type="button"
                  className="command compact"
                  onClick={() => command("Set Canvas", setCurrentPreviewAsCanvas)}
                  disabled={!canSetCurrentAsCanvas}
                >
                  Set Canvas
                </button>
                <button type="button" className="command compact" onClick={clearCanvas} disabled={!canvasImage}>
                  Clear
                </button>
              </div>
            </div>
          </div>
          <div className="pa-preview-toolstrip">
            <label className="pa-inline-control">
              Aspect
              <select value={roiAspectRatio} onChange={(event) => setRoiAspectRatio(event.target.value as PaImageRoiAspectRatio)}>
                <option value="free">Free</option>
                <option value="1:1">1:1</option>
                <option value="4:3">4:3</option>
                <option value="16:9">16:9</option>
              </select>
            </label>
            <label className="pa-inline-control">
              Fine Step
              <input value={fineStepCounts} onChange={(event) => setFineStepCounts(event.target.value)} />
            </label>
            <button type="button" className="command compact" onClick={zoomToPreviewRoi} disabled={!displayedPreviewRoi}>
              Zoom To ROI
            </button>
            <button type="button" className="command compact" onClick={resetCanvasZoom} disabled={!canvasZoom}>
              Reset Zoom
            </button>
            <button type="button" className="command primary compact" onClick={applyPreviewRoiToScan} disabled={!displayedPreviewRoi || !displayedPreviewImage}>
              Apply ROI To Scan
            </button>
          </div>
          <PaImageHeatmap
            width={displayedPreviewWidth}
            height={displayedPreviewHeight}
            values={paImageValuesOrEmpty(displayedPreviewImage?.values)}
            counts={paImageCountsOrEmpty(displayedPreviewImage?.counts)}
            axisLabels={displayedPreviewAxisLabels}
            umPerCount={currentUmPerCount}
            selectedPixel={canvasPixel}
            zoom={canvasZoom}
            roi={displayedPreviewRoi}
            roiAspectRatio={roiAspectRatio}
            onPixelSelect={selectCanvasPixel}
            onRoiChange={updatePreviewRoi}
            onResetZoom={resetCanvasZoom}
            active
          />
          <div className="pa-image-readouts pa-live-preview-readouts">
            <span>{canvasStatusText}</span>
            <span>{livePreviewStatusText}</span>
            <span>
              Grid {fmtInt(displayedPreviewWidth)} x {fmtInt(displayedPreviewHeight)}
            </span>
            <span>{livePreviewThrottleText}</span>
            <span>{canvasZoom ? `Zoom x ${canvasZoom.xStart}-${canvasZoom.xEnd}, y ${canvasZoom.yStart}-${canvasZoom.yEnd}` : "Zoom full"}</span>
            <span>
              {displayedPreviewRoi
                ? `ROI x ${displayedPreviewRoi.xStart}-${displayedPreviewRoi.xEnd}, y ${displayedPreviewRoi.yStart}-${displayedPreviewRoi.yEnd}`
                : canvasScanRegionOutside
                  ? "Scan region outside Canvas"
                  : "ROI not set"}
            </span>
            <span>
              {selectedCanvasPoint
                ? `Point/Manual target X ${selectedCanvasPoint.x}, Y ${selectedCanvasPoint.y}`
                : "Click canvas to set Point/Manual target"}
            </span>
            <span>
              {previewRoiPurpose === "fineScan" && previewRoiSource === "canvas"
                ? "Canvas linked to fine scan ROI"
                : canvasScanRegionOutside
                  ? "Canvas ROI unavailable for current scan"
                : "Use ROI to set next scan"}
            </span>
            <span>{canvasMessage}</span>
            <span className={livePreviewError ? "severity-warning" : "severity-ok"}>{livePreviewMessage}</span>
          </div>
        </section>

        <section className="pa-scheduler-shell" aria-label="PA Scheduler">
          <div className="pa-scheduler-header">
            <div>
              <h3>PA Scheduler</h3>
              <small>
                {schedulerModeLabel(displayedScheduler)} · {schedulerCaptureText(displayedScheduler)} ·{" "}
                {formatSchedulerPosition(displayedScheduler)}
              </small>
            </div>
            <button
              type="button"
              className="command danger compact"
              title="Stops capture and parks the scheduler"
              onClick={() => command("Abort & Park", abortAndPark)}
              disabled={isBusy}
            >
              Abort &amp; Park
            </button>
          </div>
          <div className="scan-mode-segmented pa-scheduler-tabs" role="group" aria-label="PA scheduler mode">
            {schedulerTabs.map(([tab, label]) => (
              <button
                key={tab}
                type="button"
                className={`method-pill ${schedulerTab === tab ? "active" : ""}`}
                disabled={lockedSchedulerTab !== null && tab !== lockedSchedulerTab && tab !== "diagnostics"}
                onClick={() => setSchedulerTab(tab)}
              >
                {label}
              </button>
            ))}
          </div>
          {schedulerTab === "auto" && (
            <section className="pa-mode-panel">
              <div className="fields pa-scheduler-mini-grid">
                <label>
                  Expected Frames
                  <input value={fmtInt(currentExpectedFrames)} readOnly />
                </label>
                <label>
                  Estimated Capture Time
                  <input value={durationText(currentEstimatedCaptureCounts)} readOnly />
                </label>
                <label>
                  Return Position
                  <input value={currentReturnMode.label} readOnly />
                </label>
              </div>
              <div className="button-row">
                <button
                  type="button"
                  className="command primary compact"
                  onClick={() => command("Start Scan Capture", start)}
                  disabled={isBusy}
                >
                  Start Scan Capture
                </button>
                <button
                  type="button"
                  className="command compact"
                  onClick={() => setPanelView("scan")}
                  disabled={isBusy || scanCaptureRunning}
                >
                  Scan Settings
                </button>
              </div>
              <p className="muted pa-mode-note">Uses current scan and timing settings.</p>
              <section className="pa-mode-panel pa-scheduler-save-panel" aria-label="PA image save options">
                <div className="pa-save-panel-header">
                  <h4>Save Image</h4>
                  <button
                    type="button"
                    className="command compact"
                    onClick={() => command("Save Selected PA Images", saveSelectedPaImages)}
                    disabled={!canRunPaSaveSelection}
                  >
                    Save
                  </button>
                </div>
                <label className="pa-save-name-control">
                  Save Name
                  <input value={paSaveName} onChange={(event) => setPaSaveName(event.target.value)} />
                </label>
                <div className="pa-save-checkboxes" role="group" aria-label="PA image save sources">
                  <label className={!canSaveCurrentPaImage ? "disabled" : ""}>
                    <input
                      type="checkbox"
                      checked={saveCurrentSelected}
                      onChange={(event) => setSaveCurrentSelected(event.target.checked)}
                      disabled={!canSaveCurrentPaImage}
                    />
                    <span>Current</span>
                  </label>
                  <label className={!canSaveCanvasPaImage ? "disabled" : ""}>
                    <input
                      type="checkbox"
                      checked={saveCanvasSelected}
                      onChange={(event) => setSaveCanvasSelected(event.target.checked)}
                      disabled={!canSaveCanvasPaImage}
                    />
                    <span>Canvas</span>
                  </label>
                </div>
                <span className="pa-save-status">{paSaveMessage}</span>
              </section>
            </section>
          )}
          {schedulerTab === "point" && (
            <section className="pa-mode-panel">
              <div className="fields pa-scheduler-mini-grid">
                <label>
                  Manual X
                  <input value={manualX} onChange={(event) => setManualX(event.target.value)} />
                </label>
                <label>
                  Manual Y
                  <input value={manualY} onChange={(event) => setManualY(event.target.value)} />
                </label>
                <label>
                  Pulse Repetition Rate
                  <input value={pointRateHz} onChange={(event) => setPointRateHz(event.target.value)} />
                </label>
                <label>
                  Shots
                  <input value={pointShots} onChange={(event) => setPointShots(event.target.value)} />
                </label>
              </div>
              <div className="button-row">
                <button
                  type="button"
                  className="command primary compact"
                  onClick={() => command("Start Capture", startPointCapture)}
                  disabled={isBusy || scanCaptureRunning || pointCaptureRunning}
                >
                  Start Capture
                </button>
                <button
                  type="button"
                  className="command compact"
                  onClick={() => command("Update Point Position", applyManualPosition)}
                  disabled={isBusy || scanCaptureRunning}
                >
                  Update Position
                </button>
              </div>
              <section className="pa-mode-panel pa-point-save-panel" aria-label="PA point series save options">
                <div className="pa-save-panel-header">
                  <h4>Save Point Series</h4>
                  <button
                    type="button"
                    className="command compact"
                    onClick={() => command("Save Point Series", savePointSeries)}
                    disabled={!canSavePointSeries}
                  >
                    Save
                  </button>
                </div>
                <label className="pa-save-name-control">
                  Save Name
                  <input value={pointSaveName} onChange={(event) => setPointSaveName(event.target.value)} />
                </label>
                <span className="pa-save-status">{pointSaveMessage}</span>
              </section>
            </section>
          )}
          {schedulerTab === "manual" && (
            <section className="pa-mode-panel">
              <div className="fields pa-scheduler-mini-grid">
                <label>
                  Manual X
                  <input value={manualX} onChange={(event) => setManualX(event.target.value)} />
                </label>
                <label>
                  Manual Y
                  <input value={manualY} onChange={(event) => setManualY(event.target.value)} />
                </label>
                <label>
                  Pulse Repetition Rate
                  <input value={manualPulseRateHz} onChange={(event) => setManualPulseRateHz(event.target.value)} />
                </label>
              </div>
              <div className="button-row">
                <button
                  type="button"
                  className="command compact"
                  onClick={() => command("Update Manual Position", applyManualPosition)}
                  disabled={isBusy || captureModeRunning}
                >
                  Update Position
                </button>
                <button
                  type="button"
                  className={`command compact ${manualPulseActive ? "danger" : ""}`}
                  onClick={() => command(manualPulseActive ? "Pulse Off" : "Pulse On", toggleManualPulse)}
                  disabled={isBusy || captureModeRunning}
                >
                  {manualPulseActive ? "Pulse Off" : "Pulse On"}
                </button>
              </div>
              <p className="muted pa-mode-note">AXIS/TCP capture chain not required.</p>
            </section>
          )}
          {schedulerTab === "waveform" && (
            <section className="pa-mode-panel">
              <div className="fields pa-scheduler-mini-grid">
                <label>
                  X Min
                  <input value={waveformXMin} onChange={(event) => setWaveformXMin(event.target.value)} />
                </label>
                <label>
                  X Max
                  <input value={waveformXMax} onChange={(event) => setWaveformXMax(event.target.value)} />
                </label>
                <label>
                  Y Min
                  <input value={waveformYMin} onChange={(event) => setWaveformYMin(event.target.value)} />
                </label>
                <label>
                  Y Max
                  <input value={waveformYMax} onChange={(event) => setWaveformYMax(event.target.value)} />
                </label>
                <label>
                  X Step
                  <input value={waveformXStep} onChange={(event) => setWaveformXStep(event.target.value)} />
                </label>
                <label>
                  Y Step
                  <input value={waveformYStep} onChange={(event) => setWaveformYStep(event.target.value)} />
                </label>
                <label>
                  Rate Hz
                  <input value={waveformRateHz} onChange={(event) => setWaveformRateHz(event.target.value)} />
                </label>
              </div>
              <div className="button-row">
                <button
                  type="button"
                  className="command primary compact"
                  onClick={() => command("Start Waveform", startWaveform)}
                  disabled={isBusy || scanCaptureRunning}
                >
                  Start Waveform
                </button>
                <button
                  type="button"
                  className="command compact"
                  onClick={() =>
                    command("Stop Scheduler", () =>
                      runSchedulerCommand("Scheduler stopped", () => client.paSchedulerCommand(PA_SCHED_CMD_STOP)),
                    )
                  }
                  disabled={isBusy || scanCaptureRunning}
                >
                  Stop
                </button>
              </div>
              <p className="muted pa-mode-note">Capture chain not required.</p>
            </section>
          )}
          {schedulerTab === "diagnostics" && (
            <section className="pa-mode-panel pa-diagnostics-panel">
              <div className="pa-diagnostics-grid">
                <div className={`pa-diagnostic-card ${paState.tone}`}>
                  <div className="pa-diagnostic-card-head">
                    <span>PA State</span>
                    <strong>{paState.label}</strong>
                  </div>
                  <p>{paState.summary}</p>
                </div>
                <div className="pa-diagnostic-card">
                  <div className="pa-diagnostic-card-head">
                    <span>Capture Link</span>
                    <strong>{toDisplayStatus(serverPa)}</strong>
                  </div>
                  <p>
                    {fmtInt(serverPa?.frames_sent ?? serverPa?.frames_received)} /{" "}
                    {fmtInt(serverPa?.expected_frames ?? currentExpectedFrames)} frames
                  </p>
                  <small>{serverPa?.client_peer || serverPa?.last_client_peer || "no peer"}</small>
                </div>
                <div className="pa-diagnostic-card">
                  <div className="pa-diagnostic-card-head">
                    <span>Receiver</span>
                    <strong>{toReceiverStatus(receiverStatus)}</strong>
                  </div>
                  <p>{receiverStatus?.phase || "-"}</p>
                  <small>{fmtInt(receiverStatus?.bytes_received)} bytes</small>
                </div>
                <div className="pa-diagnostic-card">
                  <div className="pa-diagnostic-card-head">
                    <span>TCP Listener</span>
                    <strong>{toListenerStatus(paDiagnostics)}</strong>
                  </div>
                  <p>accepted {fmtInt(paDiagnostics?.tcp_listener?.accept_count)}</p>
                  <small>{paDiagnostics?.tcp_listener?.last_client_addr || "-"}</small>
                </div>
                <div className={`pa-diagnostic-card ${acquisitionFaultCount > 0 ? "error" : acquisitionWaitCount > 0 ? "warning" : "ready"}`}>
                  <div className="pa-diagnostic-card-head">
                    <span>Health</span>
                    <strong>
                      {acquisitionFaultCount > 0
                        ? `${fmtInt(acquisitionFaultCount)} faults`
                        : acquisitionWaitCount > 0
                          ? `${fmtInt(acquisitionWaitCount)} waits`
                          : "clean"}
                    </strong>
                  </div>
                  <p>{driverHealthText(finalAxisStatus)}</p>
                  <small>{plHealthText(activePlCounters)}</small>
                </div>
                <div className={`pa-diagnostic-card ${continuityProblemCount > 0 ? "warning" : "ready"}`}>
                  <div className="pa-diagnostic-card-head">
                    <span>Continuity</span>
                    <strong>{continuityIssueText || "clean"}</strong>
                  </div>
                  <p>server {diagnosticShortText(serverStreamDiagnostics)}</p>
                  <small>receiver {diagnosticShortText(receiverStreamDiagnostics)}</small>
                </div>
                <div className="pa-diagnostic-card">
                  <div className="pa-diagnostic-card-head">
                    <span>Scheduler</span>
                    <strong>{schedulerModeLabel(displayedScheduler)}</strong>
                  </div>
                  <p>
                    state {fmtInt(displayedScheduler?.fsm_state)} · shots {fmtInt(displayedScheduler?.shot_count)}
                  </p>
                  <small>
                    captures {fmtInt(displayedScheduler?.capture_count)} · fault{" "}
                    {displayedScheduler?.fault_latched ? fmtInt(displayedScheduler.fault_detail) : "none"}
                  </small>
                </div>
              </div>
            </section>
          )}
          {captureProgressVisible && (
            <div
              className={[
                "pa-capture-progress",
                serverPa?.running ? "active" : "",
                captureProgressUnbounded ? "unbounded" : "",
                captureProgress.complete ? "complete" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(captureProgress.percent)}
            >
              <div className="pa-capture-progress-header">
                <strong>Capture Progress</strong>
                <span>{captureProgressUnbounded ? "Unlimited" : `${compactNumber(captureProgress.percent, 1)}%`}</span>
              </div>
              <div className="pa-capture-progress-track">
                <div className="pa-capture-progress-fill" style={{ width: `${captureProgress.percent}%` }} />
              </div>
              <div className="pa-capture-progress-meta">
                <span>
                  Frames {fmtInt(captureProgress.processedFrames)}
                  {captureProgressUnbounded ? "" : ` / ${fmtInt(captureProgress.expectedFrames)}`}
                </span>
                <span>Elapsed {secondsText(captureProgress.elapsedSeconds)}</span>
                {!captureProgressUnbounded && <span>Remaining {secondsText(captureProgress.remainingSeconds)}</span>}
                <span>Rate {captureProgress.frameRate > 0 ? `${compactNumber(captureProgress.frameRate, 1)} fps` : "-"}</span>
              </div>
            </div>
          )}
        </section>
      </div>
    </section>
  );
}
