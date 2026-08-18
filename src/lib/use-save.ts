"use client";

import * as React from "react";
import { usePatch } from "./current-project";
import type { ProjectPatchInput } from "./project-types";

/**
 * Shared "save a form card via patch ops" helper: busy flag + error message.
 * The returned view is applied by the provider, so callers only handle errors.
 */
export function useSave() {
  const applyPatches = usePatch();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const save = React.useCallback(
    async (patches: ProjectPatchInput[]): Promise<boolean> => {
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
    [applyPatches],
  );

  return { save, busy, error };
}
