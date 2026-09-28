import type { MbsReadWrite } from "./types";

/**
 * Modbus Slave side of a signal row (`MbsObject`, MbsObject.cs), as the
 * webapp models it. Shared by every family whose BMS side is Modbus Slave;
 * a family may extend it with its own fields.
 */
export interface MbsEndpoint {
  address: number;
  /** 255 = no bit field. */
  bit: number;
  lenBits: number;
  /** MbmObjectType: 0 Unsigned, 1 Signed C2, 2 Signed C1, 3 Float, 4 BitFields, 5 String. */
  format: number;
  readWrite: MbsReadWrite;
  /** -1 = not a string. */
  stringLength: number;
  /** -1 in SINGLE slave mode. */
  slaveIndex: number;
}

export function defaultMbsEndpoint(): MbsEndpoint {
  return { address: 0, bit: 255, lenBits: 16, format: 0, readWrite: 2, stringLength: -1, slaveIndex: -1 };
}
