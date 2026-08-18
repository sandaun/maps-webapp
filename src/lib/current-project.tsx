"use client";

import * as React from "react";
import { ApiError, getProjectView, patchProject } from "./api";
import type { ProjectPatchInput, ProjectView } from "./project-types";

const STORAGE_KEY = "maps.currentProjectId";
const DEFAULT_PROJECT_ID = "demo";
/** Stored value meaning "no project" — an absent key means "use the default". */
const NO_PROJECT_SENTINEL = "none";

export interface CurrentProjectState {
  /** Current project id; `null` = "no project" empty state. */
  projectId: string | null;
  /** True until the stored id has been read and the first fetch settled. */
  loading: boolean;
  view: ProjectView | null;
  error: string | null;
  /** Switch to another project (persisted in localStorage). */
  setProjectId: (id: string) => void;
  /** Re-fetch the current project view. */
  refresh: () => Promise<void>;
  /** POST patches and apply the returned view. Throws ApiError on failure. */
  applyPatches: (patches: ProjectPatchInput[]) => Promise<ProjectView>;
}

/**
 * Inert fallback so components render the "no project" empty state when no
 * provider is mounted (e.g. isolated component tests). The app always mounts
 * the provider in the root layout.
 */
const INERT_STATE: CurrentProjectState = {
  projectId: null,
  loading: false,
  view: null,
  error: null,
  setProjectId: () => {},
  refresh: async () => {},
  applyPatches: async () => {
    throw new Error("No project selected");
  },
};

const CurrentProjectContext = React.createContext<CurrentProjectState>(INERT_STATE);

/* localStorage-backed external store for the current project id. Reading it
 * via useSyncExternalStore keeps SSR/hydration consistent (server snapshot is
 * always `null`, i.e. "not read yet") without setState-in-effect. */

const listeners = new Set<() => void>();

function subscribeProjectId(onChange: () => void): () => void {
  listeners.add(onChange);
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

function readProjectId(): string | null {
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === null) return DEFAULT_PROJECT_ID;
  return stored === NO_PROJECT_SENTINEL ? null : stored;
}

function readProjectIdServer(): string | null {
  return null;
}

function writeProjectId(id: string | null): void {
  window.localStorage.setItem(STORAGE_KEY, id ?? NO_PROJECT_SENTINEL);
  for (const listener of listeners) listener();
}

/** Result of the last fetch, tagged with the id it belongs to. */
type FetchResult = { id: string; view: ProjectView } | { id: string; error: string };

export function CurrentProjectProvider({ children }: { children: React.ReactNode }) {
  const projectId = React.useSyncExternalStore(
    subscribeProjectId,
    readProjectId,
    readProjectIdServer,
  );
  const [result, setResult] = React.useState<FetchResult | null>(null);

  React.useEffect(() => {
    if (projectId === null) return;
    let cancelled = false;
    getProjectView(projectId)
      .then((next) => {
        if (!cancelled) setResult({ id: projectId, view: next });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        // A stored id that no longer exists clears to the "no project" state.
        // The demo project is never auto-created — loading it is explicit.
        if (err instanceof ApiError && err.status === 404) {
          writeProjectId(null);
          return;
        }
        setResult({
          id: projectId,
          error: err instanceof Error ? err.message : "Failed to load project",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // Ignore results that arrived for a previously selected project.
  const current = projectId !== null && result?.id === projectId ? result : null;
  const loading = projectId !== null && current === null;
  const view = current && "view" in current ? current.view : null;
  const error = current && "error" in current ? current.error : null;

  const setProjectId = React.useCallback((id: string) => {
    writeProjectId(id);
  }, []);

  const refresh = React.useCallback(async () => {
    if (projectId === null) return;
    setResult({ id: projectId, view: await getProjectView(projectId) });
  }, [projectId]);

  const applyPatches = React.useCallback(
    async (patches: ProjectPatchInput[]) => {
      if (projectId === null) throw new Error("No project selected");
      const next = await patchProject(projectId, patches);
      setResult({ id: projectId, view: next });
      return next;
    },
    [projectId],
  );

  const value = React.useMemo<CurrentProjectState>(
    () => ({ projectId, loading, view, error, setProjectId, refresh, applyPatches }),
    [projectId, loading, view, error, setProjectId, refresh, applyPatches],
  );

  return <CurrentProjectContext.Provider value={value}>{children}</CurrentProjectContext.Provider>;
}

export function useCurrentProject(): CurrentProjectState {
  return React.useContext(CurrentProjectContext);
}

/** POST patch ops against the current project and apply the returned view. */
export function usePatch(): CurrentProjectState["applyPatches"] {
  return useCurrentProject().applyPatches;
}
