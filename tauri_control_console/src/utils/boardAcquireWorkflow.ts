export type BoardAcquireWorkflow = {
  monitoringOn: boolean;
  startMonitoring: () => Promise<unknown>;
  uploadTemplate: () => Promise<unknown>;
  armAcquire: () => Promise<unknown>;
};

export type BoardAcquireStatusView = {
  supported?: boolean;
  enabled?: boolean;
  active?: boolean;
  matched?: boolean;
  cancelled?: boolean;
};

export function boardAcquirePhaseLabel(acquire: BoardAcquireStatusView | undefined, lockActive: boolean): string {
  if (!acquire?.supported) return "Unavailable";
  if (lockActive && acquire.matched) return "Locked";
  if (acquire.active) return "Searching";
  if (acquire.cancelled) return "Cancelled";
  if (acquire.matched) return "Matched";
  if (acquire.enabled) return "Armed";
  return "Idle";
}

export function boardAcquireClickBlocked({
  requestInFlight,
}: {
  requestInFlight: boolean;
  acquireActive: boolean;
}): boolean {
  return requestInFlight;
}

export async function runBoardAcquireWorkflow({
  monitoringOn,
  startMonitoring,
  uploadTemplate,
  armAcquire,
}: BoardAcquireWorkflow): Promise<void> {
  if (!monitoringOn) {
    await startMonitoring();
  }
  await uploadTemplate();
  await armAcquire();
}
