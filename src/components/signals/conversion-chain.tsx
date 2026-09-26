import * as React from "react";
import {
  definedFlow,
  flowsOf,
  halfOfFlow,
  halfSteps,
  libraryLists,
  refsRoundTrip,
  slotsFromRefs,
  type ConversionFlow,
  type LibraryLists,
} from "@/core/conversions/assignment";
import { conversionSummary } from "@/core/conversions/formulas";
import { CONVERSION_TYPE, isEditableConversionType, type ConversionValues } from "@/core/conversions/rules";
import { knxConversionRwMode } from "@/gateway-families/knx-mbm/conversions";
import type { KnxMbmProject, KnxMbmSignal } from "@/gateway-families/knx-mbm/model";
import { cn } from "@/lib/utils";

type Conversion = KnxMbmProject["conversions"][number];

export const FLOW_LABELS: Record<ConversionFlow, string> = {
  write: "Write · KNX → Modbus",
  read: "Read · Modbus → KNX",
};

export function conversionName(conv: Pick<ConversionValues, "type" | "description">): string {
  return conv.description || (conv.type === CONVERSION_TYPE.FILTER ? "Untitled filter" : "Untitled operation");
}

interface ChainPart {
  key: string;
  text: string;
  kind: "filter" | "operation" | "system" | "missing";
}

/**
 * The steps the gateway runs on one flow, read from the refs the signal stores
 * for that half, as cell parts: filters and system entries by name, operations
 * by formula.
 */
export function storedFlowParts(signal: KnxMbmSignal, library: LibraryLists<Conversion>, flow: ConversionFlow): ChainPart[] {
  return halfSteps(halfOfFlow(signal.conversions, flow)).map((step, i) => {
    const conv = library[step.list][step.index];
    const key = `${i}`;
    if (!conv) return { key, text: `missing ${step.list === "filters" ? "filter" : "operation"} ${step.index}`, kind: "missing" };
    if (conv.type === CONVERSION_TYPE.FILTER) return { key, text: conversionName(conv), kind: "filter" };
    if (!isEditableConversionType(conv.type)) return { key, text: conversionName(conv), kind: "system" };
    return { key, text: conversionSummary(conv, step.inverted), kind: "operation" };
  });
}

/** One line per active flow, as the gateway runs the stored refs. */
export function storedFlowLines(signal: KnxMbmSignal, conversions: Conversion[]): string[] {
  const library = libraryLists(conversions);
  return flowsOf(knxConversionRwMode(signal.knx.flags)).map(
    (flow) => `${FLOW_LABELS[flow]}: ${storedFlowParts(signal, library, flow).map((part) => part.text).join(" › ") || "—"}`,
  );
}

export interface ConversionChain {
  virtual: boolean;
  empty: boolean;
  /** The stored refs are not what MAPS writes for these flags (`refsRoundTrip`). */
  nonStandard: boolean;
  /** Arrow of the defined flow. */
  arrow: string;
  parts: ChainPart[];
  text: string;
  title: string;
}

/**
 * What the Conversions cell shows: the refs the signal stores, as the gateway
 * runs them. The cell follows the defined flow (the only one, or the black one
 * of a read + write signal); the tooltip lists every active flow.
 */
export function conversionChain(signal: KnxMbmSignal, conversions: Conversion[]): ConversionChain {
  const library = libraryLists(conversions);
  const rwMode = knxConversionRwMode(signal.knx.flags);
  const flows = flowsOf(rwMode);
  const nonStandard = !refsRoundTrip(signal.conversions, rwMode);
  const stored = (flow: ConversionFlow) => halfSteps(halfOfFlow(signal.conversions, flow)).length > 0;
  const anyRefs = stored("write") || stored("read");
  if (signal.virtual) {
    const text = anyRefs ? "Ignored · virtual signal" : "Not available · virtual";
    const title = anyRefs
      ? "Virtual signals have no Modbus side: the gateway ignores these conversions."
      : "Virtual signals have no Modbus side, so they cannot have conversions.";
    return { virtual: true, empty: !anyRefs, nonStandard: false, arrow: "", parts: [], text, title };
  }
  const note = nonStandard
    ? "\nStored in a non-standard way: editing it rewrites both halves the way MAPS does."
    : "";
  const defined = definedFlow(rwMode, slotsFromRefs(signal.conversions, rwMode).master);
  if (!flows.some(stored)) {
    return {
      virtual: false,
      empty: true,
      nonStandard,
      arrow: "",
      parts: [],
      text: nonStandard ? "— · non-standard" : "—",
      title: (nonStandard ? "The gateway runs no conversions for this signal." : "No conversions · click to assign") + note,
    };
  }
  const parts = storedFlowParts(signal, library, defined);
  const arrow = defined === "write" ? "→" : "←";
  return {
    virtual: false,
    empty: false,
    nonStandard,
    arrow,
    parts,
    text: `${arrow} ${parts.map((part) => part.text).join(" › ") || "—"}${nonStandard ? " · non-standard" : ""}`,
    title: storedFlowLines(signal, conversions).join("\n") + note,
  };
}

/** Cell chips (V15): filters in white, operations in blue mono, system entries by name. */
export function ConversionChainCell({ chain }: { chain: ConversionChain }) {
  if (chain.virtual)
    return (
      <span className={cn("truncate font-sans", chain.empty ? "text-fg-subtle" : "text-warning-text")}>{chain.text}</span>
    );
  const flag = chain.nonStandard && (
    <span className="shrink-0 rounded-full border border-warning-border bg-warning-bg px-[6px] text-[10.5px] font-bold text-warning-text">
      non-standard
    </span>
  );
  if (chain.empty)
    return (
      <span className="flex min-w-0 items-center gap-1 overflow-hidden">
        <span className="text-fg-subtle">—</span>
        {flag}
      </span>
    );
  return (
    <span className="flex min-w-0 items-center gap-1 overflow-hidden">
      <span className="shrink-0 font-mono text-[11px] text-fg-subtle" aria-hidden>
        {chain.arrow}
      </span>
      {chain.parts.map((part, i) => (
        <React.Fragment key={part.key}>
          {i > 0 && (
            <span className="shrink-0 text-[11px] text-fg-subtle" aria-hidden>
              ›
            </span>
          )}
          <span
            className={cn(
              "inline-flex h-[19px] shrink-0 items-center whitespace-nowrap rounded-[3px] border px-[6px] text-[11px] text-hms-blue",
              part.kind === "operation" ? "border-[#C9DEF0] bg-[#EAF3FB] font-mono" : "border-border-strong bg-white font-sans",
              part.kind === "missing" && "border-error-border bg-error-bg text-error",
            )}
          >
            {part.text}
          </span>
        </React.Fragment>
      ))}
      {flag}
    </span>
  );
}
