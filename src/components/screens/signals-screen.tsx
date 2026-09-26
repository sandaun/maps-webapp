"use client";

import * as React from "react";
import type { ValidationIssue } from "@/core/validation/issue";
import type { ProjectPatchInput, ProjectView } from "@/lib/project-types";
import { usePatch } from "@/lib/current-project";
import { useRouter, useSearchParams } from "next/navigation";
import { signalsUsingConversion } from "@/core/conversions/usage";
import { parseConversionFilter, signalsHref, useSignalsTab } from "@/lib/signals-tabs";
import { useWorkspaceChrome } from "@/lib/workspace-chrome";
import { ScreenGate } from "@/components/screens/screen-gate";
import { MeMbsSignalsView } from "@/components/screens/signals-screen-me-mbs";
import { useSignalSelection } from "@/components/screens/use-signal-selection";
import { BulkEditDialog } from "@/components/signals/bulk-edit";
import { ConversionAssignDialog } from "@/components/signals/conversion-assign-dialog";
import { ConversionChainCell } from "@/components/signals/conversion-chain";
import { columnGroupsFor } from "@/components/signals/column-groups";
import { knxMbmColumns, KNX_TAB_ORDER, toKnxRow } from "@/components/signals/columns-knx-mbm";
import { SignalsGrid } from "@/components/signals/signals-grid";
import { SignalsPageChrome } from "@/components/signals/signals-page";
import { ColumnPicker, SignalsFooter, SignalsToolbar } from "@/components/signals/signals-toolbar";
import { SignalsWorkspace } from "@/components/signals/signals-workspace";
import { KNX_COLUMN_GROUPS, KNX_GROUP_LABELS, KNX_GROUP_LABELS_COMPACT } from "@/components/signals/types";
import { useColumnVisibility } from "@/components/signals/use-column-visibility";
import { useGridCompact } from "@/components/signals/use-grid-compact";
import { usePagedSignals, type SignalMapFilter } from "@/components/signals/use-paged-signals";

export function SignalsScreen() {
  return (
    <ScreenGate>
      {(view) =>
        view.family === "me-mbs" ? (
          <SignalsPageChrome issues={view.issues} signalCount={view.project.signals.length} family="me-mbs">
            <MeMbsSignalsView view={view} />
          </SignalsPageChrome>
        ) : (
          <SignalsPageChrome issues={view.issues} signalCount={view.project.signals.length} family="knx-mbm">
            <SignalsView view={view} />
          </SignalsPageChrome>
        )
      }
    </ScreenGate>
  );
}

function signalIdsOf(issues: ValidationIssue[], severity: ValidationIssue["severity"]): Set<number> {
  const ids = new Set<number>();
  for (const issue of issues) {
    if (issue.severity === severity && issue.ref?.entity === "signal" && typeof issue.ref.id === "number") {
      ids.add(issue.ref.id);
    }
  }
  return ids;
}

function SignalsView({
  view,
  onCheckTable,
}: {
  view: Extract<ProjectView, { family: "knx-mbm" }>;
  onCheckTable?: () => void;
}) {
  const applyPatches = usePatch();
  const chrome = useWorkspaceChrome();
  const { setTab, signalId, editConversions } = useSignalsTab();
  const { mbm, signals } = view.project;
  const [search, setSearch] = React.useState("");
  const [filter, setFilter] = React.useState<SignalMapFilter>("all");
  const [hideDisabled, setHideDisabled] = React.useState(false);
  const [colsMenu, setColsMenu] = React.useState(false);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [bulkOpen, setBulkOpen] = React.useState(false);
  const [assigning, setAssigning] = React.useState<number | null>(null);
  const [assignError, setAssignError] = React.useState<string | null>(null);
  const [assignBusy, setAssignBusy] = React.useState(false);
  const allColumns = React.useMemo(
    () =>
      knxMbmColumns(view.project).map((col) =>
        col.id === "conversionChain"
          ? {
              ...col,
              // MAPS makes the cell of virtual signals read-only (IntesisProjectKnxMbm_RT.cs:709-712).
              canOpen: (row: ReturnType<typeof toKnxRow>) => !row.signal.virtual,
              onOpen: (row: ReturnType<typeof toKnxRow>) => {
                setAssignError(null);
                setAssigning(row.signal.id);
              },
              renderContent: (row: ReturnType<typeof toKnxRow>) => <ConversionChainCell chain={row.conversionChain} />,
            }
          : col,
      ),
    [view.project],
  );
  const defaultHidden = React.useMemo(
    () => allColumns.filter((col) => col.defaultHidden).map((col) => col.id),
    [allColumns],
  );
  const visibility = useColumnVisibility("signals-hidden:knx-mbm:v1", defaultHidden);
  const { compact, toggle: toggleCompact } = useGridCompact();

  const conversions = view.project.conversions;
  const router = useRouter();
  const searchParams = useSearchParams();
  const conversionParam = searchParams.get("conversion");
  const conversionFilter = parseConversionFilter(conversionParam);
  const filterEntry = conversionFilter
    ? conversions.filter((c) => (c.type === 0) === (conversionFilter.list === "filters"))[conversionFilter.index]
    : undefined;
  const allRows = React.useMemo(
    () => signals.map((s) => toKnxRow(mbm, s, conversions)),
    [mbm, signals, conversions],
  );
  // "Used by N signals →" of Configuration → Conversions: only the signals that use that entry.
  const rows = React.useMemo(() => {
    const filterRef = parseConversionFilter(conversionParam);
    if (!filterRef) return allRows;
    const using = new Set(signalsUsingConversion(signals, filterRef.list, filterRef.index).map((s) => s.id));
    return allRows.filter((row) => using.has(row.signal.id));
  }, [allRows, signals, conversionParam]);
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

  async function applyConversions(patches: ProjectPatchInput[], inverses?: ProjectPatchInput[]): Promise<boolean> {
    setAssignError(null);
    setAssignBusy(true);
    try {
      await applyPatches(patches);
      chrome.bumpDirty(patches.length);
      if (inverses) chrome.pushUndo({ label: "conversions", patches: inverses });
      return true;
    } catch (err) {
      setAssignError(err instanceof Error ? err.message : "Could not save the conversions.");
      return false;
    } finally {
      setAssignBusy(false);
    }
  }

  // "Open conversions" of a validation issue: the editor of that signal, once per link.
  const editKey = editConversions && signalId !== undefined ? `${signalId}:${searchParams.toString()}` : null;
  const [openedFrom, setOpenedFrom] = React.useState<string | null>(null);
  if (editKey && editKey !== openedFrom) {
    setOpenedFrom(editKey);
    const target = byId.get(signalId!);
    if (target && !target.virtual) {
      setAssignError(null);
      setAssigning(target.id);
    }
  }
  const assigningSignal = assigning === null ? undefined : byId.get(assigning);
  const [bulkConversions, setBulkConversions] = React.useState(false);

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

  function removeChecked() {
    const inverses: ProjectPatchInput[] = [];
    void runPatch(
      checkedList.map((id) => ({ type: "removeSignal" as const, id })),
      "Delete",
      inverses,
    );
    clear();
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
      onDelete={removeChecked}
      onClear={clear}
      onEditField={() => setBulkOpen(true)}
      onConversions={() => {
        setAssignError(null);
        setBulkConversions(true);
      }}
      onSelectAllMatching={() => selectMany(visibleIds)}
    >
      <SignalsToolbar
        search={search}
        onSearch={setSearch}
        placeholder="Search name, group address, device, register…"
        filters={[
          { id: "all", label: "All", count: signals.length },
          { id: "errors", label: "Errors", count: errorCount },
          { id: "warn", label: "Warnings", count: warnCount },
          { id: "disabled", label: "Disabled", count: disabledCount },
        ]}
        activeFilter={filter}
        onFilter={setFilter}
        onAdd={() => void runPatch([{ type: "addSignal" }])}
        columnsOpen={colsMenu}
        onToggleColumns={() => setColsMenu((v) => !v)}
        onImportExport={() => setTab("import")}
        onCheckTable={() => onCheckTable?.()}
      />
      {colsMenu ? (
        <ColumnPicker
          groups={columnGroupsFor(allColumns, KNX_COLUMN_GROUPS)}
          isHidden={visibility.isHidden}
          onToggle={visibility.toggle}
        />
      ) : null}
      {conversionFilter && (
        <p className="mx-[18px] mt-2 flex items-center gap-3 rounded-lg border border-[#C9DEF0] bg-[#F5FAFE] px-4 py-2 text-[12.5px] text-hms-blue">
          <span className="flex-1">
            {`${rows.length} ${rows.length === 1 ? "signal uses" : "signals use"} ${conversionFilter.list === "filters" ? "the filter" : "the operation"} “${filterEntry ? filterEntry.description || "Untitled" : "?"}”.`}
          </span>
          <button
            type="button"
            className="font-bold text-hms-accent hover:text-hms-accent-hover"
            onClick={() => router.push(signalsHref("map"), { scroll: false })}
          >
            Show all signals
          </button>
        </p>
      )}
      {actionError && (
        <p role="alert" className="mx-[18px] mt-2 rounded-lg border border-error/30 bg-error-bg px-4 py-2 text-sm text-error">
          {actionError}
        </p>
      )}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <SignalsGrid
          rows={pageRows}
          columns={columns}
          groupLabels={KNX_GROUP_LABELS}
          compactGroupLabels={KNX_GROUP_LABELS_COMPACT}
          rowId={rowId}
          rowActive={(row) => row.signal.active}
          rowError={(row) => errorIds.has(row.signal.id)}
          selected={checkedIds}
          pageIds={pageIds}
          onToggle={toggle}
          onTogglePage={() => toggleAll(pageIds)}
          applyPatches={applyPatches}
          tabOrder={KNX_TAB_ORDER}
          widthStorageKey="signals-grid-widths:knx-mbm:v1"
          compact={compact}
          onToggleCompact={toggleCompact}
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
      {assigningSignal && (
        <ConversionAssignDialog
          key={assigningSignal.id}
          signal={assigningSignal}
          project={view.project}
          busy={assignBusy}
          error={assignError}
          onClose={() => setAssigning(null)}
          onApply={applyConversions}
        />
      )}
      {bulkConversions && checkedList.length > 0 && (
        <ConversionAssignDialog
          signals={checkedList.map((id) => byId.get(id)).filter((s): s is NonNullable<typeof s> => !!s)}
          project={view.project}
          busy={assignBusy}
          error={assignError}
          onClose={() => setBulkConversions(false)}
          onApply={async (patches, inverses) => {
            const ok = await applyConversions(patches, inverses);
            if (ok) clear();
            return ok;
          }}
        />
      )}
      {bulkOpen && (
        <BulkEditDialog
          columns={columns}
          rows={rows}
          selectedIds={checkedList}
          rowId={rowId}
          onClose={() => setBulkOpen(false)}
          onApply={(patches, inverses) => runPatch(patches, "Edit field", inverses)}
        />
      )}
    </SignalsWorkspace>
  );
}
