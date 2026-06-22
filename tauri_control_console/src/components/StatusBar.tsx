import { useEffect, useRef, useState } from "react";
import type { ApiClient } from "../api/client";
import type { AppState } from "../state/store";
import type { CommandRunner } from "./types";

type Props = {
  state: AppState;
  client: ApiClient;
  command: CommandRunner;
  setBackendUrl: (url: string) => void;
};

export function connectionButtonState(connected: boolean, connecting: boolean) {
  if (connecting) {
    return {
      label: "Connecting...",
      className: "connection-button connecting",
      disabled: true,
    };
  }
  if (connected) {
    return {
      label: "Connected",
      className: "connection-button connected",
      disabled: false,
    };
  }
  return {
    label: "Disconnected",
    className: "connection-button disconnected",
    disabled: false,
  };
}

export default function StatusBar({ state, client, command, setBackendUrl }: Props) {
  const [url, setUrl] = useState(state.backendUrl);
  const [connecting, setConnecting] = useState(false);
  const reconnectTimer = useRef<number | undefined>();
  const connectionButton = connectionButtonState(state.connected, connecting);

  useEffect(() => {
    setUrl(state.backendUrl);
  }, [state.backendUrl]);

  useEffect(() => {
    if (state.connected) setConnecting(false);
  }, [state.connected]);

  useEffect(() => {
    return () => {
      if (reconnectTimer.current !== undefined) window.clearTimeout(reconnectTimer.current);
    };
  }, []);

  const connect = () => {
    setConnecting(true);
    setBackendUrl(url);
    if (reconnectTimer.current !== undefined) window.clearTimeout(reconnectTimer.current);
    reconnectTimer.current = window.setTimeout(() => setConnecting(false), 1200);
  };

  return (
    <header className="status-bar">
      <div className="brand">
        <strong>Butterfly Laser Control</strong>
        <input className="backend-url" value={url} onChange={(event) => setUrl(event.target.value)} />
        <button className={connectionButton.className} disabled={connectionButton.disabled} onClick={connect}>
          {connectionButton.label}
        </button>
      </div>
      <button className="command danger" onClick={() => command("Emergency Stop", () => client.stopAll())}>
        Emergency Stop
      </button>
    </header>
  );
}
