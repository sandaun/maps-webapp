import { describe, expect, it } from "vitest";
import { crc16Ccitt } from "./crc16";

/**
 * Vectors computed with the reference implementation `crc16_ccitt` from
 * temp/maps-cloud/sonda_maps.py (bitwise port of Crc16.cs, poly 0x1021,
 * init 0x0000). "123456789" → 0x31C3 is the classic CRC-16/XMODEM check value.
 */
describe("crc16Ccitt", () => {
  it("matches the XMODEM check value for '123456789'", () => {
    expect(crc16Ccitt(new TextEncoder().encode("123456789"))).toBe(0x31c3);
  });

  it("returns 0 for empty input (init 0x0000)", () => {
    expect(crc16Ccitt(new Uint8Array(0))).toBe(0);
  });

  it("matches the reference for all byte values 0x00..0xFF", () => {
    expect(crc16Ccitt(Uint8Array.from({ length: 256 }, (_, i) => i))).toBe(0x7e55);
  });
});
