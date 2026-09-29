import * as React from "react";
import { useCurrentProject } from "@/lib/current-project";
import type { ProjectPatchInput } from "@/lib/project-types";
import { useWorkspaceChrome } from "@/lib/workspace-chrome";

export type MoveDirection = -1 | 1;

export interface SignalReorder {
  signalIds: number[];
  /** Search, filters or hidden rows: moving needs the full, unfiltered order. */
  filtered: boolean;
  /** Filtered, moving or another change pending. */
  blocked: boolean;
  moving: boolean;
  error: string | null;
  /** First row of the last move, to scroll it into view. */
  moved: { id: number } | null;
  move: (id: number, toIndex: number, count?: number) => Promise<void>;
  /** Move Up/Down of MAPS: the selection must be consecutive rows. */
  moveSelection: (direction: MoveDirection) => void;
  canMoveSelection: (direction: MoveDirection) => boolean;
}

export function useSignalReorder({
  signalIds,
  selected,
  filtered,
  applyPatches,
  onMoved,
}: {
  signalIds: number[];
  selected: Set<number>;
  filtered: boolean;
  applyPatches: (patches: ProjectPatchInput[]) => Promise<unknown>;
  onMoved: (index: number) => void;
}): SignalReorder {
  const { bumpDirty, pushUndo } = useWorkspaceChrome();
  const { mutating } = useCurrentProject();
  const [moving, setMoving] = React.useState(false);
  const pending = React.useRef(false);
  const [moved, setMoved] = React.useState<{ id: number } | null>(null);
  const selectionKey = [...selected].sort((a, b) => a - b).join(",");
  const [error, setError] = React.useState<{ message: string; selectionKey: string } | null>(null);
  const blocked = filtered || moving || !!mutating;

  const selectedIndexes = signalIds.flatMap((id, index) => (selected.has(id) ? [index] : []));
  const contiguous = selectedIndexes.length === selected.size &&
    selectedIndexes.every((index, offset) => index === selectedIndexes[0] + offset);

  async function move(id: number, toIndex: number, count = 1) {
    if (blocked || pending.current) return;
    const fromIndex = signalIds.indexOf(id);
    if (fromIndex < 0 || toIndex < 0 || toIndex + count > signalIds.length || fromIndex === toIndex) return;
    pending.current = true;
    setMoving(true);
    setError(null);
    try {
      const block = count === 1 ? {} : { count };
      await applyPatches([{ type: "moveSignal", id, toIndex, ...block }]);
      bumpDirty(1);
      pushUndo({ label: "signal order", patches: [{ type: "moveSignal", id: toIndex, toIndex: fromIndex, ...block }] });
      setMoved({ id: toIndex });
      onMoved(toIndex);
    } catch (e) {
      setError({ message: e instanceof Error ? e.message : "Could not move the signal.", selectionKey });
    } finally {
      pending.current = false;
      setMoving(false);
    }
  }

  // Not disabled while a move runs, so a focused button keeps its focus.
  function canMoveSelection(direction: MoveDirection) {
    if (filtered || selectedIndexes.length === 0) return false;
    // A gap is reported on click, like MAPS `message_selectConsecutiveRows`.
    if (!contiguous) return true;
    const toIndex = selectedIndexes[0] + direction;
    return toIndex >= 0 && toIndex + selectedIndexes.length <= signalIds.length;
  }

  function moveSelection(direction: MoveDirection) {
    if (blocked || !canMoveSelection(direction)) return;
    if (!contiguous) {
      setError({ message: "Select consecutive rows to move them.", selectionKey });
      return;
    }
    const start = selectedIndexes[0];
    void move(signalIds[start], start + direction, selectedIndexes.length);
  }

  return {
    signalIds,
    filtered,
    blocked,
    moving,
    error: error && error.selectionKey === selectionKey ? error.message : null,
    moved,
    move,
    moveSelection,
    canMoveSelection,
  };
}
