import { describe, expect, it } from "vitest";
import { ADDRESS_MODES } from "./types";
import { getSignalAddress, groupSignalOffset } from "./addresses";

/**
 * Address-assignment rules ported from IntesisProjectMbsMe_RT.cs:2713-2870.
 * The FIXED expectations below are the documented map verified 222/222
 * against the real 770 Air fixture (docs/ac-me-mbs-analisi.md §5).
 */

const general = (g50: number, spec: number) =>
  ({ g50Index: g50, groupIndex: -1, unitIndex: -1, signalSpecIndex: spec });
const group = (g50: number, grp: number, spec: number) =>
  ({ g50Index: g50, groupIndex: grp, unitIndex: -1, signalSpecIndex: spec });

describe("getSignalAddress FIXED", () => {
  it("maps controller-general signals to g50×30 + spec", () => {
    expect(getSignalAddress(ADDRESS_MODES.FIXED, general(0, 0))).toBe(0);
    expect(getSignalAddress(ADDRESS_MODES.FIXED, general(0, 29))).toBe(29);
    expect(getSignalAddress(ADDRESS_MODES.FIXED, general(1, 5))).toBe(35);
  });

  it("maps group signals to (g50×50 + group+1)×100 + offset", () => {
    // Group 0, spec 0 (On/Off) → 100, matching the fixture window 100–137.
    expect(getSignalAddress(ADDRESS_MODES.FIXED, group(0, 0, 0))).toBe(100);
    expect(getSignalAddress(ADDRESS_MODES.FIXED, group(0, 1, 46))).toBe(237);
    expect(getSignalAddress(ADDRESS_MODES.FIXED, group(0, 6, 0))).toBe(700);
    // Controller 1, group 0 → 5100.
    expect(getSignalAddress(ADDRESS_MODES.FIXED, group(1, 0, 0))).toBe(5100);
  });

  it("collapses mutually exclusive specs onto shared offsets", () => {
    // Mode IC/LC/BU share offset 1; fan IC/LC share 2; setpoint IC/BU share 4.
    for (const spec of [1, 2, 3]) expect(groupSignalOffset(ADDRESS_MODES.FIXED, spec)).toBe(1);
    for (const spec of [4, 5]) expect(groupSignalOffset(ADDRESS_MODES.FIXED, spec)).toBe(2);
    for (const spec of [7, 8]) expect(groupSignalOffset(ADDRESS_MODES.FIXED, spec)).toBe(4);
    // Dual-setpoint pairs.
    for (const [a, b] of [[31, 32], [33, 34], [35, 36], [37, 38], [39, 40]] as const) {
      expect(groupSignalOffset(ADDRESS_MODES.FIXED, a)).toBe(groupSignalOffset(ADDRESS_MODES.FIXED, b));
    }
  });

  it("returns null for specs with no address", () => {
    expect(getSignalAddress(ADDRESS_MODES.FIXED, group(0, 0, 61))).toBeNull();
    expect(getSignalAddress(ADDRESS_MODES.FIXED, group(0, 0, 47))).toBeNull(); // V4-only spec
  });

  it("maps per-unit signals to (g50+1)×1000 + 20000 + unit (UNVERIFIED)", () => {
    const loc = { g50Index: 0, groupIndex: -1, unitIndex: 3, signalSpecIndex: 0 };
    expect(getSignalAddress(ADDRESS_MODES.FIXED, loc)).toBe(21003);
  });
});

describe("getSignalAddress V4_COMP", () => {
  it("shifts general signals by +1 and uses the legacy group map", () => {
    expect(getSignalAddress(ADDRESS_MODES.V4_COMP, general(0, 0))).toBe(1);
    expect(getSignalAddress(ADDRESS_MODES.V4_COMP, group(0, 0, 0))).toBe(101);
    expect(getSignalAddress(ADDRESS_MODES.V4_COMP, group(0, 0, 47))).toBe(102);
  });

  it("returns null for specs outside the legacy map", () => {
    expect(getSignalAddress(ADDRESS_MODES.V4_COMP, group(0, 0, 1))).toBeNull();
  });
});

describe("getSignalAddress CUSTOM", () => {
  it("uses the persisted address or null when unknown", () => {
    expect(getSignalAddress(ADDRESS_MODES.CUSTOM, group(0, 0, 0), 1234)).toBe(1234);
    expect(getSignalAddress(ADDRESS_MODES.CUSTOM, group(0, 0, 0))).toBeNull();
  });
});
