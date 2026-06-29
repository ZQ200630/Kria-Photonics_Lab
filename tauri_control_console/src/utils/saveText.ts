import { invoke } from "@tauri-apps/api/core";

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

export type OpenTextFileResult = {
  path: string;
  contents: string;
};

export async function openTextFile(): Promise<OpenTextFileResult | null> {
  if (typeof window !== "undefined" && window.__TAURI_INTERNALS__) {
    const result = await invoke<[string, string] | null>("open_text_file");
    if (!result) return null;
    return { path: result[0], contents: result[1] };
  }

  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.style.display = "none";
    input.onchange = () => {
      const file = input.files?.[0];
      input.remove();
      if (!file) {
        resolve(null);
        return;
      }
      file
        .text()
        .then((contents) => resolve({ path: file.name, contents }))
        .catch(reject);
    };
    document.body.appendChild(input);
    input.click();
  });
}
