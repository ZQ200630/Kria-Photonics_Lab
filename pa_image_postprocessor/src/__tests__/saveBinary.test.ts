import { afterEach, describe, expect, it, vi } from "vitest";
import { saveBinaryFile } from "../utils/saveBinary";

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

describe("saveBinaryFile", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    invokeMock.mockReset();
  });

  it("uses the Tauri save command for desktop downloads", async () => {
    vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
    invokeMock.mockResolvedValue("/tmp/manual.pdf");

    const result = await saveBinaryFile({
      defaultFilename: "manual.pdf",
      bytes: new Uint8Array([1, 2, 3]),
      filters: [{ name: "PDF", extensions: ["pdf"] }],
    });

    expect(result).toBe("/tmp/manual.pdf");
    expect(invokeMock).toHaveBeenCalledWith("save_binary_file", {
      defaultFilename: "manual.pdf",
      contents: [1, 2, 3],
      filters: [{ name: "PDF", extensions: ["pdf"] }],
    });
  });

  it("falls back to an attached browser download link", async () => {
    vi.useFakeTimers();
    const click = vi.fn();
    const link = { href: "", download: "", style: { display: "" }, click };
    const appended: unknown[] = [];
    const removed: unknown[] = [];
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("window", {});
    vi.stubGlobal("document", {
      createElement: (tag: string) => {
        expect(tag).toBe("a");
        return link;
      },
      body: {
        appendChild: (node: unknown) => appended.push(node),
        removeChild: (node: unknown) => removed.push(node),
      },
    });
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:binary"),
      revokeObjectURL,
    });

    const result = await saveBinaryFile({
      defaultFilename: "examples.zip",
      bytes: new Uint8Array([0x50, 0x4b]),
      mime: "application/zip",
    });

    expect(result).toBe("examples.zip");
    expect(link.href).toBe("blob:binary");
    expect(link.download).toBe("examples.zip");
    expect(link.style.display).toBe("none");
    expect(appended).toEqual([link]);
    expect(click).toHaveBeenCalledTimes(1);

    vi.runAllTimers();

    expect(revokeObjectURL).toHaveBeenCalledWith("blob:binary");
    expect(removed).toEqual([link]);
  });
});
