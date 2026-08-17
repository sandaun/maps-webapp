import type { XmlElement, XmlNode } from "./model";
import type { ParsedXml } from "./parse";

/**
 * Serializer that reproduces the desktop MAPS (.NET XmlWriter) byte layout
 * exactly: BOM, original declaration, raw whitespace (CRLF included) kept
 * verbatim from parse, and `<tag />` vs `<tag></tag>` per the source form.
 */
export function serializeXml(doc: ParsedXml): string {
  const parts: string[] = [];
  if (doc.bom) parts.push("\uFEFF");
  parts.push(doc.declaration, doc.prefix);
  serializeElement(doc.root, parts);
  parts.push(doc.suffix);
  return parts.join("");
}

function serializeElement(el: XmlElement, parts: string[]): void {
  const open = [`<${el.tag}`];
  for (const [name, value] of el.attrs) {
    open.push(` ${name}="${escapeAttr(value)}"`);
  }
  if (el.children.length === 0) {
    parts.push(el.emptyForm === "pair" ? `${open.join("")}></${el.tag}>` : `${open.join("")} />`);
    return;
  }
  parts.push(`${open.join("")}>`);
  for (const child of el.children) {
    serializeNode(child, parts);
  }
  parts.push(`</${el.tag}>`);
}

function serializeNode(node: XmlNode, parts: string[]): void {
  if (node.kind === "text") {
    parts.push(escapeText(node.text));
  } else {
    serializeElement(node, parts);
  }
}

function escapeText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(value: string): string {
  return escapeText(value).replace(/"/g, "&quot;");
}
