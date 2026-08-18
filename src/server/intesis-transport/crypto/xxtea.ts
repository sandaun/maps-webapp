import "server-only";

/**
 * XXTEA-128 in CBC mode, big-endian 32-bit words, 16-byte block, 128-bit key.
 * Port of `XxTea.cs` (temp/maps-cloud/maps-poc/decompiled/IntesisComm/
 * IntesisComm.Encrypt/XxTea.cs), cross-checked against the Python port in
 * `sonda_maps.py`. CBC padding: zeros up to a multiple of 16 bytes (PROTOCOL.md
 * §5.2). All arithmetic is uint32 with wraparound, as in the C# original.
 */

const DELTA = 0x9e3779b9;
const BLOCK = 16;

function mx(sum: number, y: number, z: number, p: number, e: number, k: Uint32Array): number {
  const a = (((z >>> 5) ^ (y << 2)) >>> 0) + (((y >>> 3) ^ (z << 4)) >>> 0);
  const b = ((sum ^ y) >>> 0) + ((k[(p & 3) ^ e] ^ z) >>> 0);
  return ((a >>> 0) ^ (b >>> 0)) >>> 0;
}

/** In-place XXTEA round over `n` words (`n > 1` encrypt, `n < -1` decrypt). */
function btea(v: Uint32Array, n: number, key: Uint32Array): void {
  if (n > 1) {
    let rounds = 6 + Math.floor(52 / n);
    let sum = 0;
    let z = v[n - 1];
    do {
      sum = (sum + DELTA) >>> 0;
      const e = (sum >>> 2) & 3;
      let p = 0;
      for (; p < n - 1; p++) {
        const y = v[p + 1];
        v[p] = (v[p] + mx(sum, y, z, p, e, key)) >>> 0;
        z = v[p];
      }
      const y = v[0];
      v[n - 1] = (v[n - 1] + mx(sum, y, z, p, e, key)) >>> 0;
      z = v[n - 1];
    } while (--rounds !== 0);
    return;
  }
  n = -n;
  const rounds = 6 + Math.floor(52 / n);
  let sum = (rounds * DELTA) >>> 0;
  let y = v[0];
  do {
    const e = (sum >>> 2) & 3;
    let z: number;
    for (let p = n - 1; p > 0; p--) {
      z = v[p - 1];
      v[p] = (v[p] - mx(sum, y, z, p, e, key)) >>> 0;
      y = v[p];
    }
    z = v[n - 1];
    v[0] = (v[0] - mx(sum, y, z, 0, e, key)) >>> 0;
    y = v[0];
    sum = (sum - DELTA) >>> 0;
  } while (sum !== 0);
}

function bytesToWords(data: Uint8Array, offset: number): Uint32Array {
  const words = new Uint32Array(4);
  for (let w = 0; w < 4; w++) {
    const i = offset + w * 4;
    words[w] = ((data[i] << 24) | (data[i + 1] << 16) | (data[i + 2] << 8) | data[i + 3]) >>> 0;
  }
  return words;
}

function wordsToBytes(words: Uint32Array, out: Uint8Array, offset: number): void {
  for (let w = 0; w < 4; w++) {
    const i = offset + w * 4;
    out[i] = (words[w] >>> 24) & 0xff;
    out[i + 1] = (words[w] >>> 16) & 0xff;
    out[i + 2] = (words[w] >>> 8) & 0xff;
    out[i + 3] = words[w] & 0xff;
  }
}

export function xxtea128EncryptBlock(key: Uint8Array, block: Uint8Array): Uint8Array {
  const v = bytesToWords(block, 0);
  btea(v, 4, bytesToWords(key, 0));
  const out = new Uint8Array(BLOCK);
  wordsToBytes(v, out, 0);
  return out;
}

export function xxtea128DecryptBlock(key: Uint8Array, block: Uint8Array): Uint8Array {
  const v = bytesToWords(block, 0);
  btea(v, -4, bytesToWords(key, 0));
  const out = new Uint8Array(BLOCK);
  wordsToBytes(v, out, 0);
  return out;
}

/**
 * CBC encrypt with zero padding to a multiple of 16 bytes (as in
 * `XxTea.xxtea128EncryptCBC`: the buffer is extended with zeros).
 */
export function xxtea128CbcEncrypt(key: Uint8Array, data: Uint8Array, iv: Uint8Array): Uint8Array {
  const outLen = Math.floor(data.length / BLOCK) * BLOCK + (data.length % BLOCK !== 0 ? BLOCK : 0);
  const out = new Uint8Array(outLen);
  const prev = new Uint8Array(iv.subarray(0, BLOCK));
  const k = bytesToWords(key, 0);
  for (let i = 0; i < outLen; i += BLOCK) {
    const padded = new Uint8Array(BLOCK);
    padded.set(data.subarray(i, Math.min(i + BLOCK, data.length)));
    const words = bytesToWords(padded, 0);
    const prevWords = bytesToWords(prev, 0);
    for (let w = 0; w < 4; w++) words[w] = (words[w] ^ prevWords[w]) >>> 0;
    btea(words, 4, k);
    wordsToBytes(words, out, i);
    prev.set(out.subarray(i, i + BLOCK));
  }
  return out;
}

/** CBC decrypt; `data.length` must already be a multiple of 16. */
export function xxtea128CbcDecrypt(key: Uint8Array, data: Uint8Array, iv: Uint8Array): Uint8Array {
  if (data.length % BLOCK !== 0) {
    throw new Error(`XXTEA-CBC decrypt requires a multiple of 16 bytes, got ${data.length}`);
  }
  const out = new Uint8Array(data.length);
  const prev = new Uint8Array(iv.subarray(0, BLOCK));
  const k = bytesToWords(key, 0);
  for (let i = 0; i < data.length; i += BLOCK) {
    const block = data.subarray(i, i + BLOCK);
    const words = bytesToWords(block, 0);
    btea(words, -4, k);
    const plain = new Uint8Array(BLOCK);
    wordsToBytes(words, plain, 0);
    for (let b = 0; b < BLOCK; b++) plain[b] ^= prev[b];
    out.set(plain, i);
    prev.set(block);
  }
  return out;
}
