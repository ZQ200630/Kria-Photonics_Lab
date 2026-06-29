# Cross-Platform Data Storage Design

## Context

The control console produces several data types: ADA raw captures, lock spectra, lock spectrum pairs, monitor recordings, PA image captures, and PA image canvas references. These should no longer choose independent save directories. The app needs one user-selected storage root that works on Linux, Windows, and macOS, with predictable subdirectories and file names.

## Goals

- Add one global data root in Settings, chosen with the native file manager.
- Use the global root for every data export path.
- Keep all path creation and file operations cross-platform.
- Avoid any directory that mixes files and folders.
- Keep PA image current/canvas binaries available in a temporary viewing area.
- Let PA image captures be saved later with a user-provided name.
- Remove per-panel save directory controls and PA main output-path controls from the user-facing UI.

## Cross-Platform Rules

All real filesystem work is handled in Tauri Rust code. Rust uses `PathBuf`, `Path`, and `join()` for path construction. Frontend code passes logical data types, names, and operation requests; it does not concatenate platform-specific separators.

The folder picker uses the existing native `rfd::FileDialog` integration. The chosen root is stored as a local upper-computer app setting, not in the FPGA/server setting file, because the server may run on a different machine or filesystem.

If the user has not selected a root, the default root is:

- `Documents/ButterflyLaserData` when the OS provides a documents directory.
- The Tauri app data directory plus `ButterflyLaserData` as fallback.

## Directory Layout

The root contains only data-type folders and the temporary folder:

```text
<DataRoot>/
  _tmp/
  ada_raw/
  idle_spectrum/
  lock_spectrum_pair/
  monitor_data/
  pa_image/
  settings_export/
  spectrum_recording/
  spectrum_snapshot/
```

Each data-type folder contains only date folders:

```text
pa_image/
  20260629/
  20260630/
```

Each date folder contains only record folders:

```text
pa_image/20260629/
  sample_1/
  sample_2/
```

Each record folder contains only files:

```text
pa_image/20260629/sample_1/
  legacy.bin
  metadata.json
```

This means even a single-file save creates a record folder. No directory mixes files and subdirectories.

## Naming and Indexing

User-provided names are sanitized for all target platforms. Characters forbidden by Windows are replaced with `_`:

```text
< > : " / \ | ? *
```

Control characters and leading/trailing dots or spaces are also removed or replaced. Empty names fall back to the data type, such as `pa_image`.

The storage manager allocates record folders as:

```text
<safe_name>_<index>
```

`index` starts at `1`. If `sample_1` already exists, the next save becomes `sample_2`. The collision check is case-insensitive so Windows and macOS behavior is not surprising.

## Temporary PA Image Area

PA image current and canvas files live under the data root temporary area:

```text
<DataRoot>/_tmp/pa_image/current/
  legacy.bin
  metadata.json

<DataRoot>/_tmp/pa_image/canvas/
  legacy.bin
  metadata.json
```

The temporary folders are overwritten by app actions. They are for viewing and reuse, not permanent archival storage.

## PA Image Save Workflow

The PA image panel writes the latest acquisition to `_tmp/pa_image/current/legacy.bin`. When the user sets a canvas, the app copies the corresponding binary to `_tmp/pa_image/canvas/legacy.bin`.

The PA image UI has a save name field and explicit save actions:

- Save Current
- Save Canvas
- Save Current + Canvas

Saved PA image data goes to `pa_image/YYYYMMDD/<name>_<index>/`. `Save Current + Canvas` writes both binaries into the same record folder with metadata.

The main PA Imaging screen no longer shows `Output File`, `Estimated Capture Time`, or `Expected Frames` as editable fields. Estimated time and expected frames may remain visible in compact status/progress text where useful, but not as path/configuration controls.

## Other Data Types

ADA raw saves go to:

```text
ada_raw/YYYYMMDD/<name>_<index>/
  raw.bin
  metadata.json
```

Idle spectrum saves go to:

```text
idle_spectrum/YYYYMMDD/<name>_<index>/
  spectrum.csv
  metadata.json
```

Lock spectrum pairs go to:

```text
lock_spectrum_pair/YYYYMMDD/<name>_<index>/
  reference.csv
  locked.csv
  metadata.json
```

Monitor recordings go to:

```text
monitor_data/YYYYMMDD/<name>_<index>/
  monitor.csv
  metadata.json
```

Future data types add a new top-level data-type folder and reuse the same date-folder and record-folder allocation logic.

General spectrum panel exports go to:

```text
spectrum_snapshot/YYYYMMDD/<name>_<index>/
  spectrum.csv
  metadata.json

spectrum_recording/YYYYMMDD/<name>_<index>/
  spectra.csv
  metadata.json
```

Settings exports go to:

```text
settings_export/YYYYMMDD/<name>_<index>/
  settings.json
  metadata.json
```

## Project-Wide Storage Coverage

The implementation must audit and migrate every current experiment-data save path, not only PA Image. The covered Tauri UI save sources are:

- `SpectrumPanel`: latest spectrum snapshot and spectrum recording.
- `LockPanel`: idle spectrum snapshot, idle spectrum recording, lock spectrum pair, and live PD/temperature monitor recording.
- `AdaPanel`: raw ADC capture save.
- `PaImagingPanel`: PA current capture, PA canvas capture, and saved PA image records.
- `SettingsPanel`: exported settings snapshots. These are configuration records rather than experiment records, but they should still use the same storage manager so exports land under the selected data root.

The Rust/Tauri commands that currently write files or choose save locations must be replaced or narrowed:

- `save_text_file`: no longer used for experiment data; either removed or kept only as a compatibility wrapper around the storage manager.
- `save_experiment_bundle`: replaced by a storage command that always writes `data_type/YYYYMMDD/name_index/`.
- `choose_data_directory`: replaced by global root selection for Settings.
- `pa_receiver_start`: no longer receives an arbitrary UI-edited output path for PA image capture; the caller asks the storage manager for the current PA temporary legacy bin path.

The server-side Python setting file, command line `--settings`, device paths, and FPGA driver paths are not experiment data. They remain server configuration and are not moved into the data root. Legacy web GUI files, milestone archives, generated Vivado reports, and test fixtures are outside the runtime application migration scope.

## Tauri API Shape

The Rust storage manager exposes commands with logical inputs:

- `storage_get_config()`
- `storage_choose_root()`
- `storage_set_root(path)`
- `storage_get_tmp_path(kind)`
- `storage_write_record(dataType, name, files, metadata)`
- `storage_copy_record(dataType, name, sourceFiles, metadata)`

`files` carry logical relative file names like `legacy.bin` or `metadata.json`. The Rust side sanitizes all names, allocates the final record folder, creates directories, writes or copies files, and returns the final path string for UI display/logging.

## Error Handling

If the root does not exist, the app attempts to create it. If creation or writing fails, the UI reports the operation, target data type, and OS error. A save failure does not destroy temporary PA files. If a selected root becomes unavailable, the app prompts the user to choose a new root or retry.

## Testing

Unit tests cover:

- Name sanitization for Windows-forbidden characters.
- Case-insensitive index allocation.
- Directory layout with no mixed file/folder level.
- Default root fallback construction.
- Single-file and multi-file record writes.
- PA temporary path creation.

Frontend tests cover:

- Settings global root display and selection.
- Lock/ADA panels no longer expose independent save directories.
- PA Image save buttons call the storage API with the expected logical data type.
- PA main screen no longer exposes editable output-path controls.

## Non-Goals

This design does not change PA bin parsing, PA image rendering, TCP transport, or the FPGA/server capture protocol. It only centralizes local upper-computer file storage and save UI behavior.
