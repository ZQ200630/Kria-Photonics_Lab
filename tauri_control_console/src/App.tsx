import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { ApiClient, DEFAULT_BACKEND_URL } from "./api/client";
import { BackendEventStream } from "./api/events";
import { initialState, reducer } from "./state/store";
import { flushLatest } from "./utils/renderThrottle";
import { appendBoundedMonitorSample, statusEventToMonitorSample, type MonitorSample } from "./utils/monitorSamples";
import { DEFAULT_PD_CURRENT_OFFSET_MICROAMP, DEFAULT_TZ_OHM, normalizePdCurrentOffsetMicroamp, normalizeTzOhm } from "./utils/ada4355";
import type { Spectrum, SystemStatus } from "./api/types";
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
type PendingStatus = { timestamp: number; status: SystemStatus };
type PendingSpectrum = { spectrum: Spectrum };

const STATUS_RENDER_INTERVAL_MS = 100;
const SPECTRUM_RENDER_INTERVAL_MS = 200;
const EVENT_STATUS_HZ = 50;
const EVENT_SPECTRUM_HZ = 5;
const EVENT_SPECTRUM_POINTS = 16384;

export default function App() {
  const savedUrl = localStorage.getItem("backendUrl") || DEFAULT_BACKEND_URL;
  const [state, dispatch] = useReducer(reducer, savedUrl, initialState);
  const [tab, setTab] = useState<Tab>("Overview");
  const [connectNonce, setConnectNonce] = useState(0);
  const [tzOhmText, setTzOhmTextState] = useState(() => localStorage.getItem("adaTzOhm") || String(DEFAULT_TZ_OHM));
  const [pdCurrentOffsetText, setPdCurrentOffsetTextState] = useState(
    () => localStorage.getItem("pdCurrentOffsetMicroamp") || String(DEFAULT_PD_CURRENT_OFFSET_MICROAMP),
  );
  const pendingStatus = useRef<PendingStatus | null>(null);
  const pendingSpectrum = useRef<PendingSpectrum | null>(null);
  const monitorSamplesRef = useRef<MonitorSample[]>([]);
  const client = useMemo(() => new ApiClient(state.backendUrl), [state.backendUrl]);
  const tzOhm = normalizeTzOhm(Number(tzOhmText));
  const pdCurrentOffsetMicroamp = normalizePdCurrentOffsetMicroamp(Number(pdCurrentOffsetText));

  const setTzOhmText = (value: string) => {
    setTzOhmTextState(value);
    localStorage.setItem("adaTzOhm", value);
  };

  const setPdCurrentOffsetText = (value: string) => {
    setPdCurrentOffsetTextState(value);
    localStorage.setItem("pdCurrentOffsetMicroamp", value);
  };

  const refreshStatus = useCallback(async () => {
    const payload = await client.status();
    dispatch({ type: "status", timestamp: Date.now() / 1000, status: payload.status });
    return payload.status;
  }, [client]);

  useEffect(() => {
    dispatch({ type: "connection", connected: false });
    dispatch({ type: "log", message: `Connecting to ${state.backendUrl}` });
    pendingStatus.current = null;
    pendingSpectrum.current = null;
    monitorSamplesRef.current = [];

    const stream = new BackendEventStream(state.backendUrl, {
      statusHz: EVENT_STATUS_HZ,
      spectrumHz: EVENT_SPECTRUM_HZ,
      spectrumPoints: EVENT_SPECTRUM_POINTS,
    });
    stream.on("status", (payload) => {
      const receivedAt = Date.now() / 1000;
      monitorSamplesRef.current = appendBoundedMonitorSample(monitorSamplesRef.current, statusEventToMonitorSample(payload, receivedAt));
      pendingStatus.current = { timestamp: receivedAt, status: payload.status };
    });
    stream.on("spectrum", (payload) => {
      pendingSpectrum.current = { spectrum: payload.spectrum };
    });
    stream.on("fault", () => dispatch({ type: "log", message: "Fault state changed" }));
    stream.on("error", (payload) => {
      dispatch({ type: "connection", connected: false });
      dispatch({ type: "log", message: `SSE: ${payload.error}` });
    });
    stream.connect();
    return () => stream.close();
  }, [state.backendUrl, connectNonce]);

  useEffect(() => {
    const id = window.setInterval(() => {
      const nextStatus = flushLatest(pendingStatus);
      if (nextStatus) dispatch({ type: "status", timestamp: nextStatus.timestamp, status: nextStatus.status });
    }, STATUS_RENDER_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [connectNonce]);

  useEffect(() => {
    const id = window.setInterval(() => {
      const nextSpectrum = flushLatest(pendingSpectrum);
      if (nextSpectrum) dispatch({ type: "spectrum", spectrum: nextSpectrum.spectrum });
    }, SPECTRUM_RENDER_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [connectNonce]);

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

  useEffect(() => {
    refreshStatus().catch((error) => {
      dispatch({ type: "connection", connected: false });
      dispatch({ type: "log", message: `Tab status sync failed: ${(error as Error).message}` });
    });
  }, [tab, refreshStatus]);

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
  const tabPanelClass = (item: Tab) => `tab-panel ${item === tab ? "active" : ""}`;

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
      <main className="tab-panels">
        <div className={tabPanelClass("Overview")} data-tab="Overview" aria-hidden={tab !== "Overview"}>
          <div className="grid two">
            <TecPanel state={state} client={client} command={command} compact active={tab === "Overview"} />
            <LaserPanel state={state} client={client} command={command} compact active={tab === "Overview"} />
            <SpectrumPanel
              state={state}
              client={client}
              command={command}
              dispatch={dispatch}
              active={tab === "Overview"}
              tzOhm={tzOhm}
              tzOhmText={tzOhmText}
              setTzOhmText={setTzOhmText}
              pdCurrentOffsetMicroamp={pdCurrentOffsetMicroamp}
            />
            <AdaPanel
              state={state}
              client={client}
              command={command}
              compact
              active={tab === "Overview"}
              tzOhm={tzOhm}
              tzOhmText={tzOhmText}
              setTzOhmText={setTzOhmText}
              pdCurrentOffsetMicroamp={pdCurrentOffsetMicroamp}
            />
          </div>
        </div>
        <div className={tabPanelClass("TEC")} data-tab="TEC" aria-hidden={tab !== "TEC"}>
          <TecPanel state={state} client={client} command={command} active={tab === "TEC"} />
        </div>
        <div className={tabPanelClass("Laser")} data-tab="Laser" aria-hidden={tab !== "Laser"}>
          <LaserPanel state={state} client={client} command={command} active={tab === "Laser"} />
        </div>
        <div className={tabPanelClass("Lock")} data-tab="Lock" aria-hidden={tab !== "Lock"}>
          <LockPanel
            state={state}
            client={client}
            command={command}
            active={tab === "Lock"}
            tzOhm={tzOhm}
            tzOhmText={tzOhmText}
            setTzOhmText={setTzOhmText}
            pdCurrentOffsetMicroamp={pdCurrentOffsetMicroamp}
            monitorSamplesRef={monitorSamplesRef}
          />
        </div>
        <div className={tabPanelClass("ADA")} data-tab="ADA" aria-hidden={tab !== "ADA"}>
          <AdaPanel
            state={state}
            client={client}
            command={command}
            active={tab === "ADA"}
            tzOhm={tzOhm}
            tzOhmText={tzOhmText}
            setTzOhmText={setTzOhmText}
            pdCurrentOffsetMicroamp={pdCurrentOffsetMicroamp}
          />
        </div>
        <div className={tabPanelClass("Settings")} data-tab="Settings" aria-hidden={tab !== "Settings"}>
          <SettingsPanel
            state={state}
            client={client}
            command={command}
            active={tab === "Settings"}
            pdCurrentOffsetMicroamp={pdCurrentOffsetMicroamp}
            pdCurrentOffsetText={pdCurrentOffsetText}
            setPdCurrentOffsetText={setPdCurrentOffsetText}
          />
        </div>
        <div className={tabPanelClass("Debug")} data-tab="Debug" aria-hidden={tab !== "Debug"}>
          <DebugPanel state={state} client={client} command={command} active={tab === "Debug"} />
        </div>
      </main>
    </div>
  );
}
