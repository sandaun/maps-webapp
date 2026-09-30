import { element, getText, setText, type XmlElement } from "@/core/project-format";

export function children(el: XmlElement, tag: string): XmlElement[] {
  return el.children.filter((n): n is XmlElement => n.kind === "element" && n.tag === tag);
}
export function child(el: XmlElement, tag: string): XmlElement {
  let node = children(el, tag)[0];
  if (!node) { node = element(tag); node.parent = el; el.children.push(node); }
  return node;
}
export function value(el: XmlElement, tag: string): string | undefined {
  const node = children(el, tag)[0];
  return node ? getText(node) : undefined;
}
export function write(el: XmlElement, tag: string, data: string | number) {
  setText(child(el, tag), String(data));
}
/** Copy the preserved XML tree without parent cycles. */
export function copy(el: XmlElement): XmlElement {
  const result = element(el.tag, el.attrs.map(([key, val]) => [key, val]),
    el.children.map((n) => n.kind === "text" ? { ...n } : copy(n)));
  result.emptyForm = el.emptyForm;
  return result;
}
