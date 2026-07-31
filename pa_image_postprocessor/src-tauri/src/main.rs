use std::{
    collections::HashSet,
    fs,
    path::PathBuf,
    sync::{Arc, Mutex},
};

mod classical_orpam;
mod classical_orpam_qc;
mod npy;
mod pa_image;
mod scientific_plot;

use tauri::{Emitter, Manager};

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct PaImageBuildProgressEvent {
    request_id: String,
    source_frame_count: u64,
    elapsed_ms: u64,
    image: Option<pa_image::PaImageBuildResult>,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ClassicalOrpamProgressEvent {
    request_id: String,
    source_frame_count: u64,
    valid_frame_count: u64,
    completed_rows: usize,
    total_rows: usize,
    elapsed_ms: u64,
    estimated_remaining_ms: Option<u64>,
    stage: String,
    warning_count: usize,
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


#[derive(Clone, Default)]
struct ClassicalOrpamCancelState {
    request_ids: Arc<Mutex<HashSet<String>>>,
}

impl ClassicalOrpamCancelState {
    fn request_cancel(&self, request_id: &str) {
        self.request_ids
            .lock()
            .expect("classical OR-PAM cancel mutex poisoned")
            .insert(request_id.to_string());
    }

    fn clear(&self, request_id: &str) {
        self.request_ids
            .lock()
            .expect("classical OR-PAM cancel mutex poisoned")
            .remove(request_id);
    }

    fn is_cancelled(&self, request_id: &str) -> bool {
        self.request_ids
            .lock()
            .expect("classical OR-PAM cancel mutex poisoned")
            .contains(request_id)
    }
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
fn pa_classical_load_adjacent_metadata(path: String) -> Result<Option<serde_json::Value>, String> {
    let source = PathBuf::from(path);
    let Some(parent) = source.parent() else {
        return Ok(None);
    };
    let metadata_path = parent.join("metadata.json");
    if !metadata_path.exists() {
        return Ok(None);
    }
    let contents = fs::read_to_string(&metadata_path)
        .map_err(|err| format!("read {} failed: {err}", metadata_path.display()))?;
    serde_json::from_str(&contents)
        .map(Some)
        .map_err(|err| format!("parse {} failed: {err}", metadata_path.display()))
}
#[tauri::command]
fn pa_classical_pick_output_directory() -> Result<Option<String>, String> {
    Ok(rfd::FileDialog::new()
        .pick_folder()
        .map(|path| path.display().to_string()))
}

#[tauri::command]
fn pa_classical_load_pixel_traces(
    path: String,
    frame_index: u64,
    config: classical_orpam::ClassicalOrpamConfig,
) -> Result<classical_orpam::ClassicalAlineView, String> {
    classical_orpam::process_classical_aline(
        std::path::Path::new(&path),
        frame_index,
        &config,
    )
}

#[tauri::command]
async fn pa_classical_reconstruct_path_streamed(
    app: tauri::AppHandle,
    cancel_state: tauri::State<'_, ClassicalOrpamCancelState>,
    path: String,
    output_directory: String,
    config: classical_orpam::ClassicalOrpamConfig,
    request_id: String,
) -> Result<classical_orpam::ClassicalOrpamResult, String> {
    let request = classical_orpam::ClassicalOrpamRequest {
        input_path: PathBuf::from(path),
        output_directory: PathBuf::from(output_directory),
        config,
        request_id: request_id.clone(),
    };
    let cancel_state = cancel_state.inner().clone();
    cancel_state.clear(&request_id);
    let cancel_for_task = cancel_state.clone();
    let request_id_for_task = request_id.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        classical_orpam::reconstruct_classical_orpam(
            &request,
            |progress| {
                app.emit(
                    "pa-classical-progress",
                    ClassicalOrpamProgressEvent {
                        request_id: request_id_for_task.clone(),
                        source_frame_count: progress.source_frame_count,
                        valid_frame_count: progress.valid_frame_count,
                        completed_rows: progress.completed_rows,
                        total_rows: progress.total_rows,
                        elapsed_ms: progress.elapsed_ms,
                        estimated_remaining_ms: progress.estimated_remaining_ms,
                        stage: progress.stage,
                        warning_count: progress.warning_count,
                    },
                )
                .map_err(|err| format!("emit classical OR-PAM progress failed: {err}"))
            },
            || cancel_for_task.is_cancelled(&request_id_for_task),
        )
    })
    .await
    .map_err(|err| format!("classical OR-PAM task failed: {err}"))?;
    cancel_state.clear(&request_id);
    result
}

#[tauri::command]
fn pa_classical_cancel_reconstruction(
    cancel_state: tauri::State<'_, ClassicalOrpamCancelState>,
    request_id: String,
) -> Result<(), String> {
    cancel_state.request_cancel(&request_id);
    Ok(())
}

#[tauri::command]
fn pa_classical_load_volume_slice(
    envelope_path: String,
    data_offset: u64,
    shape_yxz: [usize; 3],
    view: String,
    slice_index: usize,
    x_range_um: [f64; 2],
    y_range_um: [f64; 2],
    z_range_um: [f64; 2],
) -> Result<classical_orpam::ClassicalVolumeSlice, String> {
    classical_orpam::load_classical_volume_slice(
        std::path::Path::new(&envelope_path),
        data_offset,
        shape_yxz,
        &view,
        slice_index,
        x_range_um,
        y_range_um,
        z_range_um,
    )
}
#[tauri::command]
async fn pa_classical_render_scientific_aline(
    app: tauri::AppHandle,
    request: scientific_plot::ScientificAlinePlotRequest,
) -> Result<Vec<u8>, String> {
    let bundled_path = || -> Result<std::path::PathBuf, String> {
        Ok(app
            .path()
            .resource_dir()
            .map_err(|err| format!("resolve application resource directory failed: {err}"))?
            .join("python")
            .join("scientific_aline_plot.py"))
    };
    #[cfg(debug_assertions)]
    let script_path = {
        let development_path = scientific_plot::development_script_path();
        if development_path.is_file() {
            development_path
        } else {
            bundled_path()?
        }
    };
    #[cfg(not(debug_assertions))]
    let script_path = bundled_path()?;
    tauri::async_runtime::spawn_blocking(move || {
        scientific_plot::render_scientific_aline_png(&request, &script_path)
    })
    .await
    .map_err(|err| format!("Python scientific rendering task failed: {err}"))?
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
        .manage(ClassicalOrpamCancelState::default())
        .invoke_handler(tauri::generate_handler![
            save_binary_file,
            pa_image_pick_file,
            pa_image_scan_path,
            pa_image_read_frame_path,
            pa_image_build_path_streamed,
            pa_image_cancel_build,
            pa_classical_load_adjacent_metadata,
            pa_classical_pick_output_directory,
            pa_classical_load_pixel_traces,
            pa_classical_reconstruct_path_streamed,
            pa_classical_cancel_reconstruction,
            pa_classical_load_volume_slice,
            pa_classical_render_scientific_aline,
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
