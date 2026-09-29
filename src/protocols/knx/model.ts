import { DEFAULT_FLAGS, type KnxFlags } from "./flags";

/**
 * KNX side of a signal row and the KNX protocol settings, as the webapp
 * models them. Shared by every family with a KNX side (KNX–MBM, MBS–KNX);
 * the XML reading/patching lives in `./xml.ts`.
 */

export interface KnxEndpoint {
  dpt: number;
  /** Numeric group address (sending). */
  groupAddress: number;
  /** XML display format when it differs from the default three levels. */
  groupAddressLevel?: 1 | 2 | 3;
  /** Additional (listening) group addresses. */
  additionalAddresses: number[];
  /** Display level of each additional address, aligned with additionalAddresses. */
  additionalAddressLevels?: (1 | 2 | 3)[];
  flags: KnxFlags;
  priority: number;
}

export interface KnxConfig {
  /** 16-bit physical address (e.g. 15.15.255 → 65535). */
  physicalAddress: number;
  extendedAddresses: boolean;
  keys: [string, string, string];
}

export function defaultKnxEndpoint(): KnxEndpoint {
  return { dpt: 0, groupAddress: 0, additionalAddresses: [], flags: { ...DEFAULT_FLAGS }, priority: 3 };
}
