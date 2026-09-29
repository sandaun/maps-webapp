import { text, type XmlElement } from "./model";

const INDENT_UNIT = "  ";

/**
 * Append a MAPS-style child without changing existing siblings. MAPS saves
 * .ibmaps with two-space indentation and CRLF (IntesisXML.cs:353-359), but
 * imported XML may have been reformatted without closing-tag whitespace.
 */
export function appendChildIndented(parent: XmlElement, child: XmlElement, childLevel: number): void {
  const lineEnding = "\r\n";
  const last = parent.children[parent.children.length - 1];
  child.parent = parent;
  if (last && last.kind === "text" && /^\s*$/.test(last.text)) {
    const indent = `${lineEnding}${INDENT_UNIT.repeat(childLevel)}`;
    parent.children.splice(parent.children.length - 1, 0, text(indent), child);
  } else if (parent.children.length === 0) {
    const base = `${lineEnding}${INDENT_UNIT.repeat(Math.max(0, childLevel - 1))}`;
    parent.children = [text(`${base}${INDENT_UNIT}`), child, text(base)];
    parent.emptyForm = undefined;
  } else {
    // Compact XML: append directly after the existing content.
    parent.children.push(child);
  }
}
