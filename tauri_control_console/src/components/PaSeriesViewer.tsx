import { useMemo, useState } from "react";
import { DEFAULT_PD_ZERO_ADC_CODE } from "../utils/ada4355";
import {
  DEFAULT_PA_IMAGE_PROCESSING,
  defaultPaTraceDisplayDomain,
  formatUnknownError,
  indexRangeToNsWindow,
  loadPaImageProcessingDefaults,
  savePaImageRoiDefaults,
  type PaImageProcessing,
} from "../utils/paImage";
import {
  buildPaSeries,
  pickPaImageFile,
  readPaFrameTrace,
  scanPaImageFile,
  setPaLiveImageProcessing,
  type PaFileSummary,
  type PaFrameTrace,
  type PaSeriesBuildResult,
} from "../utils/paImageTauri";
import PlotCanvas, { type PlotPoint, type PlotXDomain } from "./PlotCanvas";

type Props = {
  active?: boolean;
  tzOhm: number;
  zeroAdcCode?: number;
  onBack: () => void;
};

type TraceSelectionMode = "zoom" | "ptp" | "baseline";

function compactNumber(value: number | null | undefined, digits = 4): string {
  if (value == null || !Number.isFinite(value)) return "-";
  const rounded = Math.round(value * 10 ** digits) / 10 ** digits;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded).replace(/0+$/, "").replace(/\.$/, "");
}

function parseNumber(text: string, fallback: number): number {
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeRange(startIndex: number, endIndex: number, maxIndex: number): PlotXDomain {
  const start = Math.max(0, Math.min(maxIndex, Math.round(Math.min(startIndex, endIndex))));
  const end = Math.max(0, Math.min(maxIndex, Math.round(Math.max(startIndex, endIndex))));
  return end > start ? { startIndex: start, endIndex: end } : { startIndex: start, endIndex: Math.min(maxIndex, start + 1) };
}

function nsToSampleIndex(ns: number, processing: PaImageProcessing, sampleMaxIndex: number): number {
  const index = processing.sampleStartIndex + ns / Math.max(1, processing.sampleIntervalNs);
  return Math.max(0, Math.min(sampleMaxIndex, Math.round(index)));
}

export default function PaSeriesViewer({
  active = true,
  tzOhm,
  zeroAdcCode = DEFAULT_PD_ZERO_ADC_CODE,
  onBack,
}: Props) {
  const [path, setPath] = useState("");
  const [summary, setSummary] = useState<PaFileSummary | undefined>(undefined);
  const [series, setSeries] = useState<PaSeriesBuildResult | undefined>(undefined);
  const [trace, setTrace] = useState<PaFrameTrace | undefined>(undefined);
  const [frameIndexText, setFrameIndexText] = useState("0");
  const [processing, setProcessing] = useState<PaImageProcessing>(() =>
    loadPaImageProcessingDefaults({ ...DEFAULT_PA_IMAGE_PROCESSING, tzOhm, zeroAdcCode }),
  );
  const [traceZoom, setTraceZoom] = useState<PlotXDomain | undefined>(undefined);
  const [seriesZoom, setSeriesZoom] = useState<PlotXDomain | undefined>(undefined);
  const [selectionMode, setSelectionMode] = useState<TraceSelectionMode>("zoom");
  const [message, setMessage] = useState("Open a point capture legacy binary to inspect a PA trace series.");
  const [busy, setBusy] = useState(false);

  const seriesValues = useMemo(() => series?.points.map((point) => point.ptp ?? 0) ?? [], [series]);
  const seriesPoints = useMemo<PlotPoint[]>(
    () => series?.points.map((point, index) => ({ xIndex: index, value: point.ptp ?? 0 })) ?? [],
    [series],
  );
  const seriesDomain = seriesZoom ?? { startIndex: 0, endIndex: Math.max(0, seriesValues.length - 1) };
  const traceValues = trace?.current_ua ?? [];
  const traceDomain = traceZoom ?? defaultPaTraceDisplayDomain(traceValues.length);
  const tracePoints = useMemo<PlotPoint[]>(() => {
    if (!trace || traceValues.length === 0) return [];
    const start = Math.max(0, Math.min(traceValues.length - 1, traceDomain.startIndex));
    const end = Math.max(start, Math.min(traceValues.length - 1, traceDomain.endIndex));
    return traceValues.slice(start, end + 1).map((value, offset) => ({ xIndex: start + offset, value }));
  }, [trace, traceDomain.endIndex, traceDomain.startIndex, traceValues]);
  const traceDomainWindows = traceValues.length
    ? [
        {
          startIndex: nsToSampleIndex(processing.ptpStartNs, processing, traceValues.length - 1),
          endIndex: nsToSampleIndex(processing.ptpEndNs, processing, traceValues.length - 1),
          color: "rgba(245, 158, 11, 0.14)",
          borderColor: "rgba(180, 83, 9, 0.65)",
        },
        {
          startIndex: nsToSampleIndex(processing.baselineStartNs, processing, traceValues.length - 1),
          endIndex: nsToSampleIndex(processing.baselineEndNs, processing, traceValues.length - 1),
          color: "rgba(14, 165, 233, 0.12)",
          borderColor: "rgba(2, 132, 199, 0.6)",
        },
      ]
    : [];

  const loadTrace = async (frameIndex: number, sourcePath = path) => {
    if (!sourcePath) return;
    const safeIndex = Math.max(0, Math.round(frameIndex));
    const nextTrace = await readPaFrameTrace(sourcePath, safeIndex, processing.tzOhm, processing.vfs, processing.zeroAdcCode);
    setTrace(nextTrace);
    setFrameIndexText(String(safeIndex));
    setTraceZoom(undefined);
  };

  const buildSeriesForPath = async (sourcePath = path) => {
    if (!sourcePath) return;
    setBusy(true);
    try {
      const [nextSummary, nextSeries] = await Promise.all([
        scanPaImageFile(sourcePath),
        buildPaSeries(sourcePath, processing),
      ]);
      setSummary(nextSummary);
      setSeries(nextSeries);
      setSeriesZoom(undefined);
      setMessage(`Series ready: ${nextSeries.frame_count} frames, ${nextSeries.bad_frame_count} bad frames.`);
      if (nextSeries.frame_count > 0) {
        await loadTrace(0, sourcePath);
      }
    } catch (error) {
      setMessage(`Build Series failed: ${formatUnknownError(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const openFile = async () => {
    const selected = await pickPaImageFile();
    if (!selected) return;
    setPath(selected);
    await buildSeriesForPath(selected);
  };

  const updateProcessingNumber = (key: keyof PaImageProcessing, text: string) => {
    const fallback = Number(processing[key]);
    setProcessing((current) => ({ ...current, [key]: parseNumber(text, fallback) }));
    setSeries(undefined);
  };

  const handleTraceSelection = (startIndex: number, endIndex: number) => {
    if (!traceValues.length) return;
    if (selectionMode === "zoom") {
      setTraceZoom(normalizeRange(startIndex, endIndex, traceValues.length - 1));
      return;
    }
    const range = normalizeRange(startIndex, endIndex, traceValues.length - 1);
    const window = indexRangeToNsWindow(range.startIndex, range.endIndex, processing.sampleStartIndex, processing.sampleIntervalNs);
    setProcessing((current) =>
      selectionMode === "ptp"
        ? { ...current, ptpStartNs: window.startNs, ptpEndNs: window.endNs }
        : { ...current, baselineStartNs: window.startNs, baselineEndNs: window.endNs },
    );
  };

  const saveRoiDefaults = async () => {
    savePaImageRoiDefaults(processing);
    await setPaLiveImageProcessing(processing);
    setMessage("ROI and baseline defaults saved.");
  };

  return (
    <section className="panel pa-image-viewer pa-series-viewer" aria-label="PA Series Viewer">
      <div className="pa-image-header">
        <h2>PA Series Viewer</h2>
        <button type="button" className="command compact" onClick={onBack}>
          Back
        </button>
      </div>

      <div className="pa-image-panel">
        <div className="pa-image-source-row">
          <button type="button" className="command compact" onClick={openFile} disabled={!active || busy}>
            Open Legacy Bin
          </button>
          <input value={path} onChange={(event) => setPath(event.target.value)} placeholder="legacy.bin path" />
          <button type="button" className="command primary compact" onClick={() => buildSeriesForPath()} disabled={!active || busy || !path}>
            Build Series
          </button>
        </div>
        <div className="fields pa-image-processing-grid">
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
        </div>
        <div className="pa-image-readouts">
          <span>{message}</span>
          <span>{summary ? `${summary.frame_count} frames · ${summary.block_count} blocks` : "No file loaded"}</span>
          <span className="pa-image-path">{path || "Path pending"}</span>
        </div>
      </div>

      <div className="pa-series-workbench">
        <div className="pa-series-left">
          <div className="pa-image-panel pa-image-trace-panel">
            <div className="pa-image-section-title">
              <h3>Frame Trace</h3>
              <div className="pa-image-trace-toolbar">
                <label className="pa-inline-control">
                  Frame
                  <input value={frameIndexText} onChange={(event) => setFrameIndexText(event.target.value)} />
                </label>
                <button type="button" className="command compact" onClick={() => void loadTrace(parseNumber(frameIndexText, 0))} disabled={!path || busy}>
                  Load Frame
                </button>
                <button type="button" className="command compact" onClick={saveRoiDefaults} disabled={!active || busy}>
                  Save ROI Defaults
                </button>
                <div className="lock-method-control pa-image-mode-control" role="group" aria-label="Trace selection mode">
                  <button type="button" className={`method-pill ${selectionMode === "zoom" ? "active" : ""}`} onClick={() => setSelectionMode("zoom")}>
                    Zoom
                  </button>
                  <button type="button" className={`method-pill ${selectionMode === "ptp" ? "active" : ""}`} onClick={() => setSelectionMode("ptp")}>
                    PTP ROI
                  </button>
                  <button type="button" className={`method-pill ${selectionMode === "baseline" ? "active" : ""}`} onClick={() => setSelectionMode("baseline")}>
                    Baseline
                  </button>
                </div>
              </div>
            </div>
            <PlotCanvas
              values={tracePoints.map((point) => point.value)}
              points={tracePoints}
              xDomain={traceDomain}
              color="#2563eb"
              label="current"
              xLabel="sample index"
              title="Left-drag to zoom or set ROI/Baseline; right-click to restore."
              ariaLabel="PA point capture frame trace"
              height={360}
              domainWindows={traceDomainWindows}
              yTickFormatter={(value) => `${compactNumber(value, 2)} uA`}
              onSelectionComplete={handleTraceSelection}
              onResetZoom={() => setTraceZoom(undefined)}
              active={active}
            />
            <div className="pa-image-readouts">
              <span>Trace frame {trace?.frame_id ?? "-"}</span>
              <span>samples {trace?.current_ua.length ?? 0}</span>
              <span>
                ROI {processing.ptpStartNs}-{processing.ptpEndNs} ns
              </span>
              <span>
                Baseline {processing.baselineStartNs}-{processing.baselineEndNs} ns
              </span>
            </div>
          </div>
        </div>

        <div className="pa-series-right">
          <div className="pa-image-panel">
            <div className="pa-image-section-title">
              <h3>PTP Timeline</h3>
            </div>
            <PlotCanvas
              values={seriesValues}
              points={seriesPoints}
              xDomain={seriesDomain}
              color="#7c3aed"
              label="PTP"
              xLabel="shot index"
              title="Click a point to inspect that frame; left-drag to zoom X; right-click to restore."
              ariaLabel="PA point capture PTP timeline"
              height={360}
              yTickFormatter={(value) => `${compactNumber(value, 2)} uA`}
              onPickIndex={(index) => void loadTrace(index)}
              onSelectionComplete={(start, end) => setSeriesZoom(normalizeRange(start, end, Math.max(0, seriesValues.length - 1)))}
              selectionMinPixels={14}
              onResetZoom={() => setSeriesZoom(undefined)}
              active={active}
            />
            <div className="pa-series-stats" aria-label="PA series statistics">
              <div>
                <span>PTP average</span>
                <strong>{compactNumber(series?.ptp_average)} uA</strong>
              </div>
              <div>
                <span>PTP variance</span>
                <strong>{compactNumber(series?.ptp_variance)} uA^2</strong>
              </div>
              <div>
                <span>PTP std</span>
                <strong>{compactNumber(series?.ptp_std)} uA</strong>
              </div>
              <div>
                <span>Frames</span>
                <strong>{series?.frame_count ?? summary?.frame_count ?? 0}</strong>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
