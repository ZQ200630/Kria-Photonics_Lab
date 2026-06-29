import { saveBinaryFile, type SaveBinaryFilter } from "./saveBinary";

export function paDataManualMarkdown(): string {
  return `# Butterfly Laser Driver Data Manual

## Global Data Root

All saved data is written under the global Data Root configured in Settings. Runtime data is grouped by data type and date:

- ada_raw/YYYYMMDD/name_index/
- idle_spectrum/YYYYMMDD/name_index/
- lock_spectrum_pair/YYYYMMDD/name_index/
- monitor_data/YYYYMMDD/name_index/
- pa_image/YYYYMMDD/name_index/
- pa_point_capture/YYYYMMDD/name_index/
- settings_export/YYYYMMDD/name_index/
- spectrum_recording/YYYYMMDD/name_index/
- spectrum_snapshot/YYYYMMDD/name_index/

A record directory contains files only. A parent date directory contains record directories only, so one directory level never mixes files and folders.

## PA legacy .bin

PA image and point-capture raw files use the legacy stream format produced by the server. The file is a sequence of superblocks. Each superblock starts with a 32 byte little-endian header:

- uint64 block_id
- uint32 used_bytes
- uint32 frame_count
- uint64 first_frame_id
- uint64 last_frame_id

The superblock payload contains repeated frame records. Each frame has a 16 byte little-endian header followed by one frame payload:

- uint64 frame_id
- uint32 data_bytes
- uint32 reserved
- data_bytes bytes of payload

The PA payload starts with 32 bytes of metadata, then signed int16 ADC samples.

## PA Metadata Fields

The 32 byte PA metadata block is little-endian:

- uint32 reserved
- uint32 global_shot_idx
- uint16 y_points
- uint16 x_points
- uint16 frame_number
- uint16 frame_idx
- uint16 y_idx
- uint16 x_idx
- int16 current_y
- int16 current_x
- uint32 task_id
- uint32 magic

The GUI uses current_x/current_y as scan coordinates in count units. Physical distance is count_delta * um_per_count. The default calibration is 4000 counts = 530 um.

## PA Image Values

The GUI computes a PTP value for each frame from the selected PTP ROI after subtracting the chosen baseline region. Missing or partial frames are reported in metadata.json and may still be shown when severity is warning. A completely unparsable file is reported as error.

## REST API

The Python examples can operate on saved files directly. For direct control, connect to the server REST API:

- GET /api/status
- GET /api/spectrum
- POST /api/ada/raw-capture
- POST /api/ada/filter
- POST /api/pa/start
- POST /api/pa/stop
- GET /api/pa/scheduler/status
- POST /api/pa/scheduler/config
- POST /api/pa/scheduler/command
- POST /api/pa/scheduler/manual-position
- POST /api/pa/scheduler/pulse
- POST /api/pa/scheduler/waveform
- POST /api/settings
- POST /api/settings/apply

Check the server response for warnings and faults before trusting a long capture.

## metadata.json

Each saved record includes metadata.json when the GUI can produce it. It records the data kind, save time, source paths, ROI settings, scan geometry, ADA conversion settings, and parse warnings.
`;
}

export function paPythonExampleBundle(): string {
  return `#!/usr/bin/env python3
"""
Example readers for Butterfly Laser Driver saved data.

These helpers are intentionally dependency-light. Install numpy and matplotlib
only for plotting:

    python -m pip install numpy matplotlib
"""

from __future__ import annotations

import csv
import json
import struct
from pathlib import Path
from typing import Dict, Iterable, Iterator, List, Optional, Tuple

import numpy as np


SUPERBLOCK_HEADER = struct.Struct("<QIIQQ")
FRAME_HEADER = struct.Struct("<QII")
PA_METADATA = struct.Struct("<IIHHHHHHhhII")
PA_METADATA_BYTES = PA_METADATA.size


def parse_pa_metadata(raw: bytes) -> Dict[str, int]:
    fields = PA_METADATA.unpack(raw[:PA_METADATA_BYTES])
    names = [
        "reserved",
        "global_shot_idx",
        "y_points",
        "x_points",
        "frame_number",
        "frame_idx",
        "y_idx",
        "x_idx",
        "current_y",
        "current_x",
        "task_id",
        "magic",
    ]
    return dict(zip(names, fields))


def parse_pa_legacy_bin(path: str | Path) -> Iterator[Dict[str, object]]:
    data = Path(path).read_bytes()
    offset = 0
    source_index = 0
    while offset + SUPERBLOCK_HEADER.size <= len(data):
        block_id, used_bytes, frame_count, first_frame_id, last_frame_id = SUPERBLOCK_HEADER.unpack_from(data, offset)
        offset += SUPERBLOCK_HEADER.size
        block_end = min(len(data), offset + used_bytes)
        for _ in range(frame_count):
            if offset + FRAME_HEADER.size > block_end:
                break
            frame_id, data_bytes, reserved = FRAME_HEADER.unpack_from(data, offset)
            offset += FRAME_HEADER.size
            payload = data[offset : offset + data_bytes]
            offset += data_bytes
            if len(payload) < PA_METADATA_BYTES:
                continue
            metadata = parse_pa_metadata(payload)
            samples = np.frombuffer(payload[PA_METADATA_BYTES:], dtype="<i2").copy()
            yield {
                "source_index": source_index,
                "block_id": block_id,
                "frame_id": frame_id,
                "reserved": reserved,
                "metadata": metadata,
                "samples": samples,
                "first_frame_id": first_frame_id,
                "last_frame_id": last_frame_id,
            }
            source_index += 1
        offset = block_end


def signed_code_to_current_ua(code: np.ndarray, tz_ohm: float, vfs: float, zero_adc_code: float) -> np.ndarray:
    v_zero = round(zero_adc_code) / 32768.0 * vfs
    v_adc = code.astype(np.float64) / 32768.0 * vfs
    return (v_zero - v_adc) / tz_ohm * 1_000_000.0


def frame_ptp_ua(
    samples: np.ndarray,
    *,
    sample_start: int = 10,
    sample_end_trim: int = 50,
    sample_interval_ns: float = 8.0,
    ptp_start_ns: float = 1600.0,
    ptp_end_ns: float = 2400.0,
    tz_ohm: float = 2000.0,
    vfs: float = 1.0,
) -> float:
    start = sample_start + int(round(ptp_start_ns / sample_interval_ns))
    end = sample_start + int(round(ptp_end_ns / sample_interval_ns))
    end = min(end, len(samples) - sample_end_trim)
    if end <= start:
        return float("nan")
    scale = abs(vfs / (32768.0 * tz_ohm) * 1_000_000.0)
    window = samples[start:end].astype(np.int32)
    return float((window.max() - window.min()) * scale)


def build_ptp_image(path: str | Path, **ptp_kwargs) -> Tuple[np.ndarray, List[Dict[str, int]]]:
    frames = list(parse_pa_legacy_bin(path))
    if not frames:
        raise ValueError("no PA frames found")
    first_meta = frames[0]["metadata"]
    width = int(first_meta["x_points"])
    height = int(first_meta["y_points"])
    sums = np.zeros((height, width), dtype=np.float64)
    counts = np.zeros((height, width), dtype=np.int32)
    metadata_rows: List[Dict[str, int]] = []
    for frame in frames:
        meta = frame["metadata"]
        x = int(meta["x_idx"])
        y = int(meta["y_idx"])
        if 0 <= x < width and 0 <= y < height:
            value = frame_ptp_ua(frame["samples"], **ptp_kwargs)
            if np.isfinite(value):
                sums[y, x] += value
                counts[y, x] += 1
                metadata_rows.append(meta)
    image = np.divide(sums, counts, out=np.full_like(sums, np.nan), where=counts > 0)
    return image, metadata_rows


def load_point_series(path: str | Path, **ptp_kwargs) -> np.ndarray:
    rows = []
    for frame in parse_pa_legacy_bin(path):
        meta = frame["metadata"]
        rows.append(
            (
                int(frame["source_index"]),
                int(frame["frame_id"]),
                int(meta["global_shot_idx"]),
                int(meta["current_x"]),
                int(meta["current_y"]),
                frame_ptp_ua(frame["samples"], **ptp_kwargs),
            )
        )
    dtype = [
        ("source_index", "u8"),
        ("frame_id", "u8"),
        ("global_shot_idx", "u4"),
        ("current_x", "i2"),
        ("current_y", "i2"),
        ("ptp_ua", "f8"),
    ]
    return np.array(rows, dtype=dtype)


def load_ada_raw_csv(path: str | Path) -> np.ndarray:
    return np.genfromtxt(path, delimiter=",", names=True, dtype=None, encoding="utf-8")


def load_spectrum_csv(path: str | Path) -> np.ndarray:
    return np.genfromtxt(path, delimiter=",", names=True, dtype=None, encoding="utf-8")


def load_metadata(record_dir: str | Path) -> Optional[dict]:
    metadata_path = Path(record_dir) / "metadata.json"
    if metadata_path.exists():
        return json.loads(metadata_path.read_text(encoding="utf-8"))
    return None


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("path", help="PA legacy .bin or saved CSV file")
    parser.add_argument("--mode", choices=["pa-image", "point-series", "csv"], default="pa-image")
    args = parser.parse_args()

    if args.mode == "pa-image":
        image, _metadata = build_ptp_image(args.path)
        print("image", image.shape, "finite pixels", np.isfinite(image).sum())
    elif args.mode == "point-series":
        series = load_point_series(args.path)
        print("series", series.shape, "ptp average", float(np.nanmean(series["ptp_ua"])))
    else:
        table = load_ada_raw_csv(args.path)
        print(table.dtype.names, len(table))
`;
}

const textEncoder = new TextEncoder();

function utf8(text: string): Uint8Array {
  return textEncoder.encode(text);
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  parts.forEach((part) => {
    result.set(part, offset);
    offset += part.length;
  });
  return result;
}

function writeU16LE(output: number[], value: number) {
  output.push(value & 0xff, (value >>> 8) & 0xff);
}

function writeU32LE(output: number[], value: number) {
  output.push(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff);
}

function pdfEscape(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function wrapPdfLine(line: string, maxChars = 92): string[] {
  const words = line.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [""];
  const lines: string[] = [];
  let current = "";
  words.forEach((word) => {
    if (!current) {
      current = word;
      return;
    }
    if (current.length + 1 + word.length > maxChars) {
      lines.push(current);
      current = word;
    } else {
      current = `${current} ${word}`;
    }
  });
  if (current) lines.push(current);
  return lines;
}

function manualPdfLines(): string[] {
  const lines: string[] = [];
  paDataManualMarkdown().split("\n").forEach((rawLine) => {
    const line = rawLine
      .replace(/^#\s+/, "")
      .replace(/^##\s+/, "")
      .replace(/^- /, "  - ");
    lines.push(...wrapPdfLine(line));
  });
  return lines;
}

export function paDataManualPdfBytes(): Uint8Array {
  const lines = manualPdfLines();
  const linesPerPage = 48;
  const pages: string[][] = [];
  for (let index = 0; index < lines.length; index += linesPerPage) {
    pages.push(lines.slice(index, index + linesPerPage));
  }
  const safePages = pages.length > 0 ? pages : [["Butterfly Laser Driver Data Manual"]];
  const objects: string[] = [];
  const pageObjectIds: number[] = [];
  const contentObjectIds: number[] = [];
  const addObject = (body: string) => {
    objects.push(body);
    return objects.length;
  };

  addObject("<< /Type /Catalog /Pages 2 0 R >>");
  addObject("");
  addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  safePages.forEach((pageLines) => {
    const pageObjectId = objects.length + 1;
    const contentObjectId = objects.length + 2;
    pageObjectIds.push(pageObjectId);
    contentObjectIds.push(contentObjectId);
    addObject(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentObjectId} 0 R >>`,
    );
    const content = [
      "BT",
      "/F1 10 Tf",
      "50 760 Td",
      "13 TL",
      ...pageLines.map((line) => `(${pdfEscape(line)}) Tj T*`),
      "ET",
    ].join("\n");
    addObject(`<< /Length ${utf8(content).length} >>\nstream\n${content}\nendstream`);
  });
  objects[1] = `<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageObjectIds.length} >>`;

  const chunks: string[] = ["%PDF-1.4\n"];
  const offsets: number[] = [0];
  let byteOffset = utf8(chunks[0]).length;
  objects.forEach((body, index) => {
    const objectText = `${index + 1} 0 obj\n${body}\nendobj\n`;
    offsets.push(byteOffset);
    chunks.push(objectText);
    byteOffset += utf8(objectText).length;
  });
  const xrefOffset = byteOffset;
  const xref = [
    `xref\n0 ${objects.length + 1}`,
    "0000000000 65535 f ",
    ...offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n `),
    "trailer",
    `<< /Size ${objects.length + 1} /Root 1 0 R >>`,
    "startxref",
    String(xrefOffset),
    "%%EOF\n",
  ].join("\n");
  chunks.push(xref);
  return utf8(chunks.join(""));
}

export type PythonExampleZipEntry = {
  path: string;
  contents: string;
};

export function paPythonExampleZipEntries(): PythonExampleZipEntry[] {
  const common = `#!/usr/bin/env python3
"""Shared readers for Butterfly Laser Driver PA legacy binary files."""

from __future__ import annotations

import json
import struct
from pathlib import Path
from typing import Dict, Iterator, List, Optional, Tuple

import numpy as np


SUPERBLOCK_HEADER = struct.Struct("<QIIQQ")
FRAME_HEADER = struct.Struct("<QII")
PA_METADATA = struct.Struct("<IIHHHHHHhhII")
PA_METADATA_BYTES = PA_METADATA.size


def parse_pa_metadata(raw: bytes) -> Dict[str, int]:
    fields = PA_METADATA.unpack(raw[:PA_METADATA_BYTES])
    names = [
        "reserved",
        "global_shot_idx",
        "y_points",
        "x_points",
        "frame_number",
        "frame_idx",
        "y_idx",
        "x_idx",
        "current_y",
        "current_x",
        "task_id",
        "magic",
    ]
    return dict(zip(names, fields))


def parse_pa_legacy_bin(path: str | Path) -> Iterator[Dict[str, object]]:
    data = Path(path).read_bytes()
    offset = 0
    source_index = 0
    while offset + SUPERBLOCK_HEADER.size <= len(data):
        block_id, used_bytes, frame_count, first_frame_id, last_frame_id = SUPERBLOCK_HEADER.unpack_from(data, offset)
        offset += SUPERBLOCK_HEADER.size
        block_end = min(len(data), offset + used_bytes)
        for _ in range(frame_count):
            if offset + FRAME_HEADER.size > block_end:
                break
            frame_id, data_bytes, reserved = FRAME_HEADER.unpack_from(data, offset)
            offset += FRAME_HEADER.size
            payload = data[offset : offset + data_bytes]
            offset += data_bytes
            if len(payload) < PA_METADATA_BYTES:
                continue
            metadata = parse_pa_metadata(payload)
            samples = np.frombuffer(payload[PA_METADATA_BYTES:], dtype="<i2").copy()
            yield {
                "source_index": source_index,
                "block_id": block_id,
                "frame_id": frame_id,
                "reserved": reserved,
                "metadata": metadata,
                "samples": samples,
                "first_frame_id": first_frame_id,
                "last_frame_id": last_frame_id,
            }
            source_index += 1
        offset = block_end


def signed_code_to_current_ua(code: np.ndarray, tz_ohm: float, vfs: float, zero_adc_code: float) -> np.ndarray:
    v_zero = round(zero_adc_code) / 32768.0 * vfs
    v_adc = code.astype(np.float64) / 32768.0 * vfs
    return (v_zero - v_adc) / tz_ohm * 1_000_000.0


def frame_ptp_ua(
    samples: np.ndarray,
    *,
    sample_start: int = 10,
    sample_end_trim: int = 50,
    sample_interval_ns: float = 8.0,
    ptp_start_ns: float = 1600.0,
    ptp_end_ns: float = 2400.0,
    tz_ohm: float = 2000.0,
    vfs: float = 1.0,
) -> float:
    start = sample_start + int(round(ptp_start_ns / sample_interval_ns))
    end = sample_start + int(round(ptp_end_ns / sample_interval_ns))
    end = min(end, len(samples) - sample_end_trim)
    if end <= start:
        return float("nan")
    scale = abs(vfs / (32768.0 * tz_ohm) * 1_000_000.0)
    window = samples[start:end].astype(np.int32)
    return float((window.max() - window.min()) * scale)


def build_ptp_image(path: str | Path, **ptp_kwargs) -> Tuple[np.ndarray, List[Dict[str, int]]]:
    frames = list(parse_pa_legacy_bin(path))
    if not frames:
        raise ValueError("no PA frames found")
    first_meta = frames[0]["metadata"]
    width = int(first_meta["x_points"])
    height = int(first_meta["y_points"])
    sums = np.zeros((height, width), dtype=np.float64)
    counts = np.zeros((height, width), dtype=np.int32)
    metadata_rows: List[Dict[str, int]] = []
    for frame in frames:
        meta = frame["metadata"]
        x = int(meta["x_idx"])
        y = int(meta["y_idx"])
        if 0 <= x < width and 0 <= y < height:
            value = frame_ptp_ua(frame["samples"], **ptp_kwargs)
            if np.isfinite(value):
                sums[y, x] += value
                counts[y, x] += 1
                metadata_rows.append(meta)
    image = np.divide(sums, counts, out=np.full_like(sums, np.nan), where=counts > 0)
    return image, metadata_rows


def load_point_series(path: str | Path, **ptp_kwargs) -> np.ndarray:
    rows = []
    for frame in parse_pa_legacy_bin(path):
        meta = frame["metadata"]
        rows.append(
            (
                int(frame["source_index"]),
                int(frame["frame_id"]),
                int(meta["global_shot_idx"]),
                int(meta["current_x"]),
                int(meta["current_y"]),
                frame_ptp_ua(frame["samples"], **ptp_kwargs),
            )
        )
    dtype = [
        ("source_index", "u8"),
        ("frame_id", "u8"),
        ("global_shot_idx", "u4"),
        ("current_x", "i2"),
        ("current_y", "i2"),
        ("ptp_ua", "f8"),
    ]
    return np.array(rows, dtype=dtype)


def load_metadata(record_dir: str | Path) -> Optional[dict]:
    metadata_path = Path(record_dir) / "metadata.json"
    if metadata_path.exists():
        return json.loads(metadata_path.read_text(encoding="utf-8"))
    return None
`;

  return [
    {
      path: "pa_examples/common_pa_legacy.py",
      contents: common,
    },
    {
      path: "pa_examples/show_pa_image.py",
      contents: `#!/usr/bin/env python3
"""Build and display a PA PTP image from a saved legacy .bin file."""

from __future__ import annotations

import argparse

import matplotlib.pyplot as plt
import numpy as np

from common_pa_legacy import build_ptp_image


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("bin_file")
    parser.add_argument("--ptp-start-ns", type=float, default=1600.0)
    parser.add_argument("--ptp-end-ns", type=float, default=2400.0)
    args = parser.parse_args()

    image, _metadata = build_ptp_image(args.bin_file, ptp_start_ns=args.ptp_start_ns, ptp_end_ns=args.ptp_end_ns)
    print("image", image.shape, "finite pixels", int(np.isfinite(image).sum()))
    plt.imshow(image, origin="lower", cmap="magma")
    plt.colorbar(label="PTP current (uA)")
    plt.xlabel("X index")
    plt.ylabel("Y index")
    plt.show()


if __name__ == "__main__":
    main()
`,
    },
    {
      path: "pa_examples/show_point_series.py",
      contents: `#!/usr/bin/env python3
"""Plot PTP current over repeated point-capture shots."""

from __future__ import annotations

import argparse

import matplotlib.pyplot as plt
import numpy as np

from common_pa_legacy import load_point_series


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("bin_file")
    args = parser.parse_args()

    series = load_point_series(args.bin_file)
    ptp = series["ptp_ua"]
    print("frames", len(series))
    print("PTP average uA", float(np.nanmean(ptp)))
    print("PTP variance uA^2", float(np.nanvar(ptp)))
    print("PTP std uA", float(np.nanstd(ptp)))
    plt.plot(series["source_index"], ptp)
    plt.xlabel("shot index")
    plt.ylabel("PTP current (uA)")
    plt.show()


if __name__ == "__main__":
    main()
`,
    },
    {
      path: "pa_examples/read_ada_raw_csv.py",
      contents: `#!/usr/bin/env python3
"""Read an exported ADA raw CSV file and plot current vs sample index."""

from __future__ import annotations

import argparse

import matplotlib.pyplot as plt
import numpy as np


def load_ada_raw_csv(path: str) -> np.ndarray:
    return np.genfromtxt(path, delimiter=",", names=True, dtype=None, encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("csv_file")
    args = parser.parse_args()

    table = load_ada_raw_csv(args.csv_file)
    print(table.dtype.names, len(table))
    y_name = "pd_current_uA" if "pd_current_uA" in table.dtype.names else table.dtype.names[-1]
    plt.plot(table[y_name])
    plt.xlabel("sample index")
    plt.ylabel(y_name)
    plt.show()


if __name__ == "__main__":
    main()
`,
    },
    {
      path: "pa_examples/read_spectrum_csv.py",
      contents: `#!/usr/bin/env python3
"""Read an exported spectrum CSV file and plot photodiode current."""

from __future__ import annotations

import argparse

import matplotlib.pyplot as plt
import numpy as np


def load_spectrum_csv(path: str) -> np.ndarray:
    return np.genfromtxt(path, delimiter=",", names=True, dtype=None, encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("csv_file")
    args = parser.parse_args()

    table = load_spectrum_csv(args.csv_file)
    print(table.dtype.names, len(table))
    plt.plot(table["time_ms"], table["pd_current_uA"])
    plt.xlabel("time (ms)")
    plt.ylabel("PD current (uA)")
    plt.show()


if __name__ == "__main__":
    main()
`,
    },
    {
      path: "pa_examples/rest_api_client.py",
      contents: `#!/usr/bin/env python3
"""Minimal REST API client for direct control of the Butterfly Laser server."""

from __future__ import annotations

import argparse
import json
from typing import Any, Dict

import requests


class ButterflyClient:
    def __init__(self, base_url: str):
        self.base_url = base_url.rstrip("/")

    def get(self, path: str) -> Dict[str, Any]:
        response = requests.get(f"{self.base_url}{path}", timeout=10)
        response.raise_for_status()
        return response.json()

    def post(self, path: str, payload: Dict[str, Any] | None = None) -> Dict[str, Any]:
        response = requests.post(f"{self.base_url}{path}", json=payload or {}, timeout=20)
        response.raise_for_status()
        return response.json()

    def status(self) -> Dict[str, Any]:
        return self.get("/api/status")

    def abort_pa(self) -> Dict[str, Any]:
        return self.post("/api/pa/stop")

    def start_raw_capture(self, length: int = 16384) -> Dict[str, Any]:
        return self.post("/api/ada/raw-capture", {"length": length})


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="http://192.168.8.236:8080")
    parser.add_argument("--abort-pa", action="store_true")
    args = parser.parse_args()

    client = ButterflyClient(args.host)
    if args.abort_pa:
        print(json.dumps(client.abort_pa(), indent=2))
    else:
        print(json.dumps(client.status(), indent=2))


if __name__ == "__main__":
    main()
`,
    },
    {
      path: "pa_examples/README.md",
      contents: `# Butterfly Laser Driver Python Examples

Install optional plotting dependencies:

    python -m pip install numpy matplotlib requests

Examples:

    python show_pa_image.py /path/to/pa_capture.bin
    python show_point_series.py /path/to/point_capture.bin
    python read_ada_raw_csv.py /path/to/raw.csv
    python read_spectrum_csv.py /path/to/spectrum.csv
    python rest_api_client.py --host http://192.168.8.236:8080
`,
    },
  ];
}

let crc32Table: number[] | undefined;

function getCrc32Table(): number[] {
  if (crc32Table) return crc32Table;
  crc32Table = Array.from({ length: 256 }, (_, index) => {
    let c = index;
    for (let bit = 0; bit < 8; bit += 1) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    return c >>> 0;
  });
  return crc32Table;
}

function crc32(bytes: Uint8Array): number {
  const table = getCrc32Table();
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function paPythonExampleZipBytes(): Uint8Array {
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;
  paPythonExampleZipEntries().forEach((entry) => {
    const nameBytes = utf8(entry.path);
    const dataBytes = utf8(entry.contents);
    const crc = crc32(dataBytes);
    const localHeader: number[] = [];
    writeU32LE(localHeader, 0x04034b50);
    writeU16LE(localHeader, 20);
    writeU16LE(localHeader, 0);
    writeU16LE(localHeader, 0);
    writeU16LE(localHeader, 0);
    writeU16LE(localHeader, 0);
    writeU32LE(localHeader, crc);
    writeU32LE(localHeader, dataBytes.length);
    writeU32LE(localHeader, dataBytes.length);
    writeU16LE(localHeader, nameBytes.length);
    writeU16LE(localHeader, 0);
    localParts.push(new Uint8Array(localHeader), nameBytes, dataBytes);

    const centralHeader: number[] = [];
    writeU32LE(centralHeader, 0x02014b50);
    writeU16LE(centralHeader, 20);
    writeU16LE(centralHeader, 20);
    writeU16LE(centralHeader, 0);
    writeU16LE(centralHeader, 0);
    writeU16LE(centralHeader, 0);
    writeU16LE(centralHeader, 0);
    writeU32LE(centralHeader, crc);
    writeU32LE(centralHeader, dataBytes.length);
    writeU32LE(centralHeader, dataBytes.length);
    writeU16LE(centralHeader, nameBytes.length);
    writeU16LE(centralHeader, 0);
    writeU16LE(centralHeader, 0);
    writeU16LE(centralHeader, 0);
    writeU16LE(centralHeader, 0);
    writeU32LE(centralHeader, 0);
    writeU32LE(centralHeader, offset);
    centralParts.push(new Uint8Array(centralHeader), nameBytes);

    offset += localHeader.length + nameBytes.length + dataBytes.length;
  });
  const centralDirectory = concatBytes(centralParts);
  const end: number[] = [];
  writeU32LE(end, 0x06054b50);
  writeU16LE(end, 0);
  writeU16LE(end, 0);
  writeU16LE(end, paPythonExampleZipEntries().length);
  writeU16LE(end, paPythonExampleZipEntries().length);
  writeU32LE(end, centralDirectory.length);
  writeU32LE(end, offset);
  writeU16LE(end, 0);
  return concatBytes([...localParts, centralDirectory, new Uint8Array(end)]);
}

export type DataDocumentDownload = {
  filename: string;
  label: string;
  mime: string;
  filters: SaveBinaryFilter[];
  contents: () => Uint8Array;
};

export const DATA_DOCUMENT_DOWNLOADS = [
  {
    filename: "butterfly_data_manual.pdf",
    label: "Data Manual",
    mime: "application/pdf",
    filters: [{ name: "PDF", extensions: ["pdf"] }],
    contents: paDataManualPdfBytes,
  },
  {
    filename: "butterfly_python_examples.zip",
    label: "Python Examples",
    mime: "application/zip",
    filters: [{ name: "ZIP", extensions: ["zip"] }],
    contents: paPythonExampleZipBytes,
  },
] as const satisfies readonly DataDocumentDownload[];

export async function downloadDataDocument(filename: (typeof DATA_DOCUMENT_DOWNLOADS)[number]["filename"]): Promise<string | null> {
  const document = DATA_DOCUMENT_DOWNLOADS.find((item) => item.filename === filename);
  if (!document) throw new Error(`Unknown data document ${filename}`);
  return saveBinaryFile({
    defaultFilename: document.filename,
    bytes: document.contents(),
    mime: document.mime,
    filters: document.filters,
  });
}
