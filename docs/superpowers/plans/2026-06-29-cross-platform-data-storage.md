# Cross-Platform Data Storage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route every runtime data export through one cross-platform Tauri storage manager with a global data root and `data_type/YYYYMMDD/name_index/` record folders.

**Architecture:** Rust owns all filesystem work through `PathBuf` and native folder dialogs. The React frontend calls typed storage utilities with logical data types, record names, file contents, or source files. PA live capture writes to managed temporary folders under the data root, and all panels use the same record allocator.

**Tech Stack:** Tauri v2, Rust `std::fs`/`PathBuf`, `rfd::FileDialog`, React 18, TypeScript, Vitest, Cargo tests.

---

## File Structure

- Create `tauri_control_console/src-tauri/src/storage.rs`: cross-platform storage config, root selection, record folder allocation, safe names, write/copy commands, PA temp path helpers, and unit tests.
- Modify `tauri_control_console/src-tauri/src/main.rs`: register the storage module commands and remove old category-specific default directory behavior from general saves.
- Modify `tauri_control_console/src-tauri/src/pa_stream.rs`: keep receiver writing to a caller-provided path, but callers now get that path from storage.
- Create `tauri_control_console/src/utils/storage.ts`: typed frontend wrapper for storage commands and browser fallback behavior.
- Modify `tauri_control_console/src/utils/saveText.ts`: deprecate experiment-save helpers or forward them to storage only where compatibility is needed during migration.
- Modify `tauri_control_console/src/components/SettingsPanel.tsx`: add global data root controls and route settings export to `settings_export`.
- Modify `tauri_control_console/src/components/SpectrumPanel.tsx`: route latest spectrum and spectrum recordings to `spectrum_snapshot` and `spectrum_recording`.
- Modify `tauri_control_console/src/components/AdaPanel.tsx`: route raw saves to `ada_raw`.
- Modify `tauri_control_console/src/components/LockPanel.tsx`: remove per-panel save directory and route all saves to `idle_spectrum`, `lock_spectrum_pair`, and `monitor_data`.
- Modify `tauri_control_console/src/components/PaImagingPanel.tsx`: remove editable output path, write current/canvas temp files under `_tmp/pa_image`, and add PA current/canvas save actions.
- Modify tests under `tauri_control_console/src/__tests__/`: add frontend storage tests and update panel layout tests.

## Data Type Map

Use only these storage data type slugs in runtime app code:

```ts
export const STORAGE_DATA_TYPES = [
  "ada_raw",
  "idle_spectrum",
  "lock_spectrum_pair",
  "monitor_data",
  "pa_image",
  "settings_export",
  "spectrum_recording",
  "spectrum_snapshot",
] as const;
```

Temporary PA paths use storage kind slugs:

```ts
export const PA_TMP_KINDS = ["current", "canvas"] as const;
```

## Task 1: Rust Storage Manager Tests

**Files:**
- Create: `tauri_control_console/src-tauri/src/storage.rs`
- Modify: `tauri_control_console/src-tauri/src/main.rs`

- [ ] **Step 1: Create the storage module skeleton and failing unit tests**

Add `mod storage;` near the top of `main.rs`. Create `storage.rs` with this initial module and tests:

```rust
use std::{
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
};

pub const DATA_TYPE_DIRS: [&str; 8] = [
    "ada_raw",
    "idle_spectrum",
    "lock_spectrum_pair",
    "monitor_data",
    "pa_image",
    "settings_export",
    "spectrum_recording",
    "spectrum_snapshot",
];

pub const PA_TMP_KINDS: [&str; 2] = ["current", "canvas"];

pub fn sanitize_component(value: &str, fallback: &str) -> String {
    let cleaned: String = value
        .chars()
        .map(|ch| match ch {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '_',
            ch if ch.is_control() => '_',
            ch if ch.is_whitespace() => '_',
            ch => ch,
        })
        .collect();
    let cleaned = cleaned.trim_matches(|ch| ch == '_' || ch == '.' || ch == ' ');
    if cleaned.is_empty() {
        fallback.to_string()
    } else {
        cleaned.to_string()
    }
}

pub fn validate_data_type(value: &str) -> Result<&'static str, String> {
    DATA_TYPE_DIRS
        .iter()
        .copied()
        .find(|candidate| *candidate == value)
        .ok_or_else(|| format!("unknown data type: {value}"))
}

pub fn validate_date_stamp(value: &str) -> Result<String, String> {
    let valid = value.len() == 8 && value.chars().all(|ch| ch.is_ascii_digit());
    if valid {
        Ok(value.to_string())
    } else {
        Err(format!("invalid date stamp: {value}"))
    }
}

pub fn allocate_record_dir(date_dir: &Path, record_name: &str) -> Result<PathBuf, String> {
    fs::create_dir_all(date_dir).map_err(|err| format!("create {} failed: {}", date_dir.display(), err))?;
    let safe_name = sanitize_component(record_name, "record");
    let existing: HashSet<String> = fs::read_dir(date_dir)
        .map_err(|err| format!("read {} failed: {}", date_dir.display(), err))?
        .filter_map(|entry| entry.ok())
        .filter_map(|entry| entry.file_name().into_string().ok())
        .map(|name| name.to_ascii_lowercase())
        .collect();
    for index in 1..1_000_000 {
        let candidate = format!("{safe_name}_{index}");
        if !existing.contains(&candidate.to_ascii_lowercase()) {
            return Ok(date_dir.join(candidate));
        }
    }
    Err(format!("no available record index for {safe_name}"))
}

pub fn prepare_root(root: &Path) -> Result<(), String> {
    fs::create_dir_all(root).map_err(|err| format!("create {} failed: {}", root.display(), err))?;
    fs::create_dir_all(root.join("_tmp")).map_err(|err| format!("create _tmp failed: {err}"))?;
    for data_type in DATA_TYPE_DIRS {
        fs::create_dir_all(root.join(data_type))
            .map_err(|err| format!("create {} failed: {}", root.join(data_type).display(), err))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_root(name: &str) -> PathBuf {
        let mut path = std::env::temp_dir();
        path.push(format!("butterfly_storage_{name}_{}", std::process::id()));
        let _ = fs::remove_dir_all(&path);
        fs::create_dir_all(&path).expect("create test root");
        path
    }

    #[test]
    fn sanitizes_cross_platform_file_name_components() {
        assert_eq!(sanitize_component("bad<name>:a/b\\c|d?e*", "fallback"), "bad_name__a_b_c_d_e");
        assert_eq!(sanitize_component("   ", "fallback"), "fallback");
        assert_eq!(sanitize_component("...abc...", "fallback"), "abc");
    }

    #[test]
    fn validates_known_data_types() {
        assert_eq!(validate_data_type("pa_image").expect("valid type"), "pa_image");
        assert!(validate_data_type("Raw").is_err());
    }

    #[test]
    fn validates_yyyymmdd_date_stamps() {
        assert_eq!(validate_date_stamp("20260629").expect("valid date"), "20260629");
        assert!(validate_date_stamp("2026-06-29").is_err());
    }

    #[test]
    fn allocates_record_folders_case_insensitively() {
        let root = test_root("allocate");
        let date_dir = root.join("pa_image").join("20260629");
        fs::create_dir_all(date_dir.join("Sample_1")).expect("create existing record");
        let allocated = allocate_record_dir(&date_dir, "sample").expect("allocate");
        assert_eq!(allocated.file_name().and_then(|name| name.to_str()), Some("sample_2"));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn prepares_root_with_only_data_type_folders() {
        let root = test_root("prepare");
        prepare_root(&root).expect("prepare root");
        assert!(root.join("_tmp").is_dir());
        for data_type in DATA_TYPE_DIRS {
            assert!(root.join(data_type).is_dir(), "missing {data_type}");
        }
        let _ = fs::remove_dir_all(root);
    }
}
```

- [ ] **Step 2: Run Rust tests and confirm the new module compiles**

Run:

```bash
cd /home/qian/Portable_System_Project/Butterfly_Laser_Driver/tauri_control_console/src-tauri
env -u PKG_CONFIG_PATH -u PKG_CONFIG_SYSROOT_DIR -u CC -u CXX -u AR -u AS -u LD -u STRIP -u RANLIB -u OBJCOPY -u OBJDUMP -u READELF -u CFLAGS -u CXXFLAGS -u LDFLAGS cargo test storage -- --nocapture
```

Expected: PASS for the storage tests.

## Task 2: Rust Storage Commands

**Files:**
- Modify: `tauri_control_console/src-tauri/Cargo.toml`
- Modify: `tauri_control_console/src-tauri/src/storage.rs`
- Modify: `tauri_control_console/src-tauri/src/main.rs`

- [ ] **Step 1: Add direct JSON dependency**

Add `serde_json` beside `serde` in `Cargo.toml`:

```toml
serde = { version = "1", features = ["derive"] }
serde_json = "1"
```

- [ ] **Step 2: Add serializable command types and config persistence**

Add these types and helpers to `storage.rs`:

```rust
use tauri::Manager;

#[derive(Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageConfig {
    pub data_root: String,
}

#[derive(Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageRecordFile {
    pub path: String,
    pub contents: String,
}

#[derive(Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageSourceFile {
    pub source_path: String,
    pub target_path: String,
}

#[derive(Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageMixedRecord {
    pub text_files: Vec<StorageRecordFile>,
    pub source_files: Vec<StorageSourceFile>,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageRecordResult {
    pub path: String,
    pub data_type: String,
    pub date_stamp: String,
    pub record_name: String,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoragePathResult {
    pub path: String,
}

fn config_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let mut dir = app.path().app_config_dir().map_err(|err| format!("app config dir failed: {err}"))?;
    fs::create_dir_all(&dir).map_err(|err| format!("create {} failed: {}", dir.display(), err))?;
    dir.push("storage_config.json");
    Ok(dir)
}

fn default_data_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let mut root = app
        .path()
        .document_dir()
        .or_else(|_| app.path().app_data_dir())
        .map_err(|err| format!("default data root failed: {err}"))?;
    root.push("ButterflyLaserData");
    Ok(root)
}

fn load_or_default_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let path = config_path(app)?;
    if path.exists() {
        let contents = fs::read_to_string(&path).map_err(|err| format!("read {} failed: {}", path.display(), err))?;
        let config: StorageConfig = serde_json::from_str(&contents).map_err(|err| format!("parse {} failed: {}", path.display(), err))?;
        if !config.data_root.trim().is_empty() {
            return Ok(PathBuf::from(config.data_root));
        }
    }
    default_data_root(app)
}

fn save_config(app: &tauri::AppHandle, root: &Path) -> Result<StorageConfig, String> {
    prepare_root(root)?;
    let config = StorageConfig {
        data_root: root.display().to_string(),
    };
    let path = config_path(app)?;
    let contents = serde_json::to_string_pretty(&config).map_err(|err| format!("serialize storage config failed: {err}"))?;
    fs::write(&path, format!("{contents}\n")).map_err(|err| format!("write {} failed: {}", path.display(), err))?;
    Ok(config)
}
```

- [ ] **Step 3: Add command functions**

Add these command functions to `storage.rs`:

```rust
#[tauri::command]
pub fn storage_get_config(app: tauri::AppHandle) -> Result<StorageConfig, String> {
    let root = load_or_default_root(&app)?;
    save_config(&app, &root)
}

#[tauri::command]
pub fn storage_set_root(app: tauri::AppHandle, path: String) -> Result<StorageConfig, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("data root is empty".to_string());
    }
    save_config(&app, Path::new(trimmed))
}

#[tauri::command]
pub fn storage_choose_root(app: tauri::AppHandle) -> Result<Option<StorageConfig>, String> {
    let root = load_or_default_root(&app)?;
    let Some(path) = rfd::FileDialog::new().set_directory(&root).pick_folder() else {
        return Ok(None);
    };
    save_config(&app, &path).map(Some)
}

fn safe_relative_path(value: &str) -> PathBuf {
    let mut path = PathBuf::new();
    for (index, component) in value.split('/').enumerate() {
        if component.is_empty() || component == "." || component == ".." {
            continue;
        }
        path.push(sanitize_component(component, if index == 0 { "file" } else { "part" }));
    }
    if path.as_os_str().is_empty() {
        path.push("file");
    }
    path
}

fn record_dir(app: &tauri::AppHandle, data_type: &str, date_stamp: &str, name: &str) -> Result<(PathBuf, String), String> {
    let data_type = validate_data_type(data_type)?;
    let date_stamp = validate_date_stamp(date_stamp)?;
    let root = load_or_default_root(app)?;
    prepare_root(&root)?;
    let date_dir = root.join(data_type).join(date_stamp);
    let dir = allocate_record_dir(&date_dir, name)?;
    let record_name = dir
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "record folder name is not valid UTF-8".to_string())?
        .to_string();
    fs::create_dir_all(&dir).map_err(|err| format!("create {} failed: {}", dir.display(), err))?;
    Ok((dir, record_name))
}

#[tauri::command]
pub fn storage_write_record(
    app: tauri::AppHandle,
    data_type: String,
    date_stamp: String,
    name: String,
    files: Vec<StorageRecordFile>,
) -> Result<StorageRecordResult, String> {
    if files.is_empty() {
        return Err("record has no files".to_string());
    }
    let (dir, record_name) = record_dir(&app, &data_type, &date_stamp, &name)?;
    for file in files {
        let path = dir.join(safe_relative_path(&file.path));
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|err| format!("create {} failed: {}", parent.display(), err))?;
        }
        fs::write(&path, file.contents).map_err(|err| format!("write {} failed: {}", path.display(), err))?;
    }
    Ok(StorageRecordResult {
        path: dir.display().to_string(),
        data_type,
        date_stamp,
        record_name,
    })
}

#[tauri::command]
pub fn storage_copy_record(
    app: tauri::AppHandle,
    data_type: String,
    date_stamp: String,
    name: String,
    files: Vec<StorageSourceFile>,
) -> Result<StorageRecordResult, String> {
    if files.is_empty() {
        return Err("record has no files".to_string());
    }
    let (dir, record_name) = record_dir(&app, &data_type, &date_stamp, &name)?;
    for file in files {
        let source = PathBuf::from(file.source_path);
        let target = dir.join(safe_relative_path(&file.target_path));
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(|err| format!("create {} failed: {}", parent.display(), err))?;
        }
        fs::copy(&source, &target).map_err(|err| {
            format!("copy {} to {} failed: {}", source.display(), target.display(), err)
        })?;
    }
    Ok(StorageRecordResult {
        path: dir.display().to_string(),
        data_type,
        date_stamp,
        record_name,
    })
}

fn write_record_files(dir: &Path, files: Vec<StorageRecordFile>) -> Result<(), String> {
    for file in files {
        let path = dir.join(safe_relative_path(&file.path));
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|err| format!("create {} failed: {}", parent.display(), err))?;
        }
        fs::write(&path, file.contents).map_err(|err| format!("write {} failed: {}", path.display(), err))?;
    }
    Ok(())
}

fn copy_record_files(dir: &Path, files: Vec<StorageSourceFile>) -> Result<(), String> {
    for file in files {
        let source = PathBuf::from(file.source_path);
        let target = dir.join(safe_relative_path(&file.target_path));
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(|err| format!("create {} failed: {}", parent.display(), err))?;
        }
        fs::copy(&source, &target).map_err(|err| {
            format!("copy {} to {} failed: {}", source.display(), target.display(), err)
        })?;
    }
    Ok(())
}

#[tauri::command]
pub fn storage_save_mixed_record(
    app: tauri::AppHandle,
    data_type: String,
    date_stamp: String,
    name: String,
    record: StorageMixedRecord,
) -> Result<StorageRecordResult, String> {
    if record.text_files.is_empty() && record.source_files.is_empty() {
        return Err("record has no files".to_string());
    }
    let (dir, record_name) = record_dir(&app, &data_type, &date_stamp, &name)?;
    write_record_files(&dir, record.text_files)?;
    copy_record_files(&dir, record.source_files)?;
    Ok(StorageRecordResult {
        path: dir.display().to_string(),
        data_type,
        date_stamp,
        record_name,
    })
}

#[tauri::command]
pub fn storage_prepare_pa_tmp(app: tauri::AppHandle, kind: String) -> Result<StoragePathResult, String> {
    if !PA_TMP_KINDS.contains(&kind.as_str()) {
        return Err(format!("unknown PA temp kind: {kind}"));
    }
    let root = load_or_default_root(&app)?;
    prepare_root(&root)?;
    let dir = root.join("_tmp").join("pa_image").join(kind);
    fs::create_dir_all(&dir).map_err(|err| format!("create {} failed: {}", dir.display(), err))?;
    let path = dir.join("legacy.bin");
    Ok(StoragePathResult {
        path: path.display().to_string(),
    })
}

#[tauri::command]
pub fn storage_copy_file_to_pa_tmp(app: tauri::AppHandle, kind: String, source_path: String) -> Result<StoragePathResult, String> {
    let target = storage_prepare_pa_tmp(app, kind)?;
    fs::copy(&source_path, &target.path)
        .map_err(|err| format!("copy {} to {} failed: {}", source_path, target.path, err))?;
    Ok(target)
}
```

- [ ] **Step 4: Register commands and import Tauri path manager**

Modify `main.rs` to import and register:

```rust
mod storage;

use storage::{
    storage_choose_root, storage_copy_file_to_pa_tmp, storage_copy_record, storage_get_config,
    storage_prepare_pa_tmp, storage_save_mixed_record, storage_set_root, storage_write_record,
};
```

Add the commands to `tauri::generate_handler!`:

```rust
storage_get_config,
storage_choose_root,
storage_set_root,
storage_write_record,
storage_copy_record,
storage_save_mixed_record,
storage_prepare_pa_tmp,
storage_copy_file_to_pa_tmp,
```

- [ ] **Step 5: Run Rust tests**

Run:

```bash
cd /home/qian/Portable_System_Project/Butterfly_Laser_Driver/tauri_control_console/src-tauri
env -u PKG_CONFIG_PATH -u PKG_CONFIG_SYSROOT_DIR -u CC -u CXX -u AR -u AS -u LD -u STRIP -u RANLIB -u OBJCOPY -u OBJDUMP -u READELF -u CFLAGS -u CXXFLAGS -u LDFLAGS cargo test storage -- --nocapture
```

Expected: storage tests pass.

## Task 3: Frontend Storage Utility

**Files:**
- Create: `tauri_control_console/src/utils/storage.ts`
- Create: `tauri_control_console/src/__tests__/storage.test.ts`

- [ ] **Step 1: Write frontend utility tests**

Create `storage.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from "vitest";
import { dateStamp, storageMetadataFile, storageTextFile } from "../utils/storage";

describe("storage utilities", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-29T12:34:56"));
  });

  it("formats local YYYYMMDD date stamps", () => {
    expect(dateStamp()).toBe("20260629");
  });

  it("builds text file payloads", () => {
    expect(storageTextFile("spectrum.csv", "a,b\n")).toEqual({ path: "spectrum.csv", contents: "a,b\n" });
  });

  it("builds metadata JSON files with trailing newline", () => {
    expect(storageMetadataFile({ kind: "raw" })).toEqual({
      path: "metadata.json",
      contents: '{\n  "kind": "raw"\n}\n',
    });
  });
});
```

- [ ] **Step 2: Implement `storage.ts`**

Create `storage.ts`:

```ts
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
  "settings_export",
  "spectrum_recording",
  "spectrum_snapshot",
] as const;

export type StorageDataType = (typeof STORAGE_DATA_TYPES)[number];
export type PaTmpKind = "current" | "canvas";

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

export type StorageMixedRecord = {
  textFiles: StorageRecordFile[];
  sourceFiles: StorageSourceFile[];
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

export async function storageGetConfig(): Promise<StorageConfig> {
  if (typeof window !== "undefined" && window.__TAURI_INTERNALS__) {
    return invoke<StorageConfig>("storage_get_config");
  }
  return { dataRoot: "browser downloads" };
}

export async function storageChooseRoot(): Promise<StorageConfig | null> {
  if (typeof window !== "undefined" && window.__TAURI_INTERNALS__) {
    return invoke<StorageConfig | null>("storage_choose_root");
  }
  return null;
}

export async function storageSetRoot(path: string): Promise<StorageConfig> {
  if (typeof window !== "undefined" && window.__TAURI_INTERNALS__) {
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
  if (typeof window !== "undefined" && window.__TAURI_INTERNALS__) {
    return invoke<StorageRecordResult>("storage_write_record", {
      dataType,
      dateStamp: date,
      name,
      files,
    });
  }
  files.forEach((file) => downloadText(`${dataType}_${name}_${file.path.replace(/[\\/]+/g, "_")}`, file.contents));
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
  if (typeof window !== "undefined" && window.__TAURI_INTERNALS__) {
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
  if (typeof window !== "undefined" && window.__TAURI_INTERNALS__) {
    return invoke<StorageRecordResult>("storage_save_mixed_record", {
      dataType,
      dateStamp: date,
      name,
      record: { textFiles, sourceFiles },
    });
  }
  textFiles.forEach((file) => downloadText(`${dataType}_${name}_${file.path.replace(/[\\/]+/g, "_")}`, file.contents));
  return { path: `browser mixed save: ${dataType}/${name}`, dataType, dateStamp: date, recordName: name };
}

export async function storagePreparePaTmp(kind: PaTmpKind): Promise<StoragePathResult> {
  if (typeof window !== "undefined" && window.__TAURI_INTERNALS__) {
    return invoke<StoragePathResult>("storage_prepare_pa_tmp", { kind });
  }
  return { path: `browser-pa-${kind}.bin` };
}

export async function storageCopyFileToPaTmp(kind: PaTmpKind, sourcePath: string): Promise<StoragePathResult> {
  if (typeof window !== "undefined" && window.__TAURI_INTERNALS__) {
    return invoke<StoragePathResult>("storage_copy_file_to_pa_tmp", { kind, sourcePath });
  }
  return { path: `browser-pa-${kind}.bin` };
}
```

- [ ] **Step 3: Run frontend storage tests**

Run:

```bash
cd /home/qian/Portable_System_Project/Butterfly_Laser_Driver/tauri_control_console
npm test -- storage.test.ts
```

Expected: PASS.

## Task 4: Settings Panel Global Root

**Files:**
- Modify: `tauri_control_console/src/components/SettingsPanel.tsx`
- Modify: `tauri_control_console/src/__tests__/settings.test.ts`

- [ ] **Step 1: Add SettingsPanel state and storage imports**

Replace the `saveTextFile` import with storage helpers:

```ts
import { openTextFile } from "../utils/saveText";
import { storageChooseRoot, storageGetConfig, storageMetadataFile, storageTextFile, storageWriteRecord, type StorageConfig } from "../utils/storage";
```

Add state:

```ts
const [storageConfig, setStorageConfig] = useState<StorageConfig | null>(null);
```

Load config in an effect:

```ts
useEffect(() => {
  if (!active) return;
  storageGetConfig()
    .then(setStorageConfig)
    .catch((error) => setMessage(`Load data root failed: ${(error as Error).message}`));
}, [active]);
```

- [ ] **Step 2: Add root chooser and storage-based settings export**

Add functions:

```ts
const chooseRoot = async () => {
  const config = await storageChooseRoot();
  if (config) {
    setStorageConfig(config);
    setMessage(`Data root set to ${config.dataRoot}`);
  } else {
    setMessage("Data root selection cancelled.");
  }
};

const exportSettings = async () => {
  const result = await storageWriteRecord({
    dataType: "settings_export",
    name: "settings",
    files: [
      storageMetadataFile({ kind: "settings_export", saved_at: new Date().toISOString(), server_settings_path: path }),
      storageTextFile("settings.json", `${JSON.stringify(settings, null, 2)}\n`),
    ],
  });
  setMessage(`Exported setting file to ${result.path}`);
};
```

Add a readout and button near the existing Settings File readout:

```tsx
<div className="readout">
  <span>Data Root</span>
  <strong>{storageConfig?.dataRoot ?? "Loading..."}</strong>
</div>
```

Add an action:

```tsx
<button className="command" disabled={busy} onClick={() => command("Choose Data Root", chooseRoot)}>
  Choose Data Root
</button>
```

- [ ] **Step 3: Run Settings tests**

Run:

```bash
cd /home/qian/Portable_System_Project/Butterfly_Laser_Driver/tauri_control_console
npm test -- settings.test.ts
```

Expected: existing settings tests pass. If a layout test exists for SettingsPanel, update it to expect `Data Root`.

## Task 5: SpectrumPanel Migration

**Files:**
- Modify: `tauri_control_console/src/components/SpectrumPanel.tsx`
- Modify: `tauri_control_console/src/__tests__/spectrumRecording.test.ts`

- [ ] **Step 1: Replace `saveTextFile` with storage writes**

Change imports:

```ts
import { storageMetadataFile, storageTextFile, storageWriteRecord } from "../utils/storage";
```

Replace `exportCurrentSpectrum` save body with:

```ts
const result = await storageWriteRecord({
  dataType: "spectrum_snapshot",
  name: `spectrum_${spectrum.frame_counter}`,
  files: [
    storageMetadataFile({
      kind: "spectrum_snapshot",
      saved_at: new Date().toISOString(),
      frame_counter: spectrum.frame_counter,
      count: spectrum.count,
      duration_ms: spectrum.duration_ms,
      tz_ohm: tzOhm,
      pd_zero_adc_code: pdZeroAdcCode,
    }),
    storageTextFile(
      "spectrum.csv",
      recordedSpectrumCsv([
        { recordIndex: 0, frameCounter: spectrum.frame_counter, rows: createSpectrumRecordRows(spectrum, 0, tzOhm, pdZeroAdcCode) },
      ]),
    ),
  ],
});
dispatch({ type: "log", message: `Spectrum CSV saved: ${result.path}` });
```

Replace recording saves with:

```ts
const result = await storageWriteRecord({
  dataType: "spectrum_recording",
  name: "spectrum_record",
  files: [
    storageMetadataFile({
      kind: "spectrum_recording",
      saved_at: new Date().toISOString(),
      requested_frames: safeRecordTarget,
      saved_frames: recordState.frames.length,
      refresh_ms: safeRecordRefreshMs,
      tz_ohm: tzOhm,
      pd_zero_adc_code: pdZeroAdcCode,
    }),
    storageTextFile("spectra.csv", recordedSpectrumCsv(recordState.frames)),
  ],
});
dispatch({ type: "log", message: `Spectrum recording saved: ${result.path}` });
```

- [ ] **Step 2: Run Spectrum tests**

Run:

```bash
cd /home/qian/Portable_System_Project/Butterfly_Laser_Driver/tauri_control_console
npm test -- spectrumRecording.test.ts
```

Expected: PASS.

## Task 6: ADA and Lock Panel Migration

**Files:**
- Modify: `tauri_control_console/src/components/AdaPanel.tsx`
- Modify: `tauri_control_console/src/components/LockPanel.tsx`
- Modify: `tauri_control_console/src/__tests__/adaPanelLayout.test.tsx`
- Modify: `tauri_control_console/src/__tests__/lockPanelLayout.test.tsx`

- [ ] **Step 1: Migrate ADA raw save**

In `AdaPanel.tsx`, replace:

```ts
import { saveExperimentBundle } from "../utils/saveText";
```

with:

```ts
import { storageMetadataFile, storageTextFile, storageWriteRecord } from "../utils/storage";
```

Replace `saveExperimentBundle` call in `saveRaw` with:

```ts
const result = await storageWriteRecord({
  dataType: "ada_raw",
  name: safeRunName(rawName, "raw_adc"),
  files: [
    storageMetadataFile({
      event: "raw_adc",
      saved_at: new Date().toISOString(),
      raw_name: rawName,
      raw_median_enabled: rawGlitchEnabled,
      raw_filter_enabled: rawFilterEnabled,
      count: raw.count,
      decim,
      sample_rate_hz: sampleRateHz,
      raw_status: raw.raw_status,
      raw_status_hex: raw.raw_status_hex,
      raw_write_count: raw.raw_write_count,
      requested_length: numberFromInput(rawLength.value),
      monitor_rate_hz: numberFromInput(monitorHz.value),
      glitch_threshold: numberFromInput(threshold.value),
      lp_shift: ada?.filter?.lp_shift,
      raw_lp_shift: numberFromInput(rawLpShift.value),
      raw_storage: raw.storage,
      raw_word_count: raw.word_count,
      tz_ohm: tzOhm,
      pd_zero_adc_code: pdZeroAdcCode,
      ada4355_status: ada,
    }),
    storageTextFile("raw_adc.csv", samplesCsv(raw.samples, sampleRateHz, tzOhm, pdZeroAdcCode)),
  ],
});
setRawMessage(`Saved raw ADC to ${result.path}`);
```

- [ ] **Step 2: Migrate LockPanel save helper**

In `LockPanel.tsx`, replace:

```ts
import { chooseDataDirectory, saveExperimentBundle } from "../utils/saveText";
```

with:

```ts
import { storageMetadataFile, storageTextFile, storageWriteRecord } from "../utils/storage";
```

Remove `recordBaseDir`, `setRecordBaseDir`, and the `chooseDataDirectory` action/UI.

Replace `saveBundle` implementation with:

```ts
const saveBundle = useCallback(
  async ({
    dataType,
    name,
    fallbackName,
    eventKind,
    files,
  }: {
    dataType: "idle_spectrum" | "lock_spectrum_pair" | "monitor_data";
    name: string;
    fallbackName: string;
    eventKind: string;
    files: ExperimentFile[];
  }) => {
    const recordName = safeRunName(name, fallbackName);
    const result = await storageWriteRecord({
      dataType,
      name: recordName,
      files,
    });
    setRecordingMessage(`Saved ${eventKind.replace(/_/g, " ")} to ${result.path}`);
  },
  [],
);
```

Update call sites:

```ts
dataType: "idle_spectrum"
```

for current spectrum and spectrum recording.

```ts
dataType: "lock_spectrum_pair"
```

for lock pair.

```ts
dataType: "monitor_data"
```

for live PD/temperature monitor.

Replace inline metadata file objects with `storageMetadataFile(...)` and CSV file objects with `storageTextFile(...)`.

- [ ] **Step 3: Update layout tests**

Update tests so they no longer expect a Lock save directory picker and do expect storage-backed save buttons to remain visible.

Run:

```bash
cd /home/qian/Portable_System_Project/Butterfly_Laser_Driver/tauri_control_console
npm test -- adaPanelLayout.test.tsx lockPanelLayout.test.tsx lockRecording.test.ts lockSpectrum.test.ts
```

Expected: PASS.

## Task 7: PA Imaging Temporary and Save Workflow

**Files:**
- Modify: `tauri_control_console/src/components/PaImagingPanel.tsx`
- Modify: `tauri_control_console/src/utils/paStreamReceiver.ts`
- Modify: `tauri_control_console/src/__tests__/paImaging.test.ts`
- Modify: `tauri_control_console/src/__tests__/paImagingPanelLayout.test.tsx`

- [ ] **Step 1: Remove editable output path state and use managed temp current path**

In `PaImagingPanel.tsx`, remove:

```ts
const [outputPath, setOutputPath] = useState("/tmp/pa_capture.bin");
```

Import storage helpers:

```ts
import {
  storageCopyFileToPaTmp,
  storageMetadataFile,
  storagePreparePaTmp,
  storageSaveMixedRecord,
} from "../utils/storage";
```

Add state:

```ts
const [paCurrentTmpPath, setPaCurrentTmpPath] = useState("");
const [paCanvasTmpPath, setPaCanvasTmpPath] = useState("");
const [paSaveName, setPaSaveName] = useState("pa_image");
```

In `start`, replace output-path validation with:

```ts
const currentTmp = await storagePreparePaTmp("current");
const resolvedOutputPath = currentTmp.path;
setPaCurrentTmpPath(resolvedOutputPath);
```

Keep `paReceiverStartWithTimeout(backendHost, port, resolvedOutputPath, ...)`.

Change the start message to avoid exposing the editable file path:

```ts
setServerMessage(`PA imaging started, expected ${fmtInt(expectedFrames)} frames.`);
```

- [ ] **Step 2: Persist canvas temp path when setting canvas**

Make `setCurrentPreviewAsCanvas` async through the existing `command` wrapper. The handler copies the current PA legacy bin into `_tmp/pa_image/canvas/legacy.bin` through `storageCopyFileToPaTmp`:

```ts
const setCurrentPreviewAsCanvas = async () => {
  if (!livePreviewImage || !livePreviewReady || !paCurrentTmpPath) return;
  const canvasTmp = await storageCopyFileToPaTmp("canvas", paCurrentTmpPath);
  setPaCanvasTmpPath(canvasTmp.path);
  setCanvasImage(livePreviewImage);
  setCanvasZoom(null);
  setCanvasPixel(null);
  setPreviewRoi(null);
  setPreviewRoiSource(null);
  setPreviewRoiPurpose(null);
  setPreviewRoiScanKey("");
  setPreviewSource("canvas");
  setCanvasMessage(`Canvas set from ${fmtInt(livePreviewImage.frame_count)} live frames.`);
};
```

- [ ] **Step 3: Add PA save buttons**

Add helpers:

```ts
const paImageMetadata = (kind: string, image: PaImageBuildResult | null) => ({
  kind,
  saved_at: new Date().toISOString(),
  frames: image?.frame_count,
  width: image?.width,
  height: image?.height,
  x_start: image?.x_start,
  x_end: image?.x_end,
  y_start: image?.y_start,
  y_end: image?.y_end,
  scan_params: currentParams,
  timing_counts: timingCounts,
  tz_ohm: tzOhm,
  pd_zero_adc_code: pdZeroAdcCode,
});
```

Add actions:

```ts
const saveCurrentPaImage = async () => {
  if (!paCurrentTmpPath) throw new Error("No current PA capture file is available.");
  const result = await storageSaveMixedRecord({
    dataType: "pa_image",
    name: paSaveName,
    textFiles: [storageMetadataFile(paImageMetadata("pa_current", livePreviewImage))],
    sourceFiles: [{ sourcePath: paCurrentTmpPath, targetPath: "legacy.bin" }],
  });
  setServerMessage(`Saved PA current image to ${result.path}`);
};

const saveCanvasPaImage = async () => {
  if (!paCanvasTmpPath) throw new Error("No PA canvas file is available.");
  const result = await storageSaveMixedRecord({
    dataType: "pa_image",
    name: paSaveName,
    textFiles: [storageMetadataFile(paImageMetadata("pa_canvas", canvasImage))],
    sourceFiles: [{ sourcePath: paCanvasTmpPath, targetPath: "legacy.bin" }],
  });
  setCanvasMessage(`Saved PA canvas to ${result.path}`);
};

const saveCurrentAndCanvasPaImage = async () => {
  if (!paCurrentTmpPath) throw new Error("No current PA capture file is available.");
  if (!paCanvasTmpPath) throw new Error("No PA canvas file is available.");
  const result = await storageSaveMixedRecord({
    dataType: "pa_image",
    name: paSaveName,
    textFiles: [
      storageMetadataFile({
        kind: "pa_current_and_canvas",
        saved_at: new Date().toISOString(),
        current: paImageMetadata("pa_current", livePreviewImage),
        canvas: paImageMetadata("pa_canvas", canvasImage),
      }),
    ],
    sourceFiles: [
      { sourcePath: paCurrentTmpPath, targetPath: "current.bin" },
      { sourcePath: paCanvasTmpPath, targetPath: "canvas.bin" },
    ],
  });
  setServerMessage(`Saved PA current and canvas images to ${result.path}`);
};
```

Add UI controls for `paSaveName`, `Save Current`, `Save Canvas`, and `Save Current + Canvas`. The combined save writes `current.bin`, `canvas.bin`, and `metadata.json`.

- [ ] **Step 4: Remove PA output controls**

Remove JSX for:

```tsx
<label>
  Output File
  <input value={outputPath} onChange={(event) => setOutputPath(event.target.value)} />
</label>
```

Remove editable `Estimated Capture Time` and `Expected Frames` fields from the lower main screen. Keep compact read-only progress/status text if already present.

- [ ] **Step 5: Run PA tests**

Run:

```bash
cd /home/qian/Portable_System_Project/Butterfly_Laser_Driver/tauri_control_console
npm test -- paImaging.test.ts paImagingPanelLayout.test.tsx
```

Expected: PASS.

## Task 8: Storage API Cleanup and Static Coverage Guard

**Files:**
- Modify: `tauri_control_console/src/utils/saveText.ts`
- Create: `tauri_control_console/src/__tests__/storageCoverage.test.ts`

- [ ] **Step 1: Narrow `saveText.ts`**

Keep `openTextFile` for loading local settings. Remove `saveExperimentBundle` from runtime imports after panel migrations. Keep `saveTextFile` only if a non-experiment export still needs a manual Save As action; otherwise remove it and its Rust command after all references are gone.

Run:

```bash
cd /home/qian/Portable_System_Project/Butterfly_Laser_Driver
rg -n "saveTextFile\\(|saveExperimentBundle\\(|chooseDataDirectory\\(|Output File|/tmp/pa_capture.bin|Idle_Spectrum|Lock_Spectrum|Live PD Monitor|category: \"Raw\"" tauri_control_console/src tauri_control_console/src-tauri/src
```

Expected: no matches in runtime code, except intentional compatibility declarations if retained and documented.

- [ ] **Step 2: Add a static coverage test**

Create `storageCoverage.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const root = join(__dirname, "..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir)
    .flatMap((name) => {
      const path = join(dir, name);
      if (path.includes("node_modules")) return [];
      const stat = statSync(path);
      if (stat.isDirectory()) return sourceFiles(path);
      return /\\.(ts|tsx)$/.test(name) ? [path] : [];
    });
}

describe("storage coverage", () => {
  it("does not use legacy experiment save helpers in components", () => {
    const text = sourceFiles(root)
      .filter((path) => !path.endsWith("utils/saveText.ts") && !path.endsWith("utils/storage.ts"))
      .map((path) => readFileSync(path, "utf8"))
      .join("\n");

    expect(text).not.toMatch(/saveExperimentBundle\\(/);
    expect(text).not.toMatch(/chooseDataDirectory\\(/);
    expect(text).not.toMatch(/saveTextFile\\(/);
    expect(text).not.toContain("/tmp/pa_capture.bin");
    expect(text).not.toContain("Idle_Spectrum");
    expect(text).not.toContain("Lock_Spectrum");
    expect(text).not.toContain("Live PD Monitor");
  });
});
```

- [ ] **Step 3: Run coverage test**

Run:

```bash
cd /home/qian/Portable_System_Project/Butterfly_Laser_Driver/tauri_control_console
npm test -- storageCoverage.test.ts
```

Expected: PASS.

## Task 9: Full Verification

**Files:**
- No new files.

- [ ] **Step 1: Run TypeScript and frontend tests**

Run:

```bash
cd /home/qian/Portable_System_Project/Butterfly_Laser_Driver/tauri_control_console
npm test
npm run build
```

Expected: all tests pass and Vite build succeeds.

- [ ] **Step 2: Run Rust checks**

Run:

```bash
cd /home/qian/Portable_System_Project/Butterfly_Laser_Driver/tauri_control_console/src-tauri
env -u PKG_CONFIG_PATH -u PKG_CONFIG_SYSROOT_DIR -u CC -u CXX -u AR -u AS -u LD -u STRIP -u RANLIB -u OBJCOPY -u OBJDUMP -u READELF -u CFLAGS -u CXXFLAGS -u LDFLAGS cargo test -- --nocapture
env -u PKG_CONFIG_PATH -u PKG_CONFIG_SYSROOT_DIR -u CC -u CXX -u AR -u AS -u LD -u STRIP -u RANLIB -u OBJCOPY -u OBJDUMP -u READELF -u CFLAGS -u CXXFLAGS -u LDFLAGS cargo check
```

Expected: Rust tests and check pass.

- [ ] **Step 3: Run final static search**

Run:

```bash
cd /home/qian/Portable_System_Project/Butterfly_Laser_Driver
rg -n "saveTextFile\\(|saveExperimentBundle\\(|chooseDataDirectory\\(|Output File|/tmp/pa_capture.bin|Idle_Spectrum|Lock_Spectrum|Live PD Monitor|category: \"Raw\"" tauri_control_console/src tauri_control_console/src-tauri/src
```

Expected: no runtime matches. If a compatibility helper remains in `saveText.ts` or `main.rs`, it must not be imported by panels.

- [ ] **Step 4: Manual Tauri smoke test**

Run:

```bash
cd /home/qian/Portable_System_Project/Butterfly_Laser_Driver/tauri_control_console
env -u PKG_CONFIG_PATH -u PKG_CONFIG_SYSROOT_DIR -u PKG_CONFIG_LIBDIR -u CC -u CXX -u AR -u AS -u LD -u STRIP -u RANLIB -u OBJCOPY -u OBJDUMP -u READELF -u CFLAGS -u CXXFLAGS -u LDFLAGS PATH=/home/qian/.local/nodejs/bin:/home/qian/.cargo/bin:$PATH npm run tauri dev
```

Expected manual checks:

- Settings shows a Data Root and can choose a folder.
- Settings export creates `settings_export/YYYYMMDD/settings_1/settings.json`.
- Spectrum snapshot creates `spectrum_snapshot/YYYYMMDD/.../spectrum.csv`.
- ADA raw save creates `ada_raw/YYYYMMDD/.../raw_adc.csv`.
- Lock saves create only `idle_spectrum`, `lock_spectrum_pair`, or `monitor_data` records.
- PA scan writes current temp data under `_tmp/pa_image/current/legacy.bin`.
- Set Current As Canvas writes `_tmp/pa_image/canvas/legacy.bin`.
- PA save creates `pa_image/YYYYMMDD/<name>_<index>/` with files only.

## Self-Review

- Spec coverage: The plan covers global root, cross-platform Rust paths, no mixed directory levels, Settings export, SpectrumPanel, LockPanel, AdaPanel, PA Image temporary/current/canvas saves, and static coverage checks.
- Type consistency: Storage data type slugs are defined once in frontend and Rust. Rust command names match frontend wrapper names.
- Scope: Server-side configuration files and legacy/milestone artifacts are intentionally not migrated, matching the spec.
