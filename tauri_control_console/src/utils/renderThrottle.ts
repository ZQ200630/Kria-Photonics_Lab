export type LatestSlot<T> = {
  current: T | null;
};

export function flushLatest<T>(slot: LatestSlot<T>): T | null {
  const value = slot.current;
  slot.current = null;
  return value;
}
