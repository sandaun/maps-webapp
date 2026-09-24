"use client";

import { usePropertyDrafts } from "@/lib/property-drafts";
import { scopeKey } from "@/lib/property-draft-store";
import type { PropertyScreen } from "@/lib/property-fields";
import { cn } from "@/lib/utils";

export function StickySaveBar({ screen }: { screen: PropertyScreen }) {
  const { store, snapshot, view, save, fields, immediateBusy } =
    usePropertyDrafts();
  if (!view) return null;
  const edits = store.editsFor(view.meta.id, screen);
  if (!edits.length) return null;
  const state = snapshot.states[scopeKey(view.meta.id, screen)] ?? {};
  const count = edits.length;
  const conflicts = edits.filter((edit) => edit.conflict);
  const invalid = Object.keys(state.invalid ?? {}).length;
  const error =
    state.error ||
    (conflicts.length
      ? "Some recovered properties need your review. Your edits are still here."
      : invalid
        ? "Check the highlighted properties before saving. Your edits are still here."
        : undefined);
  const immediatePending = Object.entries(immediateBusy).some(
    ([key, value]) => key.startsWith(`${view.meta.id}:`) && value,
  );
  return (
    <div
      className="sticky bottom-0 z-[8] pt-[14px] pb-1"
      aria-label="Pending property changes"
    >
      {conflicts.length > 0 && (
        <div className="mb-2 max-h-[220px] overflow-auto rounded-lg border border-[#FF9E91] bg-white p-3 text-[12px]">
          {conflicts.map((edit) => {
            const field = fields.find((candidate) => candidate.id === edit.id);
            return (
              <div key={edit.id} className="mb-3 last:mb-0">
                <strong className="text-hms-blue">{edit.label}</strong>
                <p className="mt-1 text-fg-muted">
                  {edit.conflict === "entity"
                    ? "The device or property changed or is no longer available. This recovered value cannot be applied safely."
                    : `Saved: ${String(field?.base ?? "—")}`}{" "}
                  · Pending: {String(edit.value)}
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
              `${edits
                .slice(0, 3)
                .map((edit) => edit.label)
                .join(" · ")}${count > 3 ? ` + ${count - 3} more` : ""}`}
          </div>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <button
            type="button"
            disabled={state.saving}
            onClick={() => store.discard(view.meta.id, screen)}
            className="cursor-pointer whitespace-nowrap rounded border border-white/[0.28] bg-transparent px-[13px] py-[7px] text-[12px] font-bold text-white hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-white disabled:cursor-default disabled:opacity-50"
          >
            Discard
          </button>
          <button
            type="button"
            disabled={state.saving || immediatePending || conflicts.length > 0}
            onClick={() => void save(screen)}
            className="inline-flex cursor-pointer items-center gap-[7px] whitespace-nowrap rounded bg-hms-accent px-[15px] py-[7px] text-[12px] font-bold text-white focus-visible:outline-2 focus-visible:outline-white disabled:cursor-default disabled:bg-[rgba(18,104,179,0.55)]"
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
