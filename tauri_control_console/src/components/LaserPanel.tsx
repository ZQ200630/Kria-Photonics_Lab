import type { PanelProps } from "./types";
import { fmtInt, fmtNumber, inputInt, inputNumber, parseNumber } from "../utils/format";
import { useSyncedInput } from "../utils/syncedInput";
import { classifyLaserStatus, laserModeEditability, scanFrequencyHz, scanTicksForFrequency, type LaserStatusSummary } from "../utils/laser";

type ModeSelection = "static" | "scan";

function StatusLamp({ status, compact = false }: { status: LaserStatusSummary; compact?: boolean }) {
  return (
    <div className={`output-status-indicator ${compact ? "compact" : ""}`}>
      <span className={`status-light ${status.level}`} />
      <div>
        <strong>{status.label}</strong>
        {!compact && <span>{status.detail}</span>}
      </div>
    </div>
  );
}

function Metric({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="tec-metric">
      <span>{label}</span>
      <strong>{value}</strong>
      {detail && <em>{detail}</em>}
    </div>
  );
}

function ModeMetric({ label, value, detail, active = false }: { label: string; value: string; detail?: string; active?: boolean }) {
  return (
    <div className={`tec-metric mode-metric ${active ? "active" : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      {detail && <em>{detail}</em>}
    </div>
  );
}

function Field({ label, input, disabled = false }: { label: string; input: ReturnType<typeof useSyncedInput>; disabled?: boolean }) {
  return (
    <label className={disabled ? "field-disabled" : ""}>
      {label}
      <input {...input.bind} disabled={disabled} />
    </label>
  );
}

function numberFromInput(value: string): number {
  const parsed = parseNumber(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function modeFromStatus(status: LaserStatusSummary): ModeSelection {
  if (status.mode === "scan") return "scan";
  return "static";
}

export default function LaserPanel({ state, client, command, compact = false }: PanelProps) {
  const laser = state.lastStatus?.laser;
  const status = classifyLaserStatus(laser);
  const laserOutputOn = status.mode === "static" || status.mode === "scan" || status.mode === "lock";

  const mode = useSyncedInput(modeFromStatus(status), "static");
  const staticCh0 = useSyncedInput(inputInt(laser?.static_setpoint?.ch0_internal), "26000");
  const staticCh1 = useSyncedInput(inputInt(laser?.static_setpoint?.ch1_internal), "0");
  const scanCh0 = useSyncedInput(inputInt(laser?.fine_scan_setpoint?.ch0_internal), "26000");
  const scanStart = useSyncedInput(inputInt(laser?.fine_scan_setpoint?.ch1_start_internal), "20000");
  const scanStop = useSyncedInput(inputInt(laser?.fine_scan_setpoint?.ch1_stop_internal), "30000");
  const scanStep = useSyncedInput(inputInt(laser?.fine_scan_setpoint?.ch1_step_internal), "10");
  const dwell = useSyncedInput(inputInt(laser?.fine_scan_setpoint?.dwell_ticks), "100");
  const settle = useSyncedInput(inputInt(laser?.fine_scan_setpoint?.settle_ticks), "100");
  const frames = useSyncedInput(inputInt(laser?.fine_scan_setpoint?.frames), "1");
  const ch0Max = useSyncedInput(inputInt(laser?.safety?.ch0_max), "40000");
  const ch1Max = useSyncedInput(inputInt(laser?.safety?.ch1_max), "50000");
  const editability = laserModeEditability(mode.value as ModeSelection, status.mode);
  const controlsLocked = status.mode === "lock";

  const scanRateReadback = scanFrequencyHz({
    start: laser?.fine_scan_setpoint?.ch1_start_internal ?? 0,
    stop: laser?.fine_scan_setpoint?.ch1_stop_internal ?? 0,
    step: laser?.fine_scan_setpoint?.ch1_step_internal ?? 0,
    dwell: laser?.fine_scan_setpoint?.dwell_ticks ?? 0,
    settle: laser?.fine_scan_setpoint?.settle_ticks ?? 0,
  });
  const scanRateInput = useSyncedInput(inputNumber(scanRateReadback, 3), "50.000");

  const scanRateDraft = scanFrequencyHz({
    start: numberFromInput(scanStart.value),
    stop: numberFromInput(scanStop.value),
    step: numberFromInput(scanStep.value),
    dwell: numberFromInput(dwell.value),
    settle: numberFromInput(settle.value),
  });

  const safety = () => ({
    ch0_min: 0,
    ch0_max: numberFromInput(ch0Max.value),
    ch1_min: 0,
    ch1_max: numberFromInput(ch1Max.value),
  });

  const releaseDrafts = () => {
    mode.release();
    staticCh0.release();
    staticCh1.release();
    scanCh0.release();
    scanStart.release();
    scanStop.release();
    scanStep.release();
    dwell.release();
    settle.release();
    frames.release();
    ch0Max.release();
    ch1Max.release();
    scanRateInput.release();
  };

  const applyScanFrequency = () => {
    const ticks = scanTicksForFrequency({
      start: numberFromInput(scanStart.value),
      stop: numberFromInput(scanStop.value),
      step: numberFromInput(scanStep.value),
      frequencyHz: Number(scanRateInput.value),
    });
    dwell.setDraftValue(String(ticks));
    settle.setDraftValue(String(ticks));
  };

  const startStatic = async () => {
    await client.post("/api/laser/static", {
      ch0: numberFromInput(staticCh0.value),
      ch1: numberFromInput(staticCh1.value),
      ...safety(),
    });
    releaseDrafts();
  };

  const startScan = async () => {
    await client.post("/api/laser/fine-scan", {
      ch0: numberFromInput(scanCh0.value),
      start: numberFromInput(scanStart.value),
      stop: numberFromInput(scanStop.value),
      step: numberFromInput(scanStep.value),
      dwell: numberFromInput(dwell.value),
      settle: numberFromInput(settle.value),
      frames: numberFromInput(frames.value),
      continuous: true,
      ...safety(),
    });
    releaseDrafts();
  };

  const applySelectedMode = () => {
    if (mode.value === "scan") return startScan();
    return startStatic();
  };

  const toggleLaser = () => {
    if (laserOutputOn) return client.post("/api/laser/off");
    return applySelectedMode();
  };

  const selectedModeLabel = mode.value === "scan" ? "Start Scan" : "Apply Static";

  const overviewMetrics = () => {
    if (status.mode === "scan") {
      return (
        <>
          <Metric label="CH0" value={fmtInt(laser?.fine_scan_setpoint?.ch0_internal)} detail={`${fmtNumber(laser?.fine_scan_setpoint?.ch0_current_mA, 3)} mA`} />
          <Metric
            label="CH1 Sweep"
            value={`${fmtInt(laser?.fine_scan_setpoint?.ch1_start_internal)} -> ${fmtInt(laser?.fine_scan_setpoint?.ch1_stop_internal)}`}
            detail={`${fmtNumber(laser?.fine_scan_setpoint?.ch1_start_current_mA, 4)} -> ${fmtNumber(laser?.fine_scan_setpoint?.ch1_stop_current_mA, 4)} mA`}
          />
          <Metric label="Scan Rate" value={`${fmtNumber(scanRateReadback, 3)} Hz`} detail="forward spectrum rate" />
        </>
      );
    }
    if (status.mode === "lock") {
      return (
        <>
          <Metric label="CH0" value={fmtInt(laser?.static_setpoint?.ch0_internal)} detail={`${fmtNumber(laser?.static_setpoint?.ch0_current_mA, 3)} mA`} />
          <Metric label="Lock CH1" value={fmtInt(laser?.lock?.output_ch1_internal)} detail={`${fmtNumber(laser?.lock?.output_ch1_current_mA, 4)} mA`} />
          <Metric label="Target / Error" value={`${fmtInt(laser?.lock?.target_adc)} / ${fmtInt(laser?.lock?.error)}`} />
        </>
      );
    }
    return (
      <>
        <Metric label="Actual CH0" value={fmtInt(laser?.actual?.ch0_internal)} detail={`${fmtNumber(laser?.actual?.ch0_current_mA, 3)} mA`} />
        <Metric label="Actual CH1" value={fmtInt(laser?.actual?.ch1_internal)} detail={`${fmtNumber(laser?.actual?.ch1_current_mA, 4)} mA`} />
        <Metric label="Target" value={`${fmtInt(laser?.target?.ch0_internal)} / ${fmtInt(laser?.target?.ch1_internal)}`} />
      </>
    );
  };

  const controls = (
    <div className="laser-controls">
      <label>
        Mode
        <select {...mode.bind}>
          <option value="static">Static Output</option>
          <option value="scan">Scanning</option>
        </select>
      </label>
      <button className={`command laser-power ${laserOutputOn ? "laser-on" : "laser-off"}`} onClick={() => command(laserOutputOn ? "Laser Off" : "Laser On", toggleLaser)}>
        {laserOutputOn ? "Laser On" : "Laser Off"}
      </button>
      <button className="command primary" onClick={() => command(selectedModeLabel, applySelectedMode)}>
        {selectedModeLabel}
      </button>
    </div>
  );

  if (compact) {
    return (
      <section className="panel laser-panel laser-overview-panel">
        <div className="panel-title-row">
          <h2>Laser Output</h2>
          <StatusLamp status={status} compact />
        </div>
        <div className="laser-overview-metrics">{overviewMetrics()}</div>
        {controls}
      </section>
    );
  }

  return (
    <section className="panel laser-panel laser-detail-panel">
      <div className="panel-title-row">
        <h2>Laser Output</h2>
        <StatusLamp status={status} />
      </div>

      <div className="laser-detail-layout">
        <div className="laser-monitor-column">
          <div className="laser-hero">
            <span>Output Mode</span>
            <strong>{status.label}</strong>
            <div>
              <span>Target CH0 {fmtInt(laser?.target?.ch0_internal)}</span>
              <span>Target CH1 {fmtInt(laser?.target?.ch1_internal)}</span>
              <span>PD {fmtInt(state.lastStatus?.ada4355.monitor_avg)}</span>
            </div>
          </div>

          <div className="laser-mode-summary">
            <ModeMetric
              label="Static Target CH0"
              value={fmtInt(laser?.static_setpoint?.ch0_internal)}
              detail={`${fmtNumber(laser?.static_setpoint?.ch0_current_mA, 3)} mA`}
              active={status.mode === "static"}
            />
            <ModeMetric
              label="Static Target CH1"
              value={fmtInt(laser?.static_setpoint?.ch1_internal)}
              detail={`${fmtNumber(laser?.static_setpoint?.ch1_current_mA, 4)} mA`}
              active={status.mode === "static"}
            />
          </div>

          <div className="laser-mode-summary scan">
            <ModeMetric label="Scan CH0" value={fmtInt(laser?.fine_scan_setpoint?.ch0_internal)} active={status.mode === "scan"} />
            <ModeMetric label="CH1 Start" value={fmtInt(laser?.fine_scan_setpoint?.ch1_start_internal)} active={status.mode === "scan"} />
            <ModeMetric label="CH1 Stop" value={fmtInt(laser?.fine_scan_setpoint?.ch1_stop_internal)} active={status.mode === "scan"} />
            <ModeMetric label="Scan Rate" value={`${fmtNumber(scanRateReadback, 3)} Hz`} detail="forward spectrum rate" active={status.mode === "scan"} />
          </div>

          <div className="laser-mode-summary">
            <ModeMetric label="Lock CH1 Output" value={fmtInt(laser?.lock?.output_ch1_internal)} detail={`${fmtNumber(laser?.lock?.output_ch1_current_mA, 4)} mA`} active={status.mode === "lock"} />
            <ModeMetric label="Lock Target / Error" value={`${fmtInt(laser?.lock?.target_adc)} / ${fmtInt(laser?.lock?.error)}`} active={status.mode === "lock"} />
          </div>

          <div className="tec-status-details">
            <span>Laser Status</span>
            <strong>{laser?.status_hex ?? "--"}</strong>
            <div className="status-chip-row">
              {(laser?.status_flags ?? ["none"]).map((flag) => (
                <span key={flag}>{flag}</span>
              ))}
            </div>
          </div>

          <div className="tec-status-details">
            <span>Fault Details</span>
            <strong>{laser?.fault_status_hex ?? "--"}</strong>
            <div className="status-chip-row">
              {(laser?.fault_flags?.length ? laser.fault_flags : ["none"]).map((flag) => (
                <span key={flag}>{flag}</span>
              ))}
            </div>
          </div>
        </div>

        <div className="laser-config-column">
          <div className="parameter-section">
            <h3>Mode</h3>
            <div className="parameter-row mode-row">{controls}</div>
          </div>

          <div className="parameter-section">
            <h3>Static Output</h3>
            <div className="parameter-row static-row">
              <Field label="CH0 Code" input={staticCh0} disabled={!editability.staticEditable} />
              <Field label="CH1 Code" input={staticCh1} disabled={!editability.staticEditable} />
            </div>
          </div>

          <div className={`parameter-section ${!editability.scanEditable ? "disabled-section" : ""}`}>
            <h3>Fine Scan</h3>
            <div className="parameter-row scan-row">
              <Field label="CH0 Code" input={scanCh0} disabled={!editability.scanEditable} />
              <Field label="CH1 Start" input={scanStart} disabled={!editability.scanEditable} />
              <Field label="CH1 Stop" input={scanStop} disabled={!editability.scanEditable} />
              <Field label="CH1 Step" input={scanStep} disabled={!editability.scanEditable} />
            </div>
          </div>

          <div className={`parameter-section ${!editability.timingEditable ? "disabled-section" : ""}`}>
            <h3>Scan Timing</h3>
            <div className="parameter-row timing-row">
              <Field label="Scan Frequency Hz" input={scanRateInput} disabled={!editability.timingEditable} />
              <Field label="Dwell Ticks" input={dwell} disabled={!editability.timingEditable} />
              <Field label="Settle Ticks" input={settle} disabled={!editability.timingEditable} />
              <Field label="Frames" input={frames} disabled={!editability.timingEditable} />
            </div>
            <div className="timing-footer">
              <span>Current timing gives {fmtNumber(scanRateDraft, 3)} Hz forward scan rate.</span>
              <button className="command" disabled={!editability.timingEditable} onClick={applyScanFrequency}>
                Calculate Ticks
              </button>
            </div>
          </div>

          <div className={`parameter-section ${controlsLocked ? "disabled-section" : ""}`}>
            <h3>Safety</h3>
            <div className="parameter-row safety-row">
              <Field label="CH0 Max" input={ch0Max} disabled={controlsLocked} />
              <Field label="CH1 Max" input={ch1Max} disabled={controlsLocked} />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
