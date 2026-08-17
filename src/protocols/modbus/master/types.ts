/**
 * Modbus Master enums and constants, mirroring the desktop MAPS encodings
 * (ModbusFunction.cs, MbmObjectType.cs, IntesisMb.cs byte orders) and the
 * IN-KNX-MBM manual UI ranges.
 */

/** `<Media>` value: connection type. */
export const MEDIA = { RTU: 0, TCP: 1, BOTH: 2 } as const;
export type Media = (typeof MEDIA)[keyof typeof MEDIA];

/** Read functions 1–4, write functions 5/6/15/16; -1 = no function. */
export const NO_FUNCTION = -1;
export const READ_COILS = 1;
export const READ_DISCRETE_INPUTS = 2;
export const READ_HOLDING_REGISTERS = 3;
export const READ_INPUT_REGISTERS = 4;
export const WRITE_SINGLE_COIL = 5;
export const WRITE_SINGLE_REGISTER = 6;
export const WRITE_MULTIPLE_COILS = 15;
export const WRITE_MULTIPLE_REGISTERS = 16;

export const READ_FUNCTIONS = [1, 2, 3, 4] as const;
export const WRITE_FUNCTIONS = [5, 6, 15, 16] as const;
export type ModbusFunction = -1 | 1 | 2 | 3 | 4 | 5 | 6 | 15 | 16;

export function isReadFunction(fn: number): fn is 1 | 2 | 3 | 4 {
  return fn >= 1 && fn <= 4;
}
export function isWriteFunction(fn: number): boolean {
  return fn === 5 || fn === 6 || fn === 15 || fn === 16;
}
/** Coil/discrete (bit) functions vs register functions. */
export function isBitFunction(fn: number): boolean {
  return fn === 1 || fn === 2 || fn === 5 || fn === 15;
}

/** `<Format>` values (MbmObjectType). */
export const FORMATS = {
  NO_FORMAT: -1,
  UNSIGNED: 0,
  SIGNED_C2: 1,
  SIGNED_C1: 2,
  FLOAT: 3,
  BITFIELDS: 4,
  STRING: 5,
} as const;
export type MbmFormat = (typeof FORMATS)[keyof typeof FORMATS];

export const FORMAT_LABELS: Record<number, string> = {
  [-1]: "—",
  0: "Unsigned",
  1: "Signed C2",
  2: "Signed C1",
  3: "Float",
  4: "BitFields",
  5: "String",
};

/** `<ByteOrder>` values. */
export const BYTE_ORDERS = {
  NONE: -1,
  BIG_ENDIAN: 0,
  LITTLE_ENDIAN: 1,
  WORD_INV_BE: 2,
  WORD_INV_LE: 3,
} as const;
export type ByteOrder = (typeof BYTE_ORDERS)[keyof typeof BYTE_ORDERS];

export const BYTE_ORDER_LABELS: Record<number, string> = {
  [-1]: "—",
  0: "Big Endian",
  1: "Little Endian",
  2: "Word Inv BE",
  3: "Word Inv LE",
};

/** Allowed `<LenBits>` values (grid check in ExternalMbm). */
export const LEN_BITS = [1, 16, 32, 48, 64] as const;

export const MAX_ADDRESS = 65535;
export const BAUD_RATES = [1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200] as const;

/** Parity: 0 = None (8N1), 1 = Odd (8O1), 2 = Even (8E1). 8N2 = parity 0 + stop bits 2. */
export const PARITY = { NONE: 0, ODD: 1, EVEN: 2 } as const;

export const SLAVE_RANGE_RTU = { min: 1, max: 254 } as const;
export const SLAVE_RANGE_TCP = { min: 0, max: 255 } as const;
export const DEVICE_TIMEOUT_RANGE = { min: 100, max: 30000, default: 1000 } as const;

export const MAX_RTU_NODES = 2;
export const MAX_TCP_NODES = 5;
