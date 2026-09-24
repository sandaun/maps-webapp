"use client";

import * as React from "react";
import { usePatch } from "./current-project";
import { useSaveInProgress } from "./property-drafts";
import type { ProjectPatchInput } from "./project-types";

/**
 * Shared "save a form card via patch ops" helper: busy flag + error message.
 * The returned view is applied by the provider, so callers only handle errors.
 */
export function useSave() {
  const applyPatches = usePatch();
  // Structural edits wait for an in-flight property Save of the same project.
  const locked = useSaveInProgress();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const save = React.useCallback(
    async (patches: ProjectPatchInput[]): Promise<boolean> => {
      if (locked) return false;
      setBusy(true);
      setError(null);
      try {
        await applyPatches(patches);
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Save failed");
        return false;
      } finally {
        setBusy(false);
      }
    },
    [applyPatches, locked],
  );

  return { save, busy: busy || locked, error };
}
