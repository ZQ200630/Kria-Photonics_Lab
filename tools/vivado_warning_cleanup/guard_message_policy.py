#!/usr/bin/env python3
"""Guard the Vivado warning policy against broad or risky downgrades."""

from __future__ import annotations

import argparse
import re
from pathlib import Path


DEFAULT_POLICY = Path("tools/vivado_warning_cleanup/message_severity_policy.tcl")

# These IDs/rules are either real timing/CDC/DRC risks or still need explicit
# human review. They must not be downgraded through message policy.
PROTECTED_IDS = {
    "TIMING-17",
    "TIMING-54",
    "TIMING-9",
    "TIMING-10",
    "TIMING-18",
    "TIMING-24",
    "TIMING-47",
    "DPIR-2",
    "Timing 38-282",
    "Route 35-328",
    "Physopt 32-745",
    "HPDR-1",
    "LUTAR-1",
    "DRC DPIP-2",
    "DRC DPOP-3",
    "DRC DPOP-4",
    "DRC REQP-1769",
    "DRC REQP-1858",
    "DRC RPBF-3",
}

# These are allowed only with an exact string/path fragment, not as a whole-ID
# global severity change.
STRING_SCOPED_IDS = {
    "Synth 8-689",
    "Synth 8-3917",
    "Synth 8-4446",
    "Opt 31-1131",
    "XPM_CDC_GRAY: TCL-1000",
    "IP_Flow 19-1663",
    "IP_Flow 19-4830",
}

# Whole-ID message downgrades accepted as reviewed noise.
ALLOW_GLOBAL_MSG_IDS = {
    "Common 17-1361",
    "Synth 8-7071",
    "Synth 8-7023",
    "Synth 8-7129",
    "Synth 8-7080",
    "Power 33-332",
    "Timing 38-436",
    "DRC XDCB-5",
    "DRC PDCN-1569",
    "DRC RTSTAT-10",
    "DRC AVAL-155",
    "DRC REQP-1701",
}

# DRC/methodology reports use their own severities. Keep this allowlist small.
ALLOW_ADVISORY_RULES = {"XDCB-5", "PDCN-1569", "RTSTAT-10", "AVAL-155", "REQP-1701"}


def strip_comments(text: str) -> str:
    lines = []
    for line in text.splitlines():
        if line.lstrip().startswith("#"):
            continue
        lines.append(line)
    return "\n".join(lines)


def brace_tokens(text: str) -> list[str]:
    return re.findall(r"\{([^{}]+)\}", text)


def collect_simple_foreach_blocks(text: str) -> dict[str, set[str]]:
    """Collect `foreach var { ... } {` token lists used by this policy file."""
    blocks: dict[str, set[str]] = {}
    current_var: str | None = None
    body_lines: list[str] = []

    for line in text.splitlines():
        if current_var is None:
            match = re.match(r"\s*foreach\s+(\w+)\s+\{\s*$", line)
            if match:
                current_var = match.group(1)
                body_lines = []
            continue

        if re.match(r"\s*\}\s+\{\s*$", line):
            tokens = set(brace_tokens("\n".join(body_lines)))
            if tokens:
                blocks[current_var] = tokens
            current_var = None
            body_lines = []
            continue

        body_lines.append(line)

    return blocks


def report_rules_for_line(line: str, foreach_blocks: dict[str, set[str]]) -> set[str]:
    rules: set[str] = set()

    quiet_match = re.search(r"get_(?:methodology|drc)_checks\s+-quiet\s+([^\]\s]+)", line)
    if quiet_match:
        token = quiet_match.group(1)
        if token.startswith("$"):
            rules.update(foreach_blocks.get(token[1:], set()))
        else:
            rules.add(token.strip("{}"))

    return rules


def validate_policy(path: Path) -> list[str]:
    text = strip_comments(path.read_text())
    foreach_blocks = collect_simple_foreach_blocks(text)
    errors: list[str] = []

    for line_no, line in enumerate(text.splitlines(), start=1):
        if "set_msg_config" in line and "-new_severity" in line:
            id_match = re.search(r"-id\s+\{([^{}]+)\}", line)
            ids: set[str] = set()
            if id_match:
                ids.add(id_match.group(1))
            elif "-id $msg_id" in line:
                ids.update(foreach_blocks.get("msg_id", set()))

            if not ids:
                errors.append(f"{path}:{line_no}: unable to identify set_msg_config -id")
                continue

            for msg_id in sorted(ids):
                if msg_id in PROTECTED_IDS:
                    errors.append(f"{path}:{line_no}: protected ID downgraded: {msg_id}")
                if msg_id in STRING_SCOPED_IDS and "-string" not in line:
                    errors.append(f"{path}:{line_no}: scoped ID lacks -string: {msg_id}")
                if (
                    msg_id not in PROTECTED_IDS
                    and msg_id not in STRING_SCOPED_IDS
                    and msg_id not in ALLOW_GLOBAL_MSG_IDS
                ):
                    errors.append(f"{path}:{line_no}: global downgrade not allowlisted: {msg_id}")

        if "get_methodology_checks -quiet" in line or "get_drc_checks -quiet" in line:
            inline_rules = report_rules_for_line(line, foreach_blocks)
            for rule in sorted(inline_rules):
                if rule not in ALLOW_ADVISORY_RULES:
                    errors.append(f"{path}:{line_no}: report severity rule not allowlisted: {rule}")

    for protected_id in sorted(PROTECTED_IDS):
        if re.search(rf"\b{re.escape(protected_id)}\b", text):
            errors.append(f"{path}: protected ID appears in policy body: {protected_id}")

    return errors


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("policy", nargs="?", type=Path, default=DEFAULT_POLICY)
    args = parser.parse_args()

    errors = validate_policy(args.policy)
    if errors:
        print("MESSAGE_POLICY_GUARD_FAILED")
        for error in errors:
            print(error)
        return 1

    print(f"MESSAGE_POLICY_GUARD_OK={args.policy}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
