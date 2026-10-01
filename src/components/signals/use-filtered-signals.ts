import * as React from "react";

export type SignalMapFilter = "all" | "errors" | "warn" | "disabled";

export function useFilteredSignals<R>(
  rows: R[],
  search: string,
  filter: SignalMapFilter,
  hideDisabled: boolean,
  isActive: (row: R) => boolean,
  hasError: (row: R) => boolean,
  hasWarning: (row: R) => boolean,
  searchText: (row: R) => string,
  rowId: (row: R) => number,
) {
  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (hideDisabled && !isActive(row)) return false;
      if (filter === "errors" && !hasError(row)) return false;
      if (filter === "warn" && !hasWarning(row)) return false;
      if (filter === "disabled" && isActive(row)) return false;
      if (q && !searchText(row).includes(q)) return false;
      return true;
    });
  }, [rows, search, filter, hideDisabled, isActive, hasError, hasWarning, searchText]);

  const visibleIds = React.useMemo(() => filtered.map(rowId), [filtered, rowId]);
  return { filtered, visibleIds };
}
