/**
 * Protocol-agnostic signal/mapping model shared by gateway families.
 * Family-specific endpoints (KNX group object, Modbus Master register)
 * extend this in `src/protocols/*` and are composed in
 * `src/gateway-families/knx-mbm`.
 */

/** Documented limits for IN-KNX-MBM (700 Series manual). */
export const MAX_ACTIVE_SIGNALS = 3000;
export const MAX_TOTAL_SIGNAL_ROWS = 5000;
export const MAX_BULK_ADD_ROWS = 500;
export const MAX_GATEWAY_NAME_LENGTH = 32;
export const MAX_PROJECT_DESCRIPTION_LENGTH = 255;
export const MAX_SIGNAL_DESCRIPTION_LENGTH = 128;
export const MAX_MODBUS_DEVICES = 254;

export interface SignalMapping<KnxEndpoint = unknown, ModbusEndpoint = unknown> {
  /** 0-based configuration index (`idxConfig` in the .ibmaps). */
  index: number;
  active: boolean;
  description: string;
  knx?: KnxEndpoint;
  modbus?: ModbusEndpoint;
  /** Indices into the project's conversion list, `index,inverted;…` pairs. */
  conversionRefs?: string;
}
