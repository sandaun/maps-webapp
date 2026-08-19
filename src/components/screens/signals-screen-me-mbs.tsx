"use client";

import * as React from "react";
import type { ProjectPatchInput, ProjectView } from "@/lib/project-types";
import { usePatch } from "@/lib/current-project";
import { useWorkspaceChrome } from "@/lib/workspace-chrome";
import { ScreenIssues } from "@/components/screens/screen-gate";
import { useSignalSelection } from "@/components/screens/use-signal-selection";
import { meMbsColumns, ME_TAB_ORDER, toMeRow } from "@/components/signals/columns-me-mbs";
import { SignalsGrid } from "@/components/signals/signals-grid";
import { SignalsPagination, SignalsToolbar, type ActiveFilter } from "@/components/signals/signals-toolbar";
import { SignalsWorkspace } from "@/components/signals/signals-workspace";
import { ME_GROUP_LABELS } from "@/components/signals/types";
import { usePagedSignals } from "@/components/signals/use-paged-signals";

type View = Extract<ProjectView, { family: "me-mbs" }>;

/** Signals table for a Mitsubishi Electric AC ↔ Modbus Slave project. */
export function MeMbsSignalsView({ view }: { view: View }) {
  const applyPatches = usePatch();
  const chrome = useWorkspaceChrome();
  const { project } = view;
  const { signals } = project;
  const [search, setSearch] = React.useState("");
  const [activeFilter, setActiveFilter] = React.useState<ActiveFilter>("all");
  const [actionError, setActionError] = React.useState<string | null>(null);

  const rows = React.useMemo(() => signals.map((s) => toMeRow(project, s)), [project, signals]);
  const columns = React.useMemo(() => meMbsColumns(project), [project]);
  const activeCount = React.useMemo(() => signals.filter((s) => s.active).length, [signals]);
  const signalIds = React.useMemo(() => signals.map((s) => s.id), [signals]);
  const { selected: checkedIds, toggle, toggleAll, selectMany, clear } = useSignalSelection(signalIds);

  const isActive = React.useCallback((row: (typeof rows)[number]) => row.signal.active, []);
  const searchText = React.useCallback((row: (typeof rows)[number]) => row.searchText, []);
  const rowId = React.useCallback((row: (typeof rows)[number]) => row.signal.id, []);
  const { page, setPage, pageRows, pageCount, visibleIds, pageIds, filtered } = usePagedSignals(
    rows,
    search,
    activeFilter,
    isActive,
    searchText,
    rowId,
  );

  const byId = React.useMemo(() => new Map(signals.map((s) => [s.id, s])), [signals]);
  const errorIds = React.useMemo(() => {
    const ids = new Set<number>();
    for (const issue of view.issues) {
      if (issue.severity === "error" && issue.ref?.entity === "signal" && typeof issue.ref.id === "number") {
        ids.add(issue.ref.id);
      }
    }
    return ids;
  }, [view.issues]);

  async function runPatch(patches: ProjectPatchInput[], undoLabel?: string, inverses?: ProjectPatchInput[]) {
    setActionError(null);
    try {
      await applyPatches(patches);
      chrome.bumpDirty(patches.length);
      if (inverses && inverses.length > 0) {
        chrome.pushUndo({ label: undoLabel ?? "change", patches: inverses });
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Action failed");
    }
  }

  const checkedList = [...checkedIds];

  function setActiveForChecked(active: boolean) {
    const patches = checkedList
      .filter((id) => byId.get(id)?.active !== active)
      .map((id) => ({ type: "updateSignal" as const, id, patch: { active } }));
    const inverses = patches.map((p) => ({
      type: "updateSignal" as const,
      id: p.id,
      patch: { active: !active },
    }));
    if (patches.length > 0) void runPatch(patches, active ? "Enable" : "Disable", inverses);
  }

  return (
    <SignalsWorkspace
      selectedCount={checkedIds.size}
      matchingCount={visibleIds.length}
      pageFullySelected={pageIds.length > 0 && pageIds.every((id) => checkedIds.has(id))}
      onEnable={() => setActiveForChecked(true)}
      onDisable={() => setActiveForChecked(false)}
      onClear={clear}
      onSelectAllMatching={() => selectMany(visibleIds)}
    >
      <ScreenIssues issues={view.issues} screen="signals" />
      <SignalsToolbar
        search={search}
        onSearch={setSearch}
        placeholder="Search name, AC parameter, group, register…"
        activeFilter={activeFilter}
        onFilter={setActiveFilter}
        activeCount={activeCount}
        total={signals.length}
      />
      {actionError && (
        <p role="alert" className="rounded-lg border border-error/30 bg-error-bg px-4 py-2 text-sm text-error">
          {actionError}
        </p>
      )}
      <SignalsGrid
        rows={pageRows}
        columns={columns}
        groupLabels={ME_GROUP_LABELS}
        rowId={rowId}
        rowActive={(row) => row.signal.active}
        rowError={(row) => errorIds.has(row.signal.id)}
        selected={checkedIds}
        pageIds={pageIds}
        onToggle={toggle}
        onTogglePage={() => toggleAll(pageIds)}
        applyPatches={applyPatches}
        tabOrder={ME_TAB_ORDER}
        widthStorageKey="signals-grid-widths:me-mbs:v1"
      />
      <SignalsPagination
        page={page}
        pageCount={pageCount}
        filteredCount={filtered.length}
        total={rows.length}
        onPrev={() => setPage((p) => Math.max(0, p - 1))}
        onNext={() => setPage((p) => p + 1)}
      />
    </SignalsWorkspace>
  );
}
