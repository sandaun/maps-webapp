import type { MeConfig } from "@/protocols/me";
import type { MbsConfig, MbsReadWrite } from "@/protocols/modbus/slave";

/**
 * Mitsubishi Electric AC ↔ Modbus Slave project model (770 Air variant,
 * `IntesisProjectMbsMe_RT`). Built from an .ibmaps XmlDocument by
 * `from-xml.ts`; edits are applied as patches on the XmlDocument by
 * `xml-ops.ts` (never the other way around).
 *
 * Security note: the `<IBOX Pwd>` attribute and the G50 controllers'
 * `AuthUserId`/`AuthPassword` are deliberately NOT part of this model —
 * credentials must never reach the browser.
 */

export interface MeEndpoint {
  /** Controller index (`G50Index`), 0 or 1. */
  g50Index: number;
  /** -1 = controller-general signal. */
  groupIndex: number;
  /** -1 = group/general signal; >= 0 = per-unit signal (UNVERIFIED). */
  unitId: number;
  isIndoor: boolean;
  /** True = status read from the AC bus; false = command. */
  isStatus: boolean;
  /** IntesisMe.SIGNAL_* constant. */
  signalIndex: number;
  /** Spec index: key of the register-address map and spec metadata table. */
  signalSpecIndex: number;
}

export interface MbsEndpoint {
  address: number;
  /** 255 = no bit field. */
  bit: number;
  lenBits: number;
  /** 0 = Unsigned, 1 = Signed C2 (MbmObjectType). */
  format: number;
  readWrite: MbsReadWrite;
  /** -1 = not a string. */
  stringLength: number;
  /** -1 in SINGLE slave mode. */
  slaveIndex: number;
}

export interface MeMbsSignal {
  /** `ID` attribute / idxConfig (0-based). */
  id: number;
  active: boolean;
  description: string;
  me: MeEndpoint;
  modbus: MbsEndpoint;
  /** Conversion refs, raw `idx,inverted;…` form (operations / filters). */
  idxOperations: string;
  idxFilters: string;
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

export interface MeMbsProject {
  name: string;
  description: string;
  gateway: GatewayInfo;
  me: MeConfig;
  mbs: MbsConfig;
  signals: MeMbsSignal[];
  conversions: Conversion[];
}
