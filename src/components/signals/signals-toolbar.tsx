"use client";

import * as React from "react";
import { Columns3, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SignalMapFilter } from "./use-paged-signals";

export interface FilterPill {
  id: SignalMapFilter;
  label: string;
  count: number;
}

export interface ColumnGroup {
  label: string;
  color: string;
  cols: { id: string; label: string }[];
}

export function SignalsToolbar({
  search,
  onSearch,
  placeholder,
  filters,
  activeFilter,
  onFilter,
  onAdd,
  columnsOpen,
  onToggleColumns,
  onImportExport,
  onCheckTable,
  checking,
}: {
  search: string;
  onSearch: (value: string) => void;
  placeholder: string;
  filters: FilterPill[];
  activeFilter: SignalMapFilter;
  onFilter: (value: SignalMapFilter) => void;
  onAdd?: () => void;
  columnsOpen: boolean;
  onToggleColumns: () => void;
  onImportExport: () => void;
  onCheckTable: () => void;
  checking?: boolean;
}) {
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-white px-[18px] py-[9px]">
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg-subtle"
          aria-hidden
        />
        <input
          aria-label="Search signals"
          placeholder={placeholder}
          className="h-[32px] w-[280px] rounded-[4px] border border-border bg-[#FBFBFC] py-1.5 pl-8 pr-3 text-[12.5px] outline-none placeholder:text-fg-subtle focus:border-hms-accent"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
        />
      </div>
      {filters.map((pill) => {
        const on = activeFilter === pill.id;
        return (
          <button
            key={pill.id}
            type="button"
            className={cn(
              "flex items-center gap-1.5 rounded-[4px] border px-2.5 py-1.5 text-[12.5px]",
              on
                ? "border-[#C9DEF0] bg-[#EAF3FB] font-medium text-hms-blue"
                : "border-transparent font-normal text-fg-muted hover:text-text-body",
            )}
            onClick={() => onFilter(pill.id)}
          >
            {pill.label}
            <span className={cn("font-mono text-[11px]", on ? "text-hms-accent" : "text-fg-subtle")}>
              {pill.count}
            </span>
          </button>
        );
      })}
      <div className="flex-1" />
      {onAdd ? (
        <ToolbarButton onClick={onAdd}>+ Add signal</ToolbarButton>
      ) : null}
      <ToolbarButton onClick={onToggleColumns} pressed={columnsOpen}>
        <Columns3 className="h-[13px] w-[13px]" strokeWidth={2} aria-hidden />
        Columns
      </ToolbarButton>
      <ToolbarButton onClick={onImportExport}>Import / export</ToolbarButton>
      <ToolbarButton onClick={onCheckTable} disabled={checking}>
        {checking ? "Checking…" : "Check table"}
      </ToolbarButton>
    </div>
  );
}

export function ColumnPicker({
  groups,
  isHidden,
  onToggle,
}: {
  groups: ColumnGroup[];
  isHidden: (id: string) => boolean;
  onToggle: (id: string) => void;
}) {
  return (
    <div className="flex shrink-0 items-start gap-[22px] border-b border-border bg-[#FAFBFC] px-[18px] py-2.5">
      {groups.map((group) => (
        <div key={group.label}>
          <div
            className="mb-1.5 font-mono text-[10.5px] font-semibold tracking-[0.07em]"
            style={{ color: group.color }}
          >
            {group.label}
          </div>
          <div className="flex max-w-[420px] flex-wrap gap-1.5">
            {group.cols.map((col) => {
              const hidden = isHidden(col.id);
              return (
                <button
                  key={col.id}
                  type="button"
                  className={cn(
                    "cursor-pointer rounded-full border px-2.5 py-1 text-[11.5px]",
                    hidden
                      ? "border-border bg-white text-fg-subtle"
                      : "border-[#C9DEF0] bg-[#EAF3FB] text-hms-blue",
                  )}
                  onClick={() => onToggle(col.id)}
                >
                  {col.label}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

export function SignalsFooter({
  shown,
  active,
  total,
  errors,
  warnings,
  hideDisabled,
  onToggleHideDisabled,
  page,
  pageCount,
  onPrev,
  onNext,
}: {
  shown: number;
  active: number;
  total: number;
  errors: number;
  warnings: number;
  hideDisabled: boolean;
  onToggleHideDisabled: () => void;
  page: number;
  pageCount: number;
  onPrev: () => void;
  onNext: () => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-4 border-t border-border bg-white px-[18px] py-[7px] text-[11.5px] text-fg-muted">
      <span>
        <b className="text-hms-blue">{shown}</b> shown · {active} active of {total}
      </span>
      <span className="font-mono">
        {errors} errors · {warnings} warnings
      </span>
      {pageCount > 1 ? (
        <span className="flex items-center gap-2">
          <button
            type="button"
            className="font-medium text-hms-accent disabled:text-fg-subtle"
            disabled={page <= 0}
            onClick={onPrev}
          >
            Previous
          </button>
          <button
            type="button"
            className="font-medium text-hms-accent disabled:text-fg-subtle"
            disabled={page >= pageCount - 1}
            onClick={onNext}
          >
            Next
          </button>
          <span className="font-mono">
            Page {page + 1} / {pageCount}
          </span>
        </span>
      ) : null}
      <div className="flex-1" />
      <button
        type="button"
        className="flex cursor-pointer items-center gap-1.5"
        onClick={onToggleHideDisabled}
      >
        <span
          className={cn(
            "relative h-4 w-7 rounded-full transition-colors",
            hideDisabled ? "bg-hms-accent" : "bg-toggle-off",
          )}
        >
          <span
            className={cn(
              "absolute top-0.5 size-3 rounded-full bg-white shadow-[0_1px_2px_rgba(4,61,93,0.3)] transition-[left]",
              hideDisabled ? "left-3.5" : "left-0.5",
            )}
          />
        </span>
        Hide disabled signals
      </button>
    </div>
  );
}

function ToolbarButton({
  children,
  onClick,
  pressed,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  pressed?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      className={cn(
        "flex items-center gap-1.5 rounded-[4px] border px-[11px] py-[7px] text-[12.5px] font-medium text-hms-blue hover:border-hms-accent disabled:opacity-50",
        pressed ? "border-hms-accent bg-[#F7FBFE]" : "border-border",
      )}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
