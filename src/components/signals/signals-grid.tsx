"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { GripVertical } from "lucide-react";
import { applyFlagChange } from "@/protocols/knx";
import type { ProjectPatchInput, SignalPatchInput } from "@/lib/project-types";
import { useWorkspaceChrome } from "@/lib/workspace-chrome";
import { SelectBox } from "@/components/ui/select-box";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { BAND_STYLE, COL_HEADER_H, GROUP_HEADER_H, ROW_HEIGHT, type BandId, type GridColumn } from "./types";
import { createCellSaveQueue, type CellStatus } from "./cell-queue";

export interface SignalsGridProps<R> {
  rows: R[];
  columns: GridColumn<R>[];
  groupLabels: Record<BandId, string>;
  rowId: (row: R) => number;
  rowActive: (row: R) => boolean;
  rowError?: (row: R) => boolean;
  selected: Set<number>;
  pageIds: number[];
  onToggle: (id: number) => void;
  onTogglePage: () => void;
  applyPatches: (patches: ProjectPatchInput[]) => Promise<unknown>;
  tabOrder: string[];
  widthStorageKey: string;
}

function editorSeed<R>(col: GridColumn<R>, row: R): string {
  if (col.getEditorValue) return col.getEditorValue(row);
  const text = col.getText(row);
  return text === "—" ? "" : text;
}

const widthListeners = new Map<string, Set<() => void>>();
const widthMemory = new Map<string, string>();

function subscribeToWidths(key: string, listener: () => void): () => void {
  const listeners = widthListeners.get(key) ?? new Set<() => void>();
  listeners.add(listener);
  widthListeners.set(key, listeners);
  const onStorage = (event: StorageEvent) => {
    if (event.key === key) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) widthListeners.delete(key);
    window.removeEventListener("storage", onStorage);
  };
}

function readWidthsSnapshot(key: string): string {
  try {
    return window.localStorage.getItem(key) ?? "{}";
  } catch {
    return widthMemory.get(key) ?? "{}";
  }
}

function readWidthsServerSnapshot(): string {
  return "{}";
}

function parseStoredWidths(snapshot: string): Record<string, number> {
  try {
    return JSON.parse(snapshot) as Record<string, number>;
  } catch {
    return {};
  }
}

function writeStoredWidths(key: string, widths: Record<string, number>) {
  const snapshot = JSON.stringify(widths);
  widthMemory.set(key, snapshot);
  try {
    window.localStorage.setItem(key, snapshot);
  } catch {
    // The in-memory width still updates when storage is unavailable.
  }
  for (const listener of widthListeners.get(key) ?? []) listener();
}

function clearStoredWidths(key: string) {
  widthMemory.set(key, "{}");
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Defaults still apply to this render.
  }
  for (const listener of widthListeners.get(key) ?? []) listener();
}

export function SignalsGrid<R>({
  rows,
  columns,
  groupLabels,
  rowId,
  rowActive,
  rowError,
  selected,
  pageIds,
  onToggle,
  onTogglePage,
  applyPatches,
  tabOrder,
  widthStorageKey,
}: SignalsGridProps<R>) {
  const chrome = useWorkspaceChrome();
  const { bumpDirty, pushUndo } = chrome;

  const [editing, setEditing] = React.useState<{ id: number; field: string } | null>(null);
  const [draft, setDraft] = React.useState("");
  const [status, setStatus] = React.useState<Record<string, CellStatus>>({});
  const [tooltip, setTooltip] = React.useState<{ text: string; left: number; top: number } | null>(null);
  const inputRef = React.useRef<HTMLInputElement | HTMLSelectElement | null>(null);
  const widthSnapshot = React.useSyncExternalStore(
    React.useCallback((listener) => subscribeToWidths(widthStorageKey, listener), [widthStorageKey]),
    React.useCallback(() => readWidthsSnapshot(widthStorageKey), [widthStorageKey]),
    readWidthsServerSnapshot,
  );
  const widths = React.useMemo(() => parseStoredWidths(widthSnapshot), [widthSnapshot]);

  const widthOf = React.useCallback(
    (col: GridColumn<R>) => widths[col.id] ?? col.width,
    [widths],
  );

  const frozen = columns.filter((c) => c.frozen);
  const leftOf = React.useMemo(() => {
    const map = new Map<string, number>();
    let left = 0;
    for (const col of columns) {
      if (!col.frozen) continue;
      map.set(col.id, left);
      left += widthOf(col);
    }
    return map;
  }, [columns, widthOf]);

  const lastFrozenId = frozen.at(-1)?.id;

  const groups = (["project", "bms", "gateway", "device"] as BandId[])
    .map((id) => ({
      id,
      label: groupLabels[id],
      width: columns.filter((c) => c.group === id).reduce((s, c) => s + widthOf(c), 0),
      frozen: id === "project",
    }))
    .filter((g) => g.width > 0);

  const queue = React.useMemo(
    () =>
      createCellSaveQueue(
      async (payload: { signalId: number; field: string; patch: SignalPatchInput; inverse: SignalPatchInput }) => {
        await applyPatches([{ type: "updateSignal", id: payload.signalId, patch: payload.patch }]);
        bumpDirty(1);
        pushUndo({
          label: payload.field,
          patches: [{ type: "updateSignal", id: payload.signalId, patch: payload.inverse }],
        });
      },
    ),
    [applyPatches, bumpDirty, pushUndo],
  );

  const save = React.useCallback((signalId: number, field: string, patch: SignalPatchInput, inverse: SignalPatchInput) => {
    const key = `${signalId}:${field}`;
    setStatus((s) => ({ ...s, [key]: { kind: "saving" } }));
    void queue
      .enqueue(key, { signalId, field, patch, inverse })
      .then(() => {
        setStatus((s) => ({ ...s, [key]: { kind: "ok" } }));
        window.setTimeout(() => {
          setStatus((s) => {
            if (s[key]?.kind !== "ok") return s;
            const next = { ...s };
            delete next[key];
            return next;
          });
        }, 1700);
      })
      .catch((err: unknown) => {
        setStatus((s) => ({
          ...s,
          [key]: { kind: "err", message: err instanceof Error ? err.message : "Save failed" },
        }));
      });
  }, [queue]);

  React.useEffect(() => {
    inputRef.current?.focus();
    if (inputRef.current instanceof HTMLInputElement) inputRef.current.select();
  }, [editing]);

  function startEdit(row: R, col: GridColumn<R>) {
    if (col.kind === "none" || col.kind === "switch" || col.kind === "flags") return;
    setEditing({ id: rowId(row), field: col.id });
    setDraft(editorSeed(col, row));
  }

  function commitEdit(row: R, col: GridColumn<R>) {
    if (!editing || editing.field !== col.id || editing.id !== rowId(row)) return;
    setEditing(null);
    const parsed = col.parse?.(row, draft);
    if (!parsed) return;
    if ("error" in parsed) {
      setStatus((s) => ({
        ...s,
        [`${rowId(row)}:${col.id}`]: { kind: "err", message: parsed.error },
      }));
      return;
    }
    if (editorSeed(col, row) === draft) return;
    save(rowId(row), col.id, parsed.patch, col.inverseFromText?.(row) ?? {});
  }

  function cancelEdit() {
    setEditing(null);
    setDraft("");
  }

  function focusField(rowIndex: number, field: string) {
    const col = columns.find((c) => c.id === field);
    const row = rows[rowIndex];
    if (!col || !row) return;
    startEdit(row, col);
  }

  function onEditorKeyDown(e: React.KeyboardEvent, rowIndex: number, col: GridColumn<R>, row: R) {
    if (e.key === "Escape") {
      e.preventDefault();
      cancelEdit();
      return;
    }
    if (e.key === "Enter" && col.kind !== "select") {
      e.preventDefault();
      commitEdit(row, col);
      return;
    }
    if (e.key === "Tab") {
      e.preventDefault();
      if (col.kind === "select") setEditing(null);
      else commitEdit(row, col);
      const idx = tabOrder.indexOf(col.id);
      const nextIdx = e.shiftKey ? idx - 1 : idx + 1;
      const nextField = tabOrder[nextIdx];
      if (nextField) focusField(rowIndex, nextField);
      else if (!e.shiftKey && rowIndex < rows.length - 1) focusField(rowIndex + 1, tabOrder[0]);
      else if (e.shiftKey && rowIndex > 0) focusField(rowIndex - 1, tabOrder[tabOrder.length - 1]);
    }
  }

  const allPageOn = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const somePageOn = pageIds.some((id) => selected.has(id));

  function stickyStyle(col: GridColumn<R>): React.CSSProperties | undefined {
    if (!col.frozen) return undefined;
    return {
      position: "sticky",
      left: leftOf.get(col.id),
      zIndex: 2,
      boxShadow: col.id === lastFrozenId ? "2px 0 6px rgba(4,61,93,0.08)" : undefined,
    };
  }

  function renderStatus(key: string) {
    const st = status[key];
    if (!st) return null;
    const color = st.kind === "saving" ? "bg-warning" : st.kind === "ok" ? "bg-success" : "bg-error";
    return (
      <span className="ml-1 inline-flex min-w-0 items-center gap-1">
        <span className={cn("inline-block size-1.5 shrink-0 rounded-full", color)} aria-hidden />
        {st.kind === "err" && st.message ? (
          <span className="max-w-[120px] truncate text-[10px] text-error" title={st.message}>
            {st.message}
          </span>
        ) : null}
      </span>
    );
  }

  function cellShell(
    col: GridColumn<R>,
    opts: {
      selected: boolean;
      extra?: string;
      children: React.ReactNode;
      role?: React.AriaRole;
      tabIndex?: number;
      onClick?: () => void;
      onKeyDown?: (e: React.KeyboardEvent) => void;
    },
  ) {
    const editable = col.kind !== "none";
    const bg = opts.selected ? "var(--color-row-selected)" : BAND_STYLE[col.group].bg;
    return (
      <div
        key={col.id}
        role={opts.role}
        tabIndex={opts.tabIndex}
        onClick={opts.onClick}
        onKeyDown={opts.onKeyDown}
        className={cn(
          "box-border flex h-[31px] shrink-0 items-center overflow-hidden border-b border-row-rule px-2.5 text-[12px]",
          col.mono ? "font-mono text-hms-blue" : "font-sans text-text-body",
          editable && col.kind !== "switch" && col.kind !== "flags"
            ? "cursor-text hover:bg-row-hover"
            : "cursor-default",
          opts.extra,
        )}
        style={{ width: widthOf(col), backgroundColor: bg, ...stickyStyle(col) }}
      >
        {opts.children}
      </div>
    );
  }

  function renderCell(row: R, col: GridColumn<R>, rowIndex: number, isSelected: boolean) {
    const id = rowId(row);
    const key = `${id}:${col.id}`;
    const isEditing = editing?.id === id && editing.field === col.id;

    if (col.id === "select") {
      return cellShell(col, {
        selected: isSelected,
        extra: "justify-center",
        children: (
          <SelectBox
            aria-label={`Select signal ${id}`}
            checked={selected.has(id)}
            onCheckedChange={() => onToggle(id)}
          />
        ),
      });
    }

    if (col.kind === "switch") {
      return cellShell(col, {
        selected: isSelected,
        extra: "justify-center gap-1",
        children: (
          <>
            <Switch
              aria-label={col.id === "active" ? `Active signal ${id}` : `${col.header} signal ${id}`}
              checked={!!col.getChecked?.(row)}
              onCheckedChange={(checked) => {
                const patch = col.toPatchFromSwitch?.(row, checked);
                if (patch) save(id, col.id, patch, col.inverseFromSwitch?.(row) ?? {});
              }}
            />
            {renderStatus(key)}
          </>
        ),
      });
    }

    if (col.kind === "flags" && col.getFlags) {
      const flags = col.getFlags(row);
      return cellShell(col, {
        selected: isSelected,
        extra: "gap-0.5",
        children: (
          <>
            {(["u", "t", "ri", "w", "r"] as const).map((flag) => (
              <button
                key={flag}
                type="button"
                className={cn(
                  "rounded px-0.5 font-mono text-[10px] font-semibold",
                  flags[flag] ? "bg-hms-accent text-white" : "bg-hms-muted text-fg-subtle",
                )}
                aria-label={`Flag ${flag.toUpperCase()} signal ${id}`}
                onClick={() => {
                  const next = applyFlagChange({ ...flags, [flag]: !flags[flag] }, flag);
                  const patch = col.toPatchFromFlags?.(row, next);
                  if (patch) save(id, col.id, patch, col.inverseFromFlags?.(row) ?? {});
                }}
              >
                {flag === "ri" ? "Ri" : flag.toUpperCase()}
              </button>
            ))}
            {renderStatus(key)}
          </>
        ),
      });
    }

    if (isEditing && (col.kind === "text" || col.kind === "number")) {
      return cellShell(col, {
        selected: isSelected,
        extra: "p-0",
        children: (
          <input
            ref={(el) => {
              inputRef.current = el;
            }}
            aria-label={`Edit ${col.header} signal ${id}`}
            className={cn(
              "h-full w-full border-0 bg-transparent px-2.5 text-[12px] outline-2 outline-offset-[-1px] outline-hms-accent/35",
              col.mono ? "font-mono" : "font-sans",
            )}
            value={draft}
            type={col.kind === "number" ? "number" : "text"}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => commitEdit(row, col)}
            onKeyDown={(e) => onEditorKeyDown(e, rowIndex, col, row)}
          />
        ),
      });
    }

    if (isEditing && col.kind === "select") {
      return cellShell(col, {
        selected: isSelected,
        extra: "p-0",
        children: (
          <select
            ref={(el) => {
              inputRef.current = el;
            }}
            aria-label={`Edit ${col.header} signal ${id}`}
            className="h-full w-full border-0 bg-transparent px-1 text-[12px] outline-2 outline-hms-accent/35"
            value={draft}
            onChange={(e) => {
              const value = e.target.value;
              setDraft(value);
              setEditing(null);
              const parsed = col.parse?.(row, value);
              if (parsed && "error" in parsed) {
                setStatus((s) => ({ ...s, [key]: { kind: "err", message: parsed.error } }));
                return;
              }
              if (parsed && "patch" in parsed && editorSeed(col, row) !== value) {
                save(id, col.id, parsed.patch, col.inverseFromText?.(row) ?? {});
              }
            }}
            onBlur={() => setEditing(null)}
            onKeyDown={(e) => onEditorKeyDown(e, rowIndex, col, row)}
          >
            {(col.options?.(row) ?? []).map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        ),
      });
    }

    const editable = col.kind !== "none";
    return cellShell(col, {
      selected: isSelected,
      extra: cn(editable && "hover:ring-1 hover:ring-inset hover:ring-hms-accent/30"),
      role: editable ? "button" : undefined,
      tabIndex: editable ? 0 : undefined,
      onClick: () => startEdit(row, col),
      onKeyDown: (e) => {
        if (editable && (e.key === "Enter" || e.key === "F2")) startEdit(row, col);
      },
      children: (
        <>
          <span
            className="min-w-0 flex-1 truncate"
            tabIndex={col.getTitle ? 0 : undefined}
            onMouseEnter={(event) =>
              showTooltip(event, col.getTitle?.(row) ?? col.getText(row), !!col.getTitle)
            }
            onMouseLeave={() => setTooltip(null)}
            onFocus={(event) =>
              showTooltip(event, col.getTitle?.(row) ?? col.getText(row), !!col.getTitle)
            }
            onBlur={() => setTooltip(null)}
          >
            {col.getText(row)}
          </span>
          {renderStatus(key)}
        </>
      ),
    });
  }

  function clampWidth(col: GridColumn<R>, width: number) {
    return Math.max(col.minWidth ?? 52, Math.min(col.maxWidth ?? 600, Math.round(width)));
  }

  function resizeStart(event: React.PointerEvent, col: GridColumn<R>) {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = widthOf(col);
    let latestWidth = startWidth;

    const onMove = (moveEvent: PointerEvent) => {
      latestWidth = clampWidth(col, startWidth + moveEvent.clientX - startX);
      writeStoredWidths(widthStorageKey, { ...widths, [col.id]: latestWidth });
    };
    const onUp = () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      writeStoredWidths(widthStorageKey, { ...widths, [col.id]: latestWidth });
    };

    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  }

  function autoFit(col: GridColumn<R>) {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (context) context.font = "500 12px Inter, ui-sans-serif, system-ui, sans-serif";
    const texts = [col.header, ...rows.map((row) => col.getText(row))];
    const measured = texts.reduce(
      (max, text) => Math.max(max, context?.measureText(text).width ?? text.length * 7),
      0,
    );
    const nextWidth = clampWidth(col, measured + (col.kind === "none" ? 24 : 42));
    writeStoredWidths(widthStorageKey, { ...widths, [col.id]: nextWidth });
  }

  function resetWidths() {
    clearStoredWidths(widthStorageKey);
  }

  function showTooltip(
    event: React.MouseEvent<HTMLSpanElement> | React.FocusEvent<HTMLSpanElement>,
    text: string,
    always = false,
  ) {
    const element = event.currentTarget;
    if (!always && element.scrollWidth <= element.clientWidth) return;
    const rect = element.getBoundingClientRect();
    setTooltip({
      text,
      left: Math.max(8, Math.min(rect.left, window.innerWidth - 328)),
      top: rect.bottom + 6,
    });
  }

  return (
    <>
      <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-border bg-white">
        <div className="min-w-max">
        <div className="sticky top-0 z-20 flex" style={{ height: GROUP_HEADER_H }}>
          {groups.map((g, groupIndex) => (
            <div
              key={g.id}
              className="relative flex shrink-0 items-center border-b border-r px-2.5 font-mono text-[10.5px] font-semibold tracking-[0.07em]"
              style={{
                width: g.width,
                background: BAND_STYLE[g.id].bg,
                color: BAND_STYLE[g.id].color,
                borderColor: BAND_STYLE[g.id].border,
                position: g.frozen ? "sticky" : undefined,
                left: g.frozen ? 0 : undefined,
                zIndex: g.frozen ? 21 : undefined,
              }}
            >
              {g.label}
              {groupIndex === 0 ? (
                <span className="ml-auto font-sans text-[9.5px] font-normal normal-case tracking-normal text-fg-subtle">
                  ⋮ drag column edges
                </span>
              ) : null}
              {groupIndex === groups.length - 1 ? (
                <button
                  type="button"
                  className="ml-auto rounded px-1.5 py-0.5 font-sans text-[10px] font-normal normal-case tracking-normal text-fg-subtle hover:bg-black/5 hover:text-fg"
                  onClick={resetWidths}
                >
                  Reset widths
                </button>
              ) : null}
            </div>
          ))}
        </div>
        <div className="sticky z-10 flex bg-table-header" style={{ top: GROUP_HEADER_H, height: COL_HEADER_H }}>
          {columns.map((col) => (
            <div
              key={col.id}
              className="relative flex shrink-0 items-center border-b border-border px-2.5 font-mono text-[10.5px] font-semibold uppercase tracking-[0.06em] text-fg-muted"
              style={{
                width: widthOf(col),
                position: col.frozen ? "sticky" : undefined,
                left: leftOf.get(col.id),
                zIndex: col.frozen ? 11 : undefined,
                background: "#FAFBFC",
                boxShadow: col.id === lastFrozenId ? "2px 0 6px rgba(4,61,93,0.08)" : undefined,
              }}
            >
              {col.id === "select" ? (
                <SelectBox
                  aria-label="Select all signals"
                  checked={allPageOn}
                  indeterminate={somePageOn && !allPageOn}
                  onCheckedChange={() => onTogglePage()}
                />
              ) : (
                col.header
              )}
              {col.resizable !== false ? (
                <button
                  type="button"
                  aria-label={`Resize ${col.header || col.id} column`}
                  title="Drag to resize · Double-click to fit"
                  className="absolute inset-y-0 right-0 z-10 flex w-3 cursor-col-resize touch-none items-center justify-center border-0 border-l border-border/70 bg-table-header/90 p-0 text-fg-subtle hover:border-hms-accent hover:bg-hms-accent/15 hover:text-hms-accent focus-visible:outline-2 focus-visible:outline-hms-accent"
                  onPointerDown={(event) => resizeStart(event, col)}
                  onDoubleClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    autoFit(col);
                  }}
                >
                  <GripVertical className="h-3 w-3" strokeWidth={1.75} aria-hidden />
                </button>
              ) : null}
            </div>
          ))}
        </div>
        {rows.map((row, rowIndex) => {
          const id = rowId(row);
          const err = rowError?.(row);
          const active = rowActive(row);
          const isSelected = selected.has(id);
          return (
            <div
              key={id}
              className={cn("flex", err && "bg-row-error", !active && "opacity-[.45]")}
              style={{ height: ROW_HEIGHT }}
            >
              {columns.map((col) => renderCell(row, col, rowIndex, isSelected))}
            </div>
          );
        })}
        {rows.length === 0 && (
          <div className="px-4 py-6 text-center text-sm text-fg-muted">No signals match the current filters.</div>
        )}
        </div>
      </div>
      {tooltip
        ? createPortal(
            <div
              role="tooltip"
              className="pointer-events-none fixed z-[100] max-w-[320px] rounded-md bg-[#17384A] px-2.5 py-1.5 text-xs leading-4 text-white shadow-lg"
              style={{ left: tooltip.left, top: tooltip.top }}
            >
              {tooltip.text}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
