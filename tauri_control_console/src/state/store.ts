import type { Spectrum, SystemStatus } from "../api/types";
import type { MonitorSample } from "../utils/monitorSamples";

export type AppState = {
  backendUrl: string;
  connected: boolean;
  stale: boolean;
  lastStatus: SystemStatus | null;
  lastSpectrum: Spectrum | null;
  selectedLockPoint: LockPointSelection | null;
  commandLog: string[];
  trend: MonitorSample[];
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
    return { ...state, connected: true, stale: false, lastStatus: action.status };
  }
  return state;
}
