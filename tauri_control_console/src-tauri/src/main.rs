use std::{fs, path::PathBuf};

#[tauri::command]
fn save_text_file(filename: String, contents: String) -> Result<String, String> {
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

    let mut dir = std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| std::env::current_dir().unwrap_or_else(|_| PathBuf::from(".")));
    dir.push("Butterfly_Laser_Data");
    fs::create_dir_all(&dir).map_err(|err| format!("create {} failed: {}", dir.display(), err))?;

    let path = dir.join(safe_name);
    fs::write(&path, contents).map_err(|err| format!("write {} failed: {}", path.display(), err))?;
    Ok(path.display().to_string())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![save_text_file])
        .run(tauri::generate_context!())
        .expect("error while running Butterfly Laser Control");
}
