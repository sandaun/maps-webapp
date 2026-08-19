"use client";

import * as React from "react";
import type { ProjectPatchInput, SignalPatchInput } from "@/lib/project-types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { GridColumn } from "./types";

export function BulkEditDialog<R>({
  columns,
  rows,
  selectedIds,
  rowId,
  onClose,
  onApply,
}: {
  columns: GridColumn<R>[];
  rows: R[];
  selectedIds: number[];
  rowId: (row: R) => number;
  onClose: () => void;
  onApply: (patches: ProjectPatchInput[], inverses: ProjectPatchInput[]) => Promise<void>;
}) {
  const bulkCols = columns.filter((c) => c.bulkLabel && c.kind !== "none" && c.kind !== "flags");
  const initialCol = bulkCols[0];
  const sample = rows.find((row) => selectedIds.includes(rowId(row)));
  const [field, setField] = React.useState(initialCol?.id ?? "");
  const [value, setValue] = React.useState(() =>
    initialCol && sample ? (initialCol.getEditorValue?.(sample) ?? "") : "",
  );
  const [checked, setChecked] = React.useState(() =>
    initialCol?.kind === "switch" && sample ? !!initialCol.getChecked?.(sample) : true,
  );
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const col = bulkCols.find((c) => c.id === field) ?? bulkCols[0];

  function selectField(nextField: string) {
    setField(nextField);
    setError(null);
    const nextCol = bulkCols.find((candidate) => candidate.id === nextField);
    if (!nextCol || !sample) return;
    if (nextCol.kind === "switch") setChecked(!!nextCol.getChecked?.(sample));
    else setValue(nextCol.getEditorValue?.(sample) ?? "");
  }

  async function apply() {
    if (!col) return;
    setError(null);
    const raw = col.kind === "switch" ? (checked ? "true" : "false") : value;
    const targets = rows.filter((row) => selectedIds.includes(rowId(row)));
    const patches: ProjectPatchInput[] = [];
    const inverses: ProjectPatchInput[] = [];
    for (const row of targets) {
      const parsed = col.parse?.(row, raw);
      if (!parsed) continue;
      if ("error" in parsed) {
        setError(parsed.error);
        return;
      }
      const id = rowId(row);
      patches.push({ type: "updateSignal", id, patch: parsed.patch });
      const inverse: SignalPatchInput =
        col.kind === "switch" ? (col.inverseFromSwitch?.(row) ?? {}) : (col.inverseFromText?.(row) ?? {});
      inverses.push({ type: "updateSignal", id, patch: inverse });
    }
    if (patches.length === 0) {
      onClose();
      return;
    }
    setBusy(true);
    try {
      await onApply(patches, inverses);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-hms-blue/40 p-4" role="presentation">
      <div
        role="dialog"
        aria-labelledby="bulk-edit-title"
        className="w-full max-w-sm rounded-lg border border-border bg-white p-4 shadow-lg"
      >
        <h2 id="bulk-edit-title" className="font-display text-base font-medium text-hms-blue">
          Edit field…
        </h2>
        <p className="mt-1 text-xs text-fg-muted">
          Apply one value to {selectedIds.length} selected signal{selectedIds.length === 1 ? "" : "s"}.
        </p>
        <label className="mt-4 block text-xs font-medium text-text-body" htmlFor="bulk-field">
          Field
        </label>
        <Select
          id="bulk-field"
          className="mt-1"
          value={field}
          onChange={(e) => selectField(e.target.value)}
          aria-label="Bulk edit field"
        >
          {bulkCols.map((c) => (
            <option key={c.id} value={c.id}>
              {c.bulkLabel}
            </option>
          ))}
        </Select>
        {col?.kind === "switch" ? (
          <div className="mt-4 flex items-center gap-2">
            <Switch aria-label="Bulk value" checked={checked} onCheckedChange={setChecked} />
            <span className="text-sm">{checked ? "On" : "Off"}</span>
          </div>
        ) : col?.kind === "select" && sample ? (
          <>
            <label className="mt-4 block text-xs font-medium text-text-body" htmlFor="bulk-value">
              Value
            </label>
            <Select
              id="bulk-value"
              className="mt-1"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              aria-label="Bulk value"
            >
              {(col.options?.(sample) ?? []).map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </Select>
          </>
        ) : (
          <>
            <label className="mt-4 block text-xs font-medium text-text-body" htmlFor="bulk-value">
              Value
            </label>
            <Input
              id="bulk-value"
              className="mt-1"
              value={value}
              type={col?.kind === "number" ? "number" : "text"}
              onChange={(e) => setValue(e.target.value)}
              aria-label="Bulk value"
            />
          </>
        )}
        {error && (
          <p role="alert" className="mt-3 text-sm text-error">
            {error}
          </p>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <Button size="sm" variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button size="sm" onClick={() => void apply()} disabled={busy || !col}>
            Apply
          </Button>
        </div>
      </div>
    </div>
  );
}
