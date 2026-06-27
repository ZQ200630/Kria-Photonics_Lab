import { useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_PA_IMAGE_PROCESSING, indexRangeToNsWindow, type PaImageProcessing, type PaSeverity } from "../utils/paImage";
import {
  buildPaImage,
  pickPaImageFile,
  readPaFrameTrace,
  scanPaImageFile,
  type PaFileSummary,
  type PaFrameTrace,
  type PaImageBuildResult,
} from "../utils/paImageTauri";
import PaImageHeatmap from "./PaImageHeatmap";
import PlotCanvas, { type PlotPoint, type PlotXDomain } from "./PlotCanvas";

type Props = {
  active?: boolean;
  tzOhm: number;
  onBack: () => void;
};

type RoiMode = "zoom" | "roi";

export function shouldClearPaImageForProcessingChange(_key: keyof PaImageProcessing): boolean {
  return true;
}

export function shouldClearPaTraceForProcessingChange(key: keyof PaImageProcessing): boolean {
  return key === "tzOhm" || key === "vfs";
}

export function isPaImageRequestCurrent(startedGeneration: number, currentGeneration: number): boolean {
  return startedGeneration === currentGeneration;
}

function severityClass(severity?: PaSeverity): string {
  return `severity-${severity ?? "ok"}`;
}

function parseNumber(text: string, fallback: number): number {
  const value = Number(text);
  return Number.isFinite(value) ? value : fallback;
}

function normalizeIndexRange(startIndex: number, endIndex: number, maxIndex: number): PlotXDomain {
  const start = Math.max(0, Math.min(maxIndex, Math.round(Math.min(startIndex, endIndex))));
  const end = Math.max(0, Math.min(maxIndex, Math.round(Math.max(startIndex, endIndex))));
  return end > start ? { startIndex: start, endIndex: end } : { startIndex: start, endIndex: Math.min(maxIndex, start + 1) };
}

function nsToSampleIndex(ns: number, processing: PaImageProcessing, sampleMaxIndex: number): number {
  const index = processing.sampleStartIndex + ns / Math.max(1, processing.sampleIntervalNs);
  return Math.max(0, Math.min(sampleMaxIndex, Math.round(index)));
}

function issueSummary(summary?: PaFileSummary, image?: PaImageBuildResult): string {
  const severity = image?.severity ?? summary?.severity ?? "ok";
  const count = image?.issues.length ?? summary?.issues.length ?? 0;
  return `${severity.toUpperCase()} · ${count} issue${count === 1 ? "" : "s"}`;
}

export default function PaImageViewer({ active = true, tzOhm, onBack }: Props) {
  const [path, setPath] = useState("");
  const [summary, setSummary] = useState<PaFileSummary | undefined>(undefined);
  const [frameIndexText, setFrameIndexText] = useState("0");
  const [trace, setTrace] = useState<PaFrameTrace | undefined>(undefined);
  const [image, setImage] = useState<PaImageBuildResult | undefined>(undefined);
  const [processing, setProcessing] = useState<PaImageProcessing>({ ...DEFAULT_PA_IMAGE_PROCESSING, tzOhm });
  const [traceZoom, setTraceZoom] = useState<PlotXDomain | undefined>(undefined);
  const [roiMode, setRoiMode] = useState<RoiMode>("zoom");
  const [message, setMessage] = useState("Open a legacy PA binary to inspect frames and build an image.");
  const [busy, setBusy] = useState(false);
  const lastTzOhmRef = useRef(tzOhm);
  const requestGenerationRef = useRef(0);

  const bumpRequestGeneration = () => {
    requestGenerationRef.current += 1;
  };

  useEffect(() => {
    if (lastTzOhmRef.current === tzOhm) return;
    lastTzOhmRef.current = tzOhm;
    bumpRequestGeneration();
    setProcessing((current) => ({ ...current, tzOhm }));
    setImage(undefined);
    setTrace(undefined);
    setTraceZoom(undefined);
    setMessage("Tz Ohm changed; reload frame and rebuild image.");
  }, [tzOhm]);

  const traceValues = trace?.current_ua ?? [];
  const visibleDomain = traceZoom ?? { startIndex: 0, endIndex: Math.max(0, traceValues.length - 1) };
  const visibleTracePoints = useMemo<PlotPoint[]>(() => {
    if (!trace || traceValues.length === 0) return [];
    const startIndex = Math.max(0, Math.min(traceValues.length - 1, visibleDomain.startIndex));
    const endIndex = Math.max(startIndex, Math.min(traceValues.length - 1, visibleDomain.endIndex));
    return traceValues.slice(startIndex, endIndex + 1).map((value, offset) => ({ xIndex: startIndex + offset, value }));
  }, [trace, traceValues, visibleDomain.endIndex, visibleDomain.startIndex]);
  const visibleTraceValues = useMemo(() => visibleTracePoints.map((point) => point.value), [visibleTracePoints]);
  const roiSampleWindow = traceValues.length
    ? {
        startIndex: nsToSampleIndex(processing.ptpStartNs, processing, traceValues.length - 1),
        endIndex: nsToSampleIndex(processing.ptpEndNs, processing, traceValues.length - 1),
        color: "rgba(245, 158, 11, 0.14)",
        borderColor: "rgba(180, 83, 9, 0.65)",
      }
    : undefined;

  const runBusy = async (label: string, action: () => Promise<void>) => {
    setBusy(true);
    setMessage(`${label}...`);
    try {
      await action();
    } catch (error) {
      setMessage(`${label} failed: ${(error as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const openLegacyBin = () =>
    runBusy("Open Legacy Bin", async () => {
      const selectedPath = await pickPaImageFile();
      if (!selectedPath) {
        setMessage("Open Legacy Bin cancelled.");
        return;
      }
      const nextSummary = await scanPaImageFile(selectedPath);
      setPath(selectedPath);
      setSummary(nextSummary);
      setImage(undefined);
      setTrace(undefined);
      setTraceZoom(undefined);
      setFrameIndexText("0");
      bumpRequestGeneration();
      setMessage(`Loaded ${nextSummary.frame_count} frame${nextSummary.frame_count === 1 ? "" : "s"} from ${nextSummary.block_count} blocks.`);
    });

  const loadFrame = () =>
    runBusy("Load Frame", async () => {
      if (!path) {
        setMessage("Choose a legacy PA binary before loading a frame.");
        return;
      }
      const frameIndex = Math.max(0, Math.round(parseNumber(frameIndexText, 0)));
      const startedGeneration = requestGenerationRef.current;
      const nextTrace = await readPaFrameTrace(path, frameIndex, processing.tzOhm, processing.vfs);
      if (!isPaImageRequestCurrent(startedGeneration, requestGenerationRef.current)) {
        setMessage("Frame load finished after settings changed; reload frame.");
        return;
      }
      setTrace(nextTrace);
      setTraceZoom(undefined);
      setFrameIndexText(String(frameIndex));
      setMessage(`Loaded frame ${nextTrace.frame_id} with ${nextTrace.current_ua.length} samples.`);
    });

  const buildImage = () =>
    runBusy("Build Image", async () => {
      if (!path) {
        setMessage("Choose a legacy PA binary before building an image.");
        return;
      }
      const startedGeneration = requestGenerationRef.current;
      const processingSnapshot = { ...processing };
      const nextImage = await buildPaImage(path, processingSnapshot);
      if (!isPaImageRequestCurrent(startedGeneration, requestGenerationRef.current)) {
        setMessage("Image build finished after settings changed; rebuild image.");
        return;
      }
      setImage(nextImage);
      setMessage(`Built ${nextImage.width} x ${nextImage.height} PA image from ${nextImage.frame_count} frames.`);
    });

  const updateProcessingNumber = (key: keyof PaImageProcessing, text: string) => {
    const nextValue = parseNumber(text, processing[key]);
    if (Object.is(nextValue, processing[key])) return;
    bumpRequestGeneration();
    setProcessing((current) => ({ ...current, [key]: parseNumber(text, current[key]) }));
    if (shouldClearPaImageForProcessingChange(key)) setImage(undefined);
    if (shouldClearPaTraceForProcessingChange(key)) {
      setTrace(undefined);
      setTraceZoom(undefined);
    }
    setMessage(shouldClearPaTraceForProcessingChange(key) ? "Conversion changed; reload frame and rebuild image." : "Processing changed; rebuild image.");
  };

  const handleTraceSelection = (startIndex: number, endIndex: number) => {
    if (traceValues.length === 0) return;
    const range = normalizeIndexRange(startIndex, endIndex, traceValues.length - 1);
    if (roiMode === "zoom") {
      setTraceZoom(range);
      return;
    }
    const window = indexRangeToNsWindow(range.startIndex, range.endIndex, processing.sampleStartIndex, processing.sampleIntervalNs);
    bumpRequestGeneration();
    setProcessing((current) => ({ ...current, ptpStartNs: window.startNs, ptpEndNs: window.endNs }));
    setImage(undefined);
    setMessage("PTP ROI updated; rebuild image.");
  };

  const restoreTraceZoom = () => setTraceZoom(undefined);
  const frameSampleReadout =
    trace && trace.time_ns.length > 0
      ? `${trace.time_ns[0]}-${trace.time_ns[trace.time_ns.length - 1]} ns`
      : `${processing.sampleStartIndex} start, ${processing.sampleIntervalNs} ns/sample`;

  return (
    <section className="panel pa-image-viewer" aria-label="PA Image Viewer">
      <div className="pa-image-header">
        <h2>PA Image Viewer</h2>
        <button type="button" className="command compact" onClick={onBack}>
          Back
        </button>
      </div>

      <div className="pa-image-workbench">
        <div className="pa-image-panel">
          <h3>Source</h3>
          <div className="pa-image-actions">
            <button type="button" className="command primary" onClick={openLegacyBin} disabled={!active || busy}>
              Open Legacy Bin
            </button>
            <label>
              Frame Index
              <input value={frameIndexText} onChange={(event) => setFrameIndexText(event.target.value)} inputMode="numeric" />
            </label>
            <button type="button" className="command" onClick={loadFrame} disabled={!active || busy || !path}>
              Load Frame
            </button>
          </div>
          <div className="pa-image-readouts">
            <span className={severityClass(summary?.severity)}>{issueSummary(summary, image)}</span>
            <span>{summary ? `${summary.frame_count} frames · ${summary.block_count} blocks` : "No file loaded"}</span>
            <span>
              Grid {summary?.detected_x_points ?? image?.width ?? "-"} x {summary?.detected_y_points ?? image?.height ?? "-"}
            </span>
            <span>
              Samples {summary ? `${summary.detected_sample_count_min}-${summary.detected_sample_count_max}` : "-"}
            </span>
            <span className="pa-image-path">{path || "Path pending"}</span>
          </div>
        </div>

        <div className="pa-image-panel">
          <h3>PTP ROI</h3>
          <div className="fields">
            <label>
              PTP Start ns
              <input value={processing.ptpStartNs} onChange={(event) => updateProcessingNumber("ptpStartNs", event.target.value)} />
            </label>
            <label>
              PTP End ns
              <input value={processing.ptpEndNs} onChange={(event) => updateProcessingNumber("ptpEndNs", event.target.value)} />
            </label>
            <label>
              Baseline Start ns
              <input value={processing.baselineStartNs} onChange={(event) => updateProcessingNumber("baselineStartNs", event.target.value)} />
            </label>
            <label>
              Baseline End ns
              <input value={processing.baselineEndNs} onChange={(event) => updateProcessingNumber("baselineEndNs", event.target.value)} />
            </label>
            <label>
              Sample Start
              <input value={processing.sampleStartIndex} onChange={(event) => updateProcessingNumber("sampleStartIndex", event.target.value)} />
            </label>
            <label>
              End Trim
              <input value={processing.sampleEndTrim} onChange={(event) => updateProcessingNumber("sampleEndTrim", event.target.value)} />
            </label>
            <label>
              Tz Ohm
              <input value={processing.tzOhm} onChange={(event) => updateProcessingNumber("tzOhm", event.target.value)} />
            </label>
            <label>
              VFS
              <input value={processing.vfs} onChange={(event) => updateProcessingNumber("vfs", event.target.value)} />
            </label>
          </div>
        </div>

        <div className="pa-image-panel pa-image-trace-panel">
          <div className="pa-image-section-title">
            <h3>Frame Trace</h3>
            <div className="lock-method-control pa-image-mode-control" role="group" aria-label="Trace selection mode">
              <button type="button" className={`method-pill ${roiMode === "zoom" ? "active" : ""}`} onClick={() => setRoiMode("zoom")}>
                Zoom
              </button>
              <button type="button" className={`method-pill ${roiMode === "roi" ? "active" : ""}`} onClick={() => setRoiMode("roi")}>
                Set ROI
              </button>
            </div>
          </div>
          <PlotCanvas
            values={visibleTraceValues}
            points={visibleTracePoints}
            xDomain={visibleDomain}
            color="#2563eb"
            label="current"
            xLabel="sample index"
            title={roiMode === "zoom" ? "Left-drag to zoom X; right-click to restore." : "Left-drag to set PTP ROI; right-click to restore zoom."}
            ariaLabel="PA frame trace"
            height={300}
            selectionWindow={roiSampleWindow}
            yTickFormatter={(value) => `${Math.round(value)} uA`}
            onSelectionComplete={handleTraceSelection}
            onResetZoom={restoreTraceZoom}
            active={active}
          />
          <div className="pa-image-readouts">
            <span>Trace frame {trace?.frame_id ?? "-"}</span>
            <span>{frameSampleReadout}</span>
            <span>{traceValues.length} current samples</span>
            <span>
              ROI {processing.ptpStartNs}-{processing.ptpEndNs} ns
            </span>
            <span>
              View {visibleDomain.startIndex}-{visibleDomain.endIndex}
            </span>
          </div>
        </div>

        <div className="pa-image-panel pa-image-preview-panel">
          <div className="pa-image-section-title">
            <h3>PA Image</h3>
            <button type="button" className="command primary" onClick={buildImage} disabled={!active || busy || !path}>
              Build Image
            </button>
          </div>
          <PaImageHeatmap width={image?.width ?? summary?.detected_x_points ?? 16} height={image?.height ?? summary?.detected_y_points ?? 16} values={image?.values ?? []} counts={image?.counts ?? []} active={active} />
          <div className="pa-image-readouts">
            <span className={severityClass(image?.severity)}>{image ? issueSummary(summary, image) : "Image pending"}</span>
            <span>{image ? `${image.pixel_count} pixels · ${image.frame_count} frames` : "Build uses current ROI settings"}</span>
            <span>{message}</span>
          </div>
        </div>
      </div>
    </section>
  );
}
