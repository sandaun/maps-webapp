import * as React from "react";

/** Multi-select state for the signal table. Stale ids are dropped when the list changes. */
export function useSignalSelection(signalIds: number[]) {
  const [selected, setSelected] = React.useState(() => new Set<number>());
  const liveKey = signalIds.join(",");
  const visibleSelected = React.useMemo(() => {
    const live = new Set(liveKey === "" ? [] : liveKey.split(",").map((part) => Number(part)));
    return new Set([...selected].filter((id) => live.has(id)));
  }, [liveKey, selected]);

  const toggle = React.useCallback((id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleAll = React.useCallback((ids: number[]) => {
    setSelected((prev) => {
      const allOn = ids.length > 0 && ids.every((id) => prev.has(id));
      const next = new Set(prev);
      if (allOn) {
        for (const id of ids) next.delete(id);
      } else {
        for (const id of ids) next.add(id);
      }
      return next;
    });
  }, []);

  const selectMany = React.useCallback((ids: number[]) => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of ids) next.add(id);
      return next;
    });
  }, []);

  const clear = React.useCallback(() => setSelected(new Set()), []);

  return { selected: visibleSelected, toggle, toggleAll, selectMany, clear };
}
