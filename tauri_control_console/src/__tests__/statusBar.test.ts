import { describe, expect, it } from "vitest";
import { connectionButtonAction, connectionButtonState } from "../components/StatusBar";

describe("StatusBar connection button", () => {
  it("shows connection state in the reconnect button", () => {
    expect(connectionButtonState(false, false)).toEqual({
      label: "Disconnected",
      className: "connection-button disconnected",
      disabled: false,
    });
    expect(connectionButtonState(true, false)).toEqual({
      label: "Connected",
      className: "connection-button connected",
      disabled: false,
    });
    expect(connectionButtonState(false, true)).toEqual({
      label: "Connecting...",
      className: "connection-button connecting",
      disabled: true,
    });
  });

  it("uses the connected button as a manual disconnect action", () => {
    expect(connectionButtonAction(true, false)).toBe("disconnect");
    expect(connectionButtonAction(false, false)).toBe("connect");
    expect(connectionButtonAction(false, true)).toBe("wait");
  });
});
