import { useCallback, useEffect, useState } from "react";
import type { PanelProps } from "./types";
import { openTextFile } from "../utils/saveText";
import { DATA_DOCUMENT_DOWNLOADS, downloadDataDocument } from "../utils/dataDocumentation";
import {
  storageChooseRoot,
  storageGetConfig,
  storageMetadataFile,
  storageTextFile,
  storageWriteRecord,
  type StorageConfig,
} from "../utils/storage";
import {
  flattenSettings,
  parseSettingsFileContents,
  settingsFromStatus,
  type SettingRow,
  type SettingsObject,
} from "../utils/settings";

type SettingsResponse = { ok: true; path: string; settings: SettingsObject };
type DataDocumentFilename = (typeof DATA_DOCUMENT_DOWNLOADS)[number]["filename"];

export default function SettingsPanel({
  state,
  client,
  command,
  active = true,
}: PanelProps) {
  const [path, setPath] = useState("--");
  const [settings, setSettings] = useState<SettingsObject>({});
  const [rows, setRows] = useState<SettingRow[]>([]);
  const [message, setMessage] = useState("Settings are loaded from the server when this page opens.");
  const [storageConfig, setStorageConfig] = useState<StorageConfig | null>(null);
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

  useEffect(() => {
    if (!active) return;
    storageGetConfig()
      .then(setStorageConfig)
      .catch((error) => setMessage(`Load data root failed: ${(error as Error).message}`));
  }, [active]);

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
    const result = await storageWriteRecord({
      dataType: "settings_export",
      name: "settings",
      files: [
        storageMetadataFile({
          kind: "settings_export",
          saved_at: new Date().toISOString(),
          server_settings_path: path,
        }),
        storageTextFile("settings.json", `${JSON.stringify(settings, null, 2)}\n`),
      ],
    });
    setMessage(`Exported setting file to ${result.path}`);
  };

  const chooseRoot = async () => {
    const config = await storageChooseRoot();
    if (config) {
      setStorageConfig(config);
      setMessage(`Data root set to ${config.dataRoot}`);
    } else {
      setMessage("Data root selection cancelled.");
    }
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

  const downloadDocument = (filename: DataDocumentFilename) => async () => {
    const downloaded = await downloadDataDocument(filename);
    setMessage(downloaded ? `Saved ${downloaded}.` : "Download cancelled.");
  };

  return (
    <section className="panel settings-panel">
      <h2>Settings</h2>
      <div className="readouts">
        <div className="readout">
          <span>Settings File</span>
          <strong>{path}</strong>
        </div>
        <div className="readout">
          <span>Data Root</span>
          <strong>{storageConfig?.dataRoot ?? "Loading..."}</strong>
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
        <button className="command" disabled={busy} onClick={() => command("Choose Data Root", chooseRoot)}>
          Choose Data Root
        </button>
        <button className="command" disabled={busy} onClick={() => command("Export Setting File", exportSettings)}>
          Export Setting File
        </button>
      </div>
      <div className="settings-docs-panel">
        <h3>Documentation</h3>
        <div className="actions">
          {DATA_DOCUMENT_DOWNLOADS.map((item) => (
            <button
              key={item.filename}
              className="command"
              disabled={busy}
              onClick={() => command(`Download ${item.label}`, downloadDocument(item.filename))}
            >
              {item.label}
            </button>
          ))}
        </div>
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
