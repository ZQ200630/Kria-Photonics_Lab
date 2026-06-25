import { useCallback, useEffect, useState } from "react";
import type { PanelProps } from "./types";
import { openTextFile, saveTextFile } from "../utils/saveText";
import {
  flattenSettings,
  parseSettingsFileContents,
  settingsFromStatus,
  type SettingRow,
  type SettingsObject,
} from "../utils/settings";

type SettingsResponse = { ok: true; path: string; settings: SettingsObject };

export default function SettingsPanel({
  state,
  client,
  command,
  active = true,
  pdCurrentOffsetMicroamp = 0,
  pdCurrentOffsetText = String(pdCurrentOffsetMicroamp),
  setPdCurrentOffsetText,
}: PanelProps) {
  const [path, setPath] = useState("--");
  const [settings, setSettings] = useState<SettingsObject>({});
  const [rows, setRows] = useState<SettingRow[]>([]);
  const [message, setMessage] = useState("Settings are loaded from the server when this page opens.");
  const [busy, setBusy] = useState(false);

  const showSettings = (response: { path: string; settings: Record<string, unknown> }, nextMessage: string) => {
    setPath(response.path);
    setSettings(response.settings);
    setRows(flattenSettings(response.settings));
    setMessage(nextMessage);
  };

  const loadServerSettings = useCallback(async () => {
    setBusy(true);
    try {
      const response = await client.settings();
      showSettings(response, `Loaded local setting file from ${response.path}`);
    } catch (error) {
      setMessage(`Load failed: ${(error as Error).message}`);
      throw error;
    } finally {
      setBusy(false);
    }
  }, [client]);

  useEffect(() => {
    if (!active || path !== "--") return;
    loadServerSettings().catch(() => {
      /* message already shown in the panel */
    });
  }, [active, loadServerSettings, path]);

  const saveCurrent = async () => {
    setBusy(true);
    try {
      const currentSettings = await client.settings();
      const status = state.lastStatus ?? (await client.status()).status;
      const settings = settingsFromStatus(currentSettings.settings, status);
      const response = await client.post<SettingsResponse>("/api/settings", { settings });
      showSettings(response, `Saved current readback parameters to ${response.path}`);
    } catch (error) {
      setMessage(`Save current failed: ${(error as Error).message}`);
      throw error;
    } finally {
      setBusy(false);
    }
  };

  const exportSettings = async () => {
    const path = await saveTextFile("butterfly-laser-settings.json", JSON.stringify(settings, null, 2));
    setMessage(path ? `Exported setting file to ${path}` : "Export cancelled.");
  };

  const loadLocalFile = async () => {
    setBusy(true);
    try {
      const file = await openTextFile();
      if (!file) {
        setMessage("Load cancelled.");
        return;
      }
      const nextSettings = parseSettingsFileContents(file.contents);
      const response = await client.post<SettingsResponse>("/api/settings", { settings: nextSettings });
      await client.post("/api/settings/apply");
      showSettings(response, `Loaded ${file.path}; saved to ${response.path}; parameters applied to PL.`);
    } catch (error) {
      setMessage(`Load local file failed: ${(error as Error).message}`);
      throw error;
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel settings-panel">
      <h2>Settings</h2>
      <div className="readouts">
        <div className="readout">
          <span>Settings File</span>
          <strong>{path}</strong>
        </div>
        <div className="readout settings-local-control">
          <label>
            PD Current Offset uA
            <input value={pdCurrentOffsetText} onChange={(event) => setPdCurrentOffsetText?.(event.target.value)} />
          </label>
          <div className="muted">Displayed/exported PD current = raw current - {pdCurrentOffsetMicroamp.toFixed(3)} uA</div>
        </div>
      </div>
      <div className="settings-message">{busy ? "Working..." : message}</div>
      <div className="actions">
        <button className="command primary" disabled={busy} onClick={() => command("Save Settings To Server", saveCurrent)}>
          Save Settings To Server
        </button>
        <button className="command" disabled={busy} onClick={() => command("Load Local Setting File", loadLocalFile)}>
          Load Local Setting File
        </button>
        <button className="command" disabled={busy} onClick={() => command("Export Setting File", exportSettings)}>
          Export Setting File
        </button>
      </div>
      <div className="settings-table">
        <div className="settings-table-head">
          <span>Key</span>
          <span>Value</span>
        </div>
        {rows.map((row) => (
          <div className="settings-table-row" key={row.key}>
            <span>{row.key}</span>
            <strong>{row.value}</strong>
          </div>
        ))}
      </div>
    </section>
  );
}
