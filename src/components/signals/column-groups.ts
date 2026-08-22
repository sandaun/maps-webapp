import type { ColumnGroup } from "./signals-toolbar";

export function columnGroupsFor<R>(
  columns: { id: string; group: string; header: string }[],
  groups: { id: string; label: string; color: string }[],
): ColumnGroup[] {
  return groups
    .map((group) => ({
      label: group.label,
      color: group.color,
      cols: columns
        .filter((col) => col.group === group.id && col.header)
        .map((col) => ({ id: col.id, label: col.header.toUpperCase() })),
    }))
    .filter((group) => group.cols.length > 0);
}
