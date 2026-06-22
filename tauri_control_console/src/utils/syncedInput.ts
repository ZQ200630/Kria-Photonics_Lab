import { useEffect, useState, type ChangeEvent } from "react";

type SyncedInputArgs = {
  value: string;
  readbackValue: string | undefined;
  editing: boolean;
  dirty: boolean;
};

type SyncedInputState = {
  value: string;
  dirty: boolean;
};

type SyncedInputHookState = SyncedInputState & {
  editing: boolean;
};

function parseComparableNumber(value: string): number | undefined {
  const text = value.trim();
  if (text.length === 0) return undefined;
  const parsed = /^0x/i.test(text) ? Number.parseInt(text, 16) : Number(text);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function valuesMatch(left: string, right: string): boolean {
  if (left === right) return true;
  const leftNumber = parseComparableNumber(left);
  const rightNumber = parseComparableNumber(right);
  return leftNumber !== undefined && rightNumber !== undefined && Math.abs(leftNumber - rightNumber) < 1e-9;
}

export function nextSyncedInputValue(currentValue: string, readbackValue: string | undefined, editing: boolean): string {
  if (editing || readbackValue === undefined) {
    return currentValue;
  }
  return readbackValue;
}

export function nextSyncedInputState({ value, readbackValue, editing, dirty }: SyncedInputArgs): SyncedInputState {
  if (readbackValue === undefined) {
    return { value, dirty };
  }
  if (dirty) {
    if (valuesMatch(value, readbackValue)) {
      return { value: readbackValue, dirty: false };
    }
    return { value, dirty: true };
  }
  if (editing) {
    return { value, dirty: false };
  }
  return { value: readbackValue, dirty: false };
}

export function useSyncedInput(readbackValue: string | undefined, fallbackValue: string) {
  const [state, setState] = useState<SyncedInputHookState>({
    value: readbackValue ?? fallbackValue,
    editing: false,
    dirty: false,
  });

  useEffect(() => {
    setState((current) => {
      const next = nextSyncedInputState({
        value: current.value,
        readbackValue,
        editing: current.editing,
        dirty: current.dirty,
      });
      if (next.value === current.value && next.dirty === current.dirty) {
        return current;
      }
      return { ...current, value: next.value, dirty: next.dirty };
    });
  }, [readbackValue]);

  const setDraftValue = (nextValue: string) => {
    setState((current) => ({ ...current, value: nextValue, editing: true, dirty: true }));
  };

  const setValue = (nextValue: string) => {
    setState((current) => ({ ...current, value: nextValue }));
  };

  const release = () => {
    setState((current) => ({ ...current, editing: false }));
  };

  const bind = {
    value: state.value,
    onFocus: () => setState((current) => ({ ...current, editing: true })),
    onBlur: release,
    onChange: (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      setDraftValue(event.target.value);
    },
  };

  return { value: state.value, setValue, setDraftValue, release, bind };
}
