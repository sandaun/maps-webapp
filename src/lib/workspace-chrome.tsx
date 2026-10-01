"use client";

import * as React from "react";
import { PROJECT_PATCHED_EVENT, PROJECT_REPLACED_EVENT, type ProjectPatchedDetail } from "./project-events";
import type { ProjectPatchInput } from "./project-types";

const SIDEBAR_KEY = "maps.sidebarCollapsed";

/** Patches that can renumber signal IDs. */
const SIGNAL_REMOVING = new Set<ProjectPatchInput["type"]>(["removeSignal", "removeDevice", "removeNode", "moveSignal", "addSignals", "undoDeviceTemplate"]);

const sidebarListeners = new Set<() => void>();

function subscribeSidebar(onChange: () => void): () => void {
  sidebarListeners.add(onChange);
  window.addEventListener("storage", onChange);
  return () => {
    sidebarListeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

function readSidebarCollapsed(): boolean {
  return window.localStorage.getItem(SIDEBAR_KEY) === "1";
}

function readSidebarCollapsedServer(): boolean {
  return false;
}

function writeSidebarCollapsed(collapsed: boolean): void {
  window.localStorage.setItem(SIDEBAR_KEY, collapsed ? "1" : "0");
  for (const listener of sidebarListeners) listener();
}

export interface UndoEntry {
  label: string;
  patches: ProjectPatchInput[];
}

export interface WorkspaceChromeState {
  sidebarCollapsed: boolean;
  setSidebarCollapsed: (collapsed: boolean) => void;
  dirtyCount: number;
  bumpDirty: (n?: number) => void;
  undo: UndoEntry | null;
  pushUndo: (entry: UndoEntry) => void;
  clearUndo: (entry?: UndoEntry) => void;
  undoVisible: boolean;
  setUndoVisible: (visible: boolean) => void;
  undoContainer: HTMLElement | null;
  setUndoContainer: (container: HTMLElement | null) => void;
}

const WorkspaceChromeContext = React.createContext<WorkspaceChromeState | null>(null);

export function WorkspaceChromeProvider({ children }: { children: React.ReactNode }) {
  const sidebarCollapsed = React.useSyncExternalStore(
    subscribeSidebar,
    readSidebarCollapsed,
    readSidebarCollapsedServer,
  );
  const [dirtyCount, setDirtyCount] = React.useState(0);
  const [undo, setUndo] = React.useState<UndoEntry | null>(null);
  const [undoDismissed, setUndoDismissed] = React.useState(false);
  const [undoContainer, setUndoContainer] = React.useState<HTMLElement | null>(null);

  const setSidebarCollapsed = React.useCallback((collapsed: boolean) => {
    writeSidebarCollapsed(collapsed);
  }, []);

  const bumpDirty = React.useCallback((n = 1) => {
    setDirtyCount((c) => Math.max(0, c + n));
  }, []);

  const pushUndo = React.useCallback((entry: UndoEntry) => {
    setUndo(entry);
    setUndoDismissed(false);
  }, []);

  // An in-flight undo must not dismiss a newer action saved before it finished.
  const clearUndo = React.useCallback((entry?: UndoEntry) => setUndo((current) => !entry || current === entry ? null : current), []);
  const setUndoVisible = React.useCallback((visible: boolean) => setUndoDismissed(!visible), []);

  // Deleting or moving signals renumbers IDs, so an earlier undo would
  // target different signals even when the signal count stays unchanged.
  React.useEffect(() => {
    const onPatched = (event: Event) => {
      const { patches } = (event as CustomEvent<ProjectPatchedDetail>).detail;
      setUndo((current) => patches.some((patch) => SIGNAL_REMOVING.has(patch.type)) ||
        current?.patches.some((patch) => patch.type === "undoDeviceTemplate") ? null : current);
    };
    // Another project, or a revision written elsewhere: the entry's IDs may
    // now name different signals (the other session may have renumbered them).
    const onReplaced = () => setUndo(null);
    window.addEventListener(PROJECT_PATCHED_EVENT, onPatched);
    window.addEventListener(PROJECT_REPLACED_EVENT, onReplaced);
    return () => {
      window.removeEventListener(PROJECT_PATCHED_EVENT, onPatched);
      window.removeEventListener(PROJECT_REPLACED_EVENT, onReplaced);
    };
  }, []);

  const value = React.useMemo<WorkspaceChromeState>(
    () => ({
      sidebarCollapsed,
      setSidebarCollapsed,
      dirtyCount,
      bumpDirty,
      undo,
      pushUndo,
      clearUndo,
      undoVisible: undo !== null && !undoDismissed,
      setUndoVisible,
      undoContainer,
      setUndoContainer,
    }),
    [sidebarCollapsed, setSidebarCollapsed, dirtyCount, bumpDirty, undo, pushUndo, clearUndo, undoDismissed, setUndoVisible, undoContainer],
  );

  return <WorkspaceChromeContext.Provider value={value}>{children}</WorkspaceChromeContext.Provider>;
}

export function useWorkspaceChrome(): WorkspaceChromeState {
  const ctx = React.useContext(WorkspaceChromeContext);
  if (!ctx) {
    return {
      sidebarCollapsed: false,
      setSidebarCollapsed: () => {},
      dirtyCount: 0,
      bumpDirty: () => {},
      undo: null,
      pushUndo: () => {},
      clearUndo: () => {},
      undoVisible: false,
      setUndoVisible: () => {},
      undoContainer: null,
      setUndoContainer: () => {},
    };
  }
  return ctx;
}
