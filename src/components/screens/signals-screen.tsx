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
import type { KnxMbmSignal } from "@/gateway-families/knx-mbm/model";
import { nodeForPort, type MbmConfig } from "@/protocols/modbus/master/nodes";
import {
  BYTE_ORDER_LABELS,
  FORMAT_LABELS,
  isBitFunction,
} from "@/protocols/modbus/master/types";
import { formatGroupAddress } from "@/protocols/knx/address";
import { formatDpt } from "@/protocols/knx/dpt";
import type { ProjectView } from "@/lib/project-types";
import { usePatch } from "@/lib/current-project";
import { ScreenGate, ScreenIssues } from "@/components/screens/screen-gate";
import { SignalDrawer } from "@/components/screens/signal-drawer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 100;

const READ_LABELS: Record<number, string> = {
  [-1]: "—",
  1: "Coils",
  2: "Discrete inputs",
  3: "Holding registers",
  4: "Input registers",
};

const WRITE_LABELS: Record<number, string> = {
  [-1]: "—",
  5: "Single coil",
  6: "Single register",
  15: "Multiple coils",
  16: "Multiple registers",
};

interface SignalRow {
  signal: KnxMbmSignal;
  groupAddress: string;
  dpt: string;
  nodeLabel: string;
  deviceLabel: string;
  /** Lowercased haystack for the text search. */
  searchText: string;
}

function nodeLabel(mbm: MbmConfig, port: number): string {
  const ref = nodeForPort(mbm, port);
  if (!ref) return "—";
  if (ref.kind === "rtu") return `RTU ${port + 1}`;
  const node = ref.node as MbmConfig["tcpNodes"][number];
  return `TCP ${port - mbm.rtuNodes.length + 1} · ${node.ip}:${node.port}`;
}

function deviceLabel(mbm: MbmConfig, signal: KnxMbmSignal): string {
  if (signal.modbus.isBroadcast) return "Broadcast";
  const ref = nodeForPort(mbm, signal.modbus.port);
  if (!ref) return "—";
  const device = ref.node.devices.find((d) => d.index === signal.modbus.deviceIndex);
  return device ? device.name : "—";
}

function toRow(mbm: MbmConfig, signal: KnxMbmSignal): SignalRow {
  const groupAddress = signal.knx.groupAddress > 0 ? formatGroupAddress(signal.knx.groupAddress) : "—";
  const dpt = formatDpt(signal.knx.dpt);
  const node = nodeLabel(mbm, signal.modbus.port);
  const device = deviceLabel(mbm, signal);
  return {
    signal,
    groupAddress,
    dpt,
    nodeLabel: node,
    deviceLabel: device,
    searchText: [
      signal.id,
      signal.description,
      groupAddress,
      dpt,
      node,
      device,
      signal.modbus.address,
    ]
      .join(" ")
      .toLowerCase(),
  };
}

const columnHelper = legacyCreateColumnHelper<SignalRow>();

export function SignalsScreen() {
  return (
    <ScreenGate>
      {(view) => <SignalsView view={view} />}
    </ScreenGate>
  );
}

function SignalsView({ view }: { view: ProjectView }) {
  const applyPatches = usePatch();
  const { mbm, signals } = view.project;
  const [search, setSearch] = React.useState("");
  const [activeFilter, setActiveFilter] = React.useState<"all" | "active" | "inactive">("all");
  const [selectedId, setSelectedId] = React.useState<number | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);

  const rows = React.useMemo(() => signals.map((s) => toRow(mbm, s)), [mbm, signals]);
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
      columnHelper.accessor((row) => row.groupAddress, {
        id: "groupAddress",
        header: "Group address",
        cell: (ctx) => <span className="font-mono">{ctx.getValue()}</span>,
      }),
      columnHelper.accessor((row) => row.dpt, {
        id: "dpt",
        header: "DPT",
        cell: (ctx) => <span className="font-mono">{ctx.getValue()}</span>,
      }),
      columnHelper.accessor((row) => row.signal.knx.flags, {
        id: "flags",
        header: "Flags",
        cell: (ctx) => {
          const flags = ctx.getValue();
          const entries = [
            ["U", flags.u],
            ["T", flags.t],
            ["Ri", flags.ri],
            ["W", flags.w],
            ["R", flags.r],
          ] as const;
          return (
            <span className="flex gap-1">
              {entries.map(([label, on]) => (
                <Badge key={label} variant={on ? "default" : "muted"} className={cn(!on && "opacity-50")}>
                  {label}
                </Badge>
              ))}
            </span>
          );
        },
      }),
      columnHelper.accessor((row) => row.nodeLabel, { id: "node", header: "Node" }),
      columnHelper.accessor((row) => row.deviceLabel, { id: "device", header: "Device" }),
      columnHelper.accessor((row) => row.signal.modbus.readFunc, {
        id: "readFunc",
        header: "Read",
        cell: (ctx) => {
          const fn = ctx.getValue();
          return fn < 0 ? "—" : `${fn} · ${READ_LABELS[fn] ?? "?"}`;
        },
      }),
      columnHelper.accessor((row) => row.signal.modbus.writeFunc, {
        id: "writeFunc",
        header: "Write",
        cell: (ctx) => {
          const fn = ctx.getValue();
          return fn < 0 ? "—" : `${fn} · ${WRITE_LABELS[fn] ?? "?"}`;
        },
      }),
      columnHelper.accessor((row) => row.signal.modbus.address, {
        id: "address",
        header: "Register",
        cell: (ctx) => <span className="font-mono">{ctx.getValue()}</span>,
      }),
      columnHelper.accessor((row) => row.signal.modbus.format, {
        id: "format",
        header: "Format / byte order",
        cell: (ctx) => {
          const modbus = ctx.row.original.signal.modbus;
          const format = FORMAT_LABELS[modbus.format] ?? "?";
          const order = isBitFunction(modbus.readFunc) && isBitFunction(modbus.writeFunc)
            ? ""
            : ` / ${BYTE_ORDER_LABELS[modbus.byteOrder] ?? "?"}`;
          return `${format}${order}`;
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
              placeholder="Search name, group address, device, register…"
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
        <SignalDrawer
          key={selected.id}
          signal={selected}
          project={view.project}
          onClose={() => setSelectedId(null)}
          onRemoved={() => setSelectedId(null)}
        />
      )}
    </div>
  );
}
