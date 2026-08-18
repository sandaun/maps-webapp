import "server-only";

/**
 * CRC-16/CCITT: polynomial 0x1021, init 0x0000, MSB-first, no reflection.
 * Port of `Crc16.cs` (temp/maps-cloud/maps-poc/decompiled/IntesisComm/
 * IntesisComm.Encrypt/Crc16.cs) — table-driven equivalent of the same table.
 * Used by the XMODEM/XMODEM-1K framing (PROTOCOL.md §4).
 */

const TABLE = (() => {
  const table = new Uint16Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n << 8;
    for (let k = 0; k < 8; k++) {
      c = c & 0x8000 ? ((c << 1) ^ 0x1021) & 0xffff : (c << 1) & 0xffff;
    }
    table[n] = c;
  }
  return table;
})();

export function crc16Ccitt(data: Uint8Array): number {
  let crc = 0;
  for (let i = 0; i < data.length; i++) {
    crc = ((crc << 8) ^ TABLE[((crc >> 8) ^ data[i]) & 0xff]) & 0xffff;
  }
  return crc;
}
