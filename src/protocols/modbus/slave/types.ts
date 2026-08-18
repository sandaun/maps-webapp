/**
 * Modbus Slave (server) enums and constants, mirroring the desktop MAPS
 * encodings: MbsAddressMode.cs, MbsReadWrite.cs, SlaveAddressMode.cs,
 * MbsTempSetpoint.cs. Shared encodings (Media, Format=MbmObjectType,
 * ByteOrder, parity) are re-exported from the master module — same enums.
 */

export { MEDIA, FORMATS, PARITY, BAUD_RATES, MAX_ADDRESS } from "../master/types";
export type { Media, MbmFormat, ByteOrder } from "../master/types";

/** `<AddressMode>` value (MbsAddressMode). */
export const ADDRESS_MODES = { FIXED: 0, CUSTOM: 1, V4_COMP: 2 } as const;
export type MbsAddressMode = (typeof ADDRESS_MODES)[keyof typeof ADDRESS_MODES];

/**
 * `<ReadWrite>` value (MbsReadWrite). TRIGGER is a one-shot write action
 * ("reset errors", "set all On"…) that has no Modbus Master equivalent.
 */
export const READ_WRITE = { READ: 0, TRIGGER: 1, READWRITE: 2 } as const;
export type MbsReadWrite = (typeof READ_WRITE)[keyof typeof READ_WRITE];

/** `<SlaveAddressMode>` value (SlaveAddressMode). */
export const SLAVE_ADDRESS_MODES = { SINGLE: 0, MULTIPLE: 1 } as const;
export type SlaveAddressMode = (typeof SLAVE_ADDRESS_MODES)[keyof typeof SLAVE_ADDRESS_MODES];

/** `<TempSetpoint>` value (MbsTempSetpoint): setpoint registers ×1 or ×10. */
export const TEMP_SETPOINT = { X1: 0, X10: 1 } as const;
export type MbsTempSetpoint = (typeof TEMP_SETPOINT)[keyof typeof TEMP_SETPOINT];

/** RTU slave id range for the gateway as a server. */
export const SLAVE_ID_RANGE = { min: 1, max: 247 } as const;

/** Communication error timeout, seconds (written to XBL as ms, u32 BE). */
export const COMM_ERROR_TOUT_RANGE = { min: 0, max: 3600, default: 180 } as const;

export const TCP_PORT_DEFAULT = 502;
export const TCP_KEEPALIVE_DEFAULT = 10;
