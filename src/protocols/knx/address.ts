/**
 * KNX group addresses and physical (individual) addresses.
 * Mirrors IntesisKnx.ConvertStringToKNXAddress / IsValidKNXPhysicalAddress.
 *
 * Group address numeric form: 3-level `a/b/c` → `(a << 11) + (b << 8) + c`.
 * Without extended addresses the main group is limited to 15 (max 32767);
 * extended addresses allow main 31 (max 65535).
 */

export const DEFAULT_PHYSICAL_ADDRESS = "15.15.255";
export const MAX_GROUP_ADDRESS_STANDARD = 32767; // 15/7/255
export const MAX_GROUP_ADDRESS_EXTENDED = 65535; // 31/7/255

/** "a/b/c", "a/b" or plain ushort → numeric GA. Undefined when invalid. */
export function parseGroupAddress(value: string): number | undefined {
  const trimmed = value.trim();
  if (trimmed === "") return undefined;

  const three = /^(\d+)\/(\d+)\/(\d+)$/.exec(trimmed);
  if (three) {
    const [a, b, c] = [Number(three[1]), Number(three[2]), Number(three[3])];
    if (a > 31 || b > 7 || c > 255) return undefined;
    return (a << 11) + (b << 8) + c;
  }
  const two = /^(\d+)\/(\d+)$/.exec(trimmed);
  if (two) {
    const [a, b] = [Number(two[1]), Number(two[2])];
    if (a > 31 || b > 2047) return undefined;
    return (a << 11) + b;
  }
  if (/^\d+$/.test(trimmed)) {
    const n = Number(trimmed);
    return n >= 1 && n <= 65535 ? n : undefined;
  }
  return undefined;
}

/** Numeric GA → 3-level "a/b/c" (the auto-enum default rendering). */
export function formatGroupAddress(value: number): string {
  return `${(value >> 11) & 0x1f}/${(value >> 8) & 0x7}/${value & 0xff}`;
}

export function isValidGroupAddress(
  value: number,
  opts: { extended: boolean },
): boolean {
  if (value <= 0 || value > MAX_GROUP_ADDRESS_EXTENDED) return false;
  if (!opts.extended && value > MAX_GROUP_ADDRESS_STANDARD) return false;
  return true;
}

/** "area.line.device" (or plain int) → 16-bit physical address. */
export function parsePhysicalAddress(value: string): number | undefined {
  const trimmed = value.trim();
  if (trimmed === "" || trimmed === "0") return undefined;
  const dotted = /^(\d+)\.(\d+)\.(\d+)$/.exec(trimmed);
  if (dotted) {
    const [area, line, device] = [Number(dotted[1]), Number(dotted[2]), Number(dotted[3])];
    if (area > 15 || line > 15 || device > 255) return undefined;
    if (area === 0 && line === 0 && device === 0) return undefined;
    return (area << 12) + (line << 8) + device;
  }
  if (/^\d+$/.test(trimmed)) {
    const n = Number(trimmed);
    return n >= 1 && n <= 65535 ? n : undefined;
  }
  return undefined;
}

export function formatPhysicalAddress(value: number): string {
  return `${(value >> 12) & 0xf}.${(value >> 8) & 0xf}.${value & 0xff}`;
}
