"use client";

import * as React from "react";
import { usePropertyDrafts } from "@/lib/property-drafts";
import { scopeKey } from "@/lib/property-draft-store";
import { formatFieldValue, type PropertyScreen } from "@/lib/property-fields";
import { cn } from "@/lib/utils";

/**
 * Summary names: just the property, with its device/node context only when
 * another pending edit shares the same name ("Description (Controller 1)").
 */
function summaryNames(labels: string[]): string[] {
  const split = labels.map((label) => {
    const parts = label.split(" · ");
    return { name: parts.at(-1)!, context: parts.slice(0, -1).join(" · ") };
  });
  return split.map(({ name, context }) =>
    context && split.filter((other) => other.name === name).length > 1 ? `${name} (${context})` : name,
  );
}

export function StickySaveBar({ screen }: { screen: PropertyScreen }) {
  const { store, snapshot, view, save, fields, immediateBusy } =
    usePropertyDrafts();
  const edits = view ? store.editsFor(view.meta.id, screen) : [];
  const state = (view && snapshot.states[scopeKey(view.meta.id, screen)]) || {};
  const count = edits.length;
  // Save/Discard close the bar under the keyboard user: hand focus to the
  // main content instead of letting it fall back to <body>.
  const returnFocus = React.useRef(false);
  React.useEffect(() => {
    if (!returnFocus.current) return;
    if (count === 0) {
      returnFocus.current = false;
      document.getElementById("main-content")?.focus();
    } else if (!state.saving) returnFocus.current = false;
  }, [count, state.saving]);
  const barRef = React.useRef<HTMLDivElement>(null);
  const noteFocus = () => {
    returnFocus.current = !!barRef.current?.contains(document.activeElement);
  };
  if (!view || !count) return null;
  const conflicts = edits.filter((edit) => edit.conflict);
  const invalid = Object.keys(state.invalid ?? {}).length;
  const error =
    state.error ||
    (conflicts.length
      ? "Some pending properties need your review. Your edits are still here."
      : invalid
        ? "Check the highlighted properties before saving. Your edits are still here."
        : undefined);
  const immediatePending = Object.entries(immediateBusy).some(
    ([key, value]) => key.startsWith(`${view.meta.id}:`) && value,
  );
  const discardBlocked = !!state.saving;
  const saveBlocked = !!state.saving || immediatePending || conflicts.length > 0;
  return (
    <div
      ref={barRef}
      role="region"
      className="sticky bottom-0 z-[8] pt-[14px] pb-1"
      aria-label="Pending property changes"
    >
      {conflicts.length > 0 && (
        <div className="mb-2 max-h-[220px] overflow-auto rounded-lg border border-[#FF9E91] bg-white p-3 text-[12px]">
          {conflicts.map((edit) => {
            const field = fields.find((candidate) => candidate.id === edit.id);
            const show = (raw: typeof edit.value) =>
              field ? formatFieldValue(field, raw) : String(raw);
            return (
              <div key={edit.id} className="mb-3 last:mb-0">
                <strong className="text-hms-blue">{edit.label}</strong>
                <p className="mt-1 text-fg-muted">
                  {edit.conflict === "entity"
                    ? "The project was changed elsewhere, so this node or device may have been replaced or removed. The pending value cannot be applied safely."
                    : `Saved: ${field ? show(field.base) : "—"}`}{" "}
                  · Pending: {show(edit.value)}
                </p>
                <div className="mt-2 flex gap-3">
                  {edit.conflict !== "entity" && (
                    <button
                      type="button"
                      disabled={state.saving}
                      className="cursor-pointer font-bold text-hms-accent"
                      onClick={() => store.resolve(view, edit.id, true)}
                    >
                      Keep my edit
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={state.saving}
                    className="cursor-pointer font-bold text-hms-accent"
                    onClick={() => store.resolve(view, edit.id, false)}
                  >
                    {edit.conflict === "entity"
                      ? "Discard this edit"
                      : "Use saved value"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {snapshot.storageWarning && (
        <p
          role="alert"
          className="mb-2 rounded border border-warning-border bg-warning-bg px-3 py-2 text-[12px] text-warning-text"
        >
          {snapshot.storageWarning}
        </p>
      )}
      <div
        className={cn(
          "property-save-bar flex flex-wrap items-center gap-3 rounded-lg border bg-[#043D5D] px-[13px] py-[11px] shadow-[0_24px_64px_rgba(4,61,93,0.25)]",
          error ? "border-[#FF9E91]/45" : "border-white/[0.08]",
        )}
      >
        <span
          aria-hidden
          className={cn(
            "size-2 shrink-0 rounded-full",
            error
              ? "bg-[#FF9E91] shadow-[0_0_0_4px_rgba(255,158,145,0.16)]"
              : "bg-[#F0C674] shadow-[0_0_0_4px_rgba(240,198,116,0.18)]",
          )}
        />
        <div
          className="min-w-[180px] flex-1"
          aria-live="polite"
          aria-atomic="true"
        >
          <div className="text-[12.5px] font-bold text-white">
            {state.saving
              ? `Saving ${count} ${count === 1 ? "change" : "changes"}…`
              : `${count} unsaved ${count === 1 ? "change" : "changes"}`}
          </div>
          <div
            role={error ? "alert" : undefined}
            className={cn(
              "mt-0.5 text-[11px] leading-[1.45]",
              error ? "text-[#FF9E91]" : "text-white/[0.62]",
            )}
          >
            {error ??
              `${summaryNames(edits.map((edit) => edit.label))
                .slice(0, 3)
                .join(" · ")}${count > 3 ? ` + ${count - 3} more` : ""}`}
          </div>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {/* aria-disabled rather than disabled: the pressed button keeps keyboard focus while it waits. */}
          <button
            type="button"
            aria-disabled={discardBlocked || undefined}
            onClick={() => {
              if (discardBlocked) return;
              noteFocus();
              store.discard(view.meta.id, screen);
            }}
            className="cursor-pointer whitespace-nowrap rounded border border-white/[0.28] bg-transparent px-[13px] py-[7px] text-[12px] font-bold text-white hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-white aria-disabled:cursor-default aria-disabled:opacity-50 aria-disabled:hover:bg-transparent"
          >
            Discard
          </button>
          <button
            type="button"
            aria-disabled={saveBlocked || undefined}
            aria-busy={state.saving || undefined}
            onClick={() => {
              if (saveBlocked) return;
              noteFocus();
              void save(screen);
            }}
            className="inline-flex cursor-pointer items-center gap-[7px] whitespace-nowrap rounded bg-hms-accent px-[15px] py-[7px] text-[12px] font-bold text-white focus-visible:outline-2 focus-visible:outline-white aria-disabled:cursor-default aria-disabled:bg-[rgba(18,104,179,0.55)]"
          >
            {state.saving && (
              <span
                aria-hidden
                className="size-[11px] shrink-0 animate-spin rounded-full border-2 border-white/35 border-t-white motion-reduce:animate-none"
              />
            )}
            {state.saving ? "Saving…" : state.error ? "Retry" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
