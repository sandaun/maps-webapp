"use client";

import * as React from "react";
import type { ProjectPatchInput, ProjectView } from "@/lib/project-types";
import { usePatch } from "@/lib/current-project";
import { useSignalsTab } from "@/lib/signals-tabs";
import { useWorkspaceChrome } from "@/lib/workspace-chrome";
import { useSignalSelection } from "@/components/screens/use-signal-selection";
import { meMbsColumns, ME_TAB_ORDER, toMeRow } from "@/components/signals/columns-me-mbs";
import { SignalsGrid } from "@/components/signals/signals-grid";
import {
  ColumnPicker,
  SignalsFooter,
  SignalsToolbar,
} from "@/components/signals/signals-toolbar";
import { SignalsWorkspace } from "@/components/signals/signals-workspace";
import { ME_COLUMN_GROUPS, ME_GROUP_LABELS } from "@/components/signals/types";
import { useColumnVisibility } from "@/components/signals/use-column-visibility";
import { usePagedSignals, type SignalMapFilter } from "@/components/signals/use-paged-signals";
import type { ValidationIssue } from "@/core/validation/issue";
import { columnGroupsFor } from "@/components/signals/column-groups";

type View = Extract<ProjectView, { family: "me-mbs" }>;

function signalIdsOf(issues: ValidationIssue[], severity: ValidationIssue["severity"]): Set<number> {
  const ids = new Set<number>();
  for (const issue of issues) {
    if (issue.severity === severity && issue.ref?.entity === "signal" && typeof issue.ref.id === "number") {
      ids.add(issue.ref.id);
    }
  }
  return ids;
}

/** Signals table for a Mitsubishi Electric AC ↔ Modbus Slave project. */
export function MeMbsSignalsView({ view, onCheckTable }: { view: View; onCheckTable?: () => void }) {
  const applyPatches = usePatch();
  const chrome = useWorkspaceChrome();
  const { setTab, signalId } = useSignalsTab();
  const { project } = view;
  const { signals } = project;
  const [search, setSearch] = React.useState("");
  const [filter, setFilter] = React.useState<SignalMapFilter>("all");
  const [hideDisabled, setHideDisabled] = React.useState(false);
  const [colsMenu, setColsMenu] = React.useState(false);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const visibility = useColumnVisibility("signals-hidden:me-mbs:v1");

  const rows = React.useMemo(() => signals.map((s) => toMeRow(project, s)), [project, signals]);
  const allColumns = React.useMemo(() => meMbsColumns(project), [project]);
  const columns = React.useMemo(
    () => allColumns.filter((col) => col.group === "project" || !visibility.isHidden(col.id)),
    [allColumns, visibility],
  );
  const activeCount = React.useMemo(() => signals.filter((s) => s.active).length, [signals]);
  const signalIds = React.useMemo(() => signals.map((s) => s.id), [signals]);
  const { selected: checkedIds, toggle, toggleAll, selectMany, clear } = useSignalSelection(signalIds);

  const errorIds = React.useMemo(() => signalIdsOf(view.issues, "error"), [view.issues]);
  const warnIds = React.useMemo(() => signalIdsOf(view.issues, "warning"), [view.issues]);

  const isActive = React.useCallback((row: (typeof rows)[number]) => row.signal.active, []);
  const hasError = React.useCallback((row: (typeof rows)[number]) => errorIds.has(row.signal.id), [errorIds]);
  const hasWarning = React.useCallback((row: (typeof rows)[number]) => warnIds.has(row.signal.id), [warnIds]);
  const searchText = React.useCallback((row: (typeof rows)[number]) => row.searchText, []);
  const rowId = React.useCallback((row: (typeof rows)[number]) => row.signal.id, []);
  const { page, setPage, pageRows, pageCount, visibleIds, pageIds, filtered } = usePagedSignals(
    rows,
    search,
    filter,
    hideDisabled,
    isActive,
    hasError,
    hasWarning,
    searchText,
    rowId,
  );

  const byId = React.useMemo(() => new Map(signals.map((s) => [s.id, s])), [signals]);

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

  const errorCount = view.issues.filter((i) => i.severity === "error").length;
  const warnCount = view.issues.filter((i) => i.severity === "warning").length;
  const disabledCount = signals.length - activeCount;

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
      <SignalsToolbar
        search={search}
        onSearch={setSearch}
        placeholder="Search name, AC parameter, group, register…"
        filters={[
          { id: "all", label: "All", count: signals.length },
          { id: "errors", label: "Errors", count: errorCount },
          { id: "warn", label: "Warnings", count: warnCount },
          { id: "disabled", label: "Disabled", count: disabledCount },
        ]}
        activeFilter={filter}
        onFilter={setFilter}
        columnsOpen={colsMenu}
        onToggleColumns={() => setColsMenu((v) => !v)}
        onImportExport={() => setTab("import")}
        onCheckTable={() => onCheckTable?.()}
      />
      {colsMenu ? (
        <ColumnPicker
          groups={columnGroupsFor(allColumns, ME_COLUMN_GROUPS)}
          isHidden={visibility.isHidden}
          onToggle={visibility.toggle}
        />
      ) : null}
      {actionError && (
        <p role="alert" className="mx-[18px] mt-2 rounded-lg border border-error/30 bg-error-bg px-4 py-2 text-sm text-error">
          {actionError}
        </p>
      )}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
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
          fitRows={rows}
          focusId={signalId}
        />
      </div>
      <SignalsFooter
        shown={filtered.length}
        active={activeCount}
        total={signals.length}
        errors={errorCount}
        warnings={warnCount}
        hideDisabled={hideDisabled}
        onToggleHideDisabled={() => setHideDisabled((v) => !v)}
        page={page}
        pageCount={pageCount}
        onPrev={() => setPage((p) => Math.max(0, p - 1))}
        onNext={() => setPage((p) => p + 1)}
      />
    </SignalsWorkspace>
  );
}
