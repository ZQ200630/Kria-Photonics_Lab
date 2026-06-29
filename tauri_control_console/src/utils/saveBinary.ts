import { invoke } from "@tauri-apps/api/core";

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

export type SaveBinaryFilter = {
  name: string;
  extensions: string[];
};

export type SaveBinaryFileRequest = {
  defaultFilename: string;
  bytes: Uint8Array;
  mime?: string;
  filters?: SaveBinaryFilter[];
};

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && Boolean(window.__TAURI_INTERNALS__);
}

function browserDownloadBinary(defaultFilename: string, bytes: Uint8Array, mime = "application/octet-stream"): string {
  if (typeof document === "undefined") return defaultFilename;
  const arrayBuffer = new ArrayBuffer(bytes.length);
  new Uint8Array(arrayBuffer).set(bytes);
  const blob = new Blob([arrayBuffer], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = defaultFilename;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  globalThis.setTimeout(() => {
    URL.revokeObjectURL(url);
    document.body.removeChild(link);
  }, 0);
  return defaultFilename;
}

export async function saveBinaryFile({
  defaultFilename,
  bytes,
  mime,
  filters,
}: SaveBinaryFileRequest): Promise<string | null> {
  if (isTauriRuntime()) {
    return invoke<string | null>("save_binary_file", {
      defaultFilename,
      contents: Array.from(bytes),
      filters: filters ?? [],
    });
  }
  return browserDownloadBinary(defaultFilename, bytes, mime);
}
