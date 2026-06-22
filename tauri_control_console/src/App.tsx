import { useCallback, useEffect, useMemo, useReducer, useState } from "react";
import { ApiClient, DEFAULT_BACKEND_URL } from "./api/client";
import { BackendEventStream } from "./api/events";
import { initialState, reducer } from "./state/store";
import StatusBar from "./components/StatusBar";
import TecPanel from "./components/TecPanel";
import LaserPanel from "./components/LaserPanel";
import SpectrumPanel from "./components/SpectrumPanel";
import LockPanel from "./components/LockPanel";
import AdaPanel from "./components/AdaPanel";
import SettingsPanel from "./components/SettingsPanel";
import DebugPanel from "./components/DebugPanel";

const tabs = ["Overview", "TEC", "Laser", "Lock", "ADA", "Settings", "Debug"] as const;
type Tab = (typeof tabs)[number];

export default function App() {
  const savedUrl = localStorage.getItem("backendUrl") || DEFAULT_BACKEND_URL;
  const [state, dispatch] = useReducer(reducer, savedUrl, initialState);
  const [tab, setTab] = useState<Tab>("Overview");
  const [connectNonce, setConnectNonce] = useState(0);
  const client = useMemo(() => new ApiClient(state.backendUrl), [state.backendUrl]);

  const refreshStatus = useCallback(async () => {
    const payload = await client.status();
    dispatch({ type: "status", timestamp: Date.now() / 1000, status: payload.status });
    return payload.status;
  }, [client]);

  useEffect(() => {
    dispatch({ type: "connection", connected: false });
    dispatch({ type: "log", message: `Connecting to ${state.backendUrl}` });

    const stream = new BackendEventStream(state.backendUrl);
    stream.on("status", (payload) => dispatch({ type: "status", timestamp: payload.timestamp, status: payload.status }));
    stream.on("spectrum", (payload) => dispatch({ type: "spectrum", spectrum: payload.spectrum }));
    stream.on("fault", () => dispatch({ type: "log", message: "Fault state changed" }));
    stream.on("error", (payload) => {
      dispatch({ type: "connection", connected: false });
      dispatch({ type: "log", message: `SSE: ${payload.error}` });
    });
    stream.connect();
    return () => stream.close();
  }, [state.backendUrl, connectNonce]);

  useEffect(() => {
    let cancelled = false;
    const poll = () => {
      refreshStatus().catch((error) => {
        if (!cancelled) {
          dispatch({ type: "connection", connected: false });
          dispatch({ type: "log", message: `Status sync failed: ${(error as Error).message}` });
        }
      });
    };
    poll();
    const id = window.setInterval(poll, 1000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [refreshStatus, connectNonce]);

  const command = async (label: string, action: () => Promise<unknown>) => {
    try {
      await action();
      await refreshStatus();
      dispatch({ type: "log", message: `${label}: ok, readback synced` });
    } catch (error) {
      dispatch({ type: "log", message: `${label}: ${(error as Error).message}` });
    }
  };

  const connectBackend = (url: string) => {
    const nextUrl = url.trim();
    localStorage.setItem("backendUrl", nextUrl);
    dispatch({ type: "backendUrl", backendUrl: nextUrl });
    setConnectNonce((value) => value + 1);
  };

  return (
    <div className="app">
      <StatusBar state={state} client={client} command={command} setBackendUrl={connectBackend} />
      <nav className="tabs">
        {tabs.map((item) => (
          <button key={item} className={item === tab ? "active" : ""} onClick={() => setTab(item)}>
            {item}
          </button>
        ))}
      </nav>
      <main>
        {tab === "Overview" && (
          <div className="grid two">
            <TecPanel state={state} client={client} command={command} compact />
            <LaserPanel state={state} client={client} command={command} compact />
            <SpectrumPanel state={state} client={client} command={command} dispatch={dispatch} />
            <AdaPanel state={state} client={client} command={command} compact />
          </div>
        )}
        {tab === "TEC" && <TecPanel state={state} client={client} command={command} />}
        {tab === "Laser" && <LaserPanel state={state} client={client} command={command} />}
        {tab === "Lock" && <LockPanel state={state} client={client} command={command} />}
        {tab === "ADA" && <AdaPanel state={state} client={client} command={command} />}
        {tab === "Settings" && <SettingsPanel state={state} client={client} command={command} />}
        {tab === "Debug" && <DebugPanel state={state} client={client} command={command} />}
      </main>
    </div>
  );
}
