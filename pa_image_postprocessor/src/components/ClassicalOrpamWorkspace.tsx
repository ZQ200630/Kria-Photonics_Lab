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
import PaImageHeatmap, {
  type PaImageColormap,
  type PaImageEnhancement,
  type PaImagePixel,
} from "./PaImageHeatmap";
import PlotCanvas, { type PlotDomainWindow, type PlotOverlay } from "./PlotCanvas";

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
  onMessage: (message: string) => void;
};

type VolumeTab = "map" | "xz" | "yz" | "xy";
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
  const [result, setResult] = useState<ClassicalOrpamResult | null>(null);
  const [resultStale, setResultStale] = useState(false);
  const [progress, setProgress] = useState<ClassicalOrpamProgressEvent | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [reconstructing, setReconstructing] = useState(false);
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
  const configVersionRef = useRef(0);
  const reconstructionCounterRef = useRef(0);
  const sliceGenerationRef = useRef(0);

  const markConfigChanged = useCallback(() => {
    configVersionRef.current += 1;
    setResultStale(Boolean(result));
  }, [result]);

  const applyMetadata = useCallback(async (sourcePath: string) => {
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
    void applyMetadata(path);
  }, [applyMetadata, path]);

  useEffect(() => {
    setConfig((current) => ({
      ...current,
      tzOhm,
      zeroAdcCode,
      umPerCount,
    }));
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

  const traceOverlays = useMemo<PlotOverlay[]>(() => {
    if (!aline) return [];
    const overlays: PlotOverlay[] = [];
    if (showCorrected) overlays.push({ values: aline.baseline_corrected_ua, color: "#0ea5e9", label: "baseline-corrected", alpha: 0.9 });
    if (showFiltered) overlays.push({ values: aline.filtered_rf_ua, xOffset: aline.processing_offset, color: "#7c3aed", label: "filtered RF", alpha: 0.9 });
    if (showEnvelope) overlays.push({ values: aline.envelope_ua, xOffset: aline.processing_offset, color: "#f59e0b", label: "Hilbert envelope", lineWidth: 2 });
    return overlays;
  }, [aline, showCorrected, showEnvelope, showFiltered]);
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
    if (volumeTab === "map" || volumeTab === "xy") {
      setXIndex(pixel.x);
      setYIndex(pixel.y);
      onPixelSelect(pixel);
      return;
    }
    if (volumeTab === "xz") {
      setXIndex(pixel.x);
      setZIndex(pixel.y);
      onPixelSelect({ x: pixel.x, y: yIndex });
      return;
    }
    setYIndex(pixel.x);
    setZIndex(pixel.y);
    onPixelSelect({ x: xIndex, y: pixel.x });
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
        rotation: 0,
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

  const progressPercent = progress && progress.totalRows > 0
    ? Math.min(100, Math.max(0, progress.completedRows / progress.totalRows * 100))
    : 0;
  const resultSeverity: PaSeverity = result?.diagnostics.warning_count ? "warning" : "ok";
  const selectedViewPixel = volumeTab === "map" || volumeTab === "xy"
    ? { x: xIndex, y: yIndex }
    : volumeTab === "xz"
      ? { x: xIndex, y: zIndex }
      : { x: yIndex, y: zIndex };

  return (
    <>
      <div className="pa-image-panel classical-aline-panel">
        <div className="pa-image-section-title">
          <div>
            <h3>Processed A-line</h3>
            <span className="classical-subtitle">Valid-trace time; index 0 = source sample {config.sampleStartIndex}</span>
          </div>
          <div className="pa-image-actions compact-actions">
            <button type="button" className="command compact" onClick={() => void applyMetadata(path)} disabled={!path}>Reset from Metadata</button>
            <button type="button" className="command compact" onClick={loadLocalPreset}>Load Preset</button>
            <button type="button" className="command compact" onClick={saveLocalPreset}>Save Preset</button>
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

        <div className="classical-trace-toggles">
          <label><input type="checkbox" checked={showRaw} onChange={(event) => setShowRaw(event.target.checked)} /> Raw current</label>
          <label><input type="checkbox" checked={showCorrected} onChange={(event) => setShowCorrected(event.target.checked)} /> Baseline-corrected</label>
          <label><input type="checkbox" checked={showFiltered} onChange={(event) => setShowFiltered(event.target.checked)} /> Filtered RF</label>
          <label><input type="checkbox" checked={showEnvelope} onChange={(event) => setShowEnvelope(event.target.checked)} /> Envelope</label>
        </div>
        <PlotCanvas
          values={traceValues}
          color="#2563eb"
          label={showRaw ? "raw current" : "baseline-corrected"}
          overlays={traceOverlays}
          domainWindows={traceWindows}
          xLabel="valid trace sample index"
          ariaLabel="Processed PA A-line"
          title={selectedFrameIndex === null ? "Click a PTP or volume pixel to load its processed A-line." : `Source frame index ${selectedFrameIndex}`}
          yTickFormatter={(value) => `${formatNumber(value, 1)} µA`}
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
                onChange={(event) => setXIndex(Math.max(0, Math.min((result?.shape_yxz[1] ?? gridWidth) - 1, Number(event.target.value) || 0)))}
              />
            </label>
            <label>
              Y index
              <input
                value={yIndex}
                inputMode="numeric"
                onChange={(event) => setYIndex(Math.max(0, Math.min((result?.shape_yxz[0] ?? gridHeight) - 1, Number(event.target.value) || 0)))}
              />
            </label>
            <label>
              Z index
              <input
                value={zIndex}
                inputMode="numeric"
                onChange={(event) => setZIndex(Math.max(0, Math.min((result?.shape_yxz[2] ?? 1) - 1, Number(event.target.value) || 0)))}
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
              {progress.stage} · {Math.round(progressPercent)}% · {progress.validFrameCount}/{progress.sourceFrameCount} valid/source frames · {progress.warningCount} warnings
            </span>
          </div>
        ) : null}
        <div className="pa-metric-grid classical-volume-metrics">
          <Metric label="Product" value={result ? result.product_kind : "Pending"} detail="Saved numerical data stays linear" />
          <Metric label="Shape [y,x,z]" value={result ? result.shape_yxz.join(" × ") : validation.preview?.shapeYxz.join(" × ") ?? "--"} />
          <Metric label="Cursor" value={`x ${xIndex}, y ${yIndex}, z ${zIndex}`} detail={volumeTab === "map" ? "Click MAP to load processed A-line" : `Current ${volumeTab.toUpperCase()} section`} />
          <Metric label="Diagnostics" value={result ? `${result.diagnostics.warning_count} warnings` : "--"} detail={result ? `${result.diagnostics.missing_pixel_count} missing · ${result.diagnostics.duplicate_pixel_count} duplicate` : "Run reconstruction first"} />
          <Metric label="Numerical output" value={result ? result.output_directory : "--"} detail={resultStale ? "STALE: settings changed after this run" : result ? result.envelope_path : "NPY + coordinates + JSON metadata"} />
          <Metric label="Status" value={result ? resultSeverity.toUpperCase() : reconstructing ? "RUNNING" : "READY"} detail={resultStale ? "Run again before interpreting changed settings." : metadataStatus} />
        </div>
      </div>
    </>
  );
}
