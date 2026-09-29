"use client";

import * as React from "react";
import type { SignalReorder } from "./use-signal-reorder";

/**
 * Viewport-filling Signals layout: the table pane scrolls; bulk actions stay
 * pinned above the grid.
 */
export function SignalsWorkspace({
  selectedCount,
  matchingCount,
  pageFullySelected,
  onEnable,
  onDisable,
  onDelete,
  onClear,
  onEditField,
  onAutoNumber,
  onConversions,
  onSelectAllMatching,
  reorder,
  children,
}: {
  selectedCount: number;
  matchingCount: number;
  pageFullySelected: boolean;
  onEnable: () => void;
  onDisable: () => void;
  onDelete?: () => void;
  onClear: () => void;
  onEditField?: () => void;
  onAutoNumber?: () => void;
  /** KNX–MBM: assign conversions to the selection. */
  onConversions?: () => void;
  onSelectAllMatching: () => void;
  /** Move Up/Down of the selection (families that keep their own signal order). */
  reorder?: SignalReorder;
  children: React.ReactNode;
}) {
  const [confirmDeleteCount, setConfirmDeleteCount] = React.useState<number | null>(null);
  const confirmDelete = confirmDeleteCount === selectedCount;

  const showSelectAllMatching =
    pageFullySelected && matchingCount > selectedCount && matchingCount > 0;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      {selectedCount > 0 && (
        <div
          role="toolbar"
          aria-label="Bulk signal actions"
          className="flex shrink-0 items-center gap-3 border-b border-[#C9DEF0] bg-[#F5FAFE] px-6 py-2.5"
        >
          <span className="text-[12.5px] font-bold text-hms-blue">
            {selectedCount} signal{selectedCount === 1 ? "" : "s"} selected
          </span>
          {showSelectAllMatching && (
            <button
              type="button"
              className="text-[12.5px] font-bold text-hms-accent hover:text-hms-accent-hover"
              onClick={onSelectAllMatching}
            >
              Select all {matchingCount} matching
            </button>
          )}
          {onEditField ? (
            <button
              type="button"
              className="text-[12.5px] font-bold text-hms-accent hover:text-hms-accent-hover"
              onClick={onEditField}
            >
              Edit field…
            </button>
          ) : null}
          {onAutoNumber ? (
            <button type="button" className="text-[12.5px] font-bold text-hms-accent hover:text-hms-accent-hover" onClick={onAutoNumber}>
              Number addresses…
            </button>
          ) : null}
          {onConversions ? (
            <button
              type="button"
              className="text-[12.5px] font-bold text-hms-accent hover:text-hms-accent-hover"
              onClick={onConversions}
            >
              Conversions…
            </button>
          ) : null}
          <button
            type="button"
            className="text-[12.5px] font-bold text-hms-accent hover:text-hms-accent-hover"
            onClick={onEnable}
          >
            Enable
          </button>
          <button
            type="button"
            className="text-[12.5px] font-bold text-hms-accent hover:text-hms-accent-hover"
            onClick={onDisable}
          >
            Disable
          </button>
          {reorder
            ? ([-1, 1] as const).map((direction) => (
                <button
                  key={direction}
                  type="button"
                  title={reorder.filtered ? "Clear filters to reorder signals" : undefined}
                  disabled={!reorder.canMoveSelection(direction)}
                  className="text-[12.5px] font-bold text-hms-accent hover:text-hms-accent-hover disabled:cursor-default disabled:opacity-40 disabled:hover:text-hms-accent"
                  onClick={() => reorder.moveSelection(direction)}
                >
                  {direction < 0 ? "Move up" : "Move down"}
                </button>
              ))
            : null}
          {onDelete ? (
            <button
              type="button"
              className="text-[12.5px] font-bold text-error hover:opacity-80"
              onClick={() => {
                if (!confirmDelete) {
                  setConfirmDeleteCount(selectedCount);
                  return;
                }
                setConfirmDeleteCount(null);
                onDelete();
              }}
            >
              {confirmDelete ? "Confirm delete" : `Delete ${selectedCount}`}
            </button>
          ) : null}
          <div className="flex-1" />
          <button
            type="button"
            className="text-[12.5px] text-fg-muted hover:text-text-body"
            onClick={onClear}
          >
            Clear selection
          </button>
        </div>
      )}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{children}</div>
    </div>
  );
}
