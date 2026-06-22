import { useCallback, useEffect, useMemo, useState } from "react";
import type { PanelProps } from "./types";
import PlotCanvas from "./PlotCanvas";
import { fmtInt, fmtNumber, inputInt, inputNumber, parseNumber } from "../utils/format";
import { classifyLaserStatus, scanFrequencyHz } from "../utils/laser";
import {
  findLevelCrossings,
  inferPolarityInvertForMarker,
  nudgeNumberText,
  relativeIntensityToRawAdc,
  scanCodeAtSpectrumIndex,
  type LevelCrossing,
} from "../utils/lockSpectrum";
import { makeTecRampPayload, rampEnabledInput } from "../utils/tecRamp";
import { useSyncedInput } from "../utils/syncedInput";

type OperationControl = "temperature" | "scanCh0" | "scanStart" | "scanStop";

function numberFromInput(value: string): number {
  const parsed = parseNumber(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function Field({ label, input }: { label: string; input: ReturnType<typeof useSyncedInput> }) {
  return (
    <label>
      {label}
      <input {...input.bind} />
    </label>
  );
}

function OperationRow({
  active,
  label,
  value,
  step,
  unit,
  onSelect,
  onStepChange,
  onNudge,
}: {
  active: boolean;
  label: string;
  value: ReturnType<typeof useSyncedInput>;
  step: string;
  unit: string;
  onSelect: () => void;
  onStepChange: (value: string) => void;
  onNudge: (direction: -1 | 1) => void;
}) {
  return (
    <div className={`operation-row ${active ? "active" : ""}`} onMouseDown={onSelect}>
      <label>
        {label}
        <input {...value.bind} onFocus={(event) => {
          value.bind.onFocus();
          onSelect();
          event.currentTarget.select();
        }} />
      </label>
      <label>
        Step {unit}
        <input value={step} onChange={(event) => onStepChange(event.target.value)} />
      </label>
      <div className="operation-nudge-buttons">
        <button type="button" className="command compact" onClick={() => onNudge(-1)}>
          &lt;
        </button>
        <button type="button" className="command compact" onClick={() => onNudge(1)}>
          &gt;
        </button>
      </div>
    </div>
  );
}

export default function LockPanel({ state, client, command }: PanelProps) {
  const tec = state.lastStatus?.tec;
  const laser = state.lastStatus?.laser;
  const lock = laser?.lock;
  const laserStatus = classifyLaserStatus(laser);
  const monitoringOn = laserStatus.mode === "scan";

  const lockHalfspan =
    typeof lock?.ch1_min_internal === "number" && typeof lock?.ch1_max_internal === "number"
      ? Math.round((lock.ch1_max_internal - lock.ch1_min_internal) / 2)
      : undefined;
  const targetReadback = tec?.ramp?.active ? tec.ramp.target_celsius : tec?.target_celsius;
  const targetTemp = useSyncedInput(inputNumber(targetReadback, 3), "31.000");
  const rampEnabled = useSyncedInput(rampEnabledInput(tec?.ramp?.enabled), "yes");
  const rampRate = useSyncedInput(inputNumber(tec?.ramp?.rate_c_per_s, 3), "0.050");
  const rampInterval = useSyncedInput(inputInt(tec?.ramp?.interval_ms), "200");

  const scanCh0 = useSyncedInput(inputInt(laser?.fine_scan_setpoint?.ch0_internal), "26000");
  const scanStart = useSyncedInput(inputInt(laser?.fine_scan_setpoint?.ch1_start_internal), "20000");
  const scanStop = useSyncedInput(inputInt(laser?.fine_scan_setpoint?.ch1_stop_internal), "30000");
  const scanStep = useSyncedInput(inputInt(laser?.fine_scan_setpoint?.ch1_step_internal), "10");
  const dwell = useSyncedInput(inputInt(laser?.fine_scan_setpoint?.dwell_ticks), "100");
  const settle = useSyncedInput(inputInt(laser?.fine_scan_setpoint?.settle_ticks), "100");
  const frames = useSyncedInput(inputInt(laser?.fine_scan_setpoint?.frames), "1");

  const targetAdc = useSyncedInput(inputInt(lock?.target_adc), "42000");
  const biasCh1 = useSyncedInput(inputInt(lock?.bias_ch1_internal), "25000");
  const halfspan = useSyncedInput(inputInt(lockHalfspan), "500");
  const kp = useSyncedInput(inputNumber(lock?.kp, 6), "0.5");
  const ki = useSyncedInput(inputNumber(lock?.ki, 6), "0.01");
  const maxStep = useSyncedInput(inputInt(lock?.max_step), "10");
  const integralLimit = useSyncedInput(inputInt(lock?.integral_limit), "100000");
  const lockedThreshold = useSyncedInput(inputInt(lock?.locked_threshold), "20");
  const lossThreshold = useSyncedInput(inputInt(lock?.loss_threshold), "500");
  const polarity = useSyncedInput(lock?.polarity_invert === undefined ? undefined : lock.polarity_invert ? "invert" : "normal", "normal");

  const [activeControl, setActiveControl] = useState<OperationControl>("temperature");
  const [tempStep, setTempStep] = useState("0.010");
  const [ch0Step, setCh0Step] = useState("100");
  const [scanStartStep, setScanStartStep] = useState("100");
  const [scanStopStep, setScanStopStep] = useState("100");
  const [threshold, setThreshold] = useState<number | undefined>(undefined);

  const spectrumValues = useMemo(() => (state.lastSpectrum?.points ?? []).map((value) => Math.max(0, 0xffff - (value & 0xffff))), [state.lastSpectrum]);
  const crossings = useMemo(() => (threshold === undefined ? [] : findLevelCrossings(spectrumValues, threshold)), [spectrumValues, threshold]);
  const scanRate = scanFrequencyHz({
    start: numberFromInput(scanStart.value),
    stop: numberFromInput(scanStop.value),
    step: numberFromInput(scanStep.value),
    dwell: numberFromInput(dwell.value),
    settle: numberFromInput(settle.value),
  });

  useEffect(() => {
    if (spectrumValues.length === 0 || threshold !== undefined) return;
    const min = Math.min(...spectrumValues);
    const max = Math.max(...spectrumValues);
    if (Number.isFinite(min) && Number.isFinite(max)) setThreshold((min + max) / 2);
  }, [spectrumValues, threshold]);

  const releaseDrafts = useCallback(() => {
    targetTemp.release();
    rampEnabled.release();
    rampRate.release();
    rampInterval.release();
    scanCh0.release();
    scanStart.release();
    scanStop.release();
    scanStep.release();
    dwell.release();
    settle.release();
    frames.release();
    targetAdc.release();
    biasCh1.release();
    halfspan.release();
    kp.release();
    ki.release();
    maxStep.release();
    integralLimit.release();
    lockedThreshold.release();
    lossThreshold.release();
    polarity.release();
  }, [targetTemp, rampEnabled, rampRate, rampInterval, scanCh0, scanStart, scanStop, scanStep, dwell, settle, frames, targetAdc, biasCh1, halfspan, kp, ki, maxStep, integralLimit, lockedThreshold, lossThreshold, polarity]);

  const safety = useCallback(
    () => ({
      ch0_min: laser?.safety?.ch0_min ?? 0,
      ch0_max: laser?.safety?.ch0_max ?? 40000,
      ch1_min: laser?.safety?.ch1_min ?? 0,
      ch1_max: laser?.safety?.ch1_max ?? 50000,
    }),
    [laser?.safety?.ch0_min, laser?.safety?.ch0_max, laser?.safety?.ch1_min, laser?.safety?.ch1_max],
  );

  const scanPayload = useCallback(
    (override: Partial<Record<OperationControl, string>> = {}) => ({
      ch0: numberFromInput(override.scanCh0 ?? scanCh0.value),
      start: numberFromInput(override.scanStart ?? scanStart.value),
      stop: numberFromInput(override.scanStop ?? scanStop.value),
      step: numberFromInput(scanStep.value),
      dwell: numberFromInput(dwell.value),
      settle: numberFromInput(settle.value),
      frames: numberFromInput(frames.value),
      continuous: true,
      ...safety(),
    }),
    [scanCh0.value, scanStart.value, scanStop.value, scanStep.value, dwell.value, settle.value, frames.value, safety],
  );

  const startMonitoring = useCallback(
    async (override: Partial<Record<OperationControl, string>> = {}) => {
      await client.post("/api/laser/fine-scan", scanPayload(override));
      releaseDrafts();
    },
    [client, scanPayload, releaseDrafts],
  );

  const stopMonitoring = useCallback(async () => {
    await client.post("/api/laser/static", {
      ch0: numberFromInput(scanCh0.value),
      ch1: numberFromInput(scanStart.value),
      ...safety(),
    });
    releaseDrafts();
  }, [client, scanCh0.value, scanStart.value, safety, releaseDrafts]);

  const toggleMonitoring = () => {
    if (monitoringOn) return stopMonitoring();
    return startMonitoring();
  };

  const applyTargetTemperature = useCallback(
    async (nextTarget = targetTemp.value) => {
      await client.post("/api/tec/ramp-target", makeTecRampPayload(nextTarget, rampEnabled.value, rampRate.value, rampInterval.value));
      releaseDrafts();
    },
    [client, targetTemp.value, rampEnabled.value, rampRate.value, rampInterval.value, releaseDrafts],
  );

  const nudgeControl = useCallback(
    async (control: OperationControl, direction: -1 | 1) => {
      if (control === "temperature") {
        const next = nudgeNumberText(targetTemp.value, tempStep, direction, {
          min: tec?.temp_min_celsius ?? 0,
          max: tec?.temp_max_celsius ?? 80,
          digits: 3,
        });
        targetTemp.setDraftValue(next);
        await applyTargetTemperature(next);
        return;
      }

      const input = control === "scanCh0" ? scanCh0 : control === "scanStart" ? scanStart : scanStop;
      const stepText = control === "scanCh0" ? ch0Step : control === "scanStart" ? scanStartStep : scanStopStep;
      const next = nudgeNumberText(input.value, stepText, direction, { min: 0, max: 65535, digits: 0 });
      input.setDraftValue(next);
      if (monitoringOn) {
        await startMonitoring({ [control]: next });
      }
    },
    [
      targetTemp,
      tempStep,
      tec?.temp_min_celsius,
      tec?.temp_max_celsius,
      applyTargetTemperature,
      scanCh0,
      scanStart,
      scanStop,
      ch0Step,
      scanStartStep,
      scanStopStep,
      monitoringOn,
      startMonitoring,
    ],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      event.preventDefault();
      void command(`Nudge ${activeControl}`, () => nudgeControl(activeControl, event.key === "ArrowRight" ? 1 : -1));
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeControl, command, nudgeControl]);

  const lockBody = (override: { target_adc?: number; bias_ch1?: number; ch0?: number; polarity_invert?: boolean } = {}) => {
    const bias = override.bias_ch1 ?? numberFromInput(biasCh1.value);
    const span = Math.max(0, numberFromInput(halfspan.value));
    return {
      ch0: override.ch0 ?? numberFromInput(scanCh0.value),
      target_adc: override.target_adc ?? numberFromInput(targetAdc.value),
      bias_ch1: bias,
      lock_ch1_min: Math.max(0, bias - span),
      lock_ch1_max: Math.min(65535, bias + span),
      lock_kp: Number(kp.value),
      lock_ki: Number(ki.value),
      lock_max_step: numberFromInput(maxStep.value),
      lock_integral_limit: numberFromInput(integralLimit.value),
      locked_threshold: numberFromInput(lockedThreshold.value),
      loss_threshold: numberFromInput(lossThreshold.value),
      polarity_invert: override.polarity_invert ?? polarity.value === "invert",
      ...safety(),
    };
  };

  const startLock = async () => {
    await client.post("/api/laser/lock-start", lockBody());
    releaseDrafts();
  };

  const updateLockParameters = async () => {
    await client.laserLockParams(lockBody());
    releaseDrafts();
  };

  const startLockFromMarker = async (crossing: LevelCrossing) => {
    const nextTargetAdc = relativeIntensityToRawAdc(crossing.value);
    const scanStartCode = numberFromInput(scanStart.value);
    const scanStopCode = numberFromInput(scanStop.value);
    const nextBiasCh1 = scanCodeAtSpectrumIndex(
      crossing.index,
      state.lastSpectrum?.count ?? spectrumValues.length,
      scanStartCode,
      scanStopCode,
    );
    const nextPolarityInvert = inferPolarityInvertForMarker(spectrumValues, crossing, scanStartCode, scanStopCode);
    targetAdc.setDraftValue(String(nextTargetAdc));
    biasCh1.setDraftValue(String(nextBiasCh1));
    polarity.setDraftValue(nextPolarityInvert ? "invert" : "normal");
    await client.post(
      "/api/laser/lock-start",
      lockBody({
        target_adc: nextTargetAdc,
        bias_ch1: nextBiasCh1,
        polarity_invert: nextPolarityInvert,
      }),
    );
    releaseDrafts();
  };

  return (
    <section className="panel lock-panel">
      <div className="panel-title-row">
        <h2>Side-Fringe Lock</h2>
        <div className="lock-mode-pill">
          <span className={`status-light ${laserStatus.level}`} />
          <strong>{laserStatus.label}</strong>
        </div>
      </div>

      <div className="lock-workbench">
        <div className="lock-card lock-operation-card">
          <div className="lock-card-header">
            <div>
              <h3>Spectrum Operation</h3>
              <p>Use Left / Right buttons or keyboard arrows on the selected row.</p>
            </div>
            <button className={`command monitor-toggle ${monitoringOn ? "monitor-on" : "monitor-off"}`} onClick={() => command(monitoringOn ? "Stop Spectrum Monitor" : "Start Spectrum Monitor", toggleMonitoring)}>
              {monitoringOn ? "Monitoring On" : "Monitoring Off"}
            </button>
          </div>

          <div className="operation-grid">
            <OperationRow
              active={activeControl === "temperature"}
              label="Target Temperature C"
              value={targetTemp}
              step={tempStep}
              unit="C"
              onSelect={() => setActiveControl("temperature")}
              onStepChange={setTempStep}
              onNudge={(direction) => command("Adjust Target Temperature", () => nudgeControl("temperature", direction))}
            />
            <OperationRow
              active={activeControl === "scanCh0"}
              label="Scan CH0 Code"
              value={scanCh0}
              step={ch0Step}
              unit="code"
              onSelect={() => setActiveControl("scanCh0")}
              onStepChange={setCh0Step}
              onNudge={(direction) => command("Adjust Scan CH0", () => nudgeControl("scanCh0", direction))}
            />
            <OperationRow
              active={activeControl === "scanStart"}
              label="CH1 Start Code"
              value={scanStart}
              step={scanStartStep}
              unit="code"
              onSelect={() => setActiveControl("scanStart")}
              onStepChange={setScanStartStep}
              onNudge={(direction) => command("Adjust CH1 Start", () => nudgeControl("scanStart", direction))}
            />
            <OperationRow
              active={activeControl === "scanStop"}
              label="CH1 End Code"
              value={scanStop}
              step={scanStopStep}
              unit="code"
              onSelect={() => setActiveControl("scanStop")}
              onStepChange={setScanStopStep}
              onNudge={(direction) => command("Adjust CH1 End", () => nudgeControl("scanStop", direction))}
            />
          </div>

          <div className="operation-summary">
            <span>Scan rate {fmtNumber(scanRate, 3)} Hz</span>
            <span>Dwell {fmtInt(numberFromInput(dwell.value))}</span>
            <span>Settle {fmtInt(numberFromInput(settle.value))}</span>
          </div>
        </div>

        <div className="lock-card lock-spectrum-card">
          <div className="lock-card-header">
            <div>
              <h3>Spectrum View</h3>
              <p>Drag the right-side level handle. Click the highlighted green marker to lock with auto polarity.</p>
            </div>
            <div className="candidate-counter">
              <strong>{fmtInt(crossings.length)}</strong>
              <span>candidates</span>
            </div>
          </div>
          <PlotCanvas
            values={spectrumValues}
            color="#7c3aed"
            label="relative intensity"
            height={380}
            threshold={threshold}
            onThresholdChange={setThreshold}
            crossings={crossings}
            onCrossingClick={(crossing) => {
              void command("Start Lock From Marker", () => startLockFromMarker(crossing));
            }}
          />
        </div>

        <div className="lock-card lock-parameters-card">
          <div className="lock-card-header">
            <div>
              <h3>Lock Parameters</h3>
              <p>Update writes lock registers without entering lock mode. Start Lock also writes these values and enables locking.</p>
            </div>
          </div>

          <div className="readouts lock-readouts">
            <div className="readout">
              <span>Lock Status</span>
              <strong>{lock?.status_hex ?? "--"}</strong>
              <div className="muted">{lock?.status_flags?.join(", ") || "none"}</div>
            </div>
            <div className="readout">
              <span>Target / Error</span>
              <strong>
                {fmtInt(lock?.target_adc)} / {fmtInt(lock?.error)}
              </strong>
            </div>
            <div className="readout">
              <span>Output CH1</span>
              <strong>{fmtInt(lock?.output_ch1_internal)}</strong>
              <div className="muted">{fmtNumber(lock?.output_ch1_current_mA, 4)} mA</div>
            </div>
            <div className="readout">
              <span>Counters</span>
              <strong>
                {fmtInt(lock?.locked_counter)} / {fmtInt(lock?.loss_counter)}
              </strong>
              <div className="muted">locked / loss</div>
            </div>
          </div>

          <div className="parameter-section">
            <h3>Setpoint</h3>
            <div className="parameter-row scan-row">
              <Field label="CH0 Coarse Code" input={scanCh0} />
              <Field label="Target ADC" input={targetAdc} />
              <Field label="CH1 Bias" input={biasCh1} />
              <Field label="CH1 Range Halfspan" input={halfspan} />
            </div>
          </div>

          <div className="parameter-section">
            <h3>PID</h3>
            <div className="parameter-row pid-row">
              <Field label="Kp" input={kp} />
              <Field label="Ki" input={ki} />
              <Field label="Max Step" input={maxStep} />
              <Field label="Integral Limit" input={integralLimit} />
            </div>
          </div>

          <div className="parameter-section">
            <h3>Lock Detection</h3>
            <div className="parameter-row scan-row">
              <Field label="Locked Threshold" input={lockedThreshold} />
              <Field label="Loss Threshold" input={lossThreshold} />
              <label>
                Polarity
                <select {...polarity.bind}>
                  <option value="normal">Normal</option>
                  <option value="invert">Invert</option>
                </select>
              </label>
            </div>
          </div>

          <div className="actions">
            <button className="command" onClick={() => command("Update Lock Parameters", updateLockParameters)}>
              Update Parameters
            </button>
            <button className="command primary" onClick={() => command("Start Lock", startLock)}>
              Start Lock
            </button>
            <button className="command" onClick={() => command("Hold Current", () => client.post("/api/laser/lock-hold"))}>
              Hold Current
            </button>
            <button className="command" onClick={() => command("Clear Lock Fault", () => client.post("/api/laser/lock-clear"))}>
              Clear Lock Fault
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
