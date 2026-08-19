"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

export type ActiveFilter = "all" | "active" | "inactive";

export function SignalsToolbar({
  search,
  onSearch,
  placeholder,
  activeFilter,
  onFilter,
  onAdd,
  activeCount,
  total,
}: {
  search: string;
  onSearch: (value: string) => void;
  placeholder: string;
  activeFilter: ActiveFilter;
  onFilter: (value: ActiveFilter) => void;
  onAdd?: () => void;
  activeCount: number;
  total: number;
}) {
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg-subtle" aria-hidden />
        <Input
          aria-label="Search signals"
          placeholder={placeholder}
          className="w-80 pl-8"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
        />
      </div>
      <Select
        aria-label="Filter by state"
        className="w-32"
        value={activeFilter}
        onChange={(e) => onFilter(e.target.value as ActiveFilter)}
      >
        <option value="all">All</option>
        <option value="active">Active</option>
        <option value="inactive">Inactive</option>
      </Select>
      {onAdd ? (
        <Button size="sm" variant="secondary" onClick={onAdd}>
          <Plus className="h-3.5 w-3.5" aria-hidden />
          Add signal
        </Button>
      ) : null}
      <span className="ml-auto font-mono text-xs text-fg-muted">
        {activeCount} active / {total}
      </span>
    </div>
  );
}

export function SignalsPagination({
  page,
  pageCount,
  filteredCount,
  total,
  onPrev,
  onNext,
}: {
  page: number;
  pageCount: number;
  filteredCount: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-2 text-xs text-fg-muted">
      <Button size="sm" variant="secondary" disabled={page <= 0} onClick={onPrev}>
        <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
        Previous
      </Button>
      <Button size="sm" variant="secondary" disabled={page >= pageCount - 1} onClick={onNext}>
        Next
        <ChevronRight className="h-3.5 w-3.5" aria-hidden />
      </Button>
      <span className="font-mono">
        Page {page + 1} / {Math.max(1, pageCount)}
      </span>
      <span>
        · {filteredCount} of {total} signals
      </span>
    </div>
  );
}
