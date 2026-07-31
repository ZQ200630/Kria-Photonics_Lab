from __future__ import annotations

import io
import json
import math
import sys
from collections.abc import Mapping, Sequence
from typing import Any

import matplotlib as mpl

mpl.use("Agg")
import matplotlib.pyplot as plt


FIGURE_SIZE_INCHES = (8.0, 5.0)
PNG_DPI = 300
AXIS_LABEL_SIZE = 26
LEGEND_SIZE = 18
TICK_SIZE = 15
TITLE_SIZE = 18

mpl.rcParams.update(
    {
        "font.family": "sans-serif",
        "font.sans-serif": ["Arial", "Helvetica", "DejaVu Sans", "sans-serif"],
        "svg.fonttype": "none",
        "pdf.fonttype": 42,
        "font.size": 15,
        "axes.spines.right": False,
        "axes.spines.top": False,
        "axes.linewidth": 1.4,
        "legend.frameon": False,
    }
)


def _finite_float(value: Any, name: str) -> float:
    result = float(value)
    if not math.isfinite(result):
        raise ValueError(f"{name} must be finite")
    return result


def _domain(payload: Mapping[str, Any], count: int) -> tuple[int, int]:
    if count <= 0:
        raise ValueError("time_ns must not be empty")
    raw = payload.get("visible_domain")
    if raw is None:
        return 0, count - 1
    if not isinstance(raw, Mapping):
        raise ValueError("visible_domain must be an object")
    first = round(_finite_float(raw.get("start_index", 0), "start_index"))
    last = round(_finite_float(raw.get("end_index", count - 1), "end_index"))
    start = max(0, min(count - 1, min(first, last)))
    end = max(0, min(count - 1, max(first, last)))
    return start, end


def _visible_series(
    payload: Mapping[str, Any],
) -> tuple[
    list[tuple[str, str, list[float], list[float]]],
    tuple[float, float],
]:
    raw_time = payload.get("time_ns")
    if not isinstance(raw_time, Sequence) or isinstance(raw_time, (str, bytes)):
        raise ValueError("time_ns must be an array")
    time_ns = [_finite_float(value, "time_ns value") for value in raw_time]
    start, end = _domain(payload, len(time_ns))
    raw_series = payload.get("series")
    if not isinstance(raw_series, Sequence) or isinstance(raw_series, (str, bytes)):
        raise ValueError("series must be an array")

    visible: list[tuple[str, str, list[float], list[float]]] = []
    for index, source in enumerate(raw_series):
        if not isinstance(source, Mapping):
            raise ValueError(f"series[{index}] must be an object")
        label = str(source.get("label", "")).strip()
        color = str(source.get("color", "")).strip()
        values = source.get("values")
        if not label or not color:
            raise ValueError(f"series[{index}] requires label and color")
        if not isinstance(values, Sequence) or isinstance(values, (str, bytes)):
            raise ValueError(f"series[{index}].values must be an array")
        offset = max(0, int(source.get("x_offset", 0)))
        series_start = max(start, offset)
        series_end = min(end, offset + len(values) - 1)
        x_us: list[float] = []
        y_ua: list[float] = []
        for global_index in range(series_start, series_end + 1):
            value = _finite_float(
                values[global_index - offset],
                f"series[{index}] value",
            )
            x_us.append(time_ns[global_index] / 1000.0)
            y_ua.append(value)
        if x_us:
            visible.append((label, color, x_us, y_ua))
    if not visible:
        raise ValueError("no visible A-line series to export")
    return visible, (time_ns[start] / 1000.0, time_ns[end] / 1000.0)


def build_figure(payload: Mapping[str, Any]):
    visible, visible_time_us = _visible_series(payload)
    frame_index = max(0, int(payload.get("frame_index", 0)))
    figure, axis = plt.subplots(
        figsize=FIGURE_SIZE_INCHES,
        dpi=PNG_DPI,
        facecolor="white",
    )
    axis.set_facecolor("white")

    all_y: list[float] = []
    for label, color, x_us, y_ua in visible:
        axis.plot(
            x_us,
            y_ua,
            label=label,
            color=color,
            linewidth=2.4,
            alpha=0.96,
            solid_capstyle="round",
            solid_joinstyle="round",
        )
        all_y.extend(y_ua)

    x_min = min(visible_time_us)
    x_max = max(visible_time_us)
    if x_max == x_min:
        x_min -= 0.001
        x_max += 0.001
    axis.set_xlim(x_min, x_max)

    y_min = min(0.0, min(all_y))
    y_max = max(0.0, max(all_y))
    y_span = y_max - y_min or max(1.0, abs(y_min), abs(y_max))
    axis.set_ylim(y_min - 0.06 * y_span, y_max + 0.06 * y_span)

    axis.set_xlabel(
        "Time (µs)",
        fontsize=AXIS_LABEL_SIZE,
        fontweight="bold",
        labelpad=14,
    )
    axis.set_ylabel(
        "Current (µA)",
        fontsize=AXIS_LABEL_SIZE,
        fontweight="bold",
        labelpad=16,
    )
    figure.suptitle(
        f"Processed PA A-line  |  Source frame {frame_index}",
        fontsize=TITLE_SIZE,
        fontweight="bold",
        x=0.18,
        y=0.96,
        ha="left",
    )
    axis.tick_params(
        axis="both",
        which="major",
        labelsize=TICK_SIZE,
        width=1.3,
        length=6,
        direction="out",
    )
    axis.spines["left"].set_linewidth(1.4)
    axis.spines["bottom"].set_linewidth(1.4)
    axis.grid(False)

    legend = axis.legend(
        loc="lower center",
        bbox_to_anchor=(0.5, 1.02),
        fontsize=LEGEND_SIZE,
        frameon=False,
        handlelength=2.2,
        handletextpad=0.7,
        borderaxespad=0.4,
        labelspacing=0.5,
        ncol=min(4, len(visible)),
    )
    for text in legend.get_texts():
        text.set_fontweight("semibold")

    figure.subplots_adjust(left=0.18, right=0.98, bottom=0.20, top=0.72)
    return figure, axis


def render_png(payload: Mapping[str, Any]) -> bytes:
    figure, _axis = build_figure(payload)
    try:
        output = io.BytesIO()
        figure.savefig(
            output,
            format="png",
            dpi=PNG_DPI,
            facecolor="white",
            metadata={
                "Software": "PA Image Post-Processor (Python/Matplotlib)",
                "Title": "Processed PA A-line",
            },
        )
        return output.getvalue()
    finally:
        plt.close(figure)


def main() -> int:
    try:
        payload = json.load(sys.stdin)
        sys.stdout.buffer.write(render_png(payload))
        return 0
    except Exception as error:
        print(f"scientific A-line rendering failed: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
