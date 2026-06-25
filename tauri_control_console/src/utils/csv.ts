import type { Spectrum } from "../api/types";
import { DEFAULT_TZ_OHM, adcCodeToInputCurrentMicroamp } from "./ada4355";

export function spectrumCsv(spectrum: Spectrum, tzOhm = DEFAULT_TZ_OHM, currentOffsetMicroamp = 0): string {
  const lines = ["index,time_ms,adc_code,pd_current_uA,relative_intensity"];
  const dtMs = spectrum.count > 1 ? spectrum.duration_ms / (spectrum.count - 1) : 0;
  spectrum.points.forEach((word, index) => {
    const adc = word & 0xffff;
    lines.push(
      `${index},${(index * dtMs).toFixed(6)},${adc},${adcCodeToInputCurrentMicroamp(adc, tzOhm, currentOffsetMicroamp).toFixed(6)},${Math.max(0, 0xffff - adc)}`,
    );
  });
  return `${lines.join("\n")}\n`;
}

export function samplesCsv(samples: number[], sampleRateHz: number, tzOhm = DEFAULT_TZ_OHM, currentOffsetMicroamp = 0): string {
  const lines = ["index,time_us,adc_code,pd_current_uA"];
  const dtUs = sampleRateHz > 0 ? 1000000 / sampleRateHz : 0;
  samples.forEach((adc, index) => {
    const code = adc & 0xffff;
    lines.push(`${index},${(index * dtUs).toFixed(6)},${code},${adcCodeToInputCurrentMicroamp(code, tzOhm, currentOffsetMicroamp).toFixed(6)}`);
  });
  return `${lines.join("\n")}\n`;
}

export function downloadText(filename: string, text: string): void {
  const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
