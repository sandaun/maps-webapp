import * as React from "react";
import { PAGE_SIZE } from "./types";
import type { ActiveFilter } from "./signals-toolbar";

export function usePagedSignals<R>(
  rows: R[],
  search: string,
  activeFilter: ActiveFilter,
  isActive: (row: R) => boolean,
  searchText: (row: R) => string,
  rowId: (row: R) => number,
) {
  const filterKey = `${search}\u0000${activeFilter}`;
  const [pagination, setPagination] = React.useState({ filterKey, page: 0 });

  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (q && !searchText(row).includes(q)) return false;
      if (activeFilter === "active") return isActive(row);
      if (activeFilter === "inactive") return !isActive(row);
      return true;
    });
  }, [rows, search, activeFilter, isActive, searchText]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const page = pagination.filterKey === filterKey ? Math.min(pagination.page, pageCount - 1) : 0;
  const setPage = React.useCallback(
    (next: React.SetStateAction<number>) => {
      setPagination((current) => {
        const currentPage =
          current.filterKey === filterKey ? Math.min(current.page, pageCount - 1) : 0;
        return {
          filterKey,
          page: typeof next === "function" ? next(currentPage) : next,
        };
      });
    },
    [filterKey, pageCount],
  );

  const pageRows = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const visibleIds = filtered.map(rowId);
  const pageIds = pageRows.map(rowId);

  return { page, setPage, filtered, pageRows, pageCount, visibleIds, pageIds };
}
