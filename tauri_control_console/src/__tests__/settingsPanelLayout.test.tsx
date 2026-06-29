import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import SettingsPanel from "../components/SettingsPanel";
import type { ApiClient } from "../api/client";
import type { AppState } from "../state/store";

const state: AppState = {
  backendUrl: "http://127.0.0.1:8080",
  connected: true,
  stale: false,
  lastStatus: null,
  lastSpectrum: null,
  selectedLockPoint: null,
  commandLog: [],
  trend: [],
};

const client = {} as ApiClient;
const command = async (_label: string, action: () => Promise<unknown>) => {
  await action();
};

describe("SettingsPanel layout", () => {
  it("shows global data root controls for cross-platform storage", () => {
    const html = renderToStaticMarkup(<SettingsPanel state={state} client={client} command={command} />);

    expect(html).toContain("Settings File");
    expect(html).toContain("Data Root");
    expect(html).toContain("Choose Data Root");
    expect(html).toContain("Export Setting File");
    expect(html).toContain("Data Manual");
    expect(html).toContain("Python Examples");
  });
});
