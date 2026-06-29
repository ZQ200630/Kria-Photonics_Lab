import { invoke } from "@tauri-apps/api/core";
import { downloadText } from "./csv";

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

export const STORAGE_DATA_TYPES = [
  "ada_raw",
  "idle_spectrum",
  "lock_spectrum_pair",
  "monitor_data",
  "pa_image",
  "pa_point_capture",
  "settings_export",
  "spectrum_recording",
  "spectrum_snapshot",
] as const;

export type StorageDataType = (typeof STORAGE_DATA_TYPES)[number];
export type PaTmpKind = "current" | "canvas" | "point_current";

export type StorageConfig = {
  dataRoot: string;
};

export type StorageRecordFile = {
  path: string;
  contents: string;
};

export type StorageSourceFile = {
  sourcePath: string;
  targetPath: string;
};

export type StorageRecordResult = {
  path: string;
  dataType: StorageDataType;
  dateStamp: string;
  recordName: string;
};

export type StoragePathResult = {
  path: string;
};

export function dateStamp(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

export function storageTextFile(path: string, contents: string): StorageRecordFile {
  return { path, contents };
}

export function storageMetadataFile(metadata: Record<string, unknown>): StorageRecordFile {
  return {
    path: "metadata.json",
    contents: `${JSON.stringify(metadata, null, 2)}\n`,
  };
}

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && Boolean(window.__TAURI_INTERNALS__);
}

function downloadIfAvailable(filename: string, contents: string) {
  if (typeof document === "undefined") return;
  downloadText(filename, contents);
}

export async function storageGetConfig(): Promise<StorageConfig> {
  if (isTauriRuntime()) {
    return invoke<StorageConfig>("storage_get_config");
  }
  return { dataRoot: "browser downloads" };
}

export async function storageChooseRoot(): Promise<StorageConfig | null> {
  if (isTauriRuntime()) {
    return invoke<StorageConfig | null>("storage_choose_root");
  }
  return null;
}

export async function storageSetRoot(path: string): Promise<StorageConfig> {
  if (isTauriRuntime()) {
    return invoke<StorageConfig>("storage_set_root", { path });
  }
  return { dataRoot: path || "browser downloads" };
}

export async function storageWriteRecord({
  dataType,
  name,
  files,
  date = dateStamp(),
}: {
  dataType: StorageDataType;
  name: string;
  files: StorageRecordFile[];
  date?: string;
}): Promise<StorageRecordResult> {
  if (isTauriRuntime()) {
    return invoke<StorageRecordResult>("storage_write_record", {
      dataType,
      dateStamp: date,
      name,
      files,
    });
  }
  files.forEach((file) => downloadIfAvailable(`${dataType}_${name}_${file.path.replace(/[\\/]+/g, "_")}`, file.contents));
  return { path: `browser downloads: ${dataType}/${name}`, dataType, dateStamp: date, recordName: name };
}

export async function storageCopyRecord({
  dataType,
  name,
  files,
  date = dateStamp(),
}: {
  dataType: StorageDataType;
  name: string;
  files: StorageSourceFile[];
  date?: string;
}): Promise<StorageRecordResult> {
  if (isTauriRuntime()) {
    return invoke<StorageRecordResult>("storage_copy_record", {
      dataType,
      dateStamp: date,
      name,
      files,
    });
  }
  return { path: `browser copy unavailable: ${dataType}/${name}`, dataType, dateStamp: date, recordName: name };
}

export async function storageSaveMixedRecord({
  dataType,
  name,
  textFiles,
  sourceFiles,
  date = dateStamp(),
}: {
  dataType: StorageDataType;
  name: string;
  textFiles: StorageRecordFile[];
  sourceFiles: StorageSourceFile[];
  date?: string;
}): Promise<StorageRecordResult> {
  if (isTauriRuntime()) {
    return invoke<StorageRecordResult>("storage_save_mixed_record", {
      dataType,
      dateStamp: date,
      name,
      record: { textFiles, sourceFiles },
    });
  }
  textFiles.forEach((file) => downloadIfAvailable(`${dataType}_${name}_${file.path.replace(/[\\/]+/g, "_")}`, file.contents));
  return { path: `browser mixed save: ${dataType}/${name}`, dataType, dateStamp: date, recordName: name };
}

export async function storagePreparePaTmp(kind: PaTmpKind): Promise<StoragePathResult> {
  if (isTauriRuntime()) {
    return invoke<StoragePathResult>("storage_prepare_pa_tmp", { kind });
  }
  return { path: `browser-pa-${kind}.bin` };
}

export async function storageCopyFileToPaTmp(kind: PaTmpKind, sourcePath: string): Promise<StoragePathResult> {
  if (isTauriRuntime()) {
    return invoke<StoragePathResult>("storage_copy_file_to_pa_tmp", { kind, sourcePath });
  }
  return { path: `browser-pa-${kind}.bin` };
}
