"use client";

import * as React from "react";
import { createPortal, flushSync } from "react-dom";
import { GripVertical } from "lucide-react";
import { applyFlagChange } from "@/protocols/knx";
import type { ProjectPatchInput, SignalPatchInput } from "@/lib/project-types";
import { useWorkspaceChrome } from "@/lib/workspace-chrome";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { BAND_STYLE, COL_HEADER_H, GROUP_HEADER_H, ROW_HEIGHT, type BandId, type GridColumn } from "./types";
import { createCellSaveQueue, type CellStatus } from "./cell-queue";

export interface SignalsGridProps<R> {
  rows: R[];
  columns: GridColumn<R>[];
  groupLabels: Record<BandId, string>;
  compactGroupLabels?: Record<BandId, string>;
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
  compact?: boolean;
  onToggleCompact?: () => void;
  fitRows?: R[];
  focusId?: number;
}

function editorSeed<R>(col: GridColumn<R>, row: R): string {
  if (col.getEditorValue) return col.getEditorValue(row);
  const text = col.getText(row);
  return text === "—" ? "" : text;
}

function displayedHeader<R>(col: GridColumn<R>, compact: boolean): string {
  return compact && col.headerShort ? col.headerShort : col.header;
}

function displayedCell<R>(col: GridColumn<R>, row: R, compact: boolean): string {
  return compact && col.getCompactText ? col.getCompactText(row) : col.getText(row);
}

function headerTooltip<R>(col: GridColumn<R>): string {
  return col.headerHint ?? col.header;
}

function fontFromToken(
  token: "--font-family-body" | "--font-family-technical",
  weight: number,
  size: number,
): string {
  const family = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
  return `${weight} ${size}px ${family}`;
}

function measureText(el: HTMLSpanElement, font: string, text: string, fallbackPx: number): number {
  el.style.font = font;
  el.textContent = text;
  const width = el.offsetWidth;
  return width > 0 ? width : text.length * fallbackPx * 0.85;
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

export function SignalsGrid<R>({
  rows,
  columns,
  groupLabels,
  compactGroupLabels,
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
  compact = false,
  onToggleCompact,
  fitRows,
  focusId,
}: SignalsGridProps<R>) {
  const chrome = useWorkspaceChrome();
  const { bumpDirty, pushUndo } = chrome;

  const [editing, setEditing] = React.useState<{ id: number; field: string } | null>(null);
  const [draft, setDraft] = React.useState("");
  const [status, setStatus] = React.useState<Record<string, CellStatus>>({});
  const [tooltip, setTooltip] = React.useState<{ text: string; left: number; top: number } | null>(null);
  const inputRef = React.useRef<HTMLInputElement | HTMLSelectElement | null>(null);
  const widthsKey = compact ? `${widthStorageKey}:compact` : widthStorageKey;
  const widthSnapshot = React.useSyncExternalStore(
    React.useCallback((listener) => subscribeToWidths(widthsKey, listener), [widthsKey]),
    React.useCallback(() => readWidthsSnapshot(widthsKey), [widthsKey]),
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
  const bandLabel = React.useCallback(
    (id: BandId) => (compact && compactGroupLabels ? compactGroupLabels[id] : groupLabels[id]),
    [compact, compactGroupLabels, groupLabels],
  );

  const groups = (["project", "bms", "gateway", "device"] as BandId[])
    .map((id) => ({
      id,
      label: bandLabel(id),
      hint: groupLabels[id],
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

  function openSelectEditor(row: R, col: GridColumn<R>) {
    flushSync(() => startEdit(row, col));
    const select = document.querySelector<HTMLSelectElement>('select[data-grid-editor="select"]');
    if (!select) return;
    select.focus();
    try {
      select.showPicker();
    } catch {
      // Focusing still leaves the native select usable when showPicker is unavailable.
    }
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
      active: boolean;
      background: string;
      extra?: string;
      children: React.ReactNode;
      role?: React.AriaRole;
      tabIndex?: number;
      onClick?: () => void;
      onKeyDown?: (e: React.KeyboardEvent) => void;
    },
  ) {
    const editable = col.kind !== "none";
    const textTone = opts.active ? (col.textTone ?? "muted") : "subtle";
    const textColor = {
      body: "text-text-body",
      strong: "text-hms-blue",
      muted: "text-fg-muted",
      subtle: "text-fg-subtle",
    }[textTone];
    return (
      <div
        key={col.id}
        role={opts.role}
        tabIndex={opts.tabIndex}
        onClick={opts.onClick}
        onKeyDown={opts.onKeyDown}
        className={cn(
          "box-border flex h-[31px] shrink-0 items-center overflow-hidden border-b border-row-rule px-2.5 text-[12px]",
          col.mono ? "font-mono" : "font-sans",
          textColor,
          editable && col.kind !== "switch" && col.kind !== "flags"
            ? cn(col.kind === "select" ? "cursor-pointer" : "cursor-text", "hover:bg-row-hover")
            : "cursor-default",
          opts.extra,
        )}
        style={{ width: widthOf(col), backgroundColor: opts.background, ...stickyStyle(col) }}
      >
        {opts.children}
      </div>
    );
  }

  function renderCell(
    row: R,
    col: GridColumn<R>,
    rowIndex: number,
    presentation: { active: boolean; background: string },
  ) {
    const id = rowId(row);
    const key = `${id}:${col.id}`;
    const isEditing = editing?.id === id && editing.field === col.id;
    const cellPresentation = { active: presentation.active, background: presentation.background };

    if (col.id === "select") {
      return cellShell(col, {
        ...cellPresentation,
        extra: "justify-center",
        children: (
          <Checkbox
            aria-label={`Select signal ${id}`}
            checked={selected.has(id)}
            onChange={() => onToggle(id)}
            onClick={(e) => e.stopPropagation()}
          />
        ),
      });
    }

    if (col.kind === "switch") {
      return cellShell(col, {
        ...cellPresentation,
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
        ...cellPresentation,
        children: (
          <div className={cn("flex items-center gap-0.5", !presentation.active && "opacity-[.45]")}>
            {(["u", "t", "ri", "w", "r"] as const).map((flag) => (
              <button
                key={flag}
                type="button"
                className={cn(
                  "shrink-0 rounded px-0.5 font-mono text-[10px] font-semibold",
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
          </div>
        ),
      });
    }

    if (isEditing && (col.kind === "text" || col.kind === "number")) {
      return cellShell(col, {
        ...cellPresentation,
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
        ...cellPresentation,
        extra: "p-0",
        children: (
          <select
            data-grid-editor="select"
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
      ...cellPresentation,
      extra: cn(editable && "hover:ring-1 hover:ring-inset hover:ring-hms-accent/30"),
      role: editable ? "button" : undefined,
      tabIndex: editable ? 0 : undefined,
      onClick: () => {
        if (col.kind === "select") openSelectEditor(row, col);
        else startEdit(row, col);
      },
      onKeyDown: (e) => {
        if (!editable || (e.key !== "Enter" && e.key !== "F2")) return;
        e.preventDefault();
        if (col.kind === "select") openSelectEditor(row, col);
        else startEdit(row, col);
      },
      children: (
        <>
          <span
            className="min-w-0 flex-1 truncate"
            tabIndex={col.getTitle ? 0 : undefined}
            onMouseEnter={(event) => {
              const shown = displayedCell(col, row, compact);
              const full = col.getTitle?.(row) ?? col.getText(row);
              showTooltip(event, full, !!col.getTitle || shown !== full);
            }}
            onMouseLeave={() => setTooltip(null)}
            onFocus={(event) => {
              const shown = displayedCell(col, row, compact);
              const full = col.getTitle?.(row) ?? col.getText(row);
              showTooltip(event, full, !!col.getTitle || shown !== full);
            }}
            onBlur={() => setTooltip(null)}
          >
            {displayedCell(col, row, compact)}
          </span>
          {renderStatus(key)}
        </>
      ),
    });
  }

  const clampWidth = React.useCallback(
    (col: GridColumn<R>, width: number) => {
      const min = compact ? 52 : (col.minWidth ?? 52);
      return Math.max(min, Math.min(col.maxWidth ?? 600, Math.round(width)));
    },
    [compact],
  );

  const fittedWidth = React.useCallback(
    (col: GridColumn<R>, probe: HTMLSpanElement, source: R[]): number => {
      const slack = 18;
      const cellPad = 20 + slack;
      const headerPad = cellPad + (col.resizable === false ? 0 : 16);
      const headerFont = fontFromToken("--font-family-technical", 600, 10.5);
      const cellFont = fontFromToken(
        col.mono ? "--font-family-technical" : "--font-family-body",
        400,
        12,
      );
      const header = displayedHeader(col, compact).trim().toUpperCase();
      const headerWidth = header
        ? measureText(probe, headerFont, header, 10.5) + Math.max(0, header.length - 1) * 10.5 * 0.06
        : 0;
      let contentWidth = 0;
      if (col.kind === "flags") {
        contentWidth = (["U", "T", "Ri", "W", "R"] as const).reduce((sum, label, index) => {
          return sum + measureText(probe, cellFont, label, 10) + 6 + (index > 0 ? 2 : 0);
        }, 0);
      } else if (col.kind === "switch") {
        contentWidth = 36;
      } else {
        for (const row of source) {
          contentWidth = Math.max(contentWidth, measureText(probe, cellFont, displayedCell(col, row, compact), 12));
        }
      }
      return clampWidth(col, Math.max(headerWidth + headerPad, contentWidth + cellPad));
    },
    [clampWidth, compact],
  );

  function withProbe<T>(fn: (probe: HTMLSpanElement) => T): T {
    const probe = document.createElement("span");
    probe.style.position = "absolute";
    probe.style.visibility = "hidden";
    probe.style.whiteSpace = "nowrap";
    probe.style.left = "-9999px";
    document.body.appendChild(probe);
    try {
      return fn(probe);
    } finally {
      probe.remove();
    }
  }

  function resizeStart(event: React.PointerEvent, col: GridColumn<R>) {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = widthOf(col);
    let latestWidth = startWidth;

    const onMove = (moveEvent: PointerEvent) => {
      latestWidth = clampWidth(col, startWidth + moveEvent.clientX - startX);
      writeStoredWidths(widthsKey, { ...widths, [col.id]: latestWidth });
    };
    const onUp = () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      writeStoredWidths(widthsKey, { ...widths, [col.id]: latestWidth });
    };

    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  }

  function autoFit(col: GridColumn<R>) {
    const source = fitRows ?? rows;
    writeStoredWidths(widthsKey, {
      ...widths,
      [col.id]: withProbe((probe) => fittedWidth(col, probe, source)),
    });
  }

  const resetWidths = React.useCallback(() => {
    const source = fitRows ?? rows;
    writeStoredWidths(
      widthsKey,
      withProbe((probe) => {
        const next: Record<string, number> = {};
        for (const col of columns) {
          if (col.resizable === false) continue;
          next[col.id] = fittedWidth(col, probe, source);
        }
        const groupHeaderFont = fontFromToken("--font-family-technical", 600, 10.5);
        for (const id of ["project", "bms", "gateway", "device"] as BandId[]) {
          const label = bandLabel(id);
          const members = columns.filter((col) => col.group === id);
          if (members.length === 0) continue;
          const labelWidth =
            measureText(probe, groupHeaderFont, label, 10.5) +
            Math.max(0, label.length - 1) * 10.5 * 0.07 +
            24 +
            (id === "project" ? 148 : 0);
          const sum = members.reduce((s, col) => s + (next[col.id] ?? col.width), 0);
          const grow =
            [...members].reverse().find((col) => col.resizable !== false) ?? members.at(-1);
          if (grow && labelWidth > sum) next[grow.id] = (next[grow.id] ?? grow.width) + (labelWidth - sum);
        }
        return next;
      }),
    );
  }, [bandLabel, columns, fitRows, fittedWidth, rows, widthsKey]);

  const prevCompact = React.useRef<boolean | undefined>(undefined);
  React.useEffect(() => {
    const was = prevCompact.current;
    prevCompact.current = compact;
    if (!compact || was !== false) return;
    resetWidths();
  }, [compact, resetWidths]);

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
          {groups.map((g) => (
            <div
              key={g.id}
              className="relative flex shrink-0 items-center gap-2 overflow-hidden whitespace-nowrap border-b border-r px-2.5 font-mono text-[10.5px] font-semibold tracking-[0.07em]"
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
              <span className="min-w-0 truncate">
                {compact && g.label !== g.hint ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="truncate">{g.label}</span>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">{g.hint}</TooltipContent>
                  </Tooltip>
                ) : (
                  g.label
                )}
              </span>
              {g.frozen ? (
                <div className="ml-auto flex shrink-0 items-center gap-0.5">
                  {onToggleCompact ? (
                    <button
                      type="button"
                      aria-pressed={compact}
                      className={cn(
                        "rounded px-1.5 py-0.5 font-sans text-[10px] font-normal normal-case tracking-normal hover:bg-black/5",
                        compact ? "text-hms-accent hover:text-hms-accent-hover" : "text-fg-subtle hover:text-fg",
                      )}
                      onClick={onToggleCompact}
                    >
                      Compact
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="rounded px-1.5 py-0.5 font-sans text-[10px] font-normal normal-case tracking-normal text-fg-subtle hover:bg-black/5 hover:text-fg"
                    onClick={resetWidths}
                  >
                    Reset widths
                  </button>
                </div>
              ) : null}
            </div>
          ))}
        </div>
        <div className="sticky z-10 flex bg-table-header" style={{ top: GROUP_HEADER_H, height: COL_HEADER_H }}>
          {columns.map((col) => (
            <div
              key={col.id}
              className="relative flex shrink-0 items-center overflow-hidden whitespace-nowrap border-b border-border px-2.5 font-mono text-[10.5px] font-semibold uppercase tracking-[0.06em] text-fg-muted"
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
                <Checkbox
                  aria-label="Select all signals"
                  checked={allPageOn}
                  indeterminate={somePageOn && !allPageOn}
                  onChange={() => onTogglePage()}
                  onClick={(e) => e.stopPropagation()}
                />
              ) : compact ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="min-w-0 truncate">{displayedHeader(col, true)}</span>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">{headerTooltip(col)}</TooltipContent>
                </Tooltip>
              ) : (
                col.header
              )}
              {col.resizable !== false ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      aria-label={`Resize ${col.header || col.id} column`}
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
                  </TooltipTrigger>
                  <TooltipContent side="bottom">Drag to resize · Double-click to fit</TooltipContent>
                </Tooltip>
              ) : null}
            </div>
          ))}
        </div>
        {rows.map((row, rowIndex) => {
          const id = rowId(row);
          const err = rowError?.(row);
          const active = rowActive(row);
          const isSelected = selected.has(id);
          const background =
            focusId === id
              ? "var(--color-row-open)"
              : isSelected
                ? "var(--color-row-selected)"
                : err && active
                  ? "var(--color-row-error)"
                  : "#FFFFFF";
          return (
            <div
              key={id}
              ref={focusId === id ? (el) => el?.scrollIntoView({ block: "nearest" }) : undefined}
              className="flex"
              style={{ height: ROW_HEIGHT }}
            >
              {columns.map((col) => renderCell(row, col, rowIndex, { active, background }))}
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
