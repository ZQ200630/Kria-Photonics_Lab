import { invoke } from "@tauri-apps/api/core";
import { downloadText } from "./csv";

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

export async function saveTextFile(filename: string, contents: string): Promise<string> {
  if (typeof window !== "undefined" && window.__TAURI_INTERNALS__) {
    return invoke<string>("save_text_file", { filename, contents });
  }
  downloadText(filename, contents);
  return `browser download: ${filename}`;
}
