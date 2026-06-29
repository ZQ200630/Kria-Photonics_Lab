import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  STORAGE_DATA_TYPES,
  dateStamp,
  storageMetadataFile,
  storagePreparePaTmp,
  storageTextFile,
  storageWriteRecord,
} from "../utils/storage";

describe("storage utilities", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-29T12:34:56"));
  });

  it("formats local YYYYMMDD date stamps", () => {
    expect(dateStamp()).toBe("20260629");
  });

  it("builds text file payloads", () => {
    expect(storageTextFile("spectrum.csv", "a,b\n")).toEqual({ path: "spectrum.csv", contents: "a,b\n" });
  });

  it("builds metadata JSON files with trailing newline", () => {
    expect(storageMetadataFile({ kind: "raw" })).toEqual({
      path: "metadata.json",
      contents: '{\n  "kind": "raw"\n}\n',
    });
  });

  it("uses a date stamp and data type in browser fallback results", async () => {
    const result = await storageWriteRecord({
      dataType: "spectrum_snapshot",
      name: "latest",
      files: [storageTextFile("spectrum.csv", "x\n")],
    });

    expect(result).toEqual({
      path: "browser downloads: spectrum_snapshot/latest",
      dataType: "spectrum_snapshot",
      dateStamp: "20260629",
      recordName: "latest",
    });
  });

  it("includes PA point capture as a first-class storage data type", () => {
    expect(STORAGE_DATA_TYPES).toContain("pa_point_capture");
  });

  it("has a browser fallback path for point capture temporary files", async () => {
    const result = await storagePreparePaTmp("point_current");

    expect(result.path).toBe("browser-pa-point_current.bin");
  });
});
