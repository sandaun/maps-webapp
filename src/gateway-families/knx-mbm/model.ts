import type { KnxFlags } from "@/protocols/knx";
import type { MbmConfig } from "@/protocols/modbus/master";

/**
 * KNX ↔ Modbus Master project model. Built from an .ibmaps XmlDocument by
 * `from-xml.ts`; edits are applied as patches on the XmlDocument by
 * `xml-ops.ts` (never the other way around).
 *
 * Security note: the `<IBOX Pwd>` attribute is deliberately NOT part of this
 * model — the gateway password must never reach the browser.
 */

export interface KnxEndpoint {
  dpt: number;
  /** Numeric group address (sending). */
  groupAddress: number;
  /** Additional (listening) group addresses. */
  additionalAddresses: number[];
  flags: KnxFlags;
  priority: number;
}

export interface MbmEndpoint {
  /** Node index: RTU nodes first, then TCP. -1 = unset. */
  port: number;
  /** Device index within the node. -1 = broadcast. */
  deviceIndex: number;
  isBroadcast: boolean;
  readFunc: number;
  writeFunc: number;
  lenBits: number;
  format: number;
  byteOrder: number;
  bit: number;
  numOfBits: number;
  address: number;
}

export interface KnxMbmSignal {
  /** `ID` attribute / idxConfig (0-based). */
  id: number;
  active: boolean;
  description: string;
  knx: KnxEndpoint;
  modbus: MbmEndpoint;
  /** Conversion refs, raw `idx,inverted;…` form (operations / filters). */
  idxOperations: string;
  idxFilters: string;
  virtual: boolean;
}

export interface KnxConfig {
  /** 16-bit physical address (e.g. 15.15.255 → 65535). */
  physicalAddress: number;
  extendedAddresses: boolean;
  keys: [string, string, string];
}

export interface GatewayInfo {
  name: string;
  ip: string;
  netmask: string;
  gateway: string;
  dhcp: boolean;
}

export interface Conversion {
  id: number;
  description: string;
  /** 0 FILTER, 1 SCALE, 2 ARITH, 3 LOGICAL, 4 LUT_REMAP. */
  type: number;
  params: [string, string, string, string];
}

export interface KnxMbmProject {
  name: string;
  description: string;
  gateway: GatewayInfo;
  knx: KnxConfig;
  mbm: MbmConfig;
  signals: KnxMbmSignal[];
  conversions: Conversion[];
}
