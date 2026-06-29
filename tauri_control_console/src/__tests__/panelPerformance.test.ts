import { describe, expect, it } from "vitest";
import { deriveLockLivePdSamples } from "../components/LockPanel";
import { deriveMonitorChartSeries, deriveMonitorSpectrumCurrentValues, deriveMonitorTrendChartSeries } from "../components/MonitorPanel";
import { deriveTecTemperatureValues } from "../components/TecPanel";
import type { MonitorSample } from "../utils/monitorSamples";
import type { Spectrum } from "../api/types";

describe("panel render performance helpers", () => {
  const samples: MonitorSample[] = [
    { t: 0, temp: 31.1, pd: 29600 },
    { t: 1, temp: undefined, pd: Number.NaN },
    { t: 2, temp: 31.2, pd: 29590 },
  ];
  const spectrum: Spectrum = {
    buffer_id: 0,
    frame_counter: 1,
    slow_index: 0,
    count: 3,
    duration_ms: 1,
    dt_us_per_point: 1,
    points: [29600, 29590, 29580],
  };

  it("skips monitor chart arrays while the Monitor tab is hidden", () => {
    expect(deriveMonitorChartSeries(false, samples, spectrum, 2000, 29600)).toEqual({
      temperatureValues: [],
      pdCurrentValues: [],
      spectrumCurrentValues: [],
    });
  });

  it("builds monitor chart arrays only when the Monitor tab is visible", () => {
    const series = deriveMonitorChartSeries(true, samples, spectrum, 2000, 29600);

    expect(series.temperatureValues).toEqual([31.1, 31.2]);
    expect(series.pdCurrentValues).toHaveLength(2);
    expect(series.spectrumCurrentValues).toHaveLength(3);
  });

  it("derives Monitor trend and spectrum series independently for memoized rendering", () => {
    const trendSeries = deriveMonitorTrendChartSeries(true, samples, 2000, 29600);
    const spectrumSeries = deriveMonitorSpectrumCurrentValues(true, spectrum, 2000, 29600);

    expect(trendSeries.temperatureValues).toEqual([31.1, 31.2]);
    expect(trendSeries.pdCurrentValues).toHaveLength(2);
    expect(spectrumSeries).toHaveLength(3);
  });

  it("limits Monitor trend chart derivation to the latest display window", () => {
    const longSamples = Array.from({ length: 10_000 }, (_, index) => ({ t: index, temp: index, pd: 29600 + (index % 8) }));

    const series = deriveMonitorChartSeries(true, longSamples, null, 2000, 29600);

    expect(series.temperatureValues).toHaveLength(4096);
    expect(series.temperatureValues[0]).toBe(5904);
    expect(series.temperatureValues[4095]).toBe(9999);
    expect(series.pdCurrentValues).toHaveLength(4096);
  });

  it("skips TEC trend extraction while the TEC tab is hidden", () => {
    expect(deriveTecTemperatureValues(false, samples)).toEqual([]);
    expect(deriveTecTemperatureValues(true, samples)).toEqual([31.1, 31.2]);
  });

  it("collects TEC temperatures from the newest display window without scanning old history", () => {
    const longSamples = new Proxy(
      { length: 10_000 },
      {
        get(target, prop) {
          if (prop === "length") return target.length;
          if (prop === "map" || prop === "filter" || prop === "slice" || prop === Symbol.iterator) {
            throw new Error(`unexpected full-history operation: ${String(prop)}`);
          }
          const index = typeof prop === "string" ? Number(prop) : Number.NaN;
          if (!Number.isInteger(index)) return undefined;
          if (index < 9_400) throw new Error(`read old temperature sample ${index}`);
          return { t: index, temp: index / 100 };
        },
      },
    ) as unknown as MonitorSample[];

    const latest = deriveTecTemperatureValues(true, longSamples);

    expect(latest).toHaveLength(600);
    expect(latest[0]).toBe(94);
    expect(latest[599]).toBe(99.99);
  });

  it("skips Lock live PD extraction while the Lock tab is hidden", () => {
    expect(deriveLockLivePdSamples(false, samples)).toEqual([]);
    expect(deriveLockLivePdSamples(true, samples)).toEqual([samples[0], samples[2]]);
  });

  it("collects Lock live PD samples from the newest data without scanning old history", () => {
    const longSamples = new Proxy(
      { length: 10_000 },
      {
        get(target, prop) {
          if (prop === "length") return target.length;
          if (prop === "filter" || prop === "slice" || prop === Symbol.iterator) {
            throw new Error(`unexpected full-history operation: ${String(prop)}`);
          }
          const index = typeof prop === "string" ? Number(prop) : Number.NaN;
          if (!Number.isInteger(index)) return undefined;
          if (index < 9_000) throw new Error(`read old sample ${index}`);
          return { t: index, pd: 29000 + index };
        },
      },
    ) as unknown as MonitorSample[];

    const latest = deriveLockLivePdSamples(true, longSamples);

    expect(latest).toHaveLength(1000);
    expect(latest[0].t).toBe(9000);
    expect(latest[999].t).toBe(9999);
  });
});
