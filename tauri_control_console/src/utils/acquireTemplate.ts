import {
  inferPolarityInvertForMarker,
  relativeIntensityToRawAdc,
  scanCodeAtSpectrumIndex,
  type LevelCrossing,
} from "./lockSpectrum";

export type AcquireTemplatePoint = {
  codeOffset: number;
  rawDelta: number;
};

export type AcquireTemplate = {
  displayCount: number;
  displayMarkerIndex: number;
  markerCh1Code: number;
  targetAdc: number;
  polarityInvert: boolean;
  templateSpacingCode: number;
  searchMinCode: number;
  searchMaxCode: number;
  points: AcquireTemplatePoint[];
};

function clampU16(value: number): number {
  return Math.max(0, Math.min(0xffff, Math.round(value)));
}

export function buildAcquireTemplate({
  relativeValues,
  crossing,
  ch1StartCode,
  ch1StopCode,
  lookbehindPoints,
  searchHalfspanCode,
}: {
  relativeValues: number[];
  crossing: LevelCrossing;
  ch1StartCode: number;
  ch1StopCode: number;
  lookbehindPoints: number;
  searchHalfspanCode: number;
}): AcquireTemplate {
  const displayCount = relativeValues.length;
  const markerIndex = Math.max(0, Math.min(Math.max(0, displayCount - 1), Math.round(crossing.index)));
  const markerCh1Code = scanCodeAtSpectrumIndex(crossing.index, displayCount, ch1StartCode, ch1StopCode);
  const targetAdc = relativeIntensityToRawAdc(crossing.value);
  const safeLookbehind = Math.max(1, Math.round(lookbehindPoints));
  const startIndex = Math.max(0, markerIndex - safeLookbehind + 1);
  const points: AcquireTemplatePoint[] = [];

  for (let index = startIndex; index <= markerIndex; index += 1) {
    const code = scanCodeAtSpectrumIndex(index, displayCount, ch1StartCode, ch1StopCode);
    points.push({
      codeOffset: code - markerCh1Code,
      rawDelta: relativeIntensityToRawAdc(relativeValues[index]) - targetAdc,
    });
  }

  const spacingValues = points
    .slice(1)
    .map((point, index) => Math.abs(point.codeOffset - points[index].codeOffset))
    .filter((value) => value > 0);
  const templateSpacingCode =
    spacingValues.length > 0
      ? Math.max(1, Math.round(spacingValues.reduce((sum, value) => sum + value, 0) / spacingValues.length))
      : 0;
  const halfspan = Math.max(0, Math.round(searchHalfspanCode));

  return {
    displayCount,
    displayMarkerIndex: markerIndex,
    markerCh1Code,
    targetAdc,
    polarityInvert: inferPolarityInvertForMarker(relativeValues, crossing, ch1StartCode, ch1StopCode),
    templateSpacingCode,
    searchMinCode: clampU16(markerCh1Code - halfspan),
    searchMaxCode: clampU16(markerCh1Code + halfspan),
    points,
  };
}
