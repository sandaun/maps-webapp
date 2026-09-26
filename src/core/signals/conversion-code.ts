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
 *
 * `parseConversionCode` is the way back: `ConvertStringToConversion`
 * (`IntesisConversion.cs:800-831`, `:860-914`), used by the Excel import
 * (`IntesisProjectKnxMbm_RT.SaveConversionsFromRow`), with the format check of
 * `CheckThisConversionValue` (`:916-951`).
 */

import type { ConversionIdRef } from "@/core/xbl/conversions";
import type { HalfConversionRefs, SignalConversionRefs } from "./conversion-refs";

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

const CODE_FORMAT = /^DIRECTION\[(<|>|<\/>|>\/<)\]:INDEXES\[([0-9]+;){0,1}([0-9]+|-)(;([0-9]+|-)){3}\]$/;
/** `ConversionId.ConversionIndex` is a C# `short`. */
const MAX_INDEX = 32767;

function stripCode(value: string): string {
  return value.replace(/INDEXES|DIRECTION|\[|\]/g, "");
}

/** Port of `GetIdConversion`: the second entry is inverted for filters or when asked. */
function idConversion(value1: string, value2: string, isFilter: boolean, isInverted: boolean): ConversionIdRef[] {
  const out: ConversionIdRef[] = [];
  if (value1 !== "-") out.push({ index: Number(value1), inverted: isInverted });
  if (value2 !== "-") out.push({ index: Number(value2), inverted: isFilter || isInverted });
  return out;
}

const emptyHalf = (): HalfConversionRefs => ({ filters: [], operations: [] });

/**
 * Port of `ConvertStringToConversion` for both halves at once. Returns
 * `undefined` when the text fails the `CheckThisConversionValue` format check
 * (MAPS blocks those rows) or an index does not fit a C# `short`.
 */
export function parseConversionCode(code: string): SignalConversionRefs | undefined {
  const value = code.trim();
  if (value === "" || value === "-") return { internal: emptyHalf(), external: emptyHalf() };
  if (!CODE_FORMAT.test(value)) return undefined;

  const [directionPart, indexesPart] = value.split(":");
  const slots = stripCode(indexesPart).split(";");
  if (slots.some((slot) => slot !== "-" && Number(slot) > MAX_INDEX)) return undefined;
  // A leading BACnet MAP index shifts the four slots (`ConvertStringToMapIndex`).
  const num = slots.length > 4 ? 1 : 0;
  const direction = stripCode(directionPart);
  const [f1, o1, o2, f2] = [slots[num], slots[num + 1], slots[num + 2], slots[num + 3]];

  const internal = emptyHalf();
  if (direction === ">/<" || direction === "</>" || direction === ">") {
    internal.operations = idConversion(o1, o2, false, direction === "</>");
    internal.filters = idConversion(f1, f2, true, false);
  }
  const external = emptyHalf();
  if (direction === ">/<" || direction === "</>" || direction === "<") {
    external.operations = idConversion(o2, o1, false, direction === ">/<");
    external.filters = idConversion(f2, f1, true, false);
  }
  return { internal, external };
}
