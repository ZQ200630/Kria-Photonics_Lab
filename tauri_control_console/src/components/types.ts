import type { ApiClient } from "../api/client";
import type { AppState } from "../state/store";
import type { MonitorSample } from "../utils/monitorSamples";

export type CommandRunner = (label: string, action: () => Promise<unknown>) => Promise<void>;

export type PanelProps = {
  state: AppState;
  client: ApiClient;
  command: CommandRunner;
  active?: boolean;
  compact?: boolean;
  tzOhm?: number;
  tzOhmText?: string;
  setTzOhmText?: (value: string) => void;
  pdZeroAdcCode?: number;
  pdZeroAdcCodeText?: string;
  setPdZeroAdcCodeText?: (value: string) => void;
  monitorSamplesRef?: { current: MonitorSample[] };
};
