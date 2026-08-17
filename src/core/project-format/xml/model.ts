/**
 * XML document model that preserves everything the desktop MAPS tool writes:
 * node order, attribute order, whitespace/indentation, BOM, line endings and
 * the XML declaration. All edits go through patch operations on this tree;
 * the XML is never regenerated from a domain model.
 */

export interface XmlText {
  kind: "text";
  text: string;
}

export interface XmlElement {
  kind: "element";
  tag: string;
  /** Ordered attributes (order is significant for round-trip fidelity). */
  attrs: Array<[string, string]>;
  children: XmlNode[];
  /** Parent link, set at parse time; used by remove/replace operations. */
  parent?: XmlElement;
  /**
   * How to serialize when the element has no children: `<tag />` ("self")
   * or `<tag></tag>` ("pair"). Both forms exist in real .ibmaps files and
   * are preserved verbatim. Defaults to "self" for new elements.
   */
  emptyForm?: "self" | "pair";
}

export type XmlNode = XmlElement | XmlText;

export type LineEnding = "\r\n" | "\n";

/** A path segment selects an element by tag, optionally disambiguated. */
export type PathSegment =
  | string
  | {
      tag: string;
      /** Match an attribute value, e.g. { tag: "Signal", attr: "ID", value: "3" }. */
      attr?: string;
      value?: string;
      /** 0-based index among matching siblings. */
      index?: number;
    };

export function element(
  tag: string,
  attrs: Array<[string, string]> = [],
  children: XmlNode[] = [],
): XmlElement {
  const el: XmlElement = { kind: "element", tag, attrs, children };
  for (const child of children) {
    if (child.kind === "element") child.parent = el;
  }
  return el;
}

export function text(value: string): XmlText {
  return { kind: "text", text: value };
}

export function getAttr(el: XmlElement, name: string): string | undefined {
  return el.attrs.find(([n]) => n === name)?.[1];
}

export function setAttr(el: XmlElement, name: string, value: string): void {
  const existing = el.attrs.findIndex(([n]) => n === name);
  if (existing >= 0) {
    el.attrs[existing] = [name, value]; // keep position
  } else {
    el.attrs.push([name, value]);
  }
}

/** Text content of an element whose only meaningful child is text. */
export function getText(el: XmlElement): string {
  return el.children
    .filter((c): c is XmlText => c.kind === "text")
    .map((c) => c.text)
    .join("");
}

export function setText(el: XmlElement, value: string): void {
  // Replace the element's content with a single text node (drops children).
  el.children = [text(value)];
}

function matches(el: XmlElement, segment: PathSegment): boolean {
  if (typeof segment === "string") return el.tag === segment;
  if (el.tag !== segment.tag) return false;
  if (segment.attr !== undefined) {
    return getAttr(el, segment.attr) === segment.value;
  }
  return true;
}

/** All elements matching the path, resolved step by step from `root`. */
export function findAll(root: XmlElement, path: PathSegment[]): XmlElement[] {
  let level: XmlElement[] = [root];
  for (const segment of path) {
    const next: XmlElement[] = [];
    for (const el of level) {
      const matching = el.children.filter(
        (c): c is XmlElement => c.kind === "element" && matches(c, segment),
      );
      if (typeof segment === "object" && segment.index !== undefined) {
        const picked = matching[segment.index];
        if (picked) next.push(picked);
      } else {
        next.push(...matching);
      }
    }
    level = next;
  }
  return level;
}

/** First element matching the path, or undefined. */
export function find(root: XmlElement, path: PathSegment[]): XmlElement | undefined {
  return findAll(root, path)[0];
}

/** Remove the element from its parent. Returns false if it has no parent. */
export function remove(el: XmlElement): boolean {
  if (!el.parent) return false;
  const siblings = el.parent.children;
  const index = siblings.indexOf(el);
  if (index < 0) return false;
  siblings.splice(index, 1);
  el.parent = undefined;
  return true;
}

/** Append a child element (keeps it after any existing children). */
export function appendChild(parent: XmlElement, child: XmlElement): void {
  child.parent = parent;
  parent.children.push(child);
}
