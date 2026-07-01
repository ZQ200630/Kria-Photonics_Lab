import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { DEFAULT_PD_ZERO_ADC_CODE } from "../utils/ada4355";
import {
  DEFAULT_PA_IMAGE_PROCESSING,
  defaultPaTraceDisplayDomain,
  findSimilarPaPixels,
  formatUnknownError,
  frameIndexForPaImagePixel,
  indexRangeToNsWindow,
  loadPaImageProcessingDefaults,
  savePaImageRoiDefaults,
  type PaImageProcessing,
  type PaSimilarPixelMask,
  type PaSeverity,
} from "../utils/paImage";
import {
  buildPaImageStreamed,
  cancelPaImageBuild,
  pickPaImageFile,
  readPaFrameTrace,
  scanPaImageFile,
  setPaLiveImageProcessing,
  type PaFileSummary,
  type PaFrameTrace,
  type PaImageBuildResult,
  type PaImageBuildProgressEvent,
} from "../utils/paImageTauri";
import PaImageHeatmap, {
  formatPaImageValue,
  PaImageColorbar,
  paImageColorbarPlacementStyle,
  formatPaImageDistanceUm,
  paImageCountsOrEmpty,
  paImageDisplayRange,
  paImageValuesOrEmpty,
} from "./PaImageHeatmap";
import type { PaImageAxisLabels, PaImageColormap, PaImageEnhancement, PaImagePixel, PaImageRotation, PaImageZoomDomain } from "./PaImageHeatmap";
import type { PaImageRenderedLayout } from "./PaImageHeatmap";
import PlotCanvas, { type PlotDomainWindow, type PlotPoint, type PlotXDomain } from "./PlotCanvas";

type Props = {
  active?: boolean;
  tzOhm: number;
  zeroAdcCode?: number;
  umPerCount?: number;
  scanAxisLabels?: PaImageAxisLabels;
  onBack: () => void;
};

export type TraceSelectionMode = "zoom" | "ptp" | "baseline";

const PA_IMAGE_BUILD_PROGRESS_FRAMES = 512;
const PA_IMAGE_BUILD_SNAPSHOT_FRAMES = 8192;
const PA_IMAGE_BUILD_TARGET_SNAPSHOTS = 24;

export { paImageColorbarPlacementStyle };

export function shouldClearPaImageForProcessingChange(_key: keyof PaImageProcessing): boolean {
  return true;
}

export function shouldClearPaTraceForProcessingChange(key: keyof PaImageProcessing): boolean {
  return key === "tzOhm" || key === "vfs" || key === "zeroAdcCode";
}

export function isPaImageRequestCurrent(startedGeneration: number, currentGeneration: number): boolean {
  return startedGeneration === currentGeneration;
}

export function processingPatchForTraceSelection(
  mode: TraceSelectionMode,
  range: PlotXDomain,
  processing: PaImageProcessing,
): Partial<PaImageProcessing> {
  if (mode === "zoom") return {};
  const window = indexRangeToNsWindow(range.startIndex, range.endIndex, processing.sampleStartIndex, processing.sampleIntervalNs);
  return mode === "ptp"
    ? { ptpStartNs: window.startNs, ptpEndNs: window.endNs }
    : { baselineStartNs: window.startNs, baselineEndNs: window.endNs };
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

function continuitySummary(summary?: PaFileSummary): string {
  if (!summary) return "Continuity -";
  const gaps =
    summary.block_id_gaps +
    summary.frame_id_gaps +
    summary.global_shot_gaps +
    summary.frame_count_mismatches;
  return `Continuity ${gaps} gap${gaps === 1 ? "" : "s"} · frames ${summary.first_frame_id ?? "-"}-${summary.last_frame_id ?? "-"}`;
}

type BuildProgress = {
  requestId: string;
  sourceFrameCount: number;
  totalFrames: number;
  percent: number;
  elapsedSeconds: number;
  remainingSeconds: number | null;
  frameRate: number;
};

export function paImageSnapshotIntervalFrames(totalFrames: number, fastBuild: boolean): number {
  if (fastBuild) return 0;
  const safeTotal = Math.max(0, Math.floor(totalFrames));
  if (safeTotal <= PA_IMAGE_BUILD_SNAPSHOT_FRAMES) return PA_IMAGE_BUILD_SNAPSHOT_FRAMES;
  const targetInterval = Math.ceil(safeTotal / PA_IMAGE_BUILD_TARGET_SNAPSHOTS);
  const roundedInterval = Math.ceil(targetInterval / PA_IMAGE_BUILD_PROGRESS_FRAMES) * PA_IMAGE_BUILD_PROGRESS_FRAMES;
  return Math.max(PA_IMAGE_BUILD_SNAPSHOT_FRAMES, roundedInterval);
}

export function paImageBuildProgressFromEvent(event: PaImageBuildProgressEvent, totalFrames: number): BuildProgress {
  const safeTotal = Math.max(1, Math.floor(event.totalSourceFrameCount ?? totalFrames));
  const rawProcessed = Math.max(event.sourceFrameCount, event.image?.frame_count ?? 0);
  const processed = Math.min(safeTotal, rawProcessed);
  const elapsedSeconds = Math.max(0, (event.elapsedMs ?? 0) / 1000);
  const frameRate = elapsedSeconds > 0 ? processed / elapsedSeconds : 0;
  const remainingSeconds = frameRate > 0 ? Math.max(0, (safeTotal - processed) / frameRate) : null;
  return {
    requestId: event.requestId,
    sourceFrameCount: processed,
    totalFrames: safeTotal,
    percent: Math.max(0, Math.min(100, (processed / safeTotal) * 100)),
    elapsedSeconds,
    remainingSeconds,
    frameRate,
  };
}

export function paBuildProgressWidthStyle(progress: Pick<BuildProgress, "percent">): { width: string } {
  const percent = Math.max(0, Math.min(100, Math.round(progress.percent)));
  return { width: `${percent}%` };
}

export function canSelectPaImagePixel(pixel: PaImagePixel, width: number, mask?: boolean[] | null): boolean {
  if (!mask) return true;
  const safeWidth = Math.max(1, Math.floor(width));
  const x = Math.floor(pixel.x);
  const y = Math.floor(pixel.y);
  if (x < 0 || y < 0 || x >= safeWidth) return false;
  return Boolean(mask[y * safeWidth + x]);
}

function formatBuildDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return "--";
  const safeSeconds = Math.max(0, Math.round(seconds));
  if (safeSeconds < 60) return `${safeSeconds}s`;
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = safeSeconds % 60;
  if (minutes < 60) return `${minutes}m ${remainder}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function formatFrameRate(frameRate: number): string {
  if (!Number.isFinite(frameRate) || frameRate <= 0) return "-- fps";
  if (frameRate >= 1000) return `${(frameRate / 1000).toFixed(1)} kfps`;
  return `${Math.round(frameRate)} fps`;
}

function finiteAxisValue(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function resolveAxisPair({
  metadataStart,
  metadataEnd,
  fallbackStart,
  fallbackEnd,
  points,
}: {
  metadataStart: number | null | undefined;
  metadataEnd: number | null | undefined;
  fallbackStart: number | null | undefined;
  fallbackEnd: number | null | undefined;
  points: number;
}): { start?: number | null; end?: number | null } {
  const metadataValid = finiteAxisValue(metadataStart) && finiteAxisValue(metadataEnd);
  if (metadataValid && (points <= 1 || metadataStart !== metadataEnd)) {
    return { start: metadataStart, end: metadataEnd };
  }
  if (finiteAxisValue(fallbackStart) && finiteAxisValue(fallbackEnd)) {
    return { start: fallbackStart, end: fallbackEnd };
  }
  return {
    start: finiteAxisValue(metadataStart) ? metadataStart : null,
    end: finiteAxisValue(metadataEnd) ? metadataEnd : null,
  };
}

function axisRangeReadout(labels: PaImageAxisLabels, umPerCount: number): string {
  const xStart = finiteAxisValue(labels.xStart) && finiteAxisValue(labels.xEnd) ? formatPaImageDistanceUm(0) : "--";
  const xEnd = finiteAxisValue(labels.xStart) && finiteAxisValue(labels.xEnd) ? formatPaImageDistanceUm(Math.abs(labels.xEnd - labels.xStart) * umPerCount) : "--";
  const yStart = finiteAxisValue(labels.yStart) && finiteAxisValue(labels.yEnd) ? formatPaImageDistanceUm(0) : "--";
  const yEnd = finiteAxisValue(labels.yStart) && finiteAxisValue(labels.yEnd) ? formatPaImageDistanceUm(Math.abs(labels.yEnd - labels.yStart) * umPerCount) : "--";
  return `X ${xStart} to ${xEnd} · Y ${yStart} to ${yEnd}`;
}

export function paImageSourceTotalFrames(summary?: PaFileSummary): number {
  return Math.max(1, Math.floor((summary?.frame_count ?? 0) + (summary?.bad_frame_count ?? 0)));
}

function sameRenderedLayout(a: PaImageRenderedLayout | null, b: PaImageRenderedLayout): boolean {
  return (
    Boolean(a) &&
    Math.round((a as PaImageRenderedLayout).cssWidth) === Math.round(b.cssWidth) &&
    Math.round((a as PaImageRenderedLayout).cssHeight) === Math.round(b.cssHeight) &&
    Math.round((a as PaImageRenderedLayout).x0) === Math.round(b.x0) &&
    Math.round((a as PaImageRenderedLayout).y0) === Math.round(b.y0) &&
    Math.round((a as PaImageRenderedLayout).gridWidth) === Math.round(b.gridWidth) &&
    Math.round((a as PaImageRenderedLayout).gridHeight) === Math.round(b.gridHeight)
  );
}

function formatPaValue(value: number): string {
  return formatPaImageValue(value);
}

export default function PaImageViewer({
  active = true,
  tzOhm,
  zeroAdcCode = DEFAULT_PD_ZERO_ADC_CODE,
  umPerCount = 1,
  scanAxisLabels,
  onBack,
}: Props) {
  const [path, setPath] = useState("");
  const [summary, setSummary] = useState<PaFileSummary | undefined>(undefined);
  const [frameIndexText, setFrameIndexText] = useState("0");
  const [trace, setTrace] = useState<PaFrameTrace | undefined>(undefined);
  const [image, setImage] = useState<PaImageBuildResult | undefined>(undefined);
  const [processing, setProcessing] = useState<PaImageProcessing>(() =>
    loadPaImageProcessingDefaults({ ...DEFAULT_PA_IMAGE_PROCESSING, tzOhm, zeroAdcCode }),
  );
  const [traceZoom, setTraceZoom] = useState<PlotXDomain | undefined>(undefined);
  const [selectionMode, setSelectionMode] = useState<TraceSelectionMode>("zoom");
  const [message, setMessage] = useState("Open a legacy PA binary to inspect frames and build an image.");
  const [busy, setBusy] = useState(false);
  const [buildProgress, setBuildProgress] = useState<BuildProgress | undefined>(undefined);
  const [fastBuild, setFastBuild] = useState(true);
  const [imageZoom, setImageZoom] = useState<PaImageZoomDomain | null>(null);
  const [selectedImagePixel, setSelectedImagePixel] = useState<PaImagePixel | null>(null);
  const [imageColormap, setImageColormap] = useState<PaImageColormap>("magma");
  const [imageEnhancement, setImageEnhancement] = useState<PaImageEnhancement>("percentile");
  const [imageRotation, setImageRotation] = useState<PaImageRotation>(0);
  const [similarToleranceText, setSimilarToleranceText] = useState("5");
  const [similarMask, setSimilarMask] = useState<PaSimilarPixelMask | null>(null);
  const [buildRequestId, setBuildRequestId] = useState<string | null>(null);
  const [imageRenderedLayout, setImageRenderedLayout] = useState<PaImageRenderedLayout | null>(null);
  const lastTzOhmRef = useRef(tzOhm);
  const lastCurrentOffsetRef = useRef(zeroAdcCode);
  const requestGenerationRef = useRef(0);
  const buildRequestCounterRef = useRef(0);

  const bumpRequestGeneration = () => {
    requestGenerationRef.current += 1;
  };

  const updateImageRenderedLayout = useCallback((layout: PaImageRenderedLayout) => {
    setImageRenderedLayout((current) => (sameRenderedLayout(current, layout) ? current : layout));
  }, []);

  useEffect(() => {
    if (lastTzOhmRef.current === tzOhm && lastCurrentOffsetRef.current === zeroAdcCode) return;
    lastTzOhmRef.current = tzOhm;
    lastCurrentOffsetRef.current = zeroAdcCode;
    bumpRequestGeneration();
    setProcessing((current) => ({ ...current, tzOhm, zeroAdcCode }));
    setImage(undefined);
    setSimilarMask(null);
    setTrace(undefined);
    setTraceZoom(undefined);
    setMessage("ADA4355 gain/zero ADC code changed; reload frame and rebuild image.");
  }, [zeroAdcCode, tzOhm]);

  const traceValues = trace?.current_ua ?? [];
  const visibleDomain = traceZoom ?? defaultPaTraceDisplayDomain(traceValues.length);
  const visibleTracePoints = useMemo<PlotPoint[]>(() => {
    if (!trace || traceValues.length === 0) return [];
    const startIndex = Math.max(0, Math.min(traceValues.length - 1, visibleDomain.startIndex));
    const endIndex = Math.max(startIndex, Math.min(traceValues.length - 1, visibleDomain.endIndex));
    return traceValues.slice(startIndex, endIndex + 1).map((value, offset) => ({ xIndex: startIndex + offset, value }));
  }, [trace, traceValues, visibleDomain.endIndex, visibleDomain.startIndex]);
  const visibleTraceValues = useMemo(() => visibleTracePoints.map((point) => point.value), [visibleTracePoints]);
  const traceSampleReadout = trace
    ? `${visibleTracePoints.length} shown / ${traceValues.length} raw samples`
    : "0 current samples";
  const ptpSampleWindow: PlotDomainWindow | undefined = traceValues.length
    ? {
        startIndex: nsToSampleIndex(processing.ptpStartNs, processing, traceValues.length - 1),
        endIndex: nsToSampleIndex(processing.ptpEndNs, processing, traceValues.length - 1),
        color: "rgba(245, 158, 11, 0.14)",
        borderColor: "rgba(180, 83, 9, 0.65)",
      }
    : undefined;
  const baselineSampleWindow: PlotDomainWindow | undefined = traceValues.length
    ? {
        startIndex: nsToSampleIndex(processing.baselineStartNs, processing, traceValues.length - 1),
        endIndex: nsToSampleIndex(processing.baselineEndNs, processing, traceValues.length - 1),
        color: "rgba(14, 165, 233, 0.12)",
        borderColor: "rgba(2, 132, 199, 0.6)",
      }
    : undefined;
  const traceDomainWindows = useMemo<PlotDomainWindow[]>(
    () => [baselineSampleWindow, ptpSampleWindow].filter((window): window is PlotDomainWindow => Boolean(window)),
    [baselineSampleWindow, ptpSampleWindow],
  );

  const runBusy = useCallback(async (label: string, action: () => Promise<void>, onError?: () => void) => {
    setBusy(true);
    setMessage(`${label}...`);
    try {
      await action();
    } catch (error) {
      onError?.();
      setMessage(`${label} failed: ${formatUnknownError(error)}`);
    } finally {
      setBusy(false);
    }
  }, []);

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
      setImageZoom(null);
      setSelectedImagePixel(null);
      setSimilarMask(null);
      setTrace(undefined);
      setTraceZoom(undefined);
      setBuildProgress(undefined);
      setFrameIndexText("0");
      bumpRequestGeneration();
      setMessage(`Loaded ${nextSummary.frame_count} frame${nextSummary.frame_count === 1 ? "" : "s"} from ${nextSummary.block_count} blocks.`);
    });

  const loadFrameAtIndex = useCallback(async (frameIndex: number, pixel?: PaImagePixel) => {
    if (!path) {
      setMessage("Choose a legacy PA binary before loading a frame.");
      return;
    }
    const safeFrameIndex = Math.max(0, Math.round(frameIndex));
    const startedGeneration = requestGenerationRef.current;
    const nextTrace = await readPaFrameTrace(path, safeFrameIndex, processing.tzOhm, processing.vfs, processing.zeroAdcCode);
    if (!isPaImageRequestCurrent(startedGeneration, requestGenerationRef.current)) {
      setMessage("Frame load finished after settings changed; reload frame.");
      return;
    }
    setTrace(nextTrace);
    setTraceZoom(undefined);
    setFrameIndexText(String(safeFrameIndex));
    setMessage(
      pixel
        ? `Loaded pixel x ${pixel.x}, y ${pixel.y} frame ${nextTrace.frame_id} with ${nextTrace.current_ua.length} samples.`
        : `Loaded frame ${nextTrace.frame_id} with ${nextTrace.current_ua.length} samples.`,
    );
  }, [path, processing.tzOhm, processing.vfs, processing.zeroAdcCode]);

  const loadFrame = () =>
    runBusy("Load Frame", async () => {
      if (!path) {
        setMessage("Choose a legacy PA binary before loading a frame.");
        return;
      }
      const frameIndex = Math.max(0, Math.round(parseNumber(frameIndexText, 0)));
      await loadFrameAtIndex(frameIndex);
    });

  const buildImage = () =>
    runBusy("Build Image", async () => {
      if (!path) {
        setMessage("Choose a legacy PA binary before building an image.");
        return;
      }
      const startedGeneration = requestGenerationRef.current;
      const processingSnapshot = { ...processing };
      const totalFrames = paImageSourceTotalFrames(summary);
      const requestId = `pa-image-${Date.now()}-${buildRequestCounterRef.current += 1}`;
      const snapshotInterval = paImageSnapshotIntervalFrames(totalFrames, fastBuild);
      setImage(undefined);
      setImageZoom(null);
      setSelectedImagePixel(null);
      setSimilarMask(null);
      setBuildRequestId(requestId);
      setBuildProgress({
        requestId,
        sourceFrameCount: 0,
        totalFrames,
        percent: 0,
        elapsedSeconds: 0,
        remainingSeconds: null,
        frameRate: 0,
      });
      const unlisten = await listen<PaImageBuildProgressEvent>("pa-image-build-progress", (event) => {
        if (event.payload.requestId !== requestId) return;
        if (!isPaImageRequestCurrent(startedGeneration, requestGenerationRef.current)) return;
        if (event.payload.image) setImage(event.payload.image);
        const nextProgress = paImageBuildProgressFromEvent(event.payload, totalFrames);
        setBuildProgress(nextProgress);
        setMessage(`Building image ${Math.round(nextProgress.percent)}%...`);
      });
      let nextImage: PaImageBuildResult;
      try {
        nextImage = await buildPaImageStreamed(path, processingSnapshot, requestId, PA_IMAGE_BUILD_PROGRESS_FRAMES, snapshotInterval);
      } catch (error) {
        if (formatUnknownError(error).toLowerCase().includes("cancelled")) {
          setMessage("Image build cancelled.");
          return;
        }
        throw error;
      } finally {
        unlisten();
        setBuildRequestId((current) => (current === requestId ? null : current));
      }
      if (!isPaImageRequestCurrent(startedGeneration, requestGenerationRef.current)) {
        setMessage("Image build finished after settings changed; rebuild image.");
        return;
      }
      setImage(nextImage);
      setImageZoom(null);
      setSelectedImagePixel(null);
      setSimilarMask(null);
      setBuildProgress((current) => ({
        requestId,
        sourceFrameCount: totalFrames,
        totalFrames,
        percent: 100,
        elapsedSeconds: current?.elapsedSeconds ?? 0,
        remainingSeconds: 0,
        frameRate: current?.frameRate ?? 0,
      }));
      setMessage(`Built ${nextImage.width} x ${nextImage.height} PA image from ${nextImage.frame_count} frames.`);
    }, () => setBuildProgress(undefined));

  const cancelBuild = async () => {
    if (!buildRequestId) return;
    try {
      await cancelPaImageBuild(buildRequestId);
      setMessage("Canceling image build...");
    } catch (error) {
      setMessage(`Cancel image build failed: ${formatUnknownError(error)}`);
    }
  };

  const saveRoiDefaults = () =>
    runBusy("Save ROI Defaults", async () => {
      savePaImageRoiDefaults(processing);
      await setPaLiveImageProcessing(processing);
      setMessage(
        `Saved ROI ${processing.ptpStartNs}-${processing.ptpEndNs} ns and baseline ${processing.baselineStartNs}-${processing.baselineEndNs} ns for live preview.`,
      );
    });

  const updateProcessingNumber = (key: keyof PaImageProcessing, text: string) => {
    const nextValue = parseNumber(text, processing[key]);
    if (Object.is(nextValue, processing[key])) return;
    bumpRequestGeneration();
    setProcessing((current) => ({ ...current, [key]: parseNumber(text, current[key]) }));
    if (shouldClearPaImageForProcessingChange(key)) {
      setImage(undefined);
      setImageZoom(null);
      setSelectedImagePixel(null);
      setSimilarMask(null);
    }
    if (shouldClearPaImageForProcessingChange(key)) setBuildProgress(undefined);
    if (shouldClearPaTraceForProcessingChange(key)) {
      setTrace(undefined);
      setTraceZoom(undefined);
    }
    setMessage(shouldClearPaTraceForProcessingChange(key) ? "Conversion changed; reload frame and rebuild image." : "Processing changed; rebuild image.");
  };

  const handleTraceSelection = (startIndex: number, endIndex: number) => {
    if (traceValues.length === 0) return;
    const range = normalizeIndexRange(startIndex, endIndex, traceValues.length - 1);
    if (selectionMode === "zoom") {
      setTraceZoom(range);
      return;
    }
    const patch = processingPatchForTraceSelection(selectionMode, range, processing);
    bumpRequestGeneration();
    setProcessing((current) => ({ ...current, ...patch }));
    setImage(undefined);
    setSimilarMask(null);
    setBuildProgress(undefined);
    setMessage(`${selectionMode === "ptp" ? "PTP ROI" : "Baseline"} updated; rebuild image.`);
  };

  const restoreTraceZoom = () => setTraceZoom(undefined);
  const imageWidth = image?.width ?? summary?.detected_x_points ?? 16;
  const imageHeight = image?.height ?? summary?.detected_y_points ?? 16;
  const xAxisPair = resolveAxisPair({
    metadataStart: image?.x_start,
    metadataEnd: image?.x_end,
    fallbackStart: scanAxisLabels?.xStart,
    fallbackEnd: scanAxisLabels?.xEnd,
    points: imageWidth,
  });
  const yAxisPair = resolveAxisPair({
    metadataStart: image?.y_start,
    metadataEnd: image?.y_end,
    fallbackStart: scanAxisLabels?.yStart,
    fallbackEnd: scanAxisLabels?.yEnd,
    points: imageHeight,
  });
  const effectiveAxisLabels: PaImageAxisLabels = {
    xStart: xAxisPair.start,
    xEnd: xAxisPair.end,
    yStart: yAxisPair.start,
    yEnd: yAxisPair.end,
  };
  const imageValues = paImageValuesOrEmpty(image?.values);
  const imageCounts = paImageCountsOrEmpty(image?.counts);
  const imageAxisReadout = axisRangeReadout(effectiveAxisLabels, umPerCount);
  const imageDisplayRange = useMemo(
    () => paImageDisplayRange(imageValues, imageCounts, imageZoom, imageWidth, imageHeight, imageEnhancement),
    [imageCounts, imageEnhancement, imageHeight, imageValues, imageWidth, imageZoom],
  );
  const selectImagePixel = useCallback((pixel: PaImagePixel) => {
    if (!image) {
      setSelectedImagePixel(pixel);
      setMessage("Build an image before selecting a pixel.");
      return;
    }
    if (!canSelectPaImagePixel(pixel, imageWidth, similarMask?.mask ?? null)) {
      setMessage(`Pixel x ${pixel.x}, y ${pixel.y} is outside the current similarity mask.`);
      return;
    }
    setSelectedImagePixel(pixel);
    const frameIndex = frameIndexForPaImagePixel(image, pixel);
    if (frameIndex === null) {
      setMessage(`Pixel x ${pixel.x}, y ${pixel.y} has no valid frame.`);
      return;
    }
    runBusy(`Load Pixel ${pixel.x},${pixel.y}`, () => loadFrameAtIndex(frameIndex, pixel));
  }, [image, imageWidth, loadFrameAtIndex, runBusy, similarMask]);
  const findSimilarPixels = () => {
    if (!image || !selectedImagePixel) {
      setMessage("Select a PA image pixel before finding similar PTP pixels.");
      return;
    }
    const result = findSimilarPaPixels(image, selectedImagePixel, parseNumber(similarToleranceText, 5));
    if (!result) {
      setSimilarMask(null);
      setMessage("Selected pixel has no valid PTP value for similarity matching.");
      return;
    }
    setSimilarMask(result);
    setMessage(
      `Mask matched ${result.matchedCount}/${result.finiteCount} pixels within ${formatPaValue(result.toleranceValue)} of ${formatPaValue(result.selectedValue)}.`,
    );
  };
  const clearSimilarMask = () => {
    setSimilarMask(null);
    setMessage("Similarity mask cleared.");
  };
  const resetImageZoom = useCallback(() => setImageZoom(null), []);
  const selectedPixelReadout = selectedImagePixel
    ? `Selected x ${selectedImagePixel.x}, y ${selectedImagePixel.y}`
    : "No pixel selected";
  const maskReadout = similarMask
    ? `Mask ${similarMask.matchedCount}/${similarMask.finiteCount} pixels · +/- ${formatPaValue(similarMask.toleranceValue)}`
    : "Mask off";
  const frameSampleReadout =
    trace && trace.time_ns.length > 0
      ? `${trace.time_ns[0]}-${trace.time_ns[trace.time_ns.length - 1]} ns`
      : `${processing.sampleStartIndex} start, ${processing.sampleIntervalNs} ns/sample`;

  return (
    <section className="panel pa-image-viewer" aria-label="PA Image Viewer">
      <div className="pa-image-header">
        <h2>PA Image Viewer</h2>
        <div className="pa-image-header-actions">
          <button type="button" className="command compact" onClick={onBack}>
            Back
          </button>
        </div>
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
            <span>{continuitySummary(summary)}</span>
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
              VFS
              <input value={processing.vfs} onChange={(event) => updateProcessingNumber("vfs", event.target.value)} />
            </label>
            <div className="muted">
              ADA4355 gain {processing.tzOhm.toLocaleString()} ohm; zero ADC {processing.zeroAdcCode}
            </div>
          </div>
        </div>

        <div className="pa-image-panel pa-image-trace-panel">
          <div className="pa-image-section-title">
            <h3>Frame Trace</h3>
            <div className="pa-image-trace-toolbar">
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
            values={visibleTraceValues}
            points={visibleTracePoints}
            xDomain={visibleDomain}
            color="#2563eb"
            label="current"
            xLabel="sample index"
            title={
              selectionMode === "zoom"
                ? "Left-drag to zoom X; right-click to restore."
                : selectionMode === "ptp"
                  ? "Left-drag to set PTP ROI; right-click to restore zoom."
                  : "Left-drag to set baseline; right-click to restore zoom."
            }
            ariaLabel="PA frame trace"
            domainWindows={traceDomainWindows}
            yTickFormatter={(value) => `${Math.round(value)} uA`}
            onSelectionComplete={handleTraceSelection}
            onResetZoom={restoreTraceZoom}
            active={active}
            height={390}
          />
          <div className="pa-image-readouts">
            <span>Trace frame {trace?.frame_id ?? "-"}</span>
            <span>{frameSampleReadout}</span>
            <span>{traceSampleReadout}</span>
            <span>
              ROI {processing.ptpStartNs}-{processing.ptpEndNs} ns
            </span>
            <span>
              Baseline {processing.baselineStartNs}-{processing.baselineEndNs} ns
            </span>
            <span>
              View {visibleDomain.startIndex}-{visibleDomain.endIndex}
            </span>
          </div>
        </div>

        <div className="pa-image-panel pa-image-preview-panel">
          <div className="pa-image-section-title">
            <h3>PA Image</h3>
            <div className="pa-image-actions compact-actions">
              <label className="pa-fast-build-toggle">
                <input type="checkbox" checked={fastBuild} onChange={(event) => setFastBuild(event.target.checked)} disabled={busy} />
                Fast Build
              </label>
              <button type="button" className="command compact" onClick={cancelBuild} disabled={!buildRequestId}>
                Cancel
              </button>
              <button type="button" className="command primary" onClick={buildImage} disabled={!active || busy || !path}>
                Build Image
              </button>
            </div>
          </div>
          <div className="pa-image-visual-toolbar">
            <div className="pa-image-display-controls">
              <label>
                Colormap
                <select value={imageColormap} onChange={(event) => setImageColormap(event.target.value as PaImageColormap)}>
                  <option value="emerald">Emerald</option>
                  <option value="viridis">Viridis</option>
                  <option value="magma">Magma</option>
                  <option value="turbo">Turbo</option>
                  <option value="gray">Gray</option>
                </select>
              </label>
              <label>
                Enhance
                <select value={imageEnhancement} onChange={(event) => setImageEnhancement(event.target.value as PaImageEnhancement)}>
                  <option value="percentile">Percentile</option>
                  <option value="minmax">Min / Max</option>
                  <option value="sqrt">Sqrt</option>
                  <option value="log">Log</option>
                </select>
              </label>
              <label>
                Rotate
                <select value={imageRotation} onChange={(event) => setImageRotation(Number(event.target.value) as PaImageRotation)}>
                  <option value={0}>0</option>
                  <option value={90}>90</option>
                  <option value={180}>180</option>
                  <option value={270}>270</option>
                </select>
              </label>
            </div>
            <div className="pa-image-similar-controls">
              <label>
                Similar %
                <input value={similarToleranceText} onChange={(event) => setSimilarToleranceText(event.target.value)} inputMode="decimal" />
              </label>
              <button type="button" className="command compact" onClick={findSimilarPixels} disabled={!image || !selectedImagePixel}>
                Find Similar
              </button>
              <button type="button" className="command compact" onClick={clearSimilarMask} disabled={!similarMask}>
                Clear Mask
              </button>
            </div>
          </div>
          <div className="pa-image-heatmap-with-colorbar">
            <PaImageHeatmap
              width={imageWidth}
              height={imageHeight}
              values={imageValues}
              counts={imageCounts}
              axisLabels={effectiveAxisLabels}
              umPerCount={umPerCount}
              selectedPixel={selectedImagePixel}
              zoom={imageZoom}
              colormap={imageColormap}
              enhancement={imageEnhancement}
              rotation={imageRotation}
              mask={similarMask?.mask ?? null}
              onPixelSelect={selectImagePixel}
              onZoom={setImageZoom}
              onResetZoom={resetImageZoom}
              onLayout={updateImageRenderedLayout}
              active={active}
            />
            <PaImageColorbar
              colormap={imageColormap}
              low={imageDisplayRange.low}
              high={imageDisplayRange.high}
              style={paImageColorbarPlacementStyle(imageRenderedLayout)}
            />
          </div>
          {buildProgress && (
            <div className="pa-build-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(buildProgress.percent)}>
              <div className="pa-build-progress-track">
                <div className="pa-build-progress-fill" style={paBuildProgressWidthStyle(buildProgress)} />
              </div>
              <span>
                {Math.round(buildProgress.percent)}% · {buildProgress.sourceFrameCount} / {buildProgress.totalFrames} frames · {formatFrameRate(buildProgress.frameRate)} · {formatBuildDuration(buildProgress.remainingSeconds)} left
              </span>
            </div>
          )}
          <div className="pa-image-readouts">
            <span className={severityClass(image?.severity)}>{image ? issueSummary(summary, image) : "Image pending"}</span>
            <span>{image ? `${image.width} x ${image.height} scan points · ${image.frame_count} frames` : "Build uses current ROI settings"}</span>
            <span>{imageAxisReadout}</span>
            <span>{selectedPixelReadout}</span>
            <span>{maskReadout}</span>
            <span>{imageZoom ? `Zoom x ${imageZoom.xStart}-${imageZoom.xEnd}, y ${imageZoom.yStart}-${imageZoom.yEnd}` : "Image zoom full"}</span>
            <span>{message}</span>
          </div>
        </div>
      </div>
    </section>
  );
}
