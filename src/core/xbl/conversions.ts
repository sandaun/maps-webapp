/**
 * Shared XBL conversion machinery — XML parsing of the IBOX `<Conversions>`
 * table and the active-conversion chain builder used by every family's
 * PreXBLActions.
 *
 * Provenance: `IntesisConversion` (temp/maps-cloud/maps-poc/decompiled/
 * IntesisMAPS/IntesisBoxMAPS/IntesisConversion.cs:134-179, 220-290),
 * `IntesisConversion.ParseConversionIDs`, and
 * `IntesisXML.ParseConversionsFromXML` / `ParseRemappingFromXML`
 * (IntesisBoxMAPS/IntesisXML.cs).
 *
 * Extracted from `src/gateway-families/knx-mbm/xbl/pipeline.ts` (step 2.4) so
 * the ME–MBS family shares the exact same semantics.
 */

import {
  getAttr,
  XmlDocument,
  type XmlElement,
} from "@/core/project-format";

export interface ConversionIdRef {
  index: number;
  inverted: boolean;
}

export interface ParsedConversion {
  type: number;
  params: [number, number, number, number];
}

export interface ActiveConversion extends ParsedConversion {
  isLast: boolean;
}

/** Remap LUT as parsed from `<RemapLUTs>` (floats, as in C# `RemapLut`). */
export interface ParsedRemapLut {
  numberOfElements: number;
  defaultInput: number;
  invDefault: number;
  inputValues: number[];
  outputValues: number[];
}

/**
 * Port of IntesisConversion.ParseConversionIDs. DEVIATION: empty segments
 * (e.g. a trailing ";") are skipped instead of throwing — the C# parser would
 * fail the whole project load on them.
 */
export function parseConversionIds(value: string | undefined): ConversionIdRef[] {
  if (!value) return [];
  const out: ConversionIdRef[] = [];
  for (const segment of value.split(";")) {
    if (segment === "") continue;
    const [idx, inv] = segment.split(",");
    out.push({ index: Number(idx), inverted: Number(inv) === 1 });
  }
  return out;
}

/** Port of IntesisXML.GetFloatValue (accepts both "." and "," decimals). */
export function parseFloatLenient(value: string): number {
  return Number(value.replace(",", "."));
}

function childrenOf(el: XmlElement, tag: string): XmlElement[] {
  return el.children.filter((c): c is XmlElement => c.kind === "element" && c.tag === tag);
}

function parseNumberAttr(el: XmlElement | undefined, name: string, fallback: number): number {
  const v = el ? getAttr(el, name) : undefined;
  const n = v === undefined || v === "" ? NaN : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function parseStringAttr(el: XmlElement | undefined, name: string, fallback: string): string {
  const v = el ? getAttr(el, name) : undefined;
  return v ?? fallback;
}

/**
 * Port of IntesisXML.ParseConversionsFromXML: FILTER (0) → filters, rest →
 * operations.
 */
export function parseConversions(doc: XmlDocument): {
  filters: ParsedConversion[];
  operations: ParsedConversion[];
} {
  const containerEl = doc.find(["IBOX", "Conversions"]);
  const filters: ParsedConversion[] = [];
  const operations: ParsedConversion[] = [];
  if (!containerEl) return { filters, operations };
  for (const el of childrenOf(containerEl, "Conversion")) {
    const conv: ParsedConversion = {
      type: parseNumberAttr(el, "Type", 0),
      params: [
        parseFloatLenient(parseStringAttr(el, "Param1", "0")),
        parseFloatLenient(parseStringAttr(el, "Param2", "0")),
        parseFloatLenient(parseStringAttr(el, "Param3", "0")),
        parseFloatLenient(parseStringAttr(el, "Param4", "0")),
      ],
    };
    (conv.type === 0 ? filters : operations).push(conv);
  }
  return { filters, operations };
}

/**
 * Port of IntesisXML.ParseRemappingFromXML (IntesisXML.cs:277-308). Values
 * are floats in C#; InValue/OutValue attributes are parsed leniently here.
 */
export function parseRemapLuts(doc: XmlDocument): ParsedRemapLut[] {
  const containerEl = doc.find(["IBOX", "RemapLUTs"]);
  if (!containerEl) return [];
  return childrenOf(containerEl, "RemapLUT").map((el) => ({
    numberOfElements: parseNumberAttr(el, "NumOfElements", 0),
    defaultInput: parseFloatLenient(parseStringAttr(el, "Default", "0")),
    invDefault: parseFloatLenient(parseStringAttr(el, "InvDefault", "0")),
    inputValues: childrenOf(el, "Element").map((e) =>
      parseFloatLenient(parseStringAttr(e, "InValue", "0")),
    ),
    outputValues: childrenOf(el, "Element").map((e) =>
      parseFloatLenient(parseStringAttr(e, "OutValue", "0")),
    ),
  }));
}

function cloneConversion(c: ParsedConversion, isLast: boolean): ActiveConversion {
  return { type: c.type, params: [...c.params], isLast };
}

/**
 * Port of IntesisConversion.CreateConversion(conversion, isInverted,
 * isLastConversion) (IntesisConversion.cs:134-179).
 */
function transformConversion(
  c: ParsedConversion,
  isInverted: boolean,
  isLast: boolean,
): ActiveConversion {
  if (!isInverted) return cloneConversion(c, isLast);
  switch (c.type) {
    case 1: // SCALE: swap directions
      return { type: c.type, params: [c.params[2], c.params[3], c.params[0], c.params[1]], isLast };
    case 2: // ARITH
      return { type: c.type, params: [c.params[0], c.params[1], c.params[2], 1], isLast };
    case 4: // LUT_REMAP
      return {
        type: c.type,
        params: [c.params[0], Math.trunc(c.params[1]) | 8, c.params[2], 1],
        isLast,
      };
    default:
      return cloneConversion(c, isLast);
  }
}

function conversionEquals(a: ActiveConversion, b: ActiveConversion): boolean {
  return (
    a.type === b.type &&
    a.isLast === b.isLast &&
    a.params[0] === b.params[0] &&
    a.params[1] === b.params[1] &&
    a.params[2] === b.params[2] &&
    a.params[3] === b.params[3]
  );
}

/**
 * Port of IntesisConversion.CreateConversionList (IntesisConversion.cs:220-290):
 * non-inverted filters → operations (inversion-transformed) → inverted
 * filters; the chain is deduplicated against `activeConversions`; returns the
 * chain's start index there, or 255 when empty.
 */
export function createConversionList(
  filterIds: ConversionIdRef[],
  operationIds: ConversionIdRef[],
  filters: ParsedConversion[],
  operations: ParsedConversion[],
  activeConversions: ActiveConversion[],
): number {
  const chain: ActiveConversion[] = [];
  for (const f of filterIds) {
    if (!f.inverted) chain.push(cloneConversion(filters[f.index], false));
  }
  for (const o of operationIds) {
    chain.push(transformConversion(operations[o.index], o.inverted, false));
  }
  for (const f of filterIds) {
    if (f.inverted) chain.push(cloneConversion(filters[f.index], false));
  }
  if (chain.length === 0) return 255;
  chain[chain.length - 1].isLast = true;

  let found = -1;
  for (let i = 0; i < activeConversions.length; i++) {
    if (!conversionEquals(activeConversions[i], chain[0])) continue;
    let match = true;
    for (let j = 1; j < chain.length; j++) {
      if (activeConversions.length > i + j && conversionEquals(activeConversions[i + j], chain[j])) {
        continue;
      }
      match = false;
      break;
    }
    if (match) {
      found = i;
      break;
    }
  }
  if (found === -1) {
    found = activeConversions.length;
    for (let k = 0; k < chain.length; k++) {
      activeConversions.push(cloneConversion(chain[k], k === chain.length - 1));
    }
  }
  return found;
}
