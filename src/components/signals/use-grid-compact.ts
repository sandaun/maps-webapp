import * as React from "react";

const KEY = "signals-grid-compact:v1";
const listeners = new Set<() => void>();
let memory = "0";

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === KEY) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

function read(): string {
  try {
    return window.localStorage.getItem(KEY) ?? "0";
  } catch {
    return memory;
  }
}

function write(value: string) {
  memory = value;
  try {
    window.localStorage.setItem(KEY, value);
  } catch {
    // Compact still updates in memory.
  }
  for (const listener of listeners) listener();
}

export function useGridCompact() {
  const snapshot = React.useSyncExternalStore(subscribe, read, () => "0");
  const compact = snapshot === "1";
  const toggle = React.useCallback(() => write(compact ? "0" : "1"), [compact]);
  return { compact, toggle };
}
