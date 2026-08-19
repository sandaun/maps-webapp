"use client";

import * as React from "react";
import type { ProjectPatchInput } from "./project-types";

const SIDEBAR_KEY = "maps.sidebarCollapsed";

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
  clearUndo: () => void;
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

  const setSidebarCollapsed = React.useCallback((collapsed: boolean) => {
    writeSidebarCollapsed(collapsed);
  }, []);

  const bumpDirty = React.useCallback((n = 1) => {
    setDirtyCount((c) => Math.max(0, c + n));
  }, []);

  const pushUndo = React.useCallback((entry: UndoEntry) => {
    setUndo(entry);
  }, []);

  const clearUndo = React.useCallback(() => setUndo(null), []);

  const value = React.useMemo<WorkspaceChromeState>(
    () => ({
      sidebarCollapsed,
      setSidebarCollapsed,
      dirtyCount,
      bumpDirty,
      undo,
      pushUndo,
      clearUndo,
    }),
    [sidebarCollapsed, setSidebarCollapsed, dirtyCount, bumpDirty, undo, pushUndo, clearUndo],
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
    };
  }
  return ctx;
}
