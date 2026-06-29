import type { PaSchedulerStatus } from "../api/types";

export const PA_SCHED_CMD_START = 1 << 0;
export const PA_SCHED_CMD_STOP = 1 << 1;
export const PA_SCHED_CMD_ABORT_AND_PARK = 1 << 2;
export const PA_SCHED_CMD_SINGLE_PULSE = 1 << 5;

export const PA_SCHED_CTRL_LD_ENABLE = 1 << 0;
export const PA_SCHED_CTRL_ADC_ENABLE = 1 << 1;
export const PA_SCHED_CTRL_CAPTURE_ENABLE = 1 << 2;
export const PA_SCHED_CTRL_RESPECT_DOWNSTREAM_BUSY = 1 << 3;
export const PA_SCHED_CTRL_LOOP_ENABLE = 1 << 4;
export const PA_SCHED_CTRL_MANUAL_LIVE_UPDATE = 1 << 5;

export function schedulerModeLabel(status: PaSchedulerStatus | null | undefined): string {
  const name = status?.mode_name;
  if (!name) return "unknown";
  return name
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function schedulerCaptureText(status: PaSchedulerStatus | null | undefined): string {
  return status?.capture_required ? "Capture chain required" : "Capture chain not required";
}

export function formatSchedulerPosition(status: PaSchedulerStatus | null | undefined): string {
  const x = status?.current_x ?? 0;
  const y = status?.current_y ?? 0;
  return `X ${x}, Y ${y}`;
}
