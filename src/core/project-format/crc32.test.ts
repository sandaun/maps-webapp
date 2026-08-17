import { describe, expect, it } from "vitest";
import { crc32 } from "./crc32";

describe("crc32 (zlib/IEEE)", () => {
  it("matches the standard check value", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });

  it("returns 0 for empty input", () => {
    expect(crc32(new Uint8Array(0))).toBe(0);
  });
});
