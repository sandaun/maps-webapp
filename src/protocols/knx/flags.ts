/**
 * KNX communication flags. Interlocks from IntesisKnx.UpdateFlagsValue:
 * - clearing U also clears Ri
 * - setting Ri forces U on and clears R (Ri and R are mutually exclusive)
 * - setting R clears Ri
 */
export interface KnxFlags {
  /** Update on start-up / bus reset. */
  u: boolean;
  /** Transmit: update on transmit telegrams from KNX. */
  t: boolean;
  /** Read on init. Incompatible with R. */
  ri: boolean;
  /** Writable from the KNX bus. */
  w: boolean;
  /** Readable from the KNX bus. Incompatible with Ri. */
  r: boolean;
}

export const DEFAULT_FLAGS: KnxFlags = { u: true, t: false, ri: false, w: true, r: false };

/** Apply the interlock rules after changing one flag. */
export function applyFlagChange(flags: KnxFlags, changed: keyof KnxFlags): KnxFlags {
  const next = { ...flags };
  if (changed === "ri" && next.ri) {
    next.u = true;
    next.r = false;
  }
  if (changed === "r" && next.r) {
    next.ri = false;
  }
  if (changed === "u" && !next.u) {
    next.ri = false;
  }
  return next;
}

export function hasAnyFlag(flags: KnxFlags): boolean {
  return flags.u || flags.t || flags.ri || flags.w || flags.r;
}
