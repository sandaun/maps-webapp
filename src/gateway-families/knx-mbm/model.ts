import type { SignalConversionRefs } from "@/core/signals/conversion-refs";
import type { KnxConfig, KnxEndpoint } from "@/protocols/knx";
import type { MbmConfig } from "@/protocols/modbus/master";

/**
 * KNX ↔ Modbus Master project model. Built from an .ibmaps XmlDocument by
 * `from-xml.ts`; edits are applied as patches on the XmlDocument by
 * `xml-ops.ts` (never the other way around).
 *
 * Security note: the `<IBOX Pwd>` attribute is deliberately NOT part of this
 * model — the gateway password must never reach the browser.
 */

// The KNX side is shared with MBS–KNX; it lives in `src/protocols/knx`.
export type { KnxConfig, KnxEndpoint } from "@/protocols/knx";

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
  /** The signal's own `<Deadband>` (MAPS 1.2.34); undefined when the XML has none. */
  deadband?: number;
}

export interface KnxMbmSignal {
  /** `ID` attribute / idxConfig (0-based). */
  id: number;
  active: boolean;
  description: string;
  knx: KnxEndpoint;
  modbus: MbmEndpoint;
  /** Conversion refs per half: internal = KNX object, external = Modbus signal. */
  conversions: SignalConversionRefs;
  virtual: boolean;
  /** External Modbus object's virtual flag, used by MAPS auto-numbering. */
  modbusVirtual?: boolean;
  /** External Modbus object's fixed flag: a fixed virtual row has no address (`MbmObject.GenerateRow`). */
  modbusFixed?: boolean;
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
