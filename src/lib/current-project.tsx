"use client";

import * as React from "react";
import { ApiError, getProjectView, patchProject } from "./api";
import {
  PROJECT_PATCHED_EVENT,
  PROJECT_REPLACED_EVENT,
  type ProjectPatchedDetail,
  type ProjectReplacedDetail,
} from "./project-events";
import type { ProjectPatchInput, ProjectView } from "./project-types";

const STORAGE_KEY = "maps.currentProjectId";
const DEFAULT_PROJECT_ID = "demo";
/** Stored value meaning "no project" — an absent key means "use the default". */
const NO_PROJECT_SENTINEL = "none";


export interface CurrentProjectState {
  mutating?: boolean;
  acceptView?: (view: ProjectView) => void;
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
  const mutationQueues = React.useRef(new Map<string, Promise<unknown>>());
  const projectViews = React.useRef(new Map<string, ProjectView>());
  const [pendingMutations, setPendingMutations] = React.useState<Record<string, number>>({});

  /**
   * Adopt a view that is not the result of this client's own mutation. A
   * revision other than the one last seen means the project changed elsewhere.
   */
  const adoptLoadedView = React.useCallback((next: ProjectView) => {
    const previous = projectViews.current.get(next.meta.id);
    projectViews.current.set(next.meta.id, next);
    if (previous && previous.meta.revision !== next.meta.revision) {
      dispatchReplaced({ projectId: next.meta.id, reason: "external" });
    }
    if (readProjectId() === next.meta.id) setResult({ id: next.meta.id, view: next });
  }, []);

  const selectedProject = React.useRef(projectId);
  React.useEffect(() => {
    if (selectedProject.current === projectId) return;
    selectedProject.current = projectId;
    dispatchReplaced({ projectId, reason: "selected" });
  }, [projectId]);

  React.useEffect(() => {
    if (projectId === null) return;
    let cancelled = false;
    getProjectView(projectId)
      .then((next) => {
        if (!cancelled) adoptLoadedView(next);
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
  }, [projectId, adoptLoadedView]);

  // Ignore results that arrived for a previously selected project.
  const current = projectId !== null && result?.id === projectId ? result : null;
  const loading = projectId !== null && current === null;
  const view = current && "view" in current ? current.view : null;
  const error = current && "error" in current ? current.error : null;

  const setProjectId = React.useCallback(
    (id: string) => {
      // Re-selecting the open project (e.g. after re-opening or re-loading it)
      // does not change the id, so load it explicitly instead of editing a
      // stale view until the first save hits a revision conflict.
      if (readProjectId() === id) {
        void getProjectView(id)
          .then(adoptLoadedView)
          .catch(() => undefined);
      }
      writeProjectId(id);
    },
    [adoptLoadedView],
  );

  const acceptView = adoptLoadedView;

  const refresh = React.useCallback(async () => {
    if (projectId === null) return;
    adoptLoadedView(await getProjectView(projectId));
  }, [projectId, adoptLoadedView]);

  const applyPatches = React.useCallback(
    async (patches: ProjectPatchInput[]) => {
      if (projectId === null) throw new Error("No project selected");
      setPendingMutations((counts) => ({ ...counts, [projectId]: (counts[projectId] ?? 0) + 1 }));
      const previous = mutationQueues.current.get(projectId) ?? Promise.resolve();
      const pending = previous.catch(() => {}).then(async () => {
        const before = projectViews.current.get(projectId) ?? null;
        const next = await patchProject(projectId, patches, before?.meta.revision).catch(
          async (error: unknown) => {
            if (!(error instanceof ApiError) || error.code !== "revision-conflict") throw error;
            // Another session changed the project: whatever was keyed by the
            // old state is stale, and loading the new state re-verifies drafts
            // before anything is retried.
            dispatchReplaced({ projectId, reason: "external" });
            const latest = await getProjectView(projectId).catch(() => null);
            if (latest) adoptLoadedView(latest);
            throw new ApiError(
              409,
              latest
                ? "The project was changed elsewhere and has been reloaded. Review your pending changes and try again."
                : "The project was changed elsewhere and could not be reloaded. Reload the project before trying again.",
              error.code,
            );
          },
        );
        projectViews.current.set(projectId, next);
        window.dispatchEvent(new CustomEvent<ProjectPatchedDetail>(PROJECT_PATCHED_EVENT, { detail: { before, next, patches } }));
        if (readProjectId() === projectId) setResult({ id: projectId, view: next });
        return next;
      });
      mutationQueues.current.set(projectId, pending);
      try { return await pending; }
      finally {
        if (mutationQueues.current.get(projectId) === pending) mutationQueues.current.delete(projectId);
        setPendingMutations((counts) => ({ ...counts, [projectId]: Math.max(0, (counts[projectId] ?? 0) - 1) }));
      }
    },
    [projectId, adoptLoadedView],
  );

  const value = React.useMemo<CurrentProjectState>(
    () => ({ projectId, loading, view, error, setProjectId, refresh, applyPatches, acceptView, mutating: !!pendingMutations[projectId ?? ""] }),
    [projectId, loading, view, error, setProjectId, refresh, applyPatches, acceptView, pendingMutations],
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

function dispatchReplaced(detail: ProjectReplacedDetail): void {
  window.dispatchEvent(new CustomEvent<ProjectReplacedDetail>(PROJECT_REPLACED_EVENT, { detail }));
}
