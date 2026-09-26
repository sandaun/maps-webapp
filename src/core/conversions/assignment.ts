/**
 * Per-signal conversion assignment as `frmSelectConversion` edits it
 * (temp/maps-cloud/maps-poc/decompiled/IntesisMAPS/IntesisBoxMAPS/
 * frmSelectConversion.cs): four combos (the filter next to the internal side,
 * two operations, the filter next to the external side) and, for read + write
 * signals, the flow the operations are defined for. On KNX–MBM the internal
 * side is KNX and the external one Modbus.
 */

import {
  refsFromSelection,
  type ConversionRwMode,
  type ConversionSelection,
  type HalfConversionRefs,
  type SignalConversionRefs,
} from "@/core/signals/conversion-refs";
import type { ConversionIdRef } from "@/core/xbl/conversions";
import { applyConversion, type ConversionOutcome } from "./formulas";
import { CONVERSION_TYPE, type ConversionList, type ConversionValues } from "./rules";

/** The four combos, as positions in the filters / operations lists (null = "-"). */
export interface ConversionSlots {
  internalFilter: number | null;
  /** `cb_Operation1`, next to the internal side. */
  op1: number | null;
  /** `cb_Operation2`, next to the external side. */
  op2: number | null;
  externalFilter: number | null;
  /** Read + write only: the black flow ("internal" = internal → external, the MAPS default). */
  master: "internal" | "external";
}

export const EMPTY_SLOTS: ConversionSlots = {
  internalFilter: null,
  op1: null,
  op2: null,
  externalFilter: null,
  master: "internal",
};

/** Port of `GetFilterIndex` (frmSelectConversion.cs:285-331). */
function filterSlot(internal: ConversionIdRef[], external: ConversionIdRef[], internalSide: boolean): number | null {
  const found = internalSide
    ? (internal.find((ref) => !ref.inverted) ?? external.find((ref) => ref.inverted))
    : (internal.find((ref) => ref.inverted) ?? external.find((ref) => !ref.inverted));
  return found ? found.index : null;
}

/**
 * The combos MAPS shows when it opens a signal: `SelectValues` with
 * `GetFilterIndex` / `GetConversionIndex` (frmSelectConversion.cs:275-355),
 * and the black flow of `ApplyOperationsRestrictions` (:356-379): the
 * external flow is the defined one when its first operation is not inverted.
 */
export function slotsFromRefs(refs: SignalConversionRefs, rwMode: ConversionRwMode): ConversionSlots {
  const { internal, external } = refs;
  const [op1, op2] =
    internal.operations.length > 0
      ? [internal.operations[0]?.index ?? null, internal.operations[1]?.index ?? null]
      : [external.operations[1]?.index ?? null, external.operations[0]?.index ?? null];
  const externalDefined =
    rwMode === "readwrite" && external.operations.length > 0 && !external.operations[0].inverted;
  return {
    internalFilter: filterSlot(internal.filters, external.filters, true),
    op1,
    op2,
    externalFilter: filterSlot(internal.filters, external.filters, false),
    master: externalDefined ? "external" : "internal",
  };
}

/** The API payload for these combos (operations listed from the internal side, empty combos skipped). */
export function selectionFromSlots(slots: ConversionSlots): ConversionSelection {
  return {
    internalFilter: slots.internalFilter,
    operations: [slots.op1, slots.op2].filter((op): op is number => op !== null),
    externalFilter: slots.externalFilter,
    master: slots.master,
  };
}

export function sameRefs(a: SignalConversionRefs, b: SignalConversionRefs): boolean {
  const half = (x: HalfConversionRefs, y: HalfConversionRefs) =>
    JSON.stringify([x.filters, x.operations]) === JSON.stringify([y.filters, y.operations]);
  return half(a.internal, b.internal) && half(a.external, b.external);
}

/**
 * Whether saving these refs through the combos writes them back unchanged.
 * False for refs MAPS would not write (e.g. the same operations on both halves
 * without inversion): editing such a signal rewrites both halves.
 */
export function refsRoundTrip(refs: SignalConversionRefs, rwMode: ConversionRwMode): boolean {
  return sameRefs(refsFromSelection(selectionFromSlots(slotsFromRefs(refs, rwMode)), rwMode), refs);
}

export const hasAnySlot = (slots: ConversionSlots) =>
  slots.internalFilter !== null || slots.op1 !== null || slots.op2 !== null || slots.externalFilter !== null;

export type SlotKey = "internalFilter" | "op1" | "op2" | "externalFilter";

/** A flow of values through the gateway: write = KNX → Modbus (internal half), read = Modbus → KNX (external half). */
export type ConversionFlow = "write" | "read";

export const flowsOf = (rwMode: ConversionRwMode): ConversionFlow[] =>
  rwMode === "readwrite" ? ["write", "read"] : rwMode === "read" ? ["read"] : ["write"];

/** The flow whose operations run as defined; the other one gets them inverted. */
export function definedFlow(rwMode: ConversionRwMode, master: ConversionSlots["master"]): ConversionFlow {
  if (rwMode === "read") return "read";
  if (rwMode === "write") return "write";
  return master === "internal" ? "write" : "read";
}

/**
 * Slots in the order a value meets them on this flow, the way the gateway
 * builds the chain of that half (`IntesisConversion.CreateConversionList`,
 * IntesisConversion.cs:222-290): its own filter, the operations of the half,
 * then the other side's filter. Operations run inverted on the grey flow.
 */
export function flowSteps(
  flow: ConversionFlow,
  rwMode: ConversionRwMode,
  slots: ConversionSlots,
): { slot: SlotKey; list: ConversionList; index: number; inverted: boolean }[] {
  const inverted = flowsOf(rwMode).length === 2 && definedFlow(rwMode, slots.master) !== flow;
  const order: SlotKey[] =
    flow === "write" ? ["internalFilter", "op1", "op2", "externalFilter"] : ["externalFilter", "op2", "op1", "internalFilter"];
  return order.flatMap((slot) => {
    const index = slots[slot];
    if (index === null) return [];
    const filter = slot === "internalFilter" || slot === "externalFilter";
    return [{ slot, list: filter ? ("filters" as const) : ("operations" as const), index, inverted: !filter && inverted }];
  });
}

export interface LibraryLists<C extends ConversionValues = ConversionValues> {
  filters: C[];
  operations: C[];
}

/** Filters and operations by position, as signal refs address them. */
export function libraryLists<C extends ConversionValues>(conversions: readonly C[]): LibraryLists<C> {
  return {
    filters: conversions.filter((c) => c.type === CONVERSION_TYPE.FILTER),
    operations: conversions.filter((c) => c.type !== CONVERSION_TYPE.FILTER),
  };
}

export type StepOutcome =
  | ConversionOutcome
  /** The slot points at a position that is not in the library. */
  | { kind: "missing" }
  /** LUT remaps and logical operations are not simulated. */
  | { kind: "not-simulated" };

/** A value followed through one flow: the outcome after each step, until one stops it. */
export function simulateFlow(
  flow: ConversionFlow,
  rwMode: ConversionRwMode,
  slots: ConversionSlots,
  library: LibraryLists,
  input: number,
): { slot: SlotKey; outcome: StepOutcome }[] {
  const results: { slot: SlotKey; outcome: StepOutcome }[] = [];
  let value = input;
  for (const step of flowSteps(flow, rwMode, slots)) {
    const conv = library[step.list][step.index];
    let outcome: StepOutcome;
    if (!conv) outcome = { kind: "missing" };
    else if (conv.type === CONVERSION_TYPE.LOGICAL || conv.type === CONVERSION_TYPE.LUT_REMAP)
      outcome = { kind: "not-simulated" };
    else outcome = applyConversion(conv, value, step.inverted);
    results.push({ slot: step.slot, outcome });
    if (outcome.kind !== "value") break;
    value = outcome.value;
  }
  return results;
}

/**
 * The chain the gateway runs for one stored half (`CreateConversionList`,
 * IntesisConversion.cs:222-290): non-inverted filters, the operations with
 * their own inversion, then the inverted filters. The internal half runs on
 * the write flow, the external one on the read flow.
 */
export function halfSteps(half: HalfConversionRefs): { list: ConversionList; index: number; inverted: boolean }[] {
  return [
    ...half.filters.filter((f) => !f.inverted).map((f) => ({ list: "filters" as const, index: f.index, inverted: false })),
    ...half.operations.map((o) => ({ list: "operations" as const, index: o.index, inverted: o.inverted })),
    ...half.filters.filter((f) => f.inverted).map((f) => ({ list: "filters" as const, index: f.index, inverted: false })),
  ];
}

export const halfOfFlow = (refs: SignalConversionRefs, flow: ConversionFlow): HalfConversionRefs =>
  flow === "write" ? refs.internal : refs.external;
