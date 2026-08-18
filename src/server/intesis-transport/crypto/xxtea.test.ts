import { describe, expect, it } from "vitest";
import { xxtea128CbcDecrypt, xxtea128CbcEncrypt } from "./xxtea";

/**
 * Vectors computed with the Python port of `XxTea.cs` in
 * temp/maps-cloud/sonda_maps.py (`xxtea128_encrypt_cbc`), which was validated
 * live against a 700 Series gateway (PROTOCOL.md §8).
 * Key = 00..0F, IV = 10..1F.
 */

const KEY = Uint8Array.from({ length: 16 }, (_, i) => i);
const IV = Uint8Array.from({ length: 16 }, (_, i) => i + 16);

function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

describe("xxtea128CbcEncrypt", () => {
  it("encrypts a single zero block (reference vector)", () => {
    expect(Buffer.from(xxtea128CbcEncrypt(KEY, new Uint8Array(16), IV)).toString("hex")).toBe(
      "0319c12d4ce73791f02818267c86c54f",
    );
  });

  it("encrypts the LOGIN2 payload with zero padding (reference vector)", () => {
    const payload = new TextEncoder().encode('{"sessionParams":[{"encrypted":true}]}');
    expect(payload.length).toBe(38); // padded to 48 by the CBC layer
    expect(Buffer.from(xxtea128CbcEncrypt(KEY, payload, IV)).toString("hex")).toBe(
      "815611a1b2261ad855eaa1c4ef35d9c50a97a0edf459e0a96fb65a2ae1d3702f3a" +
        "08326292ce12c49f1b2806659cf5af",
    );
  });
});

describe("xxtea128CbcDecrypt", () => {
  it("round-trips the LOGIN2 payload", () => {
    const payload = new TextEncoder().encode('{"sessionParams":[{"encrypted":true}]}');
    const ct = xxtea128CbcEncrypt(KEY, payload, IV);
    const back = xxtea128CbcDecrypt(KEY, ct, IV);
    expect(Buffer.from(back.subarray(0, payload.length))).toEqual(Buffer.from(payload));
    expect(back.subarray(payload.length)).toEqual(new Uint8Array(48 - payload.length));
  });

  it("rejects input that is not a multiple of 16 bytes", () => {
    expect(() => xxtea128CbcDecrypt(KEY, new Uint8Array(10), IV)).toThrow(/multiple of 16/);
  });
});
