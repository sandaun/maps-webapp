"use client";

import * as React from "react";
import { X } from "lucide-react";
import {
  definedFlow,
  EMPTY_SLOTS,
  flowsOf,
  halfSteps,
  hasAnySlot,
  libraryLists,
  refsRoundTrip,
  selectionFromSlots,
  simulateFlow,
  slotsFromRefs,
  type ConversionFlow,
  type ConversionSlots,
  type SlotKey,
  type StepOutcome,
} from "@/core/conversions/assignment";
import {
  conversionExplanation,
  conversionHasInverse,
  conversionSummary,
  FILTER_TYPE_HINTS,
  formatConversionValue,
} from "@/core/conversions/formulas";
import {
  CONVERSION_TYPE,
  conversionErrors,
  defaultConversion,
  filterValueParams,
  FILTER_DESCRIPTION_MAX,
  isEditableConversionType,
  OPERATION_DESCRIPTION_MAX,
  parseConversionNumber,
  type ConversionValues,
} from "@/core/conversions/rules";
import { knxConversionRwMode } from "@/gateway-families/knx-mbm/conversions";
import type { KnxMbmProject, KnxMbmSignal } from "@/gateway-families/knx-mbm/model";
import type { ConversionRwMode } from "@/core/signals/conversion-refs";
import { formatGroupAddress } from "@/protocols/knx/address";
import { formatDpt } from "@/protocols/knx/dpt";
import { FORMAT_LABELS } from "@/protocols/modbus/master";
import type { ProjectPatchInput } from "@/lib/project-types";
import { FILTER_CONDITION_LABELS, FILTER_TYPE_LABELS, OPERATION_TYPE_LABELS } from "@/lib/property-fields";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { conversionName, FLOW_LABELS, storedFlowLines } from "./conversion-chain";
import { knxDeviceLabel, knxSlaveLabel } from "./columns-knx-mbm";

type Conversion = KnxMbmProject["conversions"][number];
/** An entry created from the picker; it joins the library when the dialog is applied. */
type NewEntry = { type: 0 | 1 | 2; description: string; params: [string, string, string, string] };

const SLOT_ORDER: SlotKey[] = ["internalFilter", "op1", "op2", "externalFilter"];
const SLOT_CAPTIONS: Record<SlotKey, string> = {
  internalFilter: "KNX side · filter",
  op1: "Operation",
  op2: "Operation",
  externalFilter: "Modbus side · filter",
};
const isFilterSlot = (slot: SlotKey) => slot === "internalFilter" || slot === "externalFilter";

function flagsText(signal: KnxMbmSignal): string {
  const f = signal.knx.flags;
  return (["u", "t", "ri", "w", "r"] as const)
    .filter((k) => f[k])
    .map((k) => (k === "ri" ? "Ri" : k.toUpperCase()))
    .join(" ");
}

const MODE_LABELS: Record<ConversionRwMode, string> = {
  read: "Read only",
  write: "Write only",
  readwrite: "Read + write",
};
const MODE_ORDER: ConversionRwMode[] = ["read", "write", "readwrite"];
const hasStoredRefs = (signal: KnxMbmSignal) =>
  halfSteps(signal.conversions.internal).length > 0 || halfSteps(signal.conversions.external).length > 0;

/**
 * Assignment editor (MAPS `frmSelectConversion`, V15 layout): one KNX–MBM
 * signal, or — with `signals` — the bulk mode of a selection. In bulk the
 * slots apply to the signals of one direction (the operations mean something
 * different on each); the rest are listed as skipped with the reason.
 */
export function ConversionAssignDialog({
  signal: single,
  signals: selection,
  project,
  busy,
  error,
  onClose,
  onApply,
}: {
  signal?: KnxMbmSignal;
  signals?: KnxMbmSignal[];
  project: KnxMbmProject;
  busy?: boolean;
  error?: string | null;
  onClose: () => void;
  /** Resolves true once the patches are saved; `inverses` undo them. */
  onApply: (patches: ProjectPatchInput[], inverses: ProjectPatchInput[]) => Promise<boolean>;
}) {
  const bulk = !!selection;
  const targets = React.useMemo(() => selection ?? (single ? [single] : []), [selection, single]);
  const signal = targets[0];
  const modeCounts = React.useMemo(() => {
    const counts: Record<ConversionRwMode, number> = { read: 0, write: 0, readwrite: 0 };
    for (const s of targets) if (!s.virtual) counts[knxConversionRwMode(s.knx.flags)]++;
    return counts;
  }, [targets]);
  // The majority direction; the user can pick another one present in the selection.
  const [groupMode, setGroupMode] = React.useState<ConversionRwMode>(() =>
    MODE_ORDER.reduce((best, mode) => (modeCounts[mode] > modeCounts[best] ? mode : best), MODE_ORDER[0]),
  );
  const rwMode = bulk ? groupMode : knxConversionRwMode(signal.knx.flags);
  const applies = bulk
    ? targets.filter((s) => !s.virtual && knxConversionRwMode(s.knx.flags) === groupMode)
    : targets;
  const skipped = bulk
    ? targets
        .filter((s) => !applies.includes(s))
        .map((s) => ({
          signal: s,
          reason: s.virtual
            ? "Virtual signal · it has no Modbus side, so it cannot have conversions."
            : `${MODE_LABELS[knxConversionRwMode(s.knx.flags)]} · the operations would run in the other direction.`,
        }))
    : [];
  const clearable = bulk ? targets.filter((s) => !s.virtual && hasStoredRefs(s)) : [];
  const [confirmClear, setConfirmClear] = React.useState(false);
  const initial = React.useMemo(
    () => (bulk ? EMPTY_SLOTS : slotsFromRefs(signal.conversions, rwMode)),
    [bulk, signal, rwMode],
  );
  const [slots, setSlots] = React.useState<ConversionSlots>(initial);
  const [added, setAdded] = React.useState<NewEntry[]>([]);
  const [picking, setPicking] = React.useState<SlotKey | null>(null);
  const [confirmDiscard, setConfirmDiscard] = React.useState(false);
  /** The "+ New…" form of the open picker; typed values count as unsaved changes. */
  const [newDraft, setNewDraft] = React.useState<{ slot: SlotKey; entry: NewEntry; initial: NewEntry } | null>(null);
  /** A slot change (or closing the picker, null) waiting for "Discard the new …?". */
  /**
   * What waits for "Discard the new …?": another slot (or closing the picker, null),
   * or an existing entry / "Leave empty" chosen for the open slot.
   */
  const [leaveTo, setLeaveTo] = React.useState<
    | { next: SlotKey | null }
    | { choose: { slot: SlotKey; index: number | null } }
    /** Bulk: another direction of the selection. */
    | { mode: ConversionRwMode }
    | null
  >(null);

  const library = React.useMemo(
    () => libraryLists<ConversionValues>([...project.conversions, ...added]),
    [project.conversions, added],
  );
  const flows = flowsOf(rwMode);
  const defined = definedFlow(rwMode, slots.master);
  const lanes = [defined, ...flows.filter((flow) => flow !== defined)];
  const draftTyped = !!newDraft && JSON.stringify(newDraft.entry) !== JSON.stringify(newDraft.initial);
  const dirty = JSON.stringify(slots) !== JSON.stringify(initial) || added.length > 0 || draftTyped;
  const restorable = bulk || refsRoundTrip(signal.conversions, rwMode);

  const goTo = (next: SlotKey | null) => {
    setPicking(next);
    setNewDraft(null);
    setLeaveTo(null);
  };
  // Apply would close the dialog and lose the typed entry: it has to be created or cancelled first.
  const pendingNewMessage =
    newDraft && isFilterSlot(newDraft.slot)
      ? "Create or cancel the new filter first."
      : "Create or cancel the new operation first.";
  const choose = (slot: SlotKey, index: number | null) => {
    setSlots((s) => ({ ...s, [slot]: index }));
    goTo(null);
  };
  const changeMode = (mode: ConversionRwMode) => {
    setGroupMode(mode);
    goTo(null);
  };
  const requestPick = (slot: SlotKey) => {
    const next = picking === slot ? null : slot;
    if (draftTyped) setLeaveTo({ next });
    else goTo(next);
  };
  const startNew = (slot: SlotKey) => {
    const filter = isFilterSlot(slot);
    const listSize = filter ? library.filters.length : library.operations.filter((c) => isEditableConversionType(c.type)).length;
    const base = defaultConversion(filter ? CONVERSION_TYPE.FILTER : CONVERSION_TYPE.ARITH, listSize);
    const entry: NewEntry = { type: base.type as NewEntry["type"], description: base.description, params: base.params };
    setNewDraft({ slot, entry, initial: entry });
  };

  const entryAt = (slot: SlotKey) => {
    const index = slots[slot];
    return index === null ? null : (library[isFilterSlot(slot) ? "filters" : "operations"][index] ?? undefined);
  };
  const missing = SLOT_ORDER.filter((slot) => entryAt(slot) === undefined);
  const noInverse =
    flows.length === 2
      ? (["op1", "op2"] as const).map(entryAt).filter((conv): conv is ConversionValues => !!conv && !conversionHasInverse(conv))
      : [];
  // Bulk: empty slots would clear the group; "Clear conversions" is the explicit way to do that.
  const blocked =
    missing.length > 0 || noInverse.length > 0 || (bulk && (!hasAnySlot(slots) || applies.length === 0));

  const close = () => {
    if (dirty && !confirmDiscard) setConfirmDiscard(true);
    else onClose();
  };
  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (dirty && !confirmDiscard) setConfirmDiscard(true);
      else onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dirty, confirmDiscard, onClose]);

  const restoreAll = (list: KnxMbmSignal[]): ProjectPatchInput[] =>
    list.map((s) => ({ type: "restoreSignalConversions", id: s.id, refs: s.conversions }));
  const clear = async () => {
    const patches: ProjectPatchInput[] = clearable.map((s) => ({
      type: "updateSignal",
      id: s.id,
      patch: { conversions: selectionFromSlots(EMPTY_SLOTS) },
    }));
    if (await onApply(patches, restoreAll(clearable))) onClose();
  };
  const apply = async () => {
    const counts = { filters: project.conversions.filter((c) => c.type === CONVERSION_TYPE.FILTER).length };
    const additions: ProjectPatchInput[] = added.map((entry) => ({
      type: "addConversion",
      conversionType: entry.type,
      values: {
        description: entry.description,
        params: entry.params.map((p) => parseConversionNumber(p) ?? 0) as [number, number, number, number],
      },
    }));
    const patches: ProjectPatchInput[] = [
      ...additions,
      ...applies.map((s) => ({
        type: "updateSignal" as const,
        id: s.id,
        patch: { conversions: selectionFromSlots(slots) },
      })),
    ];
    // Undo puts back the refs both halves had (even non-standard ones), then drops the new
    // entries, which are the last positions of their lists.
    const operationsBefore = project.conversions.length - counts.filters;
    const addedFilters = added.filter((e) => e.type === CONVERSION_TYPE.FILTER).length;
    const addedOperations = added.length - addedFilters;
    const inverses: ProjectPatchInput[] = [
      ...restoreAll(applies),
      ...Array.from({ length: addedOperations }, (_, i) => ({
        type: "removeConversion" as const,
        list: "operations" as const,
        index: operationsBefore + addedOperations - 1 - i,
      })),
      ...Array.from({ length: addedFilters }, (_, i) => ({
        type: "removeConversion" as const,
        list: "filters" as const,
        index: counts.filters + addedFilters - 1 - i,
      })),
    ];
    if (await onApply(patches, inverses)) onClose();
  };

  const { modbus } = signal;
  const virtualCount = targets.filter((s) => s.virtual).length;
  const meta = bulk
    ? [
        `${targets.length} signals`,
        ...MODE_ORDER.filter((mode) => modeCounts[mode] > 0).map((mode) => `${modeCounts[mode]} ${MODE_LABELS[mode].toLowerCase()}`),
        ...(virtualCount ? [`${virtualCount} virtual`] : []),
      ].join(" · ")
    : [
        `KNX ${signal.knx.groupAddress > 0 ? formatGroupAddress(signal.knx.groupAddress) : "—"} · ${formatDpt(signal.knx.dpt)} · flags ${flagsText(signal) || "none"}`,
        `Modbus ${knxDeviceLabel(project.mbm, signal)} · slave ${knxSlaveLabel(project.mbm, signal)} · register ${modbus.address} · ${FORMAT_LABELS[modbus.format] ?? "?"} ${modbus.lenBits} bit`,
      ].join("   ·   ");
  const dirLabel = MODE_LABELS[rwMode];
  const title = bulk
    ? `Conversions · ${targets.length} selected signals`
    : `Conversions · #${signal.id + 1} ${signal.description || `Signal ${signal.id + 1}`}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-[26px]">
      <button
        type="button"
        aria-label="Close conversions"
        className="absolute inset-0 cursor-default bg-[rgba(4,61,93,.28)]"
        onClick={close}
      />
      <div
        role="dialog"
        aria-label={title}
        className="relative flex max-h-full w-[960px] max-w-full flex-col overflow-hidden rounded-lg bg-white shadow-[0_18px_45px_rgba(4,61,93,.22)]"
      >
        <div className="flex shrink-0 items-start gap-[14px] border-b border-border px-[22px] pb-[14px] pt-[18px]">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-[10px]">
              <h2 className="font-display text-[19px] font-normal text-hms-blue">{title}</h2>
              {!bulk && (
                <span className="inline-flex items-center rounded-full border border-border bg-[#F1F3F5] px-[7px] py-[2px] text-[11px] font-bold text-hms-blue">
                  {dirLabel}
                </span>
              )}
            </div>
            <p className="mt-[5px] font-mono text-[11.5px] leading-[1.5] text-fg-muted">{meta}</p>
          </div>
          <button
            type="button"
            title="Close"
            aria-label="Close"
            onClick={close}
            className="flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-[4px] text-fg-muted hover:bg-[#F1F3F5]"
          >
            <X className="h-[14px] w-[14px]" aria-hidden />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-[22px] pb-5 pt-4">
          {bulk ? (
            <BulkDirectionLine
              counts={modeCounts}
              mode={groupMode}
              onMode={(mode) => {
                if (mode === groupMode) return;
                if (draftTyped) setLeaveTo({ mode });
                else changeMode(mode);
              }}
              master={slots.master}
              onMaster={(master) => setSlots((s) => ({ ...s, master }))}
            />
          ) : (
            <DirectionLine
              signal={signal}
              rwMode={rwMode}
              master={slots.master}
              onMaster={(master) => setSlots((s) => ({ ...s, master }))}
            />
          )}
          {lanes.map((flow) => (
            <Lane
              key={flow}
              flow={flow}
              editable={flow === defined}
              derived={flows.length === 2 && flow !== defined}
              signal={bulk ? undefined : signal}
              project={project}
              rwMode={rwMode}
              slots={slots}
              library={library}
              picking={flow === defined ? picking : null}
              onPick={requestPick}
              onChoose={(slot, index) => {
                if (draftTyped) setLeaveTo({ choose: { slot, index } });
                else choose(slot, index);
              }}
              draft={newDraft && newDraft.slot === picking ? newDraft.entry : null}
              leaving={!!leaveTo}
              onStartNew={startNew}
              onDraftChange={(entry) => setNewDraft((d) => (d ? { ...d, entry } : d))}
              onCancelNew={() => setNewDraft(null)}
              onKeepEditing={() => setLeaveTo(null)}
              onLeave={() => {
                if (leaveTo && "choose" in leaveTo) choose(leaveTo.choose.slot, leaveTo.choose.index);
                else if (leaveTo && "mode" in leaveTo) changeMode(leaveTo.mode);
                else goTo(leaveTo && "next" in leaveTo ? leaveTo.next : null);
              }}
              onCreate={(slot, entry) => {
                // A filter can only fill a filter slot and an operation an operation slot.
                if (isFilterSlot(slot) !== (entry.type === CONVERSION_TYPE.FILTER)) return;
                const list = entry.type === CONVERSION_TYPE.FILTER ? "filters" : "operations";
                const index = library[list].length;
                setAdded((current) => [...current, entry]);
                setSlots((s) => ({ ...s, [slot]: index }));
                goTo(null);
              }}
              missing={missing}
              noInverse={flow !== defined ? noInverse : []}
            />
          ))}
          {bulk && <BulkLists applies={applies} skipped={skipped} mode={groupMode} />}
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-[9px] border-t border-border bg-card-foot px-[22px] py-[14px]">
          {confirmClear ? (
            <>
              <p className="min-w-[220px] flex-1 text-[12px] font-bold text-hms-blue">
                {`Clear the conversions of ${clearable.length} ${clearable.length === 1 ? "signal" : "signals"}? Undo puts them back.`}
              </p>
              <Button variant="secondary" size="sm" className="h-8" onClick={() => setConfirmClear(false)}>
                Keep them
              </Button>
              <Button size="sm" className="h-8" disabled={busy} onClick={() => void clear()}>
                Clear conversions
              </Button>
            </>
          ) : confirmDiscard ? (
            <>
              <p className="min-w-[220px] flex-1 text-[12px] font-bold text-hms-blue">
                {bulk ? "Discard your changes?" : "Discard your changes to this signal's conversions?"}
              </p>
              <Button variant="secondary" size="sm" className="h-8" onClick={() => setConfirmDiscard(false)}>
                Keep editing
              </Button>
              <Button size="sm" className="h-8" onClick={onClose}>
                Discard
              </Button>
            </>
          ) : (
            <>
              <div className="min-w-[220px] flex-1 text-[11.5px] leading-[1.45] text-fg-subtle">
                {error ? (
                  <p role="alert" className="text-error">
                    {error}
                  </p>
                ) : draftTyped ? (
                  <p role="status" className="font-bold text-warning-text">
                    {pendingNewMessage}
                  </p>
                ) : (
                  <>
                    <p>
                      {bulk
                        ? "Skipped signals keep their current conversions."
                        : "Applies to this signal only. To change a filter or operation itself, edit it in Configuration → Conversions."}
                    </p>
                    {!restorable && (
                      <div className="text-warning-text">
                        <p>
                          Its current conversions are not stored the way MAPS stores them: applying rewrites both
                          halves (Undo puts them back). Stored now:
                        </p>
                        {storedFlowLines(signal, project.conversions).map((line) => (
                          <p key={line} className="font-mono text-[11px]">
                            {line}
                          </p>
                        ))}
                      </div>
                    )}
                    {added.length > 0 && (
                      <p>{`${added.length} new ${added.length === 1 ? "entry joins" : "entries join"} the conversion library.`}</p>
                    )}
                  </>
                )}
              </div>
              {bulk && (
                <Button
                  variant="secondary"
                  size="sm"
                  className="h-8"
                  disabled={clearable.length === 0 || dirty || busy}
                  title={
                    dirty
                      ? "Apply or discard the slots first"
                      : clearable.length === 0
                        ? "No selected signal has conversions"
                        : undefined
                  }
                  onClick={() => setConfirmClear(true)}
                >
                  Clear conversions…
                </Button>
              )}
              <Button variant="secondary" size="sm" className="h-8" onClick={close}>
                Cancel
              </Button>
              <Button
                size="sm"
                className="h-8"
                disabled={!dirty || blocked || draftTyped || busy}
                title={draftTyped ? pendingNewMessage : undefined}
                onClick={() => void apply()}
              >
                {bulk ? `Apply to ${applies.length} ${applies.length === 1 ? "signal" : "signals"}` : "Apply"}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function DirectionLine({
  signal,
  rwMode,
  master,
  onMaster,
}: {
  signal: KnxMbmSignal;
  rwMode: ReturnType<typeof knxConversionRwMode>;
  master: ConversionSlots["master"];
  onMaster: (master: ConversionSlots["master"]) => void;
}) {
  const flags = flagsText(signal);
  if (rwMode !== "readwrite")
    return (
      <p className="mb-3 text-[12.5px] text-fg-muted">
        {rwMode === "read"
          ? `Read only — the KNX flags (${flags}) only send status to KNX, so values only travel from Modbus to KNX.`
          : `Write only — without the R or T flag (${flags || "none"}) KNX only writes, so values only travel from KNX to Modbus.`}
      </p>
    );
  return (
    <div className="mb-3 flex flex-wrap items-center gap-[10px]">
      <span className="text-[12.5px] font-bold text-text-body">Define for</span>
      <div role="radiogroup" aria-label="Define the operations for" className="flex gap-1">
        {(
          [
            ["internal", "Write (KNX → Modbus)"],
            ["external", "Read (Modbus → KNX)"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={master === value}
            onClick={() => onMaster(value)}
            className={cn(
              "cursor-pointer whitespace-nowrap rounded-[4px] border px-[10px] py-[5px] text-[12px]",
              master === value
                ? "border-[#C9DEF0] bg-[#EAF3FB] font-bold text-hms-blue"
                : "border-border bg-white text-fg-muted hover:border-hms-accent",
            )}
          >
            {label}
          </button>
        ))}
      </div>
      <span className="text-[11.5px] text-fg-subtle">
        Read + write — the flags ({flags}) move values both ways. The other direction runs the operations inverted, in
        reverse order.
      </span>
    </div>
  );
}

function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: [T, string][];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1">
      {options.map(([option, text]) => (
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={value === option}
          onClick={() => onChange(option)}
          className={cn(
            "cursor-pointer rounded-[4px] border px-[10px] py-[5px] text-left text-[12px]",
            value === option
              ? "border-[#C9DEF0] bg-[#EAF3FB] font-bold text-hms-blue"
              : "border-border bg-white text-fg-muted hover:border-hms-accent",
          )}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

function BulkDirectionLine({
  counts,
  mode,
  onMode,
  master,
  onMaster,
}: {
  counts: Record<ConversionRwMode, number>;
  mode: ConversionRwMode;
  onMode: (mode: ConversionRwMode) => void;
  master: ConversionSlots["master"];
  onMaster: (master: ConversionSlots["master"]) => void;
}) {
  const present = MODE_ORDER.filter((m) => counts[m] > 0);
  return (
    <div className="mb-3 space-y-2">
      <p className="text-[12.5px] text-fg-muted">
        The slots replace the conversions of the signals of one direction: an operation means something different when
        the value travels the other way.
      </p>
      {present.length > 1 && (
        <div className="flex flex-wrap items-center gap-[10px]">
          <span className="text-[12.5px] font-bold text-text-body">Apply to</span>
          <Segmented
            label="Apply to the signals that are"
            options={present.map((m) => [m, `${MODE_LABELS[m]} (${counts[m]})`])}
            value={mode}
            onChange={onMode}
          />
        </div>
      )}
      {mode === "readwrite" && (
        <div className="flex flex-wrap items-center gap-[10px]">
          <span className="text-[12.5px] font-bold text-text-body">Define for</span>
          <Segmented
            label="Define the operations for"
            options={[
              ["internal", "Write (KNX → Modbus)"],
              ["external", "Read (Modbus → KNX)"],
            ]}
            value={master}
            onChange={onMaster}
          />
        </div>
      )}
    </div>
  );
}

function BulkLists({
  applies,
  skipped,
  mode,
}: {
  applies: KnxMbmSignal[];
  skipped: { signal: KnxMbmSignal; reason: string }[];
  mode: ConversionRwMode;
}) {
  const name = (s: KnxMbmSignal) => s.description || `Signal ${s.id + 1}`;
  return (
    <div className="grid items-start gap-3 [grid-template-columns:repeat(auto-fit,minmax(260px,1fr))]">
      <section aria-label="Signals it applies to" className="overflow-hidden rounded-[6px] border border-border">
        <h3 className="border-b border-border bg-card-foot px-3 py-2 text-[12px] font-bold text-hms-blue">
          {`Applies to ${applies.length} ${applies.length === 1 ? "signal" : "signals"}`}
        </h3>
        <div className="max-h-[220px] overflow-auto">
          {applies.map((s) => (
            <div key={s.id} className="flex items-center gap-2 border-b border-[#F2F3F4] px-3 py-[6px] text-[12px]">
              <span className="w-[34px] shrink-0 font-mono text-[11px] text-fg-subtle">#{s.id + 1}</span>
              <span className="min-w-0 flex-1 truncate text-text-body">{name(s)}</span>
              <span className="whitespace-nowrap font-mono text-[11px] text-fg-subtle">{MODE_LABELS[mode].toLowerCase()}</span>
            </div>
          ))}
        </div>
      </section>
      {skipped.length > 0 && (
        <section aria-label="Skipped signals" className="overflow-hidden rounded-[6px] border border-warning-border">
          <h3 className="border-b border-warning-border bg-warning-bg px-3 py-2 text-[12px] font-bold text-warning-text">
            {`${skipped.length} ${skipped.length === 1 ? "signal is" : "signals are"} skipped`}
          </h3>
          <div className="max-h-[220px] overflow-auto">
            {skipped.map(({ signal: s, reason }) => (
              <div key={s.id} className="flex gap-2 border-b border-[#F4EBDD] px-3 py-[7px] text-[12px]">
                <span className="w-[34px] shrink-0 pt-px font-mono text-[11px] text-fg-subtle">#{s.id + 1}</span>
                <div className="min-w-0 flex-1">
                  <div className="text-text-body">{name(s)}</div>
                  <div className="mt-px text-[11.5px] leading-[1.45] text-[#7A4E10]">{reason}</div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function describeOutcome(outcome: StepOutcome): string {
  switch (outcome.kind) {
    case "value":
      return formatConversionValue(outcome.value);
    case "discarded":
      return "not sent";
    case "not-simulated":
      return "not simulated";
    default:
      return "no value";
  }
}

function Lane({
  flow,
  editable,
  derived,
  signal,
  project,
  rwMode,
  slots,
  library,
  picking,
  onPick,
  onChoose,
  onCreate,
  draft,
  leaving,
  onStartNew,
  onDraftChange,
  onCancelNew,
  onKeepEditing,
  onLeave,
  missing,
  noInverse,
}: {
  flow: ConversionFlow;
  editable: boolean;
  derived: boolean;
  /** Undefined in bulk: the end nodes stand for every signal. */
  signal?: KnxMbmSignal;
  project: KnxMbmProject;
  rwMode: ReturnType<typeof knxConversionRwMode>;
  slots: ConversionSlots;
  library: ReturnType<typeof libraryLists<ConversionValues>>;
  picking: SlotKey | null;
  onPick: (slot: SlotKey) => void;
  onChoose: (slot: SlotKey, index: number | null) => void;
  onCreate: (slot: SlotKey, entry: NewEntry) => void;
  draft: NewEntry | null;
  leaving: boolean;
  onStartNew: (slot: SlotKey) => void;
  onDraftChange: (entry: NewEntry) => void;
  onCancelNew: () => void;
  onKeepEditing: () => void;
  onLeave: () => void;
  missing: SlotKey[];
  noInverse: ConversionValues[];
}) {
  const [test, setTest] = React.useState("");
  const input = parseConversionNumber(test);
  const results = input === undefined ? [] : simulateFlow(flow, rwMode, slots, library, input);
  const outcomeOf = new Map(results.map((r) => [r.slot, r.outcome]));
  const stop = results.find((r) => r.outcome.kind !== "value");
  const last = results.at(-1)?.outcome;
  const output = input === undefined ? "" : stop ? "not sent" : describeOutcome(last ?? { kind: "value", value: input });
  const arrow = flow === "write" ? "→" : "←";
  const entry = (slot: SlotKey) => {
    const index = slots[slot];
    return index === null ? null : (library[isFilterSlot(slot) ? "filters" : "operations"][index] ?? undefined);
  };
  const stopName = stop ? (entry(stop.slot) ? conversionName(entry(stop.slot)!) : "A missing entry") : "";
  const target = flow === "write" ? "Modbus" : "KNX";
  const result =
    input === undefined
      ? "Type a value to follow it through the slots."
      : !stop
        ? `${flow === "write" ? "The Modbus register receives" : "KNX receives"} ${output}`
        : stop.outcome.kind === "discarded"
          ? `Discarded by “${stopName}”. Nothing is sent to ${target}.`
          : stop.outcome.kind === "not-simulated"
            ? `“${stopName}” is a system operation: the test cannot follow it.`
            : stop.outcome.kind === "missing"
              ? "The slot points at a conversion that is not in the project."
              : `“${stopName}” gives no result for this value.`;

  const endNode = (side: "knx" | "modbus") => {
    const isInput = (side === "knx") === (flow === "write");
    const value = input === undefined ? "" : isInput ? formatConversionValue(input) : output;
    return (
      <div key={side} className={cn("flex items-start", side === "knx" ? "w-[104px] shrink-0" : "w-[152px] shrink-0")}>
        {side === "modbus" && <Arrow text={arrow} />}
        <div className="min-w-0 flex-1">
          <Caption>{side === "knx" ? "KNX" : "Modbus"}</Caption>
          <div className="min-h-[50px] rounded-[6px] bg-hms-blue px-[10px] py-2">
            <div className="truncate font-mono text-[12px] font-semibold text-white">
              {!signal
                ? side === "knx"
                  ? "Group address"
                  : "Register"
                : side === "knx"
                  ? signal.knx.groupAddress > 0
                    ? formatGroupAddress(signal.knx.groupAddress)
                    : "—"
                  : `Slave ${knxSlaveLabel(project.mbm, signal)} · ${signal.modbus.address}`}
            </div>
            <div className="mt-[2px] truncate font-mono text-[10.5px] text-white/60">
              {!signal
                ? "per signal"
                : side === "knx"
                  ? formatDpt(signal.knx.dpt)
                  : `${FORMAT_LABELS[signal.modbus.format] ?? "?"} · ${signal.modbus.lenBits} bit`}
            </div>
          </div>
          <Value text={value} />
        </div>
      </div>
    );
  };

  return (
    <section
      aria-label={FLOW_LABELS[flow]}
      className="mb-3 rounded-[6px] border border-border"
    >
      <header className="flex items-center gap-[9px] rounded-t-[6px] border-b border-border bg-card-foot px-[14px] py-[9px]">
        <span className="font-mono text-[10.5px] font-semibold tracking-[.07em] text-hms-blue">
          {FLOW_LABELS[flow].toUpperCase()}
        </span>
        {derived ? (
          <span className="rounded-full border border-border bg-[#F1F3F5] px-[7px] py-[2px] text-[11px] font-bold text-fg-muted">
            Derived · inverse
          </span>
        ) : rwMode === "readwrite" ? (
          <span className="rounded-full border border-[#C9DEF0] bg-[#EAF3FB] px-[7px] py-[2px] text-[11px] font-bold text-hms-accent">
            Defined here
          </span>
        ) : null}
        <div className="flex-1" />
        <span className="text-[11.5px] text-fg-subtle">
          {derived
            ? "Operations run in reverse order with their inverse. Filters stay on their side."
            : "Click a slot to choose a filter or operation."}
        </span>
      </header>
      <div className="flex flex-wrap items-start gap-y-3 px-[14px] pb-[10px] pt-[14px]">
        {endNode("knx")}
        {SLOT_ORDER.map((slot) => {
          const conv = entry(slot);
          const filter = isFilterSlot(slot);
          const inverted = derived && !filter;
          const bad = conv === undefined || (inverted && !!conv && !conversionHasInverse(conv));
          const open = picking === slot;
          const outcome = outcomeOf.get(slot);
          const value = outcome ? describeOutcome(outcome) : "";
          return (
            <div key={slot} className="flex min-w-[154px] flex-1 items-start">
              <Arrow text={arrow} />
              <div className="min-w-0 flex-1">
                <Caption>{SLOT_CAPTIONS[slot]}</Caption>
                <button
                  type="button"
                  disabled={!editable}
                  aria-expanded={editable ? open : undefined}
                  aria-label={`${SLOT_CAPTIONS[slot]}${slot === "op1" ? " next to KNX" : slot === "op2" ? " next to Modbus" : ""}: ${conv ? conversionName(conv) : "empty"}`}
                  onClick={() => onPick(slot)}
                  className={cn(
                    "block min-h-[50px] w-full rounded-[6px] border px-[10px] py-2 text-left disabled:cursor-default",
                    conv ? "border-solid" : "border-dashed",
                    bad
                      ? "border-[#D9A39C] bg-row-error"
                      : open
                        ? "border-hms-accent shadow-[0_0_0_3px_rgba(18,104,179,.16)]"
                        : conv && !filter
                          ? "border-[#C9DEF0] bg-[#F5FAFE]"
                          : "border-border-strong bg-white",
                    editable && "cursor-pointer hover:border-hms-accent",
                  )}
                >
                  <span
                    className={cn(
                      "block truncate text-[12px] font-bold",
                      conv ? "text-hms-blue" : editable ? "text-hms-accent" : "text-fg-subtle",
                    )}
                  >
                    {conv === undefined
                      ? "Missing conversion"
                      : conv
                        ? conversionName(conv)
                        : editable
                          ? filter
                            ? "+ Filter"
                            : "+ Operation"
                          : "—"}
                  </span>
                  <span
                    className={cn("mt-[2px] block truncate font-mono text-[10.5px]", bad ? "text-error" : "text-fg-subtle")}
                  >
                    {conv === undefined
                      ? "not in the project"
                      : conv
                        ? bad
                          ? "no inverse"
                          : conversionSummary(conv, inverted)
                        : "empty"}
                  </span>
                </button>
                <Value text={value} />
              </div>
            </div>
          );
        })}
        {endNode("modbus")}
      </div>
      {editable && picking && (
        <Picker
          key={picking}
          slot={picking}
          current={slots[picking]}
          library={library}
          draft={draft}
          leaving={leaving}
          onChoose={(index) => onChoose(picking, index)}
          onStartNew={() => onStartNew(picking)}
          onDraftChange={onDraftChange}
          onCancelNew={onCancelNew}
          onCreate={(created) => onCreate(picking, created)}
          onKeepEditing={onKeepEditing}
          onLeave={onLeave}
          onClose={() => onPick(picking)}
        />
      )}
      {editable && missing.length > 0 && (
        <LaneError>
          {missing.length === 1 ? "A slot points" : "Some slots point"} at a conversion that is no longer in the project.
          Choose another one or leave the slot empty.
        </LaneError>
      )}
      {noInverse.length > 0 && (
        <LaneError>
          “{conversionName(noInverse[0])}” has no inverse ({noInverse[0].type === CONVERSION_TYPE.ARITH ? "B · 10^A is 0" : "its output min and max are equal"}), so the gateway cannot convert the values of this direction. Choose another operation or define it for this direction.
        </LaneError>
      )}
      <div className="flex flex-wrap items-center gap-[10px] rounded-b-[6px] border-t border-border bg-card-foot px-[14px] py-[9px]">
        <span className="font-mono text-[10px] font-semibold tracking-[.08em] text-fg-subtle">
          {flow === "write" ? "TEST · KNX VALUE" : "TEST · MODBUS VALUE"}
        </span>
        <Input
          type="number"
          size="sm"
          aria-label={flow === "write" ? "Test KNX value" : "Test Modbus value"}
          placeholder={flow === "write" ? "e.g. 21.5" : "e.g. 215"}
          value={test}
          onChange={(e) => setTest(e.target.value)}
          style={{ width: 100 }}
        />
        <span
          role="status"
          aria-label={`${FLOW_LABELS[flow]} test result`}
          className={cn(
            "text-[12px]",
            input === undefined ? "text-fg-subtle" : stop ? "font-bold text-error" : "font-bold text-success",
          )}
        >
          {result}
        </span>
      </div>
    </section>
  );
}

function Caption({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-[5px] truncate font-mono text-[9.5px] font-semibold tracking-[.08em] text-fg-subtle">
      {typeof children === "string" ? children.toUpperCase() : children}
    </div>
  );
}

function Arrow({ text }: { text: string }) {
  return (
    <div aria-hidden className="w-6 shrink-0 pt-8 text-center text-[13px] text-fg-subtle">
      {text}
    </div>
  );
}

function Value({ text }: { text: string }) {
  const bad = text === "not sent" || text === "no value" || text === "not simulated";
  return (
    <div
      className={cn(
        "mt-[5px] min-h-[15px] whitespace-nowrap text-center font-mono text-[11px]",
        bad ? "text-error" : "text-hms-blue",
      )}
    >
      {text}
    </div>
  );
}

function LaneError({ children }: { children: React.ReactNode }) {
  return (
    <div role="alert" className="mx-[14px] mb-3 rounded-[5px] border border-error-border bg-error-bg px-3 py-[9px] text-[12px] leading-[1.5] text-[#8E2E24]">
      {children}
    </div>
  );
}

function Picker({
  slot,
  current,
  library,
  draft,
  leaving,
  onChoose,
  onStartNew,
  onDraftChange,
  onCancelNew,
  onCreate,
  onKeepEditing,
  onLeave,
  onClose,
}: {
  slot: SlotKey;
  current: number | null;
  library: ReturnType<typeof libraryLists<ConversionValues>>;
  draft: NewEntry | null;
  leaving: boolean;
  onChoose: (index: number | null) => void;
  onStartNew: () => void;
  onDraftChange: (entry: NewEntry) => void;
  onCancelNew: () => void;
  onCreate: (entry: NewEntry) => void;
  onKeepEditing: () => void;
  onLeave: () => void;
  onClose: () => void;
}) {
  const filter = isFilterSlot(slot);
  const [query, setQuery] = React.useState("");
  const entries = (filter ? library.filters : library.operations).map((conv, index) => ({ conv, index }));
  const q = query.trim().toLowerCase();
  const shown = entries.filter(
    ({ conv }) => !q || `${conversionName(conv)} ${conversionSummary(conv)}`.toLowerCase().includes(q),
  );
  const project = shown.filter(({ conv }) => isEditableConversionType(conv.type));
  const system = shown.filter(({ conv }) => !isEditableConversionType(conv.type));
  const item = ({ conv, index }: { conv: ConversionValues; index: number }) => (
    <button
      key={index}
      type="button"
      role="option"
      aria-selected={current === index}
      onClick={() => onChoose(index)}
      className={cn(
        "flex w-full cursor-pointer items-center gap-2 rounded-[4px] px-2 py-[6px] text-left hover:bg-[#F4F7F9]",
        current === index && "bg-[#EAF3FB]",
      )}
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12px] text-text-body">{conversionName(conv)}</span>
        <span className="block font-mono text-[10.5px] text-fg-subtle">{conversionSummary(conv)}</span>
      </span>
      {current === index && <span className="whitespace-nowrap text-[11px] text-fg-subtle">in use</span>}
    </button>
  );
  return (
    <div className="mx-[14px] mb-3 max-w-[440px] rounded-[6px] border border-hms-accent bg-white p-[10px] shadow-[0_0_0_3px_rgba(18,104,179,.10)]">
      <div className="mb-2 flex items-center">
        <span className="flex-1 font-mono text-[10px] font-semibold tracking-[.08em] text-hms-blue">
          CHOOSE {SLOT_CAPTIONS[slot].toUpperCase()}
        </span>
        <button type="button" onClick={onClose} className="cursor-pointer text-[12px] font-bold text-fg-muted">
          Close
        </button>
      </div>
      <Input
        search
        size="sm"
        autoFocus
        aria-label={filter ? "Search filters" : "Search operations"}
        placeholder={filter ? "Search filters" : "Search operations"}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="mb-[6px]"
      />
      <div role="listbox" aria-label={filter ? "Filters" : "Operations"} className="max-h-[220px] overflow-auto">
        <button
          type="button"
          role="option"
          aria-selected={current === null}
          onClick={() => onChoose(null)}
          className="block w-full cursor-pointer rounded-[4px] px-2 py-[6px] text-left text-[12px] text-fg-muted hover:bg-[#F4F7F9]"
        >
          Leave empty
        </button>
        {project.length > 0 && (
          <>
            <div className="px-2 pb-[3px] pt-2 font-mono text-[10px] font-semibold tracking-[.08em] text-fg-subtle">PROJECT</div>
            {project.map(item)}
          </>
        )}
        {system.length > 0 && (
          <>
            <div className="px-2 pb-[3px] pt-2 font-mono text-[10px] font-semibold tracking-[.08em] text-fg-subtle">
              SYSTEM · READ ONLY
            </div>
            {system.map(item)}
          </>
        )}
        {shown.length === 0 && <div className="p-2 text-[12px] text-fg-subtle">No matches</div>}
      </div>
      {leaving && (
        <div role="alert" className="mt-[6px] flex flex-wrap items-center gap-2 rounded-[5px] border border-warning-border bg-warning-bg px-[10px] py-2 text-[12px] text-warning-text">
          <span className="flex-1 font-bold">{filter ? "Discard the new filter?" : "Discard the new operation?"}</span>
          <Button variant="secondary" size="sm" onClick={onKeepEditing}>
            Keep editing
          </Button>
          <Button size="sm" onClick={onLeave}>
            Discard
          </Button>
        </div>
      )}
      {draft ? (
        <NewConversionForm filter={filter} entry={draft} onChange={onDraftChange} onCancel={onCancelNew} onCreate={onCreate} />
      ) : (
        <button
          type="button"
          onClick={onStartNew}
          className="mt-[6px] block w-full cursor-pointer border-t border-border px-2 pb-[2px] pt-2 text-left text-[12px] font-bold text-hms-accent"
        >
          {filter ? "+ New filter…" : "+ New operation…"}
        </button>
      )}
    </div>
  );
}

function Chips({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: Readonly<Record<string, string>>;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-[5px]">
      {Object.entries(options).map(([option, text]) => (
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={Number(option) === value}
          onClick={() => onChange(Number(option))}
          className={cn(
            "cursor-pointer whitespace-nowrap rounded-[4px] border px-2 py-1 text-[11.5px]",
            Number(option) === value
              ? "border-[#C9DEF0] bg-[#EAF3FB] font-bold text-hms-blue"
              : "border-border bg-white text-fg-muted",
          )}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

/** Compact version of the library form: same fields and MAPS rules (Configuration → Conversions). */
function NewConversionForm({
  filter,
  entry,
  onChange,
  onCancel,
  onCreate,
}: {
  filter: boolean;
  entry: NewEntry;
  onChange: (entry: NewEntry) => void;
  onCancel: () => void;
  onCreate: (entry: NewEntry) => void;
}) {
  const setEntry = (update: (entry: NewEntry) => NewEntry) => onChange(update(entry));
  const [tried, setTried] = React.useState(false);
  const errors = conversionErrors(entry);
  const firstError = Object.values(errors)[0];
  const setParam = (i: number, value: string) =>
    setEntry((e) => ({ ...e, params: e.params.map((p, j) => (j === i ? value : p)) as NewEntry["params"] }));
  const numberInput = (i: number, label: string) => (
    <Input
      type="number"
      size="sm"
      aria-label={label}
      value={entry.params[i]}
      onChange={(e) => setParam(i, e.target.value)}
      style={{ width: 84 }}
    />
  );
  const comparison = Number(entry.params[1]);
  return (
    <div className="mt-[6px] flex flex-col gap-2 border-t border-border px-1 pb-[2px] pt-[10px]">
      <div className="font-mono text-[10px] font-semibold tracking-[.08em] text-fg-subtle">
        {filter ? "NEW FILTER" : "NEW OPERATION"}
      </div>
      <Input
        size="sm"
        aria-label="Description"
        placeholder="Description"
        maxLength={filter ? FILTER_DESCRIPTION_MAX : OPERATION_DESCRIPTION_MAX}
        value={entry.description}
        onChange={(e) => setEntry((x) => ({ ...x, description: e.target.value }))}
      />
      {filter ? (
        <>
          <Chips
            label="Filter type"
            options={FILTER_TYPE_LABELS}
            value={Number(entry.params[0])}
            onChange={(v) => setParam(0, String(v))}
          />
          <p className="text-[11px] text-fg-subtle">{FILTER_TYPE_HINTS[Number(entry.params[0])]}</p>
          <Chips
            label="Condition"
            options={FILTER_CONDITION_LABELS}
            value={comparison}
            onChange={(v) => setParam(1, String(v))}
          />
          <div className="flex items-center gap-[6px] text-[11.5px] text-fg-muted">
            {filterValueParams(comparison).map((key, i) => (
              <React.Fragment key={key}>
                {i > 0 && <span>to</span>}
                {numberInput(key === "param3" ? 2 : 3, filterValueParams(comparison).length === 2 ? (i ? "High" : "Low") : "Value")}
              </React.Fragment>
            ))}
          </div>
        </>
      ) : (
        <>
          <Chips
            label="Operation type"
            options={OPERATION_TYPE_LABELS}
            value={entry.type}
            onChange={(v) =>
              setEntry((x) =>
                v === CONVERSION_TYPE.SCALE
                  ? { ...x, type: 1, params: defaultConversion(CONVERSION_TYPE.SCALE, 0).params }
                  : { ...x, type: 2, params: defaultConversion(CONVERSION_TYPE.ARITH, 0).params },
              )
            }
          />
          {entry.type === CONVERSION_TYPE.SCALE ? (
            <div className="flex flex-wrap items-center gap-[5px] text-[11.5px] text-fg-muted">
              {numberInput(0, "Input min")}…{numberInput(1, "Input max")}
              <span>→</span>
              {numberInput(2, "Output min")}…{numberInput(3, "Output max")}
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-[6px] font-mono text-[11.5px] text-fg-muted">
              A {numberInput(0, "A · exponent")} B {numberInput(1, "B · factor")} C {numberInput(2, "C · offset")}
            </div>
          )}
        </>
      )}
      <p className="text-[11.5px] leading-[1.45] text-fg-muted">
        {firstError && Object.keys(errors).some((k) => k !== "description")
          ? "Fill in the values to see what it does."
          : conversionExplanation(entry)}
      </p>
      {tried && firstError && <p className="text-[11px] leading-[1.4] text-error">{firstError}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          size="sm"
          onClick={() => {
            if (firstError) setTried(true);
            else onCreate(entry);
          }}
        >
          Create and use
        </Button>
      </div>
    </div>
  );
}
