import { crc32 } from "./crc32";

/**
 * "Complete" project blob exchanged with the gateway via RECVCMPLT/SENDCMPLT:
 *
 *   [4 bytes BE: XBL length n][n bytes XBL][4 bytes BE: CRC32(XBL)][ZIP]
 *
 * The ZIP contains a single `<name>.ibmaps` XML file (UTF-8).
 */
export interface CompleteBlob {
  xbl: Uint8Array;
  zip: Uint8Array;
}

const ZIP_MAGIC_0 = 0x50; // 'P'
const ZIP_MAGIC_1 = 0x4b; // 'K'

export function parseCompleteBlob(data: Uint8Array): CompleteBlob {
  if (data.length < 8) {
    throw new Error(`Complete blob too short: ${data.length} bytes`);
  }
  const xblLength = new DataView(data.buffer, data.byteOffset, 4).getUint32(0, false);
  const expectedTotal = 4 + xblLength + 4;
  if (data.length < expectedTotal) {
    throw new Error(
      `Complete blob truncated: header says ${xblLength} XBL bytes, have ${data.length} total`,
    );
  }
  const xbl = data.subarray(4, 4 + xblLength);
  const storedCrc = new DataView(data.buffer, data.byteOffset + 4 + xblLength, 4).getUint32(0, false);
  const actualCrc = crc32(xbl);
  if (storedCrc !== actualCrc) {
    throw new Error(
      `Complete blob CRC32 mismatch: stored 0x${storedCrc.toString(16)}, computed 0x${actualCrc.toString(16)}`,
    );
  }
  const zip = data.subarray(expectedTotal);
  if (zip.length < 2 || zip[0] !== ZIP_MAGIC_0 || zip[1] !== ZIP_MAGIC_1) {
    throw new Error("Complete blob does not contain a ZIP after the XBL block");
  }
  return { xbl: new Uint8Array(xbl), zip: new Uint8Array(zip) };
}

export function buildCompleteBlob(xbl: Uint8Array, zip: Uint8Array): Uint8Array {
  const out = new Uint8Array(4 + xbl.length + 4 + zip.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, xbl.length, false);
  out.set(xbl, 4);
  view.setUint32(4 + xbl.length, crc32(xbl), false);
  out.set(zip, 4 + xbl.length + 4);
  return out;
}
