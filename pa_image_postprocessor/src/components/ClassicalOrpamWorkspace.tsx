import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  DEFAULT_CLASSICAL_ORPAM_CONFIG,
  classicalDisplayValues,
  configFromAdjacentMetadata,
  formatBytes,
  validateClassicalOrpamConfig,
  type ClassicalOrpamConfig,
} from "../utils/classicalOrpam";
import {
  cancelClassicalOrpam,
  clampClassicalSliceIndex,
  loadAdjacentPaMetadata,
  loadClassicalPixelTraces,
  loadClassicalVolumeSlice,
  pickClassicalOutputDirectory,
  reconstructClassicalOrpam,
  type ClassicalAlineView,
  type ClassicalOrpamProgressEvent,
  type ClassicalOrpamResult,
  type ClassicalVolumeSlice,
} from "../utils/classicalOrpamTauri";
import { formatUnknownError, type PaSeverity } from "../utils/paImage";
import type { PaFileSummary, PaImageBuildResult } from "../utils/paImageTauri";
import { paImagePngBytes } from "../utils/paImagePng";
import { saveBinaryFile } from "../utils/saveBinary";
import {
  scientificAlinePngBytes,
  scientificAlinePngDefaultFilename,
  type ScientificAlineSeriesInput,
} from "../utils/scientificAlinePng";
import PaImageHeatmap, {
  type PaImageColormap,
  type PaImageEnhancement,
  type PaImagePixel,
  type PaImageRotation,
} from "./PaImageHeatmap";
import PlotCanvas, { type PlotDomainWindow, type PlotOverlay, type PlotXDomain } from "./PlotCanvas";

type Props = {
  active: boolean;
  path: string;
  summary?: PaFileSummary;
  ptpImage?: PaImageBuildResult;
  selectedPixel: PaImagePixel | null;
  selectedFrameIndex: number | null;
  tzOhm: number;
  zeroAdcCode: number;
  umPerCount: number;
  onPixelSelect: (pixel: PaImagePixel) => void;
  onVolumePixelSelect: (pixel: PaImagePixel, frameIndex: number) => void;
  onMessage: (message: string) => void;
};

type VolumeTab = "map" | "xz" | "yz" | "xy";
type AlineSelectionMode = "zoom" | "baseline" | "processing" | "output";
type NumericConfigKey = Exclude<
  keyof ClassicalOrpamConfig,
  "pipeline" | "relativeDepth" | "saveFilteredRf"
>;

const CLASSICAL_PRESET_STORAGE_KEY = "classicalOrpamLocalPreset";

const numericSettings: Array<{
  key: NumericConfigKey;
  label: string;
  step?: string;
}> = [
  { key: "sampleIntervalNs", label: "Sample interval ns" },
  { key: "sampleStartIndex", label: "Sample start" },
  { key: "sampleEndTrim", label: "End trim" },
  { key: "baselineStartNs", label: "Baseline start ns" },
  { key: "baselineEndNs", label: "Baseline end ns" },
  { key: "processingStartNs", label: "Processing start ns" },
  { key: "processingEndNs", label: "Processing end ns" },
  { key: "outputStartNs", label: "Output start ns" },
  { key: "outputEndNs", label: "Output end ns" },
  { key: "bandpassLowHz", label: "Band-pass low Hz" },
  { key: "bandpassHighHz", label: "Band-pass high Hz" },
  { key: "filterOrder", label: "Butterworth order" },
  { key: "soundSpeedMS", label: "Sound speed m/s" },
  { key: "t0S", label: "t0 seconds", step: "0.000000001" },
  { key: "tzOhm", label: "Transimpedance ohm" },
  { key: "vfs", label: "VFS" },
  { key: "zeroAdcCode", label: "Zero ADC code" },
  { key: "chunkRows", label: "Chunk rows" },
  { key: "umPerCount", label: "X/Y µm per count", step: "0.0001" },
];

function finiteCount(values: Array<number | null>): number[] {
  return values.map((value) => (typeof value === "number" && Number.isFinite(value) ? 1 : 0));
}

function formatNumber(value: number, digits = 2): string {
  return Number.isFinite(value) ? value.toLocaleString(undefined, { maximumFractionDigits: digits }) : "--";
}

function sampleWindow(startNs: number, endNs: number, intervalNs: number, color: string, borderColor: string): PlotDomainWindow {
  return {
    startIndex: Math.ceil(startNs / intervalNs),
    endIndex: Math.ceil(endNs / intervalNs),
    color,
    borderColor,
  };
}

function Metric({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="pa-metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
      {detail ? <em>{detail}</em> : null}
    </div>
  );
}

export default function ClassicalOrpamWorkspace({
  active,
  path,
  summary,
  ptpImage,
  selectedPixel,
  selectedFrameIndex,
  tzOhm,
  zeroAdcCode,
  umPerCount,
  onPixelSelect,
  onVolumePixelSelect,
  onMessage,
}: Props) {
  const [config, setConfig] = useState<ClassicalOrpamConfig>(() => ({
    ...DEFAULT_CLASSICAL_ORPAM_CONFIG,
    tzOhm,
    zeroAdcCode,
    umPerCount,
    pipeline: { ...DEFAULT_CLASSICAL_ORPAM_CONFIG.pipeline },
  }));
  const [presetSource, setPresetSource] = useState("application default");
  const [metadataStatus, setMetadataStatus] = useState("No source loaded");
  const [outputDirectory, setOutputDirectory] = useState("");
  const [aline, setAline] = useState<ClassicalAlineView | null>(null);
  const [alineError, setAlineError] = useState("");
  const [showRaw, setShowRaw] = useState(true);
  const [showCorrected, setShowCorrected] = useState(true);
  const [showFiltered, setShowFiltered] = useState(true);
  const [showEnvelope, setShowEnvelope] = useState(true);
  const [savingScientificFigure, setSavingScientificFigure] = useState(false);
  const [alineSelectionMode, setAlineSelectionMode] = useState<AlineSelectionMode>("zoom");
  const [alineZoom, setAlineZoom] = useState<PlotXDomain | undefined>();
  const [result, setResult] = useState<ClassicalOrpamResult | null>(null);
  const [resultStale, setResultStale] = useState(false);
  const [progress, setProgress] = useState<ClassicalOrpamProgressEvent | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [reconstructing, setReconstructing] = useState(false);
  const [workspaceMode, setWorkspaceMode] = useState<"ptp" | "classical">("classical");
  const [volumeTab, setVolumeTab] = useState<VolumeTab>("map");
  const [volumeSlice, setVolumeSlice] = useState<ClassicalVolumeSlice | null>(null);
  const [sliceError, setSliceError] = useState("");
  const [xIndex, setXIndex] = useState(0);
  const [yIndex, setYIndex] = useState(0);
  const [zIndex, setZIndex] = useState(0);
  const [displayScale, setDisplayScale] = useState<"linear" | "db">("linear");
  const [dynamicRangeDb, setDynamicRangeDb] = useState(40);
  const [colormap, setColormap] = useState<PaImageColormap>("magma");
  const [enhancement, setEnhancement] = useState<PaImageEnhancement>("percentile");
  const [volumeRotation, setVolumeRotation] = useState<PaImageRotation>(0);
  const configVersionRef = useRef(0);
  const reconstructionCounterRef = useRef(0);
  const sliceGenerationRef = useRef(0);
  const parentCalibrationRef = useRef({ tzOhm, zeroAdcCode, umPerCount });

  const markConfigChanged = useCallback(() => {
    configVersionRef.current += 1;
    setResultStale(Boolean(result));
  }, [result]);

  const applyMetadata = useCallback(async (sourcePath: string, markExistingResultStale = false) => {
    if (!sourcePath) {
      setMetadataStatus("No source loaded");
      setPresetSource("application default");
      return;
    }
    try {
      const metadata = await loadAdjacentPaMetadata(sourcePath);
      if (!metadata) {
        setMetadataStatus("Adjacent metadata.json not found");
        setPresetSource("application default");
        return;
      }
      setConfig((current) => {
        const loaded = configFromAdjacentMetadata(current, metadata);
        setPresetSource(loaded.source);
        return loaded.config;
      });
      configVersionRef.current += 1;
      setMetadataStatus("Adjacent metadata.json loaded");
      if (markExistingResultStale) setResultStale(true);
    } catch (error) {
      setMetadataStatus(`Metadata load failed: ${formatUnknownError(error)}`);
    }
  }, []);

  useEffect(() => {
    setResult(null);
    setVolumeSlice(null);
    setProgress(null);
    setResultStale(false);
    setAline(null);
    setAlineError("");
    setAlineZoom(undefined);
    void applyMetadata(path);
  }, [applyMetadata, path]);

  useEffect(() => {
    const previous = parentCalibrationRef.current;
    const changed = previous.tzOhm !== tzOhm
      || previous.zeroAdcCode !== zeroAdcCode
      || previous.umPerCount !== umPerCount;
    parentCalibrationRef.current = { tzOhm, zeroAdcCode, umPerCount };
    setConfig((current) => ({
      ...current,
      tzOhm,
      zeroAdcCode,
      umPerCount,
    }));
    if (changed) {
      configVersionRef.current += 1;
      setResultStale(true);
    }
  }, [tzOhm, umPerCount, zeroAdcCode]);

  useEffect(() => {
    if (selectedPixel) {
      setXIndex(selectedPixel.x);
      setYIndex(selectedPixel.y);
    }
  }, [selectedPixel]);

  useEffect(() => {
    if (!path || selectedFrameIndex === null) {
      setAline(null);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      loadClassicalPixelTraces(path, selectedFrameIndex, config)
        .then((next) => {
          if (cancelled) return;
          setAline(next);
          setAlineError("");
        })
        .catch((error) => {
          if (cancelled) return;
          setAline(null);
          setAlineError(formatUnknownError(error));
        });
    }, 120);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [config, path, selectedFrameIndex]);

  const sampleCount = summary?.detected_sample_count_max ?? 0;
  const gridWidth = summary?.detected_x_points ?? ptpImage?.width ?? 0;
  const gridHeight = summary?.detected_y_points ?? ptpImage?.height ?? 0;
  const validation = useMemo(
    () => validateClassicalOrpamConfig(config, sampleCount, gridWidth, gridHeight),
    [config, gridHeight, gridWidth, sampleCount],
  );

  const updateNumber = (key: NumericConfigKey, text: string) => {
    const value = Number(text);
    if (!Number.isFinite(value)) return;
    setConfig((current) => ({ ...current, [key]: value }));
    markConfigChanged();
  };

  const updatePipeline = (key: keyof ClassicalOrpamConfig["pipeline"], enabled: boolean) => {
    setConfig((current) => ({
      ...current,
      pipeline: { ...current.pipeline, [key]: enabled },
    }));
    markConfigChanged();
  };

  const chooseOutputDirectory = async () => {
    try {
      const directory = await pickClassicalOutputDirectory();
      if (directory) setOutputDirectory(directory);
    } catch (error) {
      onMessage(`Choose reconstruction directory failed: ${formatUnknownError(error)}`);
    }
  };

  const saveLocalPreset = () => {
    localStorage.setItem(CLASSICAL_PRESET_STORAGE_KEY, JSON.stringify(config));
    setPresetSource("saved local preset");
    onMessage("Saved the current classical OR-PAM pipeline as a local preset.");
  };

  const loadLocalPreset = () => {
    try {
      const raw = localStorage.getItem(CLASSICAL_PRESET_STORAGE_KEY);
      if (!raw) {
        onMessage("No saved classical OR-PAM preset is available.");
        return;
      }
      const parsed = JSON.parse(raw) as ClassicalOrpamConfig;
      setConfig({ ...parsed, pipeline: { ...parsed.pipeline } });
      configVersionRef.current += 1;
      setPresetSource("saved local preset");
      setResultStale(Boolean(result));
    } catch (error) {
      onMessage(`Load local preset failed: ${formatUnknownError(error)}`);
    }
  };

  const runReconstruction = async () => {
    if (!path || !outputDirectory || validation.errors.length > 0) return;
    const startedVersion = configVersionRef.current;
    const nextRequestId = `classical-${Date.now()}-${reconstructionCounterRef.current += 1}`;
    setRequestId(nextRequestId);
    setReconstructing(true);
    setProgress({
      requestId: nextRequestId,
      sourceFrameCount: 0,
      validFrameCount: 0,
      completedRows: 0,
      totalRows: gridHeight,
      elapsedMs: 0,
      estimatedRemainingMs: null,
      stage: "parsing",
      warningCount: 0,
    });
    setResult(null);
    setVolumeSlice(null);
    setResultStale(false);
    const unlisten = await listen<ClassicalOrpamProgressEvent>("pa-classical-progress", (event) => {
      if (event.payload.requestId !== nextRequestId) return;
      setProgress(event.payload);
    });
    try {
      const nextResult = await reconstructClassicalOrpam(path, outputDirectory, config, nextRequestId);
      if (startedVersion !== configVersionRef.current) {
        setResult(nextResult);
        setResultStale(true);
        onMessage("Reconstruction finished, but settings changed during the run. The result is marked stale.");
      } else {
        setResult(nextResult);
        setResultStale(false);
        setVolumeTab("map");
        setZIndex(Math.floor(nextResult.shape_yxz[2] / 2));
        onMessage(`Saved linear [y,x,z] reconstruction to ${nextResult.output_directory}.`);
      }
    } catch (error) {
      onMessage(`Classical reconstruction failed: ${formatUnknownError(error)}`);
    } finally {
      unlisten();
      setRequestId(null);
      setReconstructing(false);
    }
  };

  const cancelReconstruction = async () => {
    if (!requestId) return;
    try {
      await cancelClassicalOrpam(requestId);
      onMessage("Cancel requested; the explicitly named .partial volume will be retained.");
    } catch (error) {
      onMessage(`Cancel reconstruction failed: ${formatUnknownError(error)}`);
    }
  };

  useEffect(() => {
    if (!result || volumeTab === "map") {
      setVolumeSlice(null);
      return;
    }
    const generation = sliceGenerationRef.current + 1;
    sliceGenerationRef.current = generation;
    const index = volumeTab === "xz" ? yIndex : volumeTab === "yz" ? xIndex : zIndex;
    loadClassicalVolumeSlice(result, volumeTab, index)
      .then((next) => {
        if (sliceGenerationRef.current !== generation) return;
        setVolumeSlice(next);
        setSliceError("");
      })
      .catch((error) => {
        if (sliceGenerationRef.current !== generation) return;
        setVolumeSlice(null);
        setSliceError(formatUnknownError(error));
      });
  }, [result, volumeTab, xIndex, yIndex, zIndex]);

  const handleAlineSelection = (startIndex: number, endIndex: number) => {
    if (!aline) return;
    const start = Math.max(0, Math.min(startIndex, endIndex));
    const end = Math.min(aline.raw_current_ua.length - 1, Math.max(startIndex, endIndex));
    if (alineSelectionMode === "zoom") {
      setAlineZoom({ startIndex: start, endIndex: end });
      return;
    }
    const startNs = start * config.sampleIntervalNs;
    const endNs = (end + 1) * config.sampleIntervalNs;
    const patch = alineSelectionMode === "baseline"
      ? { baselineStartNs: startNs, baselineEndNs: endNs }
      : alineSelectionMode === "processing"
        ? { processingStartNs: startNs, processingEndNs: endNs }
        : { outputStartNs: startNs, outputEndNs: endNs };
    setConfig((current) => ({ ...current, ...patch }));
    markConfigChanged();
  };

  const traceOverlays = useMemo<PlotOverlay[]>(() => {
    if (!aline) return [];
    const overlays: PlotOverlay[] = [];
    if (showCorrected) overlays.push({ values: aline.baseline_corrected_ua, color: "#0ea5e9", label: "baseline-corrected", alpha: 0.9 });
    if (showFiltered) overlays.push({ values: aline.filtered_rf_ua, xOffset: aline.processing_offset, color: "#7c3aed", label: "filtered RF", alpha: 0.9 });
    if (showEnvelope) overlays.push({ values: aline.envelope_ua, xOffset: aline.processing_offset, color: "#f59e0b", label: config.pipeline.hilbertEnvelopeEnabled ? "Hilbert envelope" : "pipeline output", lineWidth: 2 });
    return overlays;
  }, [aline, config.pipeline.hilbertEnvelopeEnabled, showCorrected, showEnvelope, showFiltered]);
  const scientificTraceSeries = useMemo<ScientificAlineSeriesInput[]>(() => {
    if (!aline) return [];
    const series: ScientificAlineSeriesInput[] = [];
    if (showRaw) series.push({ label: "Raw current", color: "#0F4D92", values: aline.raw_current_ua });
    if (showCorrected) series.push({ label: "Baseline-corrected", color: "#42949E", values: aline.baseline_corrected_ua });
    if (showFiltered) series.push({ label: "Filtered RF", color: "#9A4D8E", values: aline.filtered_rf_ua, xOffset: aline.processing_offset });
    if (showEnvelope) {
      series.push({
        label: config.pipeline.hilbertEnvelopeEnabled ? "Hilbert envelope" : "Pipeline output",
        color: "#B64342",
        values: aline.envelope_ua,
        xOffset: aline.processing_offset,
      });
    }
    return series;
  }, [aline, config.pipeline.hilbertEnvelopeEnabled, showCorrected, showEnvelope, showFiltered, showRaw]);
  const traceValues = aline
    ? showRaw
      ? aline.raw_current_ua
      : aline.baseline_corrected_ua
    : [];
  const traceWindows = useMemo<PlotDomainWindow[]>(
    () => [
      sampleWindow(config.baselineStartNs, config.baselineEndNs, config.sampleIntervalNs, "rgba(14,165,233,0.10)", "rgba(2,132,199,0.6)"),
      sampleWindow(config.processingStartNs, config.processingEndNs, config.sampleIntervalNs, "rgba(124,58,237,0.06)", "rgba(124,58,237,0.55)"),
      sampleWindow(config.outputStartNs, config.outputEndNs, config.sampleIntervalNs, "rgba(245,158,11,0.10)", "rgba(180,83,9,0.65)"),
    ],
    [config],
  );

  const sourceVolumeValues = volumeTab === "map" ? result?.map_values ?? [] : volumeSlice?.values ?? [];
  const displayValues = useMemo(
    () => classicalDisplayValues(sourceVolumeValues, displayScale, dynamicRangeDb),
    [displayScale, dynamicRangeDb, sourceVolumeValues],
  );
  const viewWidth = volumeTab === "map" ? result?.shape_yxz[1] ?? gridWidth : volumeSlice?.width ?? 1;
  const viewHeight = volumeTab === "map" ? result?.shape_yxz[0] ?? gridHeight : volumeSlice?.height ?? 1;
  const viewCounts = useMemo(() => {
    if (volumeTab === "map" && result) return result.pixel_counts;
    return finiteCount(displayValues);
  }, [displayValues, result, volumeTab]);
  const viewAxisLabels = volumeTab === "map" && result
    ? { xStart: result.x_start_um, xEnd: result.x_end_um, yStart: result.y_start_um, yEnd: result.y_end_um }
    : volumeSlice
      ? {
          xStart: volumeSlice.horizontal_start_um,
          xEnd: volumeSlice.horizontal_end_um,
          yStart: volumeSlice.vertical_start_um,
          yEnd: volumeSlice.vertical_end_um,
        }
      : undefined;

  const selectVolumePixel = (pixel: PaImagePixel) => {
    if (!result) return;
    const sourcePixel = volumeTab === "map" || volumeTab === "xy"
      ? pixel
      : volumeTab === "xz"
        ? { x: pixel.x, y: yIndex }
        : { x: xIndex, y: pixel.x };
    if (volumeTab === "map" || volumeTab === "xy") {
      setXIndex(pixel.x);
      setYIndex(pixel.y);
    } else if (volumeTab === "xz") {
      setXIndex(pixel.x);
      setZIndex(pixel.y);
    } else {
      setYIndex(pixel.x);
      setZIndex(pixel.y);
    }
    const frameIndex = result.pixel_frame_indices[sourcePixel.y * result.shape_yxz[1] + sourcePixel.x];
    if (frameIndex === null || frameIndex === undefined) {
      onMessage(`Volume pixel x ${sourcePixel.x}, y ${sourcePixel.y} has no valid source frame.`);
      return;
    }
    onVolumePixelSelect(sourcePixel, frameIndex);
  };

  const saveCurrentViewPng = async () => {
    if (!result || displayValues.length === 0) return;
    try {
      const bytes = await paImagePngBytes({
        width: viewWidth,
        height: viewHeight,
        values: displayValues,
        counts: viewCounts,
        zoom: null,
        colormap,
        enhancement: displayScale === "db" ? "minmax" : enhancement,
        rotation: volumeRotation,
        mask: null,
      });
      const saved = await saveBinaryFile({
        defaultFilename: `classical_orpam_${volumeTab}.png`,
        bytes,
        mime: "image/png",
        filters: [{ name: "PNG Image", extensions: ["png"] }],
      });
      onMessage(saved ? `Saved current reconstruction view to ${saved}.` : "Save current view cancelled.");
    } catch (error) {
      onMessage(`Save current reconstruction view failed: ${formatUnknownError(error)}`);
    }
  };

  const saveScientificAlinePng = async () => {
    if (!aline || scientificTraceSeries.length === 0 || savingScientificFigure) return;
    setSavingScientificFigure(true);
    try {
      const bytes = await scientificAlinePngBytes({
        timeNs: aline.valid_time_ns,
        series: scientificTraceSeries,
        visibleDomain: alineZoom,
        frameIndex: aline.frame_index,
      });
      const saved = await saveBinaryFile({
        defaultFilename: scientificAlinePngDefaultFilename(path, aline.frame_index),
        bytes,
        mime: "image/png",
        filters: [{ name: "Scientific PNG", extensions: ["png"] }],
      });
      onMessage(saved ? `Saved scientific A-line figure to ${saved}.` : "Save scientific A-line figure cancelled.");
    } catch (error) {
      onMessage(`Save scientific A-line figure failed: ${formatUnknownError(error)}`);
    } finally {
      setSavingScientificFigure(false);
    }
  };

  const progressPercent = progress && progress.totalRows > 0
    ? Math.min(100, Math.max(0, progress.completedRows / progress.totalRows * 100))
    : 0;
  const resultSeverity: PaSeverity = result?.diagnostics.warning_count ? "warning" : "ok";
  const cursorCoordinates = result
    ? `X ${formatNumber(result.x_um[xIndex] ?? Number.NaN)} µm · Y ${formatNumber(result.y_um[yIndex] ?? Number.NaN)} µm · Z ${formatNumber(result.z_um[zIndex] ?? Number.NaN)} µm`
    : "Run reconstruction for calibrated coordinates";
  const selectedViewPixel = volumeTab === "map" || volumeTab === "xy"
    ? { x: xIndex, y: yIndex }
    : volumeTab === "xz"
      ? { x: xIndex, y: zIndex }
      : { x: yIndex, y: zIndex };

  return (
    <>
      <div className="classical-mode-bar" aria-label="Reconstruction mode">
        <strong>Reconstruction mode</strong>
        <button type="button" className={`method-pill ${workspaceMode === "ptp" ? "active" : ""}`} onClick={() => setWorkspaceMode("ptp")}>PTP 2D</button>
        <button type="button" className={`method-pill ${workspaceMode === "classical" ? "active" : ""}`} onClick={() => setWorkspaceMode("classical")}>Classical 3D</button>
        <span>PTP 2D stays unchanged above; Classical 3D adds processed A-lines and volume sections.</span>
      </div>
      {workspaceMode === "classical" ? (
        <>
      <div className="pa-image-panel classical-aline-panel">
        <div className="pa-image-section-title">
          <div>
            <h3>Processed A-line</h3>
            <span className="classical-subtitle">Valid-trace time; index 0 = source sample {config.sampleStartIndex}</span>
          </div>
          <div className="pa-image-actions compact-actions">
            <button type="button" className="command compact" onClick={() => void applyMetadata(path, Boolean(result))} disabled={!path}>Reset from Metadata</button>
            <button type="button" className="command compact" onClick={loadLocalPreset}>Load Preset</button>
            <button type="button" className="command compact" onClick={saveLocalPreset}>Save Preset</button>
            <button type="button" className="command compact" onClick={() => void saveScientificAlinePng()} disabled={!aline || scientificTraceSeries.length === 0 || savingScientificFigure}>{savingScientificFigure ? "Rendering…" : "Save Scientific PNG"}</button>
          </div>
        </div>

        <div className="classical-pipeline" aria-label="A-line processing pipeline">
          <label className={config.pipeline.medianBaselineEnabled ? "enabled" : ""}>
            <input
              type="checkbox"
              checked={config.pipeline.medianBaselineEnabled}
              onChange={(event) => updatePipeline("medianBaselineEnabled", event.target.checked)}
            />
            <strong>1. Median baseline</strong>
            <span>{config.baselineStartNs}-{config.baselineEndNs} ns</span>
          </label>
          <b>→</b>
          <label className={config.pipeline.bandpassEnabled ? "enabled" : ""}>
            <input
              type="checkbox"
              checked={config.pipeline.bandpassEnabled}
              onChange={(event) => updatePipeline("bandpassEnabled", event.target.checked)}
            />
            <strong>2. Butterworth SOS</strong>
            <span>{formatNumber(config.bandpassLowHz / 1e6)}-{formatNumber(config.bandpassHighHz / 1e6)} MHz · zero phase</span>
          </label>
          <b>→</b>
          <label className={config.pipeline.hilbertEnvelopeEnabled ? "enabled" : ""}>
            <input
              type="checkbox"
              checked={config.pipeline.hilbertEnvelopeEnabled}
              onChange={(event) => updatePipeline("hilbertEnvelopeEnabled", event.target.checked)}
            />
            <strong>3. Hilbert envelope</strong>
            <span>linear amplitude</span>
          </label>
        </div>

        <div className="lock-method-control pa-image-mode-control classical-aline-selection" role="group" aria-label="Processed A-line selection mode">
          {(["zoom", "baseline", "processing", "output"] as AlineSelectionMode[]).map((mode) => (
            <button key={mode} type="button" className={`method-pill ${alineSelectionMode === mode ? "active" : ""}`} onClick={() => setAlineSelectionMode(mode)}>
              {mode === "zoom" ? "Zoom" : mode === "baseline" ? "Baseline" : mode === "processing" ? "Processing" : "Output"}
            </button>
          ))}
        </div>
        <div className="classical-trace-toggles">
          <label><input type="checkbox" checked={showRaw} onChange={(event) => setShowRaw(event.target.checked)} /> Raw current</label>
          <label><input type="checkbox" checked={showCorrected} onChange={(event) => setShowCorrected(event.target.checked)} /> Baseline-corrected</label>
          <label><input type="checkbox" checked={showFiltered} onChange={(event) => setShowFiltered(event.target.checked)} /> Filtered RF</label>
          <label><input type="checkbox" checked={showEnvelope} onChange={(event) => setShowEnvelope(event.target.checked)} /> {config.pipeline.hilbertEnvelopeEnabled ? "Envelope" : "Pipeline output"}</label>
        </div>
        <span className="classical-subtitle">Time (µs) · Current (µA) · Python/Matplotlib · 22 pt axis labels · 11 pt legend · 2400 × 1200 px.</span>
        <PlotCanvas
          values={traceValues}
          xDomain={alineZoom}
          color="#2563eb"
          label={showRaw ? "raw current" : "baseline-corrected"}
          overlays={traceOverlays}
          domainWindows={traceWindows}
          xLabel="Time from valid trace start (µs)"
          xTickFormatter={(index) => {
            const timeIndex = Math.max(0, Math.min((aline?.valid_time_ns.length ?? 1) - 1, Math.round(index)));
            const timeNs = aline?.valid_time_ns[timeIndex];
            return Number.isFinite(timeNs) ? formatNumber((timeNs as number) / 1000, 3) : "--";
          }}
          ariaLabel="Processed PA A-line"
          title={selectedFrameIndex === null
            ? "Click a PTP or volume pixel to load its processed A-line."
            : alineSelectionMode === "zoom"
              ? `Source frame ${selectedFrameIndex} · left-drag to zoom; right-click to reset.`
              : `Source frame ${selectedFrameIndex} · left-drag to set ${alineSelectionMode} window.`}
          yTickFormatter={(value) => `${formatNumber(value, 1)} µA`}
          onSelectionComplete={handleAlineSelection}
          onResetZoom={() => setAlineZoom(undefined)}
          height={250}
          active={active}
        />
        {alineError ? <div className="classical-error">{alineError}</div> : null}
        <div className="pa-metric-grid classical-aline-metrics">
          <Metric label="Median baseline" value={aline ? `${formatNumber(aline.metrics.median_baseline_ua, 3)} µA` : "--"} />
          <Metric label="Noise MAD / RMS" value={aline ? `${formatNumber(aline.metrics.baseline_noise_mad_ua, 3)} / ${formatNumber(aline.metrics.baseline_noise_rms_ua, 3)} µA` : "--"} />
          <Metric label="Output PTP" value={aline ? `${formatNumber(aline.metrics.output_ptp_ua, 3)} µA` : "--"} />
          <Metric label="Envelope peak" value={aline ? `${formatNumber(aline.metrics.envelope_peak_ua, 3)} µA` : "--"} />
          <Metric label="Peak time / depth" value={aline ? `${formatNumber(aline.metrics.peak_time_ns)} ns / ${formatNumber(aline.metrics.peak_depth_um)} µm` : "--"} />
          <Metric label="ADC clipping" value={aline ? `${aline.metrics.clipped_low_count} low · ${aline.metrics.clipped_high_count} high` : "--"} />
        </div>

        <details className="classical-settings" open>
          <summary>Reconstruction Settings</summary>
          <div className="classical-settings-grid">
            {numericSettings.map((setting) => (
              <label key={setting.key}>
                {setting.label}
                <input
                  value={config[setting.key]}
                  step={setting.step}
                  onChange={(event) => updateNumber(setting.key, event.target.value)}
                />
              </label>
            ))}
            <label className="classical-check-field">
              <input
                type="checkbox"
                checked={config.relativeDepth}
                onChange={(event) => {
                  setConfig((current) => ({ ...current, relativeDepth: event.target.checked }));
                  markConfigChanged();
                }}
              />
              Relative depth
            </label>
            <label className="classical-check-field">
              <input
                type="checkbox"
                checked={config.saveFilteredRf}
                onChange={(event) => {
                  setConfig((current) => ({ ...current, saveFilteredRf: event.target.checked }));
                  markConfigChanged();
                }}
              />
              Save filtered RF
            </label>
          </div>
          <div className="classical-preset-status">
            Preset: {presetSource} · {metadataStatus}
          </div>
          {validation.preview ? (
            <div className="classical-derived-grid">
              <span>Valid source <strong>[{validation.preview.sourceStartIndex},{validation.preview.sourceEndIndex}) = {validation.preview.validSampleCount}</strong></span>
              <span>Volume <strong>{validation.preview.shapeYxz.join(" × ")}</strong></span>
              <span>Sampling / Nyquist <strong>{formatNumber(validation.preview.samplingRateHz / 1e6)} / {formatNumber(validation.preview.nyquistHz / 1e6)} MHz</strong></span>
              <span>One-way Δz <strong>{formatNumber(validation.preview.depthSampleSpacingUm)} µm/sample</strong></span>
              <span>Depth range <strong>{formatNumber(validation.preview.depthStartUm)}-{formatNumber(validation.preview.depthEndUm)} µm</strong></span>
              <span>Linear volume <strong>{formatBytes(validation.preview.envelopeBytes)}</strong></span>
            </div>
          ) : null}
          {validation.errors.length > 0 ? (
            <ul className="classical-validation-errors">
              {validation.errors.map((error) => <li key={error}>{error}</li>)}
            </ul>
          ) : null}
          <p className="classical-physics-note">
            z = c × (t − t0), one-way PA time of flight. Δz is axial sample spacing, not axial resolution.
            Until t0 is calibrated, depth remains relative.
          </p>
        </details>
      </div>

      <div className="pa-image-panel classical-volume-panel">
        <div className="pa-image-section-title">
          <div>
            <h3>Classical 3D Envelope</h3>
            <span className="classical-subtitle">PTP 2D remains unchanged above; this is direct A-line stacking.</span>
          </div>
          <div className="pa-image-actions compact-actions">
            <button type="button" className="command compact" onClick={chooseOutputDirectory} disabled={reconstructing}>Output Directory</button>
            <button type="button" className="command compact" onClick={cancelReconstruction} disabled={!requestId}>Cancel</button>
            <button type="button" className="command compact" onClick={saveCurrentViewPng} disabled={!result || displayValues.length === 0}>Save Current View PNG</button>
            <button
              type="button"
              className="command primary"
              onClick={runReconstruction}
              disabled={!active || reconstructing || !path || !outputDirectory || validation.errors.length > 0}
            >
              Run + Save Numerical
            </button>
          </div>
        </div>
        <div className="classical-output-path">{outputDirectory || "Choose a new output directory; completed outputs are never overwritten."}</div>

        <div className="classical-volume-toolbar">
          <div className="lock-method-control classical-volume-tabs" role="group" aria-label="Classical volume view">
            {([
              ["map", "XY MAP"],
              ["xz", "XZ B-scan"],
              ["yz", "YZ B-scan"],
              ["xy", "XY C-scan"],
            ] as Array<[VolumeTab, string]>).map(([tab, label]) => (
              <button key={tab} type="button" className={`method-pill ${volumeTab === tab ? "active" : ""}`} onClick={() => setVolumeTab(tab)}>
                {label}
              </button>
            ))}
          </div>
          <div className="classical-slice-controls">
            <label>
              X index
              <input
                value={xIndex}
                inputMode="numeric"
                onChange={(event) => setXIndex(clampClassicalSliceIndex(event.target.value, result?.shape_yxz[1] ?? gridWidth))}
              />
            </label>
            <label>
              Y index
              <input
                value={yIndex}
                inputMode="numeric"
                onChange={(event) => setYIndex(clampClassicalSliceIndex(event.target.value, result?.shape_yxz[0] ?? gridHeight))}
              />
            </label>
            <label>
              Z index
              <input
                value={zIndex}
                inputMode="numeric"
                onChange={(event) => setZIndex(clampClassicalSliceIndex(event.target.value, result?.shape_yxz[2] ?? 1))}
              />
            </label>
            <label>
              Display
              <select value={displayScale} onChange={(event) => setDisplayScale(event.target.value as "linear" | "db")}>
                <option value="linear">Linear</option>
                <option value="db">dB display</option>
              </select>
            </label>
            <label>
              Range dB
              <input value={dynamicRangeDb} onChange={(event) => setDynamicRangeDb(Number(event.target.value) || 40)} />
            </label>
            <label>
              Colormap
              <select value={colormap} onChange={(event) => setColormap(event.target.value as PaImageColormap)}>
                <option value="magma">Magma</option>
                <option value="viridis">Viridis</option>
                <option value="turbo">Turbo</option>
                <option value="gray">Gray</option>
                <option value="emerald">Emerald</option>
              </select>
            </label>
            <label>
              Rotation
              <select value={volumeRotation} onChange={(event) => setVolumeRotation(Number(event.target.value) as PaImageRotation)}>
                <option value={0}>0°</option>
                <option value={90}>90°</option>
                <option value={180}>180°</option>
                <option value={270}>270°</option>
              </select>
            </label>
            <label>
              Enhance
              <select value={enhancement} onChange={(event) => setEnhancement(event.target.value as PaImageEnhancement)}>
                <option value="percentile">Percentile</option>
                <option value="minmax">Min / Max</option>
                <option value="sqrt">Sqrt</option>
                <option value="log">Log</option>
              </select>
            </label>
          </div>
        </div>

        <PaImageHeatmap
          width={Math.max(1, viewWidth)}
          height={Math.max(1, viewHeight)}
          values={displayValues}
          counts={viewCounts}
          axisLabels={viewAxisLabels}
          umPerCount={1}
          selectedPixel={result ? selectedViewPixel : null}
          colormap={colormap}
          enhancement={displayScale === "db" ? "minmax" : enhancement}
          rotation={volumeRotation}
          onPixelSelect={selectVolumePixel}
          active={active && Boolean(result)}
        />
        {sliceError ? <div className="classical-error">{sliceError}</div> : null}
        {progress ? (
          <div className="pa-build-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progressPercent)}>
            <div className="pa-build-progress-track">
              <div className="pa-build-progress-fill" style={{ width: `${Math.round(progressPercent)}%` }} />
            </div>
            <span>
              {progress.stage} · {Math.round(progressPercent)}% · {progress.validFrameCount}/{progress.sourceFrameCount} valid/source frames · {(progress.sourceFrameCount / Math.max(progress.elapsedMs, 1)).toFixed(1)} kfps · {(progress.elapsedMs / 1000).toFixed(1)}s elapsed · ETA {progress.estimatedRemainingMs === null ? "--" : `${(progress.estimatedRemainingMs / 1000).toFixed(1)}s`} · {progress.warningCount} warnings
            </span>
          </div>
        ) : null}
        <div className="pa-metric-grid classical-volume-metrics">
          <Metric label="Product" value={result ? result.product_kind : "Pending"} detail="Saved numerical data stays linear" />
          <Metric label="Shape [y,x,z]" value={result ? result.shape_yxz.join(" × ") : validation.preview?.shapeYxz.join(" × ") ?? "--"} />
          <Metric label="Cursor" value={`x ${xIndex}, y ${yIndex}, z ${zIndex}`} detail={cursorCoordinates} />
          <Metric label="Diagnostics" value={result ? `${result.diagnostics.warning_count} warnings` : "--"} detail={result ? `${result.diagnostics.missing_pixel_count} missing · ${result.diagnostics.duplicate_pixel_count} duplicate · MAP/PTP r ${result.diagnostics.map_ptp_pearson_correlation?.toFixed(3) ?? "--"}` : "Run reconstruction first"} />
          <Metric label="Numerical output" value={result ? result.output_directory : "--"} detail={resultStale ? "STALE: settings changed after this run" : result ? `${result.envelope_path} · ${result.qc_files.length} QC PNGs` : "NPY + coordinates + JSON metadata + 9 QC PNGs"} />
          <Metric label="Status" value={result ? resultSeverity.toUpperCase() : reconstructing ? "RUNNING" : "READY"} detail={resultStale ? "Run again before interpreting changed settings." : metadataStatus} />
        </div>
      </div>
        </>
      ) : (
        <div className="pa-image-panel classical-mode-summary">
          PTP 2D mode is active. The original Frame Trace and PA Image workspace above remains unchanged.
        </div>
      )}
    </>
  );
}
