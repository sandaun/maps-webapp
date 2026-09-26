/**
 * Per-signal conversion references, kept per half as MAPS does: every signal
 * has an internal (BMS-side) object and an external (device-side) object, and
 * each one carries its own `FilterIDs` / `OperationIDs` (`ConversionObject`,
 * temp/maps-cloud/maps-poc/decompiled/IntesisMAPS/IntesisBoxMAPS/
 * ConversionObject.cs:61-69). Indexes are positions in the project's filters /
 * operations lists (`IntesisConversion.cs:233-247`).
 */

import { parseConversionIds, type ConversionIdRef } from "@/core/xbl/conversions";

/** One half's references (`<IdxFilters>` / `<IdxOperations>` of that object). */
export interface HalfConversionRefs {
  filters: ConversionIdRef[];
  operations: ConversionIdRef[];
}

/** Both halves of a signal: `internal` is the BMS-side object, `external` the device-side one. */
export interface SignalConversionRefs {
  internal: HalfConversionRefs;
  external: HalfConversionRefs;
}

export function readHalfConversionRefs(
  filters: string | undefined,
  operations: string | undefined,
): HalfConversionRefs {
  return { filters: parseConversionIds(filters), operations: parseConversionIds(operations) };
}

/**
 * Port of `IntesisXML.GetConversionIDsXMLString` (IntesisXML.cs:310-323):
 * `idx,inverted` pairs joined by ";" with no trailing separator.
 */
export function formatConversionIds(refs: ConversionIdRef[]): string {
  return refs.map((ref) => `${ref.index},${ref.inverted ? 1 : 0}`).join(";");
}

/** `ConvReadWrite` of the internal object, which is all `frmSelectConversion` looks at. */
export type ConversionRwMode = "read" | "write" | "readwrite";

/**
 * What `frmSelectConversion` edits: its four combos and, for read + write
 * signals, which flow the operations are written for (the black "master"
 * flow; the grey one gets them inverted).
 */
export interface ConversionSelection {
  /** Filter slot next to the internal (BMS) side, as a position in the filters list. */
  internalFilter: number | null;
  /** Up to two operations, first the one next to the internal side, as positions in the operations list. */
  operations: number[];
  /** Filter slot next to the external (device) side. */
  externalFilter: number | null;
  /** Only used for read + write signals: "internal" = internal → external (MAPS default). */
  master: "internal" | "external";
}

/**
 * Port of `frmSelectConversion.SaveObjectsConfiguration` / `SaveOperations` /
 * `SaveFilters` (frmSelectConversion.cs:476-573) with the flow restrictions of
 * `ApplyOperationsRestrictions` (:356-379): a read signal only has the
 * external → internal flow, a write signal only internal → external. The
 * disabled half gets no refs; the half of the grey flow gets the operations
 * inverted. Each half lists its own filter first and the other side's filter
 * as inverted (it runs after the operations).
 */
export function refsFromSelection(selection: ConversionSelection, rwMode: ConversionRwMode): SignalConversionRefs {
  const [op1, op2] = selection.operations;
  const ops = [op1, op2].filter((op): op is number => op !== undefined);
  const internalEnabled = rwMode !== "read";
  const externalEnabled = rwMode !== "write";
  const internalInverted = rwMode === "readwrite" && selection.master === "external";
  const externalInverted = rwMode === "readwrite" && selection.master === "internal";
  const filters = (own: number | null, other: number | null): ConversionIdRef[] => [
    ...(own === null ? [] : [{ index: own, inverted: false }]),
    ...(other === null ? [] : [{ index: other, inverted: true }]),
  ];
  return {
    internal: internalEnabled
      ? {
          filters: filters(selection.internalFilter, selection.externalFilter),
          operations: ops.map((index) => ({ index, inverted: internalInverted })),
        }
      : { filters: [], operations: [] },
    external: externalEnabled
      ? {
          filters: filters(selection.externalFilter, selection.internalFilter),
          operations: [...ops].reverse().map((index) => ({ index, inverted: externalInverted })),
        }
      : { filters: [], operations: [] },
  };
}
