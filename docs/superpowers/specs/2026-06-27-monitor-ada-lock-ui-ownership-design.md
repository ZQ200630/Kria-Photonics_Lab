# Monitor, ADA, and Lock UI Ownership Design

## Goal

Reorganize the Tauri console so each page has a clear responsibility:

- `Monitor` is a read-only live overview.
- `ADA` owns ADA4355 hardware and raw ADC acquisition parameters.
- `Lock` owns lock/spectrum monitor behavior.
- `Settings` owns settings file management only.

## Page Responsibilities

### Monitor

`Monitor` replaces the old `Overview` tab and becomes the default tab. It contains no editable fields, no command buttons, and no configuration controls.

It shows three live sections:

- `Temperature Monitor`: latest TEC temperature/target/error and a temperature trend plot.
- `PD Monitor`: latest photodiode monitor current/code, min/max/count, and a PD trend plot.
- `Spectrum Monitor`: latest spectrum/current plot and read-only spectrum metadata.

Spectrum data may be absent when the laser is not scanning. That state is normal and should be shown as idle/stale with muted styling, not as an error.

### ADA

`ADA` owns all ADA4355 hardware settings and raw acquisition settings:

- `PD Current Offset`
- `Gain / Tz`
- `Analog Low-pass`: `1 MHz` and `100 MHz`
- `Raw LP Shift`
- raw length
- raw decimation
- raw capture and save

The ADA page keeps compact readouts that are useful for hardware sanity checks:

- latest PD monitor ADC code/current
- min/max/count
- frame counter
- raw buffer status/capacity

`Spectrum/Monitor LP Shift` moves out of ADA.

### Lock

`Lock` owns the spectrum and live monitor behavior used by lock acquisition:

- `Spectrum/Monitor LP Shift` moves here and is renamed `Live/Spectrum LP Shift`.
- The control is placed near `Spectrum View`, because it changes what the lock/spectrum/live monitor path sees.
- Raw-only settings remain in ADA.

### Settings

`Settings` owns settings file workflow only:

- settings file path
- save current settings to server
- load local settings file
- export settings file
- flattened settings table

`Settings` no longer directly edits ADA4355 current offset, gain/Tz, or analog low-pass.

## Data Flow

The existing global Tz/current offset state stays in `App` so all panels continue to share one conversion state. The visible controls move from `Settings` to `ADA`.

ADA analog controls still call `/api/ada/analog-config` and update global Tz only from server readback.

Current offset remains local Tauri state persisted in `localStorage`, but it is edited from the `ADA` page and passed to ADA/Lock/Monitor/PA image views.

`Live/Spectrum LP Shift` continues to write through the existing `/api/ada/filter` endpoint. Only its UI ownership changes.

## Testing

Update layout tests to enforce ownership:

- App tabs include `Monitor` and not `Overview`.
- Monitor markup contains read-only monitor sections and no editable controls.
- Settings markup no longer contains ADA4355 gain, low-pass, or PD current offset controls.
- ADA markup contains ADA4355 gain, low-pass, PD current offset, raw controls, and raw LP shift.
- Lock markup contains `Live/Spectrum LP Shift`.
- ADA markup no longer contains `Spectrum/Monitor LP Shift`.

Run frontend tests, TypeScript build, Python unit tests affected by defaults/server behavior, Rust tests if command signatures are touched, and `git diff --check`.
