import { invoke } from "@tauri-apps/api/core";
import { downloadText } from "./csv";

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

export type OpenTextFileResult = {
  path: string;
  contents: string;
};

export type SaveBundleFile = {
  path: string;
  contents: string;
};

export async function saveTextFile(filename: string, contents: string): Promise<string | null> {
  if (typeof window !== "undefined" && window.__TAURI_INTERNALS__) {
    return invoke<string | null>("save_text_file", { filename, contents });
  }
  downloadText(filename, contents);
  return `browser download: ${filename}`;
}

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

export async function chooseDataDirectory(): Promise<string | null> {
  if (typeof window !== "undefined" && window.__TAURI_INTERNALS__) {
    return invoke<string | null>("choose_data_directory");
  }
  return null;
}

export async function saveExperimentBundle({
  baseDir,
  category,
  runName,
  eventName,
  files,
}: {
  baseDir?: string | null;
  category?: string | null;
  runName: string;
  eventName: string;
  files: SaveBundleFile[];
}): Promise<string> {
  if (typeof window !== "undefined" && window.__TAURI_INTERNALS__) {
    return invoke<string>("save_experiment_bundle", { baseDir, category: category ?? null, runName, eventName, files });
  }
  const prefix = [category, eventName].filter(Boolean).join("_");
  files.forEach((file) => downloadText(`${prefix}_${file.path.replace(/[\\/]+/g, "_")}`, file.contents));
  return `browser downloads: ${category ? `${category}/` : ""}${eventName}`;
}
