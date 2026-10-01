"use client";

import * as React from "react";
import { usePatch } from "@/lib/current-project";
import { useWorkspaceChrome } from "@/lib/workspace-chrome";
import { Button } from "@/components/ui/button";

export function UndoToast() {
  const { undo, clearUndo, bumpDirty } = useWorkspaceChrome();
  const applyPatches = usePatch();
  const [error, setError] = React.useState<string | null>(null);

  if (!undo) return null;

  async function handleUndo() {
    if (!undo) return;
    setError(null);
    try {
      await applyPatches(undo.patches);
      bumpDirty(-undo.patches.length);
      clearUndo();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Undo failed");
    }
  }

  return (
    <div
      role="status"
      className="fixed top-20 right-6 z-40 flex max-w-[calc(100vw-48px)] flex-wrap items-center gap-3 rounded-lg border border-border bg-white px-4 py-2.5 shadow-lg"
    >
      <span className="min-w-0 break-words text-sm text-text-body">
        Saved {undo.label}
        {error ? <span className="ml-2 text-error">{error}</span> : null}
      </span>
      <Button size="sm" variant="secondary" onClick={() => void handleUndo()}>
        Undo
      </Button>
      <button type="button" className="text-xs text-fg-muted hover:text-text-body" onClick={clearUndo} aria-label="Dismiss undo">
        Dismiss
      </button>
    </div>
  );
}
