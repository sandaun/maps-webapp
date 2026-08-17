import {
  element,
  type LineEnding,
  text,
  type XmlElement,
  type XmlNode,
} from "./model";

export interface ParsedXml {
  bom: boolean;
  declaration: string;
  /** Raw text between the declaration and the root element (usually CRLF). */
  prefix: string;
  root: XmlElement;
  /** Raw text after the root element (e.g. the trailing CRLF). */
  suffix: string;
  lineEnding: LineEnding;
}

/**
 * Purpose-built parser for MAPS `.ibmaps` documents. The format is
 * machine-generated, well-formed and narrow (no namespaces processing, no
 * comments, no CDATA — verified against real reference files), and the MVP
 * requires byte-stable round-trip, including the `<tag />` vs `<tag></tag>`
 * distinction and CRLF preservation. fast-xml-parser's preserveOrder mode
 * loses both, which is why this parser exists (see docs/knx-mbm-mvp.md).
 *
 * Text and attribute values are entity-decoded on parse and re-escaped on
 * serialize. Unknown constructs (`<!`, `<?` beyond the declaration) fail
 * loudly instead of being silently dropped.
 */
export function parseXml(xml: string): ParsedXml {
  const bom = xml.charCodeAt(0) === 0xfeff;
  const src = bom ? xml.slice(1) : xml;
  const lineEnding: LineEnding = src.includes("\r\n") ? "\r\n" : "\n";

  let pos = 0;
  let declaration = '<?xml version="1.0" encoding="UTF-8"?>';
  if (src.startsWith("<?xml")) {
    const end = src.indexOf("?>", 0);
    if (end < 0) throw new Error("Malformed XML declaration");
    declaration = src.slice(0, end + 2);
    pos = end + 2;
  } else if (src.startsWith("<?")) {
    throw new Error("Unsupported processing instruction before root element");
  }

  const topLevel: XmlNode[] = [];
  while (pos < src.length) {
    if (src[pos] === "<") {
      if (src.startsWith("</", pos)) throw new Error(`Unexpected closing tag at offset ${pos}`);
      if (src.startsWith("<!--", pos) || src.startsWith("<!", pos) || src.startsWith("<?", pos)) {
        throw new Error(`Unsupported XML construct at offset ${pos}: ${src.slice(pos, pos + 12)}`);
      }
      const [el, next] = parseElement(src, pos);
      topLevel.push(el);
      pos = next;
    } else {
      const next = src.indexOf("<", pos);
      const end = next < 0 ? src.length : next;
      topLevel.push(text(decodeEntities(src.slice(pos, end))));
      pos = end;
    }
  }

  const rootIndex = topLevel.findIndex((n) => n.kind === "element");
  const root = topLevel[rootIndex];
  if (!root || root.kind !== "element") throw new Error("XML document has no root element");
  if (topLevel.some((n, idx) => idx > rootIndex && n.kind === "element")) {
    throw new Error("XML document has more than one root element");
  }

  const prefix = topLevel
    .slice(0, rootIndex)
    .map((n) => (n.kind === "text" ? n.text : ""))
    .join("");
  const suffix = topLevel
    .slice(rootIndex + 1)
    .map((n) => (n.kind === "text" ? n.text : ""))
    .join("");

  return { bom, declaration, prefix, root, suffix, lineEnding };
}

function parseElement(src: string, start: number): [XmlElement, number] {
  let pos = start + 1; // skip '<'
  const nameMatch = /^[^\s/>]+/.exec(src.slice(pos));
  if (!nameMatch) throw new Error(`Malformed tag at offset ${start}`);
  const tag = nameMatch[0];
  pos += tag.length;

  const attrs: Array<[string, string]> = [];
  for (;;) {
    pos = skipSpaces(src, pos);
    if (src.startsWith("/>", pos)) {
      const el = element(tag, attrs, []);
      el.emptyForm = "self";
      return [el, pos + 2];
    }
    if (src[pos] === ">") {
      pos += 1;
      break;
    }
    const attrMatch = /^[^\s=/>]+/.exec(src.slice(pos));
    if (!attrMatch) throw new Error(`Malformed attribute in <${tag}> at offset ${pos}`);
    const name = attrMatch[0];
    pos += name.length;
    pos = skipSpaces(src, pos);
    if (src[pos] !== "=") throw new Error(`Expected '=' after attribute ${name} in <${tag}>`);
    pos = skipSpaces(src, pos + 1);
    const quote = src[pos];
    if (quote !== '"' && quote !== "'") throw new Error(`Expected quote for attribute ${name} in <${tag}>`);
    const valueEnd = src.indexOf(quote, pos + 1);
    if (valueEnd < 0) throw new Error(`Unterminated attribute ${name} in <${tag}>`);
    attrs.push([name, decodeEntities(src.slice(pos + 1, valueEnd))]);
    pos = valueEnd + 1;
  }

  const children: XmlNode[] = [];
  const el = element(tag, attrs, children);
  for (;;) {
    if (pos >= src.length) throw new Error(`Unterminated element <${tag}>`);
    if (src.startsWith(`</`, pos)) {
      const closeEnd = src.indexOf(">", pos);
      if (closeEnd < 0) throw new Error(`Malformed closing tag for <${tag}>`);
      const closing = src.slice(pos + 2, closeEnd).trim();
      if (closing !== tag) throw new Error(`Mismatched closing tag </${closing}> for <${tag}>`);
      if (children.length === 0) el.emptyForm = "pair";
      return [el, closeEnd + 1];
    }
    if (src[pos] === "<") {
      if (src.startsWith("<!--", pos) || src.startsWith("<!", pos) || src.startsWith("<?", pos)) {
        throw new Error(`Unsupported XML construct inside <${tag}> at offset ${pos}`);
      }
      const [child, next] = parseElement(src, pos);
      child.parent = el;
      children.push(child);
      pos = next;
    } else {
      const next = src.indexOf("<", pos);
      const end = next < 0 ? src.length : next;
      children.push(text(decodeEntities(src.slice(pos, end))));
      pos = end;
    }
  }
}

function skipSpaces(src: string, pos: number): number {
  while (pos < src.length && /\s/.test(src[pos])) pos++;
  return pos;
}

const NAMED_ENTITIES: Record<string, string> = {
  lt: "<",
  gt: ">",
  amp: "&",
  quot: '"',
  apos: "'",
};

function decodeEntities(value: string): string {
  if (!value.includes("&")) return value;
  return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return NAMED_ENTITIES[body] ?? match;
  });
}
