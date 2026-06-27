# ADA4355 Analog Settings and Current Conversion Design

## Goal

Centralize ADA4355 analog gain, low-pass filter, and photodiode current bias settings so every ADA-derived view uses consistent conversion settings. This includes ADA raw capture, spectrum, lock/live PD monitor, PA image offline parsing, and PA image live parsing.

## Decisions

- The hardware `gain_ohms` sysfs value is the single source of truth for Tz.
- Supported Tz values are `2000`, `20000`, and `200000` ohms.
- The hardware `low_pass_enabled` sysfs value controls the analog low-pass filter.
- Low-pass UI labels are `1 MHz` when enabled and `100 MHz` when disabled.
- Settings owns the editable Tz, analog low-pass, and current bias controls.
- Other panels may show the active Tz/current bias, but they do not edit Tz locally.
- PA image samples remain interpreted as signed little-endian i16 for voltage conversion.
- ADA raw/spectrum/lock keep the existing unsigned ADC code conversion unless separately verified later.
- Current conversion uses the shared formula `current_uA = ((0.825 - vadc) / tz_ohm) * 1e6 - current_offset_uA`.

## Server API

Add two endpoints:

- `GET /api/ada/analog-config`
- `POST /api/ada/analog-config`

The response shape is stable:

```json
{
  "ok": true,
  "analog": {
    "available": true,
    "gain_ohms": 2000,
    "low_pass_enabled": false,
    "low_pass_label": "100 MHz",
    "allowed_gain_ohms": [2000, 20000, 200000],
    "allowed_low_pass": [
      { "label": "1 MHz", "enabled": true },
      { "label": "100 MHz", "enabled": false }
    ],
    "sysfs_dir": "/sys/bus/platform/devices/ada4355-gpio-ctrl"
  }
}
```

`POST` accepts `gain_ohms` and/or `low_pass_enabled`, validates them, writes sysfs, then reads back and returns the same response shape. If sysfs is not available, the endpoint returns a clear unavailable/error message instead of silently changing UI state.

The sysfs files are:

- `/sys/bus/platform/devices/ada4355-gpio-ctrl/gain_ohms`
- `/sys/bus/platform/devices/ada4355-gpio-ctrl/low_pass_enabled`

Tests use an overrideable sysfs directory so they never write real `/sys`.

## Tauri UI

Settings adds an ADA4355 analog section with:

- Tz/Gain segmented control: `2 kOhm`, `20 kOhm`, `200 kOhm`.
- Analog low-pass segmented control: `1 MHz`, `100 MHz`.
- Existing current bias input remains in Settings.

On Settings load, Tauri reads `/api/ada/analog-config`; if available, the readback `gain_ohms` updates the global `tzOhm`. On user changes, Tauri posts to the server and only updates global Tz/low-pass state from server readback.

ADA raw, spectrum, lock, and PA image receive the global Tz/current bias as props. Local Tz inputs are removed from these panels to prevent format mismatch.

## PA Image Conversion

PA image bin parsing keeps the legacy binary format:

- axis block header: unchanged
- frame header: unchanged
- metadata: unchanged
- samples: signed little-endian i16 for voltage conversion

The Rust PA processing config adds `current_offset_ua`. Existing fields keep their snake_case names. Offline trace reading, offline image build, and live image accumulation all use the same config.

The current offset changes absolute trace current. It should cancel out of baseline-subtracted PTP values, but including it keeps trace display, live processing, and saved metadata consistent.

## Validation

- Server tests cover valid/invalid gain values, low-pass values, sysfs readback, and missing sysfs.
- TypeScript tests cover ADA analog config typing, Settings readback state, and removal of local Tz editing.
- PA image TypeScript and Rust tests cover signed voltage conversion with shared current offset.
- Final verification runs frontend tests, Rust tests, and Python server tests where available.
