import { halfSteps, libraryLists } from "./assignment";
import { conversionHasInverse, conversionSummary } from "./formulas";
import { COMPARISON, CONVERSION_TYPE, parseConversionNumber, type ConversionValues } from "./rules";
import type { ConversionRwMode, SignalConversionRefs } from "@/core/signals/conversion-refs";
import type { ValidationIssue } from "@/core/validation/issue";

/**
 * Conversion checks shared by the families with a conversion library
 * (KNX–MBM, MBS–KNX). Refs are positions in the filters / operations lists
 * (`IntesisConversion.cs:233-247`); the XBL generator reads `filters[index]`
 * for each of them (`CreateConversionList`), so a position outside the list
 * cannot be deployed. `rwMode` is the family's conversion direction of a
 * signal (its internal object's, as `frmSelectConversion` sees it).
 * Moved from `src/gateway-families/knx-mbm/validate.ts`.
 */

export interface ConversionCheckedSignal {
  id: number;
  active: boolean;
  virtual: boolean;
  conversions: SignalConversionRefs;
}

export function validateSignalConversions<S extends ConversionCheckedSignal>(
  conversions: readonly ConversionValues[],
  signals: readonly S[],
  rwMode: (signal: S) => ConversionRwMode,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const library = libraryLists(conversions);
  const name = (conv: { description: string; type: number }) =>
    conv.description || (conv.type === CONVERSION_TYPE.FILTER ? "Untitled filter" : "Untitled operation");
  const libraryRef = (list: "filters" | "operations", index: number) => ({
    screen: "configuration" as const,
    entity: "project" as const,
    id: `${list === "filters" ? "f" : "o"}${index}`,
    field: "conversion",
  });

  for (const signal of signals) {
    const halves = [signal.conversions.internal, signal.conversions.external];
    const steps = halves.flatMap((half) => halfSteps(half));
    if (steps.length === 0) continue;
    const signalRef = { screen: "signals" as const, entity: "signal" as const, id: signal.id, field: "conversions" };
    const missing = [
      ...new Set(
        steps
          .filter((step) => !library[step.list][step.index])
          .map((step) => `${step.list === "filters" ? "filter" : "operation"} ${step.index}`),
      ),
    ];
    if (missing.length) {
      issues.push({
        code: "CONV-REF-MISSING",
        // Only active signals reach the XBL (PreXBLActions): an inactive one does not block the deploy.
        severity: signal.active ? "error" : "warning",
        message: `Signal ${signal.id + 1} uses ${missing.join(" and ")}, which ${missing.length === 1 ? "is" : "are"} not in the conversion library.`,
        ref: signalRef,
      });
    }
    if (signal.virtual) {
      // MAPS makes the conversions cell of virtual signals read-only
      // (IntesisProjectKnxMbm_RT.cs:709-712, IntesisProjectMBSKNX_RT.cs:501-504):
      // only an imported file can put conversions there. No "conversions" field: the
      // editor cannot open for them, so the issue leads to the signal row.
      issues.push({
        code: "CONV-VIRTUAL",
        severity: "info",
        message: `Virtual signal ${signal.id + 1} has conversions. MAPS does not let you assign conversions to virtual signals; they come from an imported file.`,
        ref: { screen: "signals", entity: "signal", id: signal.id },
      });
      continue;
    }
    // The grey flow of a read + write signal runs its operations inverted: an arithmetic
    // operation with B · 10^A = 0 or a scale with equal output ends divides by zero there.
    if (rwMode(signal) === "readwrite") {
      const broken = steps.find((step) => {
        const conv = library[step.list][step.index];
        return step.inverted && !!conv && !conversionHasInverse(conv);
      });
      if (broken) {
        const conv = library.operations[broken.index];
        issues.push({
          code: "CONV-NO-INVERSE",
          severity: "warning",
          message: `Signal ${signal.id + 1} runs “${name(conv)}” (${conversionSummary(conv)}) inverted, but it has no inverse: the gateway cannot convert one of its directions.`,
          ref: signalRef,
        });
      }
    }
  }

  // Ranges MAPS does not let you save (frmConversions.cs:726-766), and equal scale ends.
  library.filters.forEach((conv, index) => {
    const comparison = parseConversionNumber(conv.params[1]);
    if (comparison !== COMPARISON.IN_RANGE && comparison !== COMPARISON.OUT_RANGE) return;
    const low = parseConversionNumber(conv.params[2]);
    const high = parseConversionNumber(conv.params[3]);
    if (low !== undefined && high !== undefined && low > high) {
      issues.push({
        code: "CONV-RANGE",
        severity: "warning",
        message: `Filter “${name(conv)}” has Low (${low}) greater than High (${high}).`,
        ref: libraryRef("filters", index),
      });
    }
  });
  library.operations.forEach((conv, index) => {
    if (conv.type !== CONVERSION_TYPE.SCALE) return;
    const [minIn, maxIn, minOut, maxOut] = conv.params.map(parseConversionNumber);
    const bad = (min?: number, max?: number) => min !== undefined && max !== undefined && min >= max;
    if (bad(minIn, maxIn) || bad(minOut, maxOut)) {
      issues.push({
        code: "CONV-RANGE",
        severity: "warning",
        message: `Scale “${name(conv)}” (${conversionSummary(conv)}) needs each min below its max.`,
        ref: libraryRef("operations", index),
      });
    }
  });
  return issues;
}
