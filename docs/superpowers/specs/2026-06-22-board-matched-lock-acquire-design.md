# Board-Matched Lock Acquire Design

## Objective

Add an incremental, board-side lock acquisition path for side-fringe locking. The existing GUI-based direct lock flow must remain available and unchanged.

The problem is GUI latency: a spectrum shown in the upper computer may be 100 ms to 200 ms old. If the user clicks a side-fringe marker from that old frame and the optical spectrum has drifted, directly locking to that old ADC/code point can immediately lose lock. The new mode lets the upper computer select the desired spectral feature, then lets the board rescan, match that feature in real time, and switch into lock at the matched point.

## Compatibility Requirements

This feature must be additive.

- Keep the current `Start Lock` button and direct marker-click locking behavior working.
- Keep `Update Parameters`, `Hold Current`, and `Clear Lock Fault` behavior unchanged.
- Keep existing laser static output and fine scan paths unchanged.
- Do not change existing AXI register meanings.
- Add new acquire registers, status, backend endpoints, and GUI controls under new names.
- If the new acquire mode is disabled or idle, the system must behave exactly as it does now.

## User Workflow

1. User starts spectrum monitoring / fine scan as today.
2. User selects a green highlighted side-fringe marker in the GUI.
3. GUI stores a template around that marker from the displayed spectrum.
4. User chooses one of two lock actions:
   - `Direct Lock Now`: current behavior, locks immediately from the displayed marker.
   - `Arm Board Match`: new behavior, sends the template and search parameters to the board.
5. Board enters acquire/search mode and performs a new scan.
6. During the scan, board compares live ADC samples against the uploaded template.
7. When match confidence is good enough, board immediately starts side-fringe lock at the live matched point.
8. GUI reports acquire status: `Idle`, `Armed`, `Searching`, `Matched`, `Lock Started`, `Timeout`, or `Failed`.

## Board-Side Matching Strategy

First implementation should use a causal template matcher so the board can lock immediately when it reaches the target point. Avoid requiring future samples after the marker, because that would force the board to scan past the desired lock point before it can decide.

Template from GUI:

- Use a window ending at the selected marker, for example 64 samples before the marker plus the marker sample.
- Store relative shape rather than absolute level where possible.
- Include marker metadata:
  - marker spectrum index
  - marker crossing level
  - expected CH1 code
  - slope direction
  - raw ADC target estimate

Live matching:

Stage 1, candidate gate:

- live ADC crosses target level
- local slope direction matches selected marker
- slope magnitude is above `min_slope`
- live CH1 code is inside configured search range

Stage 2, shape score:

- compare recent live samples against uploaded template
- use normalized values or first differences to reduce baseline drift sensitivity
- accept only if score is below `max_score`

When accepted:

- set `lock_target_adc` from live matched ADC/crossing level
- set `lock_bias_ch1` from live scan CH1 code
- infer and set `polarity_invert` from live slope
- switch to existing lock mode without returning control to Linux first

## Suggested Hardware Placement

Preferred first target: `axi_laser_current_ctrl`.

Reasoning:

- It already controls scan mode and lock mode.
- It already receives `fb_adc_data` and `fb_adc_valid`.
- It knows requested CH0/CH1 codes.
- It can switch from scan to lock without PS/Linux latency.

If the best live ADC stream is only available inside `axi_ada4355_capture`, then a later split design can put the matcher there and emit `auto_lock_request` to `axi_laser_current_ctrl`. For the first version, keep the state machine close to laser current control unless signal availability proves otherwise.

## New AXI/Register Surface

Add new registers without changing existing offsets. Exact offsets can be assigned after checking free space in `axi_laser_current_ctrl`.

Control:

- `ACQUIRE_CONTROL`
  - `enable`
  - `arm`
  - `cancel`
  - `clear_status`
  - `auto_lock_enable`
  - `forward_only`

Status:

- `ACQUIRE_STATUS`
  - `idle`
  - `armed`
  - `searching`
  - `matched`
  - `lock_started`
  - `timeout`
  - `range_ok`
  - `slope_ok`
  - `score_ok`
  - `template_loaded`

Configuration:

- `ACQUIRE_TARGET`
  - target raw ADC or target level
- `ACQUIRE_EXPECTED_CODE`
  - expected CH1 code from selected marker
- `ACQUIRE_SEARCH_RANGE`
  - CH1 min/max
- `ACQUIRE_THRESHOLDS`
  - max score
  - min slope
- `ACQUIRE_TIMEOUT`
  - max frames or scan ticks before failure
- `ACQUIRE_TEMPLATE_LENGTH`
  - template length, first version fixed at 64 or 65 samples is acceptable

Results:

- `ACQUIRE_MATCH_ADC`
- `ACQUIRE_MATCH_CH1_CODE`
- `ACQUIRE_MATCH_SCORE`
- `ACQUIRE_MATCH_FRAME`
- `ACQUIRE_DEBUG`

Template storage:

- Prefer a small template RAM if convenient.
- A first version can use 64 AXI writable registers if that is faster to integrate.

## Backend API

Add endpoints while keeping existing endpoints unchanged:

- `POST /api/laser/acquire-template`
  - uploads template, target metadata, search range, thresholds
- `POST /api/laser/acquire-arm`
  - arms board-side matching and starts/continues scan as configured
- `POST /api/laser/acquire-cancel`
  - cancels acquire and returns to safe static or previous mode
- `GET /api/status`
  - include acquire status/result under `laser.acquire`

Existing endpoints remain:

- `/api/laser/lock-start`
- `/api/laser/lock-params`
- `/api/laser/fine-scan`
- `/api/laser/static`

## GUI Changes

Add a new section in the Lock page called `Board-Matched Acquire`.

When user clicks a highlighted marker:

- keep current direct marker lock available
- create a selected acquire template
- show:
  - selected index
  - expected CH1 code
  - target ADC
  - auto polarity
  - template length
  - search halfspan

Actions:

- `Direct Lock Now`
  - current behavior
- `Arm Board Match`
  - uploads template and arms board-side acquire
- `Cancel Acquire`
  - stops acquire without affecting normal lock parameters

Display:

- acquire state
- match score
- matched CH1 code
- matched ADC
- timeout/failure flags

## Safety Behavior

The acquire mode must be conservative:

- If no good match occurs before timeout, do not lock.
- If fault is latched, do not arm.
- If TEC/laser safety status is invalid, do not arm.
- If CH1 match is outside configured search range, do not lock.
- If slope is too small, do not lock.
- If score is poor, do not lock.
- Cancel must return to a safe existing state and not alter direct lock behavior.

## Implementation Phasing

Phase 1, GUI/backend preparation:

- Add data structures for selected template and acquire status.
- Add GUI controls but keep them disabled until backend/HDL support is present.
- Add tests for template extraction and marker metadata.

Phase 2, backend register support:

- Add Python register definitions and acquire API endpoints.
- Read acquire status/result into `/api/status`.

Phase 3, HDL acquire state machine:

- Add acquire registers and template storage.
- Implement candidate gate and causal shape score.
- Add simulation tests.

Phase 4, integration:

- Enable GUI controls.
- Verify direct lock still works.
- Verify board-matched acquire locks from a fresh scan.

## Non-Goals For First Version

- No fully autonomous repeated relock loop.
- No Linux-side real-time matcher.
- No replacement of direct lock.
- No advanced full cross-correlation unless simple causal score is insufficient.

