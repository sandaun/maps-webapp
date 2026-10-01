"use client";

import * as React from "react";
import { SignalSelectionBarContext, SignalsSelectionBar, type SignalSelectionActions } from "./signals-selection-bar";

/** Filters and headers stay put; the grid hosts selection actions above its bottom edge. */
export function SignalsWorkspace({ children, ...actions }: SignalSelectionActions & { children: React.ReactNode }) {
  const workspaceRef = React.useRef<HTMLDivElement>(null);
  const { selectedCount, matchingCount, pageFullySelected, onClear } = actions;
  const showSelectAllMatching = pageFullySelected && matchingCount > selectedCount;

  function clearSelection() {
    const focused = document.activeElement;
    // Clearing removes the focused toolbar button; return focus to the table.
    if (focused instanceof HTMLElement && focused.closest('[aria-label="Bulk signal actions"]')) {
      workspaceRef.current?.querySelector<HTMLElement>('[data-testid="signals-scroll"]')?.focus({ preventScroll: true });
    }
    onClear();
  }

  return (
    <SignalSelectionBarContext.Provider value={selectedCount > 0 ? {
      bar: <SignalsSelectionBar {...actions} onClear={clearSelection} />,
      inset: showSelectAllMatching ? 112 : 80,
    } : null}>
      <div ref={workspaceRef} className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
        onKeyDown={(event) => {
          if (event.key !== "Escape" || event.defaultPrevented || selectedCount === 0) return;
          // Editors, pickers and dialogs own Escape while they are open.
          if ((event.target as HTMLElement).closest('input, textarea, [role="combobox"], [role="dialog"]')) return;
          event.preventDefault();
          clearSelection();
        }}
      >
        {children}
      </div>
    </SignalSelectionBarContext.Provider>
  );
}
