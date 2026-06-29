import type { Spectrum } from "../api/types";
import { DEFAULT_PD_ZERO_ADC_CODE, DEFAULT_TZ_OHM, adcCodeToInputCurrentMicroamp } from "./ada4355";

export function spectrumCsv(spectrum: Spectrum, tzOhm = DEFAULT_TZ_OHM, zeroAdcCode = DEFAULT_PD_ZERO_ADC_CODE): string {
  const lines = ["index,time_ms,adc_code,pd_current_uA,relative_intensity"];
  const dtMs = spectrum.count > 1 ? spectrum.duration_ms / (spectrum.count - 1) : 0;
  spectrum.points.forEach((word, index) => {
    const adc = word & 0xffff;
    lines.push(
      `${index},${(index * dtMs).toFixed(6)},${adc},${adcCodeToInputCurrentMicroamp(adc, tzOhm, zeroAdcCode).toFixed(6)},${Math.max(0, 0xffff - adc)}`,
    );
  });
  return `${lines.join("\n")}\n`;
}

export function samplesCsv(samples: number[], sampleRateHz: number, tzOhm = DEFAULT_TZ_OHM, zeroAdcCode = DEFAULT_PD_ZERO_ADC_CODE): string {
  const lines = ["index,time_us,adc_code,pd_current_uA"];
  const dtUs = sampleRateHz > 0 ? 1000000 / sampleRateHz : 0;
  samples.forEach((adc, index) => {
    const code = adc & 0xffff;
    lines.push(`${index},${(index * dtUs).toFixed(6)},${code},${adcCodeToInputCurrentMicroamp(code, tzOhm, zeroAdcCode).toFixed(6)}`);
  });
  return `${lines.join("\n")}\n`;
}

export function downloadText(filename: string, text: string, mime = "text/csv;charset=utf-8"): void {
  if (typeof document === "undefined") return;
  const { url, revoke } = textDownloadUrl(text, mime);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  globalThis.setTimeout(() => {
    revoke?.();
    document.body.removeChild(link);
  }, 0);
}

function textDownloadUrl(text: string, mime: string): { url: string; revoke?: () => void } {
  try {
    if (typeof Blob !== "undefined" && typeof URL !== "undefined" && typeof URL.createObjectURL === "function") {
      const blob = new Blob([text], { type: mime });
      const url = URL.createObjectURL(blob);
      return { url, revoke: () => URL.revokeObjectURL(url) };
    }
  } catch {
    /* fall back to a data URL for WebViews without usable object URLs */
  }
  return { url: `data:${mime},${encodeURIComponent(text)}` };
}
