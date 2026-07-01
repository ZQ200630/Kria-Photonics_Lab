import { memo, startTransition, useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { ApiClient, DEFAULT_BACKEND_URL } from "./api/client";
import { BackendEventStream } from "./api/events";
import { initialState, reducer } from "./state/store";
import { flushLatest } from "./utils/renderThrottle";
import { pushBoundedMonitorSample, statusEventToMonitorSample, statusToMonitorSample, type MonitorSample } from "./utils/monitorSamples";
import { DEFAULT_PD_ZERO_ADC_CODE, DEFAULT_TZ_OHM, normalizePdZeroAdcCode, normalizeTzOhm } from "./utils/ada4355";
import type { Spectrum, SystemStatus } from "./api/types";
import type { AppState } from "./state/store";
import StatusBar from "./components/StatusBar";
import TecPanel from "./components/TecPanel";
import LaserPanel from "./components/LaserPanel";
import LockPanel from "./components/LockPanel";
import AdaPanel from "./components/AdaPanel";
import PaImagingPanel from "./components/PaImagingPanel";
import SettingsPanel from "./components/SettingsPanel";
import DebugPanel from "./components/DebugPanel";
import MonitorPanel from "./components/MonitorPanel";

const tabs = ["Monitor", "TEC", "Laser", "Lock", "ADA", "PA Imaging", "Settings", "Debug"] as const;
type Tab = (typeof tabs)[number];
type PendingStatus = { timestamp: number; status: SystemStatus };
type PendingSpectrum = { spectrum: Spectrum };

const STATUS_RENDER_INTERVAL_MS = 100;
const SPECTRUM_RENDER_INTERVAL_MS = 200;
const EVENT_STATUS_HZ = 50;
const EVENT_SPECTRUM_HZ = 5;
const EVENT_SPECTRUM_POINTS = 16384;

const MemoMonitorPanel = memo(MonitorPanel);
const MemoTecPanel = memo(TecPanel);
const MemoLaserPanel = memo(LaserPanel);
const MemoLockPanel = memo(LockPanel);
const MemoAdaPanel = memo(AdaPanel);
const MemoPaImagingPanel = memo(PaImagingPanel);
const MemoSettingsPanel = memo(SettingsPanel);
const MemoDebugPanel = memo(DebugPanel);

export function resolvePanelState<TabKey extends string, State>(
  panel: TabKey,
  activePanel: TabKey,
  state: State,
  cache: Partial<Record<TabKey, State>>,
): State {
  if (panel === activePanel) {
    cache[panel] = state;
    return state;
  }
  if (Object.prototype.hasOwnProperty.call(cache, panel)) {
    return cache[panel] as State;
  }
  cache[panel] = state;
  return state;
}

export function runBackgroundUiUpdate(update: () => void, scheduler: (update: () => void) => void = startTransition) {
  scheduler(update);
}

export function shouldPrimeInitialSpectrum(state: Pick<AppState, "connected" | "lastSpectrum">, requestInFlight: boolean): boolean {
  return state.connected && state.lastSpectrum === null && !requestInFlight;
}

export type PaImagingPanelStateCache = {
  key?: string;
  state?: AppState;
};

function paImagingStatusKey(status: SystemStatus | null): string {
  const pa = status?.pa;
  const scheduler = status?.pa_scheduler;
  return JSON.stringify({
    pa: pa
      ? {
          connected: pa.connected,
          running: pa.running,
          stop_requested: pa.stop_requested,
          last_error: pa.last_error,
          frames_sent: pa.frames_sent,
          expected_frames: pa.expected_frames,
          end_reason: pa.end_reason,
          connection_count: pa.connection_count,
        }
      : null,
    scheduler: scheduler
      ? {
          available: scheduler.available,
          mode: scheduler.mode,
          mode_name: scheduler.mode_name,
          active: scheduler.active,
          capture_required: scheduler.capture_required,
          fault_latched: scheduler.fault_latched,
          current_x: scheduler.current_x,
          current_y: scheduler.current_y,
          shot_count: scheduler.shot_count,
          capture_count: scheduler.capture_count,
          last_error: scheduler.last_error,
        }
      : null,
  });
}

export function resolvePaImagingPanelState(state: AppState, cache: PaImagingPanelStateCache): AppState {
  const key = JSON.stringify({
    backendUrl: state.backendUrl,
    connected: state.connected,
    stale: state.stale,
    status: paImagingStatusKey(state.lastStatus),
  });
  if (cache.key === key && cache.state) return cache.state;
  const nextState: AppState = {
    backendUrl: state.backendUrl,
    connected: state.connected,
    stale: state.stale,
    lastStatus: state.lastStatus
      ? {
          tec: {},
          laser: {},
          ada4355: {},
          pa: state.lastStatus.pa,
          pa_scheduler: state.lastStatus.pa_scheduler,
        }
      : null,
    lastSpectrum: null,
    selectedLockPoint: null,
    commandLog: [],
    trend: [],
  };
  cache.key = key;
  cache.state = nextState;
  return nextState;
}

export default function App() {
  const savedUrl = localStorage.getItem("backendUrl") || DEFAULT_BACKEND_URL;
  const [state, dispatch] = useReducer(reducer, savedUrl, initialState);
  const [tab, setTab] = useState<Tab>("Monitor");
  const [connectionEnabled, setConnectionEnabled] = useState(true);
  const [connectNonce, setConnectNonce] = useState(0);
  const [tzOhmText, setTzOhmTextState] = useState(() => localStorage.getItem("adaTzOhm") || String(DEFAULT_TZ_OHM));
  const [pdZeroAdcCodeText, setPdZeroAdcCodeTextState] = useState(
    () => localStorage.getItem("pdZeroAdcCode") || String(DEFAULT_PD_ZERO_ADC_CODE),
  );
  const pendingStatus = useRef<PendingStatus | null>(null);
  const pendingSpectrum = useRef<PendingSpectrum | null>(null);
  const initialSpectrumRequestInFlight = useRef(false);
  const monitorSamplesRef = useRef<MonitorSample[]>([]);
  const panelStateCache = useRef<Partial<Record<Tab, typeof state>>>({});
  const paImagingStateCache = useRef<PaImagingPanelStateCache>({});
  const client = useMemo(() => new ApiClient(state.backendUrl), [state.backendUrl]);
  const tzOhm = normalizeTzOhm(Number(tzOhmText));
  const pdZeroAdcCode = normalizePdZeroAdcCode(Number(pdZeroAdcCodeText));

  const setTzOhmText = useCallback((value: string) => {
    setTzOhmTextState(value);
    localStorage.setItem("adaTzOhm", value);
  }, []);

  const setPdZeroAdcCodeText = useCallback((value: string) => {
    setPdZeroAdcCodeTextState(value);
    localStorage.setItem("pdZeroAdcCode", value);
  }, []);

  const refreshStatus = useCallback(async () => {
    const payload = await client.status();
    const receivedAt = Date.now() / 1000;
    pushBoundedMonitorSample(monitorSamplesRef.current, statusToMonitorSample(receivedAt, payload.status));
    dispatch({ type: "status", timestamp: receivedAt, status: payload.status });
    return payload.status;
  }, [client]);

  useEffect(() => {
    if (!connectionEnabled) {
      dispatch({ type: "connection", connected: false });
      return;
    }

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
      pushBoundedMonitorSample(monitorSamplesRef.current, statusEventToMonitorSample(payload, receivedAt));
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
  }, [state.backendUrl, connectNonce, connectionEnabled]);

  useEffect(() => {
    const id = window.setInterval(() => {
      const nextStatus = flushLatest(pendingStatus);
      if (nextStatus) {
        runBackgroundUiUpdate(() => dispatch({ type: "status", timestamp: nextStatus.timestamp, status: nextStatus.status }));
      }
    }, STATUS_RENDER_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [connectNonce]);

  useEffect(() => {
    const id = window.setInterval(() => {
      const nextSpectrum = flushLatest(pendingSpectrum);
      if (nextSpectrum) {
        runBackgroundUiUpdate(() => dispatch({ type: "spectrum", spectrum: nextSpectrum.spectrum }));
      }
    }, SPECTRUM_RENDER_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [connectNonce]);

  useEffect(() => {
    if (!shouldPrimeInitialSpectrum(state, initialSpectrumRequestInFlight.current)) return;
    initialSpectrumRequestInFlight.current = true;
    client
      .spectrum(EVENT_SPECTRUM_POINTS)
      .then((payload) => {
        runBackgroundUiUpdate(() => dispatch({ type: "spectrum", spectrum: payload.spectrum }));
      })
      .catch((error) => {
        dispatch({ type: "log", message: `Initial spectrum sync failed: ${(error as Error).message}` });
      })
      .finally(() => {
        initialSpectrumRequestInFlight.current = false;
      });
  }, [client, state]);

  useEffect(() => {
    if (!connectionEnabled) return;
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
  }, [refreshStatus, connectNonce, connectionEnabled]);

  useEffect(() => {
    if (!connectionEnabled) return;
    refreshStatus().catch((error) => {
      dispatch({ type: "connection", connected: false });
      dispatch({ type: "log", message: `Tab status sync failed: ${(error as Error).message}` });
    });
  }, [tab, refreshStatus, connectionEnabled]);

  const command = useCallback(async (label: string, action: () => Promise<unknown>) => {
    try {
      await action();
      await refreshStatus();
      dispatch({ type: "log", message: `${label}: ok, readback synced` });
    } catch (error) {
      dispatch({ type: "log", message: `${label}: ${(error as Error).message}` });
    }
  }, [refreshStatus]);

  const connectBackend = useCallback((url: string) => {
    const nextUrl = url.trim();
    localStorage.setItem("backendUrl", nextUrl);
    setConnectionEnabled(true);
    dispatch({ type: "backendUrl", backendUrl: nextUrl });
    setConnectNonce((value) => value + 1);
  }, []);

  const disconnectBackend = useCallback(() => {
    setConnectionEnabled(false);
    setConnectNonce((value) => value + 1);
    pendingStatus.current = null;
    pendingSpectrum.current = null;
    initialSpectrumRequestInFlight.current = false;
    dispatch({ type: "connection", connected: false });
    dispatch({ type: "log", message: "Disconnected by user" });
    client.paDisconnect(2_000, 1_000).catch((error) => {
      dispatch({ type: "log", message: `PA TCP disconnect skipped: ${(error as Error).message}` });
    });
  }, [client]);
  const tabPanelClass = (item: Tab) => `tab-panel ${item === tab ? "active" : ""}`;
  const stateForPanel = (item: Tab) => resolvePanelState(item, tab, state, panelStateCache.current);
  const stateForPaImagingPanel = () =>
    resolvePanelState("PA Imaging", tab, resolvePaImagingPanelState(state, paImagingStateCache.current), panelStateCache.current);

  return (
    <div className="app">
      <StatusBar state={state} client={client} command={command} setBackendUrl={connectBackend} disconnectBackend={disconnectBackend} />
      <nav className="tabs">
        {tabs.map((item) => (
          <button key={item} className={item === tab ? "active" : ""} onClick={() => setTab(item)}>
            {item}
          </button>
        ))}
      </nav>
      <main className="tab-panels">
        <div className={tabPanelClass("Monitor")} data-tab="Monitor" aria-hidden={tab !== "Monitor"}>
          <MemoMonitorPanel
            state={stateForPanel("Monitor")}
            client={client}
            command={command}
            active={tab === "Monitor"}
            tzOhm={tzOhm}
            pdZeroAdcCode={pdZeroAdcCode}
            monitorSamplesRef={monitorSamplesRef}
          />
        </div>
        <div className={tabPanelClass("TEC")} data-tab="TEC" aria-hidden={tab !== "TEC"}>
          <MemoTecPanel
            state={stateForPanel("TEC")}
            client={client}
            command={command}
            active={tab === "TEC"}
            monitorSamplesRef={monitorSamplesRef}
          />
        </div>
        <div className={tabPanelClass("Laser")} data-tab="Laser" aria-hidden={tab !== "Laser"}>
          <MemoLaserPanel state={stateForPanel("Laser")} client={client} command={command} active={tab === "Laser"} />
        </div>
        <div className={tabPanelClass("Lock")} data-tab="Lock" aria-hidden={tab !== "Lock"}>
          <MemoLockPanel
            state={stateForPanel("Lock")}
            client={client}
            command={command}
            active={tab === "Lock"}
            tzOhm={tzOhm}
            pdZeroAdcCode={pdZeroAdcCode}
            monitorSamplesRef={monitorSamplesRef}
          />
        </div>
        <div className={tabPanelClass("ADA")} data-tab="ADA" aria-hidden={tab !== "ADA"}>
          <MemoAdaPanel
            state={stateForPanel("ADA")}
            client={client}
            command={command}
            active={tab === "ADA"}
            tzOhm={tzOhm}
            tzOhmText={tzOhmText}
            setTzOhmText={setTzOhmText}
            pdZeroAdcCode={pdZeroAdcCode}
            pdZeroAdcCodeText={pdZeroAdcCodeText}
            setPdZeroAdcCodeText={setPdZeroAdcCodeText}
          />
        </div>
        <div className={tabPanelClass("PA Imaging")} data-tab="PA Imaging" aria-hidden={tab !== "PA Imaging"}>
          <MemoPaImagingPanel
            state={stateForPaImagingPanel()}
            client={client}
            command={command}
            active={tab === "PA Imaging"}
            tzOhm={tzOhm}
            pdZeroAdcCode={pdZeroAdcCode}
          />
        </div>
        <div className={tabPanelClass("Settings")} data-tab="Settings" aria-hidden={tab !== "Settings"}>
          <MemoSettingsPanel
            state={stateForPanel("Settings")}
            client={client}
            command={command}
            active={tab === "Settings"}
          />
        </div>
        <div className={tabPanelClass("Debug")} data-tab="Debug" aria-hidden={tab !== "Debug"}>
          <MemoDebugPanel state={stateForPanel("Debug")} client={client} command={command} active={tab === "Debug"} />
        </div>
      </main>
    </div>
  );
}
