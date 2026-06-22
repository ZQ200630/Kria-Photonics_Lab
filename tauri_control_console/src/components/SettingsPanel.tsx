import { useState } from "react";
import type { PanelProps } from "./types";
import { downloadText } from "../utils/csv";

export default function SettingsPanel({ client, command }: PanelProps) {
  const [path, setPath] = useState("--");
  const [text, setText] = useState("{}");

  const load = async () => {
    const response = await client.settings();
    setPath(response.path);
    setText(JSON.stringify(response.settings, null, 2));
  };

  const save = async () => {
    const settings = JSON.parse(text);
    await client.post("/api/settings", { settings });
  };

  return (
    <section className="panel">
      <h2>Settings</h2>
      <div className="readouts">
        <div className="readout">
          <span>Settings File</span>
          <strong>{path}</strong>
        </div>
      </div>
      <textarea value={text} onChange={(event) => setText(event.target.value)} spellCheck={false} />
      <div className="actions">
        <button className="command" onClick={() => command("Load Settings", load)}>
          Load Settings
        </button>
        <button className="command primary" onClick={() => command("Save Settings", save)}>
          Save Settings
        </button>
        <button className="command" onClick={() => command("Apply Saved Settings", () => client.post("/api/settings/apply"))}>
          Apply Saved Settings
        </button>
        <button className="command" onClick={() => downloadText("butterfly-laser-settings.json", text)}>
          Export Settings JSON
        </button>
      </div>
    </section>
  );
}
