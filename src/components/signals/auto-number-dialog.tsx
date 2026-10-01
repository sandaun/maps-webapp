"use client";

import * as React from "react";
import type { ProjectPatchInput } from "@/lib/project-types";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { planAutoNumber, type AutoNumberField, type AutoNumberRow } from "./auto-number";

export function AutoNumberDialog({
  rows,
  selectedIds,
  family,
  extendedAddresses = false,
  registerBase = 0,
  collisionWarning,
  onClose,
  onApply,
}: {
  rows: AutoNumberRow[];
  selectedIds: number[];
  family: "knx-mbm" | "mbs-knx" | "me-mbs";
  extendedAddresses?: boolean;
  registerBase?: 0 | 1;
  collisionWarning?: (updates: ReadonlyMap<number, number>) => string | null;
  onClose: () => void;
  onApply: (patches: ProjectPatchInput[], inverses: ProjectPatchInput[]) => Promise<void>;
}) {
  const [field, setField] = React.useState<AutoNumberField>("modbus");
  const [level, setLevel] = React.useState<1 | 2 | 3>(3);
  const [start, setStart] = React.useState("");
  const [increment, setIncrement] = React.useState("1");
  const [busy, setBusy] = React.useState(false);
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const selected = React.useMemo(() => new Set(selectedIds), [selectedIds]);
  const skipVirtual = (family === "knx-mbm" && field === "modbus") ||
    (family === "mbs-knx" && field === "knx");
  const min = field === "knx" ? 1 : family === "knx-mbm" ? 0 : registerBase;
  const max = field === "knx" ? extendedAddresses ? 65535 : 32767 : family === "knx-mbm" ? 65535 : 20000;
  const plan = planAutoNumber({ rows, selected, field, start, increment, min, max, level, skipVirtual });
  const updates = new Map(plan.entries.flatMap((entry) => entry.value === undefined ? [] : [[entry.id, entry.value] as const]));
  const warning = field === "modbus" && !plan.error ? collisionWarning?.(updates) : null;

  function changeField(next: string) {
    const value = next as AutoNumberField;
    setField(value);
    setSaveError(null);
    setStart("");
  }

  async function apply() {
    if (plan.error || busy) return;
    const patches: ProjectPatchInput[] = [];
    const inverses: ProjectPatchInput[] = [];
    for (const entry of plan.entries) {
      if (entry.value === undefined) continue;
      if (field === "knx") {
        patches.push({ type: "updateSignal", id: entry.id, patch: { knx: { groupAddress: entry.value, groupAddressLevel: level } } });
        inverses.push({ type: "updateSignal", id: entry.id, patch: { knx: { groupAddress: entry.previousValue, groupAddressLevel: entry.previousLevel ?? 3 } } });
      } else {
        patches.push({ type: "updateSignal", id: entry.id, patch: { modbus: { address: entry.value } } });
        inverses.push({ type: "updateSignal", id: entry.id, patch: { modbus: { address: entry.previousValue } } });
      }
    }
    setBusy(true);
    setSaveError(null);
    try {
      await onApply(patches, inverses);
      onClose();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Could not save addresses.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-hms-blue/40 p-4" role="presentation">
      <div role="dialog" aria-modal="true" aria-labelledby="auto-number-title" className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-lg border border-border bg-white p-5 shadow-lg">
        <h2 id="auto-number-title" className="font-display text-base font-medium text-hms-blue">Number addresses</h2>
        <p className="mt-1 text-xs text-fg-muted">Selected signals are numbered in table order, including rows outside the viewport.</p>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <label className="text-xs font-medium text-text-body">Address field
            <Select className="mt-1" size="sm" value={field} onValueChange={changeField} options={[
              { value: "modbus", label: "Modbus register" },
              ...(family !== "me-mbs" ? [{ value: "knx", label: "KNX sending address" }] : []),
            ]} />
          </label>
          {field === "knx" ? <label className="text-xs font-medium text-text-body">KNX format
            <Select className="mt-1" size="sm" value={String(level)} onValueChange={(value) => setLevel(Number(value) as 1 | 2 | 3)} options={[
              { value: "1", label: "1 level" }, { value: "2", label: "2 levels" }, { value: "3", label: "3 levels" },
            ]} />
          </label> : null}
          <label className="text-xs font-medium text-text-body">Starting address
            <Input className="mt-1" size="sm" value={start} onChange={(event) => setStart(event.target.value)} placeholder={field === "knx" ? "1/0/1" : String(min)} />
          </label>
          <label className="text-xs font-medium text-text-body">Increment
            <Input className="mt-1" size="sm" type="number" min={1} max={255} value={increment} onChange={(event) => setIncrement(event.target.value)} />
          </label>
        </div>
        {plan.error ? <p role="alert" className="mt-3 text-xs text-error">{plan.error}</p> : null}
        {warning ? <p role="status" className="mt-3 rounded border border-warning/30 bg-warning/10 p-2 text-xs text-text-body">{warning}</p> : null}
        {!plan.error ? <div className="mt-4 min-h-0 overflow-auto rounded border border-border">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-[#F5F6F7] text-fg-muted"><tr><th className="p-2">Signal</th><th className="p-2">Current</th><th className="p-2">New</th></tr></thead>
            <tbody>{plan.entries.map((entry) => <tr key={entry.id} className="border-t border-border"><td className="p-2">#{entry.id + 1} {entry.description}</td><td className="p-2 font-mono">{entry.before}</td><td className="p-2 font-mono">{entry.after}</td></tr>)}</tbody>
          </table>
        </div> : null}
        {saveError ? <p role="alert" className="mt-3 text-xs text-error">{saveError}</p> : null}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="rounded border border-border px-3 py-1.5 text-xs" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="rounded bg-hms-accent px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50" onClick={() => void apply()} disabled={!!plan.error || busy}>{busy ? "Saving…" : `Apply to ${updates.size} signals`}</button>
        </div>
      </div>
    </div>
  );
}
