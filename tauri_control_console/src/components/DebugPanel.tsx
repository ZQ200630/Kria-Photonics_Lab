import { useState } from "react";
import type { PanelProps } from "./types";
import { inputHex, parseNumber } from "../utils/format";
import { useSyncedInput } from "../utils/syncedInput";

export default function DebugPanel({ state, client, command }: PanelProps) {
  const tec = state.lastStatus?.tec;
  const [block, setBlock] = useState("tec");
  const [offset, setOffset] = useState("0x04");
  const [value, setValue] = useState("0x00000000");
  const [json, setJson] = useState("{}");
  const tecManualDac = useSyncedInput(inputHex(tec?.manual_dac_code), "0x800");
  const tecOpenLoopEnable = useSyncedInput(tec?.status_flags?.includes("tec_enabled") === undefined ? undefined : tec.status_flags.includes("tec_enabled") ? "yes" : "no", "no");

  const readRegister = async () => {
    const response = await client.get<{ ok: true; value_hex: string; value: number }>(`/api/read?block=${block}&offset=${encodeURIComponent(parseNumber(offset))}`);
    setValue(response.value_hex);
    setJson(JSON.stringify(response, null, 2));
  };

  const writeRegister = async () => {
    const response = await client.post("/api/write", { block, offset: parseNumber(offset), value: parseNumber(value) });
    setJson(JSON.stringify(response, null, 2));
  };

  const dumpRegisters = async () => {
    const response = await client.get("/api/registers");
    setJson(JSON.stringify(response, null, 2));
  };

  const writeTecOpenLoopDac = async () => {
    const response = await client.post("/api/tec/open-loop", {
      dac: parseNumber(tecManualDac.value),
      enable_tec: tecOpenLoopEnable.value === "yes",
    });
    setJson(JSON.stringify(response, null, 2));
  };

  return (
    <section className="panel">
      <h2>Debug</h2>
      <div className="fields">
        <label>
          Block
          <select value={block} onChange={(event) => setBlock(event.target.value)}>
            <option value="tec">tec</option>
            <option value="laser">laser</option>
            <option value="ada">ada</option>
          </select>
        </label>
        <label>
          Offset
          <input value={offset} onChange={(event) => setOffset(event.target.value)} />
        </label>
        <label>
          Value
          <input value={value} onChange={(event) => setValue(event.target.value)} />
        </label>
      </div>
      <div className="actions">
        <button className="command" onClick={() => command("Read Register", readRegister)}>
          Read
        </button>
        <button className="command" onClick={() => command("Write Register", writeRegister)}>
          Write
        </button>
        <button className="command" onClick={() => command("Dump Registers", dumpRegisters)}>
          Dump Registers
        </button>
      </div>
      <h3>TEC Open Loop Debug</h3>
      <div className="fields">
        <label>
          Manual DAC
          <input {...tecManualDac.bind} />
        </label>
        <label>
          TEC Enable
          <select {...tecOpenLoopEnable.bind}>
            <option value="no">Disabled</option>
            <option value="yes">Enabled</option>
          </select>
        </label>
      </div>
      <div className="actions">
        <button className="command danger" onClick={() => command("TEC Open Loop DAC", writeTecOpenLoopDac)}>
          TEC Open Loop DAC
        </button>
      </div>
      <h3>Last Response</h3>
      <textarea value={json} onChange={(event) => setJson(event.target.value)} spellCheck={false} />
      <h3>Command Log</h3>
      <div className="log">
        {state.commandLog.map((line, index) => (
          <div key={`${index}-${line}`}>{line}</div>
        ))}
      </div>
    </section>
  );
}
