import type { SignalConversionRefs } from "@/core/signals/conversion-refs";
import type { KnxConfig, KnxEndpoint } from "@/protocols/knx";
import type { MbsConfig, MbsEndpoint } from "@/protocols/modbus/slave";

/**
 * KNX ↔ Modbus Slave project model (`IntesisProjectMBSKNX_RT`, IN701KNX,
 * AppId 7): Modbus Slave is the internal (BMS) side, KNX the external one.
 * Built from an .ibmaps XmlDocument by `from-xml.ts`; edits are applied as
 * patches on the XmlDocument by `xml-ops.ts` (never the other way around).
 * See docs/reference/mbs-knx-analisi.md.
 *
 * Security note: the `<IBOX Pwd>` attribute is deliberately NOT part of this
 * model — the gateway password must never reach the browser.
 */

export interface MbsKnxSignal {
  /** `ID` attribute / idxConfig (0-based). */
  id: number;
  /** The Modbus side's `isEnabled`: MAPS always writes the KNX `Active` as True. */
  active: boolean;
  /** The Modbus side's `Description` (the one the signals grid shows). */
  description: string;
  modbus: MbsEndpoint;
  knx: KnxEndpoint;
  /** Conversion refs per half: internal = Modbus signal, external = KNX object. */
  conversions: SignalConversionRefs;
  virtual: boolean;
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

export interface MbsKnxProject {
  name: string;
  description: string;
  gateway: GatewayInfo;
  mbs: MbsConfig;
  knx: KnxConfig;
  signals: MbsKnxSignal[];
  conversions: Conversion[];
}
