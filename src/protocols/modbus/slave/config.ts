import {
  ADDRESS_MODES,
  COMM_ERROR_TOUT_RANGE,
  SLAVE_ADDRESS_MODES,
  TCP_KEEPALIVE_DEFAULT,
  TCP_PORT_DEFAULT,
  TEMP_SETPOINT,
  type Media,
  type MbsAddressMode,
  type MbsTempSetpoint,
  type SlaveAddressMode,
} from "./types";

/**
 * Modbus Slave (server) configuration. Mirrors InternalMbs
 * (`IntesisBoxMAPS.Protocols.MB.Internal/InternalMbs.cs`, GetXMLProtocol):
 * unlike the master side there are no nodes/devices/function codes — the
 * gateway serves 16-bit holding registers to external Modbus clients.
 */

export interface MbsRtuConfig {
  /** 1 = RTU (connection type as written by the desktop tool). */
  connectionType: number;
  baudrate: number;
  dataBits: number;
  parity: 0 | 1 | 2;
  stopBits: 1 | 2;
  /** RTU slave id the gateway answers as (base of the virtual-slave array). */
  slaveNumber: number;
}

export interface MbsTcpConfig {
  port: number;
  keepAlive: number;
}

/** Entry of `MBSlavesArray` (only meaningful in MULTIPLE mode, but persisted always). */
export interface MbsSlave {
  address: number;
  description: string;
}

export interface MbsConfig {
  media: Media;
  byteOrder: number;
  updateCOV: boolean;
  addressMode: MbsAddressMode;
  tempSetpoint: MbsTempSetpoint;
  formatExtra: number;
  /** Communication error timeout, seconds. */
  commErrorTout: number;
  /** Register base: 0 = 0-based. */
  registerBase: 0 | 1;
  rtu: MbsRtuConfig;
  tcp: MbsTcpConfig;
  temperatureSensorEnabled: boolean;
  slaveAddressMode: SlaveAddressMode;
  slaves: MbsSlave[];
}

export function defaultMbsConfig(): MbsConfig {
  return {
    media: 2, // Both
    byteOrder: 0, // Big Endian
    updateCOV: true,
    addressMode: ADDRESS_MODES.FIXED,
    tempSetpoint: TEMP_SETPOINT.X1,
    formatExtra: 0,
    commErrorTout: COMM_ERROR_TOUT_RANGE.default,
    registerBase: 0,
    rtu: {
      connectionType: 1,
      baudrate: 9600,
      dataBits: 8,
      parity: 0,
      stopBits: 1,
      slaveNumber: 1,
    },
    tcp: { port: TCP_PORT_DEFAULT, keepAlive: TCP_KEEPALIVE_DEFAULT },
    temperatureSensorEnabled: false,
    slaveAddressMode: SLAVE_ADDRESS_MODES.SINGLE,
    slaves: [],
  };
}
