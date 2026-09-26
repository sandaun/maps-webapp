import { getAttr, XmlDocument, type XmlElement } from "@/core/project-format";
import {
  refsFromSelection,
  type ConversionRwMode,
  type ConversionSelection,
  type SignalConversionRefs,
} from "@/core/signals/conversion-refs";
import type { KnxFlags } from "@/protocols/knx";
import { parseBool } from "./from-xml";

/**
 * Direction of a KNX–MBM signal for its conversions: `ConversionObject(KnxComObject)`
 * (ConversionObject.cs:110-128) looks only at the KNX flags — the Modbus
 * read/write functions play no part.
 */
export function knxConversionRwMode(flags: KnxFlags): ConversionRwMode {
  const reads = flags.r || flags.t;
  if (reads && (flags.u || flags.w)) return "readwrite";
  return reads ? "read" : "write";
}

/**
 * Both halves' refs for a conversion selection on signal `id`, as
 * `frmSelectConversion` would save them. `flags` overrides the stored KNX flags
 * when the same edit changes them. Fails for virtual signals (MAPS makes their
 * cell read-only, `IntesisProjectKnxMbm_RT.cs:709-712`) and for positions that
 * are not in the project's filters / operations lists.
 */
export function knxSelectionRefs(
  doc: XmlDocument,
  id: number,
  selection: ConversionSelection,
  flags?: KnxFlags,
): { refs: SignalConversionRefs } | { error: string } {
  const target = conversionTarget(doc, id);
  if ("error" in target) return target;
  const filters = [selection.internalFilter, selection.externalFilter].filter((f): f is number => f !== null);
  if (filters.some((index) => index >= target.filterCount) || selection.operations.some((index) => index >= target.operationCount)) {
    return { error: `Signal ${id + 1} uses a conversion that is not in the project.` };
  }
  return { refs: refsFromSelection(selection, knxConversionRwMode(flags ?? readFlags(target.knx))) };
}

/**
 * Refs of both halves exactly as given, for undoing an assignment: the
 * previous refs may be ones `frmSelectConversion` would not write (imported
 * files), so they cannot go through a selection. Same checks as a selection:
 * no virtual signal, every position in the project's lists.
 */
export function knxRestoredRefs(
  doc: XmlDocument,
  id: number,
  refs: SignalConversionRefs,
): { refs: SignalConversionRefs } | { error: string } {
  const target = conversionTarget(doc, id);
  if ("error" in target) return target;
  const halves = [refs.internal, refs.external];
  if (
    halves.some(
      (half) =>
        half.filters.some((ref) => ref.index >= target.filterCount) ||
        half.operations.some((ref) => ref.index >= target.operationCount),
    )
  ) {
    return { error: `Signal ${id + 1} uses a conversion that is not in the project.` };
  }
  return { refs };
}

function conversionTarget(
  doc: XmlDocument,
  id: number,
): { knx: XmlElement; filterCount: number; operationCount: number } | { error: string } {
  const knx = doc.find(["InternalProtocol", { tag: "KNXObject", attr: "ID", value: String(id) }]);
  if (!knx) return { error: `Signal ${id} does not exist.` };
  if (parseBool(attrOfChild(knx, "Virtual", "Status"), false)) {
    return { error: `Signal ${id + 1} is virtual; virtual signals cannot have conversions.` };
  }
  const types = (doc.find(["IBOX", "Conversions"])?.children ?? [])
    .filter((c): c is XmlElement => c.kind === "element" && c.tag === "Conversion")
    .map((el) => getAttr(el, "Type"));
  const filterCount = types.filter((type) => type === "0").length;
  return { knx, filterCount, operationCount: types.length - filterCount };
}

function readFlags(knx: XmlElement): KnxFlags {
  const flag = (name: string) => parseBool(attrOfChild(knx, "Flags", name), false);
  return { u: flag("U"), t: flag("T"), ri: flag("Ri"), w: flag("W"), r: flag("R") };
}

function attrOfChild(el: XmlElement, tag: string, attr: string): string | undefined {
  const child = el.children.find((c): c is XmlElement => c.kind === "element" && c.tag === tag);
  return child ? getAttr(child, attr) : undefined;
}
