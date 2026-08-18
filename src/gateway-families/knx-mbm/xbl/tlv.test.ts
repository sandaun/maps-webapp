import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { decodeElements, readVarint, type DecodedElement } from "./decode";
import {
  array,
  container,
  encodeVarint,
  externalIdBytes,
  f32le,
  ipv4Bytes,
  MAX_VARINT,
  node,
  nullTerminatedUtf8,
  serializeElements,
  shrunkU16be,
  u16be,
  u32be,
  u32le,
  type XblElementSpec,
} from "./tlv";

const bytes = (...values: number[]) => new Uint8Array(values);

describe("encodeVarint", () => {
  it.each([
    [0, [0x80]],
    [127, [0xff]],
    [128, [0x40, 0x80]],
    [16383, [0x7f, 0xff]],
    [16384, [0x20, 0x40, 0x00]],
    [2097151, [0x3f, 0xff, 0xff]],
    [2097152, [0x10, 0x20, 0x00, 0x00]],
    [MAX_VARINT - 1, [0x1f, 0xff, 0xff, 0xff]],
  ] as const)("encodes %d as %s", (value, expected) => {
    expect(encodeVarint(value)).toEqual(bytes(...expected));
  });

  it("prepends a 0x00 marker for special varints", () => {
    expect(encodeVarint(5, true)).toEqual(bytes(0x00, 0x85));
    expect(encodeVarint(128, true)).toEqual(bytes(0x00, 0x40, 0x80));
  });

  it.each([-1, MAX_VARINT, 1.5, Number.NaN])("rejects %s", (value) => {
    expect(() => encodeVarint(value)).toThrow(/out of range/);
  });
});

describe("readVarint", () => {
  it("round-trips every encodable value (property)", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: MAX_VARINT - 1 }), fc.boolean(), (value, special) => {
        const decoded = readVarint(encodeVarint(value, special), 0);
        expect(decoded.value).toBe(value);
        expect(decoded.special).toBe(special);
        expect(decoded.length).toBe((value < 128 ? 1 : value < 16384 ? 2 : value < 2097152 ? 3 : 4) + (special ? 1 : 0));
      }),
    );
  });

  it("rejects reserved lead bytes and out-of-bounds reads", () => {
    expect(() => readVarint(bytes(0x01), 0)).toThrow(/lead byte/);
    expect(() => readVarint(bytes(), 0)).toThrow(/out of bounds/);
  });
});

describe("serializeElements", () => {
  it("serializes a leaf node as tag+len+content", () => {
    expect(serializeElements([node(2, bytes(0xaa))])).toEqual(bytes(0x82, 0x81, 0xaa));
  });

  it("serializes a container with a special length", () => {
    expect(serializeElements([container(1, [node(1, bytes(0x00))])])).toEqual(
      bytes(0x81, 0x00, 0x83, 0x81, 0x81, 0x00),
    );
  });

  it("serializes an array with a special tag and per-item lengths", () => {
    expect(serializeElements([array([[node(1, bytes(0x01))]])])).toEqual(
      bytes(0x00, 0x81, 0x85, 0x81, 0x83, 0x81, 0x81, 0x01),
    );
  });
});

type Shape = {
  tag: number;
  kind: string;
  content?: number[];
  children?: Shape[];
  items?: Shape[][];
};

function specShape(elements: XblElementSpec[]): Shape[] {
  return elements.map((el) => {
    switch (el.kind) {
      case "node":
        return { tag: el.tag, kind: "node", content: Array.from(el.content) };
      case "container":
        return { tag: el.tag, kind: "container", children: specShape(el.children) };
      case "array":
        return { tag: 1, kind: "array", items: el.items.map(specShape) };
    }
  });
}

function decodedShape(elements: DecodedElement[], data: Uint8Array): Shape[] {
  return elements.map((el) => {
    if (el.kind === "node") {
      return {
        tag: el.tag,
        kind: "node",
        content: Array.from(data.subarray(el.contentOffset, el.contentOffset + el.contentLength)),
      };
    }
    if (el.kind === "container") {
      return { tag: el.tag, kind: "container", children: decodedShape(el.children ?? [], data) };
    }
    return { tag: el.tag, kind: "array", items: (el.items ?? []).map((i) => decodedShape(i, data)) };
  });
}

describe("serializeElements ∘ decodeElements", () => {
  const tagArb = fc.integer({ min: 1, max: 20 });
  const elementArb = (depth: number): fc.Arbitrary<XblElementSpec> => {
    const nodeArb: fc.Arbitrary<XblElementSpec> = fc.record({
      kind: fc.constant("node" as const),
      tag: tagArb,
      content: fc.uint8Array({ maxLength: 10 }),
    });
    if (depth === 0) return nodeArb;
    return fc.oneof(
      nodeArb,
      fc.record({
        kind: fc.constant("container" as const),
        tag: tagArb,
        children: fc.array(elementArb(depth - 1), { maxLength: 4 }),
      }),
      fc.record({
        kind: fc.constant("array" as const),
        items: fc.array(fc.array(elementArb(depth - 1), { maxLength: 3 }), { maxLength: 3 }),
      }),
    );
  };

  it("round-trips random element trees (property)", () => {
    fc.assert(
      fc.property(fc.array(elementArb(3), { maxLength: 5 }), (spec) => {
        const data = serializeElements(spec);
        expect(decodedShape(decodeElements(data), data)).toEqual(specShape(spec));
      }),
    );
  });
});

describe("scalar helpers", () => {
  it("encodes u16/u32 in both endiannesses and f32 LE", () => {
    expect(u16be(0x1234)).toEqual(bytes(0x12, 0x34));
    expect(u32be(0x12345678)).toEqual(bytes(0x12, 0x34, 0x56, 0x78));
    expect(u32le(0x12345678)).toEqual(bytes(0x78, 0x56, 0x34, 0x12));
    expect(f32le(1)).toEqual(bytes(0x00, 0x00, 0x80, 0x3f));
    expect(f32le(1000)).toEqual(bytes(0x00, 0x00, 0x7a, 0x44));
  });

  it("shrinks 2-byte BE values when the high byte is zero", () => {
    expect(shrunkU16be(0)).toEqual(bytes(0x00));
    expect(shrunkU16be(255)).toEqual(bytes(0xff));
    expect(shrunkU16be(256)).toEqual(bytes(0x01, 0x00));
  });

  it("encodes external IDs shrunk, or 3-byte with link tables", () => {
    expect(externalIdBytes(5)).toEqual(bytes(0x05));
    expect(externalIdBytes(300)).toEqual(bytes(0x01, 0x2c));
    expect(externalIdBytes(300, true)).toEqual(bytes(0x80, 0x01, 0x2c));
  });
});

describe("nullTerminatedUtf8", () => {
  it("appends a NUL when the text is shorter than bytesSize", () => {
    expect(nullTerminatedUtf8("abc", 32, 33)).toEqual(bytes(0x61, 0x62, 0x63, 0x00));
  });

  it("trims whole UTF-8 characters until the text fits maxByteLength", () => {
    // "aàb" = 4 bytes; trimming char by char yields "a" (1 byte) + NUL.
    expect(nullTerminatedUtf8("aàb", 2, 3)).toEqual(bytes(0x61, 0x00));
  });
});

describe("ipv4Bytes", () => {
  it("parses dotted quads and defaults empty to 0.0.0.0", () => {
    expect(ipv4Bytes("192.168.1.50")).toEqual(bytes(192, 168, 1, 50));
    expect(ipv4Bytes("")).toEqual(bytes(0, 0, 0, 0));
  });

  it.each(["1.2.3", "256.1.1.1", "a.b.c.d", "1.2.3.4.5"])("rejects %s", (value) => {
    expect(() => ipv4Bytes(value)).toThrow(/Invalid IPv4/);
  });
});
