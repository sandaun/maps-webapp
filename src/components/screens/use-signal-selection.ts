import * as React from "react";
import { PROJECT_PATCHED_EVENT, PROJECT_REPLACED_EVENT, type ProjectPatchedDetail } from "@/lib/project-events";

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

  React.useEffect(() => {
    const onPatched = (event: Event) => {
      const { patches, before, next } = (event as CustomEvent<ProjectPatchedDetail>).detail;
      const move = patches.find((patch) => patch.type === "moveSignal");
      if (!move) return;
      if (!before) { clear(); return; }
      const order = before.project.signals.map((signal) => signal.id);
      const fromIndex = order.indexOf(move.id);
      if (fromIndex < 0) { clear(); return; }
      const block = order.splice(fromIndex, move.count ?? 1);
      order.splice(move.toIndex, 0, ...block);
      const remapped = new Map(order.map((id, index) => [id, next.project.signals[index]?.id]));
      setSelected((previous) => new Set([...previous].flatMap((id) => {
        const updated = remapped.get(id);
        return updated === undefined ? [] : [updated];
      })));
    };
    window.addEventListener(PROJECT_PATCHED_EVENT, onPatched);
    window.addEventListener(PROJECT_REPLACED_EVENT, clear);
    return () => {
      window.removeEventListener(PROJECT_PATCHED_EVENT, onPatched);
      window.removeEventListener(PROJECT_REPLACED_EVENT, clear);
    };
  }, [clear]);

  return { selected: visibleSelected, toggle, toggleAll, selectMany, clear };
}
