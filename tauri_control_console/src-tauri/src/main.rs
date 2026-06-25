use std::{
    fs,
    path::{Path, PathBuf},
};

const DATA_CATEGORY_DIRS: [&str; 4] = ["Idle_Spectrum", "Lock_Spectrum", "Live PD Monitor", "Raw"];

#[derive(serde::Deserialize)]
struct ExperimentFile {
    path: String,
    contents: String,
}

fn default_data_dir() -> Result<PathBuf, String> {
    let mut default_dir = workspace_root_dir();
    default_dir.push("Data");
    fs::create_dir_all(&default_dir).map_err(|err| format!("create {} failed: {}", default_dir.display(), err))?;
    ensure_data_category_dirs(&default_dir)?;
    Ok(default_dir)
}

fn ensure_data_category_dirs(base_dir: &Path) -> Result<(), String> {
    for category in DATA_CATEGORY_DIRS {
        let path = base_dir.join(category);
        fs::create_dir_all(&path).map_err(|err| format!("create {} failed: {}", path.display(), err))?;
    }
    Ok(())
}

fn workspace_root_dir() -> PathBuf {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    manifest_dir
        .parent()
        .and_then(|tauri_console_dir| tauri_console_dir.parent())
        .map(PathBuf::from)
        .unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")))
}

#[tauri::command]
fn save_text_file(filename: String, contents: String) -> Result<Option<String>, String> {
    let safe_name: String = filename
        .chars()
        .map(|ch| match ch {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            ch if ch.is_control() => '_',
            ch => ch,
        })
        .collect();
    let safe_name = if safe_name.trim().is_empty() {
        "butterfly-laser-export.csv".to_string()
    } else {
        safe_name
    };

    let default_dir = default_data_dir()?;

    let Some(path) = rfd::FileDialog::new()
        .set_directory(&default_dir)
        .set_file_name(&safe_name)
        .save_file()
    else {
        return Ok(None);
    };
    fs::write(&path, contents).map_err(|err| format!("write {} failed: {}", path.display(), err))?;
    Ok(Some(path.display().to_string()))
}

#[tauri::command]
fn open_text_file() -> Result<Option<Vec<String>>, String> {
    let default_dir = default_data_dir()?;
    let Some(path) = rfd::FileDialog::new()
        .set_directory(&default_dir)
        .add_filter("JSON settings", &["json"])
        .pick_file()
    else {
        return Ok(None);
    };
    let contents = fs::read_to_string(&path).map_err(|err| format!("read {} failed: {}", path.display(), err))?;
    Ok(Some(vec![path.display().to_string(), contents]))
}

fn safe_component(value: &str, fallback: &str) -> String {
    let cleaned: String = value
        .chars()
        .map(|ch| match ch {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            ch if ch.is_control() => '_',
            ch if ch.is_whitespace() => '_',
            ch => ch,
        })
        .collect();
    let cleaned = cleaned.trim_matches('_');
    if cleaned.is_empty() {
        fallback.to_string()
    } else {
        cleaned.to_string()
    }
}

fn safe_category_component(value: &str, fallback: &str) -> String {
    let cleaned: String = value
        .trim()
        .chars()
        .map(|ch| match ch {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            ch if ch.is_control() => '_',
            ch => ch,
        })
        .collect();
    let cleaned = cleaned.trim_matches('_');
    if cleaned.is_empty() || cleaned == "." || cleaned == ".." {
        fallback.to_string()
    } else {
        cleaned.to_string()
    }
}

fn safe_relative_path(value: &str) -> PathBuf {
    let mut path = PathBuf::new();
    for (index, component) in value.split('/').enumerate() {
        if component.is_empty() || component == "." || component == ".." {
            continue;
        }
        path.push(safe_component(component, if index == 0 { "file" } else { "part" }));
    }
    if path.as_os_str().is_empty() {
        path.push("file.txt");
    }
    path
}

#[tauri::command]
fn choose_data_directory() -> Result<Option<String>, String> {
    let default_dir = default_data_dir()?;
    let Some(path) = rfd::FileDialog::new().set_directory(&default_dir).pick_folder() else {
        return Ok(None);
    };
    Ok(Some(path.display().to_string()))
}

#[tauri::command]
fn save_experiment_bundle(
    base_dir: Option<String>,
    category: Option<String>,
    run_name: String,
    event_name: String,
    files: Vec<ExperimentFile>,
) -> Result<String, String> {
    let mut root = match base_dir {
        Some(path) if !path.trim().is_empty() => PathBuf::from(path),
        _ => default_data_dir()?,
    };
    fs::create_dir_all(&root).map_err(|err| format!("create {} failed: {}", root.display(), err))?;
    ensure_data_category_dirs(&root)?;
    if let Some(category) = category.as_deref().filter(|value| !value.trim().is_empty()) {
        root.push(safe_category_component(category, "Recordings"));
    }
    root.push(safe_component(&run_name, "lock_experiment"));
    root.push(safe_component(&event_name, "lock_event"));
    fs::create_dir_all(&root).map_err(|err| format!("create {} failed: {}", root.display(), err))?;

    for file in files {
        let path = root.join(safe_relative_path(&file.path));
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|err| format!("create {} failed: {}", parent.display(), err))?;
        }
        fs::write(&path, file.contents).map_err(|err| format!("write {} failed: {}", path.display(), err))?;
    }

    Ok(root.display().to_string())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            save_text_file,
            open_text_file,
            choose_data_directory,
            save_experiment_bundle
        ])
        .run(tauri::generate_context!())
        .expect("error while running Butterfly Laser Control");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_data_dir_is_workspace_data_folder() {
        let mut expected = workspace_root_dir();
        expected.push("Data");
        let actual = default_data_dir().expect("default data dir");

        assert_eq!(actual, expected);
        assert_eq!(actual.file_name().and_then(|name| name.to_str()), Some("Data"));
    }

    #[test]
    fn default_data_dir_prepares_named_category_folders() {
        let actual = default_data_dir().expect("default data dir");

        for category in DATA_CATEGORY_DIRS {
            assert!(actual.join(category).is_dir(), "missing {}", category);
        }
    }

    #[test]
    fn category_component_preserves_requested_folder_names() {
        assert_eq!(safe_category_component("Idle_Spectrum", "Raw"), "Idle_Spectrum");
        assert_eq!(safe_category_component("Live PD Monitor", "Raw"), "Live PD Monitor");
        assert_eq!(safe_category_component("../Raw", "Raw"), ".._Raw");
        assert_eq!(safe_category_component("", "Raw"), "Raw");
    }
}
