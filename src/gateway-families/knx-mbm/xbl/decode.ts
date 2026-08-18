/**
 * Minimal XBL TLV reader — used by the generator's tests and by the
 * verification harness (scripts/verify-xbl.ts) to locate fields structurally
 * (e.g. the volatile 6-byte timestamp) instead of hardcoding offsets.
 *
 * Provenance: inverse of `XBLParser.parse` / `getUint32`
 * (temp/maps-cloud/xbl-spec/src/XBLParser.cs:17-133, 435-506). Only the
 * shapes the MAPS writer emits are decoded: leaf nodes, container nodes
 * (special length) and tag-1 arrays of XBL items (special tag).
 */

export interface DecodedElement {
  tag: number;
  /** Absolute offset where this element's tag starts. */
  offset: number;
  /** Absolute offset/length of the raw content. */
  contentOffset: number;
  contentLength: number;
  kind: "node" | "container" | "array";
  children?: DecodedElement[];
  /** For arrays: one child-list per item. */
  items?: DecodedElement[][];
}

interface Varint {
  value: number;
  length: number;
  special: boolean;
}

export function readVarint(data: Uint8Array, offset: number): Varint {
  const b = data[offset];
  if (b === undefined) throw new Error(`XBL varint out of bounds at ${offset}`);
  if (b === 0) {
    // "Special" marker: the real varint follows.
    const inner = readVarint(data, offset + 1);
    return { value: inner.value, length: inner.length + 1, special: true };
  }
  let length: number;
  let value: number;
  if (b >= 128) {
    length = 1;
    value = b & 0x7f;
  } else if (b >= 64) {
    length = 2;
    value = b & 0x3f;
  } else if (b >= 32) {
    length = 3;
    value = b & 0x1f;
  } else if (b >= 16) {
    length = 4;
    value = b & 0x0f;
  } else {
    throw new Error(`Invalid XBL varint lead byte 0x${b.toString(16)} at ${offset}`);
  }
  for (let i = 1; i < length; i++) {
    value = (value << 8) | data[offset + i];
  }
  return { value, length, special: false };
}

/** Decode all top-level elements of an XBL TLV payload. */
export function decodeElements(data: Uint8Array, offset = 0, end = data.length): DecodedElement[] {
  const out: DecodedElement[] = [];
  let pos = offset;
  while (pos < end) {
    const start = pos;
    const tag = readVarint(data, pos);
    pos += tag.length;
    const len = readVarint(data, pos);
    pos += len.length;
    const contentOffset = pos;
    const contentLength = len.value;
    pos += contentLength;
    if (tag.special && tag.value === 1) {
      // Array of XBL item lists: varint(count), then varint(len)+bytes each.
      const items: DecodedElement[][] = [];
      let p = contentOffset;
      const count = readVarint(data, p);
      p += count.length;
      for (let i = 0; i < count.value; i++) {
        const itemLen = readVarint(data, p);
        p += itemLen.length;
        items.push(decodeElements(data, p, p + itemLen.value));
        p += itemLen.value;
      }
      out.push({ tag: tag.value, offset: start, contentOffset, contentLength, kind: "array", items });
    } else if (len.special) {
      const children = decodeElements(data, contentOffset, contentOffset + contentLength);
      out.push({ tag: tag.value, offset: start, contentOffset, contentLength, kind: "container", children });
    } else {
      out.push({ tag: tag.value, offset: start, contentOffset, contentLength, kind: "node" });
    }
  }
  return out;
}

/** First child element with the given tag (throws when absent). */
export function childByTag(el: DecodedElement, tag: number): DecodedElement {
  const found = el.children?.find((c) => c.tag === tag);
  if (!found) throw new Error(`XBL element tag ${el.tag} has no child tag ${tag}`);
  return found;
}
