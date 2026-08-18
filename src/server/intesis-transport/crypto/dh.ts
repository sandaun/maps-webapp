import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { xxtea128CbcEncrypt } from "./xxtea";

/**
 * Diffie-Hellman login + session stream cipher for the Intesis MAPS protocol.
 * Port of `IboxLogin.cs` / `DiffieHellman.cs` (temp/maps-cloud/maps-poc/
 * decompiled/IntesisComm/IntesisComm.Encrypt/) cross-checked against the live-
 * validated Python probe `sonda_maps.py` (PROTOCOL.md §3, §8).
 *
 * - DH with a hardcoded 512-bit `p` (weak, but it is what the firmware runs).
 * - Session key = SHA1(password) folded at offsets 0/4/8/12 XOR SHA1(K) folded
 *   at offsets 1/5/9/13 (16 bytes).
 * - IV_TX = K[0..15], IV_RX = K[16..31]; counters start at IV[0].
 * - Stream cipher: XXTEA-128-CBC keystream over counter bytes, 128-byte blocks,
 *   IV evolves via `iv[0]++` + MD5 after each block.
 *
 * The password is used only to derive the in-memory session key — it is never
 * logged, persisted, or included in errors.
 */

/** DH prime (512 bits) and subgroup order — constants from DiffieHellman.cs. */
export const DH_P = BigInt(
  "712351504816819712763536862254468349210290076447032018845914849373202182997965" +
    "7437039135107964439395762557737743939212301712717518469918392749868774692769",
);
export const DH_Q = BigInt(
  "76254017495901138735256517787969176943792741176844937633189239928898960209079",
);

const KEYSTREAM_BLOCK = 128;

export function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  let result = 1n;
  let b = base % mod;
  let e = exp;
  while (e > 0n) {
    if (e & 1n) result = (result * b) % mod;
    b = (b * b) % mod;
    e >>= 1n;
  }
  return result;
}

/**
 * Minimal big-endian serialization with a leading 0x00 when the top bit is
 * set — mirrors .NET `BigInteger.ToByteArray()` (little-endian, sign byte)
 * reversed, as done in `IboxLogin.getLOGIN0` / sonda's `to_be`.
 */
export function bigIntToBytesBE(value: bigint): Uint8Array {
  if (value < 0n) throw new Error("Only non-negative integers are supported");
  let hex = value.toString(16);
  if (hex.length % 2 !== 0) hex = "0" + hex;
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  if (bytes.length > 0 && bytes[0] & 0x80) {
    const padded = new Uint8Array(bytes.length + 1);
    padded.set(bytes, 1);
    return padded;
  }
  return bytes;
}

export function bytesToBigIntBE(bytes: Uint8Array): bigint {
  let v = 0n;
  for (const b of bytes) v = (v << 8n) | BigInt(b);
  return v;
}

function sha1(data: Uint8Array): Uint8Array {
  return new Uint8Array(createHash("sha1").update(data).digest());
}

function md5(data: Uint8Array): Uint8Array {
  return new Uint8Array(createHash("md5").update(data).digest());
}

/** IV evolution after each use: `iv[0]++` then `iv = MD5(iv)` (IboxLogin.incrementIV). */
export function incrementIv(iv: Uint8Array): Uint8Array {
  const next = new Uint8Array(iv);
  next[0] = (next[0] + 1) & 0xff;
  return md5(next);
}

export interface SessionMaterial {
  /** 16-byte XXTEA session key. */
  key: Uint8Array;
  ivTx: Uint8Array;
  ivRx: Uint8Array;
  counterTx: number;
  counterRx: number;
}

/**
 * Derives the session key and IVs from the shared secret K (big-endian bytes,
 * after the sonda's sign-byte edge case) and the device password.
 * Port of `IboxLogin.processLOGIN1`.
 */
export function deriveSessionMaterial(password: string, kBytes: Uint8Array): SessionMaterial {
  if (kBytes.length < 32) {
    // Practically impossible with a 512-bit p, but the C# code would throw too.
    throw new Error(`DH shared secret too short: ${kBytes.length} bytes`);
  }
  const hPwd = sha1(new TextEncoder().encode(password)); // ASCII per C# (password charset)
  hPwd[0] ^= hPwd[16];
  hPwd[4] ^= hPwd[17];
  hPwd[8] ^= hPwd[18];
  hPwd[12] ^= hPwd[19];
  const hK = sha1(kBytes);
  hK[1] ^= hK[16];
  hK[5] ^= hK[17];
  hK[9] ^= hK[18];
  hK[13] ^= hK[19];
  const key = new Uint8Array(16);
  for (let i = 0; i < 16; i++) key[i] = hPwd[i] ^ hK[i];
  const ivTx = new Uint8Array(kBytes.subarray(0, 16));
  const ivRx = new Uint8Array(kBytes.subarray(16, 32));
  return { key, ivTx, ivRx, counterTx: ivTx[0], counterRx: ivRx[0] };
}

/**
 * TX or RX keystream (IboxLogin.prepareCyphStream + encryptTx/decryptRx).
 * Each 128-byte block encrypts the counter bytes with XXTEA-128-CBC under the
 * current IV, then the IV evolves (incrementIv) and the counter advances by
 * 128 mod 256.
 */
export class Keystream {
  private block: Uint8Array = new Uint8Array(0);
  private used = 0;

  constructor(
    private readonly key: Uint8Array,
    private iv: Uint8Array,
    private counter: number,
  ) {}

  private nextBlock(): void {
    const plain = new Uint8Array(KEYSTREAM_BLOCK);
    for (let i = 0; i < KEYSTREAM_BLOCK; i++) plain[i] = (this.counter + i) & 0xff;
    this.block = xxtea128CbcEncrypt(this.key, plain, this.iv);
    this.iv = incrementIv(this.iv);
    this.counter = (this.counter + KEYSTREAM_BLOCK) & 0xff;
    this.used = 0;
  }

  /** XORs `data` with the keystream (symmetric: encrypt and decrypt). */
  apply(data: Uint8Array): Uint8Array {
    const out = new Uint8Array(data.length);
    for (let i = 0; i < data.length; i++) {
      if (this.used === this.block.length) this.nextBlock();
      out[i] = data[i] ^ this.block[this.used++];
    }
    return out;
  }
}

export type RandomSource = (numBytes: number) => Uint8Array;

/**
 * Client side of the LOGIN0/LOGIN1/LOGIN2 handshake (sonda's `IboxLogin`).
 * After `getLogin2()`, `encryptTx`/`decryptRx` apply the session stream cipher.
 */
export class ClientLogin {
  private a = 0n;
  private g = 0n;
  private material: SessionMaterial | undefined;
  private tx: Keystream | undefined;
  private rx: Keystream | undefined;

  constructor(
    private readonly password: string,
    private readonly random: RandomSource = (n) => new Uint8Array(randomBytes(n)),
  ) {}

  /** `g` in the subgroup of order q (sonda: reject g == 1). */
  private generateGenerator(): bigint {
    const exponent = (DH_P - 1n) / DH_Q;
    for (;;) {
      const x = bytesToBigIntLE(this.random(64));
      const g = modPow(x, exponent, DH_P);
      if (g !== 1n) return g;
    }
  }

  /** Returns the three Base64 fields of LOGIN0: `b64(g);b64(p);b64(g^a mod p)`. */
  getLogin0(): string {
    this.g = this.generateGenerator();
    this.a = bytesToBigIntLE(this.random(64));
    const pubA = modPow(this.g, this.a, DH_P);
    return [this.g, DH_P, pubA].map((v) => toBase64(bigIntToBytesBE(v))).join(";");
  }

  /**
   * Processes the device LOGIN1 semi-key and derives the session material.
   * Throws on malformed Base64 (sonda returns -1).
   */
  processLogin1(login1Base64: string): void {
    const raw = fromBase64(login1Base64.trim());
    const pubB = bytesToBigIntBE(raw);
    const k = modPow(pubB, this.a, DH_P);
    let kb = bigIntToBytesBE(k);
    // Sign-byte edge case (sonda_maps.py / IboxLogin.processLOGIN1).
    if (kb.length > 1 && kb[0] === 0 && kb[1] >= 128) kb = kb.subarray(1);
    this.material = deriveSessionMaterial(this.password, kb);
  }

  /**
   * LOGIN2 payload: Base64 of XXTEA-128-CBC(sessionKey, json, IV_TX).
   * Critical order (PROTOCOL.md §3.1.4): encrypt with the ORIGINAL IV_TX, then
   * increment IV_TX, then prepare both keystreams.
   */
  getLogin2(): string {
    const m = this.requireMaterial();
    const payload = new TextEncoder().encode('{"sessionParams":[{"encrypted":true}]}');
    const ct = xxtea128CbcEncrypt(m.key, payload, m.ivTx);
    const ivTx = incrementIv(m.ivTx);
    this.tx = new Keystream(m.key, ivTx, m.counterTx);
    this.rx = new Keystream(m.key, new Uint8Array(m.ivRx), m.counterRx);
    return toBase64(ct);
  }

  encryptTx(data: Uint8Array): Uint8Array {
    if (!this.tx) throw new Error("Session cipher not ready (LOGIN2 not sent)");
    return this.tx.apply(data);
  }

  decryptRx(data: Uint8Array): Uint8Array {
    if (!this.rx) throw new Error("Session cipher not ready (LOGIN2 not sent)");
    return this.rx.apply(data);
  }

  private requireMaterial(): SessionMaterial {
    if (!this.material) throw new Error("LOGIN1 not processed yet");
    return this.material;
  }
}

function bytesToBigIntLE(bytes: Uint8Array): bigint {
  let v = 0n;
  for (let i = bytes.length - 1; i >= 0; i--) v = (v << 8n) | BigInt(bytes[i]);
  return v;
}

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

function fromBase64(text: string): Uint8Array {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(text)) throw new Error("LOGIN1 is not valid Base64");
  return new Uint8Array(Buffer.from(text, "base64"));
}
