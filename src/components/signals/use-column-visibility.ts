import * as React from "react";

const listeners = new Map<string, Set<() => void>>();
const memory = new Map<string, string>();

function subscribe(key: string, listener: () => void): () => void {
  const set = listeners.get(key) ?? new Set<() => void>();
  set.add(listener);
  listeners.set(key, set);
  const onStorage = (event: StorageEvent) => {
    if (event.key === key) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    set.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

function read(key: string): string {
  try {
    return window.localStorage.getItem(key) ?? "{}";
  } catch {
    return memory.get(key) ?? "{}";
  }
}

function parse(snapshot: string): Record<string, boolean> {
  try {
    return JSON.parse(snapshot) as Record<string, boolean>;
  } catch {
    return {};
  }
}

function write(key: string, hidden: Record<string, boolean>) {
  const snapshot = JSON.stringify(hidden);
  memory.set(key, snapshot);
  try {
    window.localStorage.setItem(key, snapshot);
  } catch {
    // Visibility still updates in memory.
  }
  for (const listener of listeners.get(key) ?? []) listener();
}

/**
 * Hidden-column map persisted like grid widths (true = hidden). Columns in
 * `defaultHidden` start hidden until the user toggles them.
 */
export function useColumnVisibility(storageKey: string, defaultHidden: readonly string[] = []) {
  const snapshot = React.useSyncExternalStore(
    React.useCallback((listener) => subscribe(storageKey, listener), [storageKey]),
    React.useCallback(() => read(storageKey), [storageKey]),
    () => "{}",
  );
  const hidden = React.useMemo(() => parse(snapshot), [snapshot]);
  const defaults = React.useMemo(() => new Set(defaultHidden), [defaultHidden]);

  const toggle = React.useCallback(
    (id: string) => {
      const current = parse(read(storageKey));
      write(storageKey, { ...current, [id]: !(current[id] ?? defaults.has(id)) });
    },
    [storageKey, defaults],
  );

  const isHidden = React.useCallback((id: string) => hidden[id] ?? defaults.has(id), [hidden, defaults]);

  return { hidden, isHidden, toggle };
}
