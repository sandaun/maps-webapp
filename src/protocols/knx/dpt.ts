/**
 * KNX DPT (datapoint type) handling.
 *
 * In the .ibmaps, a DPT is stored as `<DPT Value="…"/>` where Value is a
 * ushort: `main * 256 + sub`. The `x` wildcard subtype is stored as 255
 * (e.g. "1.x" → 0x01FF = 511). See IntesisKnx.ConvertStringToDPTValue.
 *
 * KNX–MBM offers the COMMON selection only: families 1–9, 12, 13, 14, 20
 * (families 10/11/23/232/29 are gated out in the desktop tool).
 */

export const DPT_WILDCARD_SUBTYPE = 255;

/** Family → allowed subtypes. Empty array = wildcard only. */
export const COMMON_DPT_SUBTYPES: Readonly<Record<number, readonly number[]>> = {
  1: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 18, 19, 21, 22, 100],
  2: [],
  3: [],
  4: [1, 2],
  5: [1, 3, 4, 6, 10],
  6: [1, 10],
  7: [1, 2, 5, 6, 7, 11, 12, 13],
  8: [1, 2, 5, 6, 7, 10, 11],
  9: [1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 20, 21, 22, 23, 24, 25, 26, 27, 28],
  12: [1],
  13: [1, 2, 10, 11, 12, 13, 14, 15, 100],
  14: [0, ...Array.from({ length: 79 }, (_, i) => i + 1)],
  20: [102, 105],
};

export function encodeDpt(main: number, sub: number): number {
  return main * 256 + sub;
}

export function decodeDpt(value: number): { main: number; sub: number } {
  return { main: Math.floor(value / 256), sub: value % 256 };
}

/** "9.001" / "1.x" → encoded value. Returns undefined if unparseable. */
export function parseDpt(value: string): number | undefined {
  const match = /^(\d+)\.(x|\d+)$/i.exec(value.trim());
  if (!match) return undefined;
  const main = Number(match[1]);
  const sub = match[2].toLowerCase() === "x" ? DPT_WILDCARD_SUBTYPE : Number(match[2]);
  return encodeDpt(main, sub);
}

/** Encoded value → "9.001" / "1.x" (subtype padded to 3 digits). */
export function formatDpt(value: number): string {
  const { main, sub } = decodeDpt(value);
  return `${main}.${sub === DPT_WILDCARD_SUBTYPE ? "x" : String(sub).padStart(3, "0")}`;
}

/**
 * Mirrors IntesisKnx.IsValidDPT (lenient) restricted to the COMMON family
 * selection offered by KNX–MBM: main must be offered; `x` (255) always ok;
 * sub 0 only allowed for family 14; families with an explicit subtype list
 * require membership.
 */
export function isValidDpt(value: number): boolean {
  const { main, sub } = decodeDpt(value);
  const subtypes = COMMON_DPT_SUBTYPES[main];
  if (!subtypes) return false;
  if (sub === DPT_WILDCARD_SUBTYPE) return true;
  if (sub === 0) return main === 14;
  if (subtypes.length === 0) return false;
  return subtypes.includes(sub);
}

/** Default DPT for a new signal in the desktop tool: "1.001: switch". */
export const DEFAULT_DPT = encodeDpt(1, 1);
