export function fmtNumber(value: unknown, digits = 3): string {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(digits) : "--";
}

export function fmtInt(value: unknown): string {
  return typeof value === "number" && Number.isFinite(value) ? String(Math.round(value)) : "--";
}

export function fmtHex(value: unknown): string {
  return typeof value === "number" && Number.isFinite(value) ? `0x${Math.round(value).toString(16).toUpperCase()}` : "--";
}

export function inputNumber(value: unknown, digits = 3): string | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(digits) : undefined;
}

export function inputInt(value: unknown): string | undefined {
  return typeof value === "number" && Number.isFinite(value) ? String(Math.round(value)) : undefined;
}

export function inputHex(value: unknown): string | undefined {
  return typeof value === "number" && Number.isFinite(value) ? `0x${Math.round(value).toString(16).toUpperCase()}` : undefined;
}

export function ch0CodeToMa(code: number): number {
  return (code / 65535) * 100.0;
}

export function ch1CodeToMa(code: number): number {
  return (code / 65535) * 10.0;
}

export function parseNumber(text: string): number {
  if (/^0x/i.test(text.trim())) {
    return Number.parseInt(text.trim(), 16);
  }
  return Number(text);
}
