import { describe, expect, it } from "vitest";
import {
  DATA_DOCUMENT_DOWNLOADS,
  paDataManualPdfBytes,
  paDataManualMarkdown,
  paPythonExampleZipBytes,
  paPythonExampleZipEntries,
} from "../utils/dataDocumentation";

describe("data documentation downloads", () => {
  it("documents saved data layout, PA legacy bins, metadata fields, and REST API", () => {
    const manual = paDataManualMarkdown();

    expect(manual).toContain("Global Data Root");
    expect(manual).toContain("pa_image/YYYYMMDD/name_index");
    expect(manual).toContain("PA legacy .bin");
    expect(manual).toContain("global_shot_idx");
    expect(manual).toContain("current_x");
    expect(manual).toContain("current_y");
    expect(manual).toContain("/api/status");
    expect(manual).toContain("/api/pa");
    expect(manual).toContain("metadata.json");
  });

  it("generates a PDF data manual for download", () => {
    const pdf = paDataManualPdfBytes();

    expect(new TextDecoder().decode(pdf.slice(0, 5))).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(1000);
  });

  it("provides Python examples for PA image, PA point series, ADA raw, spectrum files, and REST API", () => {
    const entries = paPythonExampleZipEntries();
    const names = entries.map((entry) => entry.path);
    const allCode = entries.map((entry) => entry.contents).join("\n");

    expect(names).toContain("pa_examples/common_pa_legacy.py");
    expect(names).toContain("pa_examples/show_pa_image.py");
    expect(names).toContain("pa_examples/show_point_series.py");
    expect(names).toContain("pa_examples/read_ada_raw_csv.py");
    expect(names).toContain("pa_examples/read_spectrum_csv.py");
    expect(names).toContain("pa_examples/rest_api_client.py");
    expect(allCode).toContain("parse_pa_legacy_bin");
    expect(allCode).toContain("build_ptp_image");
    expect(allCode).toContain("load_point_series");
    expect(allCode).toContain("load_ada_raw_csv");
    expect(allCode).toContain("load_spectrum_csv");
    expect(allCode).toContain("requests");
    expect(allCode).toContain("/api/status");
  });

  it("packages Python examples as a zip file", () => {
    const zip = paPythonExampleZipBytes();

    expect(new TextDecoder().decode(zip.slice(0, 4))).toBe("PK\u0003\u0004");
    expect(new TextDecoder().decode(zip)).toContain("pa_examples/rest_api_client.py");
  });

  it("exposes manual and Python scripts as downloadable files", () => {
    expect(DATA_DOCUMENT_DOWNLOADS.map((item) => item.filename)).toEqual([
      "butterfly_data_manual.pdf",
      "butterfly_python_examples.zip",
    ]);
    expect(DATA_DOCUMENT_DOWNLOADS.map((item) => item.mime)).toEqual([
      "application/pdf",
      "application/zip",
    ]);
  });
});
