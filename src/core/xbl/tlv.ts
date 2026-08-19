/**
 * XBL TLV primitives — pure encoder for the Intesis XBL binary format.
 *
 * Provenance: port of `XBLParser.cs` (temp/maps-cloud/xbl-spec/src/XBLParser.cs,
 * decompiled from IntesisBoxMAPS):
 * - `encodeVarint`  ← `encodeUint32` (XBLParser.cs:393-433)
 * - `serializeElements` ← `generate_aux` / `generateXBLElementRawContent`
 *   (XBLParser.cs:164-313), rewritten bottom-up (content first, then wrap)
 *   instead of the C# in-place shifting; the emitted bytes are identical.
 * - `nullTerminatedUtf8` ← `ConvertStringToByteArrayNull` (XBLParser.cs:315-334)
 *
 * Format summary:
 * - Every element is `tag length content`, tag and length are variable-length
 *   integers: 1–4 bytes, big-endian, with the high bits of the first byte
 *   marking the byte count (0x80+ = 1B, 0x40+ = 2B, 0x20+ = 3B, 0x10+ = 4B).
 * - The "special" flag prepends a 0x00 byte. Container nodes use a special
 *   length; arrays (tag 1) use a special tag.
 * - Arrays (tag 1, heterogeneous/XBL items): content = varint(count) followed
 *   by `varint(itemLen) itemBytes` per item. Tag 2 arrays exist in the reader
 *   but are never emitted by the MAPS writer — not ported.
 */

/** Largest value the varint encoding supports (C# returns null ≥ 2²⁸). */
export const MAX_VARINT = 0x10000000;

export function encodeVarint(value: number, special = false): Uint8Array {
  if (!Number.isInteger(value) || value < 0 || value >= MAX_VARINT) {
    throw new Error(`XBL varint out of range: ${value}`);
  }
  const num = value < 128 ? 1 : value < 16384 ? 2 : value < 2097152 ? 3 : 4;
  const out = new Uint8Array(special ? num + 1 : num);
  const base = special ? 1 : 0;
  out[base] = 128 >> (num - 1);
  for (let i = 0; i < num; i++) {
    out[base + i] |= (value >>> ((num - i - 1) * 8)) & 0xff;
  }
  return out;
}

export type XblElementSpec =
  | { kind: "node"; tag: number; content: Uint8Array }
  | { kind: "container"; tag: number; children: XblElementSpec[] }
  /** XblArray with tag 1 and containsXBL: true (the only kind MAPS emits). */
  | { kind: "array"; items: XblElementSpec[][] };

export function node(tag: number, content: Uint8Array): XblElementSpec {
  return { kind: "node", tag, content };
}

export function container(tag: number, children: XblElementSpec[]): XblElementSpec {
  return { kind: "container", tag, children };
}

export function array(items: XblElementSpec[][]): XblElementSpec {
  return { kind: "array", items };
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

/** Serialize a list of top-level elements (C# `generate_aux`). */
export function serializeElements(elements: XblElementSpec[]): Uint8Array {
  return concat(elements.map(serializeElement));
}

function serializeElement(el: XblElementSpec): Uint8Array {
  switch (el.kind) {
    case "node":
      return concat([encodeVarint(el.tag), encodeVarint(el.content.length), el.content]);
    case "container": {
      const inner = serializeElements(el.children);
      // Container nodes carry a "special" (0x00-prefixed) length.
      return concat([encodeVarint(el.tag), encodeVarint(inner.length, true), inner]);
    }
    case "array": {
      const parts: Uint8Array[] = [encodeVarint(el.items.length)];
      for (const item of el.items) {
        const itemBytes = serializeElements(item);
        parts.push(encodeVarint(itemBytes.length), itemBytes);
      }
      const inner = concat(parts);
      // Tag 1 with "special" tag prefix; length is a plain varint.
      return concat([encodeVarint(1, true), encodeVarint(inner.length), inner]);
    }
  }
}

// --- scalar/string helpers (ports of XBLParser/IntesisXBL helpers) ---------

/** 16-bit big-endian (C# `BitConverter.GetBytes(ReverseBytes((ushort)v))`). */
export function u16be(value: number): Uint8Array {
  const v = value & 0xffff;
  return new Uint8Array([(v >>> 8) & 0xff, v & 0xff]);
}

/** 32-bit big-endian. */
export function u32be(value: number): Uint8Array {
  const v = value >>> 0;
  return new Uint8Array([(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff]);
}

/** 32-bit little-endian (plain `BitConverter.GetBytes(uint)`). */
export function u32le(value: number): Uint8Array {
  const v = value >>> 0;
  return new Uint8Array([v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff]);
}

/** 32-bit float little-endian (plain `BitConverter.GetBytes(float)`). */
export function f32le(value: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setFloat32(0, value, true);
  return out;
}

/**
 * 2-byte big-endian value shrunk to 1 byte when the high byte is 0.
 * Port of the inline pattern in `MbmObject.GenerateXBLItem` (Address,
 * ConfigID) and `IntesisBinaryOps.GetExternalIdBytes`.
 */
export function shrunkU16be(value: number): Uint8Array {
  const be = u16be(value);
  return be[0] === 0 ? be.subarray(1) : be;
}

/**
 * ExternalID encoding (`IntesisBinaryOps.GetExternalIdBytes`): with link
 * tables, a 3-byte form prefixed with 0x80; otherwise the shrunk 2B BE form.
 */
export function externalIdBytes(externalId: number, useLinkTables = false): Uint8Array {
  if (useLinkTables) {
    return concat([new Uint8Array([0x80]), u16be(externalId)]);
  }
  return shrunkU16be(externalId);
}

export function utf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

/**
 * UTF-8 bytes of `input`, trimmed char-by-char until it fits `maxByteLength`,
 * with a trailing NUL appended when the result is shorter than `bytesSize`.
 * Port of `XBLParser.ConvertStringToByteArrayNull`. Callers in MAPS always
 * pass `bytesSize = maxByteLength + 1`, so the result is always NUL-terminated.
 */
export function nullTerminatedUtf8(
  input: string,
  maxByteLength: number,
  bytesSize: number,
): Uint8Array {
  let text = input;
  while (utf8(text).length > maxByteLength) {
    text = text.slice(0, -1);
  }
  const bytes = utf8(text);
  if (bytes.length < bytesSize) {
    return concat([bytes, new Uint8Array([0])]);
  }
  return bytes;
}

/** Dotted-quad IPv4 string → 4 bytes. Empty string → 0.0.0.0. */
export function ipv4Bytes(value: string): Uint8Array {
  const text = value === "" ? "0.0.0.0" : value;
  const parts = text.split(".").map((p) => Number(p));
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) {
    throw new Error(`Invalid IPv4 address for XBL: "${value}"`);
  }
  return new Uint8Array(parts);
}
