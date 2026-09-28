import { checkedRestoredRefs, checkedSelectionRefs, librarySizes } from "@/core/conversions/selection";
import { getAttr, getText, XmlDocument, type XmlElement } from "@/core/project-format";
import type { ConversionSelection, SignalConversionRefs } from "@/core/signals/conversion-refs";
import { mbsConversionRwMode } from "@/protocols/modbus/slave";
import { parseBool, parseNumber } from "./from-xml";

/**
 * Conversions of an MBS–KNX signal. `frmSelectConversion` gets the Modbus
 * object as the internal half and the KNX object as the external one
 * (IntesisProjectMBSKNX_RT.cs:445-449), so the direction is the Modbus
 * object's (`ConversionObject(MbsObject)`, `mbsConversionRwMode`) — not the
 * KNX flags as in KNX–MBM.
 */

/**
 * Both halves' refs for a conversion selection on signal `id`. `readWrite`
 * overrides the stored Modbus read/write mode when the same edit changes it.
 * Fails for virtual rows (MAPS makes their conversion button read-only,
 * `PopulateExtraParameters`, IntesisProjectMBSKNX_RT.cs:501-504) and for
 * positions that are not in the project's filters / operations lists.
 */
export function mbsKnxSelectionRefs(
  doc: XmlDocument,
  id: number,
  selection: ConversionSelection,
  readWrite?: number,
): { refs: SignalConversionRefs } | { error: string } {
  const target = conversionTarget(doc, id);
  if ("error" in target) return target;
  const mode = mbsConversionRwMode(readWrite ?? parseNumber(textOf(target.mbs, "ReadWrite"), 2));
  return checkedSelectionRefs(id, selection, mode, librarySizes(doc));
}

/** Refs of both halves exactly as given, for undoing an assignment (same checks). */
export function mbsKnxRestoredRefs(
  doc: XmlDocument,
  id: number,
  refs: SignalConversionRefs,
): { refs: SignalConversionRefs } | { error: string } {
  const target = conversionTarget(doc, id);
  if ("error" in target) return target;
  return checkedRestoredRefs(id, refs, librarySizes(doc));
}

function conversionTarget(doc: XmlDocument, id: number): { mbs: XmlElement } | { error: string } {
  const mbs = doc.find(["InternalProtocol", "Signals", { tag: "Signal", attr: "ID", value: String(id) }]);
  if (!mbs) return { error: `Signal ${id} does not exist.` };
  if (parseBool(attrOfChild(mbs, "Virtual", "Status"), false)) {
    return { error: `Signal ${id + 1} is virtual; virtual signals cannot have conversions.` };
  }
  return { mbs };
}

function textOf(el: XmlElement, tag: string): string | undefined {
  const child = el.children.find((c): c is XmlElement => c.kind === "element" && c.tag === tag);
  return child ? getText(child) : undefined;
}

function attrOfChild(el: XmlElement, tag: string, attr: string): string | undefined {
  const child = el.children.find((c): c is XmlElement => c.kind === "element" && c.tag === tag);
  return child ? getAttr(child, attr) : undefined;
}
