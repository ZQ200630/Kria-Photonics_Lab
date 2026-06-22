# Spectrum Overview CSV Design

## Goal

Make the Overview spectrum panel the only spectrum UI. It should be clean for live monitoring, support one-click export of the current spectrum, and support local continuous CSV recording for a fixed number of frames.

## UI Scope

- Remove the standalone Spectrum tab/page from the Tauri app.
- In Overview, keep one spectrum plot that shows relative intensity only.
- Do not show frame number, duration, lock target ADC, scan CH1 start/stop, or other scan metadata in the panel header.
- Do not provide any locking action or lock-point selection from the Overview spectrum plot.
- Move Y axis controls below the plot:
  - Auto scale checkbox
  - Y min input
  - Y max input
- Add CSV controls below the plot:
  - Export Current Spectrum CSV
  - Frames to Record
  - Record Refresh ms
  - Start Recording CSV
  - Stop Recording
  - Recording progress text
- Do not provide a manual fetch button in Overview. Spectrum data should update through the live SSE stream.

## CSV Behavior

- Export Current Spectrum CSV downloads the latest spectrum currently held in GUI state.
- Continuous recording runs in the GUI process, using incoming SSE spectrum events already received from the K26 server.
- Recording only appends a frame when the incoming `frame_counter` changes.
- Recording obeys `Record Refresh ms`; frames arriving sooner than that interval are skipped.
- Recording stops automatically after `Frames to Record` unique frames and downloads one CSV file.
- Stop Recording stops without automatic download if no frames were collected; otherwise it downloads the partial CSV.

## CSV Columns

Each row represents one spectrum point:

- `record_index`
- `frame_counter`
- `point_index`
- `time_ms`
- `relative_intensity`
- `raw_adc`

## Non-Goals

- No server-side CSV recording.
- No K26 filesystem writes for recorded spectrum data.
- No changes to ADA4355 HDL or Python server API for this UI change.
