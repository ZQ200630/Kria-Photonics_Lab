# ADA Raw Glitch And Filter Decoupling Design

## Goal

Raw ADC capture needs two independent raw-path processing controls:

- Raw Glitch: reject isolated spike samples before they enter the raw capture stream.
- Raw Filter: apply the existing raw low-pass filter before samples enter the raw capture stream.

This is needed because rare single-sample spikes appear in raw ADC captures. The operator must be able to remove those spikes without necessarily enabling low-pass smoothing.

## Current Behavior

The AXI ADA4355 Capture IP already has a global glitch reject path and an independent raw low-pass state. However, the raw capture source is selected by a single `raw_use_filtered` control bit:

```text
raw_sample_adc = raw_use_filtered ? raw_filtered_adc_last : adc_data
```

`raw_filtered_adc_last` is derived from the existing filter input sample, so raw glitch rejection and raw low-pass filtering are not independently selectable.

## Design

The raw ADC path will become:

```text
adc_data -> Raw Glitch optional -> Raw LP Filter optional -> Raw Buffer
```

The existing live/spectrum/monitor filtering behavior stays separate:

```text
adc_data -> Global Glitch optional -> Global LP optional -> monitor/spectrum
```

This preserves the recent split between Lock live/spectrum LP shift and ADA raw LP shift.

## Register Interface

Keep the existing `FILTER_CONTROL` register and add one new bit:

- bit 0: global low-pass enable, existing behavior.
- bit 1: global glitch reject enable, existing behavior.
- bit 2: raw low-pass enable/source select, existing `raw_use_filtered` behavior.
- bit 3: spectrum uses filtered data, existing behavior.
- bit 4: monitor uses filtered data, existing behavior.
- bit 5: raw glitch reject enable, new behavior.

No new register address is required. Existing settings files remain compatible.

## HDL Behavior

In `ada4355_capture_core.v`:

- Add `raw_glitch_reject_enable` input.
- Synchronize it into the ADC clock domain alongside the existing filter control bits.
- Maintain raw-path accepted-sample state independent from the global glitch path.
- Compute `raw_glitch_sample_adc`:
  - if raw glitch is enabled and the difference from the last raw accepted sample is greater than `glitch_threshold`, reuse the last raw accepted sample;
  - otherwise accept the current `adc_data`.
- Run the raw low-pass filter from `raw_glitch_sample_adc`.
- Select raw buffer sample with:

```text
raw_sample_adc = raw_use_filtered ? raw_filtered_adc_last : raw_glitch_sample_adc
```

This gives four raw modes:

- Raw Glitch off, Raw Filter off: exact ADC samples.
- Raw Glitch on, Raw Filter off: de-glitched samples without smoothing.
- Raw Glitch off, Raw Filter on: raw LP filtered samples.
- Raw Glitch on, Raw Filter on: de-glitched samples then raw LP filtered samples.

The existing `glitch_reject_counter` remains the global glitch counter. If raw glitch diagnostics are needed later, add a separate raw glitch counter in a follow-up change; it is not required for this task.

## Server And CLI

In `butterfly_laser_control.py`:

- Add `ADA_FILTER_RAW_GLITCH_REJECT = 0x20`.
- Extend `configure_filter(..., raw_glitch_reject=None)`.
- Include `raw_glitch_reject` in `status()["filter"]`.
- Add CLI flags:
  - `--raw-glitch`
  - `--raw-no-glitch`

In `butterfly_laser_server.py` and `butterfly_laser_server_tauri.py`:

- Accept `raw_glitch_reject` in `/api/ada/filter`.
- Preserve partial update behavior: omitted filter fields must not change.
- Keep defaults compatible. Default `filter_control` remains `0x19`, so raw glitch stays off and raw filter stays off unless explicitly enabled.

## Tauri UI

In the ADA page:

- Replace the single raw-path checkbox area with two independent toggles:
  - `Raw Glitch`
  - `Raw Filter`
- Keep `Glitch Threshold`, `Raw LP Shift`, `Raw Length`, and `Raw Decim`.
- `Update Parameters` sends:
  - `raw_glitch_reject`
  - `raw_filtered`
  - `raw_lp_shift`
  - `threshold`
- It must not change `lp_shift`; live/spectrum LP shift remains controlled by the Lock page.

Raw metadata saved from the UI should include:

- `raw_glitch_enabled`
- `raw_filter_enabled`
- `glitch_threshold`
- `raw_lp_shift`

## Tests

Add or update tests to cover:

- Python register constants include `ADA_FILTER_RAW_GLITCH_REJECT`.
- `configure_filter(raw_glitch_reject=True/False)` updates only the new bit and preserves other bits.
- Server `/api/ada/filter` accepts `raw_glitch_reject`.
- Status exposes `filter.raw_glitch_reject`.
- ADA panel markup includes both `Raw Glitch` and `Raw Filter`.
- HDL source contains the new raw glitch enable input/connection and still exposes `RAW_LP_SHIFT`.

## Out Of Scope

- Adding a separate raw glitch reject counter.
- Changing global monitor/spectrum glitch behavior.
- Changing the raw buffer size or URAM implementation.
- Changing the PA imaging pipeline.
