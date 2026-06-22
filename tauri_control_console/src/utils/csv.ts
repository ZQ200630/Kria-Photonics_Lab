import type { Spectrum } from "../api/types";

export function spectrumCsv(spectrum: Spectrum): string {
  const lines = ["index,time_ms,adc_code,relative_intensity"];
  const dtMs = spectrum.count > 1 ? spectrum.duration_ms / (spectrum.count - 1) : 0;
  spectrum.points.forEach((word, index) => {
    const adc = word & 0xffff;
    lines.push(`${index},${(index * dtMs).toFixed(6)},${adc},${Math.max(0, 0xffff - adc)}`);
  });
  return `${lines.join("\n")}\n`;
}

export function samplesCsv(samples: number[], sampleRateHz: number): string {
  const lines = ["index,time_us,adc_code"];
  const dtUs = sampleRateHz > 0 ? 1000000 / sampleRateHz : 0;
  samples.forEach((adc, index) => {
    lines.push(`${index},${(index * dtUs).toFixed(6)},${adc & 0xffff}`);
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
