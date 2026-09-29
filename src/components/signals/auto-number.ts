import { formatGroupAddressAtLevel, parseGroupAddress } from "@/protocols/knx/address";

export type AutoNumberField = "modbus" | "knx";

export interface AutoNumberRow {
  id: number;
  description: string;
  virtual: boolean;
  address: number;
  groupAddress?: number;
  groupAddressLevel?: 1 | 2 | 3;
}

export interface AutoNumberEntry {
  id: number;
  description: string;
  before: string;
  after: string;
  value?: number;
  previousValue: number;
  previousLevel?: 1 | 2 | 3;
  skipped: boolean;
}

export function planAutoNumber(options: {
  rows: AutoNumberRow[];
  selected: ReadonlySet<number>;
  field: AutoNumberField;
  start: string;
  increment: string;
  min: number;
  max: number;
  level: 1 | 2 | 3;
  skipVirtual: boolean;
}): { entries: AutoNumberEntry[]; error?: string } {
  const { rows, selected, field, start, increment, min, max, level, skipVirtual } = options;
  const targets = rows.filter((row) => selected.has(row.id));
  if (targets.length === 0) return { entries: [], error: "Select at least one signal." };
  const step = /^\d+$/.test(increment.trim()) ? Number(increment) : NaN;
  if (!Number.isSafeInteger(step) || step < 1 || step > 255) {
    return { entries: [], error: "Increment must be between 1 and 255." };
  }
  const first = field === "knx"
    ? parseGroupAddress(start)
    : (/^\d+$/.test(start.trim()) ? Number(start) : undefined);
  if (first === undefined || !Number.isSafeInteger(first) || first < min || first > max) {
    return { entries: [], error: `Starting address must be between ${min} and ${max}.` };
  }

  let next = first;
  const entries: AutoNumberEntry[] = [];
  for (const row of targets) {
    const skipped = skipVirtual && row.virtual;
    const previousValue = field === "knx" ? row.groupAddress ?? 0 : row.address;
    const previousLevel = row.groupAddressLevel ?? 3;
    if (!skipped && next > max) {
      return { entries: [], error: `The sequence exceeds the maximum address ${max}.` };
    }
    entries.push({
      id: row.id,
      description: row.description,
      before: field === "knx" ? formatGroupAddressAtLevel(previousValue, previousLevel) : String(previousValue),
      after: skipped ? "Skipped (virtual)" : field === "knx" ? formatGroupAddressAtLevel(next, level) : String(next),
      ...(!skipped ? { value: next } : {}),
      previousValue,
      ...(field === "knx" ? { previousLevel } : {}),
      skipped,
    });
    if (!skipped) next += step;
  }
  if (entries.every((entry) => entry.skipped)) {
    return { entries, error: "The selection contains no editable signals." };
  }
  return { entries };
}
