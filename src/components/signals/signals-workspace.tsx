"use client";

import * as React from "react";

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
  onSelectAllMatching,
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
  onSelectAllMatching: () => void;
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
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden p-6">{children}</div>
    </div>
  );
}
