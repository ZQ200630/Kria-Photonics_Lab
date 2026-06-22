# Lock Spectrum Operation Design

## Goal

Redesign the Lock page into a spectrum monitoring and side-fringe lock preparation workspace.

## Spectrum Operation

- Add a `Monitoring On/Off` control.
- Turning monitoring on starts continuous laser fine scan through `/api/laser/fine-scan`.
- Turning monitoring off returns the laser to static output through `/api/laser/static`.
- Static return uses the current scan CH0 code and CH1 start code.
- Provide adjustable controls for:
  - TEC target temperature
  - Scan CH0 code
  - CH1 start code
  - CH1 stop code
- Each control has:
  - Value input
  - Step input
  - Left and right nudge buttons
  - Active visual state
- Keyboard left/right nudges only the active control.
- Keyboard nudging is ignored while an input, textarea, or select has focus.

## Spectrum View

- Show only the relative intensity spectrum.
- Do not show index/time metadata in the Lock spectrum plot.
- Add a draggable horizontal threshold line.
- Mark every crossing between the spectrum and threshold line with crosshair markers.
- Crosshair markers represent candidate lock points.
- In this iteration, markers are visual only. Starting lock still uses the Lock Parameters section.

## Existing Lock Parameters

- Keep existing Lock parameters and actions:
  - Target ADC
  - CH1 bias
  - KP/KI
  - Max step
  - Integral limit
  - Thresholds
  - Polarity
  - Start Lock / Hold Current / Clear Fault

## Non-Goals

- No HDL changes.
- No Python server API changes.
- No automatic lock start from a marker in this iteration.
