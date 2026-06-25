import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../App";

const storage: Record<string, string> = {};

describe("App tab lifecycle", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage[key] ?? null,
      setItem: (key: string, value: string) => {
        storage[key] = value;
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    Object.keys(storage).forEach((key) => delete storage[key]);
  });

  it("keeps tab panels mounted so local page state survives tab switches", () => {
    const html = renderToStaticMarkup(<App />);

    expect(html).toContain('class="tab-panels"');
    expect(html).toContain('data-tab="Overview"');
    expect(html).toContain('data-tab="Lock"');
    expect(html).toContain('data-tab="ADA"');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain("<h2>Side-Fringe Lock</h2>");
    expect(html).toContain("<h2>Photodiode / ADA4355</h2>");
    expect(html).toContain("PD Current Offset uA");
    expect(html).toContain('value="519"');
  });
});
