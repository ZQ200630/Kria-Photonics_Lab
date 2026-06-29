import { useMemo } from "react";
import type { PanelProps } from "./types";
import type { Spectrum } from "../api/types";
import PlotCanvas from "./PlotCanvas";
import { fmtInt } from "../utils/format";
import type { MonitorSample } from "../utils/monitorSamples";
import { MONITOR_SAMPLE_HISTORY_LIMIT } from "../utils/monitorSamples";
import {
  DEFAULT_PD_ZERO_ADC_CODE,
  DEFAULT_TZ_OHM,
  adaSaturationState,
  adcCodeToInputCurrentMicroamp,
  formatAdaSaturation,
  formatAdcCodeDetail,
  formatAdcCodeSigned,
  formatMicroamp,
} from "../utils/ada4355";

type MonitorChartSeries = {
  temperatureValues: number[];
  pdCurrentValues: number[];
  spectrumCurrentValues: number[];
};

type MonitorTrendChartSeries = Pick<MonitorChartSeries, "temperatureValues" | "pdCurrentValues">;

const MONITOR_DISPLAY_SAMPLE_LIMIT = 4096;

const EMPTY_MONITOR_CHART_SERIES: MonitorChartSeries = {
  temperatureValues: [],
  pdCurrentValues: [],
  spectrumCurrentValues: [],
};

const EMPTY_MONITOR_TREND_CHART_SERIES: MonitorTrendChartSeries = {
  temperatureValues: [],
  pdCurrentValues: [],
};

export function deriveMonitorTrendChartSeries(
  active: boolean,
  samples: MonitorSample[],
  tzOhm: number,
  pdZeroAdcCode: number,
): MonitorTrendChartSeries {
  if (!active) return EMPTY_MONITOR_TREND_CHART_SERIES;
  const startIndex = Math.max(0, samples.length - MONITOR_DISPLAY_SAMPLE_LIMIT);
  const temperatureValues: number[] = [];
  const pdCurrentValues: number[] = [];
  for (let index = startIndex; index < samples.length; index += 1) {
    const sample = samples[index];
    const temperature = sample?.temp;
    if (typeof temperature === "number" && Number.isFinite(temperature)) temperatureValues.push(temperature);
    const pdCode = sample?.pd;
    if (typeof pdCode === "number" && Number.isFinite(pdCode)) {
      pdCurrentValues.push(adcCodeToInputCurrentMicroamp(pdCode, tzOhm, pdZeroAdcCode));
    }
  }
  return { temperatureValues, pdCurrentValues };
}

export function deriveMonitorSpectrumCurrentValues(
  active: boolean,
  spectrum: Spectrum | null | undefined,
  tzOhm: number,
  pdZeroAdcCode: number,
): number[] {
  if (!active) return [];
  return (spectrum?.points ?? []).map((value) => adcCodeToInputCurrentMicroamp(value & 0xffff, tzOhm, pdZeroAdcCode));
}

export function deriveMonitorChartSeries(
  active: boolean,
  samples: MonitorSample[],
  spectrum: Spectrum | null | undefined,
  tzOhm: number,
  pdZeroAdcCode: number,
): MonitorChartSeries {
  const trendSeries = deriveMonitorTrendChartSeries(active, samples, tzOhm, pdZeroAdcCode);
  return {
    ...trendSeries,
    spectrumCurrentValues: deriveMonitorSpectrumCurrentValues(active, spectrum, tzOhm, pdZeroAdcCode),
  };
}

export default function MonitorPanel({
  state,
  active = true,
  tzOhm = DEFAULT_TZ_OHM,
  pdZeroAdcCode = DEFAULT_PD_ZERO_ADC_CODE,
  monitorSamplesRef,
}: PanelProps) {
  const tec = state.lastStatus?.tec;
  const ada = state.lastStatus?.ada4355;
  const samples = monitorSamplesRef?.current ?? [];
  const { temperatureValues, pdCurrentValues } = useMemo(
    () => deriveMonitorTrendChartSeries(active, samples, tzOhm, pdZeroAdcCode),
    [active, pdZeroAdcCode, samples, state.lastStatus, tzOhm],
  );
  const retainedCount = samples.length;
  const displayedCount = Math.min(samples.length, MONITOR_DISPLAY_SAMPLE_LIMIT);
  const latestTemp = tec?.temperature_filtered_celsius ?? tec?.temp_filtered_c;
  const latestPdCode = ada?.monitor_avg;
  const latestPdCurrent =
    typeof latestPdCode === "number" && Number.isFinite(latestPdCode)
      ? adcCodeToInputCurrentMicroamp(latestPdCode, tzOhm, pdZeroAdcCode)
      : undefined;
  const latestPdSaturation = typeof latestPdCode === "number" ? adaSaturationState(latestPdCode) : undefined;
  const sampleLimitText = `${retainedCount} retained / ${displayedCount} displayed / ${MONITOR_SAMPLE_HISTORY_LIMIT} max`;

  return (
    <section className="panel monitor-panel">
      <h2>Monitor</h2>
      <div className="monitor-grid">
        <div className="monitor-section">
          <div className="monitor-section-header">
            <h3>Temperature Monitor</h3>
            <span className="muted">latest {typeof latestTemp === "number" ? `${latestTemp.toFixed(4)} C` : "-- C"} · {sampleLimitText}</span>
          </div>
          <div className="readouts">
            <div className="readout">
              <span>Filtered</span>
              <strong>{typeof latestTemp === "number" ? latestTemp.toFixed(4) : "--"} C</strong>
            </div>
            <div className="readout">
              <span>Target</span>
              <strong>{typeof tec?.target_celsius === "number" ? tec.target_celsius.toFixed(4) : "--"} C</strong>
            </div>
            <div className="readout">
              <span>Error</span>
              <strong>{typeof tec?.error_celsius === "number" ? tec.error_celsius.toFixed(4) : "--"} C</strong>
            </div>
          </div>
          <PlotCanvas values={temperatureValues} color="#dc2626" label="temperature" height={240} active={active} />
        </div>

        <div className="monitor-section">
          <div className="monitor-section-header">
            <h3>PD Monitor</h3>
            <span className="muted">latest {latestPdCurrent === undefined ? "--" : `${formatMicroamp(latestPdCurrent)} uA`} · {sampleLimitText}</span>
          </div>
          <div className="readouts">
            <div className="readout">
              <span>ADC Code</span>
              <strong>{typeof latestPdCode === "number" ? formatAdcCodeSigned(latestPdCode) : "--"}</strong>
              <div className="muted">{typeof latestPdCode === "number" ? formatAdcCodeDetail(latestPdCode) : "raw --"}</div>
            </div>
            <div className="readout">
              <span>Min / Max</span>
              <strong>
                {fmtInt(ada?.monitor_min)} / {fmtInt(ada?.monitor_max)}
              </strong>
            </div>
            <div className="readout">
              <span>Rail</span>
              <strong>{formatAdaSaturation(latestPdSaturation)}</strong>
              <div className="muted">count {fmtInt(ada?.monitor_counter)}</div>
            </div>
          </div>
          <PlotCanvas
            values={pdCurrentValues}
            color="#2563eb"
            label="PD current"
            height={240}
            yTickFormatter={(value) => `${formatMicroamp(value)} uA`}
            active={active}
          />
        </div>

      </div>
    </section>
  );
}
