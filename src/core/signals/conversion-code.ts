/**
 * Per-signal conversion summary shown in the MAPS "Conv. Id" grid column.
 *
 * Provenance: `IntesisConversion.CreateStringFromConversions` /
 * `GetStringConversion` / `GetFilters` / `GetOperations`
 * (temp/maps-cloud/maps-poc/decompiled/IntesisMAPS/IntesisBoxMAPS/
 * IntesisConversion.cs:698-797). Families call it with the internal (BMS) side
 * first and the external (device) side second, as `PopulateExtraParameters`
 * does (`IntesisProjectKnxMbm_RT.cs:700`, `IntesisProjectMbsMe_RT.cs:684`).
 * `mapIndex` is never passed by these families, so it is not ported.
 */

import type { ConversionIdRef } from "@/core/xbl/conversions";
import type { SignalConversionRefs } from "./conversion-refs";

const EMPTY = "-;-;-;-";

function pickOperations(refs: ConversionIdRef[]): [string, string] {
  if (refs.length === 0) return ["-", "-"];
  if (refs.length > 1) return [String(refs[0].index), String(refs[1].index)];
  return [String(refs[0].index), "-"];
}

function pickFilters(refs: ConversionIdRef[]): [string, string] {
  if (refs.length === 0) return ["-", "-"];
  if (refs.length > 1) return [String(refs[0].index), String(refs[1].index)];
  return refs[0].inverted ? ["-", String(refs[0].index)] : [String(refs[0].index), "-"];
}

function withDirection(direction: string, value: string): string {
  return `DIRECTION[${direction}]:INDEXES[${value}]`;
}

/** Port of `CreateStringFromConversions` — "-" when neither side has conversions. */
export function conversionCode({ internal, external }: SignalConversionRefs): string {
  const intOperations = internal.operations;
  const [intFilter1, intFilter2] = pickFilters(internal.filters);
  const [intOp1, intOp2] = pickOperations(intOperations);
  const text = `${intFilter1};${intOp1};${intOp2};${intFilter2}`;

  const [extFilter1, extFilter2] = pickFilters(external.filters);
  const [extOp1, extOp2] = pickOperations(external.operations);
  const text2 = `${extFilter2};${extOp2};${extOp1};${extFilter1}`;

  if (text === EMPTY && text2 === EMPTY) return "-";
  if (text === EMPTY) return withDirection("<", text2);
  if (text2 === EMPTY) return withDirection(">", text);
  if (intOperations.some((ref) => !ref.inverted)) return withDirection(">/<", text);
  return withDirection("</>", text);
}
