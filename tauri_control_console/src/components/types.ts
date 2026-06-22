import type { ApiClient } from "../api/client";
import type { AppState } from "../state/store";

export type CommandRunner = (label: string, action: () => Promise<unknown>) => Promise<void>;

export type PanelProps = {
  state: AppState;
  client: ApiClient;
  command: CommandRunner;
  compact?: boolean;
};
