#!/usr/bin/env python3
"""Summarize current Vivado warnings by reviewed triage category.

This script is intentionally read-only with respect to the Vivado project. It
parses existing logs/reports and writes a markdown summary that can be compared
after each synth/impl rerun.
"""

from __future__ import annotations

import argparse
import os
import re
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path


DEFAULT_VIVADO_ROOT = Path("/home/qian/xilinx/Xilinx/Vivado_Projects/Demo1013")
DEFAULT_MILESTONE_DIR = Path(
    "milestones/vivado_warning_cleanup_20260626_180839"
)


@dataclass(frozen=True)
class Triage:
    priority: str
    decision: str
    classification: str
    recommendation: str


TRIAGE: dict[str, Triage] = {
    "Common 17-1361": Triage(
        "P2",
        "handled-info",
        "Duplicate Vivado message-control rule",
        "Keep INFO policy; this is emitted when the same reviewed set_msg_config rule is reapplied.",
    ),
    "Synth 8-7129": Triage(
        "P2",
        "handled-info",
        "Generated BD/IP no-load or optional port",
        "Keep INFO policy; rerun synthesis to remove from warning count.",
    ),
    "Synth 8-7071": Triage(
        "P2",
        "handled-info",
        "Generated BD/IP unconnected optional port",
        "Keep INFO policy unless a specific status/debug port should be wired.",
    ),
    "Synth 8-7023": Triage(
        "P2",
        "handled-info",
        "Generated BD wrapper connection-count companion warning",
        "Keep INFO policy; same root cause as optional unconnected ports.",
    ),
    "Synth 8-7080": Triage(
        "P2",
        "handled-info",
        "Synthesis parallelism scheduling note",
        "Keep INFO policy.",
    ),
    "Synth 8-689": Triage(
        "P2",
        "handled-info-scoped",
        "Generated AXI crossbar width adaptation",
        "Keep exact-string INFO policy; new width mismatches remain warnings.",
    ),
    "Synth 8-3917": Triage(
        "P2",
        "handled-info-scoped",
        "Deliberate static top-level selects",
        "Keep exact-string INFO policy; remove static assignment if board mode changes.",
    ),
    "Synth 8-4446": Triage(
        "P2",
        "handled-info-scoped",
        "Reviewed unused generated BD placeholders",
        "Keep generated-wrapper line-scoped INFO policy; new unused instances remain warnings.",
    ),
    "IP_Flow 19-1663": Triage(
        "P2",
        "handled-info-scoped",
        "Known duplicate ADI IP repository entry",
        "Keep exact VLNV INFO policy; avoid broad IP_Flow downgrade.",
    ),
    "IP_Flow 19-4830": Triage(
        "P2",
        "handled-info-scoped",
        "Known duplicate ADI interface definition",
        "Keep exact interface VLNV INFO policy; avoid broad IP_Flow downgrade.",
    ),
    "Opt 31-1131": Triage(
        "P2",
        "handled-info-scoped",
        "Generated ILA/AXI SRL retiming limitation",
        "Keep path-scoped INFO policy; user RTL SRL warnings should remain visible.",
    ),
    "Vivado_Tcl 4-921": Triage(
        "P2",
        "fixed-in-flow",
        "Generated empty CDC waiver command",
        "Keep generated-XDC cleanup in implementation pre-hook/report flows; do not suppress globally.",
    ),
    "XPM_CDC_GRAY: TCL-1000": Triage(
        "P2",
        "handled-info-scoped",
        "AXI Quad SPI same-clock async FIFO CDC latency note",
        "Keep AXI_ADA4355_SPI-scoped INFO policy.",
    ),
    "Power 33-332": Triage(
        "P2",
        "handled-info",
        "Power activity estimate caveat",
        "Keep INFO policy; improve SAIF/activity only if power accuracy matters.",
    ),
    "Timing 38-436": Triage(
        "P2",
        "handled-info",
        "Bus-skew report reminder",
        "Keep INFO policy and use report_bus_skew as the real gate.",
    ),
    "Vivado 12-23575": Triage(
        "P0",
        "remaining-review",
        "Methodology critical-violation summary",
        "Do not hide; use report_methodology details as the root-cause source and clear the underlying P0/P1 rules.",
    ),
    "Timing 38-282": Triage(
        "P0",
        "remaining-review",
        "Timing requirements failed summary",
        "Do not hide; inspect post-route timing/pulse-width reports. Historical fallback logs should clear after the current timing-clean rerun.",
    ),
    "Timing 38-164": Triage(
        "P1",
        "remaining-review",
        "Multiple clocks timing-analysis reminder",
        "Review clock interaction and CDC reports; do not suppress before clocking is clean.",
    ),
    "Route 35-328": Triage(
        "P0",
        "remaining-review",
        "Router estimated timing not met",
        "Stage-level timing failure summary; use post-route timing summary as the signoff source.",
    ),
    "Physopt 32-745": Triage(
        "P0",
        "remaining-review",
        "Post-route physopt unlikely to recover large negative slack",
        "Stage-level timing failure summary; fix the timing root cause instead of suppressing it.",
    ),
    "DRC DPIP-2": Triage(
        "P1",
        "remaining-fix",
        "DSP input pipeline missing",
        "Add DSP input pipeline stages where latency permits.",
    ),
    "DRC DPOP-3": Triage(
        "P1",
        "remaining-fix",
        "DSP PREG output pipeline missing",
        "Add DSP output registers or instantiate DSP with PREG enabled.",
    ),
    "DRC DPOP-4": Triage(
        "P1",
        "remaining-fix",
        "DSP MREG multiplier pipeline missing",
        "Add post-multiply pipeline stages or instantiate DSP with MREG/PREG enabled.",
    ),
    "DRC PDCN-1569": Triage(
        "P2",
        "handled-info",
        "Generated/debug LUT equation pin not used",
        "Keep INFO log policy and DRC Advisory severity for current generated/debug hits.",
    ),
    "DRC REQP-1769": Triage(
        "P1",
        "remaining-fix",
        "BRAM WEA bit advisory",
        "In axi_ada4355_capture spectrum0/1 BRAMs; prefer explicit XPM/simple-dual-port RAM coding so narrow BRAM WEA[1] is inactive.",
    ),
    "DRC REQP-1858": Triage(
        "P1",
        "remaining-review",
        "BRAM WRITE_FIRST collision advisory",
        "ADI DMAC store-and-forward RAM; verify no same-address read/write collision, or change generated IP RAM mode/buffering.",
    ),
    "DRC RTSTAT-10": Triage(
        "P2",
        "handled-info",
        "Generated/debug no-routable-load nets",
        "Keep INFO log policy and DRC Advisory severity for current generated/debug hits.",
    ),
    "DRC AVAL-155": Triage(
        "P2",
        "handled-info",
        "ADI AD3552 DDS DSP power-control advisory",
        "Keep INFO log policy and DRC Advisory severity; optional power cleanup only.",
    ),
    "DRC REQP-1701": Triage(
        "P2",
        "handled-info",
        "ADI AD3552 DDS DSP CED power advisory",
        "Keep INFO log policy and DRC Advisory severity; optional power cleanup only.",
    ),
    "NO_ID": Triage(
        "P1",
        "remaining-review",
        "Device-name utility warning without message ID",
        "No bracketed Vivado ID for set_msg_config; confirm bitstream/export/hardware support for xck26-sfvc784-2LVI-i or filter externally.",
    ),
    "DPIP-2": Triage(
        "P1",
        "remaining-fix",
        "DSP input pipeline missing",
        "Add DSP input pipeline stages where latency permits.",
    ),
    "DPOP-3": Triage(
        "P1",
        "remaining-fix",
        "DSP PREG output pipeline missing",
        "Add DSP output registers or instantiate DSP with PREG enabled.",
    ),
    "DPOP-4": Triage(
        "P1",
        "remaining-fix",
        "DSP MREG multiplier pipeline missing",
        "Add post-multiply pipeline stages or instantiate DSP with MREG/PREG enabled.",
    ),
    "PDCN-1569": Triage(
        "P2",
        "handled-advisory",
        "Generated/debug LUT equation pin not used",
        "Keep DRC Advisory severity for current generated/debug hits.",
    ),
    "REQP-1769": Triage(
        "P1",
        "remaining-fix",
        "BRAM WEA bit advisory",
        "In axi_ada4355_capture spectrum0/1 BRAMs; prefer explicit XPM/simple-dual-port RAM coding so narrow BRAM WEA[1] is inactive.",
    ),
    "REQP-1858": Triage(
        "P1",
        "remaining-review",
        "BRAM WRITE_FIRST collision advisory",
        "ADI DMAC store-and-forward RAM; verify no same-address read/write collision, or change generated IP RAM mode/buffering.",
    ),
    "RPBF-3": Triage(
        "P1",
        "remaining-fix",
        "Incomplete IO buffering on switch_in",
        "Source changed to output for BD laser_enable_0; rerun synth/impl to clear old routed report, or instantiate a real IOBUF if board use is bidirectional.",
    ),
    "RTSTAT-10": Triage(
        "P2",
        "handled-advisory",
        "Generated/debug no-routable-load nets",
        "Keep DRC Advisory severity for current generated/debug hits.",
    ),
    "AVAL-155": Triage(
        "P2",
        "handled-advisory",
        "ADI AD3552 DDS DSP power-control advisory",
        "Keep INFO log policy and DRC Advisory severity; optional power cleanup only.",
    ),
    "REQP-1701": Triage(
        "P2",
        "handled-advisory",
        "ADI AD3552 DDS DSP CED power advisory",
        "Keep INFO log policy and DRC Advisory severity; optional power cleanup only.",
    ),
    "TIMING-17": Triage(
        "P0",
        "remaining-fix",
        "ADA4355 SPI fabric clock feedback",
        "Remove SPI_CLK-as-fabric-clock architecture or add a temporary scoped generated clock.",
    ),
    "TIMING-54": Triage(
        "P0",
        "remaining-fix",
        "Scoped max-delay between clk_pl_0 and mmcm_clk_0_s",
        "Trace ADI DMAC constraints and narrow or remove broad between-clock exceptions.",
    ),
    "DPIR-2": Triage(
        "P1",
        "remaining-fix",
        "DSP inputs driven by async-reset registers",
        "Use synchronous reset or no reset on DSP-adjacent registers where safe.",
    ),
    "HPDR-1": Triage(
        "P1",
        "remaining-fix",
        "switch_in direction mismatch",
        "Source changed to output for BD laser_enable_0; rerun synth/impl to clear old methodology report, or instantiate a real IOBUF if board use is bidirectional.",
    ),
    "LUTAR-1": Triage(
        "P1",
        "remaining-review",
        "LUT drives asynchronous reset",
        "Do not globally downgrade; use exact waivers only for reviewed generated/debug hits.",
    ),
    "TIMING-9": Triage(
        "P0",
        "remaining-fix",
        "Unknown CDC logic",
        "Fix custom CDC with XPM CDC, ASYNC_REG, or handshake/snapshot protocols.",
    ),
    "TIMING-10": Triage(
        "P0",
        "remaining-fix",
        "Missing ASYNC_REG on synchronizer",
        "Add ASYNC_REG or replace simple sync chains with XPM_CDC.",
    ),
    "TIMING-18": Triage(
        "P0",
        "remaining-fix",
        "Missing IO delays",
        "Prioritize ADA4355 source-synchronous input delays; classify SPI/GPIO as timed or explicit exceptions.",
    ),
    "TIMING-24": Triage(
        "P0",
        "remaining-fix",
        "Broad clock group overrides FIFO pointer max-delay constraints",
        "Replace broad ADA4355 clock group with point-to-point CDC exceptions.",
    ),
    "TIMING-47": Triage(
        "P0",
        "remaining-fix",
        "Max-delay/false-path between synchronous clocks",
        "Same root family as TIMING-54; narrow or remove broad exceptions.",
    ),
    "XDCB-5": Triage(
        "P2",
        "handled-advisory",
        "Generated ADI XDC query efficiency warning",
        "Keep methodology Advisory severity; patch generated constraints only if build time matters.",
    ),
    "CLKC-30": Triage(
        "P2",
        "advisory-low",
        "AXI clockgen MMCM feedback BUFG advisory",
        "Already Advisory; generated ADI axi_clkgen feedback BUFG, only fix if power/clock resources matter.",
    ),
    "CLKC-56": Triage(
        "P2",
        "advisory-low",
        "AXI clockgen MMCM has no LOC",
        "Already Advisory; LOC the generated axi_clkgen MMCM only if placement stability becomes a concern.",
    ),
}


def rel(path: Path, root: Path) -> str:
    try:
        return str(path.relative_to(root))
    except ValueError:
        return str(path)


def parse_log_warning_counts(path: Path) -> Counter[str]:
    counts: Counter[str] = Counter()
    if not path.exists():
        return counts
    for line in path.read_text(errors="replace").splitlines():
        if "WARNING:" not in line:
            continue
        match = re.search(r"WARNING:\s+\[([^\]]+)\]", line)
        if match:
            counts[match.group(1)] += 1
        else:
            counts["NO_ID"] += 1
    return counts


def parse_report_table(path: Path) -> Counter[str]:
    counts: Counter[str] = Counter()
    if not path.exists():
        return counts
    pattern = re.compile(r"^\|\s*([A-Z0-9_-]+)\s*\|\s*([^|]*?)\s*\|.*\|\s*(\d+)\s*\|")
    for line in path.read_text(errors="replace").splitlines():
        match = pattern.match(line)
        if not match:
            continue
        rule, severity, count_text = match.groups()
        if severity.strip() in {"Warning", "Critical Warning", "Advisory"}:
            counts[rule] = int(count_text)
    return counts


def parse_cdc_summary(path: Path) -> list[tuple[str, str, int, str]]:
    rows: list[tuple[str, str, int, str]] = []
    if not path.exists():
        return rows
    pattern = re.compile(r"^(CDC-\d+)\s+(\S+)\s+(\d+)\s+(.+)$")
    for line in path.read_text(errors="replace").splitlines():
        match = pattern.match(line)
        if match:
            rule, severity, count_text, description = match.groups()
            rows.append((rule, severity, int(count_text), description.strip()))
    return rows


def collect_dsp_modules(impl_log: Path) -> dict[str, Counter[str]]:
    by_rule: dict[str, Counter[str]] = defaultdict(Counter)
    if not impl_log.exists():
        return by_rule
    for line in impl_log.read_text(errors="replace").splitlines():
        match = re.search(r"WARNING:\s+\[DRC (DPIP-2|DPOP-3|DPOP-4)\]", line)
        if not match:
            continue
        module = "unknown"
        module_match = re.search(r"project_1_i/([^/]+)/", line)
        if module_match:
            module = module_match.group(1)
        by_rule[match.group(1)][module] += 1
    return by_rule


def collect_dpir_modules(methodology: Path) -> Counter[str]:
    counts: Counter[str] = Counter()
    if not methodology.exists():
        return counts
    lines = methodology.read_text(errors="replace").splitlines()
    for idx, line in enumerate(lines):
        if not re.match(r"DPIR-2#\d+ Warning", line):
            continue
        window = "\n".join(lines[idx + 1 : idx + 5])
        match = re.search(r"project_1_i/([^/]+)/", window)
        counts[match.group(1) if match else "unknown"] += 1
    return counts


def triage_for(key: str) -> Triage:
    return TRIAGE.get(
        key,
        Triage(
            "P?",
            "unclassified",
            "No reviewed classification yet",
            "Inspect message text and add a triage entry before downgrading.",
        ),
    )


def decision_is_remaining(decision: str) -> bool:
    return decision.startswith("remaining") or decision == "unclassified"


def markdown_table(headers: list[str], rows: list[list[str]]) -> list[str]:
    out = ["| " + " | ".join(headers) + " |"]
    out.append("| " + " | ".join(["---"] * len(headers)) + " |")
    for row in rows:
        out.append("| " + " | ".join(cell.replace("\n", "<br>") for cell in row) + " |")
    return out


def count_remaining(counter: Counter[str]) -> int:
    return sum(count for key, count in counter.items() if decision_is_remaining(triage_for(key).decision))


def choose_existing(primary: Path, fallback: Path) -> tuple[Path, bool]:
    if primary.exists():
        return primary, False
    if fallback.exists():
        return fallback, True
    return primary, False


def render_summary(
    workspace: Path,
    synth_log: Path,
    impl_log: Path,
    drc_report: Path,
    methodology_report: Path,
    cdc_report: Path,
) -> str:
    synth_counts = parse_log_warning_counts(synth_log)
    impl_counts = parse_log_warning_counts(impl_log)
    drc_counts = parse_report_table(drc_report)
    methodology_counts = parse_report_table(methodology_report)
    cdc_rows = parse_cdc_summary(cdc_report)
    dsp_modules = collect_dsp_modules(impl_log)
    dpir_modules = collect_dpir_modules(methodology_report)

    lines: list[str] = []
    lines.append("# Generated Vivado Warning Category Summary")
    lines.append("")
    lines.append(f"Generated: {datetime.now().isoformat(timespec='seconds')}")
    lines.append("")
    lines.append("Sources:")
    for path in [synth_log, impl_log, drc_report, methodology_report, cdc_report]:
        lines.append(f"- `{rel(path, workspace)}`")
    lines.append("")
    lines.append("## Effective Remaining Count")
    lines.append("")
    lines.extend(
        markdown_table(
            ["Source", "Raw count", "Remaining/actionable count"],
            [
                ["Synthesis log warning lines", str(sum(synth_counts.values())), str(count_remaining(synth_counts))],
                ["Implementation log warning lines", str(sum(impl_counts.values())), str(count_remaining(impl_counts))],
                ["Routed DRC rules", str(sum(drc_counts.values())), str(count_remaining(drc_counts))],
                [
                    "Methodology DRC rules",
                    str(sum(methodology_counts.values())),
                    str(count_remaining(methodology_counts)),
                ],
            ],
        )
    )
    lines.append("")

    def add_counter_section(title: str, counter: Counter[str]) -> None:
        rows: list[list[str]] = []
        for key, count in sorted(counter.items(), key=lambda item: (-item[1], item[0])):
            triage = triage_for(key)
            rows.append(
                [
                    key,
                    str(count),
                    triage.priority,
                    triage.decision,
                    triage.classification,
                    triage.recommendation,
                ]
            )
        lines.append(f"## {title}")
        lines.append("")
        if rows:
            lines.extend(
                markdown_table(
                    ["ID/rule", "Count", "Priority", "Decision", "Classification", "Recommended action"],
                    rows,
                )
            )
        else:
            lines.append("_No source file or no matching warnings._")
        lines.append("")

    add_counter_section("Synthesis Log Warning Lines", synth_counts)
    add_counter_section("Implementation Log Warning Lines", impl_counts)
    add_counter_section("Routed DRC Rule Counts", drc_counts)
    add_counter_section("Methodology Rule Counts", methodology_counts)

    lines.append("## CDC Summary")
    lines.append("")
    if cdc_rows:
        rows = []
        for rule, severity, count, description in cdc_rows:
            rows.append([rule, severity, str(count), description])
        lines.extend(markdown_table(["Rule", "Severity", "Count", "Description"], rows))
    else:
        lines.append("_No CDC report found._")
    lines.append("")

    lines.append("## DSP Warning Concentration")
    lines.append("")
    rows = []
    for rule in sorted(dsp_modules):
        for module, count in dsp_modules[rule].most_common():
            rows.append([rule, module, str(count)])
    for module, count in dpir_modules.most_common():
        rows.append(["DPIR-2", module, str(count)])
    if rows:
        lines.extend(markdown_table(["Rule", "Module", "Count"], rows))
    else:
        lines.append("_No DSP module concentration data found._")
    lines.append("")

    lines.append("## Notes")
    lines.append("")
    lines.append("- Counts from old logs still show warnings that are now configured as INFO; rerun synth/impl to refresh raw log counts.")
    lines.append("- The `Remaining/actionable count` treats `remaining-*` and `unclassified` decisions as still needing review or fixes.")
    lines.append("- Do not downgrade P0/P1 timing, CDC, DSP, BRAM, or IO-buffer rules without a reviewed root cause and verification report.")
    lines.append("")
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--vivado-root",
        type=Path,
        default=Path(os.environ.get("DEMO1013_ROOT", DEFAULT_VIVADO_ROOT)),
        help="Demo1013 project root.",
    )
    parser.add_argument(
        "--milestone-dir",
        type=Path,
        default=DEFAULT_MILESTONE_DIR,
        help="Warning cleanup milestone directory.",
    )
    parser.add_argument(
        "--out",
        type=Path,
        default=DEFAULT_MILESTONE_DIR / "warning_category_summary.generated.md",
        help="Output markdown summary.",
    )
    args = parser.parse_args()

    workspace = Path.cwd()
    hardware = args.vivado_root / "hardware" / "xilinx-k26-som-2023.2"
    runs = hardware / "xilinx-k26-som-2023.2.runs"
    fallback_impl_dir = args.milestone_dir / "timing_margin_experiments" / "impl_margin_perf_explore"

    synth_log, used_synth_fallback = choose_existing(
        runs / "synth_1" / "runme.log",
        args.milestone_dir / "logs" / "synth_1_runme.final.log",
    )

    live_impl_log = runs / "impl_margin_perf_explore" / "runme.log"
    live_drc_report = runs / "impl_margin_perf_explore" / "design_top_drc_routed.rpt"
    live_methodology_report = (
        runs / "impl_margin_perf_explore" / "design_top_methodology_drc_routed.rpt"
    )
    live_routed_reports_ready = live_drc_report.exists() and live_methodology_report.exists()

    if live_routed_reports_ready:
        impl_log = live_impl_log
        drc_report = live_drc_report
        methodology_report = live_methodology_report
        used_impl_fallback = False
    else:
        impl_log, _ = choose_existing(
            args.milestone_dir / "logs" / "impl_1_runme.final.log",
            live_impl_log,
        )
        drc_report, _ = choose_existing(
            fallback_impl_dir / "design_top_drc_routed.rpt",
            live_drc_report,
        )
        methodology_report, _ = choose_existing(
            fallback_impl_dir / "design_top_methodology_drc_routed.rpt",
            live_methodology_report,
        )
        used_impl_fallback = True

    cdc_report = args.milestone_dir / "timing_methodology_details" / "cdc_details.rpt"

    summary = render_summary(
        workspace,
        synth_log,
        impl_log,
        drc_report,
        methodology_report,
        cdc_report,
    )
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(summary)
    if used_synth_fallback:
        print(f"SOURCE_FALLBACK_USED=synth_log:{synth_log}")
    if used_impl_fallback:
        print(
            "SOURCE_FALLBACK_USED=implementation_snapshot:"
            f"{impl_log},{drc_report},{methodology_report}"
        )
    print(f"WROTE_WARNING_CATEGORY_SUMMARY={args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
