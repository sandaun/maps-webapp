"use client";

import * as React from "react";
import type { ValidationIssue } from "@/core/validation/issue";
import type { ProjectPatchInput, ProjectView } from "@/lib/project-types";
import { usePatch } from "@/lib/current-project";
import { useRouter, useSearchParams } from "next/navigation";
import { signalsUsingConversion } from "@/core/conversions/usage";
import { parseConversionFilter, signalsHref, useSignalsTab } from "@/lib/signals-tabs";
import { useWorkspaceChrome } from "@/lib/workspace-chrome";
import { useSignalSelection } from "@/components/screens/use-signal-selection";
import { BulkEditDialog } from "@/components/signals/bulk-edit";
import { AutoNumberDialog } from "@/components/signals/auto-number-dialog";
import { checkMbsObjects, MBS_DEFAULT_MAX_ADDRESS } from "@/protocols/modbus/slave/rules";
import { ConversionAssignDialog } from "@/components/signals/conversion-assign-dialog";
import { ConversionChainCell } from "@/components/signals/conversion-chain";
import { MBS_KNX_CONVERSION_SIDES } from "@/components/signals/conversion-sides";
import { columnGroupsFor } from "@/components/signals/column-groups";
import {
  MBS_KNX_COLUMN_GROUPS,
  MBS_KNX_GROUP_LABELS,
  MBS_KNX_GROUP_LABELS_COMPACT,
  MBS_KNX_TAB_ORDER,
  mbsKnxColumns,
  toMbsKnxRow,
} from "@/components/signals/columns-mbs-knx";
import { SignalsGrid } from "@/components/signals/signals-grid";
import { ColumnPicker, SignalsFooter, SignalsToolbar } from "@/components/signals/signals-toolbar";
import { SignalsWorkspace } from "@/components/signals/signals-workspace";
import { useColumnVisibility } from "@/components/signals/use-column-visibility";
import { useGridCompact } from "@/components/signals/use-grid-compact";
import { usePagedSignals, type SignalMapFilter } from "@/components/signals/use-paged-signals";

function signalIdsOf(issues: ValidationIssue[], severity: ValidationIssue["severity"]): Set<number> {
  const ids = new Set<number>();
  for (const issue of issues) {
    if (issue.severity === severity && issue.ref?.entity === "signal" && typeof issue.ref.id === "number") {
      ids.add(issue.ref.id);
    }
  }
  return ids;
}

/**
 * KNX ↔ Modbus Slave signal map: free rows, as in MAPS (add, remove, edit);
 * the server fits each edit to the MAPS rules. Conversions are assigned with
 * the shared editor, the Modbus object being its internal half.
 */
export function MbsKnxSignalsView({
  view,
  onCheckTable,
}: {
  view: Extract<ProjectView, { family: "mbs-knx" }>;
  onCheckTable?: () => void;
}) {
  const applyPatches = usePatch();
  const chrome = useWorkspaceChrome();
  const { setTab, signalId, editConversions } = useSignalsTab();
  const { signals } = view.project;
  const [search, setSearch] = React.useState("");
  const [filter, setFilter] = React.useState<SignalMapFilter>("all");
  const [hideDisabled, setHideDisabled] = React.useState(false);
  const [colsMenu, setColsMenu] = React.useState(false);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [bulkOpen, setBulkOpen] = React.useState(false);
  const [autoNumberOpen, setAutoNumberOpen] = React.useState(false);
  const [assigning, setAssigning] = React.useState<number | null>(null);
  const [assignError, setAssignError] = React.useState<string | null>(null);
  const [assignBusy, setAssignBusy] = React.useState(false);
  const [bulkConversions, setBulkConversions] = React.useState(false);

  const allColumns = React.useMemo(
    () =>
      mbsKnxColumns(view.project).map((col) =>
        col.id === "conversionChain"
          ? {
              ...col,
              // MAPS makes the button of virtual rows read-only (IntesisProjectMBSKNX_RT.cs:501-504).
              canOpen: (row: ReturnType<typeof toMbsKnxRow>) => !row.signal.virtual,
              onOpen: (row: ReturnType<typeof toMbsKnxRow>) => {
                setAssignError(null);
                setAssigning(row.signal.id);
              },
              renderContent: (row: ReturnType<typeof toMbsKnxRow>) => <ConversionChainCell chain={row.conversionChain} />,
            }
          : col,
      ),
    [view.project],
  );
  const defaultHidden = React.useMemo(
    () => allColumns.filter((col) => col.defaultHidden).map((col) => col.id),
    [allColumns],
  );
  const visibility = useColumnVisibility("signals-hidden:mbs-knx:v1", defaultHidden);
  const { compact, toggle: toggleCompact } = useGridCompact();

  const conversions = view.project.conversions;
  const router = useRouter();
  const searchParams = useSearchParams();
  const conversionParam = searchParams.get("conversion");
  const conversionFilter = parseConversionFilter(conversionParam);
  const filterEntry = conversionFilter
    ? conversions.filter((c) => (c.type === 0) === (conversionFilter.list === "filters"))[conversionFilter.index]
    : undefined;
  const allRows = React.useMemo(() => signals.map((s) => toMbsKnxRow(s, conversions)), [signals, conversions]);
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

  const checkedList = [...checkedIds];

  function setActiveForChecked(active: boolean) {
    const patches = checkedList
      .filter((id) => byId.get(id)?.active !== active)
      .map((id) => ({ type: "updateSignal" as const, id, patch: { active } }));
    const inverses = patches.map((p) => ({ type: "updateSignal" as const, id: p.id, patch: { active: !active } }));
    if (patches.length > 0) void runPatch(patches, active ? "Enable" : "Disable", inverses);
  }

  function removeChecked() {
    void runPatch(checkedList.map((id) => ({ type: "removeSignal" as const, id })), "Delete", []);
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
      onAutoNumber={() => setAutoNumberOpen(true)}
      onConversions={() => {
        setAssignError(null);
        setBulkConversions(true);
      }}
      onSelectAllMatching={() => selectMany(visibleIds)}
    >
      <SignalsToolbar
        search={search}
        onSearch={setSearch}
        placeholder="Search name, register, group address…"
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
          groups={columnGroupsFor(allColumns, MBS_KNX_COLUMN_GROUPS)}
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
          groupLabels={MBS_KNX_GROUP_LABELS}
          compactGroupLabels={MBS_KNX_GROUP_LABELS_COMPACT}
          rowId={rowId}
          rowActive={(row) => row.signal.active}
          rowError={(row) => errorIds.has(row.signal.id)}
          selected={checkedIds}
          pageIds={pageIds}
          onToggle={toggle}
          onTogglePage={() => toggleAll(pageIds)}
          applyPatches={applyPatches}
          tabOrder={MBS_KNX_TAB_ORDER}
          widthStorageKey="signals-grid-widths:mbs-knx:v1"
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
          sides={MBS_KNX_CONVERSION_SIDES}
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
          sides={MBS_KNX_CONVERSION_SIDES}
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
      {autoNumberOpen && (
        <AutoNumberDialog
          family="mbs-knx"
          rows={signals.map((signal) => ({
            id: signal.id,
            description: signal.description,
            virtual: signal.knxVirtual ?? signal.virtual,
            address: signal.modbus.address,
            groupAddress: signal.knx.groupAddress,
            groupAddressLevel: signal.knx.groupAddressLevel,
          }))}
          selectedIds={checkedList}
          registerBase={view.project.mbs.registerBase}
          extendedAddresses={view.project.knx.extendedAddresses}
          collisionWarning={(updates) => {
            const objects = (useUpdates: boolean) => signals.filter((signal) => signal.active).map((signal) => ({
              id: signal.id,
              lenBits: signal.modbus.lenBits,
              format: signal.modbus.format,
              bit: signal.modbus.bit,
              address: useUpdates ? updates.get(signal.id) ?? signal.modbus.address : signal.modbus.address,
              stringLength: signal.modbus.stringLength,
              slaveIndex: signal.modbus.slaveIndex,
            }));
            const options = { maxAddress: MBS_DEFAULT_MAX_ADDRESS, registerBase: view.project.mbs.registerBase };
            const before = new Set(checkMbsObjects(objects(false), options).map((issue) => `${issue.code}:${issue.id}`));
            const introduced = checkMbsObjects(objects(true), options).filter((issue) =>
              issue.code.startsWith("MBS-ADDRESS-") && issue.code !== "MBS-ADDRESS-RANGE" && issue.code !== "MBS-ADDRESS-BASE" && !before.has(`${issue.code}:${issue.id}`),
            );
            return introduced.length ? `${introduced.length} Modbus address collision${introduced.length === 1 ? "" : "s"} would be introduced. Review the preview before applying.` : null;
          }}
          onClose={() => setAutoNumberOpen(false)}
          onApply={async (patches, inverses) => {
            await applyPatches(patches);
            chrome.bumpDirty(patches.length);
            chrome.pushUndo({ label: "Number addresses", patches: inverses });
          }}
        />
      )}
    </SignalsWorkspace>
  );
}
