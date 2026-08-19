"use client";

import * as React from "react";
import { flexRender } from "@tanstack/react-table";
import {
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  legacyCreateColumnHelper,
  useLegacyTable,
  type LegacyColumnDef,
} from "@tanstack/react-table/legacy";
import { ChevronLeft, ChevronRight, Plus, Search } from "lucide-react";
import type { MeMbsProject, MeMbsSignal } from "@/gateway-families/me-mbs/model";
import { describeSpec } from "@/protocols/me";
import { READ_WRITE } from "@/protocols/modbus/slave";
import { FORMAT_LABELS } from "@/protocols/modbus/master/types";
import { usePatch } from "@/lib/current-project";
import type { ProjectView } from "@/lib/project-types";
import { ScreenIssues } from "@/components/screens/screen-gate";
import { MeMbsSignalDrawer } from "@/components/screens/signal-drawer-me-mbs";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 100;

const ACCESS_LABELS: Record<number, string> = {
  [READ_WRITE.READ]: "Read",
  [READ_WRITE.TRIGGER]: "Trigger",
  [READ_WRITE.READWRITE]: "Read–write",
};

type View = Extract<ProjectView, { family: "me-mbs" }>;

interface SignalRow {
  signal: MeMbsSignal;
  /** Desktop-tool description of the AC parameter (spec table). */
  acParameter: string;
  /** "Controller-wide" or "C1 · G3 — Office". */
  scopeLabel: string;
  searchText: string;
}

function scopeLabel(project: MeMbsProject, signal: MeMbsSignal): string {
  const { g50Index, groupIndex, unitId } = signal.me;
  if (groupIndex < 0) return unitId >= 0 ? `C${g50Index + 1} · unit ${unitId}` : "Controller-wide";
  const group = project.me.controllers[g50Index]?.groups.find((g) => g.index === groupIndex);
  const base = `C${g50Index + 1} · G${groupIndex + 1}`;
  return group?.description ? `${base} — ${group.description}` : base;
}

function acParameter(project: MeMbsProject, signal: MeMbsSignal): string {
  const { groupIndex, signalSpecIndex } = signal.me;
  const group = project.me.controllers[signal.me.g50Index]?.groups.find(
    (g) => g.index === groupIndex,
  );
  const info = describeSpec(signalSpecIndex, {
    general: groupIndex < 0 && signal.me.unitId < 0,
    fanSpeeds: group?.fanSpeeds ?? 4,
    temperatureMode: project.me.temperatureMode,
  });
  return info?.description ?? `Spec ${signalSpecIndex}`;
}

function toRow(project: MeMbsProject, signal: MeMbsSignal): SignalRow {
  const ac = acParameter(project, signal);
  const scope = scopeLabel(project, signal);
  return {
    signal,
    acParameter: ac,
    scopeLabel: scope,
    searchText: [
      signal.id,
      signal.description,
      ac,
      scope,
      signal.modbus.address,
      signal.modbus.slaveIndex,
    ]
      .join(" ")
      .toLowerCase(),
  };
}

const columnHelper = legacyCreateColumnHelper<SignalRow>();

/** Signals table for a Mitsubishi Electric AC ↔ Modbus Slave project. */
export function MeMbsSignalsView({ view }: { view: View }) {
  const applyPatches = usePatch();
  const { project } = view;
  const { signals } = project;
  const [search, setSearch] = React.useState("");
  const [activeFilter, setActiveFilter] = React.useState<"all" | "active" | "inactive">("all");
  const [selectedId, setSelectedId] = React.useState<number | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);

  const rows = React.useMemo(() => signals.map((s) => toRow(project, s)), [project, signals]);
  const activeCount = React.useMemo(() => signals.filter((s) => s.active).length, [signals]);

  const columns = React.useMemo<LegacyColumnDef<SignalRow, any>[]>(
    () => [
      columnHelper.accessor((row) => row.signal.id, {
        id: "id",
        header: "#",
        cell: (ctx) => <span className="font-mono text-fg-subtle">{ctx.getValue()}</span>,
      }),
      columnHelper.accessor((row) => row.signal.active, {
        id: "active",
        header: "Active",
        filterFn: (row, _id, value: boolean) => row.original.signal.active === value,
        cell: (ctx) => (
          <Checkbox
            aria-label={`Active signal ${ctx.row.original.signal.id}`}
            checked={ctx.getValue()}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) =>
              void runPatch([
                {
                  type: "updateSignal",
                  id: ctx.row.original.signal.id,
                  patch: { active: e.target.checked },
                },
              ])
            }
          />
        ),
      }),
      columnHelper.accessor((row) => row.signal.description, {
        id: "description",
        header: "Description",
        cell: (ctx) => ctx.getValue() || <span className="text-fg-subtle">—</span>,
      }),
      columnHelper.accessor((row) => row.acParameter, {
        id: "acParameter",
        header: "AC parameter",
      }),
      columnHelper.accessor((row) => row.scopeLabel, {
        id: "scope",
        header: "Controller / group",
      }),
      columnHelper.accessor((row) => row.signal.modbus.address, {
        id: "address",
        header: "Register",
        cell: (ctx) => <span className="font-mono">{ctx.getValue()}</span>,
      }),
      columnHelper.accessor((row) => row.signal.modbus.readWrite, {
        id: "access",
        header: "Access",
        cell: (ctx) => ACCESS_LABELS[ctx.getValue()] ?? "?",
      }),
      columnHelper.accessor((row) => row.signal.modbus.format, {
        id: "format",
        header: "Format",
        cell: (ctx) => {
          const modbus = ctx.row.original.signal.modbus;
          return `${FORMAT_LABELS[modbus.format] ?? "?"} ${modbus.lenBits}-bit`;
        },
      }),
    ],
    // runPatch is stable enough for the column closures (see below).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  async function runPatch(patches: Parameters<typeof applyPatches>[0]) {
    setActionError(null);
    try {
      await applyPatches(patches);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Action failed");
    }
  }

  const table = useLegacyTable({
    data: rows,
    columns,
    state: {
      globalFilter: search,
      columnFilters: activeFilter === "all" ? [] : [{ id: "active", value: activeFilter === "active" }],
    },
    onGlobalFilterChange: setSearch,
    globalFilterFn: (row, _columnId, filterValue: string) =>
      row.original.searchText.includes(filterValue.trim().toLowerCase()),
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageIndex: 0, pageSize: PAGE_SIZE } },
    autoResetPageIndex: false,
  });

  const selected = selectedId !== null ? signals.find((s) => s.id === selectedId) : undefined;

  return (
    <div className="-m-6 flex items-stretch">
      <div className="min-w-0 flex-1 space-y-3 p-6">
        <ScreenIssues issues={view.issues} screen="signals" />

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg-subtle" aria-hidden />
            <Input
              aria-label="Search signals"
              placeholder="Search name, AC parameter, group, register…"
              className="w-80 pl-8"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Select
            aria-label="Filter by state"
            className="w-32"
            value={activeFilter}
            onChange={(e) => setActiveFilter(e.target.value as typeof activeFilter)}
          >
            <option value="all">All</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </Select>
          <Button size="sm" variant="secondary" onClick={() => void runPatch([{ type: "addSignal" }])}>
            <Plus className="h-3.5 w-3.5" aria-hidden />
            Add signal
          </Button>
          <span className="ml-auto font-mono text-xs text-fg-muted">
            {activeCount} active / {signals.length}
          </span>
        </div>

        {actionError && (
          <p role="alert" className="rounded-lg border border-error/30 bg-error-bg px-4 py-2 text-sm text-error">
            {actionError}
          </p>
        )}

        <div className="rounded-lg border border-border bg-white shadow-sm">
          <Table>
            <TableHeader>
              {table.getHeaderGroups().map((headerGroup) => (
                <TableRow key={headerGroup.id}>
                  {headerGroup.headers.map((header) => (
                    <TableHead key={header.id}>
                      {header.isPlaceholder
                        ? null
                        : flexRender(header.column.columnDef.header, header.getContext())}
                    </TableHead>
                  ))}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {table.getRowModel().rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={columns.length} className="py-6 text-center text-fg-muted">
                    No signals match the current filters.
                  </TableCell>
                </TableRow>
              ) : (
                table.getRowModel().rows.map((row) => (
                  <TableRow
                    key={row.id}
                    data-state={row.original.signal.id === selectedId ? "selected" : undefined}
                    className={cn(
                      "cursor-pointer",
                      row.original.signal.id === selectedId && "bg-hms-muted",
                    )}
                    onClick={() => setSelectedId(row.original.signal.id)}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id}>
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        <div className="flex items-center gap-2 text-xs text-fg-muted">
          <Button
            size="sm"
            variant="secondary"
            disabled={!table.getCanPreviousPage()}
            onClick={() => table.previousPage()}
          >
            <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
            Previous
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={!table.getCanNextPage()}
            onClick={() => table.nextPage()}
          >
            Next
            <ChevronRight className="h-3.5 w-3.5" aria-hidden />
          </Button>
          <span className="font-mono">
            Page {table.getState().pagination.pageIndex + 1} / {Math.max(1, table.getPageCount())}
          </span>
          <span>
            · {table.getFilteredRowModel().rows.length} of {rows.length} signals
          </span>
        </div>
      </div>

      {selected && (
        <MeMbsSignalDrawer
          key={selected.id}
          signal={selected}
          project={project}
          onClose={() => setSelectedId(null)}
          onRemoved={() => setSelectedId(null)}
        />
      )}
    </div>
  );
}
