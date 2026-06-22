import type { Spectrum, SystemStatus } from "../api/types";

export type AppState = {
  backendUrl: string;
  connected: boolean;
  stale: boolean;
  lastStatus: SystemStatus | null;
  lastSpectrum: Spectrum | null;
  selectedLockPoint: LockPointSelection | null;
  commandLog: string[];
  trend: Array<{ t: number; temp?: number; target?: number; error?: number; dac?: number; pd?: number }>;
};

export type LockPointSelection = {
  index: number;
  targetAdc: number;
  biasCh1: number;
};

export type AppAction =
  | { type: "connection"; connected: boolean }
  | { type: "status"; timestamp: number; status: SystemStatus }
  | { type: "spectrum"; spectrum: Spectrum }
  | { type: "selectedLockPoint"; selectedLockPoint: LockPointSelection }
  | { type: "log"; message: string }
  | { type: "stale"; stale: boolean }
  | { type: "backendUrl"; backendUrl: string };

export const initialState = (backendUrl: string): AppState => ({
  backendUrl,
  connected: false,
  stale: true,
  lastStatus: null,
  lastSpectrum: null,
  selectedLockPoint: null,
  commandLog: [],
  trend: [],
});

export function reducer(state: AppState, action: AppAction): AppState {
  if (action.type === "connection") return { ...state, connected: action.connected };
  if (action.type === "stale") return { ...state, stale: action.stale };
  if (action.type === "backendUrl") return { ...state, backendUrl: action.backendUrl };
  if (action.type === "spectrum") return { ...state, lastSpectrum: action.spectrum };
  if (action.type === "selectedLockPoint") return { ...state, selectedLockPoint: action.selectedLockPoint };
  if (action.type === "log") return { ...state, commandLog: [action.message, ...state.commandLog].slice(0, 200) };
  if (action.type === "status") {
    const tec = action.status.tec;
    const ada = action.status.ada4355;
    const nextTrend = [
      ...state.trend,
      {
        t: action.timestamp,
        temp: tec.temperature_filtered_celsius ?? tec.temp_filtered_c,
        target: tec.target_celsius ?? tec.target_c,
        error: tec.error_celsius ?? tec.error_c,
        dac: tec.active_dac_code,
        pd: ada.monitor_avg,
      },
    ].slice(-600);
    return { ...state, connected: true, stale: false, lastStatus: action.status, trend: nextTrend };
  }
  return state;
}
