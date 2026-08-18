import { describe, expect, it } from "vitest";
import {
  bigIntToBytesBE,
  bytesToBigIntBE,
  ClientLogin,
  deriveSessionMaterial,
  DH_P,
  incrementIv,
  Keystream,
  modPow,
} from "./dh";

/**
 * Vectors computed with temp/maps-cloud/sonda_maps.py (IboxLogin, live-validated
 * against two 700 Series gateways — PROTOCOL.md §8/§11).
 *
 * For the ClientLogin end-to-end vector the sonda was run with fixed
 * "randomness": x = bytes 00..3F, a = bytes 40..7F (client) and b = bytes
 * 80..BF (server), all interpreted little-endian as the sonda does, password
 * "admin".
 */

function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** Deterministic RandomSource: serves the queued 64-byte chunks in order. */
function fixedRandom(chunks: Uint8Array[]): (n: number) => Uint8Array {
  let i = 0;
  return (n) => {
    const next = chunks[i++];
    if (!next || next.length !== n) throw new Error("unexpected random request");
    return next;
  };
}

const X_BYTES = Uint8Array.from({ length: 64 }, (_, i) => i);
const A_BYTES = Uint8Array.from({ length: 64 }, (_, i) => i + 64);

describe("bigIntToBytesBE", () => {
  it("serializes DH_P as 65 bytes with the leading sign byte (capture §7.1)", () => {
    const bytes = bigIntToBytesBE(DH_P);
    expect(bytes.length).toBe(65);
    expect(bytes[0]).toBe(0);
    expect(bytesToBigIntBE(bytes)).toBe(DH_P);
  });

  it("pads with 0x00 when the top bit is set (sonda to_be)", () => {
    expect(Array.from(bigIntToBytesBE(0x80n))).toEqual([0, 0x80]);
    expect(Array.from(bigIntToBytesBE(0x7fffn))).toEqual([0x7f, 0xff]);
  });

  it("round-trips values", () => {
    expect(bytesToBigIntBE(bigIntToBytesBE(0n))).toBe(0n);
    expect(bytesToBigIntBE(bigIntToBytesBE(12345678901234567890n))).toBe(12345678901234567890n);
  });
});

describe("modPow", () => {
  it("computes the textbook example", () => {
    expect(modPow(4n, 13n, 497n)).toBe(445n);
  });
});

describe("deriveSessionMaterial", () => {
  // K = bytes 01..40 (64 B), password "admin" — reference vector from sonda_maps.py.
  const K = Uint8Array.from({ length: 64 }, (_, i) => i + 1);

  it("derives the session key with the asymmetric SHA1 folding", () => {
    const m = deriveSessionMaterial("admin", K);
    expect(Buffer.from(m.key).toString("hex")).toBe("4ee56bf5ccc5ae069facfc56b80e5a8d");
  });

  it("splits K into IV_TX/IV_RX and starts counters at IV[0]", () => {
    const m = deriveSessionMaterial("admin", K);
    expect(Buffer.from(m.ivTx).toString("hex")).toBe("0102030405060708090a0b0c0d0e0f10");
    expect(Buffer.from(m.ivRx).toString("hex")).toBe("1112131415161718191a1b1c1d1e1f20");
    expect(m.counterTx).toBe(1);
    expect(m.counterRx).toBe(17);
  });

  it("rejects a shared secret shorter than 32 bytes", () => {
    expect(() => deriveSessionMaterial("admin", new Uint8Array(16))).toThrow(/too short/);
  });
});

describe("Keystream", () => {
  // Reference vectors from sonda_maps.py with K = 01..40, password "admin".
  const material = () =>
    deriveSessionMaterial("admin", Uint8Array.from({ length: 64 }, (_, i) => i + 1));

  it("generates the reference TX block 0 (LOGIN2 IV already incremented)", () => {
    const m = material();
    const ks = new Keystream(m.key, incrementIv(m.ivTx), m.counterTx);
    expect(Buffer.from(ks.apply(new Uint8Array(32))).toString("hex")).toBe(
      "054165bbc9f211ffbc8ea617c74eee6e2920682aa314a5fbc14ad259329a3bab",
    );
  });

  it("generates the reference RX block 0 (original IV_RX)", () => {
    const m = material();
    const ks = new Keystream(m.key, m.ivRx, m.counterRx);
    expect(Buffer.from(ks.apply(new Uint8Array(32))).toString("hex")).toBe(
      "82914d617a791d4db898854e15137a59c8b05a7cf4de84d825e24b334aab4659",
    );
  });

  it("continues seamlessly across the 128-byte block boundary", () => {
    const m = material();
    const whole = new Keystream(m.key, incrementIv(m.ivTx), m.counterTx).apply(
      new Uint8Array(300),
    );
    const chunked = new Keystream(m.key, incrementIv(m.ivTx), m.counterTx);
    const part1 = chunked.apply(new Uint8Array(100));
    const part2 = chunked.apply(new Uint8Array(200));
    expect(Buffer.concat([Buffer.from(part1), Buffer.from(part2)])).toEqual(Buffer.from(whole));
  });
});

describe("ClientLogin (end-to-end vector from sonda_maps.py)", () => {
  it("reproduces LOGIN0/LOGIN1/LOGIN2 and the session streams", () => {
    const login = new ClientLogin("admin", fixedRandom([X_BYTES, A_BYTES]));

    expect(login.getLogin0()).toBe(
      "LTSTQ0IVI2nUzkmAkWm7BYEMuhJdIXDz0YaBrcFzTI77OPoTJgUjhkT/H29g91nmHiP8tSDDkuVBRgtJyhEMfw==;" +
        "AIgDBCj+xTivueDaSIRmKQGn+uIGWw723JzP7WR8RSI7H8BUJawsb3Ba6giI8HlV8pDhA06gdriBRtnGFWedl6E=;" +
        "AsAqmH4sHFYvKZr77u0MLPvK1iy9jv0jKCGzjFNhhRRJVRNDJLIxQkDETRR9QXAEBMfDUvwW8/qLlS79sqOyPA==",
    );

    // Server semi-key with b = bytes 80..BF.
    login.processLogin1("AIRJanDJ4aTgWerIX2pi+I/f1Wn8XM83LTtk6fIw7bNWTDsu/zXE1G1LiFZR/leH3fTZXQ3xZeBWc6Sxxr+PfZk=");

    expect(login.getLogin2()).toBe("PX6Ch7Jlbem76l2w/PnFex8/nyd7RD8LFi/Jkm7D9J+gn/ZkGXusQCTKe8HpgKxH");

    // Client TX: "INFO?\r\n" through the TX keystream.
    expect(
      Buffer.from(login.encryptTx(new TextEncoder().encode("INFO?\r\n"))).toString("hex"),
    ).toBe("378162f003a174");

    // Client RX: the device's "SKT0 - OK\r\n" and the INFO? reply arrive
    // encrypted with the RX keystream, consumed in order.
    const ack = login.decryptRx(fromHex("5d4e085d998325472d94cf"));
    expect(new TextDecoder().decode(ack)).toBe("SKT0 - OK\r\n");
    const info = login.decryptRx(
      fromHex(
        "ce52f4604164a1a4bed4349d8335d4657b70600536f2ab4a007e294d50498df7421782f3c5896910fc6cdb085c65",
      ),
    );
    expect(new TextDecoder().decode(info)).toBe(
      "INFO:GWNAME:TEST-GW\r\nINFO:APPID:78\r\nINFO:END\r\n",
    );
  });

  it("rejects a malformed LOGIN1", () => {
    const login = new ClientLogin("admin", fixedRandom([X_BYTES, A_BYTES]));
    login.getLogin0();
    expect(() => login.processLogin1("%%%not-base64%%%")).toThrow(/Base64/);
  });

  it("requires LOGIN1 before LOGIN2", () => {
    const login = new ClientLogin("admin", fixedRandom([X_BYTES, A_BYTES]));
    login.getLogin0();
    expect(() => login.getLogin2()).toThrow(/LOGIN1/);
  });
});
