import { describe, expect, it } from "vitest";
import { buildAcquireTemplate } from "../utils/acquireTemplate";

describe("buildAcquireTemplate", () => {
  it("builds a causal CH1-code-domain template ending at the selected marker", () => {
    const template = buildAcquireTemplate({
      relativeValues: [100, 110, 120, 130, 140],
      crossing: { index: 3, leftIndex: 2, rightIndex: 3, value: 130 },
      ch1StartCode: 20000,
      ch1StopCode: 30000,
      lookbehindPoints: 3,
      searchHalfspanCode: 500,
    });

    expect(template.displayCount).toBe(5);
    expect(template.displayMarkerIndex).toBe(3);
    expect(template.markerCh1Code).toBe(27500);
    expect(template.targetAdc).toBe(65405);
    expect(template.points.map((point) => point.codeOffset)).toEqual([-5000, -2500, 0]);
    expect(template.points.map((point) => point.rawDelta)).toEqual([20, 10, 0]);
    expect(template.searchMinCode).toBe(27000);
    expect(template.searchMaxCode).toBe(28000);
  });

  it("keeps the template in CH1 code domain when sweep direction is reversed", () => {
    const template = buildAcquireTemplate({
      relativeValues: [100, 110, 120, 130, 140],
      crossing: { index: 3, leftIndex: 2, rightIndex: 3, value: 130 },
      ch1StartCode: 30000,
      ch1StopCode: 20000,
      lookbehindPoints: 3,
      searchHalfspanCode: 500,
    });

    expect(template.markerCh1Code).toBe(22500);
    expect(template.points.map((point) => point.codeOffset)).toEqual([5000, 2500, 0]);
  });
});
