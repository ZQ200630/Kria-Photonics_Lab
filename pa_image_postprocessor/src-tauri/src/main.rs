use std::{
    collections::HashSet,
    fs,
    path::PathBuf,
    sync::{Arc, Mutex},
};

mod pa_image;

use tauri::Emitter;

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct PaImageBuildProgressEvent {
    request_id: String,
    source_frame_count: u64,
    elapsed_ms: u64,
    image: Option<pa_image::PaImageBuildResult>,
}

#[derive(Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveBinaryFilter {
    name: String,
    extensions: Vec<String>,
}

#[derive(Clone, Default)]
struct PaImageBuildCancelState {
    request_ids: Arc<Mutex<HashSet<String>>>,
}

impl PaImageBuildCancelState {
    fn request_cancel(&self, request_id: &str) {
        self.request_ids
            .lock()
            .expect("PA image build cancel mutex poisoned")
            .insert(request_id.to_string());
    }

    fn clear(&self, request_id: &str) {
        self.request_ids
            .lock()
            .expect("PA image build cancel mutex poisoned")
            .remove(request_id);
    }

    fn is_cancelled(&self, request_id: &str) -> bool {
        self.request_ids
            .lock()
            .expect("PA image build cancel mutex poisoned")
            .contains(request_id)
    }
}

#[tauri::command]
fn save_binary_file(
    default_filename: String,
    contents: Vec<u8>,
    filters: Vec<SaveBinaryFilter>,
) -> Result<Option<String>, String> {
    let mut dialog = rfd::FileDialog::new().set_file_name(default_filename);
    for filter in filters {
        let extensions: Vec<&str> = filter.extensions.iter().map(String::as_str).collect();
        dialog = dialog.add_filter(filter.name, &extensions);
    }
    let Some(path) = dialog.save_file() else {
        return Ok(None);
    };
    fs::write(&path, contents).map_err(|err| format!("write {} failed: {}", path.display(), err))?;
    Ok(Some(path.display().to_string()))
}

#[tauri::command]
fn pa_image_pick_file() -> Result<Option<String>, String> {
    let Some(path) = rfd::FileDialog::new()
        .add_filter("PA legacy bin", &["bin"])
        .pick_file()
    else {
        return Ok(None);
    };
    Ok(Some(path.display().to_string()))
}

#[tauri::command]
fn pa_image_scan_path(path: String) -> Result<pa_image::PaFileSummary, String> {
    pa_image::scan_legacy_file(std::path::Path::new(&path)).map_err(|err| err.to_string())
}

#[tauri::command]
fn pa_image_read_frame_path(
    path: String,
    frame_index: u64,
    tz_ohm: f64,
    vfs: f64,
    zero_adc_code: f64,
) -> Result<pa_image::PaFrameTrace, String> {
    pa_image::read_frame_trace_from_legacy_file(
        std::path::Path::new(&path),
        frame_index,
        tz_ohm,
        vfs,
        zero_adc_code,
    )
    .map_err(|err| err.to_string())
}

#[tauri::command]
async fn pa_image_build_path_streamed(
    app: tauri::AppHandle,
    cancel_state: tauri::State<'_, PaImageBuildCancelState>,
    path: String,
    config: pa_image::PaImageProcessingConfig,
    request_id: String,
    emit_every_source_frames: u64,
    emit_image_every_source_frames: u64,
) -> Result<pa_image::PaImageBuildResult, String> {
    let path_buf = PathBuf::from(path);
    let emit_interval = emit_every_source_frames.max(1);
    let image_emit_interval = if emit_image_every_source_frames == 0 {
        0
    } else {
        emit_image_every_source_frames.max(emit_interval)
    };
    let cancel_state = cancel_state.inner().clone();
    cancel_state.clear(&request_id);
    let cancel_state_for_task = cancel_state.clone();
    let request_id_for_task = request_id.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        pa_image::build_image_from_legacy_file_with_progress(
            &path_buf,
            &config,
            emit_interval,
            image_emit_interval,
            |progress| {
                if cancel_state_for_task.is_cancelled(&request_id_for_task) {
                    return Err("PA image build cancelled".to_string());
                }
                app.emit(
                    "pa-image-build-progress",
                    PaImageBuildProgressEvent {
                        request_id: request_id_for_task.clone(),
                        source_frame_count: progress.source_frame_count,
                        elapsed_ms: progress.elapsed_ms,
                        image: progress.image,
                    },
                )
                .map_err(|err| format!("emit PA image progress failed: {err}"))
            },
        )
    })
    .await
    .map_err(|err| format!("PA image build task failed: {err}"))?;
    cancel_state.clear(&request_id);
    result
}

#[tauri::command]
fn pa_image_cancel_build(
    cancel_state: tauri::State<'_, PaImageBuildCancelState>,
    request_id: String,
) -> Result<(), String> {
    cancel_state.request_cancel(&request_id);
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .manage(PaImageBuildCancelState::default())
        .invoke_handler(tauri::generate_handler![
            save_binary_file,
            pa_image_pick_file,
            pa_image_scan_path,
            pa_image_read_frame_path,
            pa_image_build_path_streamed,
            pa_image_cancel_build,
        ])
        .run(tauri::generate_context!())
        .expect("error while running PA Image Post-Processor");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pa_image_build_cancel_state_tracks_and_clears_request_ids() {
        let state = PaImageBuildCancelState::default();

        assert!(!state.is_cancelled("build-1"));
        state.request_cancel("build-1");
        assert!(state.is_cancelled("build-1"));
        state.clear("build-1");
        assert!(!state.is_cancelled("build-1"));
    }
}
