"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { RotateCcw, X } from "lucide-react";
import { usePatch } from "@/lib/current-project";
import { useWorkspaceChrome } from "@/lib/workspace-chrome";
import { cn } from "@/lib/utils";

/** One undo controller, shown in the grid's upper slot or above the page footer. */
export function UndoPill() {
  const { undo, undoVisible, undoContainer, setUndoVisible, clearUndo, bumpDirty, sidebarCollapsed } = useWorkspaceChrome();
  const applyPatches = usePatch();
  const [failure, setFailure] = React.useState<{ entry: typeof undo; message: string } | null>(null);
  const [busy, setBusy] = React.useState(false);
  const inFlight = React.useRef(false);
  const error = failure?.entry === undo ? failure?.message : null;

  function returnFocus() {
    if (document.activeElement instanceof HTMLElement && document.activeElement.closest('[data-undo-pill]')) {
      (document.querySelector<HTMLElement>('[data-testid="signals-scroll"]') ?? document.getElementById("main-content"))?.focus({ preventScroll: true });
    }
  }

  const handleUndo = React.useCallback(async () => {
    if (!undo || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setFailure(null);
    try {
      await applyPatches(undo.patches);
      bumpDirty(-undo.patches.length);
      returnFocus();
      clearUndo(undo);
    } catch (err) {
      setFailure({ entry: undo, message: err instanceof Error ? err.message : "Undo failed" });
      setUndoVisible(true);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }, [undo, applyPatches, bumpDirty, clearUndo, setUndoVisible]);

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!undo || event.defaultPrevented || event.isComposing || event.repeat || event.shiftKey || event.altKey ||
        !(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "z") return;
      // Native text undo and open editors own their keyboard shortcuts.
      const target = event.target instanceof Element ? event.target : document.activeElement;
      if (target?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="combobox"], [role="dialog"]')) return;
      event.preventDefault();
      void handleUndo();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [undo, handleUndo]);

  if (!undo || !undoVisible) return null;

  const content = (
    <div data-undo-pill className="pointer-events-auto flex max-w-full flex-col items-center gap-2">
      {error && (
        <div role="alert" className="max-w-full rounded-lg border border-error-border bg-white px-3 py-2 text-xs text-error shadow-md">
          Undo failed: {error}. Try Undo again.
        </div>
      )}
      <div role="status" aria-atomic="true" className="flex min-h-10 max-w-full items-center gap-2 rounded-full border border-border bg-white py-[5px] pr-[5px] pl-3.5 text-text-body shadow-[0_6px_18px_rgba(0,30,60,.14)]">
        <span aria-hidden className="size-2 shrink-0 rounded-full bg-[#2E9E5B]" />
        <span title={undo.label} className="min-w-0 truncate text-[12.5px]">{busy ? "Undoing…" : undo.label}</span>
        <button type="button" aria-label="Undo" title={`Undo: ${undo.label} (Ctrl+Z)`} aria-disabled={busy || undefined} aria-busy={busy || undefined}
          onClick={() => void handleUndo()}
          className="inline-flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-full bg-hms-blue px-3 text-[12px] font-bold text-white hover:bg-hms-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hms-accent aria-disabled:cursor-default aria-disabled:opacity-50">
          <RotateCcw size={14} aria-hidden />Undo<kbd aria-hidden className="hidden font-mono text-[10px] font-normal text-white/70 sm:inline">Ctrl+Z</kbd>
        </button>
        <button type="button" aria-label="Dismiss undo" title="Dismiss undo" aria-disabled={busy || undefined}
          className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-full text-fg-muted hover:bg-hms-muted focus-visible:outline-2 focus-visible:outline-hms-accent aria-disabled:cursor-default aria-disabled:opacity-50"
          onClick={() => { if (inFlight.current) return; returnFocus(); setUndoVisible(false); }}><X size={13} aria-hidden /></button>
      </div>
    </div>
  );

  return undoContainer ? createPortal(content, undoContainer) : (
    <div className={cn("pointer-events-none fixed right-4 bottom-20 z-40 flex justify-center", sidebarCollapsed ? "left-[72px]" : "left-[244px]")}>{content}</div>
  );
}
