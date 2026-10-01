"use client";

import * as React from "react";
import * as Popover from "@radix-ui/react-popover";
import { ArrowDown, ArrowUp, ChevronDown, Hash, Pencil, SlidersHorizontal, ToggleLeft, ToggleRight, Trash2, X, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SignalReorder } from "./use-signal-reorder";

export interface SignalSelectionActions {
  selectedCount: number;
  matchingCount: number;
  pageFullySelected: boolean;
  onEnable: () => void;
  onDisable: () => void;
  onDelete?: () => void;
  onClear: () => void;
  onEditField?: () => void;
  onAutoNumber?: () => void;
  onConversions?: () => void;
  onSelectAllMatching: () => void;
  reorder?: SignalReorder;
}

/** The grid hosts the bar outside its scroll pane and leaves room below the last row. */
export const SignalSelectionBarContext = React.createContext<{ bar: React.ReactNode; inset: number } | null>(null);

interface SelectionAction {
  id: string;
  group: "state" | "edit" | "order" | "delete";
  label: string;
  shortLabel?: string;
  icon: LucideIcon;
  onClick: () => void;
  disabled?: boolean;
  hint?: string;
}

const ACTION_BUTTON = "inline-flex h-8 shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-[7px] px-2.5 text-[12.5px] font-bold whitespace-nowrap hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-white disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent";

export function SignalsSelectionBar({ selectedCount, matchingCount, pageFullySelected, onEnable, onDisable, onDelete, onClear, onEditField, onAutoNumber, onConversions, onSelectAllMatching, reorder }: SignalSelectionActions) {
  const availableRef = React.useRef<HTMLDivElement>(null);
  const [width, setWidth] = React.useState<number | null>(null);
  const [moreOpen, setMoreOpen] = React.useState(false);
  const [confirmDeleteCount, setConfirmDeleteCount] = React.useState<number | null>(null);
  const confirmDelete = confirmDeleteCount === selectedCount;
  const showSelectAllMatching = pageFullySelected && matchingCount > selectedCount;

  React.useEffect(() => {
    const element = availableRef.current;
    if (!element) return;
    const measure = () => {
      const next = element.getBoundingClientRect().width;
      if (next > 0) setWidth(next);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Families expose different actions. Keep the shorter ME–MBS bar expanded longer.
  // Reserve the longer confirmation label too, so Delete never moves after its first click.
  const expandedWidth = 316 + Math.max(0, String(selectedCount).length - 2) * 8 +
    (onEditField ? 102 : 0) + (onAutoNumber ? 94 : 0) +
    (onConversions ? 125 : 0) + (reorder ? 83 : 0) + (onDelete ? 137 : 0);
  const compact = width !== null && width < expandedWidth;
  const narrow = width !== null && width < 520;
  const tiny = width !== null && width < 320;
  const actions: SelectionAction[] = [
    { id: "enable", group: "state", label: "Enable", icon: ToggleRight, onClick: onEnable },
    { id: "disable", group: "state", label: "Disable", icon: ToggleLeft, onClick: onDisable },
    ...(onEditField ? [{ id: "edit", group: "edit" as const, label: "Edit field…", shortLabel: "Edit field", icon: Pencil, onClick: onEditField }] : []),
    ...(onAutoNumber ? [{ id: "number", group: "edit" as const, label: "Number addresses…", shortLabel: "Number", icon: Hash, onClick: onAutoNumber }] : []),
    ...(onConversions ? [{ id: "conversions", group: "edit" as const, label: "Conversions…", shortLabel: "Conversions", icon: SlidersHorizontal, onClick: onConversions }] : []),
    ...(reorder ? ([-1, 1] as const).map((direction) => ({
      id: direction < 0 ? "up" : "down", group: "order" as const,
      label: direction < 0 ? "Move up" : "Move down", icon: direction < 0 ? ArrowUp : ArrowDown,
      onClick: () => reorder.moveSelection(direction), disabled: !reorder.canMoveSelection(direction),
      hint: reorder.filtered ? "Clear filters to reorder signals" : undefined,
    })) : []),
    ...(onDelete ? [{
      id: "delete", group: "delete" as const, label: confirmDelete ? "Confirm delete" : `Delete ${selectedCount}`,
      shortLabel: confirmDelete ? "Confirm delete" : "Delete", icon: Trash2,
      onClick: () => {
        if (!confirmDelete) { setConfirmDeleteCount(selectedCount); return; }
        setConfirmDeleteCount(null);
        setMoreOpen(false);
        onDelete();
      },
    }] : []),
  ];
  const visible = actions.filter((action) => !compact || (action.id === "edit" && !tiny) || (!narrow && action.group === "state"));
  const overflow = actions.filter((action) => !visible.includes(action));

  function run(action: SelectionAction) {
    if (action.id !== "delete") setMoreOpen(false);
    action.onClick();
  }

  return (
    <div ref={availableRef} className="flex w-full min-w-0 justify-center">
      <div role="toolbar" aria-label="Bulk signal actions"
        className="pointer-events-auto flex max-w-full flex-col rounded-[11px] border border-white/10 bg-hms-blue p-[5px] text-white shadow-[0_10px_30px_rgba(0,30,60,.28),0_2px_6px_rgba(0,30,60,.18)] animate-[property-save-up_.18s_ease-out] motion-reduce:animate-none">
        {showSelectAllMatching && (
          <button type="button" className="mb-1 h-7 cursor-pointer rounded-md px-2 text-[12px] font-bold text-white/90 hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-white" onClick={onSelectAllMatching}>
            Select all {matchingCount} matching
          </button>
        )}
        <div className="flex items-center gap-0.5">
          <span aria-live="polite" aria-atomic="true" className="flex h-8 shrink-0 items-center gap-1.5 px-2 text-[12.5px] font-bold whitespace-nowrap">
            <span className="sr-only">{selectedCount} signal{selectedCount === 1 ? "" : "s"} selected</span>
            <span aria-hidden className="flex min-w-5 items-center justify-center rounded-full bg-white px-1.5 text-[11.5px] text-hms-blue">{selectedCount}</span>
            <span aria-hidden className={cn(narrow && "hidden")}>selected</span>
          </span>
          {visible.map((action, index) => {
            const Icon = action.icon;
            return (
              <React.Fragment key={action.id}>
                {(index === 0 || visible[index - 1].group !== action.group) && <span aria-hidden className="mx-1 h-5 w-px shrink-0 bg-white/20" />}
                <button type="button" aria-label={action.label} title={action.hint ?? action.label} disabled={action.disabled} onClick={() => run(action)}
                  className={cn(ACTION_BUTTON, action.group === "order" && "w-8 px-0", action.group === "delete" && "text-[#FFB8AE] hover:bg-error hover:text-white")}>
                  <Icon size={15} strokeWidth={1.7} aria-hidden />
                  {action.group !== "order" && (action.shortLabel ?? action.label)}
                </button>
              </React.Fragment>
            );
          })}
          {overflow.length > 0 && (
            <Popover.Root open={moreOpen} onOpenChange={(open) => { setMoreOpen(open); if (!open) setConfirmDeleteCount(null); }}>
              <Popover.Trigger asChild>
                <button type="button" className={ACTION_BUTTON} aria-label="More selection actions">More <ChevronDown size={13} aria-hidden /></button>
              </Popover.Trigger>
              <Popover.Portal>
                <Popover.Content side="top" align="end" sideOffset={10} collisionPadding={12} aria-label="More selection actions"
                  onEscapeKeyDown={(event) => event.stopPropagation()}
                  className="z-50 max-h-[var(--radix-popover-content-available-height)] w-56 overflow-auto rounded-lg border border-border bg-white p-1 text-text-body shadow-[0_10px_28px_rgba(0,30,60,.16)]">
                  {overflow.map((action, index) => {
                    const Icon = action.icon;
                    return (
                      <React.Fragment key={action.id}>
                        {index > 0 && overflow[index - 1].group !== action.group && <div className="my-1 h-px bg-border" />}
                        <button type="button" disabled={action.disabled} title={action.hint} onClick={() => run(action)}
                          className={cn("flex min-h-8 w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] hover:bg-info-bg focus-visible:outline-2 focus-visible:outline-hms-accent disabled:cursor-default disabled:opacity-40", action.group === "delete" && "text-error hover:bg-error-bg")}>
                          <Icon size={15} aria-hidden />{action.label}
                        </button>
                      </React.Fragment>
                    );
                  })}
                </Popover.Content>
              </Popover.Portal>
            </Popover.Root>
          )}
          <span aria-hidden className="mx-1 h-5 w-px shrink-0 bg-white/20" />
          <button type="button" aria-label="Clear selection" title="Clear selection (Esc)" className={cn(ACTION_BUTTON, "w-8 px-0 text-white/80")} onClick={onClear}><X size={15} aria-hidden /></button>
        </div>
      </div>
    </div>
  );
}
