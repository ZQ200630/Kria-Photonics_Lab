import { describe, expect, it } from "vitest";
import {
  axisCenterFromStartStep,
  axisEndFromStartStep,
  axisRangeFromStartStep,
  axisStartStepFromCenterRange,
  axisStartStepFromEndpoints,
  captureProgressSnapshot,
  captureTimeSecondsForServerStart,
  countsFromDurationDisplay,
  countsFromRateDisplay,
  DEFAULT_SCAN_SCALE_COUNTS,
  DEFAULT_SCAN_SCALE_UM,
  durationDisplayFromCounts,
  estimatedCaptureCountsFromParams,
  estimatedCaptureSecondsFromParams,
  expectedFramesFromParams,
  loadPaScanDefaults,
  paLivePreviewIntervalMs,
  paLivePreviewMinFrameDelta,
  paImagePixelToScanPoint,
  paFineScanParamsFromImageRoi,
  paCanvasRoiFromScanParams,
  paPreviewSourceAfterScanComplete,
  paScanDefaultsFromParams,
  paImageZoomToScanRange,
  paZoomCommitStateFromRoi,
  PAM_ADC_CAPTURE_COUNTS,
  PAM_ADC_CAPTURE_SAMPLES,
  PAM_ADC_POST_BUFFER_COUNTS,
  PAM_ADC_SAMPLE_NS,
  PAM_GALVO_SETTLE_MIN_COUNTS,
  scanResolutionUmFromStep,
  scanUmPerCountFromCalibration,
  rateDisplayFromGapCounts,
  scanModeInfo,
  scanParamsWithDefaults,
  savePaScanDefaults,
  shouldRefreshPaLivePreview,
  shouldShowCaptureProgress,
  constrainedTimingCounts,
  requiredGapCounts,
  runPaLivePreviewUpdate,
  timingDetailEndCounts,
} from "../utils/paImaging";

describe("PA imaging helpers", () => {
  it("computes expected frames from scan dimensions", () => {
    expect(expectedFramesFromParams({ x_points: 4, y_points: 5, frame_number: 3 })).toBe(60);
  });

  it("estimates capture time from frame period and scan dimensions", () => {
    const params = { gap_time: 1_000, x_points: 4, y_points: 5, frame_number: 3 };

    expect(estimatedCaptureCountsFromParams(params)).toBe(60_000);
    expect(estimatedCaptureSecondsFromParams(params)).toBe(0.0006);
  });

  it("does not use estimated capture time as the server stop condition", () => {
    const params = { gap_time: 33_333, x_points: 800, y_points: 800, frame_number: 1 };

    expect(estimatedCaptureSecondsFromParams(params)).toBeGreaterThan(0);
    expect(captureTimeSecondsForServerStart(params)).toBe(0);
  });

  it("falls back to one for missing or invalid scan dimensions", () => {
    expect(expectedFramesFromParams({ x_points: 0, y_points: undefined, frame_number: Number.NaN })).toBe(1);
  });

  it("estimates capture progress and remaining time from received frames", () => {
    const progress = captureProgressSnapshot({
      processedFrames: 50,
      expectedFrames: 200,
      elapsedMs: 10_000,
      plannedSeconds: 60,
    });

    expect(progress.percent).toBe(25);
    expect(progress.remainingSeconds).toBe(30);
    expect(progress.frameRate).toBe(5);
    expect(progress.complete).toBe(false);
  });

  it("falls back to planned capture time before the first block arrives", () => {
    const progress = captureProgressSnapshot({
      processedFrames: 0,
      expectedFrames: 200,
      elapsedMs: 10_000,
      plannedSeconds: 60,
    });

    expect(progress.percent).toBe(0);
    expect(progress.remainingSeconds).toBe(50);
    expect(progress.frameRate).toBe(0);
    expect(progress.complete).toBe(false);
  });

  it("marks capture progress complete when processed frames reach expected frames", () => {
    const progress = captureProgressSnapshot({
      processedFrames: 20_000,
      expectedFrames: 20_000,
      elapsedMs: 120_000,
      plannedSeconds: 120,
    });

    expect(progress.percent).toBe(100);
    expect(progress.remainingSeconds).toBe(0);
    expect(progress.complete).toBe(true);
  });

  it("hides capture progress after the user dismisses an aborted capture", () => {
    expect(shouldShowCaptureProgress({
      dismissed: false,
      serverRunning: false,
      processedFrames: 12000,
      receiverFrames: 12000,
    })).toBe(true);
    expect(shouldShowCaptureProgress({
      dismissed: true,
      serverRunning: false,
      processedFrames: 12000,
      receiverFrames: 12000,
    })).toBe(false);
    expect(shouldShowCaptureProgress({
      dismissed: true,
      serverRunning: true,
      processedFrames: 0,
      receiverFrames: 0,
    })).toBe(false);
  });

  it("throttles live PA image preview snapshots by image size", () => {
    expect(paLivePreviewIntervalMs(100)).toBe(600);
    expect(paLivePreviewIntervalMs(160_000)).toBe(1500);
    expect(paLivePreviewIntervalMs(1_000_000)).toBe(3000);
    expect(paLivePreviewMinFrameDelta(100)).toBe(32);
    expect(paLivePreviewMinFrameDelta(1_000_000)).toBe(4096);
  });

  it("refreshes live PA image preview only while running and after useful frame progress", () => {
    expect(shouldRefreshPaLivePreview({
      running: false,
      processedFrames: 10_000,
      lastSnapshotFrameCount: 0,
      pixelCount: 1_000_000,
    })).toBe(false);
    expect(shouldRefreshPaLivePreview({
      running: true,
      processedFrames: 0,
      lastSnapshotFrameCount: 0,
      pixelCount: 1_000_000,
    })).toBe(false);
    expect(shouldRefreshPaLivePreview({
      running: true,
      processedFrames: 1,
      lastSnapshotFrameCount: 0,
      pixelCount: 1_000_000,
    })).toBe(true);
    expect(shouldRefreshPaLivePreview({
      running: true,
      processedFrames: 12_000,
      lastSnapshotFrameCount: 10_000,
      pixelCount: 1_000_000,
    })).toBe(false);
    expect(shouldRefreshPaLivePreview({
      running: true,
      processedFrames: 14_096,
      lastSnapshotFrameCount: 10_000,
      pixelCount: 1_000_000,
    })).toBe(true);
    expect(shouldRefreshPaLivePreview({
      running: true,
      processedFrames: 20_000,
      lastSnapshotFrameCount: 10_000,
      pixelCount: 100,
      requestInFlight: true,
    })).toBe(false);
  });

  it("schedules live PA image preview updates as background UI work", () => {
    const calls: string[] = [];

    runPaLivePreviewUpdate(
      () => calls.push("updated"),
      (update) => {
        calls.push("scheduled");
        update();
      },
    );

    expect(calls).toEqual(["scheduled", "updated"]);
  });

  it("maps PA canvas pixel selection to scan coordinates", () => {
    expect(paImagePixelToScanPoint({
      pixel: { x: 200, y: 100 },
      width: 400,
      height: 400,
      axisLabels: { xStart: -1995, xEnd: 1995, yStart: -1995, yEnd: 1995 },
    })).toEqual({ x: 5, y: -995 });
  });

  it("maps PA canvas zoom into a smaller scan range", () => {
    expect(paImageZoomToScanRange({
      zoom: { xStart: 100, xEnd: 299, yStart: 50, yEnd: 149 },
      width: 400,
      height: 400,
      axisLabels: { xStart: -1995, xEnd: 1995, yStart: -1995, yEnd: 1995 },
    })).toEqual({
      xStart: -995,
      xEnd: 995,
      yStart: -1495,
      yEnd: -505,
      xCenter: 0,
      yCenter: -1000,
      xRange: 1990,
      yRange: 990,
    });
  });

  it("clears the ROI after committing it as the zoom domain", () => {
    expect(paZoomCommitStateFromRoi({ xStart: 10, xEnd: 20, yStart: 30, yEnd: 40 })).toEqual({
      zoom: { xStart: 10, xEnd: 20, yStart: 30, yEnd: 40 },
      roi: null,
      roiSource: null,
      roiPurpose: null,
    });
    expect(paZoomCommitStateFromRoi(null)).toBeNull();
  });

  it("turns a canvas ROI into fine scan params using the requested step", () => {
    expect(paFineScanParamsFromImageRoi({
      roi: { xStart: 100, xEnd: 299, yStart: 50, yEnd: 149 },
      width: 400,
      height: 400,
      axisLabels: { xStart: -1995, xEnd: 1995, yStart: -1995, yEnd: 1995 },
      stepCounts: 5,
      baseParams: { frame_number: 3, scan_mode: 1, return_mode: 0 },
    })).toEqual({
      x_start: -995,
      x_step: 5,
      x_points: 399,
      y_start: -1495,
      y_step: 5,
      y_points: 199,
      frame_number: 3,
      scan_mode: 1,
      return_mode: 0,
    });
  });

  it("maps scan params back to a canvas ROI when the scan is inside the canvas", () => {
    expect(paCanvasRoiFromScanParams({
      params: {
        x_start: -995,
        x_step: 5,
        x_points: 399,
        y_start: -1495,
        y_step: 5,
        y_points: 199,
      },
      width: 400,
      height: 400,
      axisLabels: { xStart: -1995, xEnd: 1995, yStart: -1995, yEnd: 1995 },
    })).toEqual({
      status: "inside",
      roi: { xStart: 100, xEnd: 299, yStart: 50, yEnd: 149 },
    });
  });

  it("does not draw a canvas ROI when the scan range is outside the canvas", () => {
    expect(paCanvasRoiFromScanParams({
      params: {
        x_start: -2500,
        x_step: 5,
        x_points: 399,
        y_start: -1495,
        y_step: 5,
        y_points: 199,
      },
      width: 400,
      height: 400,
      axisLabels: { xStart: -1995, xEnd: 1995, yStart: -1995, yEnd: 1995 },
    })).toEqual({ status: "outside", roi: null });
  });

  it("shows current image after a fine-scan capture completes", () => {
    expect(paPreviewSourceAfterScanComplete({
      currentSource: "canvas",
      roiPurpose: "fineScan",
      complete: true,
    })).toBe("current");
    expect(paPreviewSourceAfterScanComplete({
      currentSource: "canvas",
      roiPurpose: "manual",
      complete: true,
    })).toBe("canvas");
  });

  it("captures and restores scan defaults without changing timing fields", () => {
    const current = {
      x_start: -2000,
      x_step: 10,
      x_points: 401,
      y_start: -1000,
      y_step: 5,
      y_points: 201,
      frame_number: 2,
      scan_mode: 1,
      return_mode: 0,
      gap_time: 33333,
      ld_time: 400,
    };
    const defaults = paScanDefaultsFromParams(current);

    expect(scanParamsWithDefaults({
      x_start: 0,
      x_step: 1,
      x_points: 10,
      y_start: 0,
      y_step: 1,
      y_points: 10,
      frame_number: 1,
      scan_mode: 0,
      return_mode: 1,
      gap_time: 999,
      ld_time: 111,
    }, defaults)).toEqual({
      x_start: -2000,
      x_step: 10,
      x_points: 401,
      y_start: -1000,
      y_step: 5,
      y_points: 201,
      frame_number: 2,
      scan_mode: 1,
      return_mode: 0,
      gap_time: 999,
      ld_time: 111,
    });
  });

  it("persists PA scan defaults in browser storage", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
    };
    const defaults = paScanDefaultsFromParams({
      x_start: -2000,
      x_step: 10,
      x_points: 401,
      y_start: -1000,
      y_step: 5,
      y_points: 201,
      frame_number: 2,
      scan_mode: 1,
      return_mode: 0,
    });

    savePaScanDefaults(defaults, storage);

    expect(loadPaScanDefaults(paScanDefaultsFromParams({}), storage)).toEqual(defaults);
  });

  it("derives scan axis endpoints, center, range, and physical resolution", () => {
    expect(DEFAULT_SCAN_SCALE_COUNTS).toBe(4000);
    expect(DEFAULT_SCAN_SCALE_UM).toBe(530);

    const umPerCount = scanUmPerCountFromCalibration(4000, 530);

    expect(umPerCount).toBe(0.1325);
    expect(axisEndFromStartStep(-500, 1, 100)).toBe(-401);
    expect(axisCenterFromStartStep(-500, 1, 100)).toBe(-450.5);
    expect(axisRangeFromStartStep(-500, 1, 100)).toBe(99);
    expect(scanResolutionUmFromStep(40, umPerCount)).toBeCloseTo(5.3);
  });

  it("commits alternate scan axis input modes into start and integer step", () => {
    expect(axisStartStepFromEndpoints(-500, -401, 100)).toEqual({ start: -500, step: 1 });
    expect(axisStartStepFromCenterRange(0, 100, 101)).toEqual({ start: -50, step: 1 });
    expect(axisStartStepFromCenterRange(0, 4000, 400)).toEqual({ start: -1995, step: 10 });
  });

  it("normalizes duration displays into a readable 1-1000 range", () => {
    expect(durationDisplayFromCounts(200_000)).toEqual({ value: "2", unit: "ms" });
    expect(durationDisplayFromCounts(10)).toEqual({ value: "100", unit: "ns" });
    expect(countsFromDurationDisplay("0.1", "us")).toBe(10);
  });

  it("converts gap counts and repetition rate both ways", () => {
    expect(rateDisplayFromGapCounts(1_000)).toEqual({ value: "100", unit: "kHz" });
    expect(countsFromRateDisplay("50", "kHz")).toBe(2_000);
  });

  it("derives the ADC capture window from 2048 samples at 125 MHz", () => {
    expect(PAM_ADC_CAPTURE_SAMPLES).toBe(2048);
    expect(PAM_ADC_SAMPLE_NS).toBe(8);
    expect(PAM_ADC_CAPTURE_COUNTS).toBe(1639);
    expect(PAM_ADC_POST_BUFFER_COUNTS).toBe(300);
  });

  it("uses a 5 us minimum galvo settle time", () => {
    expect(PAM_GALVO_SETTLE_MIN_COUNTS).toBe(500);

    expect(constrainedTimingCounts({
      gap_time: 3000,
      galvo_settle_time: 0,
      ld_trigger_time: 0,
      ld_time: 100,
      adc_trigger_time: 100,
    }, "galvo_settle_time")).toMatchObject({
      gap_time: 3000,
      galvo_settle_time: 500,
    });
  });

  it("requires settle time plus the longer of laser end and ADC capture end with buffer", () => {
    expect(requiredGapCounts({
      galvo_settle_time: 3000,
      ld_trigger_time: 0,
      ld_time: 100,
      adc_trigger_time: 100,
    })).toBe(5039);
  });

  it("keeps the frame gap large enough for settle, laser, and ADC capture events", () => {
    const timing = constrainedTimingCounts({
      gap_time: 10,
      galvo_settle_time: 4,
      ld_trigger_time: 8,
      ld_time: 5,
      adc_trigger_time: 4,
    }, "gap_time");

    expect(requiredGapCounts(timing)).toBe(2443);
    expect(timing.gap_time).toBe(2443);
  });

  it("clamps trigger offsets to the current frame gap after settle", () => {
    expect(constrainedTimingCounts({
      gap_time: 4000,
      galvo_settle_time: 500,
      ld_trigger_time: 30,
      ld_time: 5,
      adc_trigger_time: 2000,
    }, "ld_trigger_time")).toMatchObject({
      gap_time: 4000,
      ld_trigger_time: 30,
      adc_trigger_time: 1561,
    });

    expect(constrainedTimingCounts({
      gap_time: 4000,
      galvo_settle_time: 500,
      ld_trigger_time: 3800,
      ld_time: 300,
      adc_trigger_time: 100,
    }, "ld_trigger_time")).toMatchObject({
      gap_time: 4000,
      ld_trigger_time: 3200,
      adc_trigger_time: 100,
    });
  });

  it("labels scan modes from the merged HDL semantics", () => {
    expect(scanModeInfo(0).label).toContain("Flyback");
    expect(scanModeInfo(1).label).toContain("Serpentine");
    expect(scanModeInfo(0).detail).toBe("Return each row.");
    expect(scanModeInfo(1).detail).toBe("Alternate rows.");
  });

  it("uses a detail timing window when frame gap is much longer than trigger events", () => {
    const timing = {
      gap_time: 33333,
      galvo_settle_time: 3000,
      ld_trigger_time: 0,
      ld_time: 100,
      adc_trigger_time: 100,
    };

    expect(timingDetailEndCounts(timing)).toBeGreaterThan(requiredGapCounts(timing));
    expect(timingDetailEndCounts(timing)).toBeLessThan(timing.gap_time);
  });
});
