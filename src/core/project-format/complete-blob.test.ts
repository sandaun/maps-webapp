import { describe, expect, it } from "vitest";
import { buildCompleteBlob, parseCompleteBlob } from "./complete-blob";
import { crc32 } from "./crc32";

const xbl = new Uint8Array([1, 2, 3, 4, 5]);
const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 9, 9, 9]);

describe("complete blob", () => {
  it("round-trips build → parse", () => {
    const blob = buildCompleteBlob(xbl, zip);
    const parsed = parseCompleteBlob(blob);
    expect([...parsed.xbl]).toEqual([...xbl]);
    expect([...parsed.zip]).toEqual([...zip]);
  });

  it("writes the XBL length and CRC32 big-endian", () => {
    const blob = buildCompleteBlob(xbl, zip);
    expect(blob[3]).toBe(5); // length
    const storedCrc = new DataView(blob.buffer).getUint32(4 + 5, false);
    expect(storedCrc).toBe(crc32(xbl));
  });

  it("rejects a corrupt CRC32", () => {
    const blob = buildCompleteBlob(xbl, zip);
    blob[8] ^= 0xff;
    expect(() => parseCompleteBlob(blob)).toThrow(/CRC32 mismatch/);
  });

  it("rejects a truncated blob", () => {
    const blob = buildCompleteBlob(xbl, zip).subarray(0, 6);
    expect(() => parseCompleteBlob(blob)).toThrow(/too short|truncated/);
  });

  it("rejects a blob without a ZIP", () => {
    const blob = buildCompleteBlob(xbl, new Uint8Array([0, 0, 0]));
    expect(() => parseCompleteBlob(blob)).toThrow(/ZIP/);
  });
});
