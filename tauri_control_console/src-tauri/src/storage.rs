use std::{
    collections::HashSet,
    io::ErrorKind,
    fs,
    path::{Path, PathBuf},
};

use tauri::Manager;

pub const DATA_TYPE_DIRS: [&str; 9] = [
    "ada_raw",
    "idle_spectrum",
    "lock_spectrum_pair",
    "monitor_data",
    "pa_image",
    "pa_point_capture",
    "settings_export",
    "spectrum_recording",
    "spectrum_snapshot",
];

pub const PA_TMP_KINDS: [&str; 3] = ["current", "canvas", "point_current"];

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
    let cleaned = if cleaned.is_empty() {
        fallback.to_string()
    } else {
        cleaned.to_string()
    };
    let stem = cleaned.split('.').next().unwrap_or("").to_ascii_uppercase();
    let reserved = matches!(
        stem.as_str(),
        "CON" | "PRN" | "AUX" | "NUL" | "COM1" | "COM2" | "COM3" | "COM4" | "COM5" | "COM6" | "COM7" | "COM8" | "COM9"
            | "LPT1" | "LPT2" | "LPT3" | "LPT4" | "LPT5" | "LPT6" | "LPT7" | "LPT8" | "LPT9"
    );
    if reserved {
        format!("{cleaned}_")
    } else {
        cleaned
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
    let fallback = date_dir
        .parent()
        .and_then(|path| path.file_name())
        .and_then(|name| name.to_str())
        .unwrap_or("record");
    let safe_name = sanitize_component(record_name, fallback);
    let existing: HashSet<String> = fs::read_dir(date_dir)
        .map_err(|err| format!("read {} failed: {}", date_dir.display(), err))?
        .filter_map(|entry| entry.ok())
        .filter_map(|entry| entry.file_name().into_string().ok())
        .map(|name| name.to_ascii_lowercase())
        .collect();
    for index in 1..1_000_000 {
        let candidate = format!("{safe_name}_{index}");
        if !existing.contains(&candidate.to_ascii_lowercase()) {
            let path = date_dir.join(candidate);
            match fs::create_dir(&path) {
                Ok(()) => return Ok(path),
                Err(err) if err.kind() == ErrorKind::AlreadyExists => continue,
                Err(err) => return Err(format!("create {} failed: {}", path.display(), err)),
            }
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

fn config_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let mut dir = app
        .path()
        .app_config_dir()
        .map_err(|err| format!("app config dir failed: {err}"))?;
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
        let config: StorageConfig =
            serde_json::from_str(&contents).map_err(|err| format!("parse {} failed: {}", path.display(), err))?;
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

pub fn configured_data_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let root = load_or_default_root(app)?;
    prepare_root(&root)?;
    Ok(root)
}

fn safe_record_file_name(value: &str, fallback: &str) -> String {
    sanitize_component(value, fallback)
}

fn reserve_record_file_name(seen: &mut HashSet<String>, name: &str) -> Result<(), String> {
    let key = name.to_ascii_lowercase();
    if seen.insert(key) {
        Ok(())
    } else {
        Err(format!("duplicate record file name after sanitizing: {name}"))
    }
}

fn record_dir_at_root(root: &Path, data_type: &str, date_stamp: &str, name: &str) -> Result<(PathBuf, String), String> {
    let data_type = validate_data_type(data_type)?;
    let date_stamp = validate_date_stamp(date_stamp)?;
    prepare_root(root)?;
    let date_dir = root.join(data_type).join(date_stamp);
    let dir = allocate_record_dir(&date_dir, name)?;
    let record_name = dir
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "record folder name is not valid UTF-8".to_string())?
        .to_string();
    Ok((dir, record_name))
}

fn write_record_files(dir: &Path, files: Vec<StorageRecordFile>, seen: &mut HashSet<String>) -> Result<(), String> {
    for file in files {
        let name = safe_record_file_name(&file.path, "file");
        reserve_record_file_name(seen, &name)?;
        let path = dir.join(name);
        fs::write(&path, file.contents).map_err(|err| format!("write {} failed: {}", path.display(), err))?;
    }
    Ok(())
}

fn copy_record_files(dir: &Path, files: Vec<StorageSourceFile>, seen: &mut HashSet<String>) -> Result<(), String> {
    for file in files {
        let source = PathBuf::from(file.source_path);
        let name = safe_record_file_name(&file.target_path, "file");
        reserve_record_file_name(seen, &name)?;
        let target = dir.join(name);
        fs::copy(&source, &target)
            .map_err(|err| format!("copy {} to {} failed: {}", source.display(), target.display(), err))?;
    }
    Ok(())
}

fn record_result(dir: &Path, data_type: &str, date_stamp: &str, record_name: String) -> StorageRecordResult {
    StorageRecordResult {
        path: dir.display().to_string(),
        data_type: data_type.to_string(),
        date_stamp: date_stamp.to_string(),
        record_name,
    }
}

fn write_record_at_root(
    root: &Path,
    data_type: &str,
    date_stamp: &str,
    name: &str,
    files: Vec<StorageRecordFile>,
) -> Result<StorageRecordResult, String> {
    if files.is_empty() {
        return Err("record has no files".to_string());
    }
    let (dir, record_name) = record_dir_at_root(root, data_type, date_stamp, name)?;
    let mut seen = HashSet::new();
    if let Err(err) = write_record_files(&dir, files, &mut seen) {
        let _ = fs::remove_dir_all(&dir);
        return Err(err);
    }
    Ok(record_result(&dir, data_type, date_stamp, record_name))
}

fn copy_record_at_root(
    root: &Path,
    data_type: &str,
    date_stamp: &str,
    name: &str,
    files: Vec<StorageSourceFile>,
) -> Result<StorageRecordResult, String> {
    if files.is_empty() {
        return Err("record has no files".to_string());
    }
    let (dir, record_name) = record_dir_at_root(root, data_type, date_stamp, name)?;
    let mut seen = HashSet::new();
    if let Err(err) = copy_record_files(&dir, files, &mut seen) {
        let _ = fs::remove_dir_all(&dir);
        return Err(err);
    }
    Ok(record_result(&dir, data_type, date_stamp, record_name))
}

fn save_mixed_record_at_root(
    root: &Path,
    data_type: &str,
    date_stamp: &str,
    name: &str,
    record: StorageMixedRecord,
) -> Result<StorageRecordResult, String> {
    if record.text_files.is_empty() && record.source_files.is_empty() {
        return Err("record has no files".to_string());
    }
    let (dir, record_name) = record_dir_at_root(root, data_type, date_stamp, name)?;
    let mut seen = HashSet::new();
    let result = write_record_files(&dir, record.text_files, &mut seen)
        .and_then(|_| copy_record_files(&dir, record.source_files, &mut seen));
    if let Err(err) = result {
        let _ = fs::remove_dir_all(&dir);
        return Err(err);
    }
    Ok(record_result(&dir, data_type, date_stamp, record_name))
}

#[tauri::command]
pub fn storage_write_record(
    app: tauri::AppHandle,
    data_type: String,
    date_stamp: String,
    name: String,
    files: Vec<StorageRecordFile>,
) -> Result<StorageRecordResult, String> {
    let root = load_or_default_root(&app)?;
    write_record_at_root(&root, &data_type, &date_stamp, &name, files)
}

#[tauri::command]
pub fn storage_copy_record(
    app: tauri::AppHandle,
    data_type: String,
    date_stamp: String,
    name: String,
    files: Vec<StorageSourceFile>,
) -> Result<StorageRecordResult, String> {
    let root = load_or_default_root(&app)?;
    copy_record_at_root(&root, &data_type, &date_stamp, &name, files)
}

#[tauri::command]
pub fn storage_save_mixed_record(
    app: tauri::AppHandle,
    data_type: String,
    date_stamp: String,
    name: String,
    record: StorageMixedRecord,
) -> Result<StorageRecordResult, String> {
    let root = load_or_default_root(&app)?;
    save_mixed_record_at_root(&root, &data_type, &date_stamp, &name, record)
}

fn pa_tmp_path_at_root(root: &Path, kind: &str) -> Result<StoragePathResult, String> {
    if !PA_TMP_KINDS.contains(&kind) {
        return Err(format!("unknown PA temp kind: {kind}"));
    }
    prepare_root(root)?;
    let dir = if kind == "point_current" {
        root.join("_tmp").join("pa_point_capture").join("current")
    } else {
        root.join("_tmp").join("pa_image").join(kind)
    };
    fs::create_dir_all(&dir).map_err(|err| format!("create {} failed: {}", dir.display(), err))?;
    let path = dir.join("legacy.bin");
    match fs::symlink_metadata(&path) {
        Ok(metadata) if metadata.is_dir() => {
            fs::remove_dir_all(&path).map_err(|err| format!("remove stale {} failed: {}", path.display(), err))?;
        }
        Ok(_) => {
            fs::remove_file(&path).map_err(|err| format!("remove stale {} failed: {}", path.display(), err))?;
        }
        Err(err) if err.kind() == ErrorKind::NotFound => {}
        Err(err) => return Err(format!("inspect {} failed: {}", path.display(), err)),
    }
    Ok(StoragePathResult {
        path: path.display().to_string(),
    })
}

#[tauri::command]
pub fn storage_prepare_pa_tmp(app: tauri::AppHandle, kind: String) -> Result<StoragePathResult, String> {
    let root = load_or_default_root(&app)?;
    pa_tmp_path_at_root(&root, &kind)
}

#[tauri::command]
pub fn storage_copy_file_to_pa_tmp(
    app: tauri::AppHandle,
    kind: String,
    source_path: String,
) -> Result<StoragePathResult, String> {
    let target = storage_prepare_pa_tmp(app, kind)?;
    fs::copy(&source_path, &target.path)
        .map_err(|err| format!("copy {} to {} failed: {}", source_path, target.path, err))?;
    Ok(target)
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
        assert_eq!(sanitize_component("CON", "fallback"), "CON_");
        assert_eq!(sanitize_component("con.txt", "fallback"), "con.txt_");
        assert_eq!(sanitize_component("LPT1", "fallback"), "LPT1_");
    }

    #[test]
    fn validates_known_data_types() {
        assert_eq!(validate_data_type("pa_image").expect("valid type"), "pa_image");
        assert_eq!(validate_data_type("pa_point_capture").expect("valid type"), "pa_point_capture");
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
    fn allocates_empty_record_names_from_data_type() {
        let root = test_root("allocate_empty");
        let date_dir = root.join("pa_image").join("20260629");
        let allocated = allocate_record_dir(&date_dir, "   ").expect("allocate");
        assert_eq!(allocated.file_name().and_then(|name| name.to_str()), Some("pa_image_1"));
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

    #[test]
    fn writes_text_record_files_flat_under_allocated_record_dir() {
        let root = test_root("write");
        let result = write_record_at_root(
            &root,
            "settings_export",
            "20260629",
            "Settings Export",
            vec![StorageRecordFile {
                path: "nested/settings.json".to_string(),
                contents: "{\"ok\":true}\n".to_string(),
            }],
        )
        .expect("write record");

        assert_eq!(result.data_type, "settings_export");
        assert_eq!(result.date_stamp, "20260629");
        assert_eq!(result.record_name, "Settings_Export_1");
        assert_eq!(
            fs::read_to_string(Path::new(&result.path).join("nested_settings.json")).expect("read written file"),
            "{\"ok\":true}\n"
        );
        assert!(!Path::new(&result.path).join("nested").exists(), "record folder should not contain subdirectories");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn copies_source_files_flat_under_allocated_record_dir() {
        let root = test_root("copy");
        let source = root.join("source.bin");
        fs::write(&source, [1_u8, 2, 3]).expect("write source");

        let result = copy_record_at_root(
            &root,
            "pa_image",
            "20260629",
            "Image",
            vec![StorageSourceFile {
                source_path: source.display().to_string(),
                target_path: "raw/legacy.bin".to_string(),
            }],
        )
        .expect("copy record");

        assert_eq!(fs::read(Path::new(&result.path).join("raw_legacy.bin")).expect("read copied file"), vec![1, 2, 3]);
        assert!(!Path::new(&result.path).join("raw").exists(), "record folder should not contain subdirectories");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn saves_mixed_text_and_source_files_in_one_record_dir() {
        let root = test_root("mixed");
        let source = root.join("trace.csv");
        fs::write(&source, "x,y\n").expect("write source");

        let result = save_mixed_record_at_root(
            &root,
            "spectrum_snapshot",
            "20260629",
            "Snapshot",
            StorageMixedRecord {
                text_files: vec![StorageRecordFile {
                    path: "metadata.json".to_string(),
                    contents: "{}\n".to_string(),
                }],
                source_files: vec![StorageSourceFile {
                    source_path: source.display().to_string(),
                    target_path: "data/trace.csv".to_string(),
                }],
            },
        )
        .expect("save mixed record");

        assert_eq!(fs::read_to_string(Path::new(&result.path).join("metadata.json")).expect("read metadata"), "{}\n");
        assert_eq!(fs::read_to_string(Path::new(&result.path).join("data_trace.csv")).expect("read copy"), "x,y\n");
        assert!(!Path::new(&result.path).join("data").exists(), "record folder should not contain subdirectories");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn mixed_record_save_failure_removes_partial_record_dir() {
        let root = test_root("mixed_fail");
        let result = save_mixed_record_at_root(
            &root,
            "pa_image",
            "20260629",
            "Broken",
            StorageMixedRecord {
                text_files: vec![StorageRecordFile {
                    path: "metadata.json".to_string(),
                    contents: "{}\n".to_string(),
                }],
                source_files: vec![StorageSourceFile {
                    source_path: root.join("missing.bin").display().to_string(),
                    target_path: "legacy.bin".to_string(),
                }],
            },
        );

        assert!(result.is_err());
        let date_dir = root.join("pa_image").join("20260629");
        let leftovers: Vec<_> = fs::read_dir(&date_dir)
            .expect("date dir")
            .filter_map(|entry| entry.ok())
            .collect();
        assert!(leftovers.is_empty(), "failed save should not leave partial record directories");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn prepares_pa_tmp_paths_by_kind() {
        let root = test_root("pa_tmp");
        let result = pa_tmp_path_at_root(&root, "canvas").expect("pa tmp path");
        let path = PathBuf::from(result.path);

        assert_eq!(path.file_name().and_then(|name| name.to_str()), Some("legacy.bin"));
        assert!(path.ends_with(Path::new("_tmp").join("pa_image").join("canvas").join("legacy.bin")));
        assert!(path.parent().expect("parent").is_dir());
        let point = PathBuf::from(pa_tmp_path_at_root(&root, "point_current").expect("point tmp path").path);
        assert!(point.ends_with(Path::new("_tmp").join("pa_point_capture").join("current").join("legacy.bin")));
        assert!(pa_tmp_path_at_root(&root, "latest").is_err());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn preparing_pa_tmp_removes_previous_legacy_file() {
        let root = test_root("pa_tmp_clear");
        let current = pa_tmp_path_at_root(&root, "current").expect("current tmp");
        fs::write(&current.path, "stale").expect("write stale tmp");

        let current_again = pa_tmp_path_at_root(&root, "current").expect("current tmp again");

        assert_eq!(current.path, current_again.path);
        assert!(!Path::new(&current_again.path).exists(), "prepare should clear stale PA tmp legacy.bin");
        let _ = fs::remove_dir_all(root);
    }
}
