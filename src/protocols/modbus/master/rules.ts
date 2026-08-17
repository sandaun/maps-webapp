import {
  FORMATS,
  isBitFunction,
  isReadFunction,
  isWriteFunction,
  MAX_ADDRESS,
  NO_FUNCTION,
  WRITE_SINGLE_REGISTER,
  WRITE_MULTIPLE_REGISTERS,
} from "./types";

/**
 * Pure Modbus Master signal checks, ported from ExternalMbm.CheckProjectObjects
 * (ExternalMbm.cs:1513-1600). Each returns a stable rule code or null.
 * The family-level validator maps codes to messages and refs.
 */

export interface MbmSignalShape {
  isBroadcast: boolean;
  readFunc: number;
  writeFunc: number;
  lenBits: number;
  format: number;
  byteOrder: number;
  bit: number;
  numOfBits: number;
  address: number;
  /** Register base of the device this signal points to (null = unknown/none). */
  deviceBase: 0 | 1 | null;
}

/** All violated rule codes for one signal (empty = valid). */
export function checkMbmSignal(signal: MbmSignalShape): string[] {
  const violations: string[] = [];
  const { readFunc, writeFunc, lenBits, format, byteOrder, bit, numOfBits, address } = signal;

  if (signal.isBroadcast) {
    if (readFunc !== NO_FUNCTION) violations.push("MB-BROADCAST");
    if (format === FORMATS.BITFIELDS) violations.push("MB-BROADCAST");
  }
  if (readFunc === NO_FUNCTION && writeFunc === NO_FUNCTION) {
    violations.push("MB-FUNC-PAIR");
  }
  // Bit functions can't pair with register functions across read/write.
  if (
    (isReadFunction(readFunc) && isWriteFunction(writeFunc) && isBitFunction(readFunc) !== isBitFunction(writeFunc))
  ) {
    violations.push("MB-FUNC-PAIR");
  }

  if (lenBits === 1) {
    // 1-bit data only with coil/discrete functions.
    if (isReadFunction(readFunc) && !isBitFunction(readFunc)) violations.push("MB-LEN-FORMAT");
    if (isWriteFunction(writeFunc) && !isBitFunction(writeFunc)) violations.push("MB-LEN-FORMAT");
    if (writeFunc === WRITE_MULTIPLE_REGISTERS) violations.push("MB-LEN-FORMAT");
  } else {
    if (format === FORMATS.NO_FORMAT) violations.push("MB-LEN-FORMAT");
    if (byteOrder === -1) violations.push("MB-LEN-FORMAT");
  }

  if (lenBits === 48 && format === FORMATS.FLOAT) violations.push("MB-LEN-FORMAT");
  if (lenBits === 16 && (byteOrder === 2 || byteOrder === 3)) violations.push("MB-LEN-FORMAT");
  if (writeFunc === WRITE_SINGLE_REGISTER && lenBits !== 16 && lenBits !== 1) {
    // FC6 writes a single register; desktop requires LenBits=16 (1 handled by FC5).
    violations.push("MB-LEN-FORMAT");
  }

  if (format === FORMATS.BITFIELDS) {
    if (lenBits > 16) violations.push("MB-BIT-RANGE");
    if (bit >= 0 && bit > lenBits - 1) violations.push("MB-BIT-RANGE");
    if (bit >= 0 && numOfBits > 0 && bit + numOfBits > lenBits) violations.push("MB-BIT-RANGE");
  }

  if (address < 0 || address > MAX_ADDRESS) violations.push("MB-ADDRESS-RANGE");
  if (signal.deviceBase === 1 && address === 0) violations.push("MB-ADDRESS-BASE");

  return violations;
}
