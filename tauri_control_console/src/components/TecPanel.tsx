import type { PanelProps } from "./types";
import PlotCanvas from "./PlotCanvas";
import { fmtInt, fmtNumber, inputInt, inputNumber, parseNumber } from "../utils/format";
import { useSyncedInput } from "../utils/syncedInput";
import { classifyTecStatus, isTecRunning, temperatureStats, type TecStatusSummary } from "../utils/tec";
import { makeTecRampPayload, rampEnabledInput } from "../utils/tecRamp";

function StatusLamp({ status, compact = false }: { status: TecStatusSummary; compact?: boolean }) {
  return (
    <div className={`tec-status-indicator ${compact ? "compact" : ""}`}>
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

function Field({ label, input }: { label: string; input: ReturnType<typeof useSyncedInput> }) {
  return (
    <label>
      {label}
      <input {...input.bind} />
    </label>
  );
}

export default function TecPanel({ state, client, command, compact = false }: PanelProps) {
  const tec = state.lastStatus?.tec;
  const targetReadback = tec?.ramp?.active ? tec.ramp.target_celsius : tec?.target_celsius;
  const target = useSyncedInput(inputNumber(targetReadback, 3), "31.0");
  const kp = useSyncedInput(inputNumber(tec?.pid?.kp, 6), "0.5");
  const ki = useSyncedInput(inputNumber(tec?.pid?.ki, 8), "0.001");
  const kd = useSyncedInput(inputNumber(tec?.pid?.kd, 6), "0");
  const integralLimit = useSyncedInput(inputInt(tec?.pid?.integral_limit), "300000");
  const maxStep = useSyncedInput(inputInt(tec?.pid?.max_step), "10");
  const dacMin = useSyncedInput(inputInt(tec?.dac_min), "1800");
  const dacMax = useSyncedInput(inputInt(tec?.dac_max), "2150");
  const dacBias = useSyncedInput(inputInt(tec?.dac_bias), "2048");
  const dacSafe = useSyncedInput(inputInt(tec?.dac_safe), "2048");
  const tempMin = useSyncedInput(inputNumber(tec?.temp_min_celsius, 3), "20.0");
  const tempMax = useSyncedInput(inputNumber(tec?.temp_max_celsius, 3), "40.0");
  const alpha = useSyncedInput(inputInt(tec?.temp_alpha), "65535");
  const rampEnabled = useSyncedInput(rampEnabledInput(tec?.ramp?.enabled), "yes");
  const rampRate = useSyncedInput(inputNumber(tec?.ramp?.rate_c_per_s, 3), "0.05");
  const rampInterval = useSyncedInput(inputInt(tec?.ramp?.interval_ms), "200");
  const values = state.trend.map((item) => item.temp).filter((value): value is number => typeof value === "number");
  const tecOn = isTecRunning(tec?.status_flags);
  const status = classifyTecStatus(tec);
  const stats = temperatureStats(values);

  const updateParameters = async () => {
    await client.post("/api/tec/pid", {
      kp: Number(kp.value),
      ki: Number(ki.value),
      kd: Number(kd.value),
      integral_limit: parseNumber(integralLimit.value),
      max_step: parseNumber(maxStep.value),
      dac_min: parseNumber(dacMin.value),
      dac_max: parseNumber(dacMax.value),
      dac_bias: parseNumber(dacBias.value),
      dac_safe: parseNumber(dacSafe.value),
    });
    await client.post("/api/tec/protection", {
      temp_min_celsius: Number(tempMin.value),
      temp_max_celsius: Number(tempMax.value),
      alpha: parseNumber(alpha.value),
    });
    await client.post("/api/tec/ramp", {
      enabled: rampEnabled.value !== "no",
      rate_c_per_s: Number(rampRate.value),
      interval_ms: parseNumber(rampInterval.value),
    });
    await client.post("/api/tec/ramp-target", makeTecRampPayload(target.value, rampEnabled.value, rampRate.value, rampInterval.value));
  };

  const toggleTec = () => {
    if (tecOn) {
      return client.post("/api/tec/stop");
    }
    return client
      .post("/api/tec/start", { reset: true })
      .then(() => client.post("/api/tec/ramp-target", makeTecRampPayload(target.value, rampEnabled.value, rampRate.value, rampInterval.value)));
  };

  const setTargetTemperature = () => client.post("/api/tec/ramp-target", makeTecRampPayload(target.value, rampEnabled.value, rampRate.value, rampInterval.value));

  if (compact) {
    return (
      <section className="panel tec-panel tec-overview-panel">
        <div className="panel-title-row">
          <h2>TEC Control</h2>
        </div>
        <div className="tec-overview-metrics">
          <Metric label="Temperature" value={`${fmtNumber(tec?.temperature_filtered_celsius, 3)} C`} />
          <Metric label="Target" value={`${fmtNumber(tec?.target_celsius, 3)} C`} />
          <Metric label="Error" value={`${fmtNumber(tec?.error_celsius, 3)} C`} />
          <div className="tec-metric status-only">
            <span>Status</span>
            <StatusLamp status={status} compact />
          </div>
        </div>
        <div className="tec-overview-controls">
          <label>
            Target Temperature
            <input {...target.bind} />
          </label>
          <button className="command primary" onClick={() => command("Set TEC Target Temperature", setTargetTemperature)}>
            Set Target Temperature
          </button>
          <button className={`command tec-power ${tecOn ? "tec-on" : "tec-off"}`} onClick={() => command(tecOn ? "TEC Off" : "TEC On", toggleTec)}>
            {tecOn ? "TEC On" : "TEC Off"}
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="panel tec-panel tec-detail-panel">
      <div className="panel-title-row">
        <h2>TEC Control</h2>
        <StatusLamp status={status} />
      </div>

      <div className="tec-detail-layout">
        <div className="tec-monitor-column">
          <div className="temperature-hero">
            <span>Filtered Temperature</span>
            <strong>{fmtNumber(tec?.temperature_filtered_celsius, 3)} C</strong>
            <div>
              Target {fmtNumber(tec?.target_celsius, 3)} C
              <span>Ramp {tec?.ramp?.active ? `${fmtNumber(tec.ramp.target_celsius, 3)} C` : "idle"}</span>
              <span>Error {fmtNumber(tec?.error_celsius, 3)} C</span>
            </div>
          </div>

          <PlotCanvas values={values} color="#2563eb" label="Temperature C" xLabel="latest 600 status samples" height={300} />

          <div className="tec-stats-strip">
            <Metric label="Window Max" value={`${fmtNumber(stats.max, 3)} C`} />
            <Metric label="Window Min" value={`${fmtNumber(stats.min, 3)} C`} />
            <Metric label="Peak to Peak" value={`${fmtNumber(stats.peakToPeak, 4)} C`} />
            <Metric label="RMS Noise" value={`${fmtNumber(stats.rmsNoise, 5)} C`} />
            <Metric label="Samples" value={fmtInt(stats.count)} />
          </div>

          <div className="tec-dac-panel">
            <h3>DAC Code</h3>
            <div className="tec-dac-grid">
              <Metric label="Active DAC" value={fmtInt(tec?.active_dac_code)} />
              <Metric label="P Term" value={fmtInt(tec?.pid?.p_term)} />
              <Metric label="I Term" value={fmtInt(tec?.pid?.i_term)} />
              <Metric label="D Term" value={fmtInt(tec?.pid?.d_term)} />
              <Metric label="PID Output" value={fmtInt(tec?.pid?.output_code)} />
            </div>
          </div>

          <div className="tec-status-details">
            <span>Raw Status</span>
            <strong>{tec?.status_hex ?? "--"}</strong>
            <div className="status-chip-row">
              {(tec?.status_flags ?? ["none"]).map((flag) => (
                <span key={flag}>{flag}</span>
              ))}
            </div>
          </div>
        </div>

        <div className="tec-config-column">
          <div className="parameter-section target-row">
            <h3>Target</h3>
            <div className="parameter-row target-ramp-row">
              <Field label="Target C" input={target} />
              <label>
                Ramp Enable
                <select {...rampEnabled.bind}>
                  <option value="yes">Enabled</option>
                  <option value="no">Immediate</option>
                </select>
              </label>
              <Field label="Ramp Rate C/s" input={rampRate} />
              <Field label="Ramp Interval ms" input={rampInterval} />
            </div>
          </div>

          <div className="parameter-section">
            <h3>PID</h3>
            <div className="parameter-row pid-row">
              <Field label="Kp" input={kp} />
              <Field label="Ki" input={ki} />
              <Field label="Kd" input={kd} />
              <Field label="Integral Limit" input={integralLimit} />
            </div>
          </div>

          <div className="parameter-section">
            <h3>DAC Limits</h3>
            <div className="parameter-row dac-row">
              <Field label="Max Step" input={maxStep} />
              <Field label="DAC Min" input={dacMin} />
              <Field label="DAC Max" input={dacMax} />
              <Field label="DAC Bias" input={dacBias} />
              <Field label="DAC Safe" input={dacSafe} />
            </div>
          </div>

          <div className="parameter-section">
            <h3>Protection</h3>
            <div className="parameter-row protection-row">
              <Field label="Temp Min C" input={tempMin} />
              <Field label="Temp Max C" input={tempMax} />
            </div>
          </div>

          <div className="parameter-section">
            <h3>Filter</h3>
            <div className="parameter-row single">
              <Field label="Filter Alpha" input={alpha} />
            </div>
          </div>

          <div className="actions tec-detail-actions">
            <button className={`command tec-power ${tecOn ? "tec-on" : "tec-off"}`} onClick={() => command(tecOn ? "TEC Off" : "TEC On", toggleTec)}>
              {tecOn ? "TEC On" : "TEC Off"}
            </button>
            <button className="command primary" onClick={() => command("Update TEC Parameters", updateParameters)}>
              Update Parameters
            </button>
            <button className="command" onClick={() => command("Clear TEC Fault", () => client.post("/api/tec/clear-fault"))}>
              Clear TEC Fault
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
