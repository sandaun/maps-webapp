import { ADDRESS_MODES, type MbsAddressMode } from "./types";

/**
 * FIXED/V4_COMP register-address assignment for the ME ↔ Modbus Slave family,
 * ported from `IntesisProjectMbsMe_RT.GetAddressFromSignal`
 * (IntesisProjectMbsMe_RT.cs:2713-2799) and `GetAddressFromSignalV4`
 * (:2802-2870). Verified against the real 770 Air fixture: the FIXED map
 * reproduces 222/222 addresses (docs/ac-me-mbs-analisi.md §5).
 *
 * CUSTOM mode addresses are persisted by the desktop tool (`AddressesStorer`)
 * and are NOT derivable — pass the persisted value as `customAddress`.
 */

export interface SignalLocator {
  g50Index: number;
  /** -1 = controller-general signal. */
  groupIndex: number;
  /** -1 = group signal; >= 0 = per-unit (indoor/outdoor) signal. */
  unitIndex: number;
  signalSpecIndex: number;
}

/**
 * Group-signal offset within the group's 100-register window (FIXED mode).
 * Intentional collisions: spec groups that are mutually exclusive per group
 * type share an offset (1/2/3→1, 4/5→2, 7/8→4, 31/32→27, 33/34→28,
 * 35/36→29, 37/38→30, 39/40→31). -1 = spec never mapped.
 */
const FIXED_GROUP_OFFSETS: Readonly<Record<number, number>> = {
  0: 0,
  1: 1, 2: 1, 3: 1,
  4: 2, 5: 2,
  6: 3,
  7: 4, 8: 4,
  9: 5, 10: 6, 11: 7, 12: 8, 13: 9, 14: 10, 15: 11, 16: 12,
  17: 13, 18: 14, 19: 15, 20: 16, 21: 17, 22: 18, 23: 19,
  24: 20, 25: 21, 26: 22, 27: 23, 28: 24, 29: 25, 30: 26,
  31: 27, 32: 27, 33: 28, 34: 28, 35: 29, 36: 29,
  37: 30, 38: 30, 39: 31, 40: 31,
  41: 32, 42: 33, 43: 34, 44: 35, 45: 36, 46: 37,
  52: 38, 53: 40, 54: 42, 55: 44, 56: 46, 57: 48, 58: 50, 59: 52, 60: 54,
};

/** Same, for the legacy V4 compatibility map (`GetAddressFromSignalV4`). */
const V4_GROUP_OFFSETS: Readonly<Record<number, number>> = {
  0: 1,
  47: 2, 48: 2, 49: 2,
  50: 5, 51: 4,
  7: 3, 8: 3,
  9: 14, 10: 11, 11: 24, 12: 25, 13: 17, 14: 26, 15: 16, 16: 27,
  17: 7, 18: 8, 19: 9, 20: 10, 21: 28, 22: 29, 23: 30,
  24: 31, 25: 32, 26: 33, 27: 34, 28: 35, 29: 36, 30: 37,
  31: 19, 32: 38, 33: 20, 34: 39, 35: 40, 36: 41,
  37: 42, 38: 43, 39: 44, 40: 45,
  41: 46, 42: 47, 43: 48, 44: 49, 45: 12, 46: 15,
  52: 50, 53: 51, 54: 52, 55: 50, 56: 51, 57: 52, 58: 53, 59: 54, 60: 55,
};

/** Offset of a group signal, or -1 when the spec has no address. */
export function groupSignalOffset(mode: MbsAddressMode, signalSpecIndex: number): number {
  const map = mode === ADDRESS_MODES.V4_COMP ? V4_GROUP_OFFSETS : FIXED_GROUP_OFFSETS;
  return map[signalSpecIndex] ?? -1;
}

/**
 * Register address of a signal. Returns null when the address cannot be
 * derived: CUSTOM mode without a persisted address, or an unmapped spec.
 */
export function getSignalAddress(
  mode: MbsAddressMode,
  locator: SignalLocator,
  customAddress?: number,
): number | null {
  const { g50Index, groupIndex, unitIndex, signalSpecIndex } = locator;

  if (mode === ADDRESS_MODES.CUSTOM) {
    return customAddress ?? null;
  }

  const v4 = mode === ADDRESS_MODES.V4_COMP;

  if (groupIndex === -1) {
    if (unitIndex === -1) {
      // Controller-general signal.
      return g50Index * 30 + signalSpecIndex + (v4 ? 1 : 0);
    }
    // Per-unit signal (indoor/outdoor alarm code). Not exercised by the
    // reference fixture — ported from source, UNVERIFIED against hardware.
    return (v4 ? g50Index : g50Index + 1) * 1000 + 20000 + unitIndex;
  }

  const offset = groupSignalOffset(mode, signalSpecIndex);
  if (offset === -1) return null;
  return (g50Index * 50 + (groupIndex + 1)) * 100 + offset;
}
