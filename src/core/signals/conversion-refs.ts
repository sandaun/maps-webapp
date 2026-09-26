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
